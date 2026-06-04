const fs = require('fs');
const path = require('path');

const PROJECT_ROOTS = [
    path.join(process.env.HOME, 'Library/Services/taichi'),
    path.join(process.env.HOME, '.gemini/antigravity/scratch'),
    path.join(process.env.HOME, 'Projects'),
    path.join(process.env.HOME, 'Documents'),
    path.join(process.env.HOME, 'workbench')
];

function getAllKnownWorkspaces() {
    const paths = new Set();
    
    // 1. 从 SQLite 历史提取
    try {
        const dbPath = path.join(process.env.HOME, 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
        const query = "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList';";
        const result = require('child_process').execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
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

    // 2. 从所有 IDE 的 workspaceStorage 提取
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

function findProjectDirFast(startPaths, targetName, maxDepth = 4) {
    const queue = startPaths.map(p => ({ dir: p, depth: 0 }));
    
    while (queue.length > 0) {
        const { dir, depth } = queue.shift();
        
        if (depth > maxDepth) continue;
        if (!fs.existsSync(dir)) continue;
        
        try {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
                if (item.isDirectory()) {
                    if (item.name === 'node_modules' || item.name === '.git' || item.name === 'venv' || item.name === '.venv') continue;
                    
                    const fullPath = path.join(dir, item.name);
                    if (item.name === targetName) {
                        return fullPath;
                    }
                    if (depth < maxDepth) {
                        queue.push({ dir: fullPath, depth: depth + 1 });
                    }
                }
            }
        } catch (e) { }
    }
    return null;
}

function findProjectDir(projectName) {
    if (!projectName) return null;
    
    const knownPaths = getAllKnownWorkspaces();
    for (const p of knownPaths) {
        if (path.basename(p) === projectName) {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                return p;
            }
        }
    }
    
    const fallbackPath = findProjectDirFast(PROJECT_ROOTS, projectName);
    if (fallbackPath) return fallbackPath;

    return null;
}

module.exports = {
    findProjectDir,
    getAllKnownWorkspaces,
    findProjectDirFast,
    PROJECT_ROOTS
};
