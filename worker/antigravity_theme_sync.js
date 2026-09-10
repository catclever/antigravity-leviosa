const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

function findProjectSettings(projectName) {
    let currentDir = findProjectDir(projectName);
    
    // 1. 向上遍历查找
    while (currentDir && currentDir !== '/' && currentDir !== process.env.HOME) {
        const settingsPath = path.join(currentDir, '.vscode', 'settings.json');
        if (fs.existsSync(settingsPath)) return settingsPath;
        currentDir = path.dirname(currentDir);
    }
    
    // 2. 如果包含 repoName（例如 "antigravity-leviosa/com.google.antigravity"）
    if (projectName.includes('/')) {
        const repoName = projectName.split('/')[0];
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
            const themeColor = colors['titleBar.activeBackground'] || colors['editor.background'] || null;

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
