#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const child_process = require('child_process');

const ARGS = process.argv.slice(2);
const SCRIPT_DIR = __dirname;
const ARCHIVES_DIR = path.join(SCRIPT_DIR, 'archives');
const INDEX_FILE = path.join(ARCHIVES_DIR, 'archive_index.json');
const WORKSPACE_ROOT = path.join(os.homedir(), '.gemini', 'antigravity');
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
            console.error('Failed to parse index file, initializing empty object.');
        }
    }
    return {};
}

function saveIndex(indexData) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
}

function updateIndex(uuid, entry) {
    const indexData = loadIndex();
    
    if (!indexData[uuid]) {
        indexData[uuid] = {
            title: entry.title || 'Unknown Title',
            project: entry.project || 'Unknown Project',
            shallowArchives: [],
            deepArchive: null
        };
    } else {
        if (entry.title && entry.title !== 'Unknown Title') indexData[uuid].title = entry.title;
        if (entry.project && entry.project !== 'Unknown Project') indexData[uuid].project = entry.project;
    }

    if (entry.type === 'shallow') {
        indexData[uuid].shallowArchives.push({
            timestamp: entry.timestamp,
            tarball: entry.tarball
        });
    } else if (entry.type === 'deep') {
        indexData[uuid].deepArchive = {
            timestamp: entry.timestamp,
            tarball: entry.deepTarball || entry.tarball
        };
    }
    
    saveIndex(indexData);
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

async function handleShallowClean(uuid, title, project, timestamp) {
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
    updateIndex(uuid, {
        type: 'shallow',
        title: title,
        project: project,
        timestamp: new Date().toISOString(),
        tarball: tarballPath
    });

    console.log(`✅ Shallow archive complete for ${uuid}.`);
    console.log(`📦 Saved to: ${tarballPath}`);
    console.log(`📝 Record updated in: ${INDEX_FILE}`);
}

async function main() {
    const command = ARGS[0];
    
    if (command !== 'lookup' && ARGS.length < 3) {
        console.log('Usage: node agy_archive.js clean --shallow <uuid>');
        process.exit(1);
    }
    const mode = ARGS[1];
    const uuid = ARGS[2];
    const title = ARGS[3] ? Buffer.from(ARGS[3], 'base64').toString('utf8') : '';
    const project = ARGS[4] ? Buffer.from(ARGS[4], 'base64').toString('utf8') : '';

    if (command === 'lookup') {
        const titleDecoded = ARGS[1] ? Buffer.from(ARGS[1], 'base64').toString('utf8') : '';
        const indexData = loadIndex();
        
        let foundUuid = null;
        let foundProject = null;

        // 根据标题精确匹配寻找 UUID
        for (const [uuid, entry] of Object.entries(indexData)) {
            if (entry.title && entry.title === titleDecoded) {
                foundUuid = uuid;
                foundProject = entry.project;
                break;
            }
        }

        // 2. 尝试从 agyhub_summaries_proto.pb 这个“真·数据库”里强行提取
        if (!foundUuid) {
            try {
                const summariesProtoPath = path.join(os.homedir(), '.gemini/antigravity/agyhub_summaries_proto.pb');
                if (fs.existsSync(summariesProtoPath)) {
                    const content = fs.readFileSync(summariesProtoPath, 'latin1'); // Use latin1 for binary safe string operations
                    let currentIndex = 0;
                    while ((currentIndex = content.indexOf(titleDecoded, currentIndex)) !== -1) {
                        // 向前后各找一段，防止 UUID 在前面或被其他文本打断
                        const start = Math.max(0, currentIndex - 50);
                        const end = Math.min(content.length, currentIndex + 200);
                        const chunk = content.substring(start, end);
                        const uuidMatch = chunk.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                        
                        // 过滤掉当前对话自身的 UUID（防止套娃匹配到自己的 summary）
                        if (uuidMatch && uuidMatch[0] !== process.env.QUERY_uuid) {
                            foundUuid = uuidMatch[0];
                            console.error(`[Archive Brain] 从 agyhub_summaries_proto.pb 成功反向提取到 UUID: ${foundUuid}`);
                            break;
                        }
                        currentIndex += titleDecoded.length;
                    }
                }
            } catch (err) {
                console.error('[Archive Brain] 读取 summaries_proto 失败:', err);
            }
        }

        if (foundUuid) {
            console.log(JSON.stringify({ success: true, uuid: foundUuid, project: foundProject }));
        } else {
            console.log(JSON.stringify({ success: false, error: '未能在账本中找到该对话记录' }));
        }
        process.exit(0);
    } else if (command === 'clean') {
        if (mode === '--shallow') {
            await handleShallowClean(uuid, title, project);
        } else if (mode === '--deep') {
            const timestamp = Date.now();
            const deepTarballName = `${uuid}_deep_${timestamp}.tar.gz`;
            const deepTarballPath = path.join(ARCHIVES_DIR, deepTarballName);

            // 先执行一遍兜底浅层清理
            console.log(`[Antigravity Mod] Deep Archive 开启 - 先执行兜底 Shallow Archive...`);
            try {
                await handleShallowClean(uuid, title, project);
            } catch (err) {
                console.log(`[Antigravity Mod] 浅层兜底失败，可能无需清理，继续深层打包...`);
            }

            console.log(`[Antigravity Mod] 开始执行深层全量打包 (Deep Archive)...`);
            
            const filesToTar = [];

            // 1. conversations 里的 .pb 文件
            const pbFilePath = path.join(WORKSPACE_ROOT, 'conversations', `${uuid}.pb`);
            if (fs.existsSync(pbFilePath)) {
                filesToTar.push(`conversations/${uuid}.pb`);
            }

            // 2. brain 里的核心产物 (task.md 等)
            const targetBrain = path.join(BRAIN_DIR, uuid);
            if (fs.existsSync(targetBrain)) {
                filesToTar.push(`brain/${uuid}`);
            }

            // 3. archives 里关于这个 uuid 的所有的 _shallow_ 压缩包
            const archiveFiles = fs.existsSync(ARCHIVES_DIR) ? fs.readdirSync(ARCHIVES_DIR) : [];
            const shallowTarballs = archiveFiles.filter(f => f.startsWith(`${uuid}_shallow_`) && f.endsWith('.tar.gz'));
            for (const file of shallowTarballs) {
                // Since we run tar from WORKSPACE_ROOT, and archives is outside WORKSPACE_ROOT,
                // Wait! archives is in ~/Library/Services/taichi/antigravity/archives
                // It is NOT in WORKSPACE_ROOT!
                // So we need to copy shallow tarballs to a temp location inside WORKSPACE_ROOT first, or pass absolute paths?
                // `tar -czf target -C root file1 -C root2 file2`
            }

            // A safer approach: run tar without -C, just provide absolute paths, and use `cd /` or handle paths.
            // Actually, we can use `tar -czf target -C ~/.gemini/antigravity conversations/<uuid>.pb brain/<uuid> -C ~/Library/Services/taichi/antigravity/archives <shallow_tarballs>`
            
            const tarArgs = ['-czf', deepTarballPath];
            if (fs.existsSync(pbFilePath)) tarArgs.push('-C', WORKSPACE_ROOT, `conversations/${uuid}.pb`);
            if (fs.existsSync(targetBrain)) tarArgs.push('-C', WORKSPACE_ROOT, `brain/${uuid}`);
            
            for (const file of shallowTarballs) {
                tarArgs.push('-C', ARCHIVES_DIR, file);
            }

            if (tarArgs.length <= 2) {
                console.error('[Antigravity Mod] Deep Archive 失败: 未找到任何可归档的文件。');
                process.exit(1);
            }

            try {
                console.log(`[Antigravity Mod] 运行 tar 命令...`, tarArgs.join(' '));
                child_process.execFileSync('tar', tarArgs);
                console.log(`[Antigravity Mod] Deep Archive 打包成功: ${deepTarballName}`);

                for (const file of shallowTarballs) {
                    fs.unlinkSync(path.join(ARCHIVES_DIR, file));
                    console.log(`[Antigravity Mod] 已删除合并的浅层压缩包: ${file}`);
                }

                const entry = {
                    type: 'deep',
                    title: title,
                    project: project,
                    timestamp: new Date().toISOString(),
                    deepTarball: deepTarballName
                };
                updateIndex(uuid, entry);
                
                console.log(`[Antigravity Mod] 深层归档记录已更新。前端将触发原生删除流程以清理底层数据库。`);
            } catch (error) {
                console.error('[Antigravity Mod] 深层归档打包失败:', error.message);
                process.exit(1);
            }
        } else {
            console.error(`Unsupported mode: ${mode}`);
            process.exit(1);
        }
    } else {
        console.log(`Unsupported command: ${command}`);
        process.exit(1);
    }
}

main();
