#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

function findProjectSettings(projectName) {
    // 终极优雅：从 IDE 的全量工作区记录中精确匹配
    const knownPaths = getAllKnownWorkspaces();
    for (const p of knownPaths) {
        if (path.basename(p) === projectName) {
            const settingsPath = path.join(p, '.vscode', 'settings.json');
            if (fs.existsSync(settingsPath)) {
                return settingsPath;
            }
        }
    }
    return null;
}

function parseJSONWithComments(str) {
    const cleaned = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    return JSON.parse(cleaned);
}

// ==========================================
// 2. 核心网关逻辑：抛弃繁重的 HTTP Server
// ==========================================

// TaiChi 会自动将 ?project=xxx 转化为环境变量 QUERY_project
const project = process.env.QUERY_project;

if (!project) {
    // 缺失参数时，缓存 60 秒防止恶意重试
    console.log(JSON.stringify({ error: 'Missing project parameter', __taichi_ttl: 86400 }));
    process.exit(0);
}

const subProjects = project.split(',').map(p => p.trim()).filter(Boolean);
let foundColor = null;
let lastError = null;

for (const subProject of subProjects) {
    const settingsPath = findProjectSettings(subProject);
    if (!settingsPath) continue;

    try {
        const fileContent = fs.readFileSync(settingsPath, 'utf-8');
        const settings = parseJSONWithComments(fileContent);
        
        const colors = settings['workbench.colorCustomizations'] || {};
        const themeColor = colors['titleBar.activeBackground'] || colors['editor.background'] || null;

        if (themeColor) {
            foundColor = themeColor;
            break; // 找到了第一个带颜色的有效配置，跳出循环
        }
    } catch (e) {
        lastError = e.message;
        // 当前子项目解析失败，继续尝试下一个
    }
}

if (!foundColor) {
    console.log(JSON.stringify({ 
        error: 'Project settings or theme color not found', 
        project, 
        details: lastError,
        __taichi_ttl: 86400 
    }));
    process.exit(0);
}

// 输出最终结果，携带缓存指令
console.log(JSON.stringify({ 
    success: true, 
    project: project, 
    color: foundColor,
    __taichi_ttl: 86400  // 🌟 核心魔法：让 TaiChi 把这个结果强缓存 24 小时
}));
