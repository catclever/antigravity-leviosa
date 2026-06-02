// ==========================================
// 🚀 Antigravity IDE - 本地应用打开配置区
// ==========================================
// 定义可用的 IDE 选项
// 图标(icon)支持任意 HTML，例如：
// - SVG 代码: `<svg>...</svg>`
// - 图片文件: `<img src="https://example.com/icon.png" class="w-full h-full object-contain" />`
// - Emoji 图标: `🍎` 或者 `💻`
export const CONFIG = {
    // 默认选中的应用 ID
    defaultAppId: 'vscode',
    
    // 是否强制将原版按钮的文字改为 "Open in"
    renameNativeButton: true,

    // 支持的应用列表，可随意增加或修改！
    // name: 下拉列表展示的名字
    // icon: 可以是任意 SVG 代码，或者 emoji 比如 "💻"
    // appName: 传给后端 api 打开的具体 macOS App 名称
    // supportsWorkspace: 是否支持多目录工作区模式 (VS Code 支持)
    // isWeb: 是否是原版的云端 IDE
    apps: [
        { 
            id: 'web', 
            name: 'Antigravity', 
            isWeb: true,
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#3186FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`
        },
        { 
            id: 'vscode', 
            name: 'VS Code', 
            appName: 'Visual Studio Code', 
            supportsWorkspace: true,
            icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M23 18.5986L17.5 22.0986L2 15.0986L6.5 12.0986L2 9.09863L17.5 2.09863L23 5.59863V18.5986Z" fill="#0065A9"/><path d="M17.5 2.09863V22.0986L23 18.5986V5.59863L17.5 2.09863Z" fill="#007ACC"/><path d="M6.5 12.0986L17.5 22.0986V13.0986L6.5 12.0986Z" fill="#1F9CF0"/><path d="M6.5 12.0986L17.5 2.09863V11.0986L6.5 12.0986Z" fill="#1F9CF0"/></svg>`
        },
        { 
            id: 'kitty', 
            name: 'Kitty', 
            appName: 'kitty',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="3" width="20" height="18" rx="2" ry="2"></rect><polyline points="8 9 12 13 8 17"></polyline><line x1="13" y1="17" x2="18" y2="17"></line></svg>`
        },
        { 
            id: 'finder', 
            name: 'Finder', 
            appName: 'Finder',
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
        }
    ]
};
// ==========================================

import { openProjectBackend } from './api.js';

let currentProject = "";
let selectedApp = CONFIG.apps.find(app => app.id === CONFIG.defaultAppId) || CONFIG.apps.find(app => !app.isWeb) || CONFIG.apps[0];
let appSelectorMenu = null;

if (!window._ag_global_listener_added_v5) {
    window._ag_global_listener_added_v5 = true;
    document.addEventListener('click', (e) => {
        if (e.target.closest('.ag-dropdown-menu')) return;
        
        if (appSelectorMenu && appSelectorMenu.style.display !== 'none' && !e.target.closest('#ag-app-selector-btn')) {
            appSelectorMenu.style.display = 'none';
        }

        if (selectedApp.isWeb) return;

        const btn = e.target.closest('[data-testid^="open-editor"]');
        if (btn && btn.id !== 'ag-app-selector-btn') {
            if (!btn.hasAttribute('aria-haspopup') && !(btn.getAttribute('data-testid') || '').includes('multi')) {
                e.preventDefault();
                e.stopPropagation();
                const proj = extractActiveProjectName() || currentProject;
                openProjectBackend(proj, selectedApp.appName, !!selectedApp.supportsWorkspace);
                window._ag_is_waiting_for_multi_project_selection = false;
            } else {
                window._ag_is_waiting_for_multi_project_selection = true;
            }
            return;
        }

        const popup = e.target.closest('[role="listbox"], [role="menu"]');
        if (popup && !popup.classList.contains('ag-dropdown-menu')) {
            const option = e.target.closest('[role="option"], [role="menuitem"]');
            if (option) {
                if (window._ag_is_waiting_for_multi_project_selection || popup.getAttribute('role') === 'listbox') {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    let projectName = '';
                    const span = option.querySelector('span.truncate');
                    if (span) {
                        projectName = span.textContent.trim();
                    } else {
                        const spans = Array.from(option.querySelectorAll('span')).filter(s => s.textContent.trim() && !s.querySelector('svg'));
                        projectName = spans.length > 0 ? spans[spans.length - 1].textContent.trim() : option.textContent.trim();
                    }
                    
                    if (projectName) {
                        openProjectBackend(projectName, selectedApp.appName, !!selectedApp.supportsWorkspace);
                    }
                    setTimeout(() => { document.body.click(); }, 10);
                }
            }
        }
        
        if (!e.target.closest('[role="listbox"], [role="menu"]') && !e.target.closest('[data-testid^="open-editor"]')) {
            window._ag_is_waiting_for_multi_project_selection = false;
        }
    }, true); 
}

function showAppSelector(anchorElement) {
    if (appSelectorMenu && appSelectorMenu.style.display !== 'none') {
        appSelectorMenu.style.display = 'none';
        return;
    }

    if (!appSelectorMenu) {
        if (!document.getElementById('ag-dropdown-styles')) {
            const style = document.createElement('style');
            style.id = 'ag-dropdown-styles';
            style.textContent = `
                @keyframes slideIn { 0% { opacity: 0; transform: translateY(-8px) scaleY(0.95); } 100% { opacity: 1; transform: translateY(0) scaleY(1); } }
                .animate-slideIn { animation: slideIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
            `;
            document.head.appendChild(style);
        }

        appSelectorMenu = document.createElement('div');
        appSelectorMenu.className = 'ag-dropdown-menu border rounded-lg bg-card text-foreground shadow-lg animate-slideIn origin-top min-w-[150px]';
        appSelectorMenu.setAttribute('role', 'listbox');
        
        const wrapper = document.createElement('div');
        wrapper.className = 'py-1 overflow-auto flex flex-col overscroll-y-none max-h-60';
        appSelectorMenu.appendChild(wrapper);
        
        CONFIG.apps.forEach(app => {
            const item = document.createElement('button');
            item.className = 'w-full text-left whitespace-nowrap transition-colors duration-150 select-none flex items-center gap-2 px-3 py-2 text-[13px] focus-visible:bg-secondary/50 focus:outline-none no-focus-ring cursor-pointer text-secondary-foreground hover:bg-secondary/50 hover:text-foreground';
            item.setAttribute('role', 'option');
            
            const iconHtml = app.isWeb 
                ? `<div class="w-4 h-4 flex items-center justify-center">${app.icon}</div>` 
                : `<span class="flex-shrink-0 w-4 h-4 flex items-center justify-center text-base">${app.icon}</span>`;
            
            item.innerHTML = `<div class="flex items-center gap-2 w-full">${iconHtml}<span class="truncate">${app.name}</span></div>`;
            
            item.onclick = (ev) => {
                ev.stopPropagation();
                appSelectorMenu.style.display = 'none';
                selectedApp = app;
                updateSelectorButton();
            };
            wrapper.appendChild(item);
        });
        document.body.appendChild(appSelectorMenu);
    }
    
    const rect = anchorElement.getBoundingClientRect();
    appSelectorMenu.style.cssText = `
        position: fixed;
        top: ${rect.bottom + 8}px;
        right: ${window.innerWidth - rect.right}px;
        z-index: 3000;
        display: block;
    `;
}

function updateSelectorButton() {
    const btn = document.getElementById('ag-app-selector-btn');
    if (btn) {
        btn.innerHTML = `<span class="flex items-center justify-center w-4 h-4">${selectedApp.icon}</span> <span class="text-[10px] opacity-50 ml-1">▼</span>`;
    }
}

function extractActiveProjectName() {
    const spans = Array.from(document.querySelectorAll('span.truncate.inline-block'));
    
    // 1. 优先尝试多目录模式：寻找后面跟着 '/' 的 span
    for (let i = spans.length - 1; i >= 0; i--) {
        const span = spans[i];
        const rect = span.getBoundingClientRect();
        if (rect.width === 0) continue; 
        
        const parent = span.parentElement;
        if (parent) {
            const nextSibling = parent.nextElementSibling;
            if (nextSibling && nextSibling.textContent.trim() === '/') {
                return span.textContent.trim();
            }
        }
    }
    
    // 2. 降级：单目录模式。直接取最后一个可见的 truncate span
    for (let i = spans.length - 1; i >= 0; i--) {
        const span = spans[i];
        const rect = span.getBoundingClientRect();
        if (rect.width === 0) continue; 
        const text = span.textContent.trim();
        if (text && text !== '/') {
            return text;
        }
    }
    
    return null;
}

function captureNativeIdeAnchor() {
    const btns = Array.from(document.querySelectorAll('[data-testid^="open-editor"]'));
    for (let i = btns.length - 1; i >= 0; i--) {
        const btn = btns[i];
        if (btn.getBoundingClientRect().width > 0) return btn;
    }
    return null;
}

function maintainSelectorButton() {
    const nativeBtn = captureNativeIdeAnchor();
    if (!nativeBtn) return;

    if (CONFIG.renameNativeButton) {
        if (!document.getElementById('ag-pure-css-overrides')) {
            const style = document.createElement('style');
            style.id = 'ag-pure-css-overrides';
            style.textContent = `
                /* 1. 强制隐藏原生按钮自带的图标 (第一个包含 SVG 的 div) */
                [data-testid^="open-editor"] > div:first-child {
                    display: none !important;
                }
                
                /* 2. 隐藏多目录模式下的 span 文字 */
                [data-testid^="open-editor"] > span {
                    display: none !important;
                }
                
                /* 3. 修改原版按钮 (视觉左侧)：隐藏裸露文字、合体、调整间距 */
                [data-testid^="open-editor"] {
                    font-size: 0 !important;          /* 隐藏单目录下的裸露文字 */
                    border-top-right-radius: 0 !important;
                    border-bottom-right-radius: 0 !important;
                    border-right-width: 0 !important; /* 去掉右边框 */
                    padding-right: 6px !important;    /* 拉近内部距离 */
                }
                
                /* 4. 重新注入 "Open in" 文字 */
                [data-testid^="open-editor"]::after {
                    content: "Open in";
                    font-size: 13px !important;
                    visibility: visible !important;
                    order: 1; /* 确保文字排在可能存在的箭头前面 */
                }
                
                /* 5. 确保多目录下的原生下拉箭头排在文字后面 */
                [data-testid^="open-editor"] > svg {
                    order: 2;
                }
                
                /* 6. 自定义按钮 (视觉右侧) 完美合体 */
                #ag-app-selector-btn {
                    border-top-left-radius: 0 !important;
                    border-bottom-left-radius: 0 !important;
                    border-left-width: 0 !important;  /* 彻底干掉中间的接缝线 */
                    border-top-right-radius: 6px !important;
                    border-bottom-right-radius: 6px !important;
                    padding-left: 6px !important;     /* 拉近距离 */
                    margin: 0 !important;
                    height: 24px !important;
                }
            `;
            document.head.appendChild(style);
        }
    }

    let btn = document.getElementById('ag-app-selector-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'ag-app-selector-btn';
        // 基础样式，边框和圆角等由 CSS 统一控制覆盖
        btn.className = 'flex items-center px-2 py-1.5 border border-border bg-background text-foreground shadow-sm hover:bg-secondary/80 transition-colors cursor-pointer';
        
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showAppSelector(btn);
        };
        
        if (nativeBtn.parentElement) {
            // 放在原生按钮的右侧
            nativeBtn.after(btn);
        }
        updateSelectorButton();
    } else {
        if (btn.previousElementSibling !== nativeBtn && nativeBtn.parentElement) {
            nativeBtn.after(btn);
        }
    }
}

export function initProjectOpener() {
    const checkAndInject = () => {
        const foundProject = extractActiveProjectName();
        if (foundProject) {
            currentProject = foundProject;
        }
        maintainSelectorButton();
    };

    const observer = new MutationObserver(checkAndInject);
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(checkAndInject, 800);
    setTimeout(checkAndInject, 2000);
}
