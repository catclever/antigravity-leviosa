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
    
    let repoName = null;
    let subDir = projectName;

    if (projectName.includes('/')) {
        const parts = projectName.split('/');
        repoName = parts[0];
        subDir = parts.slice(1).join('/');
    }
    
    const knownPaths = getAllKnownWorkspaces();
    const candidates = new Set();
    
    // 1. 如果带有 repoName，尝试严格匹配
    if (repoName) {
        const suffix = `/${repoName}/${subDir}`;
        for (const p of knownPaths) {
            if (p.endsWith(suffix) && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                candidates.add(p);
            }
        }
        
        for (const p of knownPaths) {
            if (path.basename(p) === repoName) {
                const fullPath = path.join(p, subDir);
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                    candidates.add(fullPath);
                }
            }
        }
        
        const fallbackRepoPath = findProjectDirFast(PROJECT_ROOTS, repoName);
        if (fallbackRepoPath) {
            const fullPath = path.join(fallbackRepoPath, subDir);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                candidates.add(fullPath);
            }
        }
    }
    
    // 2. 无论有没有 repoName，或者严格匹配失败，我们都应该把 subDir 当作独立目标去找
    // 因为云端的 repoName 可能在本地完全不存在（例如被用户移动到了 taichi/apps 下）
    for (const p of knownPaths) {
        if (path.basename(p) === subDir) {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                candidates.add(p);
            }
        }
    }
    
    const fallbackPath = findProjectDirFast(PROJECT_ROOTS, subDir);
    if (fallbackPath) {
        candidates.add(fallbackPath);
    }

    if (candidates.size === 0) return null;
    if (candidates.size === 1) return Array.from(candidates)[0];
    
    // 3. 如果有多个候选目录，通过“特征打分”来优选
    let bestCandidate = null;
    let highestScore = -Infinity;
    
    for (const p of candidates) {
        let score = 0;
        
        // 如果给定了 repoName，且该路径真的包含 repoName，给予巨大的加分（尊重全路径匹配）
        if (repoName && p.includes(`/${repoName}/`)) {
            score += 20;
        }
        
        // 核心项目特征：存在任意一个都是强烈的项目根目录信号
        if (fs.existsSync(path.join(p, '.git'))) score += 10;
        if (fs.existsSync(path.join(p, '.vscode'))) score += 10;
        if (fs.existsSync(path.join(p, '.agent'))) score += 10;
        
        // 次要特征
        if (fs.existsSync(path.join(p, 'package.json'))) score += 5;
        if (fs.existsSync(path.join(p, 'Gemfile'))) score += 5;
        if (fs.existsSync(path.join(p, 'requirements.txt'))) score += 5;
        
        // 惩罚项：目录越深，分数越低（倾向于更浅的目录）
        const depth = p.split(path.sep).length;
        score -= depth;
        
        if (score > highestScore) {
            highestScore = score;
            bestCandidate = p;
        }
    }
    
    return bestCandidate;
}

function findProjectDirByUUID(uuid) {
    if (!uuid) return null;
    try {
        const pbPath = path.join(process.env.HOME, '.gemini/antigravity/agyhub_summaries_proto.pb');
        if (!fs.existsSync(pbPath)) return null;

        const data = fs.readFileSync(pbPath);
        const idBuf = Buffer.from(uuid);
        let idx = data.indexOf(idBuf);
        while (idx !== -1) {
            const afterId = data.slice(idx);
            const fileIdx = afterId.indexOf(Buffer.from('file:///'));
            if (fileIdx !== -1 && fileIdx < 500) {
                const pathStart = fileIdx + 7;
                let pathEnd = pathStart;
                while (pathEnd < afterId.length && afterId[pathEnd] >= 32 && afterId[pathEnd] <= 126 && afterId[pathEnd] !== 34 && afterId[pathEnd] !== 39) {
                    pathEnd++;
                }
                const extracted = afterId.slice(pathStart, pathEnd).toString();
                if (fs.existsSync(extracted) && fs.statSync(extracted).isDirectory()) {
                    return extracted;
                }
            }
            idx = data.indexOf(idBuf, idx + 1);
        }
    } catch (e) {
        console.error('[Antigravity Mod] Error resolving UUID from DB:', e);
    }
    return null;
}

module.exports = {
    findProjectDir,
    findProjectDirByUUID,
    getAllKnownWorkspaces,
    findProjectDirFast,
    PROJECT_ROOTS
};
