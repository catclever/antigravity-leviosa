#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PROJECT_ROOTS = [
    '/Users/kael/Library/Services/taichi',
    '/Users/kael/.gemini/antigravity/scratch',
    '/Users/kael/Projects',
    '/Users/kael/Documents',
    '/Users/kael/workbench'
];

/**
 * [Bug Fix Documentation]
 * 1. Problem Fixed: The previous implementation relied purely on directory traversal and fuzzy matching across hardcoded PROJECT_ROOTS. This caused multi-directory projects with duplicate names (e.g., a source repo and a deployed service repo) to be incorrectly resolved, often opening the parent directory or the wrong instance.
 * 2. Resolution Logic: Introduced `getRecentWorkspaces()` to query the IDE's SQLite database (`state.vscdb`) for `history.recentlyOpenedPathsList`. This acts as a dynamic source of truth for active workspace paths, enabling exact O(1) matching based on the absolute paths instead of guessing.
 * 3. Caveats/Notes: Relies on macOS native `sqlite3` CLI tool. If Antigravity IDE alters the path to `state.vscdb` in future updates, the `dbPath` constant here must be updated.
 */
function getRecentWorkspaces() {
    try {
        const dbPath = '/Users/kael/Library/Application Support/Antigravity/User/globalStorage/state.vscdb';
        const query = "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList';";
        const result = require('child_process').execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf-8' });
        const json = JSON.parse(result.trim());
        const paths = [];
        if (json.entries) {
            for (const entry of json.entries) {
                if (entry.folderUri && entry.folderUri.startsWith('file://')) {
                    paths.push(decodeURIComponent(entry.folderUri.substring(7)));
                } else if (entry.workspace && entry.workspace.configPath && entry.workspace.configPath.startsWith('file://')) {
                    paths.push(path.dirname(decodeURIComponent(entry.workspace.configPath.substring(7))));
                }
            }
        }
        return paths;
    } catch (e) {
        return [];
    }
}

function findProjectDir(projectName) {
    // 0. 极致优雅：直接从 Antigravity 全局数据库精确读取最近打开的工作区
    const recentPaths = getRecentWorkspaces();
    for (const p of recentPaths) {
        if (path.basename(p) === projectName) {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                return p;
            }
        }
    }

    for (const root of PROJECT_ROOTS) {
        // 1. 优先进行顶层精确匹配
        const exactPath = path.join(root, projectName);
        if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
            return exactPath;
        }
    }

    // 2. 尝试子目录精确匹配 (深度=1)，用于多目录/Monorepo场景
    for (const root of PROJECT_ROOTS) {
        if (fs.existsSync(root)) {
            try {
                const items = fs.readdirSync(root, { withFileTypes: true });
                for (const item of items) {
                    if (item.isDirectory()) {
                        const subPath = path.join(root, item.name, projectName);
                        if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory()) {
                            return subPath;
                        }
                    }
                }
            } catch (e) {
                // 忽略权限错误
            }
        }
    }

    // 3. 降级：模糊匹配（找包含 projectName 的目录）
    for (const root of PROJECT_ROOTS) {
        if (fs.existsSync(root)) {
            try {
                const items = fs.readdirSync(root, { withFileTypes: true });
                for (const item of items) {
                    if (item.isDirectory() && item.name.includes(projectName)) {
                        return path.join(root, item.name);
                    }
                }
            } catch (e) {
                // 忽略读取目录的权限错误等
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
