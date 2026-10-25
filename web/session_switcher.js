// session_switcher.js

export function initSessionSwitcher() {
    console.log('🔄 [Antigravity Mod] 初始化会话切换快捷键 (Ctrl+Tab)');

    // 记录快速连续按键时的目标索引与时间戳，防止 React 异步路由更新延迟导致连按卡在同一会话
    let lastNavigatedIndex = -1;
    let lastNavigatedTime = 0;

    document.addEventListener('keydown', (e) => {
        // 判断快捷键：Ctrl + Tab (切换到下一个) 或 Ctrl + Shift + Tab (切换到上一个)
        // 兼容 key 与 code
        if (e.ctrlKey && (e.key === 'Tab' || e.code === 'Tab')) {
            e.preventDefault();
            e.stopImmediatePropagation();

            // 1. 获取所有会话的 DOM 条目
            // 现代版本特征：外层 div 携带 data-testid="conversation-row-sidebar"
            let sessionRows = Array.from(document.querySelectorAll('[data-testid="conversation-row-sidebar"]'));

            // 兼容历史版本：内部包含 data-testid="convo-pill-..." 的外层 div[role="button"]
            if (sessionRows.length === 0) {
                const pills = Array.from(document.querySelectorAll('span[data-testid^="convo-pill-"]'));
                sessionRows = pills.map(pill => pill.closest('div[role="button"]')).filter(Boolean);
            }

            // 兼容兜底：侧边栏会话链接 a[href^="/c/"]
            if (sessionRows.length === 0) {
                const links = Array.from(document.querySelectorAll('.bg-sidebar a[href^="/c/"], [data-testid="conversation-list-sidebar"] a[href^="/c/"]'));
                sessionRows = links.map(a => a.closest('[data-testid="conversation-row-sidebar"]') || a.parentElement || a);
            }

            if (sessionRows.length === 0) return;

            const now = Date.now();
            let currentIndex = -1;

            // 如果在 600ms 内连续按下 Ctrl+Tab，优先使用上一次计算的目标索引
            if (now - lastNavigatedTime < 600 && lastNavigatedIndex >= 0 && lastNavigatedIndex < sessionRows.length) {
                currentIndex = lastNavigatedIndex;
            } else {
                // 2. 找到当前处于 active/selected 状态的会话索引
                // 特征：data-selected="true" 或拥有 bg-sidebar-secondary 类名
                currentIndex = sessionRows.findIndex(row => {
                    if (row.getAttribute('data-selected') === 'true') return true;
                    if (row.classList.contains('bg-sidebar-secondary')) return true;
                    return false;
                });

                // 降级兜底：通过 URL 路径和 data-cascade-id / a[href] 匹配
                if (currentIndex === -1) {
                    const currentPath = window.location.pathname;
                    currentIndex = sessionRows.findIndex(row => {
                        const link = row.querySelector('a') || (row.tagName === 'A' ? row : null);
                        const href = link?.getAttribute('href');
                        if (href && (currentPath === href || currentPath.startsWith(href))) return true;
                        const cascadeId = row.getAttribute('data-cascade-id');
                        if (cascadeId && currentPath.includes(cascadeId)) return true;
                        return false;
                    });
                }
            }

            let nextIndex = 0;
            if (currentIndex !== -1) {
                if (e.shiftKey) {
                    // Ctrl + Shift + Tab：上一个
                    nextIndex = currentIndex - 1;
                    if (nextIndex < 0) nextIndex = sessionRows.length - 1;
                } else {
                    // Ctrl + Tab：下一个
                    nextIndex = currentIndex + 1;
                    if (nextIndex >= sessionRows.length) nextIndex = 0;
                }
            }

            lastNavigatedIndex = nextIndex;
            lastNavigatedTime = now;

            const nextRow = sessionRows[nextIndex];
            if (!nextRow) return;

            // 3. 触发导航跳转
            const link = nextRow.querySelector('a') || (nextRow.tagName === 'A' ? nextRow : null);
            const targetHref = link ? link.getAttribute('href') : null;
            const cascadeId = nextRow.getAttribute('data-cascade-id');
            const targetPath = targetHref ? targetHref.split('?')[0] : (cascadeId ? `/c/${cascadeId}` : null);

            let navigated = false;

            // 方案 1：最高优先级 - 利用 Antigravity 宿主 TanStack Router (window.__TSR_ROUTER__) 官方客户端路由驱动
            if (targetPath && window.__TSR_ROUTER__ && typeof window.__TSR_ROUTER__.navigate === 'function') {
                try {
                    window.__TSR_ROUTER__.navigate({ to: targetPath });
                    navigated = true;
                } catch (err) {
                    console.warn('[SessionSwitcher] TanStack Router 导航失败，尝试降级:', err);
                }
            }

            // 方案 2：利用 React Fiber 树调用链接绑定的 onClick 处理函数
            if (!navigated && link) {
                try {
                    const fiberKey = Object.keys(link).find(k => k.startsWith('__reactFiber$'));
                    if (fiberKey) {
                        let p = link[fiberKey];
                        while (p) {
                            if (typeof p.memoizedProps?.onClick === 'function') {
                                p.memoizedProps.onClick({
                                    defaultPrevented: false,
                                    preventDefault: () => {},
                                    stopPropagation: () => {},
                                    button: 0,
                                    ctrlKey: false,
                                    metaKey: false,
                                    shiftKey: false,
                                    altKey: false
                                });
                                navigated = true;
                                break;
                            }
                            p = p.return;
                        }
                    }
                } catch (err) {
                    console.warn('[SessionSwitcher] React Fiber onClick 触发失败:', err);
                }
            }

            // 方案 3：原生 DOM 点击降级
            if (!navigated) {
                if (link && typeof link.click === 'function') {
                    link.click();
                } else if (typeof nextRow.click === 'function') {
                    nextRow.click();
                }
            }

            // 4. 保证目标条目在侧边栏视野内
            nextRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, true); // 使用 true 捕获阶段，防止被 Electron 或 React 的其他逻辑拦截
}
