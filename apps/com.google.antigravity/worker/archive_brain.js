const { exec } = require('child_process');
const path = require('path');

module.exports = async function(query) {
    const uuid = query.uuid ? decodeURIComponent(query.uuid) : '';
    const title = query.title ? decodeURIComponent(query.title) : '';
    const project = query.project ? decodeURIComponent(query.project) : '';
    const action = query.action ? decodeURIComponent(query.action) : 'shallow';

    const titleB64 = Buffer.from(title).toString('base64');
    const projectB64 = Buffer.from(project).toString('base64');
    const scriptPath = path.join(__dirname, 'antigravity', 'agy_archive.js');

    let command = '';

    if (action === 'lookup') {
        if (!title) {
            return { error: 'Missing title parameter for lookup' };
        }
        command = `node "${scriptPath}" lookup "${titleB64}"`;
    } else {
        if (!uuid) {
            return { error: 'Missing uuid parameter' };
        }

        // Ensure uuid format (simple regex check for safety)
        if (!/^[a-f0-9\-]+$/i.test(uuid)) {
            return { error: 'Invalid uuid format' };
        }

        const modeFlag = action === 'deep' ? '--deep' : '--shallow';
        command = `node "${scriptPath}" clean ${modeFlag} ${uuid} "${titleB64}" "${projectB64}"`;
    }

    return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
            if (error && action !== 'lookup') {
                resolve({ success: false, error: error.message, stderr });
            } else {
                // For lookup, agy_archive.js outputs JSON directly, so we need to parse it
                // otherwise our HTTP handler will JSON stringify a stringified JSON
                if (action === 'lookup') {
                    try {
                        resolve(JSON.parse(stdout.trim()));
                    } catch (e) {
                        resolve({ error: "Failed to parse lookup output", output: stdout });
                    }
                } else {
                    resolve({ success: true, output: stdout });
                }
            }
        });
    });
};
