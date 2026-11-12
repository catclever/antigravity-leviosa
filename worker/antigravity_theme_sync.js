const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

function findProjectSettings(projectName) {
    if (!projectName || projectName === 'General') return null;

    // 0. 直接检查常见工程目录（极速路径匹配，无需递归扫描）
    const directCandidates = [
        path.join(process.env.HOME, 'Projects', projectName),
        path.join(process.env.HOME, '.gemini/Projects', projectName),
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
    
    // 2. 如果包含 repoName（例如 "antigravity-leviosa/com.google.antigravity" 或 "catclever/agy-disciple"）
    if (projectName.includes('/')) {
        const candidates = [
            projectName.split('/').pop().trim(),
            projectName.split('/')[0].trim()
        ];
        for (const repoName of candidates) {
            const repoDir = findProjectDir(repoName);
            if (repoDir) {
                const settingsPath = path.join(repoDir, '.vscode', 'settings.json');
                if (fs.existsSync(settingsPath)) return settingsPath;
            }
        }
    }
    return null;
}

function findFallbackThemeColor(projectName) {
    if (!projectName || projectName === 'General') return null;

    const candidateDirs = [
        path.join(process.env.HOME, '.gemini/Projects', projectName),
        path.join(process.env.HOME, 'Projects', projectName)
    ];

    for (const baseDir of candidateDirs) {
        if (!fs.existsSync(baseDir)) continue;

        // 检查 IRON_RULES.md
        const rulesPath = path.join(baseDir, 'IRON_RULES.md');
        if (fs.existsSync(rulesPath)) {
            try {
                const content = fs.readFileSync(rulesPath, 'utf-8');
                const match = content.match(/Theme-Color\*?\*?:\s*`?(#[0-9a-fA-F]{6})\b/i);
                if (match && match[1]) return match[1];
            } catch (e) {}
        }

        // 检查 kb/knowledge.md
        const kbPath = path.join(baseDir, 'kb', 'knowledge.md');
        if (fs.existsSync(kbPath)) {
            try {
                const content = fs.readFileSync(kbPath, 'utf-8');
                const match = content.match(/Primary Theme Color\*?\*?:\s*`?(#[0-9a-fA-F]{6})\b/i);
                if (match && match[1]) return match[1];
            } catch (e) {}
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
        // 候选名称列表：优先尝试 / 最后一段（repo 名），再尝试第一段
        const nameCandidates = subProject.includes('/')
            ? Array.from(new Set([
                subProject.split('/').pop().trim(),
                subProject.split('/')[0].trim(),
                subProject
            ])).filter(Boolean)
            : [subProject];

        for (const candidateName of nameCandidates) {
            // 1. 尝试从 .vscode/settings.json 解析主题色
            const settingsPath = findProjectSettings(candidateName);
            if (settingsPath) {
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

            // 2. 文本正则兜底（Fallback）：IRON_RULES.md / kb/knowledge.md
            const fallbackColor = findFallbackThemeColor(candidateName);
            if (fallbackColor) {
                foundColor = fallbackColor;
                break;
            }
        }

        if (foundColor) break;
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
