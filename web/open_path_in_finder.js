// open_path_in_finder.js
import { openFileInFinderBackend } from './api.js';

export function initOpenPathInFinder() {
    console.log('[Antigravity Mod] Fiber 终极黑客版 Open Path In Finder 已上线...');

    const menu = document.createElement('div');
    menu.id = 'ag-row-context-menu';
    menu.style.position = 'fixed';
    menu.style.display = 'none';
    menu.style.zIndex = '999999';
    menu.style.backgroundColor = 'hsl(var(--popover) / 1)';
    menu.style.border = '1px solid hsl(var(--border) / 1)';
    menu.style.borderRadius = '8px';
    menu.style.padding = '4px';
    menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    menu.style.color = 'hsl(var(--popover-foreground) / 1)';
    menu.style.fontSize = '13px';
    menu.style.minWidth = '160px';
    menu.style.backdropFilter = 'blur(10px)';
    
    const menuItem = document.createElement('div');
    menuItem.innerHTML = `<span style="opacity: 0.7; margin-right: 8px;">📂</span> 在 Finder 中打开`;
    menuItem.style.padding = '6px 12px';
    menuItem.style.borderRadius = '4px';
    menuItem.style.cursor = 'pointer';
    menuItem.style.transition = 'all 0.2s ease';
    menuItem.style.display = 'flex';
    menuItem.style.alignItems = 'center';
    
    menuItem.addEventListener('mouseenter', () => {
        menuItem.style.backgroundColor = '#3186FF';
        menuItem.style.color = '#FFFFFF';
    });
    menuItem.addEventListener('mouseleave', () => {
        menuItem.style.backgroundColor = 'transparent';
        menuItem.style.color = 'inherit';
    });

    menu.appendChild(menuItem);
    document.body.appendChild(menu);

    let currentTargetAbsolutePath = '';

    menuItem.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        
        if (currentTargetAbsolutePath) {
            /*
             * [Bug Fix Document]
             * 1. Problem: The code unconditionally truncated the last segment of the path, incorrectly treating all paths as files. This broke directory opening.
             * 2. Method: Added a check (`lastSegment.includes('.')`). Only segments containing a period (extension) are treated as files and truncated to yield the parent directory.
             * 3. Caveat: This heuristic might fail if a directory contains a period in its name or if a file lacks an extension.
             */
            // 根据是否有拓展名来判断是否需要截断文件名保留目录
            let dirPath = currentTargetAbsolutePath;
            if (currentTargetAbsolutePath.includes('/')) {
                const lastSegment = currentTargetAbsolutePath.substring(currentTargetAbsolutePath.lastIndexOf('/') + 1);
                if (lastSegment.includes('.')) {
                    dirPath = currentTargetAbsolutePath.substring(0, currentTargetAbsolutePath.lastIndexOf('/'));
                }
            }
            
            console.log(`[Antigravity Mod] Fiber 提取路径成功: ${currentTargetAbsolutePath}`);
            console.log(`[Antigravity Mod] 准备打开目录: ${dirPath}`);
            
            openFileInFinderBackend('', '', dirPath || currentTargetAbsolutePath);
        }
    });

    document.addEventListener('click', () => {
        if (menu.style.display === 'block') menu.style.display = 'none';
    });
    window.addEventListener('scroll', () => {
        if (menu.style.display === 'block') menu.style.display = 'none';
    }, true);

    // ==========================================
    // 核心魔法：从 React Fiber 树中逆向提取绝对路径
    // ==========================================
    function findAbsolutePathInFiber(el, targetFileName) {
        let current = el;
        while (current) {
            const fiberKey = Object.keys(current).find(k => k.startsWith('__reactFiber$'));
            if (fiberKey) {
                let fiber = current[fiberKey];
                let attempts = 0;
                
                while (fiber && attempts < 20) {
                    if (fiber.memoizedProps) {
                        let foundPath = null;
                        function safeFind(obj, maxDepth = 4, currentDepth = 0, visited = new Set()) {
                            if (!obj || typeof obj !== 'object' || currentDepth > maxDepth || visited.has(obj) || foundPath) return;
                            visited.add(obj);

                            const keys = Object.keys(obj);
                            if (keys.length > 50) return;

                            for (const key of keys) {
                                if (key.startsWith('__') || key === 'children' || key === 'parent' || key === 'owner' || key === 'store') continue;
                                const val = obj[key];
                                // 如果找到了一个绝对路径字符串，并且以目标文件名结尾
                                if (typeof val === 'string' && val.startsWith('/') && val.endsWith(targetFileName) && !val.includes('<')) {
                                    foundPath = val;
                                    return;
                                }
                                if (val && typeof val === 'object') {
                                    safeFind(val, maxDepth, currentDepth + 1, visited);
                                }
                            }
                        }
                        safeFind(fiber.memoizedProps);
                        if (foundPath) {
                            console.log('[Antigravity Mod] 成功在 Fiber 中提取到绝对路径:', foundPath);
                            return foundPath;
                        }
                    }
                    fiber = fiber.return;
                    attempts++;
                }
            }
            current = current.parentElement;
        }
        return null;
    }

    /*
     * [Bug Fix Document]
     * 1. Problem: The absolute path of the file could not be reliably extracted from the DOM text content due to truncation (e.g., `...`), and the official "Copy Path" button is conditionally rendered (only exists on hover), making right-click interception fail.
     * 2. Method: Implemented `findAbsolutePathInFiber`, which traverses the React Fiber tree (`__reactFiber$`) starting from the clicked element. It searches up to 20 levels deep in `memoizedProps` for a string that starts with `/` and ends with the known filename.
     * 3. Caveat: React Fiber structures can change between React versions. The search depth is capped at 20, and object key traversal is limited to prevent infinite loops. If the directory structure or UI changes significantly, this logic may need adjustment.
     */
    document.addEventListener('contextmenu', (e) => {
        const path = e.composedPath();
        
        // 寻找外层行容器
        const rowElement = path.find(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            (node.tagName === 'BUTTON' || 
             node.getAttribute?.('role') === 'button' || 
             node.classList?.contains('group') ||
             node.classList?.contains('cursor-pointer'))
        );

        if (!rowElement) return;

        const rowText = rowElement.textContent.trim();
        if (!rowText || rowText.length < 3 || rowText.length > 300) return;
        if (rowText.includes('files changed') || rowText === 'Review') return;

        let finalAbsolutePath = '';

        // 尝试 1：直接在文本里找绝对路径
        const dirMatch = rowText.match(/(\/[^\s]+\/[^\s]+)/);
        if (dirMatch) {
            /*
             * [Bug Fix Document]
             * 1. Problem: Git diff line change indicators (e.g., `+3-1`) appended to the path text without spaces were being captured by the regex `[^\s]+` as part of the directory path.
             * 2. Method: Used `.replace(/([+-]\d+)+$/, '')` to explicitly strip trailing Git line change markers from the extracted string.
             * 3. Caveat: If a genuine file or directory ends with `+` or `-` followed by digits (e.g., `folder-1`), it will be incorrectly stripped.
             */
            // 清理末尾可能粘连的 Git 行号变更标识，如 +3-1
            finalAbsolutePath = dirMatch[1].replace(/([+-]\d+)+$/, '');
        } 
        // 尝试 2：文本里只有文件名，求助 Fiber 大法
        else {
            const fileMatch = rowText.match(/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/);
            if (fileMatch) {
                const fileName = fileMatch[1];
                finalAbsolutePath = findAbsolutePathInFiber(rowElement, fileName);
            }
        }

        if (finalAbsolutePath) {
            e.preventDefault();
            e.stopPropagation();
            
            currentTargetAbsolutePath = finalAbsolutePath;
            
            menu.style.display = 'block';
            let x = e.clientX;
            let y = e.clientY;
            if (x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth - 8;
            if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight - 8;
            menu.style.left = `${x}px`;
            menu.style.top = `${y}px`;
        }
    }, { capture: true });

    /*
     * [Bug Fix Document]
     * 1. Problem: The "Open in Finder" tooltip (title attribute) was triggering on too many unrelated UI elements because it only checked for broad properties like `button` tags or `cursor-pointer` classes on hover.
     * 2. Method: Added a lightweight text content validation inside the `mouseover` handler. The tooltip is now only applied if the text contains an absolute directory path pattern (e.g., `/a/b/c`).
     * 3. Caveat: If the UI changes to display paths without the absolute directory pattern in text, this tooltip might not appear on hover. The regex is a heuristic and relies on the text format of the path.
     */
    // 鼠标悬停提示
    document.addEventListener('mouseover', (e) => {
        const path = e.composedPath();
        const rowElement = path.find(node => 
            node.nodeType === Node.ELEMENT_NODE && 
            (node.tagName === 'BUTTON' || node.getAttribute?.('role') === 'button' || node.classList?.contains('group') || node.classList?.contains('cursor-pointer'))
        );

        if (!rowElement) return;
        
        const rowText = rowElement.textContent ? rowElement.textContent.trim() : "";
        if (!rowText || rowText.length < 3 || rowText.length > 300) return;
        if (rowText.includes('files changed') || rowText === 'Review') return;

        // 仅匹配类似绝对目录的路径（例如：/a/b/c）
        const hasPath = /(\/[^\s]+\/[^\s]+)/.test(rowText);

        if (hasPath && !rowElement.dataset.agContextReady) {
            rowElement.dataset.agContextReady = "true";
            rowElement.title = "尝试右键点击可在 Finder 中打开该文件"; 
        }
    });
}
