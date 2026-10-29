/**
 * Antigravity Local File Read/Write API
 * Path: worker/antigravity_file_api.js
 * 
 * Provides atomic read, chunked write, and validation for local workspace files.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// In-memory chunk buffer for large writes: uploadId -> { path, chunks, total, timestamp }
const CHUNK_SESSIONS = new Map();

// Periodic cleanup of stale chunk sessions older than 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of CHUNK_SESSIONS.entries()) {
        if (now - session.timestamp > 5 * 60 * 1000) {
            CHUNK_SESSIONS.delete(id);
        }
    }
}, 60 * 1000).unref();

function resolveHome(filepath) {
    if (!filepath) return '';
    if (filepath.startsWith('~/') || filepath === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
}

const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svgz',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.exe', '.dylib', '.so', '.dll', '.bin', '.wasm',
    '.mp3', '.mp4', '.mov', '.wav', '.flac', '.ogg',
    '.woff', '.woff2', '.ttf', '.eot', '.otf'
]);

module.exports = async function(query = {}) {
    const action = query.action || 'read';
    let rawPath = query.path || '';

    // URL decode if needed
    try {
        if (rawPath.includes('%')) {
            rawPath = decodeURIComponent(rawPath);
        }
    } catch (e) {}

    // Strip file:// prefix if present
    if (rawPath.startsWith('file://')) {
        rawPath = rawPath.replace(/^file:\/\//, '');
    }

    const filePath = path.resolve(resolveHome(rawPath));

    switch (action) {
        case 'stat':
        case 'validate': {
            if (!rawPath) {
                return { success: false, error: 'Missing path' };
            }
            if (!fs.existsSync(filePath)) {
                return { success: false, error: 'File does not exist', path: filePath };
            }
            try {
                const stat = fs.statSync(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const isBinary = BINARY_EXTENSIONS.has(ext);
                return {
                    success: true,
                    path: filePath,
                    isFile: stat.isFile(),
                    size: stat.size,
                    mtime: stat.mtimeMs,
                    isBinary
                };
            } catch (e) {
                return { success: false, error: e.message, path: filePath };
            }
        }

        case 'read': {
            if (!rawPath) {
                return { success: false, error: 'Missing path' };
            }
            if (!fs.existsSync(filePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }
            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) {
                    return { success: false, error: `Path is not a regular file: ${filePath}` };
                }

                const ext = path.extname(filePath).toLowerCase();
                if (BINARY_EXTENSIONS.has(ext)) {
                    return { success: false, error: `Binary file cannot be edited: ${ext}`, isBinary: true };
                }

                // Protect against massive files (limit 5MB for inline edit)
                if (stat.size > 5 * 1024 * 1024) {
                    return { success: false, error: `File too large for inline edit (${Math.round(stat.size / 1024)}KB > 5MB)` };
                }

                const rawBuf = fs.readFileSync(filePath);
                let content = '';

                // 1. 兼容 UTF-8 带 BOM 文件 (0xEF, 0xBB, 0xBF)
                if (rawBuf.length >= 3 && rawBuf[0] === 0xEF && rawBuf[1] === 0xBB && rawBuf[2] === 0xBF) {
                    content = new TextDecoder('utf-8').decode(rawBuf.subarray(3));
                } else {
                    // 2. 严格尝试标准 UTF-8 解码
                    try {
                        content = new TextDecoder('utf-8', { fatal: true }).decode(rawBuf);
                    } catch (e) {
                        // 3. 中文 Windows/老旧系统常见 GBK / GB18030 自动降级解析
                        try {
                            content = new TextDecoder('gbk').decode(rawBuf);
                        } catch (e2) {
                            content = new TextDecoder('utf-8').decode(rawBuf);
                        }
                    }
                }

                return {
                    success: true,
                    path: filePath,
                    content,
                    mtime: stat.mtimeMs,
                    size: stat.size,
                    ext
                };
            } catch (e) {
                return { success: false, error: e.message, path: filePath };
            }
        }

        case 'write': {
            if (!rawPath) {
                return { success: false, error: 'Missing path' };
            }

            let content = '';
            if (typeof query.content_b64 === 'string') {
                // 关键修复：URL query 中的 '+' 会被某些中间件或 querystring 解析为空格，必须还原恢复 Base64 字节流！
                const cleanB64 = query.content_b64.replace(/ /g, '+');
                content = Buffer.from(cleanB64, 'base64').toString('utf-8');
            } else if (typeof query.content === 'string') {
                try {
                    content = decodeURIComponent(query.content);
                } catch (e) {
                    content = query.content;
                }
            } else {
                return { success: false, error: 'Missing content parameter' };
            }

            try {
                // Ensure parent directory exists
                const parentDir = path.dirname(filePath);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }

                // Write file atomically
                fs.writeFileSync(filePath, content, 'utf-8');
                const stat = fs.statSync(filePath);

                return {
                    success: true,
                    path: filePath,
                    mtime: stat.mtimeMs,
                    size: stat.size
                };
            } catch (e) {
                return { success: false, error: e.message, path: filePath };
            }
        }

        case 'write_chunk': {
            const uploadId = query.upload_id;
            const index = parseInt(query.index, 10);
            const total = parseInt(query.total, 10);

            if (!uploadId || isNaN(index) || isNaN(total)) {
                return { success: false, error: 'Invalid chunk parameters' };
            }

            // 关键修复：分块收集原始 Base64 字符串（还原空格为加号），严禁单块提前解码成 UTF-8！
            // 单块提前解码会导致跨分块边界的多字节中文字符（3字节）被截断破坏为乱码符号(U+FFFD)！
            let chunkB64 = '';
            if (typeof query.chunk_b64 === 'string') {
                chunkB64 = query.chunk_b64.replace(/ /g, '+');
            } else if (typeof query.chunk === 'string') {
                chunkB64 = Buffer.from(decodeURIComponent(query.chunk), 'utf-8').toString('base64');
            }

            let session = CHUNK_SESSIONS.get(uploadId);
            if (!session) {
                session = {
                    path: filePath,
                    chunks: new Array(total),
                    received: 0,
                    total,
                    timestamp: Date.now()
                };
                CHUNK_SESSIONS.set(uploadId, session);
            }

            if (session.chunks[index] === undefined) {
                session.chunks[index] = chunkB64;
                session.received++;
            }
            session.timestamp = Date.now();

            if (session.received >= session.total) {
                CHUNK_SESSIONS.delete(uploadId);
                // 完整拼装所有分块后再整体以 UTF-8 解码，确保多字节字符 100% 完整无损！
                const fullBase64 = session.chunks.join('');
                const fullContent = Buffer.from(fullBase64, 'base64').toString('utf-8');
                try {
                    const parentDir = path.dirname(session.path);
                    if (!fs.existsSync(parentDir)) {
                        fs.mkdirSync(parentDir, { recursive: true });
                    }
                    fs.writeFileSync(session.path, fullContent, 'utf-8');
                    const stat = fs.statSync(session.path);
                    return {
                        success: true,
                        path: session.path,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                        done: true
                    };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }

            return {
                success: true,
                received: session.received,
                total: session.total,
                done: false
            };
        }

        default:
            return { success: false, error: `Unknown action: ${action}` };
    }
};
