#!/usr/bin/env node
const { exec } = require('child_process');
const path = require('path');
const uuid = process.env.QUERY_uuid ? decodeURIComponent(process.env.QUERY_uuid) : '';
const title = process.env.QUERY_title ? decodeURIComponent(process.env.QUERY_title) : '';
const project = process.env.QUERY_project ? decodeURIComponent(process.env.QUERY_project) : '';
const action = process.env.QUERY_action ? decodeURIComponent(process.env.QUERY_action) : 'shallow';

const titleB64 = Buffer.from(title).toString('base64');
const projectB64 = Buffer.from(project).toString('base64');
const scriptPath = path.join(__dirname, 'antigravity', 'agy_archive.js');

let command = '';

if (action === 'lookup') {
    if (!title) {
        console.log(JSON.stringify({ error: 'Missing title parameter for lookup' }));
        process.exit(0);
    }
    command = `node "${scriptPath}" lookup "${titleB64}"`;
} else {
    if (!uuid) {
        console.log(JSON.stringify({ error: 'Missing uuid parameter' }));
        process.exit(0);
    }

    // Ensure uuid format (simple regex check for safety)
    if (!/^[a-f0-9\-]+$/i.test(uuid)) {
        console.log(JSON.stringify({ error: 'Invalid uuid format' }));
        process.exit(0);
    }

    const modeFlag = action === 'deep' ? '--deep' : '--shallow';
    command = `node "${scriptPath}" clean ${modeFlag} ${uuid} "${titleB64}" "${projectB64}"`;
}

exec(command, (error, stdout, stderr) => {
    if (error && action !== 'lookup') {
        console.log(JSON.stringify({ success: false, error: error.message, stderr }));
    } else {
        // For lookup, agy_archive.js will output JSON directly
        if (action === 'lookup') {
            console.log(stdout.trim());
        } else {
            console.log(JSON.stringify({ success: true, output: stdout }));
        }
    }
});
