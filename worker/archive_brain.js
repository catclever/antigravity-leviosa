const { execFile } = require('child_process');
const path = require('path');

module.exports = async function(query) {
    const uuid = query.uuid ? decodeURIComponent(query.uuid) : '';
    const title = query.title ? decodeURIComponent(query.title) : '';
    const project = query.project ? decodeURIComponent(query.project) : '';
    const action = query.action ? decodeURIComponent(query.action) : 'shallow';
    const offloadAll = query.all === true || query.all === 'true' || uuid === '--all';

    const titleB64 = Buffer.from(title).toString('base64');
    const projectB64 = Buffer.from(project).toString('base64');
    /*
     * [Bug Fix Document]
     * 1. Problem:
     *    (a) Previously `scriptPath` pointed to a non-existent `worker/antigravity/agy_archive.js` path.
     *    (b) `archive_brain.js` lacked endpoints for `offload` (`uuid` or `all=true`) and `restore` (`uuid`),
     *        and used shell-interpolated `exec` instead of argument-safe `execFile`.
     * 2. Method:
     *    - Point `scriptPath` to canonical `../web/agy_archive.js` (with optional `AGY_ARCHIVE_SCRIPT_PATH` env override for sandboxed tests).
     *    - Add `action === 'offload'` (`--all` or `<uuid>`) and `action === 'restore'` (`<uuid>`) invoking `agy_archive.js` with `--json`.
     * 3. Caveat:
     *    - Keep canonical `../web/agy_archive.js` fallback intact for production runtime after draft merge.
     *    - Large archive transfers over `rclone` may take several minutes; `timeout` is set to 10 minutes.
     */
    const scriptPath = process.env.AGY_ARCHIVE_SCRIPT_PATH || path.join(__dirname, '..', 'web', 'agy_archive.js');

    let args = [];
    const expectsJson = action === 'lookup' || action === 'offload' || action === 'restore';

    if (action === 'lookup') {
        if (!title) {
            return { error: 'Missing title parameter for lookup' };
        }
        args = [scriptPath, 'lookup', titleB64];
    } else if (action === 'offload') {
        if (offloadAll) {
            args = [scriptPath, 'offload', '--all', '--json'];
        } else {
            if (!uuid) {
                return { error: 'Missing uuid parameter for offload (or pass all=true)' };
            }
            if (!/^[a-f0-9\-]+$/i.test(uuid)) {
                return { error: 'Invalid uuid format' };
            }
            args = [scriptPath, 'offload', uuid, '--json'];
        }
    } else if (action === 'restore') {
        if (!uuid) {
            return { error: 'Missing uuid parameter for restore' };
        }
        if (!/^[a-f0-9\-]+$/i.test(uuid)) {
            return { error: 'Invalid uuid format' };
        }
        args = [scriptPath, 'restore', uuid, '--json'];
    } else if (action === 'shallow' || action === 'deep') {
        if (!uuid) {
            return { error: 'Missing uuid parameter' };
        }
        if (!/^[a-f0-9\-]+$/i.test(uuid)) {
            return { error: 'Invalid uuid format' };
        }
        const modeFlag = action === 'deep' ? '--deep' : '--shallow';
        args = [scriptPath, 'clean', modeFlag, uuid, titleB64, projectB64];
        if (action === 'deep') {
            if (query.purgeParent === true || query.purgeParent === 'true') {
                args.push('--purge-parent');
            }
            if (query.noAutoOffload === true || query.noAutoOffload === 'true') {
                args.push('--no-auto-offload');
            }
        }
    } else {
        return { error: `Unsupported action: ${action}` };
    }

    return new Promise((resolve) => {
        execFile(process.execPath, args, {
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 610000
        }, (error, stdout, stderr) => {
            if (expectsJson) {
                const trimmed = (stdout || '').trim();
                if (trimmed) {
                    try {
                        resolve(JSON.parse(trimmed));
                        return;
                    } catch (e) {
                        if (!error) {
                            resolve({ success: false, error: `Failed to parse ${action} JSON output`, output: stdout, stderr });
                            return;
                        }
                    }
                }
                if (error) {
                    resolve({ success: false, error: error.message, stderr });
                } else {
                    resolve({ success: false, error: `Empty output from ${action}`, stderr });
                }
            } else {
                if (error) {
                    resolve({ success: false, error: error.message, stderr });
                } else {
                    resolve({ success: true, output: stdout });
                }
            }
        });
    });
};
