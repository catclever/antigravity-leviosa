const fs = require('fs');
const path = require('path');

module.exports = async function(query) {
    const dirsParam = query.dirs ? decodeURIComponent(query.dirs) : '[]';
    let dirs = [];
    try {
        dirs = JSON.parse(dirsParam);
    } catch (e) {
        return { success: false, error: 'Invalid dirs parameter' };
    }

    if (!Array.isArray(dirs) || dirs.length === 0) {
        return { success: false, error: 'No directories specified' };
    }

    const logFile = '/tmp/ag_random_bg.log';
    const log = (msg) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);

    try {
        let allImages = [];
        const validExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

        for (const dir of dirs) {
            // Expand ~ to homedir if needed
            const resolvedDir = dir.startsWith('~') ? path.join(require('os').homedir(), dir.slice(1)) : dir;
            
            if (fs.existsSync(resolvedDir) && fs.statSync(resolvedDir).isDirectory()) {
                const files = fs.readdirSync(resolvedDir);
                for (const file of files) {
                    const ext = path.extname(file).toLowerCase();
                    if (validExtensions.includes(ext)) {
                        const fullPath = path.join(resolvedDir, file);
                        const stats = fs.statSync(fullPath);
                        if (stats.size <= 5 * 1024 * 1024) { // 5MB limit
                            allImages.push(fullPath);
                        } else {
                            log(`Skipped large image (>${Math.round(stats.size/1024/1024)}MB): ${file}`);
                        }
                    }
                }
            } else {
                log(`Directory not found or invalid: ${resolvedDir}`);
            }
        }

        if (allImages.length === 0) {
            return { success: false, error: 'No images found in specified directories' };
        }

        // Pick a random image
        const randomImage = allImages[Math.floor(Math.random() * allImages.length)];
        log(`Selected random image: ${randomImage}`);

        // Read file and convert to base64
        const imageBuffer = fs.readFileSync(randomImage);
        const ext = path.extname(randomImage).toLowerCase().substring(1);
        const mimeType = ext === 'jpg' ? 'jpeg' : ext;
        const base64Image = `data:image/${mimeType};base64,${imageBuffer.toString('base64')}`;

        return { success: true, image: base64Image, source: randomImage };
    } catch (e) {
        log(`Error: ${e.message}`);
        return { success: false, error: e.message };
    }
};
