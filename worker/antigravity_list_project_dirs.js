const fs = require('fs');
const path = require('path');
const os = require('os');
const { findProjectDirByUUID } = require('./project_resolver');

module.exports = async function(query) {
    const uuid = query.uuid ? decodeURIComponent(query.uuid) : null;
    const projName = query.project ? decodeURIComponent(query.project) : null;
    const logFile = '/tmp/ag_list_dirs.log';
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] Received request: uuid=${uuid}, project=${projName}\n`);

    let paths = [];

    // 1. Try reading from projects JSON
    if (projName) {
        try {
            const projectsDir = path.join(os.homedir(), '.gemini/config/projects');
            fs.appendFileSync(logFile, `Checking projectsDir: ${projectsDir}\n`);
            if (fs.existsSync(projectsDir)) {
                const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'));
                fs.appendFileSync(logFile, `Found ${files.length} json files in projectsDir\n`);
                for (const f of files) {
                    try {
                        const content = fs.readFileSync(path.join(projectsDir, f), 'utf-8');
                        const data = JSON.parse(content);
                        if (data.name === projName) {
                            fs.appendFileSync(logFile, `Matched project name in file: ${f}\n`);
                            const resources = (data.projectResources && data.projectResources.resources) || [];
                            const extracted = resources.map(r => {
                                let uri = r.folderUri || (r.gitFolder && r.gitFolder.folderUri);
                                if (uri && uri.startsWith('file://')) {
                                    return decodeURIComponent(uri.substring(7));
                                }
                                return null;
                            }).filter(Boolean);
                            
                            fs.appendFileSync(logFile, `Extracted paths: ${JSON.stringify(extracted)}\n`);
                            if (extracted.length > 0) {
                                paths = extracted;
                                break;
                            }
                        }
                    } catch (e) {
                        fs.appendFileSync(logFile, `Error reading ${f}: ${e.message}\n`);
                    }
                }
            } else {
                fs.appendFileSync(logFile, `projectsDir does not exist!\n`);
            }
        } catch (e) {
            fs.appendFileSync(logFile, `Error in JSON reading block: ${e.message}\n`);
        }
    }

    // 2. Fallback to PB parsing
    if (paths.length === 0 && uuid) {
        fs.appendFileSync(logFile, `Falling back to PB parsing for UUID: ${uuid}\n`);
        paths = findProjectDirByUUID(uuid) || [];
    }

    fs.appendFileSync(logFile, `Returning paths: ${JSON.stringify(paths)}\n`);
    if (paths.length > 0) {
        return { success: true, paths: paths };
    } else {
        return { success: false, error: 'No paths found' };
    }
};
