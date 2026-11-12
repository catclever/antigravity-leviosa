/**
 * web/panel_inject.js
 */
import { extractActiveProjectName } from './project_opener.js';

function escapeAttr(val) {
    if (val === undefined || val === null) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function initPanelInject() {
    const API_BASE = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/pm_dashboard_api';

    let isOpen = false;
    let wrapper = null;
    let panel = null; 
    let animationFrameId = null;
    let cachedReactNavigate = null;

    function getCurrentConversationUuid() {
        const match = window.location.pathname.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        return match ? match[1].toLowerCase() : null;
    }

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

    function getCurrentProjectName() {
        let proj = extractActiveProjectName();
        if (proj && proj !== 'Unknown') return proj;

        try {
            const activeSidebarRow = document.querySelector('nav a[href="' + window.location.pathname + '"]') 
                                    || document.querySelector('div[role="button"].bg-secondary, button.bg-secondary, .group.bg-secondary');
            
            if (activeSidebarRow) {
                const rowDom = activeSidebarRow.closest('div[role="button"], button, a, .group, [data-testid="conversation-row-sidebar"]');
                if (rowDom) {
                    const subtext = rowDom.getAttribute('data-subtext');
                    if (subtext && subtext.trim()) return subtext.trim();

                    const projectSpan = rowDom.querySelector('.text-sm.text-muted-foreground, .text-xs.text-muted-foreground, .text-\\[10px\\]');
                    if (projectSpan && projectSpan.textContent) {
                        return projectSpan.textContent.trim();
                    }
                }
            }
        } catch (e) {}

        return null;
    }

    function ensureStyles() {
        if (document.getElementById('leviosa-pm-styles')) return;
        const style = document.createElement('style');
        style.id = 'leviosa-pm-styles';
        style.textContent = `
            #leviosa-pm-btn,
            #leviosa-pm-btn * {
                -webkit-app-region: no-drag !important;
                app-region: no-drag !important;
                cursor: pointer !important;
            }
            #leviosa-pm-wrapper,
            #leviosa-pm-panel,
            #leviosa-pm-panel * {
                -webkit-app-region: no-drag !important;
                app-region: no-drag !important;
            }
            .leviosa-session-current-badge {
                background-color: rgba(14, 165, 233, 0.20);
                color: rgb(125, 211, 252);
                border: 1px solid rgba(56, 189, 248, 0.40);
            }
            .leviosa-session-jump-btn {
                background-color: rgba(99, 102, 241, 0.15);
                color: rgb(165, 180, 252);
                border: 1px solid rgba(129, 140, 248, 0.30);
                transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
            }
            .leviosa-session-jump-btn:hover {
                background-color: rgba(99, 102, 241, 0.30);
                border-color: rgba(129, 140, 248, 0.50);
                color: rgb(199, 210, 254);
            }
            .leviosa-session-cold-pill {
                background-color: rgba(255, 255, 255, 0.04);
                color: rgba(156, 163, 175, 0.78);
                border: 1px solid rgba(255, 255, 255, 0.10);
            }
        `;
        document.head.appendChild(style);
    }

    ensureStyles();

    const observer = new MutationObserver(() => {
        const searchBtn = document.querySelector('[data-testid="sidebar-search-button"]');
        if (searchBtn && !document.getElementById('leviosa-pm-btn')) {
            injectButton(searchBtn);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    function injectButton(searchBtn) {
        ensureStyles();
        const pmBtn = document.createElement('button');
        pmBtn.id = 'leviosa-pm-btn';
        pmBtn.type = 'button';
        pmBtn.className = searchBtn.className;
        pmBtn.setAttribute('aria-label', 'Project Dashboard');
        pmBtn.setAttribute('data-no-drag', '');
        pmBtn.style.setProperty('-webkit-app-region', 'no-drag', 'important');
        pmBtn.style.setProperty('app-region', 'no-drag', 'important');
        pmBtn.style.cursor = 'pointer';
        pmBtn.style.pointerEvents = 'auto';
        pmBtn.innerHTML = `
            <span class="relative flex items-center justify-center pointer-events-none" style="width: 18px; height: 18px; -webkit-app-region: no-drag; app-region: no-drag;">
                <span class="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <svg class="pointer-events-none" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                </span>
            </span>
        `;

        searchBtn.parentNode.insertBefore(pmBtn, searchBtn.nextSibling);
        pmBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePanel();
        });

        if (!wrapper || !document.getElementById('leviosa-pm-wrapper')) {
            initPanel();
        }
    }

    function initPanel() {
        wrapper = document.createElement('div');
        wrapper.id = 'leviosa-pm-wrapper';
        Object.assign(wrapper.style, {
            position: 'fixed',
            top: '44px',
            left: '0',
            width: '100vw',
            height: '0',
            overflow: 'hidden',
            zIndex: '99998',
            pointerEvents: 'none'
        });

        panel = document.createElement('div');
        panel.id = 'leviosa-pm-panel';
        Object.assign(panel.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '60vh',
            overflow: 'hidden',
            backgroundColor: 'rgba(16, 18, 24, 0.55)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
            transform: 'translateY(-100%)',
            transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto'
        });

        // 视口无缝锚定背景层（始终充满真实屏幕宽高，解决侧边栏开启时宽度压缩导致背景缩放偏移的问题）
        const bgLayer = document.createElement('div');
        bgLayer.id = 'leviosa-pm-bg';
        Object.assign(bgLayer.style, {
            position: 'absolute',
            top: '-44px',
            left: '0',
            width: '100vw',
            height: '100vh',
            backgroundImage: "linear-gradient(rgba(14, 16, 20, 0.42), rgba(14, 16, 20, 0.42)), var(--antigravity-bg, none)",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            pointerEvents: 'none',
            zIndex: '0'
        });

        const content = document.createElement('div');
        content.id = 'leviosa-pm-content';
        content.className = "flex-1 overflow-y-auto p-4 bg-transparent flex flex-col gap-4 relative z-10";
        
        panel.appendChild(bgLayer);
        panel.appendChild(content);
        wrapper.appendChild(panel);
        document.body.appendChild(wrapper);

        document.addEventListener('click', (e) => {
            if (!isOpen) return;
            if (wrapper.contains(e.target)) return;
            if (document.getElementById('leviosa-pm-btn')?.contains(e.target)) return;
            
            const searchBtn = document.querySelector('[data-testid="sidebar-search-button"]');
            if (searchBtn) {
                const topbar = searchBtn.closest('header') || searchBtn.closest('div.sticky, div.flex.items-center.justify-between');
                if (topbar && topbar.contains(e.target)) return;
            }

            const btn = e.target.closest('button');
            if (btn && btn.textContent.trim() === '' && btn.querySelector('svg')) {
                return;
            }

            togglePanel();
        });
    }

    let cachedRightSidebar = null;
    let lastSidebarScan = 0;

    function detectRightSidebar() {
        const now = Date.now();
        if (cachedRightSidebar && document.body.contains(cachedRightSidebar) && now - lastSidebarScan < 500) {
            return cachedRightSidebar;
        }
        lastSidebarScan = now;
        
        const candidates = document.querySelectorAll('aside, section, [id*="idePanel"], [id*="Side"], [data-testid*="sidebar"], [data-testid*="panel"], .border-l, .flex-col');
        let bestCandidate = null;
        
        for (const el of candidates) {
            const rect = el.getBoundingClientRect();
            if (rect.height > window.innerHeight * 0.4 && rect.width > 50 && rect.width < window.innerWidth * 0.5) {
                if (window.innerWidth - rect.right < 25) {
                    if (rect.left > window.innerWidth / 2 && rect.left < window.innerWidth) {
                        if (!bestCandidate || rect.left < bestCandidate.getBoundingClientRect().left) {
                            bestCandidate = el;
                        }
                    }
                }
            }
        }
        
        cachedRightSidebar = bestCandidate;
        return bestCandidate;
    }

    function updateLayout() {
        const searchBtn = document.querySelector('[data-testid="sidebar-search-button"]');
        let topOffset = 44;
        if (searchBtn) {
            const container = searchBtn.closest('.flex.items-center.gap-1')?.parentElement;
            if (container) topOffset = container.getBoundingClientRect().bottom;
        }
        
        let rightEdge = window.innerWidth;
        
        const sidebar = detectRightSidebar();
        if (sidebar) {
            const sbLeft = sidebar.getBoundingClientRect().left;
            if (sbLeft > 0 && sbLeft < rightEdge) {
                rightEdge = sbLeft;
            }
        }
        
        wrapper.style.top = `${topOffset}px`;
        wrapper.style.left = '0px'; 
        wrapper.style.width = `${rightEdge}px`;

        const bgLayer = document.getElementById('leviosa-pm-bg');
        if (bgLayer) {
            bgLayer.style.top = `-${topOffset}px`;
            bgLayer.style.width = `${window.innerWidth}px`;
            bgLayer.style.height = `${window.innerHeight}px`;
        }
    }

    function layoutLoop() {
        if (!isOpen) return;
        updateLayout();
        animationFrameId = requestAnimationFrame(layoutLoop);
    }

    function togglePanel() {
        isOpen = !isOpen;
        if (isOpen) {
            updateLayout();
            wrapper.style.height = '60vh';
            wrapper.style.pointerEvents = 'auto';
            panel.style.transform = 'translateY(0)';
            fetchAndRenderData();
            
            layoutLoop();
        } else {
            panel.style.transform = 'translateY(-100%)';
            wrapper.style.pointerEvents = 'none';
            setTimeout(() => { if(!isOpen) wrapper.style.height = '0'; }, 300);
            
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        }
    }

    window.leviosaJumpToSession = function(convoId) {
        if (!convoId) return;

        // 1. 平滑收起看板面板
        if (isOpen) {
            togglePanel();
        }

        const targetPath = '/c/' + convoId;
        if (window.location.pathname === targetPath) {
            return;
        }

        // Tier 1: 直接调度 Antigravity 宿主 TanStack Router 实例 (无刷新 SPA 路由跳转，绝不修改 window.location.href)
        if (window.__TSR_ROUTER__ && typeof window.__TSR_ROUTER__.navigate === 'function') {
            try {
                window.__TSR_ROUTER__.navigate({ to: targetPath });
                setTimeout(() => {
                    const sidebarItem = document.querySelector(`.bg-sidebar a[href="${targetPath}"], a[href="${targetPath}"]`);
                    if (sidebarItem && !sidebarItem.closest('#leviosa-pm-panel') && !sidebarItem.closest('#leviosa-history-view')) {
                        sidebarItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    }
                }, 80);
                return;
            } catch (err) {
                console.warn('[PanelInject] TanStack Router navigation failed, trying fallbacks:', err);
            }
        }

        // Tier 2: 侧边栏原生 DOM 链接代理点击降级
        const sidebarMatch = document.querySelector(`.bg-sidebar a[href="${targetPath}"], a[href="${targetPath}"]`);
        if (sidebarMatch && !sidebarMatch.closest('#leviosa-pm-panel') && !sidebarMatch.closest('#leviosa-history-view')) {
            sidebarMatch.click();
            sidebarMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
        }

        // Tier 3: React Fiber navigate 逆向调度
        if (tryReactNavigate(targetPath)) {
            return;
        }

        // Tier 4: HTML5 pushState + popstate 终极兜底
        try {
            window.history.pushState(null, '', targetPath);
            window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (e) {
            console.warn('[PanelInject] popstate dispatch failed:', e);
        }
    };

    window.leviosaCompleteTask = async function(taskId) {
        const currentProject = getCurrentProjectName();
        if(!currentProject) return;
        try {
            const res = await fetch(`${API_BASE}?action=complete_task&project=${encodeURIComponent(currentProject)}&task=${encodeURIComponent(taskId)}`);
            const data = await res.json();
            if (data.success) {
                fetchAndRenderData();
            }
        } catch(e) {}
    };

    window.leviosaAbandonTask = async function(taskId) {
        if (!window.confirm(`确定要放弃并删除任务 [${taskId}] 吗？\n此操作将直接物理删除该任务文件，且无法恢复。`)) {
            return;
        }
        const currentProject = getCurrentProjectName();
        if(!currentProject) return;
        try {
            const res = await fetch(`${API_BASE}?action=abandon_task&project=${encodeURIComponent(currentProject)}&task=${encodeURIComponent(taskId)}`);
            const data = await res.json();
            if (data.success) {
                fetchAndRenderData();
            } else {
                alert(`删除失败: ${data.error || '未知错误'}`);
            }
        } catch(e) {
            console.error('Abandon task failed', e);
        }
    };

    window.leviosaOpenTask = async function(taskId, fullPath) {
        const currentProject = getCurrentProjectName();
        try {
            if (currentProject) {
                const res = await fetch(`${API_BASE}?action=open_task&project=${encodeURIComponent(currentProject)}&task=${encodeURIComponent(taskId)}`);
                const data = await res.json();
                if (data.success) {
                    return;
                }
            }
        } catch(e) {
            console.warn('[leviosaOpenTask] backend open failed, falling back to protocol navigation', e);
        }

        if (fullPath) {
            const qledUrl = `qled://open?path=${encodeURIComponent(fullPath)}`;
            const a = document.createElement('a');
            a.href = qledUrl;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 500);
        }
    };

    window.leviosaStartTaskInNewChat = function(taskId) {
        const currentProject = getCurrentProjectName() || 'Unknown';
        const task = window.leviosaTasksCache?.find(t => t.id === taskId);
        const title = task?.title || taskId;
        const body = task?.body?.trim() || '';

        // 1. 平滑收起看板
        if (isOpen) {
            togglePanel();
        }

        // 2. 触发原生新建会话
        const newBtn = document.querySelector('[data-testid="new-conversation-button"], a[href="/"]');
        if (newBtn) {
            newBtn.click();
        }

        // 3. 构建语义化、强规范的启动 Prompt
        let promptText = `请开始执行项目 [${currentProject}] 的任务 [${taskId}]：\n- 任务标题：${title}\n`;
        if (body) {
            promptText += `\n【任务详情与背景】：\n${body}\n`;
        }
        promptText += `\n【执行要求】：\n1. 查阅相关项目知识库与规范，评估技术方案；\n2. 在开始执行前，调用 kanban-task-manager MCP 工具将该任务状态推进为 active，并在 session 字段关联本会话；\n3. 执行具体实现并验证。`;

        // 4. 等待新会话挂载并填充输入框
        const startTime = Date.now();
        const inputSelector = 'div[aria-label="Message input"][contenteditable="true"], div[data-lexical-editor="true"], [contenteditable="true"]';
        
        const pollTimer = setInterval(() => {
            const inputEl = document.querySelector(inputSelector);
            if (inputEl) {
                clearInterval(pollTimer);
                setTimeout(() => {
                    inputEl.focus();
                    const sel = window.getSelection();
                    if (sel) {
                        const range = document.createRange();
                        range.selectNodeContents(inputEl);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    document.execCommand('insertText', false, promptText);
                }, 80);
                return;
            }
            if (Date.now() - startTime > 3500) {
                clearInterval(pollTimer);
                console.warn('[leviosaStartTaskInNewChat] 等待新会话输入框超时');
            }
        }, 50);
    };

    async function fetchAndRenderData() {
        const content = document.getElementById('leviosa-pm-content');
        const currentProject = getCurrentProjectName();
        
        if (!currentProject) {
            content.innerHTML = `<div class="text-yellow-500 p-4 text-sm text-center mt-10">未检测到当前选中的项目上下文。</div>`;
            return;
        }

        try {
            content.innerHTML = `<div class="flex items-center justify-center h-full text-muted-foreground text-sm">正在拉取...</div>`;
            
            const tasksRes = await fetch(`${API_BASE}?action=get_tasks&project=${encodeURIComponent(currentProject)}`);
            const tasksData = await tasksRes.json();
            
            if (tasksData.success) {
                renderKanban(tasksData.tasks, content, tasksData.path);
            }
        } catch (err) {}
    }

    function renderKanban(tasks, contentNode, tasksPath) {
        window.leviosaTasksCache = tasks;
        const currentConvoUuid = getCurrentConversationUuid();
        const isCurrentSessionTask = (t) => Boolean(currentConvoUuid && t.session && t.session.toLowerCase() === currentConvoUuid);
        const priorityRank = (p) => (p === 'high' ? 3 : p === 'medium' ? 2 : 1);

        const backlogStates = ['backlog', 'todo', 'pending', 'open'];
        const completedStates = ['completed', 'done', 'closed', 'resolved'];
        
        const backlog = tasks.filter(t => backlogStates.includes(t.status));
        const completed = tasks.filter(t => completedStates.includes(t.status));
        const active = tasks.filter(t => !backlogStates.includes(t.status) && !completedStates.includes(t.status));

        // 当前打开对话所关联的任务置顶，同层级内保持原有优先级或完成时间倒序
        const sortByCurrentSessionThenPriority = (a, b) => {
            const currDiff = Number(isCurrentSessionTask(b)) - Number(isCurrentSessionTask(a));
            if (currDiff !== 0) return currDiff;
            const prioDiff = priorityRank(b.priority) - priorityRank(a.priority);
            if (prioDiff !== 0) return prioDiff;
            return 0;
        };

        backlog.sort(sortByCurrentSessionThenPriority);
        active.sort(sortByCurrentSessionThenPriority);

        completed.sort((a, b) => {
            const currDiff = Number(isCurrentSessionTask(b)) - Number(isCurrentSessionTask(a));
            if (currDiff !== 0) return currDiff;
            const timeA = a.completedAt || a.mtimeMs || 0;
            const timeB = b.completedAt || b.mtimeMs || 0;
            if (timeA !== timeB) return timeB - timeA;
            return String(b.id).localeCompare(String(a.id));
        });

        function generateTaskCards(taskList, columnType) {
            if (taskList.length === 0) {
                return `<div class="text-center py-6 text-xs text-muted-foreground/60 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">Empty</div>`;
            }
            return taskList.map(t => {
                const isCurrSession = isCurrentSessionTask(t);

                // 优先级映射：提取颜色与语义，兼顾卡片左边框高亮线与卡片内发光圆点，防止Tailwind类未预编译丢失
                let prioColor = '#60a5fa'; // low / default
                let prioLabel = 'LOW';
                if (t.priority === 'high') {
                    prioColor = '#f43f5e';
                    prioLabel = 'HIGH';
                } else if (t.priority === 'medium') {
                    prioColor = '#fbbf24';
                    prioLabel = 'MED';
                } else {
                    prioColor = '#60a5fa';
                    prioLabel = 'LOW';
                }

                // 卡片容器基础样式
                let containerClass = 'rounded-xl p-3 shadow-sm relative group cursor-pointer transition-all active:scale-[0.99]';
                let cardStyle = '';

                if (columnType === 'active') {
                    // Active 栏反转视觉层级：栏位轻透，卡片本身为深色磨砂玻璃，悬浮感突出
                    containerClass += ' hover:brightness-110 hover:border-blue-400/40';
                    if (isCurrSession) {
                        cardStyle = `background-color: rgba(18, 28, 42, 0.86); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border: 1px solid rgba(56, 189, 248, 0.50); border-left: 3.5px solid ${prioColor} !important; box-shadow: 0 0 0 1.5px rgba(56, 189, 248, 0.75), 0 8px 28px -4px rgba(14, 165, 233, 0.28) !important;`;
                    } else {
                        cardStyle = `background-color: rgba(16, 20, 28, 0.78); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.14); border-left: 3.5px solid ${prioColor} !important; box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.5), 0 0 16px rgba(59, 130, 246, 0.08);`;
                    }
                } else if (columnType === 'completed') {
                    // Completed 栏：由高度磨砂底栏托底，卡片自身高透，略带暗淡 (当前对话聚光灯卡片保持清晰高亮)
                    if (isCurrSession) {
                        containerClass += ' hover:opacity-100 hover:bg-white/[0.10]';
                        cardStyle = `background-color: rgba(14, 165, 233, 0.09); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(56, 189, 248, 0.45); border-left: 3.5px solid ${prioColor} !important; box-shadow: 0 0 0 1.5px rgba(56, 189, 248, 0.75), 0 8px 28px -4px rgba(14, 165, 233, 0.28) !important;`;
                    } else {
                        containerClass += ' opacity-75 hover:opacity-100 hover:bg-white/[0.08]';
                        cardStyle = `background-color: rgba(255, 255, 255, 0.04); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.08); border-left: 3.5px solid ${prioColor} !important;`;
                    }
                } else {
                    // Backlog 栏：由高度磨砂底栏托底，卡片自身高透
                    containerClass += ' hover:bg-white/[0.08]';
                    if (isCurrSession) {
                        cardStyle = `background-color: rgba(14, 165, 233, 0.09); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid rgba(56, 189, 248, 0.45); border-left: 3.5px solid ${prioColor} !important; box-shadow: 0 0 0 1.5px rgba(56, 189, 248, 0.75), 0 8px 28px -4px rgba(14, 165, 233, 0.28) !important;`;
                    } else {
                        cardStyle = `background-color: rgba(255, 255, 255, 0.04); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.08); border-left: 3.5px solid ${prioColor} !important;`;
                    }
                }

                let badgeColor = 'bg-white/10 text-foreground border border-white/10';
                if (t.status === 'in_review') badgeColor = 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
                else if (t.status === 'active' || t.status === 'in_progress') badgeColor = 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
                else if (columnType === 'completed') badgeColor = 'bg-green-500/20 text-green-300 border border-green-500/30';

                let sessionPillHtml = '';
                if (isCurrSession) {
                    sessionPillHtml = `<span onclick="event.stopPropagation()" title="当前打开的对话关联任务" class="leviosa-session-current-badge text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/40 font-medium inline-flex items-center gap-1">📍 当前对话</span>`;
                } else if (t.session) {
                    const sessionTitleText = escapeAttr(t.sessionInfo?.sessionTitle || t.session);
                    if (t.sessionInfo?.deepArchived) {
                        sessionPillHtml = `<span onclick="event.stopPropagation()" title="关联会话已深归档冷备: ${sessionTitleText}" class="leviosa-session-cold-pill text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-muted-foreground/75 border border-white/10 inline-flex items-center gap-1 cursor-default">☁️ 已冷备</span>`;
                    } else if (t.sessionInfo?.existsInDb !== false) {
                        const jumpLabel = t.sessionInfo?.archived ? '📦 跳转归档' : '💬 跳转对话';
                        const safeSessionId = escapeAttr(t.session);
                        sessionPillHtml = `<button type="button" onclick="event.stopPropagation(); window.leviosaJumpToSession('${safeSessionId}')" title="跳转到对话: ${sessionTitleText}" class="leviosa-session-jump-btn text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 transition-colors cursor-pointer inline-flex items-center gap-1">${jumpLabel}</button>`;
                    }
                }

                const tagsHtml = t.tags.map(tag => `<span class="text-[10px] px-1.5 py-0.5 border border-white/10 rounded text-muted-foreground/80 bg-white/[0.03]">${tag}</span>`).join('');
                
                const actionBtn = t.status === 'in_review' ? `
                    <div class="mt-3 pt-3 border-t border-white/10">
                        <button onclick="event.stopPropagation(); window.leviosaCompleteTask('${t.id}')" class="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors text-xs font-medium border border-green-500/30 shadow-sm cursor-pointer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            Complete Task
                        </button>
                    </div>
                ` : '';

                const deleteBtn = columnType === 'backlog' ? `
                    <button onclick="event.stopPropagation(); window.leviosaAbandonTask('${t.id}')" title="放弃任务 (删除文件)" class="opacity-40 group-hover:opacity-100 hover:!opacity-100 hover:text-red-400 hover:bg-red-500/20 p-0.5 rounded transition-all cursor-pointer flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        </svg>
                    </button>
                ` : '';

                const startBtn = columnType === 'backlog' ? `
                    <div class="mt-3 pt-3 border-t border-white/10">
                        <button onclick="event.stopPropagation(); window.leviosaStartTaskInNewChat('${t.id}')" class="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors text-xs font-medium border border-blue-500/30 shadow-sm cursor-pointer group/start">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="group-hover/start:translate-x-0.5 transition-transform"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                            在新对话中启动
                        </button>
                    </div>
                ` : '';

                const filePath = t.filePath || (tasksPath ? `${tasksPath}/${t.id}` : '');
                const safeFilePath = filePath.replace(/'/g, "\\'");

                let completionTimeHtml = '';
                if (columnType === 'completed' && (t.completedAt || t.mtimeMs)) {
                    const d = new Date(t.completedAt || t.mtimeMs);
                    if (!isNaN(d.getTime())) {
                        const now = new Date();
                        const isToday = d.toDateString() === now.toDateString();
                        const timeStr = isToday 
                            ? `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
                            : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                        
                        completionTimeHtml = `
                            <span class="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground/60 border border-white/5 bg-white/[0.02] ml-auto shrink-0 flex items-center gap-1 font-mono" title="完成时间: ${d.toLocaleString()}">
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-70"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                ${timeStr}
                            </span>
                        `;
                    }
                }

                return `
                    <div onclick="window.leviosaOpenTask('${t.id}', '${safeFilePath}')"
                         class="${containerClass}"
                         style="${cardStyle}"
                         title="点击使用 Qled 查看/编辑此任务 (${prioLabel} 优先级)">
                        <div class="flex justify-between items-center gap-2 mb-2 min-w-0">
                            <span class="text-[10px] font-mono text-muted-foreground bg-black/40 px-1.5 py-0.5 rounded truncate min-w-0 flex items-center gap-1.5" title="[${prioLabel} 优先级] ${t.id}">
                                <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${prioColor}; box-shadow: 0 0 6px ${prioColor};"></span>
                                <span class="truncate">${t.id}</span>
                            </span>
                            <div class="flex items-center gap-1.5 shrink-0">
                                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${badgeColor}">${t.status}</span>
                                ${deleteBtn}
                            </div>
                        </div>
                        <h4 class="text-sm font-semibold mb-2 text-foreground/90 leading-tight">${t.title}</h4>
                        <div class="flex items-center gap-1 flex-wrap">${sessionPillHtml}${tagsHtml}${completionTimeHtml}</div>
                        ${actionBtn}
                        ${startBtn}
                    </div>`;
            }).join('');
        }
        
        let emptyTasksWarning = '';
        if (tasks.length === 0) {
            emptyTasksWarning = `<div class="col-span-3 text-center py-6 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-xl mb-4 backdrop-blur-md">
                当前项目没有读取到任务卡片。<br/>
                请在 <code>${tasksPath || '未知路径'}</code> 下创建 YAML Frontmatter Markdown。
            </div>`;
        }

        contentNode.innerHTML = `
            <div class="h-full overflow-y-auto px-4 pb-6 w-full max-w-7xl mx-auto pt-2">
                ${emptyTasksWarning}
                <div class="grid grid-cols-3 gap-6 h-full">
                    <!-- Backlog 栏 (高度磨砂，与完成栏一致) -->
                    <div class="flex flex-col gap-3 p-3.5 rounded-2xl border border-white/10 shadow-lg"
                         style="background-color: rgba(22, 25, 32, 0.52); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);">
                        <h3 class="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Backlog 
                            <span class="bg-black/30 border border-white/10 text-foreground px-2 py-0.5 rounded-full text-[10px] shadow-sm">${backlog.length}</span>
                        </h3>
                        <div class="flex flex-col gap-3 overflow-y-auto pb-4">${generateTaskCards(backlog, 'backlog')}</div>
                    </div>

                    <!-- Active 栏 (反转视觉：高透轻量栏位，托起内部深度磨砂卡片) -->
                    <div class="flex flex-col gap-3 p-3.5 rounded-2xl border border-blue-400/20 shadow-lg"
                         style="background-color: rgba(16, 18, 24, 0.18); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);">
                        <h3 class="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center justify-between">
                            Active 
                            <span class="bg-blue-500/20 border border-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full text-[10px] shadow-sm">${active.length}</span>
                        </h3>
                        <div class="flex flex-col gap-3 overflow-y-auto pb-4">${generateTaskCards(active, 'active')}</div>
                    </div>

                    <!-- Completed 栏 (高度磨砂，与 Backlog 栏风格完全一致) -->
                    <div class="flex flex-col gap-3 p-3.5 rounded-2xl border border-white/10 shadow-lg"
                         style="background-color: rgba(22, 25, 32, 0.52); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);">
                        <h3 class="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                            Completed 
                            <span class="bg-black/30 border border-white/10 text-foreground px-2 py-0.5 rounded-full text-[10px] shadow-sm">${completed.length}</span>
                        </h3>
                        <div class="flex flex-col gap-3 overflow-y-auto pb-4">${generateTaskCards(completed, 'completed')}</div>
                    </div>
                </div>
            </div>
        `;
    }
}
