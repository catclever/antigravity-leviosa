#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function getAllKnownWorkspaces() {
    const paths = new Set();
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

const PROJECT_ROOTS = [
    path.join(process.env.HOME, 'Library/Services/taichi'),
    path.join(process.env.HOME, '.gemini/antigravity/scratch'),
    path.join(process.env.HOME, 'Projects'),
    path.join(process.env.HOME, 'Documents'),
    path.join(process.env.HOME, 'workbench')
];

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
        } catch (e) {
            // ignore access errors
        }
    }
    return null;
}

function findProjectDir(projectName) {
    if (!projectName) return null;
    
    // 1. 终极优雅：从 IDE 的全量工作区记录中精确匹配
    const knownPaths = getAllKnownWorkspaces();
    for (const p of knownPaths) {
        if (path.basename(p) === projectName) {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                return p;
            }
        }
    }
    
    // 2. 备选方案：通过 BFS 快速扫描常用目录 (深度4)，解决未被 IDE 记录的新项目或深层中文路径
    const fallbackPath = findProjectDirFast(PROJECT_ROOTS, projectName);
    if (fallbackPath) return fallbackPath;

    return null;
}

const project = process.env.QUERY_project ? decodeURIComponent(process.env.QUERY_project) : '';
const scope = process.env.QUERY_scope ? decodeURIComponent(process.env.QUERY_scope) : 'all';

const projectDir = findProjectDir(project);

let knowledgeMdContent = '';
if (projectDir) {
    const knowledgeMdPath = path.join(projectDir, '.agent', 'knowledge.md');
    if (fs.existsSync(knowledgeMdPath)) {
        try {
            knowledgeMdContent = fs.readFileSync(knowledgeMdPath, 'utf-8');
        } catch (e) {}
    }
}

const rules = [];

function loadRulesFromDir(dirPath, scopeLabel) {
    if (!fs.existsSync(dirPath)) return;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            if (file.endsWith('.md')) {
                const filePath = path.join(dirPath, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const tag = file.replace('.md', '');
                
                let description = '';
                const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
                let cleanContent = content;
                
                if (yamlMatch) {
                    cleanContent = content.replace(/^---\n[\s\S]*?\n---/, '').trim();
                    const yamlLines = yamlMatch[1].split('\n');
                    for (const line of yamlLines) {
                        if (line.trim().startsWith('description:')) {
                            description = line.replace('description:', '').trim().replace(/^["']|["']$/g, '');
                            break;
                        }
                    }
                }
                
                let type = '';
                if (scopeLabel === 'Local') {
                    if (knowledgeMdContent.includes(tag) || knowledgeMdContent.includes(file)) {
                        type = 'Knowledge';
                    } else {
                        type = 'Instruction';
                    }
                }

                rules.push({
                    tag,
                    description,
                    content: cleanContent,
                    scope: scopeLabel,
                    type: type
                });
            }
        }
    } catch (e) {}
}

const globalDir = path.join(process.env.HOME, '.gemini', 'kb');
let localDir = null;

if (projectDir) {
    localDir = path.join(projectDir, '.agent', 'kb');
}

if (scope === 'all' || scope === 'global') {
    loadRulesFromDir(globalDir, 'Global');
}
if (scope === 'all' || scope === 'local') {
    if (localDir) {
        loadRulesFromDir(localDir, 'Local');
    }
}

console.log(JSON.stringify({ success: true, project: projectDir || 'none', scope, rules }));
