/**
 * web/panel_inject.js
 */
import { extractActiveProjectName } from './project_opener.js';

export function initPanelInject() {
    const API_BASE = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/pm_dashboard_api';

    let isOpen = false;
    let wrapper = null;
    let panel = null; 
    let animationFrameId = null;

    function getCurrentProjectName() {
        let proj = extractActiveProjectName();
        if (proj && proj !== 'Unknown') return proj;

        try {
            const activeSidebarRow = document.querySelector('nav a[href="' + window.location.pathname + '"]') 
                                    || document.querySelector('div[role="button"].bg-secondary, button.bg-secondary, .group.bg-secondary');
            
            if (activeSidebarRow) {
                const rowDom = activeSidebarRow.closest('div[role="button"], button, a, .group');
                if (rowDom) {
                    const projectSpan = rowDom.querySelector('.text-xs.text-muted-foreground, .text-\\[10px\\]');
                    if (projectSpan && projectSpan.textContent) {
                        return projectSpan.textContent.trim();
                    }
                }
            }
        } catch (e) {}

        return null;
    }

    const observer = new MutationObserver(() => {
        const searchBtn = document.querySelector('[data-testid="sidebar-search-button"]');
        if (searchBtn && !document.getElementById('leviosa-pm-btn')) {
            injectButton(searchBtn);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    function injectButton(searchBtn) {
        const pmBtn = document.createElement('button');
        pmBtn.id = 'leviosa-pm-btn';
        pmBtn.className = searchBtn.className;
        pmBtn.setAttribute('aria-label', 'Project Dashboard');
        pmBtn.innerHTML = `
            <span class="relative flex items-center justify-center" style="width: 18px; height: 18px;">
                <span class="absolute inset-0 flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                </span>
            </span>
        `;

        searchBtn.parentNode.insertBefore(pmBtn, searchBtn.nextSibling);
        pmBtn.addEventListener('click', (e) => {
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
        const backlogStates = ['backlog', 'todo', 'pending', 'open'];
        const completedStates = ['completed', 'done', 'closed', 'resolved'];
        
        const backlog = tasks.filter(t => backlogStates.includes(t.status));
        const completed = tasks.filter(t => completedStates.includes(t.status));
        const active = tasks.filter(t => !backlogStates.includes(t.status) && !completedStates.includes(t.status));

        function generateTaskCards(taskList, columnType) {
            if (taskList.length === 0) {
                return `<div class="text-center py-6 text-xs text-muted-foreground/60 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">Empty</div>`;
            }
            return taskList.map(t => {
                // 优先级映射为卡片边框：左侧高亮标识线 + 周围细微同色透光描边
                let prioBorder = 'border-l-[3.5px] border-l-blue-400 border-white/10';
                if (t.priority === 'high') {
                    prioBorder = 'border-l-[3.5px] border-l-rose-500 border-rose-500/30';
                } else if (t.priority === 'medium') {
                    prioBorder = 'border-l-[3.5px] border-l-amber-400 border-amber-400/25';
                } else if (t.priority === 'low') {
                    prioBorder = 'border-l-[3.5px] border-l-blue-400 border-blue-400/20';
                }

                // 高透卡片容器
                let containerClass = 'border rounded-xl p-3 shadow-sm relative group cursor-pointer transition-all active:scale-[0.99] hover:bg-white/[0.08]';
                if (columnType === 'completed') {
                    containerClass += ' opacity-75 hover:opacity-100';
                }

                let badgeColor = 'bg-white/10 text-foreground border border-white/10';
                if (t.status === 'in_review') badgeColor = 'bg-purple-500/20 text-purple-300 border border-purple-500/30';
                else if (t.status === 'active' || t.status === 'in_progress') badgeColor = 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
                else if (columnType === 'completed') badgeColor = 'bg-green-500/20 text-green-300 border border-green-500/30';

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

                return `
                    <div onclick="window.leviosaOpenTask('${t.id}', '${safeFilePath}')"
                         class="${containerClass} ${prioBorder}"
                         style="background-color: rgba(255, 255, 255, 0.04); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);"
                         title="点击使用 Qled 查看/编辑此任务 (${t.priority} 优先级)">
                        <div class="flex justify-between items-center gap-2 mb-2 min-w-0">
                            <span class="text-[10px] font-mono text-muted-foreground bg-black/30 px-1.5 py-0.5 rounded truncate min-w-0" title="${t.id}">${t.id}</span>
                            <div class="flex items-center gap-1.5 shrink-0">
                                <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 ${badgeColor}">${t.status}</span>
                                ${deleteBtn}
                            </div>
                        </div>
                        <h4 class="text-sm font-semibold mb-2 text-foreground/90 leading-tight">${t.title}</h4>
                        <div class="flex gap-1 flex-wrap">${tagsHtml}</div>
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

                    <!-- Active 栏 (纯黑色 + 高度磨砂) -->
                    <div class="flex flex-col gap-3 p-3.5 rounded-2xl border border-white/15 shadow-2xl"
                         style="background-color: rgba(0, 0, 0, 0.85); backdrop-filter: blur(24px) saturate(160%); -webkit-backdrop-filter: blur(24px) saturate(160%);">
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
