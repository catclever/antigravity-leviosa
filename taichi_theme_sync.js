#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// ==========================================
// 1. 配置区：沿用你之前的目录
// ==========================================
const PROJECT_ROOTS = [
    '/Users/kael/.gemini/antigravity/scratch',
    '/Users/kael/Projects',
    '/Users/kael/Documents',
    '/Users/kael/workbench',
    '/Users/kael/Library/Services'
];

function findProjectSettings(projectName) {
    for (const root of PROJECT_ROOTS) {
        // 1. 优先进行精确匹配
        const exactPath = path.join(root, projectName, '.vscode', 'settings.json');
        if (fs.existsSync(exactPath)) {
            return exactPath;
        }
        
        // 2. 降级：模糊匹配（找包含 projectName 的目录）
        if (fs.existsSync(root)) {
            try {
                const items = fs.readdirSync(root, { withFileTypes: true });
                for (const item of items) {
                    if (item.isDirectory() && item.name.includes(projectName)) {
                        const fuzzyPath = path.join(root, item.name, '.vscode', 'settings.json');
                        if (fs.existsSync(fuzzyPath)) {
                            return fuzzyPath;
                        }
                    }
                }
            } catch (e) {
                // 忽略读取目录的权限错误等
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
