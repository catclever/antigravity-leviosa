#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * [Bug Fix Documentation]
 * 1. Problem Fixed: The previous SQLite-only approach was flawed because `state.vscdb` only stores a limited length of "recently opened" workspaces, leading to missing projects. Hardcoded `PROJECT_ROOTS` were needed as a fallback.
 * 2. Resolution Logic: Introduced `getAllKnownWorkspaces()` which scans `workspaceStorage` directories across Antigravity, VS Code, and Cursor. Because `workspaceStorage` permanently assigns an MD5 hash folder to EVERY workspace ever opened, this acts as a flawless, exhaustive database.
 * 3. Result: Hardcoded `PROJECT_ROOTS` arrays and traversal loops are now completely removed.
 */
function getAllKnownWorkspaces() {
    const paths = new Set();

    // 1. 从 SQLite 历史提取 (保证最近期打开的排在前面)
    try {
        const dbPath = path.join(process.env.HOME, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
        const query = "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList';";
        const result = require('child_process').execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf-8' });
        const json = JSON.parse(result.trim());
        if (json.entries) {
            for (const entry of json.entries) {
                if (entry.folderUri && entry.folderUri.startsWith('file://')) {
                    paths.add(decodeURIComponent(entry.folderUri.substring(7)));
                } else if (entry.workspace && entry.workspace.configPath && entry.workspace.configPath.startsWith('file://')) {
                    paths.add(path.dirname(decodeURIComponent(entry.workspace.configPath.substring(7))));
                }
            }
        }
    } catch (e) {}

    // 2. 从所有 IDE 的 workspaceStorage 地毯式提取（全量历史）
    const bases = [
        path.join(process.env.HOME, 'Library/Application Support/Antigravity/User/workspaceStorage'),
        path.join(process.env.HOME, 'Library/Application Support/Code/User/workspaceStorage'),
        path.join(process.env.HOME, 'Library/Application Support/Cursor/User/workspaceStorage')
    ];
    
    for (const base of bases) {
        if (!fs.existsSync(base)) continue;
        try {
            const dirs = fs.readdirSync(base);
            for (const dir of dirs) {
                const wsJson = path.join(base, dir, 'workspace.json');
                if (fs.existsSync(wsJson)) {
                    try {
                        const data = JSON.parse(fs.readFileSync(wsJson, 'utf-8'));
                        if (data.folder && data.folder.startsWith('file://')) {
                            paths.add(decodeURIComponent(data.folder.substring(7)));
                        } else if (data.workspace && data.workspace.startsWith('file://')) {
                            paths.add(path.dirname(decodeURIComponent(data.workspace.substring(7))));
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }
    
    return Array.from(paths);
}

function findProjectDir(projectName) {
    // 终极优雅：从 IDE 的全量工作区记录中精确匹配
    const knownPaths = getAllKnownWorkspaces();
    for (const p of knownPaths) {
        if (path.basename(p) === projectName) {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                return p;
            }
        }
    }
    return null;
}

const project = process.env.QUERY_project ? decodeURIComponent(process.env.QUERY_project) : '';
const appName = process.env.QUERY_app ? decodeURIComponent(process.env.QUERY_app) : 'Visual Studio Code';
const supportsWorkspace = process.env.QUERY_supportsWorkspace === 'true';

const logFile = '/tmp/ag_open.log';
fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Received project: "${project}", app: "${appName}"\n`);

if (!project) {
    console.log(JSON.stringify({ error: 'Missing project parameter' }));
    process.exit(0);
}

const subProjects = project.split(',').map(p => p.trim()).filter(Boolean);
const validPaths = [];

for (const subProject of subProjects) {
    const dirPath = findProjectDir(subProject);
    if (dirPath && !validPaths.includes(dirPath)) {
        validPaths.push(dirPath);
    }
}

if (validPaths.length === 0) {
    console.log(JSON.stringify({ error: 'Project directory not found', project }));
    process.exit(0);
}

let command = '';

if (supportsWorkspace && validPaths.length > 1) {
    // 动态生成 .code-workspace 文件
    const workspacePath = path.join('/tmp', `antigravity_${Date.now()}.code-workspace`);
    const workspaceContent = {
        folders: validPaths.map(p => ({ path: p }))
    };
    fs.writeFileSync(workspacePath, JSON.stringify(workspaceContent, null, 2));
    
    command = `open -a "${appName}" "${workspacePath}"`;
} else {
    // 拼接所有路径
    const args = validPaths.map(p => `"${p}"`).join(' ');
    command = `open -a "${appName}" ${args}`;
}

exec(command, (error) => {
    if (error) {
        console.log(JSON.stringify({ error: error.message, command }));
    } else {
        console.log(JSON.stringify({ success: true, command, paths: validPaths }));
    }
});
