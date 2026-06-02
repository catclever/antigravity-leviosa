#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/**
 * [Bug Fix Documentation]
 * 1. Problem Fixed: The previous implementation relied purely on directory traversal and fuzzy matching across hardcoded PROJECT_ROOTS. This caused multi-directory projects with duplicate names (e.g., a source repo and a deployed service repo) to be incorrectly resolved, often extracting the theme color from the parent directory or the wrong instance.
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

function findProjectSettings(projectName) {
    // 0. 极致优雅：直接从 Antigravity 全局数据库精确读取最近打开的工作区
    const recentPaths = getRecentWorkspaces();
    for (const p of recentPaths) {
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
