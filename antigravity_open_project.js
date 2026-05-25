#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PROJECT_ROOTS = [
    '/Users/kael/.gemini/antigravity/scratch',
    '/Users/kael/Projects',
    '/Users/kael/Documents',
    '/Users/kael/workbench'
];

function findProjectDir(projectName) {
    for (const root of PROJECT_ROOTS) {
        // 1. 优先进行精确匹配
        const exactPath = path.join(root, projectName);
        if (fs.existsSync(exactPath) && fs.statSync(exactPath).isDirectory()) {
            return exactPath;
        }
        
        // 2. 降级：模糊匹配（找包含 projectName 的目录）
        if (fs.existsSync(root)) {
            try {
                const items = fs.readdirSync(root, { withFileTypes: true });
                for (const item of items) {
                    if (item.isDirectory() && item.name.includes(projectName)) {
                        return path.join(root, item.name);
                    }
                }
            } catch (e) {
                // 忽略读取目录的权限错误等
            }
        }
    }
    return null;
}

const project = process.env.QUERY_project ? decodeURIComponent(process.env.QUERY_project) : '';
const appName = process.env.QUERY_app ? decodeURIComponent(process.env.QUERY_app) : 'Visual Studio Code';
const supportsWorkspace = process.env.QUERY_supportsWorkspace === 'true';

if (!project) {
    console.log(JSON.stringify({ error: 'Missing project parameter' }));
    process.exit(0);
}

const subProjects = project.split(',').map(p => p.trim()).filter(Boolean);
const validPaths = [];

for (const subProject of subProjects) {
    const dirPath = findProjectDir(subProject);
    if (dirPath && !validPaths.includes(dirPath)) {
        validPaths.push(dirPath);
    }
}

if (validPaths.length === 0) {
    console.log(JSON.stringify({ error: 'Project directory not found', project }));
    process.exit(0);
}

let command = '';

if (supportsWorkspace && validPaths.length > 1) {
    // 动态生成 .code-workspace 文件
    const workspacePath = path.join('/tmp', `antigravity_${Date.now()}.code-workspace`);
    const workspaceContent = {
        folders: validPaths.map(p => ({ path: p }))
    };
    fs.writeFileSync(workspacePath, JSON.stringify(workspaceContent, null, 2));
    
    command = `open -a "${appName}" "${workspacePath}"`;
} else {
    // 拼接所有路径
    const args = validPaths.map(p => `"${p}"`).join(' ');
    command = `open -a "${appName}" ${args}`;
}

exec(command, (error) => {
    if (error) {
        console.log(JSON.stringify({ error: error.message, command }));
    } else {
        console.log(JSON.stringify({ success: true, command, paths: validPaths }));
    }
});
