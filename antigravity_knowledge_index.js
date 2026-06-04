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
