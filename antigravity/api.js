// api.js
const L2_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1小时的内部 L2 缓存

// 【注意】如果你通过 TaiChi 暴露的端口不是 9216 或者路径不同，请在这里修改！
const API_ENDPOINT = 'http://127.0.0.1:9216/api/script/antigravity_theme_sync'; 

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

export async function openProjectBackend(projectName, appName, supportsWorkspace) {
    if (!projectName) {
        alert("⚠️ Antigravity: 无法获取当前项目名称，请确认你在某个项目目录中！");
        return;
    }
    try {
        const url = `http://127.0.0.1:9216/api/script/antigravity_open_project?project=${encodeURIComponent(projectName)}&app=${encodeURIComponent(appName)}&supportsWorkspace=${supportsWorkspace}`;
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
