#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ARGS = process.argv.slice(2);
const SCRIPT_DIR = __dirname;
const ARCHIVES_DIR = path.join(SCRIPT_DIR, 'archives');
const INDEX_FILE = path.join(ARCHIVES_DIR, 'archive_index.json');
const GEMINI_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
const BRAIN_DIR = path.join(GEMINI_DIR, 'brain');

if (!fs.existsSync(ARCHIVES_DIR)) {
    fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

function loadIndex() {
    if (fs.existsSync(INDEX_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        } catch (e) {
            console.error('Failed to parse index file, initializing empty array.');
        }
    }
    return [];
}

function saveIndex(indexData) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
}

function runCommand(cmd) {
    try {
        console.log(`[EXEC] ${cmd}`);
        return execSync(cmd, { stdio: 'inherit' });
    } catch (err) {
        console.error(`[ERROR] Command failed: ${cmd}`);
        process.exit(1);
    }
}

function handleShallowClean(uuid, title, project) {
    const targetBrain = path.join(BRAIN_DIR, uuid);
    if (!fs.existsSync(targetBrain)) {
        console.error(`Brain directory not found for ${uuid} at ${targetBrain}`);
        process.exit(1);
    }

    const sysGenDir = path.join(targetBrain, '.system_generated');
    const scratchDir = path.join(targetBrain, 'scratch');
    
    let pathsToArchive = [];
    if (fs.existsSync(sysGenDir)) pathsToArchive.push('.system_generated');
    if (fs.existsSync(scratchDir)) pathsToArchive.push('scratch');

    if (pathsToArchive.length === 0) {
        console.log(`Nothing to shallow archive for ${uuid}. Directories may have already been cleaned.`);
        return;
    }

    const timestampMs = Date.now();
    const tarballName = `${uuid}_shallow_${timestampMs}.tar.gz`;
    const tarballPath = path.join(ARCHIVES_DIR, tarballName);
    
    // We cd into the brain folder so the tarball paths are relative
    const pathsStr = pathsToArchive.map(p => `"${p}"`).join(' ');
    runCommand(`cd "${targetBrain}" && tar -czf "${tarballPath}" ${pathsStr}`);

    // Clean up original folders after successful tar
    for (const p of pathsToArchive) {
        const fullPath = path.join(targetBrain, p);
        runCommand(`rm -rf "${fullPath}"`);
    }

    // Update the index file
    const indexData = loadIndex();
    
    indexData.push({
        uuid: uuid,
        title: title || 'Unknown Title',
        project: project || 'Unknown Project',
        type: 'shallow',
        timestamp: new Date().toISOString(),
        tarball: tarballPath
    });
    
    saveIndex(indexData);

    console.log(`✅ Shallow archive complete for ${uuid}.`);
    console.log(`📦 Saved to: ${tarballPath}`);
    console.log(`📝 Record updated in: ${INDEX_FILE}`);
}

function main() {
    if (ARGS.length < 3) {
        console.log('Usage: node agy_archive.js clean --shallow <uuid>');
        process.exit(1);
    }

    const command = ARGS[0];
    const mode = ARGS[1];
    const uuid = ARGS[2];
    const title = ARGS[3] ? Buffer.from(ARGS[3], 'base64').toString('utf8') : '';
    const project = ARGS[4] ? Buffer.from(ARGS[4], 'base64').toString('utf8') : '';

    if (command === 'clean') {
        if (mode === '--shallow') {
            handleShallowClean(uuid, title, project);
        } else {
            console.error(`Unsupported mode: ${mode}. Only --shallow is implemented currently.`);
            process.exit(1);
        }
    } else {
        console.log(`Unsupported command: ${command}`);
        process.exit(1);
    }
}

main();
