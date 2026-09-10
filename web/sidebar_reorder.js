// sidebar_reorder.js

export function initSidebarReorder() {
    console.log('👀 [Sidebar Collapse] Module initialized');

    if (!document.getElementById('ag-pinned-styles')) {
        const style = document.createElement('style');
        style.id = 'ag-pinned-styles';
        style.innerHTML = `
            .ag-pinned-hidden {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            .ag-pinned-toggle {
                cursor: pointer;
                transition: transform 0.2s;
                opacity: 0.6;
                padding: 4px;
            }
            .ag-pinned-toggle:hover {
                opacity: 1;
            }
            .ag-pinned-toggle.collapsed {
                transform: rotate(-90deg);
            }
        `;
        document.head.appendChild(style);
    }

    let isCollapsed = localStorage.getItem('ag_pinned_collapsed') === 'true';
    let lastVirtualContainer = null;
    let frameRequested = false;
    let dynamicStyle = null;

    let cachedGapHeight = 0;
    let cachedPinnedIdx = 0;
    let cachedConvIdx = -1;

    const parseY = (el) => {
        const match = el.style.transform.match(/translateY\(([-\d.]+)px\)/);
        return match ? parseFloat(match[1]) : 0;
    };

    const applyCollapse = () => {
        const headers = Array.from(document.querySelectorAll('[data-testid="section-header"]'));
        const pinnedHeaderInner = headers.find(el => el.getAttribute('data-title') === 'Pinned Conversations');
        const convHeaderInner = headers.find(el => el.getAttribute('data-title') === 'Conversations');

        if (!dynamicStyle) {
            dynamicStyle = document.createElement('style');
            dynamicStyle.id = 'ag-dynamic-collapse-style';
            document.head.appendChild(dynamicStyle);
        }

        const pinnedHeaderRow = pinnedHeaderInner ? pinnedHeaderInner.closest('[data-index]') : null;
        const convHeaderRow = convHeaderInner ? convHeaderInner.closest('[data-index]') : null;

        if (pinnedHeaderRow && convHeaderRow) {
            cachedPinnedIdx = parseInt(pinnedHeaderRow.getAttribute('data-index'));
            cachedConvIdx = parseInt(convHeaderRow.getAttribute('data-index'));
            
            const pinnedY = parseY(pinnedHeaderRow);
            const convY = parseY(convHeaderRow);
            const headerHeight = pinnedHeaderRow.getBoundingClientRect().height || pinnedHeaderRow.offsetHeight || 28;
            
            // 间距 = Conversations顶部Y - Pinned顶部Y - Pinned标题自身高度
            cachedGapHeight = convY - pinnedY - headerHeight;
            lastVirtualContainer = pinnedHeaderRow.parentElement;
        } else if (pinnedHeaderRow) {
            cachedPinnedIdx = parseInt(pinnedHeaderRow.getAttribute('data-index'));
            lastVirtualContainer = pinnedHeaderRow.parentElement;
        }

        if (!lastVirtualContainer) return;

        // 恢复 Pinned Headers 的样式，不加毛玻璃，并取消吸顶（让它可以滚走）
        if (pinnedHeaderRow) {
            pinnedHeaderRow.classList.remove('bg-sidebar');
            pinnedHeaderRow.style.backgroundColor = 'transparent';
            // 强制取消吸顶，转为绝对定位随页面滚动
            pinnedHeaderRow.style.setProperty('position', 'absolute', 'important');
            
            const innerBg = pinnedHeaderRow.querySelector('.bg-sidebar');
            if (innerBg) {
                innerBg.classList.remove('bg-sidebar');
                innerBg.style.backgroundColor = 'transparent';
            }
        }

        // 处理 Conversations Header：完全透明，且强制取消吸顶（让它可以滚走）
        if (convHeaderRow) {
            convHeaderRow.classList.remove('bg-sidebar');
            convHeaderRow.style.backgroundColor = 'transparent';
            // 强制取消吸顶，转为绝对定位随页面滚动
            convHeaderRow.style.setProperty('position', 'absolute', 'important');
            
            const innerBg = convHeaderRow.querySelector('.bg-sidebar');
            if (innerBg) {
                innerBg.classList.remove('bg-sidebar');
                innerBg.style.backgroundColor = 'transparent';
                innerBg.style.backdropFilter = 'none';
                innerBg.style.webkitBackdropFilter = 'none';
                innerBg.style.margin = '0';
            }
        }

        // 注入折叠按钮
        if (pinnedHeaderInner) {
            const titleContainer = pinnedHeaderInner.querySelector('.flex.items-center.justify-between');
            if (titleContainer && !titleContainer.querySelector('.ag-pinned-toggle')) {
                const toggleIcon = document.createElement('div');
                toggleIcon.className = 'ag-pinned-toggle ml-1 flex items-center justify-center rounded hover:bg-secondary';
                toggleIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
                
                if (isCollapsed) toggleIcon.classList.add('collapsed');

                titleContainer.appendChild(toggleIcon);
                
                titleContainer.style.cursor = 'pointer';
                titleContainer.addEventListener('click', (e) => {
                    e.stopPropagation();
                    isCollapsed = !isCollapsed;
                    localStorage.setItem('ag_pinned_collapsed', isCollapsed);
                    toggleIcon.classList.toggle('collapsed', isCollapsed);
                    applyCollapse();
                });
            }
        }

        // 更新动态 CSS 偏移量，利用 margin-top 来改变后续条目的基准线，且不干涉 translateY
        if (isCollapsed && cachedGapHeight > 0) {
            dynamicStyle.innerHTML = `
                .ag-shifted {
                    margin-top: -${cachedGapHeight}px !important;
                }
            `;
        } else {
            dynamicStyle.innerHTML = '';
        }

        // 遍历所有当前渲染的虚拟节点，打上对应的标记
        const children = Array.from(lastVirtualContainer.children);
        
        children.forEach(child => {
            const idx = parseInt(child.getAttribute('data-index'));
            if (isNaN(idx)) return;

            // Pinned 条目隐藏
            if (idx > cachedPinnedIdx && (cachedConvIdx === -1 || idx < cachedConvIdx)) {
                if (isCollapsed) {
                    child.classList.add('ag-pinned-hidden');
                } else {
                    child.classList.remove('ag-pinned-hidden');
                }
                child.classList.remove('ag-shifted');
            } 
            // 后续所有条目向上平移补偿高度
            else if (idx >= cachedConvIdx && cachedConvIdx !== -1) {
                if (isCollapsed) {
                    child.classList.add('ag-shifted');
                } else {
                    child.classList.remove('ag-shifted');
                }
                child.classList.remove('ag-pinned-hidden');
            }
            // Pinned Header 保持原状
            else if (idx === cachedPinnedIdx) {
                child.classList.remove('ag-shifted');
                child.classList.remove('ag-pinned-hidden');
            }
        });
    };

    const throttledApply = () => {
        if (!frameRequested) {
            frameRequested = true;
            requestAnimationFrame(() => {
                applyCollapse();
                frameRequested = false;
            });
        }
    };

    const observer = new MutationObserver(throttledApply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    setTimeout(throttledApply, 500);
}
