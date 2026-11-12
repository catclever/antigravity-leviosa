// project_dots.js
import { fetchThemeColor, getLuminance } from './api.js';

// 全局会话与项目映射缓存
const CONVO_PROJECT_CACHE = new Map();
const TITLE_PROJECT_CACHE = new Map();
let isCacheLoading = false;
let lastCacheFetchTime = 0;

/**
 * 预热与同步全局会话 ID -> 项目名映射表
 */
async function warmConvoProjectCache() {
    const now = Date.now();
    // 缓存 3 分钟有效期
    if (CONVO_PROJECT_CACHE.size > 0 && (now - lastCacheFetchTime < 180000)) {
        return;
    }
    if (isCacheLoading) return;
    isCacheLoading = true;

    try {
        const res = await fetch('http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/conversation_history_api?action=list&filter=all');
        const data = await res.json();
        if (data.success && Array.isArray(data.groups)) {
            for (const group of data.groups) {
                const proj = group.project;
                if (!proj) continue;
                for (const convo of group.conversations || []) {
                    if (convo.id) {
                        CONVO_PROJECT_CACHE.set(convo.id, proj);
                    }
                    if (convo.title) {
                        const t = convo.title.trim();
                        if (t && !TITLE_PROJECT_CACHE.has(t)) {
                            TITLE_PROJECT_CACHE.set(t, proj);
                        }
                    }
                }
            }
            lastCacheFetchTime = now;
        }
    } catch (err) {
        console.warn('⚠️ [Antigravity Mod] 预热会话项目映射缓存失败:', err);
    } finally {
        isCacheLoading = false;
    }
}

/**
 * 深度解析 Mention 选项中的真实项目名称
 */
function resolveProjectForMentionOption(optionEl) {
    // 1. 优先通过 React Fiber 树提取底层 item 对象与会话唯一 ID
    try {
        const innerRow = optionEl.querySelector('.flex.w-full') || optionEl;
        const fiberKey = Object.keys(innerRow).find(k => k.startsWith('__reactFiber$')) ||
                         Object.keys(optionEl).find(k => k.startsWith('__reactFiber$'));
        let fiber = (innerRow && innerRow[fiberKey]) || (optionEl && optionEl[fiberKey]);
        let depth = 0;

        while (fiber && depth < 10) {
            const item = fiber.memoizedProps?.item;
            if (item && item.item && item.item.scopeItem) {
                const scope = item.item.scopeItem;
                if (scope.case === 'conversation') {
                    const convoId = scope.value?.id;
                    const source = scope.value?.source;
                    // 如果 source 直接携带有效工作区名称（非 cli / cider / IDE 标记）
                    if (source && source !== 'cli' && source !== 'cider' && source !== 'IDE') {
                        return source;
                    }
                    if (convoId && CONVO_PROJECT_CACHE.has(convoId)) {
                        return CONVO_PROJECT_CACHE.get(convoId);
                    }
                }
                break;
            }
            fiber = fiber.return;
            depth++;
        }
    } catch (e) {}

    // 2. 降级兜底：通过标题文本进行模糊匹配
    const labelEl = optionEl.querySelector('[data-testid="menu-option-label"]');
    if (labelEl) {
        const titleText = labelEl.textContent.trim();
        if (titleText && TITLE_PROJECT_CACHE.has(titleText)) {
            return TITLE_PROJECT_CACHE.get(titleText);
        }
    }

    return null;
}

export function initProjectDots() {
    console.log('🎨 [Antigravity Mod] 初始化项目指示灯 (侧边栏 + Mention 提及面板)');

    const processedMentionItems = new WeakSet();

    // 启动时立即预热会话与项目映射缓存
    warmConvoProjectCache();

    /**
     * 1. 渲染侧边栏项目圆点（严格保持原本纯正主题色，不对指示灯做任何提亮篡改）
     */
    const renderSidebarDots = async () => {
        // 1. 现代侧边栏结构适配：通过 conversation-row-sidebar 与 data-subtext / text-sm 结构
        const rows = document.querySelectorAll('div[data-testid="conversation-row-sidebar"]');
        for (const row of rows) {
            // 如果行内已经存在指示灯，确保官方 svg 保持隐藏并跳过
            const existingDot = row.querySelector('.ag-project-dot');
            if (existingDot) {
                const svg = row.querySelector('svg[data-project-glyph], .flex.items-center.text-muted-foreground svg');
                if (svg && svg.style.display !== 'none') {
                    svg.style.display = 'none';
                }
                continue;
            }

            const subtext = row.getAttribute('data-subtext');
            // 如果明确标注为空字符串（该会话未关联项目），跳过
            if (subtext !== null && !subtext.trim()) continue;

            // 定位副标题容器：优先通过 data-project-glyph 图标父级定位，降级匹配 text-sm / text-xs 容器
            const sub = row.querySelector('svg[data-project-glyph]')?.parentElement
                     || row.querySelector('.text-sm.text-muted-foreground, .text-xs.text-muted-foreground');
            if (!sub) continue;

            const rawProject = (subtext && subtext.trim()) || sub.textContent.trim();
            if (!rawProject) continue;

            const projectPart = rawProject.includes('/') ? rawProject.split('/')[0].trim() : rawProject;

            // 顺手把官方新增的 svg 图标隐藏掉
            const svgIcon = sub.querySelector('svg');
            if (svgIcon && svgIcon.style.display !== 'none') {
                svgIcon.style.display = 'none';
            }

            // 防止异步等待期间重复注入
            if (sub.dataset.agDotLoading) continue;
            sub.dataset.agDotLoading = 'true';

            try {
                const color = await fetchThemeColor(projectPart);
                delete sub.dataset.agDotLoading;

                if (color) {
                    if (sub.querySelector('.ag-project-dot') || row.querySelector('.ag-project-dot')) continue;

                    const dot = document.createElement('span');
                    dot.className = 'ag-project-dot';
                    dot.style.cssText = `
                        display: inline-block;
                        flex-shrink: 0;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        margin-right: 2px;
                        background-color: ${color};
                        vertical-align: middle;
                        box-shadow: 0 0 3px rgba(0,0,0,0.3);
                    `;
                    sub.prepend(dot);
                }
            } catch (err) {
                delete sub.dataset.agDotLoading;
            }
        }

        // 2. 降级兼容：历史版本非 conversation-row-sidebar 包装的副标题
        const legacySubtitles = document.querySelectorAll('.text-xs.text-muted-foreground.truncate.text-left, div:not([data-testid="conversation-row-sidebar"]) > .text-xs.text-muted-foreground');
        for (const sub of legacySubtitles) {
            if (sub.closest('[data-testid="conversation-row-sidebar"]')) continue;
            if (sub.querySelector('.ag-project-dot')) continue;

            const text = sub.textContent.trim();
            if (!text) continue;

            const projectPart = text.includes('/') ? text.split('/')[0].trim() : text;

            const svgIcon = sub.querySelector('svg');
            if (svgIcon && svgIcon.style.display !== 'none') {
                svgIcon.style.display = 'none';
            }

            if (sub.dataset.agDotLoading) continue;
            sub.dataset.agDotLoading = 'true';

            try {
                const color = await fetchThemeColor(projectPart);
                delete sub.dataset.agDotLoading;

                if (color) {
                    if (sub.querySelector('.ag-project-dot')) continue;

                    const dot = document.createElement('span');
                    dot.className = 'ag-project-dot';
                    dot.style.cssText = `
                        display: inline-block;
                        flex-shrink: 0;
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        margin-right: 6px;
                        background-color: ${color};
                        vertical-align: middle;
                        transform: translateY(-1px);
                        box-shadow: 0 0 3px rgba(0,0,0,0.3);
                    `;
                    sub.prepend(dot);
                }
            } catch (err) {
                delete sub.dataset.agDotLoading;
            }
        }
    };

    /**
     * 2. 渲染 Mention 提及菜单中的指示灯与微型项目徽标
     */
    const renderMentionDots = async () => {
        const mentionMenu = document.querySelector('div[data-mention-menu]');
        if (!mentionMenu) return;

        // 若缓存未就绪，触发静默同步并继续尝试解析
        if (CONVO_PROJECT_CACHE.size === 0) {
            warmConvoProjectCache().then(() => {
                if (document.querySelector('div[data-mention-menu]')) {
                    renderMentionDots();
                }
            });
        }

        const options = mentionMenu.querySelectorAll('div[role="option"]');
        for (const opt of options) {
            if (processedMentionItems.has(opt)) continue;

            // 避免因 React 快速重新挂载导致重复渲染
            if (opt.querySelector('.ag-mention-project-dot')) {
                processedMentionItems.add(opt);
                continue;
            }

            const project = resolveProjectForMentionOption(opt);
            if (!project) continue;

            processedMentionItems.add(opt);

            const color = await fetchThemeColor(project);
            const row = opt.querySelector('.flex.w-full') || opt;
            if (!row) continue;

            if (row.querySelector('.ag-mention-project-dot')) continue;

            // A. 左侧：指示灯严格保持原本的项目真实颜色（不做任何全局颜色修改）
            const dot = document.createElement('span');
            dot.className = 'ag-mention-project-dot';
            dot.style.cssText = `
                display: inline-block;
                flex-shrink: 0;
                width: 7px;
                height: 7px;
                border-radius: 50%;
                margin-right: 3px;
                background-color: ${color || 'var(--primary, #3b82f6)'};
                box-shadow: 0 0 3px rgba(0,0,0,0.3);
                vertical-align: middle;
            `;

            const labelEl = row.querySelector('[data-testid="menu-option-label"]');
            if (labelEl) {
                labelEl.parentElement.insertBefore(dot, labelEl);
            } else {
                row.prepend(dot);
            }

            // B. 右侧微型项目徽标：仅对 Badge 的文字进行独立对比度保障，不影响任何指示灯
            if (!row.querySelector('.ag-mention-project-badge')) {
                const badge = document.createElement('span');
                badge.className = 'ag-mention-project-badge';
                badge.textContent = project;
                badge.title = `Project: ${project}`;

                const lum = getLuminance(color);
                // 仅当颜色过暗（如 HollyShit #121a21, EnginEdge #1a2b4c）导致文字融入背景看不见时，
                // 单独将 Badge 内部文字使用浅白微调，明亮主题色则继续保持纯正色彩
                const textColor = (!color || lum < 0.45)
                    ? `color-mix(in srgb, ${color || '#ffffff'} 25%, #f1f5f9)`
                    : color;
                const bgColor = color
                    ? `color-mix(in srgb, ${color} 35%, rgba(255, 255, 255, 0.06))`
                    : 'rgba(255, 255, 255, 0.08)';
                const borderColor = color
                    ? `color-mix(in srgb, ${color} 55%, rgba(255, 255, 255, 0.22))`
                    : 'rgba(255, 255, 255, 0.18)';

                badge.style.cssText = `
                    margin-left: auto;
                    flex-shrink: 0;
                    font-size: 10px;
                    line-height: 1.1;
                    padding: 2px 7px;
                    border-radius: 9999px;
                    color: ${textColor};
                    background-color: ${bgColor};
                    border: 1px solid ${borderColor};
                    font-weight: 500;
                    letter-spacing: 0.02em;
                    pointer-events: none;
                    max-width: 130px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                `;
                row.appendChild(badge);
            }
        }
    };

    const renderAll = () => {
        renderSidebarDots();
        if (document.querySelector('div[data-mention-menu]')) {
            renderMentionDots();
        }
    };

    let rafId = null;
    const scheduleRender = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = null;
            renderAll();
        });
    };

    const observer = new MutationObserver(() => {
        scheduleRender();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(renderAll, 500);
    setTimeout(renderAll, 1500);
}
