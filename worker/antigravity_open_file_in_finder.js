const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

module.exports = async function(query) {
    let fullPath = query.fullPath ? decodeURIComponent(query.fullPath) : '';

    if (!fullPath) {
        const project = query.project ? decodeURIComponent(query.project) : '';
        const file = query.file ? decodeURIComponent(query.file) : '';

        if (!project || !file) {
            return { success: false, error: 'Missing project, file, or fullPath parameter' };
        }

        const projectDir = findProjectDir(project);
        if (!projectDir) {
            return { success: false, error: 'Project directory not found', project };
        }

        fullPath = path.join(projectDir, file);
    }
    /*
     * [Bug Fix Document]
     * 1. Problem: Script execution failed because of a missing closing brace `}`. The file had invalid JavaScript syntax.
     * 2. Method: Added the missing `}` to properly close the `if (!fs.existsSync(fullPath))` block.
     * 3. Caveat: When adding comments or modifying logic, ensure block braces are balanced to avoid SyntaxErrors that crash the script.
     */
    if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File does not exist in project directory', fullPath };
    }
    /*
     * [Bug Fix Document]
     * 1. Problem: User reported that opening a directory in Finder failed to bring the window to the foreground, or opened it in a weird "Reveal" state instead of directly opening the directory.
     * 2. Method: Replaced `open -R` (Reveal) with `open` to match the exact behavior of the existing "Open In" feature, which correctly pops the directory window to the foreground.
     * 3. Caveat: If the path passed here is a file (not a directory), `open` will attempt to launch the file with its default application instead of opening the folder. The frontend must ensure it strips the filename and only passes the directory path if the goal is to view the folder.
     */
    // Use open to directly open the directory instead of revealing it in its parent
    const command = `open "${fullPath}"`;

    try {
        const { execSync } = require('child_process');
        execSync(command);
        return { success: true, command, fullPath };
    } catch (e) {
        return { success: false, error: e.message, command };
    }
};
