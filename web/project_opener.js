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

        const btn = e.target.closest('[data-testid^="open-editor"], [data-testid="install-editor"]');
        if (btn && btn.id !== 'ag-app-selector-btn') {
            e.preventDefault();
            e.stopPropagation();
            
            const uuid = extractActiveUUID();
            const proj = extractActiveProjectName() || currentProject;
            
            // Add a simple loading state to the button
            const originalHtml = btn.innerHTML;
            btn.style.opacity = '0.5';
            
            fetch(`http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_list_project_dirs?uuid=${uuid || ''}&project=${encodeURIComponent(proj || '')}`)
                .then(res => res.json())
                .then(data => {
                    btn.style.opacity = '1';
                    if (data.success && data.paths && data.paths.length > 1) {
                        showSubProjectSelector(btn, proj, data.paths, uuid);
                    } else {
                        openProjectBackend(proj, selectedApp.appName, !!selectedApp.supportsWorkspace, uuid);
                    }
                })
                .catch(err => {
                    btn.style.opacity = '1';
                    openProjectBackend(proj, selectedApp.appName, !!selectedApp.supportsWorkspace, uuid);
                });
            return;
        }
    }, true); 
}

let subProjSelectorMenu = null;
function showSubProjectSelector(anchorElement, repoName, paths, uuid) {
    if (subProjSelectorMenu) {
        subProjSelectorMenu.remove();
    }
    
    subProjSelectorMenu = document.createElement('div');
    subProjSelectorMenu.className = 'ag-dropdown-menu border rounded-lg bg-card text-foreground shadow-lg animate-slideIn origin-top min-w-[150px]';
    subProjSelectorMenu.setAttribute('role', 'listbox');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'py-1 overflow-auto flex flex-col overscroll-y-none max-h-60';
    subProjSelectorMenu.appendChild(wrapper);
    
    paths.forEach(p => {
        const basename = p.split('/').pop();
        const item = document.createElement('button');
        item.className = 'w-full text-left whitespace-nowrap transition-colors duration-150 select-none flex items-center gap-2 px-3 py-2 text-[13px] focus-visible:bg-secondary/50 focus:outline-none no-focus-ring cursor-pointer text-secondary-foreground hover:bg-secondary/50 hover:text-foreground';
        item.setAttribute('role', 'option');
        
        // Add a generic folder icon
        const folderIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="opacity-70"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-1.22-1.8A2 2 0 0 0 8.4 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>`;
        item.innerHTML = `<div class="flex items-center gap-2 w-full"><div class="flex-shrink-0 flex items-center justify-center">${folderIcon}</div><span class="truncate">${basename}</span></div>`;
        
        item.onclick = (ev) => {
            ev.stopPropagation();
            subProjSelectorMenu.style.display = 'none';
            const queryProj = (repoName && repoName !== basename) ? `${repoName}/${basename}` : basename;
            openProjectBackend(queryProj, selectedApp.appName, !!selectedApp.supportsWorkspace, uuid);
        };
        wrapper.appendChild(item);
    });
    
    document.body.appendChild(subProjSelectorMenu);
    
    const rect = anchorElement.getBoundingClientRect();
    subProjSelectorMenu.style.cssText = `
        position: fixed;
        top: ${rect.bottom + 8}px;
        right: ${window.innerWidth - rect.right}px;
        z-index: 3000;
        display: block;
    `;
    
    const closeListener = (e) => {
        if (!e.target.closest('.ag-dropdown-menu')) {
            if (subProjSelectorMenu) subProjSelectorMenu.style.display = 'none';
            document.removeEventListener('click', closeListener, true);
        }
    };
    // Use a small timeout so the current click doesn't immediately close it
    setTimeout(() => {
        document.addEventListener('click', closeListener, true);
    }, 10);
}

function showAppSelector(anchorElement) {
    if (appSelectorMenu && appSelectorMenu.style.display !== 'none') {
        appSelectorMenu.style.display = 'none';
        return;
    }

    if (appSelectorMenu) {
        appSelectorMenu.remove();
        appSelectorMenu = null;
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
        
        const nativeBtn = captureNativeIdeAnchor();
        const isInstall = nativeBtn && nativeBtn.getAttribute('data-testid') === 'install-editor';
        const availableApps = CONFIG.apps.filter(app => !(app.id === 'web' && isInstall));
        
        availableApps.forEach(app => {
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
                
                // 选中后自动触发一次原生的 Open In 按钮
                const nativeBtn = captureNativeIdeAnchor();
                if (nativeBtn) {
                    nativeBtn.click();
                }
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

export function extractActiveProjectName() {
    // 0. 尝试新版 UI 提取
    const trigger = document.querySelector('[data-testid="project-selector-trigger"]');
    if (trigger) {
        const ariaLabel = trigger.getAttribute('aria-label') || '';
        const match = ariaLabel.match(/current:\s*(.+)$/);
        if (match && match[1]) {
            return match[1].trim();
        }
        const span = trigger.querySelector('span.truncate');
        if (span && span.textContent.trim()) {
            return span.textContent.trim();
        }
    }

    // 1. 优先尝试从面包屑 (breadcrumb) 中提取，第一个面包屑通常就是项目根目录
    const breadcrumbSegments = Array.from(document.querySelectorAll('span[data-testid="breadcrumb-segment"] .truncate'));
    if (breadcrumbSegments.length > 0) {
        for (const segment of breadcrumbSegments) {
            const rect = segment.getBoundingClientRect();
            if (rect.width > 0) {
                return segment.textContent.trim();
            }
        }
    }

    const spans = Array.from(document.querySelectorAll('span.truncate.inline-block'));
    
    // 2. 兼容旧版多目录模式：寻找后面跟着 '/' 的 span，正向遍历找到第一个
    for (let i = 0; i < spans.length; i++) {
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
    
    // 3. 降级：单目录模式。直接取最后一个可见的 truncate span
    let result = null;
    for (let i = spans.length - 1; i >= 0; i--) {
        const span = spans[i];
        const rect = span.getBoundingClientRect();
        if (rect.width === 0) continue; 
        const text = span.textContent.trim();
        if (text && text !== '/') {
            result = text;
            break;
        }
    }
    
    if (result) {
        // 过滤掉已知的非项目名称的 UI 文案
        const ignoreList = ['New Chat', '新对话', 'New conversation', 'Untitled', 'Antigravity'];
        if (ignoreList.includes(result)) {
            return null;
        }
    }
    
    return result;
}

export function extractActiveUUID() {
    // 1. Try URL first
    const match = window.location.pathname.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (match) return match[1];

    // 2. Try DOM fallback
    const activeBtn = document.querySelector('div[role="button"].bg-sidebar-secondary');
    if (activeBtn) {
        const pill = activeBtn.querySelector('span[data-testid^="convo-pill-"]');
        if (pill) {
            return pill.getAttribute('data-testid').replace('convo-pill-', '');
        }
    }
    return null;
}

function captureNativeIdeAnchor() {
    const btns = Array.from(document.querySelectorAll('[data-testid^="open-editor"], [data-testid="install-editor"]'));
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
                [data-testid^="open-editor"] > div:first-child,
                [data-testid="install-editor"] > div:first-child {
                    display: none !important;
                }
                
                /* 2. 隐藏多目录模式下的 span 文字 */
                [data-testid^="open-editor"] > span,
                [data-testid="install-editor"] > span {
                    display: none !important;
                }
                
                /* 3. 修改原版按钮 (视觉左侧)：隐藏裸露文字、合体、调整间距 */
                [data-testid^="open-editor"],
                [data-testid="install-editor"] {
                    font-size: 0 !important;          /* 隐藏单目录下的裸露文字 */
                    border-top-right-radius: 0 !important;
                    border-bottom-right-radius: 0 !important;
                    border-right-width: 0 !important; /* 去掉右边框 */
                    padding-right: 6px !important;    /* 拉近内部距离 */
                }
                
                /* 4. 重新注入 "Open in" 文字 */
                [data-testid^="open-editor"]::after,
                [data-testid="install-editor"]::after {
                    content: "Open in";
                    font-size: 13px !important;
                    visibility: visible !important;
                    order: 1; /* 确保文字排在可能存在的箭头前面 */
                }
                
                /* 5. 确保多目录下的原生下拉箭头排在文字后面 */
                [data-testid^="open-editor"] > svg,
                [data-testid="install-editor"] > svg {
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
