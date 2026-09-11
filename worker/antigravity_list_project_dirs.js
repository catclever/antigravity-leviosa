const fs = require('fs');
const path = require('path');
const os = require('os');
const { findProjectDirByUUID } = require('./project_resolver');

module.exports = async function(query) {
    const uuid = query.uuid ? decodeURIComponent(query.uuid) : null;
    const projName = query.project ? decodeURIComponent(query.project) : null;

    let paths = [];

    // 1. Try reading from projects JSON
    if (projName) {
        try {
            const projectsDir = path.join(os.homedir(), '.gemini/config/projects');
            if (fs.existsSync(projectsDir)) {
                const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'));
                for (const f of files) {
                    try {
                        const content = fs.readFileSync(path.join(projectsDir, f), 'utf-8');
                        const data = JSON.parse(content);
                        if (data.name === projName) {
                            const resources = (data.projectResources && data.projectResources.resources) || [];
                            const extracted = resources.map(r => {
                                let uri = r.folderUri || (r.gitFolder && r.gitFolder.folderUri);
                                if (uri && uri.startsWith('file://')) {
                                    return decodeURIComponent(uri.substring(7));
                                }
                                return null;
                            }).filter(Boolean);
                            if (extracted.length > 0) {
                                paths = extracted;
                                break;
                            }
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }

    // 2. Fallback to PB parsing
    if (paths.length === 0 && uuid) {
        paths = findProjectDirByUUID(uuid) || [];
    }

    if (paths.length > 0) {
        return { success: true, paths: paths };
    } else {
        return { success: false, error: 'No paths found' };
    }
};
