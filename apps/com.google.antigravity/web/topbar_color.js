// topbar_color.js
import { fetchThemeColor, getLuminance } from './api.js';

const TOPBAR_BG_VAR = "--topbar-bg-color";
const TOPBAR_TEXT_VAR = "--topbar-text-color";
let currentProject = "";

/*
 * [Bug Fix Document]
 * 1. Problem: When the main titlebar is empty, the project name is missing, leading to the color not being fetched or updated.
 * 2. Method: Added a fallback selector `span.truncate.flex-1.min-w-0` to extract the project name from the sidebar if it's missing from the main titlebar.
 * 3. Caveat: If the sidebar UI structure changes, this fallback will fail. We rely on the specific class structure of the sidebar item.
 */
function extractActiveProjectName() {
    // 1. 优先尝试从顶部标题栏提取
    const spans = document.querySelectorAll('span.truncate.inline-block');
    for (let span of spans) {
        const parent = span.parentElement;
        if (parent) {
            const nextSibling = parent.nextElementSibling;
            if (nextSibling && nextSibling.textContent.trim() === '/') {
                return span.textContent.trim();
            }
        }
    }

    // 2. 备选：从侧边栏等位置提取（应对标题栏为空时）
    const fallbackSpan = document.querySelector('span.truncate.flex-1.min-w-0');
    if (fallbackSpan) {
        return fallbackSpan.textContent.trim();
    }

    return null;
}

async function syncTopbarTheme(projectName) {
    const color = await fetchThemeColor(projectName);
    if (color) {
        document.documentElement.style.setProperty(TOPBAR_BG_VAR, `color-mix(in srgb, ${color} 90%, transparent)`);
        const luminance = getLuminance(color);
        document.documentElement.style.setProperty(TOPBAR_TEXT_VAR, luminance > 0.6 ? '#1a1a1a' : '#ffffff');
    } else {
        document.documentElement.style.setProperty(TOPBAR_BG_VAR, 'transparent');
        document.documentElement.style.setProperty(TOPBAR_TEXT_VAR, 'inherit');
    }
}

export function initTopbar() {
    // 注入顶栏变色的 CSS 样式
    const style = document.createElement('style');
    style.textContent = `
        /*
         * [Bug Fix Document]
         * 1. Problem: The previous CSS selectors targeting the topbar were extremely fragile (e.g., #root > div...) and broke when the DOM structure updated. Furthermore, relying purely on buttons failed when the titlebar was empty.
         * 2. Method: Replaced fragile DOM paths with robust characteristic-based selectors using :has() and [style*="app-region: drag"] to capture the structural layout directly.
         * 3. Caveat: If the application removes or alters these specific attributes (data-testid, app-region), the topbar will lose its customized background color again.
         */
        /* 智能追踪特征选择器（兼容旧版备选） */
        div.shrink-0[style*="app-region: drag"],
        div.select-none.justify-between[style*="app-region: drag"],
        div.select-none.justify-between:has(button[data-testid="titlebar-more-actions"]),
        div.border-b:has(button[data-tab-id="overview"]),
        header, [data-test-id="chat-header"], .top-bar-class,
        div:has(> button[data-testid="close-aux-pane"]) {
            background-color: var(--topbar-bg-color, transparent) !important;
            color: var(--topbar-text-color, inherit) !important;
            transition: background-color 0.3s ease, color 0.3s ease;
        }
    `;
    document.head.appendChild(style);

    const observer = new MutationObserver(() => {
        const foundProject = extractActiveProjectName();
        if (foundProject && foundProject !== currentProject) {
            console.log(`[Antigravity] 识别到当前项目: ${foundProject}`);
            currentProject = foundProject;
            syncTopbarTheme(currentProject);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        const p = extractActiveProjectName();
        if (p) {
            console.log(`[Antigravity] 初始化识别到项目: ${p}`);
            currentProject = p;
            syncTopbarTheme(p);
        } else {
            console.log(`[Antigravity] 未能在顶部栏找到项目名，请检查提取逻辑！`);
        }
    }, 1500);
}
