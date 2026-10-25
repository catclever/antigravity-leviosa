/**
 * web/history_view.js
 * 
 * Replicated Conversation History Central View + Sidebar Fallback Entry
 */

import { fetchThemeColor } from './api.js';

const API_BASE = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/conversation_history_api';

let isOpen = false;
let historyContainer = null;
let currentFilter = 'all'; // 'all' | 'active' | 'archived'
let currentGroupBy = 'project'; // 'project' | 'none'
let searchQuery = '';
let collapsedProjects = new Set();
let expandedArchivedProjects = new Set(); // 归档会话默认收起在分割线后
let layoutRafId = null;

// 项目真实主题色缓存 (仅保存来自 TaiChi / .vscode / Peacock 的真实主题色)
const PROJECT_COLOR_CACHE = new Map();

function getProjectColor(name) {
    if (!name || name === 'General') return null;
    if (PROJECT_COLOR_CACHE.has(name)) return PROJECT_COLOR_CACHE.get(name);

    // 异步从 TaiChi 主题服务获取项目真实专属色并热更新 DOM
    fetchThemeColor(name).then(themeColor => {
        PROJECT_COLOR_CACHE.set(name, themeColor || null);
        if (themeColor) {
            document.querySelectorAll(`[data-project-group="${escapeHtml(name)}"]`).forEach(card => {
                card.style.setProperty('border', `1.5px solid ${themeColor}aa`, 'important');
                card.style.setProperty('box-shadow', `0 0 12px ${themeColor}25, 0 4px 16px rgba(0, 0, 0, 0.2)`, 'important');
            });
            document.querySelectorAll(`[data-project-timeline-dot="${escapeHtml(name)}"]`).forEach(dot => {
                dot.style.backgroundColor = themeColor;
                dot.classList.remove('hidden');
            });
        }
    }).catch(() => {});

    return null;
}

export function initHistoryView() {
    console.log('⚡ [Antigravity Mod] 初始化 Conversation History ⚡ 复刻中心视图');

    // 1. 初始化中央主视图容器 (Singleton on document.body)
    ensureHistoryContainer();

    // 2. 持续监听 DOM 变化以注入侧边栏入口按钮 (遵循 dom-manipulation.md 规范)
    const observer = new MutationObserver(() => {
        injectSidebarButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 初次尝试注入
    injectSidebarButton();

    // 3. 监听全局事件 (点击新对话、侧边栏会话或 Esc 键时自动隐藏)
    setupGlobalEventListeners();
}

/**
 * 动态注入侧边栏历史入口按钮
 * 优先级 1: 紧跟在原生 [data-testid="history-button"] / a[href="/history"] 之后
 * 优先级 2 (降级): 紧跟在 [data-testid="new-conversation-button"] / a[href="/"] 之后
 */
function injectSidebarButton() {
    const origHistoryBtn = document.querySelector('[data-testid="history-button"], a[href="/history"]');
    const newConvBtn = document.querySelector('[data-testid="new-conversation-button"], a[href="/"]');

    // 隐藏官方原始历史按钮，由 Leviosa 入口完全接管
    if (origHistoryBtn) {
        origHistoryBtn.style.setProperty('display', 'none', 'important');
    }

    let targetAnchor = null;
    if (origHistoryBtn && origHistoryBtn.isConnected) {
        targetAnchor = origHistoryBtn;
    } else if (newConvBtn && newConvBtn.isConnected) {
        targetAnchor = newConvBtn;
    }

    if (!targetAnchor) return;

    let customBtn = document.getElementById('leviosa-history-button');

    const buttonHtml = `
        <span class="shrink-0 flex items-center">
            <!-- 官方原始历史时钟图标 -->
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor">
                <path d="M479.23-140q-129.92,0-226.46-85.54T141.62-440h61.23Q218-336.38 296.12-268.19T479.23-200q117,0 198.5-81.5T759.23-480t-81.5-198.5T479.23-760q-65.54,0-122.85,29.12t-98.69,80.11H362.31v60H159.23V-793.85h60v94.77q48.69-57.46 116.61-89.19T479.23-820q70.77,0 132.61,26.77t107.85,72.77t72.77,107.85T819.23-480T792.46-347.39T719.69-239.54T611.85-166.77T479.23-140ZM599.31-318.92L450.39-467.85V-680h60v187.85L641.46-361.08l-42.15,42.15Z"></path>
            </svg>
        </span>
        <span class="truncate text-sm flex-1 text-left">Conversation History <span class="text-amber-500 font-normal">⚡</span></span>
    `;

    // 如果按钮已存在，但位置不对或图标需热更新，则同步更新
    if (customBtn) {
        if (customBtn.previousElementSibling !== targetAnchor) {
            targetAnchor.insertAdjacentElement('afterend', customBtn);
        }
        if (!customBtn.querySelector('path[d^="M479.23"]')) {
            customBtn.innerHTML = buttonHtml;
        }
        return;
    }

    // 创建全新按钮
    customBtn = document.createElement('a');
    customBtn.id = 'leviosa-history-button';
    customBtn.setAttribute('data-testid', 'leviosa-history-button');
    customBtn.setAttribute('role', 'button');
    customBtn.setAttribute('tabindex', '0');
    customBtn.className = `inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer disabled:opacity-50 flex-grow w-full justify-start font-normal h-8 min-w-0 gap-1.5 px-2 py-1 rounded-lg bg-transparent text-secondary-foreground hover:bg-sidebar-muted hover:text-foreground`;

    customBtn.innerHTML = buttonHtml;

    customBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleHistoryView();
    });

    targetAnchor.insertAdjacentElement('afterend', customBtn);
}

/**
 * 创建/保证全局唯一的中央主视图挂载点
 */
function ensureHistoryContainer() {
    if (document.getElementById('leviosa-history-view')) {
        historyContainer = document.getElementById('leviosa-history-view');
        return;
    }

    // 动态注入历史大厅透明毛玻璃联动样式（对齐左侧边栏质感）
    const glassStyleId = 'leviosa-history-glass-style';
    if (!document.getElementById(glassStyleId)) {
        const style = document.createElement('style');
        style.id = glassStyleId;
        style.textContent = `
            #leviosa-history-view {
                background-image:
                    linear-gradient(color-mix(in srgb, var(--antigravity-theme-color, #1e1e1e) 75%, transparent), color-mix(in srgb, var(--antigravity-theme-color, #1e1e1e) 75%, transparent)),
                    linear-gradient(135deg, transparent 0%, rgba(0, 0, 0, 0.05) 40%),
                    var(--antigravity-bg) !important;
                background-size: cover !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
                background-attachment: fixed !important;
                background-color: transparent !important;
                backdrop-filter: blur(2px) !important;
                -webkit-backdrop-filter: blur(2px) !important;
                box-shadow: inset 1px 0 0 0 rgba(255, 255, 255, 0.05) !important;
            }

            #leviosa-sticky-header {
                background-color: transparent !important;
                background-image: none !important;
                backdrop-filter: blur(16px) !important;
                -webkit-backdrop-filter: blur(16px) !important;
            }

            .leviosa-project-group {
                background-color: color-mix(in srgb, var(--antigravity-theme-color, #1e1e1e) 45%, transparent) !important;
                backdrop-filter: blur(8px) !important;
                -webkit-backdrop-filter: blur(8px) !important;
                transition: border-color 0.25s ease, box-shadow 0.25s ease;
            }
            .leviosa-project-group:hover {
                filter: brightness(1.03);
            }

            #leviosa-history-list [data-leviosa-convo-id]:hover {
                background-color: rgba(255, 255, 255, 0.08) !important;
            }

            /* 隐藏官方原始历史按钮，由 Leviosa 历史入口无缝接管 */
            [data-testid="history-button"], a[href="/history"] {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    historyContainer = document.createElement('div');
    historyContainer.id = 'leviosa-history-view';
    Object.assign(historyContainer.style, {
        position: 'fixed',
        top: '40px',
        left: '256px',
        width: 'calc(100vw - 256px)',
        height: 'calc(100vh - 40px)',
        backgroundColor: 'transparent',
        zIndex: '60',
        display: 'none',
        flexDirection: 'column',
        alignItems: 'center',
        overflowY: 'auto'
    });

    historyContainer.innerHTML = `
        <div class="w-full max-w-2xl flex flex-col px-8 pb-8 pt-0">
            <!-- Sticky Header -->
            <div id="leviosa-sticky-header" class="sticky top-0 z-20 bg-background pt-8 pb-4 flex flex-col gap-4">
                <div class="flex items-center justify-between px-3">
                    <h1 class="text-lg font-medium text-foreground select-none m-0 flex items-center gap-2">
                        <span>Conversation History</span>
                        <span class="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-normal">Leviosa ⚡</span>
                    </h1>
                    <span id="leviosa-history-counter" class="text-xs text-muted-foreground">Loading...</span>
                </div>

                <!-- 搜索与筛选操作栏 -->
                <div class="flex items-center gap-2">
                    <div class="relative flex items-center h-8 grow rounded-lg bg-muted border border-border transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor" class="absolute left-2 text-muted-foreground">
                            <path d="M781.69-136.92L530.46-388.16q-30,24.77-69,38.77t-80.69,14q-102.46,0-173.54-71.08T136.16-580t71.08-173.54t173.54-71.08t173.54,71.08T625.38-580q0,42.85-14.38,81.85t-38.38,67.85L823.84-179.08l-42.15,42.15ZM380.77-395.38q77.31,0 130.96-53.65T565.39-580T511.73-710.96T380.77-764.62T249.81-710.96T196.15-580t53.65,130.96t130.96,53.65Z"></path>
                        </svg>
                        <input type="text" id="leviosa-history-search-input" placeholder="Search conversations..." class="w-full h-full select-none !pl-7 pr-3 placeholder:text-muted-foreground bg-transparent outline-none text-sm text-foreground rounded-md" value="">
                    </div>

                    <!-- 分组视图切换 (Projects / Timeline) -->
                    <button id="leviosa-groupby-btn" class="inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-muted border border-border text-secondary-foreground hover:text-foreground h-8 px-2.5 rounded-lg text-xs gap-1.5" title="Switch Grouping">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
                            <path d="M170-180q-29.15,0-49.58-20.42T100-250V-707.69q0-29.15 21.58-50.73T172.31-780H391.92l80,80H787.69q26.85,0 46.31,17.35T856.54-640H447.38l-80-80H172.31q-5.39,0-8.85,3.46T160-707.69v455.38q0,4.23 2.12,6.92t5.58,4.62L261-552.31H927.31L830.46-229.69q-6.85,22.54-25.65,36.11T763.08-180H170Zm60.54-60H770.77l75.46-252.31H306L230.54-240Zm0,0L306-492.31L230.54-240ZM160-640v-67.69q0-5.39 0-8.85t0-3.46v80Z"></path>
                        </svg>
                        <span id="leviosa-groupby-label">Projects</span>
                    </button>

                    <!-- 过滤选项菜单切换 (All / Active / Archived) -->
                    <button id="leviosa-filter-btn" class="inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-muted border border-border text-secondary-foreground hover:text-foreground h-8 px-2.5 rounded-lg text-xs gap-1.5" title="Filter Status">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 -960 960 960" fill="currentColor">
                            <path d="M411.15-260v-60H548.46v60H411.15Zm-155-190v-60H703.46v60H256.16ZM140-640v-60H820v60H140Z"></path>
                        </svg>
                        <span id="leviosa-filter-label">All</span>
                    </button>

                    <!-- 一键清理子代理按钮 -->
                    <button id="leviosa-clean-subagents-btn" class="inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-muted border border-border text-secondary-foreground hover:text-destructive hover:border-destructive/40 h-8 px-2.5 rounded-lg text-xs gap-1.5" title="Clean Subagents">
                        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                        <span id="leviosa-clean-subagents-label">Clean Subagents</span>
                    </button>

                    <!-- 刷新数据按钮 -->
                    <button id="leviosa-refresh-btn" class="inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 bg-muted border border-border text-secondary-foreground hover:text-foreground h-8 w-8 rounded-lg" title="Refresh">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 2v6h-6"></path>
                            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
                            <path d="M3 22v-6h6"></path>
                            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- 会话列表容器 -->
            <div id="leviosa-history-list" class="relative w-full flex flex-col gap-4 mt-2">
                <!-- 动态渲染项目分组与卡片 -->
            </div>
        </div>
    `;

    document.body.appendChild(historyContainer);

    // 绑定搜索输入防抖
    let debounceTimer = null;
    const searchInput = historyContainer.querySelector('#leviosa-history-search-input');
    searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchQuery = e.target.value.trim();
            fetchAndRenderHistory();
        }, 200);
    });

    // 绑定分组视图切换 (Projects <-> Timeline)
    const groupByBtn = historyContainer.querySelector('#leviosa-groupby-btn');
    const groupByLabel = historyContainer.querySelector('#leviosa-groupby-label');
    groupByBtn.addEventListener('click', () => {
        currentGroupBy = currentGroupBy === 'project' ? 'none' : 'project';
        groupByLabel.textContent = currentGroupBy === 'project' ? 'Projects' : 'Timeline';
        fetchAndRenderHistory();
    });

    // 绑定过滤状态循环切换 (All -> Active -> Archived -> All)
    const filterBtn = historyContainer.querySelector('#leviosa-filter-btn');
    const filterLabel = historyContainer.querySelector('#leviosa-filter-label');
    filterBtn.addEventListener('click', () => {
        if (currentFilter === 'all') currentFilter = 'active';
        else if (currentFilter === 'active') currentFilter = 'archived';
        else currentFilter = 'all';

        filterLabel.textContent = currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1);
        fetchAndRenderHistory();
    });

    // 绑定刷新按钮
    const refreshBtn = historyContainer.querySelector('#leviosa-refresh-btn');
    refreshBtn.addEventListener('click', () => {
        fetchAndRenderHistory();
    });

    // 绑定一键清理子代理按钮
    const cleanSubagentsBtn = historyContainer.querySelector('#leviosa-clean-subagents-btn');
    const cleanSubagentsLabel = historyContainer.querySelector('#leviosa-clean-subagents-label');
    if (cleanSubagentsBtn) {
        cleanSubagentsBtn.addEventListener('click', async () => {
            const confirmed = window.confirm('确定要清理所有后台 Subagent 目录与记录吗？\n将运行 clean_subagents.py 并释放子代理占用的数据。');
            if (!confirmed) return;

            cleanSubagentsBtn.disabled = true;
            cleanSubagentsLabel.textContent = 'Cleaning...';
            try {
                const res = await fetch(`${API_BASE}?action=clean_subagents&nocache=1`);
                const data = await res.json();
                if (data.success) {
                    cleanSubagentsLabel.textContent = 'Cleaned!';
                    setTimeout(() => {
                        cleanSubagentsLabel.textContent = 'Clean Subagents';
                        cleanSubagentsBtn.disabled = false;
                    }, 1500);
                    await fetchAndRenderHistory();
                } else {
                    alert('清理失败: ' + (data.error || '未知错误'));
                    cleanSubagentsLabel.textContent = 'Clean Subagents';
                    cleanSubagentsBtn.disabled = false;
                }
            } catch (e) {
                alert('网络请求失败: ' + e.message);
                cleanSubagentsLabel.textContent = 'Clean Subagents';
                cleanSubagentsBtn.disabled = false;
            }
        });
    }
}

/**
 * 动态自适应中央内容区物理边界
 * 严禁依赖 .sticky.top-0（防止被滚动的消息条带偏）
 */
function updateBounds() {
    if (!historyContainer) return;
    
    // 顶栏高度：检测拖拽栏属性 [style*="app-region: drag"]，稳定基准 40px
    const dragBar = document.querySelector('div.shrink-0[style*="app-region: drag"], [style*="app-region: drag"]');
    let top = 40;
    if (dragBar) {
        const r = dragBar.getBoundingClientRect();
        if (r.height > 20 && r.bottom > 20 && r.bottom < 80) {
            top = r.bottom;
        }
    }
    
    // 侧边栏宽度：检测侧边栏右边界，稳定基准 256px
    const sidebar = document.querySelector('nav, aside, [data-testid="sidebar"], .bg-sidebar');
    let left = 256;
    if (sidebar) {
        const r = sidebar.getBoundingClientRect();
        if (r.width > 150 && r.right > 150 && r.right < window.innerWidth * 0.5) {
            left = r.right;
        }
    }

    const width = Math.max(200, window.innerWidth - left);
    const height = Math.max(200, window.innerHeight - top);

    historyContainer.style.top = `${top}px`;
    historyContainer.style.left = `${left}px`;
    historyContainer.style.width = `${width}px`;
    historyContainer.style.height = `${height}px`;
}

function layoutLoop() {
    if (!isOpen) return;
    updateBounds();
    layoutRafId = requestAnimationFrame(layoutLoop);
}

/**
 * 切换中央主视图显示/隐藏
 */
export function toggleHistoryView(forceState = null) {
    isOpen = forceState !== null ? forceState : !isOpen;

    const customBtn = document.getElementById('leviosa-history-button');

    if (isOpen) {
        updateBounds();
        historyContainer.style.display = 'flex';
        if (customBtn) {
            customBtn.classList.remove('bg-transparent', 'text-secondary-foreground');
            customBtn.classList.add('bg-sidebar-secondary', 'text-foreground', 'font-medium');
        }
        layoutLoop();
        fetchAndRenderHistory();

        // 异步静默触发后台空白孤岛草稿清理（非阻塞，解耦渲染展示）
        fetch(`${API_BASE}?action=cleanup_empty`).catch(() => {});
    } else {
        if (historyContainer) historyContainer.style.display = 'none';
        if (customBtn) {
            customBtn.classList.remove('bg-sidebar-secondary', 'text-foreground', 'font-medium');
            customBtn.classList.add('bg-transparent', 'text-secondary-foreground');
        }
        if (layoutRafId) cancelAnimationFrame(layoutRafId);
    }
}

/**
 * 获取并渲染会话列表
 */
async function fetchAndRenderHistory() {
    if (!historyContainer) return;
    const listEl = historyContainer.querySelector('#leviosa-history-list');
    const counterEl = historyContainer.querySelector('#leviosa-history-counter');

    try {
        const url = `${API_BASE}?action=list&nocache=1&filter=${encodeURIComponent(currentFilter)}&search=${encodeURIComponent(searchQuery)}&groupBy=${encodeURIComponent(currentGroupBy)}`;
        const res = await fetch(url);
        const data = await res.json();

        if (!data.success) {
            listEl.innerHTML = `<div class="p-6 text-center text-sm text-destructive">加载失败: ${data.error}</div>`;
            return;
        }

        const totalActive = data.groups 
            ? data.groups.reduce((sum, g) => sum + g.conversations.filter(c => !c.archived).length, 0)
            : data.items.filter(c => !c.archived).length;
        const displayTotal = currentFilter === 'archived' ? data.total : totalActive;
        const totalSubagents = data.totalSubagents || 0;
        counterEl.innerHTML = `Total: <strong class="text-foreground">${displayTotal}</strong> conversations${totalSubagents > 0 ? ` <span class="text-muted-foreground/80 font-normal">(+${totalSubagents} subagents)</span>` : ''} (${data.groups.length} projects)`;

        if (data.total === 0) {
            listEl.innerHTML = `
                <div class="py-16 text-center flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-40">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M8 12h8"></path>
                    </svg>
                    <span class="text-sm">No conversations found</span>
                </div>
            `;
            return;
        }

        let html = '';

        if (currentGroupBy === 'project') {
            // === 模式 1：按项目聚合折叠分组 ===
            for (const group of data.groups) {
                const isCollapsed = collapsedProjects.has(group.project);
                const projectColor = getProjectColor(group.project);
                const isArchivedExpanded = currentFilter === 'archived' || expandedArchivedProjects.has(group.project);

                const activeConvos = group.conversations.filter(c => !c.archived);
                const archivedConvos = group.conversations.filter(c => c.archived);
                const badgeCount = currentFilter === 'archived' ? archivedConvos.length : activeConvos.length;

                const borderStyle = projectColor
                    ? `border: 1.5px solid ${projectColor}aa !important; box-shadow: 0 0 12px ${projectColor}25, 0 4px 16px rgba(0, 0, 0, 0.2) !important;`
                    : `border: 1px solid rgba(255, 255, 255, 0.08) !important; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;`;

                html += `
                    <div data-project-group="${escapeHtml(group.project)}" class="leviosa-project-group flex flex-col gap-1 w-full rounded-xl p-1.5 transition-all" style="${borderStyle}">
                        <!-- 可折叠的项目头部 -->
                        <div data-leviosa-project="${escapeHtml(group.project)}" class="flex items-center gap-2 px-2.5 py-1.5 text-sm text-foreground hover:bg-muted/70 cursor-pointer select-none rounded-lg transition-colors group/header">
                            <!-- 经典自然文件夹图标 -->
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor" class="shrink-0 text-amber-500/80">
                                <path d="M170-180q-29.15,0-49.58-20.42T100-250V-707.69q0-29.15 21.58-50.73T172.31-780H391.92l80,80H787.69q26.85,0 46.31,17.35T856.54-640H447.38l-80-80H172.31q-5.39,0-8.85,3.46T160-707.69v455.38q0,4.23 2.12,6.92t5.58,4.62L261-552.31H927.31L830.46-229.69q-6.85,22.54-25.65,36.11T763.08-180H170Zm60.54-60H770.77l75.46-252.31H306L230.54-240Zm0,0L306-492.31L230.54-240ZM160-640v-67.69q0-5.39 0-8.85t0-3.46v80Z"></path>
                            </svg>

                            <!-- 项目名称 -->
                            <span class="truncate flex-1 font-semibold text-sm">${escapeHtml(group.project)}</span>

                            <!-- 会话计数 (仅统计未归档活跃会话) 及独立统计子代理数量 -->
                            <div class="flex items-center gap-1.5 shrink-0">
                                <span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">${badgeCount}</span>
                                ${group.subagentCount > 0 ? `
                                    <span class="text-[11px] px-1.5 py-0.5 rounded-full bg-secondary/80 text-muted-foreground/80 font-normal" title="${group.subagentCount} background subagent tasks">
                                        +${group.subagentCount} subagents
                                    </span>
                                ` : ''}
                            </div>
                        </div>

                        <!-- 会话列表内容（折叠时隐藏） -->
                        <div class="flex flex-col w-full pl-2 ${isCollapsed ? 'hidden' : ''}">
                            <!-- 未归档活跃会话列表 -->
                            <div class="flex flex-col w-full">
                                ${activeConvos.map(convo => renderConversationRow(convo, false)).join('')}
                            </div>

                            <!-- 归档会话抽屉分割线与展开区域 (极简分割线+文字，无按钮与图标) -->
                            ${archivedConvos.length > 0 ? `
                                <div data-leviosa-toggle-archived="${escapeHtml(group.project)}" class="flex items-center py-2 px-2 my-1 cursor-pointer select-none text-muted-foreground/60 hover:text-muted-foreground transition-colors group/archived-divider">
                                    <div class="h-px bg-border/40 grow"></div>
                                    <span class="px-2.5 text-[11px] font-normal transition-colors group-hover/archived-divider:text-foreground">Archived (${archivedConvos.length})</span>
                                    <div class="h-px bg-border/40 grow"></div>
                                </div>
                                <div class="flex flex-col w-full opacity-90 transition-all ${isArchivedExpanded ? '' : 'hidden'}">
                                    ${archivedConvos.map(convo => renderConversationRow(convo, false)).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }
        } else {
            // === 模式 2：平铺时间线模式 ===
            html += `
                <div class="flex flex-col w-full gap-1">
                    ${data.items.map(convo => renderConversationRow(convo, true)).join('')}
                </div>
            `;
        }

        listEl.innerHTML = html;

        // 绑定折叠/展开事件
        listEl.querySelectorAll('[data-leviosa-project]').forEach(header => {
            header.addEventListener('click', (e) => {
                const proj = header.getAttribute('data-leviosa-project');
                if (collapsedProjects.has(proj)) {
                    collapsedProjects.delete(proj);
                } else {
                    collapsedProjects.add(proj);
                }
                fetchAndRenderHistory();
            });
        });

        // 绑定归档会话抽屉分割线展开/收起事件
        listEl.querySelectorAll('[data-leviosa-toggle-archived]').forEach(divider => {
            divider.addEventListener('click', (e) => {
                e.stopPropagation();
                const proj = divider.getAttribute('data-leviosa-toggle-archived');
                if (expandedArchivedProjects.has(proj)) {
                    expandedArchivedProjects.delete(proj);
                } else {
                    expandedArchivedProjects.add(proj);
                }
                fetchAndRenderHistory();
            });
        });

        // 绑定卡片行点击与跳转逻辑（彻底拦截浏览器默认跳转，执行平滑无刷新 SPA 定位）
        listEl.querySelectorAll('[data-leviosa-convo-id]').forEach(row => {
            const convoId = row.getAttribute('data-leviosa-convo-id');
            const link = row.querySelector('a');

            const handleNavigate = (e) => {
                // 防御：若点击的是归档/删除等操作按钮，不触发跳转
                if (e.target.closest('button[data-action]')) return;
                e.preventDefault();
                e.stopPropagation();
                navigateToConversation(convoId);
                toggleHistoryView(false);
            };

            if (link) {
                link.addEventListener('click', handleNavigate);
            }
            row.addEventListener('click', handleNavigate);
        });

        // 绑定归档/重新打开、删除按钮操作（与 SQLite 及本地归档系统深度联动）
        listEl.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const action = btn.getAttribute('data-action');
                const uuid = btn.getAttribute('data-convo-id');
                const title = btn.getAttribute('data-convo-title') || '';
                const project = btn.getAttribute('data-convo-project') || '';

                if (action === 'delete') {
                    const confirmed = window.confirm(`确定要彻底删除会话 "${title || uuid}" 吗？\n（系统将自动在删除前创建安全深层备份）`);
                    if (!confirmed) return;
                }

                btn.disabled = true;
                btn.style.opacity = '0.4';

                try {
                    const params = new URLSearchParams({
                        action,
                        uuid,
                        title,
                        project
                    });
                    const res = await fetch(`${API_BASE}?${params.toString()}`);
                    const result = await res.json();
                    if (result.success) {
                        await fetchAndRenderHistory();
                    } else {
                        alert(`操作失败: ${result.error || '未知错误'}`);
                        btn.disabled = false;
                        btn.style.opacity = '';
                    }
                } catch (err) {
                    alert(`网络请求异常: ${err.message}`);
                    btn.disabled = false;
                    btn.style.opacity = '';
                }
            });
        });

    } catch (err) {
        listEl.innerHTML = `<div class="p-6 text-center text-sm text-destructive">请求异常: ${err.message}</div>`;
    }
}

/**
 * 渲染单个会话行卡片（100% 对齐原生 Tailwind 结构）
 */
function renderConversationRow(convo, showProjectBadge = false) {
    const isRunning = convo.isRunning;
    const isArchived = !!convo.archived;
    const relTime = convo.relativeTime || '';

    return `
        <div data-leviosa-convo-id="${convo.id}" class="relative w-full select-none cursor-pointer rounded-lg flex flex-row justify-between group items-center px-3 py-2 hover:bg-muted/80 transition-colors">
            <!-- 路由原生链接 -->
            <a href="/c/${convo.id}" class="absolute inset-0 rounded-lg no-underline z-0" aria-label="${escapeHtml(convo.title)}"></a>

            <!-- 标题展示 -->
            <div class="relative flex gap-2 grow min-w-0 items-center pointer-events-none z-10">
                <div class="flex flex-col items-start min-w-0 w-full text-secondary-foreground group-hover:text-foreground">
                    <span class="truncate inline-block text-left w-full text-sm font-medium ${isArchived ? 'opacity-70' : ''}">${escapeHtml(convo.title)}</span>
                    ${showProjectBadge ? `
                        <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-70 mt-0.5">
                            <span data-project-timeline-dot="${escapeHtml(convo.project)}" class="w-1.5 h-1.5 rounded-full shrink-0 ${getProjectColor(convo.project) ? '' : 'hidden'}" style="background-color: ${getProjectColor(convo.project) || 'transparent'}"></span>
                            <span>${escapeHtml(convo.project)}</span>
                        </div>
                    ` : ''}
                </div>
            </div>

            <!-- 右侧状态指示器与悬停浮动按钮 -->
            <div class="relative flex items-center shrink-0 ml-2 pointer-events-auto z-10 min-h-[24px]">
                <!-- 悬停时浮现的操作栏（归档/重新打开、删除） -->
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    ${isRunning ? `
                        <span class="h-5 px-1.5 text-[11px] flex items-center justify-center rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                            Running
                        </span>
                    ` : ''}
                    
                    ${isArchived ? `
                        <button type="button" data-action="unarchive" data-convo-id="${convo.id}" data-convo-title="${escapeHtml(convo.title)}" data-convo-project="${escapeHtml(convo.project)}" class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer border-0 bg-transparent flex items-center justify-center" title="Reopen conversation">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect width="20" height="5" x="2" y="3" rx="1"></rect>
                                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path>
                                <path d="m9 15 3-3 3 3"></path>
                                <path d="M12 12v6"></path>
                            </svg>
                        </button>
                    ` : `
                        <button type="button" data-action="archive" data-convo-id="${convo.id}" data-convo-title="${escapeHtml(convo.title)}" data-convo-project="${escapeHtml(convo.project)}" class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer border-0 bg-transparent flex items-center justify-center" title="Archive conversation">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect width="20" height="5" x="2" y="3" rx="1"></rect>
                                <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path>
                                <path d="M10 12h4"></path>
                            </svg>
                        </button>
                    `}

                    <button type="button" data-action="delete" data-convo-id="${convo.id}" data-convo-title="${escapeHtml(convo.title)}" data-convo-project="${escapeHtml(convo.project)}" class="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer border-0 bg-transparent flex items-center justify-center" title="Delete conversation">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                            <line x1="10" x2="10" y1="11" y2="17"></line>
                            <line x1="14" x2="14" y1="11" y2="17"></line>
                        </svg>
                    </button>
                </div>

                <!-- 静止状态下展示的标记（悬停时淡出） -->
                <div class="flex items-center gap-1.5 group-hover:opacity-0 transition-opacity absolute right-0">
                    ${isRunning ? `
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 -960 960 960" fill="currentColor" class="animate-spin shrink-0 text-amber-500">
                            <path d="M332.55-129.9q-69.29-29.9-121.02-81.63T129.9-332.55T100-480.35t29.96-147.5t81.58-120.61t121.04-81.58T480-860q12.75,0 21.37,8.63T510-829.99t-8.62,21.37T480-800q-133,0-226.5,93.5T160-480t93.5,226.5T480-160t226.5-93.5T800-480q0-12.77 8.63-21.38T830.01-510t21.37,8.62T860-480q0,77.99-29.96,147.42T748.46-211.54T627.85-129.96T480.35-100t-147.8-29.9Z"></path>
                        </svg>
                    ` : ''}
                    <span class="text-xs text-muted-foreground whitespace-nowrap">${escapeHtml(relTime)}</span>
                </div>
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let cachedReactNavigate = null;

/**
 * 尝试从宿主 React Fiber 树中逆向提取 React Router 的 navigate / navigator
 */
function tryReactNavigate(targetPath) {
    if (typeof cachedReactNavigate === 'function') {
        try {
            cachedReactNavigate(targetPath);
            return true;
        } catch (e) {
            cachedReactNavigate = null;
        }
    }

    const candidateNodes = [
        document.querySelector('[data-testid="new-conversation-button"]'),
        document.querySelector('[data-testid="history-button"]'),
        document.querySelector('nav a[href^="/"]'),
        document.querySelector('aside a[href^="/"]'),
        document.querySelector('#root')
    ].filter(Boolean);

    for (const node of candidateNodes) {
        const fiberKey = Object.keys(node).find(k => k.startsWith('__reactFiber$'));
        if (!fiberKey) continue;

        let curr = node[fiberKey];
        let depth = 0;
        while (curr && depth < 35) {
            // 1. 检查组件 Props 中是否有 router / navigate
            if (curr.memoizedProps) {
                const props = curr.memoizedProps;
                if (typeof props.navigate === 'function') {
                    cachedReactNavigate = props.navigate;
                    try { cachedReactNavigate(targetPath); return true; } catch (e) {}
                }
                if (props.router && typeof props.router.navigate === 'function') {
                    cachedReactNavigate = (p) => props.router.navigate(p);
                    try { cachedReactNavigate(targetPath); return true; } catch (e) {}
                }
                if (props.value && props.value.navigator && typeof props.value.navigator.push === 'function') {
                    cachedReactNavigate = (p) => props.value.navigator.push(p);
                    try { cachedReactNavigate(targetPath); return true; } catch (e) {}
                }
            }

            // 2. 检查 Hook state
            if (curr.memoizedState) {
                let stateNode = curr.memoizedState;
                let hookDepth = 0;
                while (stateNode && hookDepth < 15) {
                    if (stateNode.memoizedState) {
                        const ms = stateNode.memoizedState;
                        if (typeof ms === 'function') {
                            if (ms.name === 'navigate' || ms.toString().includes('navigate') || ms.toString().includes('dispatch')) {
                                try {
                                    ms(targetPath);
                                    cachedReactNavigate = ms;
                                    return true;
                                } catch (e) {}
                            }
                        } else if (Array.isArray(ms) && ms.length > 1 && Array.isArray(ms[1])) {
                            for (const dep of ms[1]) {
                                if (typeof dep === 'function') {
                                    try {
                                        dep(targetPath);
                                        cachedReactNavigate = dep;
                                        return true;
                                    } catch (e) {}
                                }
                            }
                        }
                    }
                    stateNode = stateNode.next;
                    hookDepth++;
                }
            }

            // 3. 检查 dependencies (React Context)
            if (curr.dependencies && curr.dependencies.firstContext) {
                let ctx = curr.dependencies.firstContext;
                while (ctx) {
                    const val = ctx.memoizedValue;
                    if (val) {
                        if (typeof val.navigate === 'function') {
                            cachedReactNavigate = val.navigate;
                            try { cachedReactNavigate(targetPath); return true; } catch (e) {}
                        }
                        if (val.navigator && typeof val.navigator.push === 'function') {
                            cachedReactNavigate = (p) => val.navigator.push(p);
                            try { cachedReactNavigate(targetPath); return true; } catch (e) {}
                        }
                        if (val.router && typeof val.router.navigate === 'function') {
                            cachedReactNavigate = (p) => val.router.navigate(p);
                            try { cachedReactNavigate(targetPath); return true; } catch (e) {}
                        }
                    }
                    ctx = ctx.next;
                }
            }

            curr = curr.return;
            depth++;
        }
    }

    return false;
}

/**
 * 平滑 SPA 路由跳转与会话定位（无刷新）
 * 核心机制：利用 Antigravity 宿主 TanStack Router (window.__TSR_ROUTER__) 官方客户端路由驱动
 */
function navigateToConversation(convoId) {
    const targetPath = `/c/${convoId}`;

    if (window.location.pathname === targetPath) {
        return;
    }

    // 1. 最高优先级：直接调度 Antigravity 全局 TanStack Router 实例（原生 SPA 驱动）
    if (window.__TSR_ROUTER__ && typeof window.__TSR_ROUTER__.navigate === 'function') {
        try {
            window.__TSR_ROUTER__.navigate({ to: targetPath });

            // 联动定位：如果在侧边栏中有该会话条目，平滑滚动至该条目
            setTimeout(() => {
                const sidebarItem = document.querySelector(`.bg-sidebar a[href="${targetPath}"], a[href="${targetPath}"]`);
                if (sidebarItem && !sidebarItem.closest('#leviosa-history-view')) {
                    sidebarItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            }, 80);
            return;
        } catch (err) {
            console.warn('[HistoryView] TanStack Router navigation failed, trying fallbacks:', err);
        }
    }

    // 2. 侧边栏原生 DOM 链接代理点击降级
    const sidebarMatch = document.querySelector(`.bg-sidebar a[href="${targetPath}"], a[href="${targetPath}"]`);
    if (sidebarMatch && !sidebarMatch.closest('#leviosa-history-view')) {
        sidebarMatch.click();
        sidebarMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
    }

    // 3. 次级降级：从 DOM Fiber 中逆向调度
    const reactNavigated = tryReactNavigate(targetPath);
    if (reactNavigated) {
        return;
    }

    // 4. 终极兜底：HTML5 pushState + popstate 信号派发
    try {
        window.history.pushState(null, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (e) {
        console.warn('[HistoryView] popstate dispatch failed:', e);
    }
}

/**
 * 全局事件监听：协同原生导航关闭历史大厅
 */
function setupGlobalEventListeners() {
    // 监听键盘 Esc 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
            toggleHistoryView(false);
        }
    });

    // 监听侧边栏新对话或会话切换
    document.addEventListener('click', (e) => {
        if (!isOpen) return;

        // 核心防御：如果点击发生在历史按钮自身或历史面板内部，绝对不要触发关闭！
        if (e.target.closest('#leviosa-history-button') || e.target.closest('#leviosa-history-view')) {
            return;
        }

        const newBtn = e.target.closest('[data-testid="new-conversation-button"], a[href="/"]');
        const sidebarConvo = e.target.closest('a[href^="/c/"]');
        if (newBtn || (sidebarConvo && !sidebarConvo.closest('#leviosa-history-view'))) {
            toggleHistoryView(false);
        }
    }, true);
}
