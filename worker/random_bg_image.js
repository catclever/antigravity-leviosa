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
                        allImages.push(fullPath);
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

        // Clear old cache files
        const webDir = path.join(__dirname, '../web');
        const webFiles = fs.readdirSync(webDir);
        for (const f of webFiles) {
            if (f.startsWith('bg_cache.')) {
                try { fs.unlinkSync(path.join(webDir, f)); } catch (e) {}
            }
        }

        // Copy file to web directory so Taichi's file server can serve it directly
        const extWithDot = path.extname(randomImage).toLowerCase();
        const cacheFilename = 'bg_cache' + extWithDot;
        const targetPath = path.join(webDir, cacheFilename);
        
        fs.copyFileSync(randomImage, targetPath);

        const imageUrl = `http://127.0.0.1:9216/src/apps/com.google.antigravity/web/${cacheFilename}?t=${Date.now()}`;

        return { success: true, image: imageUrl, source: randomImage };
    } catch (e) {
        log(`Error: ${e.message}`);
        return { success: false, error: e.message };
    }
};
