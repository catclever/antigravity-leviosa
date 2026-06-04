#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

const project = process.env.QUERY_project ? decodeURIComponent(process.env.QUERY_project) : '';
const appName = process.env.QUERY_app ? decodeURIComponent(process.env.QUERY_app) : 'Visual Studio Code';
const supportsWorkspace = process.env.QUERY_supportsWorkspace === 'true';

const logFile = '/tmp/ag_open.log';
fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Received project: "${project}", app: "${appName}"\n`);

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
    const workspacePath = path.join('/tmp', `antigravity_${Date.now()}.code-workspace`);
    const workspaceContent = {
        folders: validPaths.map(p => ({ path: p }))
    };
    fs.writeFileSync(workspacePath, JSON.stringify(workspaceContent, null, 2));
    
    if (appName.toLowerCase().includes('cursor')) {
        command = `cursor "${workspacePath}"`;
    } else {
        command = `code "${workspacePath}"`;
    }
} else {
    const targetPath = validPaths[0];
    if (appName === 'Finder') {
        command = `open "${targetPath}"`;
    } else if (appName === 'kitty') {
        command = `open -a kitty "${targetPath}"`;
    } else if (appName === 'iTerm') {
        command = `open -a iTerm "${targetPath}"`;
    } else if (appName.toLowerCase().includes('cursor')) {
        command = `cursor "${targetPath}"`;
    } else {
        command = `code "${targetPath}"`;
    }
}

try {
    const { execSync } = require('child_process');
    execSync(command);
    console.log(JSON.stringify({ success: true, command, paths: validPaths }));
} catch (e) {
    console.log(JSON.stringify({ error: e.message, command }));
}
