// topbar_color.js
import { fetchThemeColor, getLuminance } from './api.js';
import { extractActiveProjectName } from './project_opener.js';

const TOPBAR_BG_VAR = "--topbar-bg-color";
const TOPBAR_TEXT_VAR = "--topbar-text-color";
let currentProject = "";

async function syncTopbarTheme(projectName) {
    const color = await fetchThemeColor(projectName);
    if (color) {
        document.documentElement.style.setProperty(TOPBAR_BG_VAR, `color-mix(in srgb, ${color} 90%, transparent)`);
        const luminance = getLuminance(color);
        document.documentElement.style.setProperty(TOPBAR_TEXT_VAR, luminance > 0.6 ? '#4b5563' : '#e5e7eb');
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
         * 4. SPA Bug: React route changes (like navigating to "New Chat") can wipe document.documentElement.style, losing CSS variables. We now use MutationObserver to detect variable loss and restore them, while gracefully handling "New Chat" empty DOM states by falling back to currentProject and adding open-editor buttons to the CSS selector.
        /* 智能追踪特征选择器（兼容旧版备选） */
        :is(
            div.shrink-0[style*="app-region: drag"],
            div.select-none.justify-between[style*="app-region: drag"],
            div.select-none.justify-between:has(button[data-testid="titlebar-more-actions"]),
            div.select-none.justify-between:has(span[data-testid="breadcrumb-segment"]),
            div.flex.justify-between:has([data-testid^="open-editor"]),
            div.flex.justify-between:has([data-testid="install-editor"]),
            div.border-b:has(button[data-tab-id="overview"]),
            div[data-active-tab-id],
            header, [data-test-id="chat-header"], .top-bar-class,
            div:has(> button[data-testid="close-aux-pane"])
        ) {
            background-color: var(--topbar-bg-color, transparent) !important;
            color: var(--topbar-text-color, inherit) !important;
            
            /* Material 3 & Web Components Shadow DOM 穿透变量 */
            --md-icon-color: var(--topbar-text-color) !important;
            --md-icon-button-icon-color: var(--topbar-text-color) !important;
            --md-sys-color-on-surface: var(--topbar-text-color) !important;
            --md-sys-color-on-surface-variant: var(--topbar-text-color) !important;
            --md-sys-color-primary: var(--topbar-text-color) !important;
            --gm3-sys-color-on-surface: var(--topbar-text-color) !important;
            --gm3-sys-color-on-surface-variant: var(--topbar-text-color) !important;
            --icon-color: var(--topbar-text-color) !important;

            transition: background-color 0.3s ease, color 0.3s ease;
        }

        /* 强制穿透：覆盖内部元素（span, button, svg 等）自带的 Tailwind 颜色，强制跟随 Topbar 变色 */
        :is(
            div.shrink-0[style*="app-region: drag"],
            div.select-none.justify-between[style*="app-region: drag"],
            div.select-none.justify-between:has(button[data-testid="titlebar-more-actions"]),
            div.select-none.justify-between:has(span[data-testid="breadcrumb-segment"]),
            div.flex.justify-between:has([data-testid^="open-editor"]),
            div.flex.justify-between:has([data-testid="install-editor"]),
            div.border-b:has(button[data-tab-id="overview"]),
            div[data-active-tab-id],
            header, [data-test-id="chat-header"], .top-bar-class,
            div:has(> button[data-testid="close-aux-pane"])
        ) *:not(#ag-dummy-bump-specificity):not([data-testid="app-update-button"]):not([data-testid="app-update-button"] *) {
            color: var(--topbar-text-color, inherit) !important;
        }

        /* 针对那些游离在主容器之外的独立顶栏按钮（侧边栏开关、前进后退、辅助面板开关等）进行硬匹配 */
        :is(
            button[data-testid="sidebar-toggle"],
            button[aria-label="Go Back"],
            button[aria-label="Go Forward"],
            button[data-testid="sidebar-search-button"],
            button[data-testid="toggle-aux-sidebar"],
            button#leviosa-pm-btn
        ),
        :is(
            button[data-testid="sidebar-toggle"],
            button[aria-label="Go Back"],
            button[aria-label="Go Forward"],
            button[data-testid="sidebar-search-button"],
            button[data-testid="toggle-aux-sidebar"],
            button#leviosa-pm-btn
        ) * {
            color: var(--topbar-text-color, inherit) !important;
        }
    `;
    document.head.appendChild(style);

    const checkAndSync = () => {
        // 如果提取不到项目名，回退使用已知的 currentProject，防止在新对话页面 UI 隐藏项目名时彻底失效
        const foundProject = extractActiveProjectName() || currentProject;
        
        // 检查 CSS 变量是否被 SPA 路由重置了（React 等框架在路由切换时可能会清空 html 的 inline style）
        const isVarMissing = foundProject && !document.documentElement.style.getPropertyValue(TOPBAR_BG_VAR);
        
        if (foundProject && (foundProject !== currentProject || isVarMissing)) {
            // 如果发现了新的项目，或者变量丢失了，则进行同步
            if (foundProject !== currentProject) {
                console.log(`[Antigravity] 识别到当前项目变化: ${foundProject}`);
            } else {
                console.log(`[Antigravity] SPA 路由切换导致主题变量丢失，尝试重新注入...`);
            }
            currentProject = foundProject;
            syncTopbarTheme(currentProject);
        }
    };

    const observer = new MutationObserver(checkAndSync);
    observer.observe(document.body, { childList: true, subtree: true });
    
    // 安全网：定期检查，防止 React 无缝路由（完全没有触发 body mutation，或在 mutation 后异步刷掉 style）
    setInterval(checkAndSync, 800);

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
