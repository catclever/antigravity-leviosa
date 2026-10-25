const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

function findProjectSettings(projectName) {
    if (!projectName || projectName === 'General') return null;

    // 0. 直接检查常见工程目录（极速路径匹配，无需递归扫描）
    const directCandidates = [
        path.join(process.env.HOME, 'Projects', projectName),
        path.join(process.env.HOME, 'Library/Services/taichi/apps', projectName),
        path.join(process.env.HOME, 'Library/Services/taichi', projectName),
        path.join(process.env.HOME, 'workbench', projectName),
        path.join(process.env.HOME, projectName)
    ];

    for (const cand of directCandidates) {
        if (fs.existsSync(cand)) {
            const settingsPath = path.join(cand, '.vscode', 'settings.json');
            if (fs.existsSync(settingsPath)) return settingsPath;
        }
    }

    let currentDir = findProjectDir(projectName);
    
    // 1. 向上遍历查找
    while (currentDir && currentDir !== '/' && currentDir !== process.env.HOME) {
        const settingsPath = path.join(currentDir, '.vscode', 'settings.json');
        if (fs.existsSync(settingsPath)) return settingsPath;
        currentDir = path.dirname(currentDir);
    }
    
    // 2. 如果包含 repoName（例如 "antigravity-leviosa/com.google.antigravity"）
    if (projectName.includes('/')) {
        const repoName = projectName.split('/')[0].trim();
        const repoDir = findProjectDir(repoName);
        if (repoDir) {
            const settingsPath = path.join(repoDir, '.vscode', 'settings.json');
            if (fs.existsSync(settingsPath)) return settingsPath;
        }
    }
    return null;
}

function parseJSONWithComments(str) {
    const cleaned = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    return JSON.parse(cleaned);
}

module.exports = async function(query) {
    const project = query.project;

    if (!project) {
        return { error: 'Missing project parameter', __taichi_ttl: 86400 };
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
            const themeColor = colors['titleBar.activeBackground'] || colors['editor.background'] || settings['peacock.color'] || null;

            if (themeColor) {
                foundColor = themeColor;
                break;
            }
        } catch (e) {
            lastError = e.message;
        }
    }

    if (!foundColor) {
        return { 
            error: 'Project settings or theme color not found', 
            project, 
            details: lastError,
            __taichi_ttl: 86400 
        };
    }

    return { 
        success: true, 
        project: project, 
        color: foundColor,
        __taichi_ttl: 86400
    };
};
