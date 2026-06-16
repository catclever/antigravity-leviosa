const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

module.exports = async function(query) {
    const project = query.project ? decodeURIComponent(query.project) : '';
    const appName = query.app ? decodeURIComponent(query.app) : 'Visual Studio Code';
    const supportsWorkspace = query.supportsWorkspace === 'true';

    const logFile = '/tmp/ag_open.log';
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Received project: "${project}", app: "${appName}"\n`);

    if (!project) {
        return { error: 'Missing project parameter' };
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
        return { error: 'Project directory not found', project };
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
        const targetPaths = validPaths.map(p => `"${p}"`).join(' ');
        if (appName === 'Finder') {
            command = `open ${targetPaths}`;
        } else if (appName === 'kitty') {
            command = `open -a kitty ${targetPaths}`;
        } else if (appName === 'iTerm') {
            command = `open -a iTerm ${targetPaths}`;
        } else if (appName.toLowerCase().includes('cursor')) {
            command = `cursor ${targetPaths}`;
        } else {
            command = `code ${targetPaths}`;
        }
    }

    try {
        const { execSync } = require('child_process');
        execSync(command);
        return { success: true, command, paths: validPaths };
    } catch (e) {
        return { error: e.message, command };
    }
};
