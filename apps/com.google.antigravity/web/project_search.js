// project_search.js

export function initProjectSearch() {
    console.log('🔍 [Antigravity Mod] 初始化项目搜索功能');

    function injectSearchBox(dialog) {
        // 防止重复注入
        if (dialog.querySelector('.ag-search-input-container')) return;

        const container = document.createElement('div');
        container.className = 'ag-search-input-container';
        container.style.cssText = `
            padding: 8px;
            border-bottom: 1px solid var(--border, #e5e7eb);
            background: var(--background, #fff);
            border-top-left-radius: 8px;
            border-top-right-radius: 8px;
            position: sticky;
            top: 0;
            z-index: 10;
        `;

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '🔍 搜索项目...';
        input.className = 'ag-search-input';
        input.style.cssText = `
            width: 100%;
            padding: 6px 12px;
            border-radius: 4px;
            border: 1px solid var(--border, #ccc);
            background: var(--input, transparent);
            color: var(--foreground, inherit);
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        `;
        
        input.onfocus = () => input.style.borderColor = 'var(--ring, #888)';
        input.onblur = () => input.style.borderColor = 'var(--border, #ccc)';

        // 阻止按键事件冒泡，防止触发 React 的快捷键（比如空格、回车导致弹窗关闭）
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                // 如果按下回车，自动点击第一个可见的选项
                const visibleItem = Array.from(dialog.querySelectorAll('button.group\\/popover-item')).find(item => item.style.display !== 'none');
                if (visibleItem) {
                    visibleItem.click();
                }
            }
        });

        // 过滤逻辑
        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const items = dialog.querySelectorAll('button.group\\/popover-item');
            
            items.forEach(item => {
                // 只匹配项目名字段（span.truncate），排除后面的设置按钮 title
                const nameSpan = item.querySelector('span.truncate');
                const text = nameSpan ? nameSpan.textContent.toLowerCase() : item.textContent.toLowerCase();
                
                if (text.includes(query)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        });

        container.appendChild(input);
        
        // 将搜索框插入到 dialog 的最前面 (即列表之上)
        dialog.prepend(container);
        
        // 自动聚焦
        setTimeout(() => input.focus(), 50);
    }

    // BUG FIX RECORD
    // 1. Problem fixed: 搜索框会错误地注入到所有包含 `button.group/popover-item` 的下拉菜单中，而不仅仅是项目列表菜单。
    // 2. Method/Logic: 使用用户提供的带有超长原子化类名的精细 CSS 选择器（包含 bg-card, w-72, min-w-[200px] 等），替代之前宽泛的 `div[role="dialog"]` 作为过滤条件，精确匹配特有的弹窗。
    // 3. Caveats: 由于直接依赖 Tailwind 生成的超长类名字符串进行精准匹配，如果官方在未来移除了某个特定的 utility class（比如 `translate-x-0.5`），此判断会失效。若失效，可考虑回归使用 `button[title="Project Settings"]` 等内部特有元素的判断策略。
    // 主力方案：监听 DOM 挂载 (处理 Radix UI Portal 类型的弹窗)
    const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
            for (let node of mutation.addedNodes) {
                if (node.nodeType === 1) { // ELEMENT_NODE
                    let dialogs = [];
                    const targetSelector = 'div.bg-card.text-foreground.origin-bottom.outline-hidden.z-50.rounded-lg.border.shadow-md.overscroll-y-none.w-72.border-border.w-max.min-w-\\[200px\\].translate-x-0\\.5';
                    
                    if (node.matches && node.matches(targetSelector)) {
                        dialogs.push(node);
                    }
                    if (node.querySelectorAll) {
                        dialogs.push(...node.querySelectorAll(targetSelector));
                    }

                    for (let dialog of dialogs) {
                        // 只依赖上述的长 CSS 选择器，内部只判断基本的弹窗项特征
                        if (dialog.querySelector('button.group\\/popover-item')) {
                            injectSearchBox(dialog);
                        }
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 备用方案：监听点击事件，处理不销毁只隐藏的弹窗
    document.addEventListener('click', () => {
        setTimeout(() => {
            const targetSelector = 'div.bg-card.text-foreground.origin-bottom.outline-hidden.z-50.rounded-lg.border.shadow-md.overscroll-y-none.w-72.border-border.w-max.min-w-\\[200px\\].translate-x-0\\.5';
            const dialogs = document.querySelectorAll(targetSelector);
            dialogs.forEach(dialog => {
                const style = window.getComputedStyle(dialog);
                if (style.visibility !== 'hidden' && style.display !== 'none') {
                    // 实验：只判断基本的弹窗项特征
                    if (dialog.querySelector('button.group\\/popover-item')) {
                        injectSearchBox(dialog);
                    }
                }
            });
        }, 50); // 稍微延迟等待 React 状态更新
    });
}
