#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

function findProjectSettings(projectName) {
    const projectDir = findProjectDir(projectName);
    if (projectDir) {
        const settingsPath = path.join(projectDir, '.vscode', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            return settingsPath;
        }
    }
    return null;
}

function parseJSONWithComments(str) {
    const cleaned = str.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
    return JSON.parse(cleaned);
}

const project = process.env.QUERY_project;

if (!project) {
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
            break;
        }
    } catch (e) {
        lastError = e.message;
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

console.log(JSON.stringify({ 
    success: true, 
    project: project, 
    color: foundColor,
    __taichi_ttl: 86400
}));
