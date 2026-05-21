// topbar_color.js
import { fetchThemeColor, getLuminance } from './api.js';

const TOPBAR_BG_VAR = "--topbar-bg-color";
const TOPBAR_TEXT_VAR = "--topbar-text-color";
let currentProject = "";

function extractActiveProjectName() {
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
        /* 合并你提供的两个复杂的选择器结构，以及保留基础备选 */
        header, [data-test-id="chat-header"], .top-bar-class,
        div:has(> button[data-testid="close-aux-pane"]),
        #root > div > div > div > div > div > div.h-screen.w-screen.flex.flex-col.bg-background.text-foreground > div > div > div:nth-child(2) > div > div.border-border.flex > div > div.flex-1.flex.flex-col.min-w-0.h-full > div.shrink-0,
        #root > div > div > div > div > div > div.h-screen.w-screen.flex.flex-col.bg-background.text-foreground > div > div > div.border-border.flex > div > div.h-full.w-full.flex.flex-col.pb-2.bg-sidebar > div.shrink-0.flex.items-center.pr-2.mb-3 {
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
