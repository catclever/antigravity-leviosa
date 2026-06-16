// sidebar_reorder.js

export function initSidebarReorder() {
    console.log('👀 [Sidebar Reorder] Module initialized');

    const applyOrder = () => {
        const h2Elements = Array.from(document.querySelectorAll('h2'));
        const pinnedHeader = h2Elements.find(el => el.textContent.includes('Pinned Conversations'));
        const projectsHeader = h2Elements.find(el => el.textContent.includes('Projects'));
        
        if (!pinnedHeader || !projectsHeader) return;

        // 之前误以为它们共用一个 .gap-3，实际上它们各自包裹在一个独立的 .flex-col.gap-3 容器中！
        const pinnedHeaderRow = pinnedHeader.closest('.justify-between');
        const projectsHeaderRow = projectsHeader.closest('.justify-between');
        
        if (!pinnedHeaderRow || !projectsHeaderRow) return;

        const pinnedContainer = pinnedHeaderRow.parentElement; // 这才是 Pinned 的独立容器
        const projectsContainer = projectsHeaderRow.parentElement; // 这才是 Projects 的独立容器

        if (pinnedContainer && projectsContainer) {
            const sidebarContainer = pinnedContainer.parentElement;
            
            if (sidebarContainer && sidebarContainer === projectsContainer.parentElement) {
                // 确保父容器是 Flex 布局，否则 order 不起作用
                // 大多数现代侧边栏默认就是 flex-col，如果不是，我们强制补充一下
                const computedStyle = window.getComputedStyle(sidebarContainer);
                if (computedStyle.display !== 'flex') {
                    sidebarContainer.style.display = 'flex';
                    sidebarContainer.style.flexDirection = 'column';
                }

                // 检查当前的兄弟节点顺序
                const children = Array.from(sidebarContainer.children);
                const pinnedIdx = children.indexOf(pinnedContainer);
                const projectsIdx = children.indexOf(projectsContainer);

                if (pinnedIdx !== -1 && projectsIdx !== -1 && pinnedIdx < projectsIdx) {
                    // Pinned 排在前面，执行调换
                    // 为了绝对不破坏 React Virtual DOM，我们优先采用 CSS Order
                    projectsContainer.style.order = '-1';
                    pinnedContainer.style.order = '1';
                    
                    console.log('✅ [Antigravity Mod] Applied CSS order: Projects moved to top visually.');
                    
                    // 如果由于某些原因 flex 失效，我们作为降级备选，可以使用真实的 DOM 插入
                    // sidebarContainer.insertBefore(projectsContainer, pinnedContainer);
                }
            }
        }
    };

    const observer = new MutationObserver(() => {
        applyOrder();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(applyOrder, 500);
}
