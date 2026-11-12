// api.js
const L2_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1小时的内部 L2 缓存

// 【注意】如果你通过 TaiChi 暴露的端口不是 9216 或者路径不同，请在这里修改！
const API_ENDPOINT = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_theme_sync'; 
const PROJECT_PERM_API_ENDPOINT = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/project_permissions_api';
const KITTY_API_ENDPOINT = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_kitty_api';

/**
 * Bug Fix & Enhancement Documentation:
 * 1. Problem Fixed:
 *    Frontend previously had no method to check if Kitty terminal is installed on the host machine.
 *    Without this probe, UI components (quick-send buttons on codeblocks and text selections)
 *    would appear and invite clicks that always fail on machines without Kitty installed.
 * 2. Resolution Method:
 *    Implemented `checkKittyInstalled(forceRefresh = false)` with module-level memory cache `kittyInstalledCache`.
 *    Calls `${KITTY_API_ENDPOINT}?action=status`. If backend reports `data.installed === false`, caches `false`
 *    and returns `false`. If `data.success && data.installed !== false`, caches `true` and returns `true`.
 *    Network or server errors safely fall back to `false` without throwing.
 * 3. Caveats & Subsequent Development:
 *    Call with `forceRefresh = true` to re-probe backend if the user installs Kitty during an active session.
 */
let kittyInstalledCache = null;

export async function checkKittyInstalled(forceRefresh = false) {
    if (!forceRefresh && kittyInstalledCache !== null) {
        return kittyInstalledCache;
    }
    try {
        const response = await fetch(`${KITTY_API_ENDPOINT}?action=status`);
        const data = await response.json();
        if (data && data.installed === false) {
            kittyInstalledCache = false;
            return false;
        }
        if (data && data.success && data.installed !== false) {
            kittyInstalledCache = true;
            return true;
        }
        kittyInstalledCache = false;
        return false;
    } catch (err) {
        console.warn('[Antigravity Mod] 伴生 Kitty 安装检测请求失败', err);
        return false;
    }
}

export function _resetKittyInstalledCacheForTesting() {
    kittyInstalledCache = null;
}

function encodeUtf8ToBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    let binary = '';
    const chunkLen = 8192;
    for (let i = 0; i < bytes.length; i += chunkLen) {
        const slice = bytes.subarray(i, Math.min(i + chunkLen, bytes.length));
        for (let j = 0; j < slice.length; j++) {
            binary += String.fromCharCode(slice[j]);
        }
    }
    return btoa(binary);
}

export async function fetchThemeColor(projectName) {
    if (!projectName) return null;

    const now = Date.now();
    const cached = L2_CACHE.get(projectName);
    // L2 缓存拦截：如果 1 小时内请求过，直接走内存，连网关都不去
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        return cached.color;
    }

    try {
        const response = await fetch(`${API_ENDPOINT}?project=${encodeURIComponent(projectName)}`);
        const data = await response.json();
        
        if (data.success && data.color) {
            L2_CACHE.set(projectName, { color: data.color, timestamp: now });
            return data.color;
        } else {
            L2_CACHE.set(projectName, { color: null, timestamp: now });
            return null;
        }
    } catch (err) {
        console.warn(`[Antigravity Mod] 无法从 TaiChi 获取 ${projectName} 的颜色`, err);
    }
    return null;
}

export function getLuminance(hex) {
    if (!hex) return 0;
    let r, g, b;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    if (hex.length >= 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    return 0;
}

export async function openProjectBackend(projectName, appName, supportsWorkspace, uuid = null) {
    if (!projectName) {
        alert("⚠️ Antigravity: 无法获取当前项目名称，请确认你在某个项目目录中！");
        return;
    }
    try {
        const url = `http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_open_project?project=${encodeURIComponent(projectName)}&app=${encodeURIComponent(appName)}&supportsWorkspace=${supportsWorkspace}${uuid ? `&uuid=${encodeURIComponent(uuid)}` : ''}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.success) {
            console.error('[Antigravity Mod] 打开项目失败:', data.error);
            alert(`⚠️ Antigravity 打开失败:\n${data.error || '未知错误'}\n项目: ${projectName}\nApp: ${appName}\n命令: ${data.command || ''}`);
        } else {
            console.log(`[Antigravity Mod] 成功在 ${appName} 中打开项目: ${projectName}`);
        }
    } catch (err) {
        console.error(`[Antigravity Mod] 调用后端打开项目失败`, err);
        alert(`⚠️ Antigravity 请求后台失败！Taichi服务是否在 9216 端口运行？\n${err.message}`);
    }
}

export async function fetchKnowledgeIndex(projectName, scope = 'all') {
    try {
        const url = `http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_knowledge_index?project=${encodeURIComponent(projectName || '')}&scope=${encodeURIComponent(scope)}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.success && data.rules) {
            return data.rules;
        }
    } catch (err) {
        console.error(`[Antigravity Mod] 获取项目知识库列表失败`, err);
    }
    return [];
}

export async function openFileInFinderBackend(projectName, filePath, absolutePath = '') {
    if (!projectName && !absolutePath) return;
    try {
        const url = `http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_open_file_in_finder?project=${encodeURIComponent(projectName || '')}&file=${encodeURIComponent(filePath || '')}&fullPath=${encodeURIComponent(absolutePath || '')}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.success) {
            console.error('[Antigravity Mod] 在 Finder 中打开文件失败:', data.error);
        } else {
            console.log(`[Antigravity Mod] 成功在 Finder 中打开文件: ${absolutePath || filePath}`);
        }
    } catch (err) {
        console.error(`[Antigravity Mod] 调用后端打开文件失败`, err);
    }
}

export async function fetchProjectPermissions(projectId = '', projectName = '') {
    try {
        const params = new URLSearchParams({
            action: 'get',
            nocache: '1',
            _t: String(Date.now())
        });
        if (projectId) params.set('projectId', projectId);
        if (projectName) params.set('projectName', projectName);
        const response = await fetch(`${PROJECT_PERM_API_ENDPOINT}?${params.toString()}`);
        return await response.json();
    } catch (err) {
        console.error('[Antigravity Mod] 获取项目级权限配置失败', err);
        return { success: false, error: err.message };
    }
}

export async function saveProjectPermissions(payload) {
    try {
        const safePayload = payload || {};
        const jsonStr = JSON.stringify(safePayload);
        const b64Url = encodeUtf8ToBase64(jsonStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const params = new URLSearchParams({
            action: 'save',
            nocache: '1',
            _t: String(Date.now()),
            payload_b64: b64Url
        });
        if (safePayload.projectId) params.set('projectId', String(safePayload.projectId));
        if (safePayload.projectName) params.set('projectName', String(safePayload.projectName));
        const response = await fetch(`${PROJECT_PERM_API_ENDPOINT}?${params.toString()}`);
        return await response.json();
    } catch (err) {
        console.error('[Antigravity Mod] 保存项目级权限配置失败', err);
        return { success: false, error: err.message };
    }
}

export async function sendToKittyCompanion({
    action = 'send',
    command = '',
    project = '',
    uuid = '',
    cwd = '',
    execute = false,
    cleanPrompt = true,
    requireExplicitMultiDir = false
} = {}) {
    try {
        const b64 = encodeUtf8ToBase64(command);
        const baseMeta = {
            project: project || '',
            uuid: uuid || '',
            cwd: cwd || '',
            execute: execute ? 'true' : 'false',
            clean_prompt: cleanPrompt ? 'true' : 'false',
            requireExplicitMultiDir: requireExplicitMultiDir ? '1' : '0'
        };

        if (b64.length <= 4000 || action !== 'send') {
            const params = new URLSearchParams({
                action,
                ...baseMeta,
                cmd_b64: b64
            });
            const response = await fetch(`${KITTY_API_ENDPOINT}?${params.toString()}`);
            return await response.json();
        }

        const chunkSize = 3500;
        const total = Math.ceil(b64.length / chunkSize);
        const uploadId = `kitty_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        let finalRes = null;

        for (let index = 0; index < total; index++) {
            const chunkB64 = b64.substring(index * chunkSize, (index + 1) * chunkSize);
            const params = new URLSearchParams({
                action: 'send_chunk',
                upload_id: uploadId,
                index: String(index),
                total: String(total),
                chunk_b64: chunkB64,
                ...baseMeta
            });
            const response = await fetch(`${KITTY_API_ENDPOINT}?${params.toString()}`);
            finalRes = await response.json();
            if (finalRes && finalRes.success === false) {
                return finalRes;
            }
        }

        return finalRes || { success: false, error: 'Empty chunk response' };
    } catch (err) {
        console.error('[Antigravity Mod] 调用伴生 Kitty API 失败', err);
        return { success: false, error: err?.message || '无法连接伴生 Kitty 服务' };
    }
}
