/**
 * web/kitty_companion.js
 *
 * KitiGravity Frontend Companion Module:
 * 1. Automatic Kitty installation probe & graceful degradation: hides codeblock and selection quick-send buttons if Kitty is absent
 * 2. Chat text selection floating quick-send button (`🐱 Kitty`) co-existing with `Edit` (`file_editor.js`)
 * 3. Live AI codeblock header quick-send icon button for shell/CLI blocks
 * 4. Per-UUID / Per-Project directory preference coordination (`ag_kitty_dir_pref_v1`) & fixed `MULTI_DIR` picker popover
 */

import { sendToKittyCompanion, checkKittyInstalled } from './api.js';
import { extractActiveProjectName, extractActiveUUID } from './project_opener.js';

const KITTY_DIR_PREF_KEY = 'ag_kitty_dir_pref_v1';
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'shell', 'console', 'terminal', 'fish', '']);

const SELECTION_FORBIDDEN_ANCESTOR_SELECTOR = 'input, textarea, [contenteditable="true"], aside, nav, [role="dialog"]';

// Sleek 12x12 terminal prompt icon (green #22C55E accent) for selection floating bar
const SELECTION_KITTY_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M4 7V5l3 2.2M20 7V5l-3 2.2"/><rect x="2" y="6" width="20" height="15" rx="2.5" ry="2.5"/><polyline points="7.5 11.5 11 14 7.5 16.5"/><line x1="12.5" y1="16.5" x2="16.5" y2="16.5"/></svg>`;

// Crisp 14x14 (h-3.5 w-3.5) cat-ears terminal prompt SVG icon for codeblock headers
const CODEBLOCK_KITTY_ICON_SVG = `<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5V4l3.2 2.5M20 6.5V4l-3.2 2.5"/><rect x="2" y="6.5" width="20" height="14.5" rx="2.5" ry="2.5"/><polyline points="7.5 11.5 11 14 7.5 16.5"/><line x1="12.5" y1="16.5" x2="16.5" y2="16.5"/></svg>`;

const CODEBLOCK_CHECK_ICON_SVG = `<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

let activeMultiDirPopover = null;
let activeMultiDirCleanup = null;
let lastSelectedCommandText = '';
let isSendingKitty = false;

/**
 * Kitty Availability State:
 * null: not probed yet
 * true: Kitty detected on host system
 * false: Kitty not installed or probe failed
 */
let isKittyAvailable = null;

export function _setKittyAvailableForTesting(val) {
    isKittyAvailable = val;
}

export function _getKittyAvailableForTesting() {
    return isKittyAvailable;
}

// ==========================================
// 1. Styles & Lightweight Bottom-Right Toast
// ==========================================
function ensureKittyStyles() {
    if (document.getElementById('ag-kitty-companion-styles')) return;
    const style = document.createElement('style');
    style.id = 'ag-kitty-companion-styles';
    style.textContent = `
        .ag-codeblock-kitty-btn:hover svg {
            stroke: #22C55E !important;
        }
        #ag-kitty-multidir-popover {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .ag-kitty-dir-option {
            transition: background-color 0.14s ease, border-color 0.14s ease;
        }
        .ag-kitty-dir-option:hover {
            background-color: rgba(34, 197, 94, 0.14) !important;
            border-color: rgba(34, 197, 94, 0.35) !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function shortenPathForDisplay(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return '';
    return rawPath.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

export function showKittyToast(message, type = 'success', duration = 2400) {
    const existing = document.getElementById('ag-kitty-companion-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ag-kitty-companion-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '36px';
    toast.style.right = '24px';
    toast.style.zIndex = '999999999';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '500';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';
    toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.5)';
    toast.style.backdropFilter = 'blur(12px)';
    toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    toast.style.opacity = '0';
    toast.style.pointerEvents = 'none';

    if (type === 'success') {
        toast.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
        toast.style.color = '#FFFFFF';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    } else if (type === 'error') {
        toast.style.backgroundColor = 'rgba(239, 68, 68, 0.95)';
        toast.style.color = '#FFFFFF';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    } else {
        toast.style.backgroundColor = 'rgba(30, 41, 59, 0.95)';
        toast.style.color = '#F1F5F9';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    }

    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0) scale(1)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(8px) scale(0.95)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// ==========================================
// 2. Directory Preference Coordination (`ag_kitty_dir_pref_v1`)
// ==========================================
function readKittyDirPrefsStorage() {
    try {
        const raw = localStorage.getItem(KITTY_DIR_PREF_KEY);
        if (!raw) return { byUuid: {}, byProject: {} };
        const parsed = JSON.parse(raw);
        return {
            byUuid: (parsed && typeof parsed.byUuid === 'object' && parsed.byUuid) ? { ...parsed.byUuid } : {},
            byProject: (parsed && typeof parsed.byProject === 'object' && parsed.byProject) ? { ...parsed.byProject } : {}
        };
    } catch (e) {
        return { byUuid: {}, byProject: {} };
    }
}

export function getSavedKittyDir(project = '', uuid = '') {
    try {
        if (
            typeof window !== 'undefined' &&
            window.__agKittyDirPrefs &&
            typeof window.__agKittyDirPrefs.get === 'function' &&
            window.__agKittyDirPrefs.get !== getSavedKittyDir
        ) {
            const fromGlobal = window.__agKittyDirPrefs.get(project, uuid);
            if (typeof fromGlobal === 'string' && fromGlobal.trim()) {
                return fromGlobal.trim();
            }
        }
    } catch (e) {}

    const data = readKittyDirPrefsStorage();
    const cleanUuid = String(uuid || '').trim();
    const baseProj = String(project || '').split('/')[0].trim();

    if (cleanUuid && data.byUuid[cleanUuid]) {
        return String(data.byUuid[cleanUuid]);
    }
    if (baseProj && data.byProject[baseProj]) {
        return String(data.byProject[baseProj]);
    }
    return '';
}

export function saveKittyDir(project = '', uuid = '', dirPath = '') {
    const cleanPath = String(dirPath || '').trim();
    if (!cleanPath) return;

    const data = readKittyDirPrefsStorage();
    const cleanUuid = String(uuid || '').trim();
    const baseProj = String(project || '').split('/')[0].trim();

    if (cleanUuid) {
        data.byUuid[cleanUuid] = cleanPath;
    }
    if (baseProj) {
        data.byProject[baseProj] = cleanPath;
    }

    try {
        localStorage.setItem(KITTY_DIR_PREF_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[KitiGravity] 无法写入目录偏好至 localStorage', e);
    }

    try {
        if (
            typeof window !== 'undefined' &&
            window.__agKittyDirPrefs &&
            typeof window.__agKittyDirPrefs.set === 'function' &&
            window.__agKittyDirPrefs.set !== saveKittyDir
        ) {
            window.__agKittyDirPrefs.set(project, uuid, cleanPath);
        }
    } catch (e) {}
}

// ==========================================
// 3. Multi-Directory Picker Popover (`MULTI_DIR`)
// ==========================================
export function closeKittyMultiDirPopover() {
    if (activeMultiDirCleanup) {
        activeMultiDirCleanup();
        activeMultiDirCleanup = null;
    }
    if (activeMultiDirPopover) {
        activeMultiDirPopover.remove();
        activeMultiDirPopover = null;
    }
}

export function showKittyMultiDirPopover({ anchorRect, paths = [], project = '', uuid = '', onChoose }) {
    closeKittyMultiDirPopover();
    ensureKittyStyles();

    const popover = document.createElement('div');
    popover.id = 'ag-kitty-multidir-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', '选择伴生终端目录');
    popover.style.position = 'fixed';
    popover.style.zIndex = '999999';
    popover.style.minWidth = '260px';
    popover.style.maxWidth = '380px';
    popover.style.backgroundColor = 'rgba(15, 23, 42, 0.96)';
    popover.style.backdropFilter = 'blur(16px)';
    popover.style.webkitBackdropFilter = 'blur(16px)';
    popover.style.color = '#F8FAFC';
    popover.style.border = '1px solid rgba(255, 255, 255, 0.14)';
    popover.style.borderRadius = '10px';
    popover.style.boxShadow = '0 14px 36px rgba(0, 0, 0, 0.65)';
    popover.style.padding = '8px';
    popover.style.boxSizing = 'border-box';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.padding = '4px 6px 8px 6px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.08)';
    header.style.marginBottom = '6px';

    const titleEl = document.createElement('span');
    titleEl.textContent = '🐱 选择伴生终端目录';
    titleEl.style.fontSize = '12.5px';
    titleEl.style.fontWeight = '600';
    titleEl.style.color = '#F1F5F9';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.style.background = 'transparent';
    closeBtn.style.border = 'none';
    closeBtn.style.color = '#94A3B8';
    closeBtn.style.fontSize = '12px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '2px 4px';
    closeBtn.style.borderRadius = '4px';
    closeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeKittyMultiDirPopover();
    });

    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    popover.appendChild(header);

    const listEl = document.createElement('div');
    listEl.style.display = 'flex';
    listEl.style.flexDirection = 'column';
    listEl.style.gap = '4px';
    listEl.style.maxHeight = '240px';
    listEl.style.overflowY = 'auto';

    for (const rawDirPath of paths) {
        const cleanDir = String(rawDirPath || '').replace(/\/+$/, '');
        if (!cleanDir) continue;
        const lastSlash = cleanDir.lastIndexOf('/');
        const baseName = lastSlash >= 0 ? cleanDir.substring(lastSlash + 1) : cleanDir;
        const parentRaw = lastSlash > 0 ? cleanDir.substring(0, lastSlash) : '/';
        const shortParent = shortenPathForDisplay(parentRaw);

        const itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.className = 'ag-kitty-dir-option';
        itemBtn.dataset.dirPath = cleanDir;
        itemBtn.style.display = 'flex';
        itemBtn.style.flexDirection = 'column';
        itemBtn.style.alignItems = 'flex-start';
        itemBtn.style.width = '100%';
        itemBtn.style.textAlign = 'left';
        itemBtn.style.padding = '7px 10px';
        itemBtn.style.borderRadius = '7px';
        itemBtn.style.border = '1px solid transparent';
        itemBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
        itemBtn.style.cursor = 'pointer';
        itemBtn.style.color = '#F8FAFC';

        const nameRow = document.createElement('div');
        nameRow.style.fontSize = '12.5px';
        nameRow.style.fontWeight = '600';
        nameRow.style.color = '#F8FAFC';
        nameRow.style.display = 'flex';
        nameRow.style.alignItems = 'center';
        nameRow.style.gap = '6px';
        nameRow.textContent = `📁 ${baseName}`;

        const parentRow = document.createElement('div');
        parentRow.style.fontSize = '11px';
        parentRow.style.color = '#94A3B8';
        parentRow.style.marginTop = '2px';
        parentRow.style.wordBreak = 'break-all';
        parentRow.textContent = shortParent;

        itemBtn.appendChild(nameRow);
        itemBtn.appendChild(parentRow);

        itemBtn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            saveKittyDir(project, uuid, cleanDir);
            closeKittyMultiDirPopover();
            if (typeof onChoose === 'function') {
                await onChoose(cleanDir);
            }
        });

        listEl.appendChild(itemBtn);
    }

    popover.appendChild(listEl);
    document.body.appendChild(popover);
    activeMultiDirPopover = popover;

    // Viewport-clamped fixed positioning
    const popRect = popover.getBoundingClientRect();
    const popW = popRect.width || 300;
    const popH = popRect.height || 180;
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;

    let left = Math.round((vw - popW) / 2);
    let top = Math.round((vh - popH) / 2);

    if (anchorRect && (anchorRect.width > 0 || anchorRect.height > 0 || anchorRect.top > 0 || anchorRect.left > 0)) {
        left = Math.round(anchorRect.left);
        top = Math.round(anchorRect.bottom + 8);
        if (top + popH > vh - 12) {
            top = Math.max(12, Math.round(anchorRect.top - popH - 8));
        }
        if (left + popW > vw - 12) {
            left = Math.max(12, Math.round(vw - popW - 12));
        }
        if (left < 12) {
            left = 12;
        }
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    const onDocPointerDown = (ev) => {
        if (popover.contains(ev.target)) return;
        closeKittyMultiDirPopover();
    };
    const onDocKeyDown = (ev) => {
        if (ev.key === 'Escape') {
            closeKittyMultiDirPopover();
        }
    };

    const timerId = setTimeout(() => {
        document.addEventListener('mousedown', onDocPointerDown, true);
        document.addEventListener('keydown', onDocKeyDown, true);
    }, 10);

    activeMultiDirCleanup = () => {
        clearTimeout(timerId);
        document.removeEventListener('mousedown', onDocPointerDown, true);
        document.removeEventListener('keydown', onDocKeyDown, true);
    };
}

// ==========================================
// 4. Unified Dispatch Pipeline with Toast & Multi-Dir Retry
// ==========================================
function formatSuccessToastMessage(res, fallbackCwd, execute) {
    const resolvedCwd = (res && res.cwd) || fallbackCwd || '';
    const shortCwd = shortenPathForDisplay(resolvedCwd);
    const cwdSuffix = shortCwd ? ` (${shortCwd})` : '';
    const baseMsg = execute
        ? `🚀 已在 Kitty 执行${cwdSuffix}`
        : `🐱 已上膛至 Kitty${cwdSuffix}`;

    const badges = [];
    if (res && res.spawnedNewTab) {
        badges.push('新建Tab');
    }
    if (res && res.alignedCwd) {
        badges.push('已对齐目录');
    }
    return badges.length > 0 ? `${baseMsg} · ${badges.join(' · ')}` : baseMsg;
}

/**
 * Cleanly removes all companion buttons (.ag-codeblock-kitty-btn, #ag-selection-kitty-btn, #ag-selection-kitty-divider)
 * and resynchronizes floating selection bar layout.
 */
export function removeAllKittyButtons() {
    const strayButtons = document.querySelectorAll('.ag-codeblock-kitty-btn');
    for (const btn of strayButtons) {
        btn.remove();
    }
    const kittyBtn = document.getElementById('ag-selection-kitty-btn');
    const kittyDivider = document.getElementById('ag-selection-kitty-divider');
    const quoteBtn = document.querySelector('button[data-testid="selection-quote-button"]');
    const parentBar = quoteBtn?.parentElement;

    if (kittyBtn) kittyBtn.remove();
    if (kittyDivider) kittyDivider.remove();
    if (parentBar && quoteBtn) {
        syncSelectionBarLayout(parentBar, quoteBtn);
    }
}

export async function dispatchCommandToKitty({
    command = '',
    execute = false,
    anchorElement = null,
    anchorRect = null,
    onSuccess = null
} = {}) {
    const cleanCmd = String(command || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
    if (!cleanCmd.trim()) {
        showKittyToast('⚠️ 未检测到可发送的命令内容', 'error', 2200);
        return { success: false, error: 'EMPTY_COMMAND' };
    }

    const project = extractActiveProjectName() || '';
    const uuid = extractActiveUUID() || '';
    const savedCwd = getSavedKittyDir(project, uuid);
    const resolvedRect = anchorRect || (anchorElement?.getBoundingClientRect ? anchorElement.getBoundingClientRect() : null);

    const res = await sendToKittyCompanion({
        action: 'send',
        command: cleanCmd,
        project,
        uuid,
        cwd: savedCwd,
        execute,
        cleanPrompt: true,
        requireExplicitMultiDir: !savedCwd
    });

    if (res && res.success) {
        showKittyToast(formatSuccessToastMessage(res, savedCwd, execute), 'success', 2400);
        if (typeof onSuccess === 'function') {
            onSuccess(res);
        }
        return res;
    }

    // Handle Kitty uninstalled error response
    if (res && res.code === 'NOT_INSTALLED') {
        isKittyAvailable = false;
        removeAllKittyButtons();
        showKittyToast('⚠️ 未检测到 Kitty 终端，可运行 brew install kitty 安装', 'error', 3500);
        return res;
    }

    if (res && res.code === 'MULTI_DIR' && Array.isArray(res.paths) && res.paths.length > 0) {
        showKittyMultiDirPopover({
            anchorRect: resolvedRect,
            paths: res.paths,
            project,
            uuid,
            onChoose: async (chosenPath) => {
                const retryRes = await sendToKittyCompanion({
                    action: 'send',
                    command: cleanCmd,
                    project,
                    uuid,
                    cwd: chosenPath,
                    execute,
                    cleanPrompt: true,
                    requireExplicitMultiDir: false
                });
                if (retryRes && retryRes.success) {
                    showKittyToast(formatSuccessToastMessage(retryRes, chosenPath, execute), 'success', 2400);
                    if (typeof onSuccess === 'function') {
                        onSuccess(retryRes);
                    }
                } else if (retryRes && retryRes.code === 'NOT_INSTALLED') {
                    isKittyAvailable = false;
                    removeAllKittyButtons();
                    showKittyToast('⚠️ 未检测到 Kitty 终端，可运行 brew install kitty 安装', 'error', 3500);
                } else {
                    showKittyToast(`⚠️ 发送至 Kitty 失败: ${retryRes?.error || '未知错误'}`, 'error', 3000);
                }
            }
        });
        return res;
    }

    showKittyToast(`⚠️ 发送至 Kitty 失败: ${res?.error || '请检查 Kitty 伴生服务'}`, 'error', 3000);
    return res;
}

// ==========================================
// 5. Shared Selection Floating Bar Layout Coordinator
// ==========================================
export function syncSelectionBarLayout(parentBar, quoteBtn) {
    if (!parentBar || !quoteBtn) return;

    const hasEditor = Boolean(parentBar.querySelector('#ag-selection-editor-btn'));
    const hasKitty = Boolean(parentBar.querySelector('#ag-selection-kitty-btn'));

    if (hasEditor || hasKitty) {
        parentBar.style.setProperty('display', 'inline-flex', 'important');
        parentBar.style.setProperty('flex-direction', 'row', 'important');
        parentBar.style.setProperty('align-items', 'center', 'important');
        parentBar.style.setProperty('width', 'auto', 'important');
        parentBar.style.setProperty('max-width', 'none', 'important');
        parentBar.style.setProperty('box-sizing', 'border-box', 'important');
        parentBar.style.setProperty('padding', '2px 4px', 'important');

        quoteBtn.style.setProperty('flex', '0 0 auto', 'important');
        quoteBtn.style.setProperty('padding', '3px 8px', 'important');
        quoteBtn.style.setProperty('white-space', 'nowrap', 'important');
        quoteBtn.style.setProperty('min-width', 'auto', 'important');

        const offset = (hasEditor && hasKitty) ? 'translateX(-42px)' : 'translateX(-20px)';
        parentBar.style.setProperty('transform', offset, 'important');
    } else {
        parentBar.style.transform = '';
        parentBar.style.display = '';
        parentBar.style.flexDirection = '';
        parentBar.style.alignItems = '';
        parentBar.style.width = '';
        parentBar.style.maxWidth = '';
        parentBar.style.boxSizing = '';
        parentBar.style.padding = '';

        quoteBtn.style.flex = '';
        quoteBtn.style.padding = '';
        quoteBtn.style.whiteSpace = '';
        quoteBtn.style.minWidth = '';
    }
}

// ==========================================
// 6. Feature A: Manual Chat Text Selection Floating Button (`#ag-selection-kitty-btn`)
// ==========================================
function resolveElementNode(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
}

export function isNodeInConversationScope(node) {
    const el = resolveElementNode(node);
    if (!el || typeof el.closest !== 'function') return false;
    if (!el.closest('[data-testid="conversation-view"]')) return false;
    if (el.closest(SELECTION_FORBIDDEN_ANCESTOR_SELECTOR)) return false;
    return true;
}

export function isValidConversationSelection(selection) {
    if (!selection || selection.isCollapsed) return false;
    const rawText = selection.toString();
    if (!rawText || rawText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().length === 0) {
        return false;
    }
    if (!isNodeInConversationScope(selection.anchorNode)) return false;
    if (selection.focusNode && !isNodeInConversationScope(selection.focusNode)) return false;
    return true;
}

export function checkAndInjectSelectionKittyButton() {
    if (isKittyAvailable === false) {
        const quoteBtn = document.querySelector('button[data-testid="selection-quote-button"]');
        const parentBar = quoteBtn?.parentElement;
        const kittyBtn = parentBar?.querySelector('#ag-selection-kitty-btn');
        const kittyDivider = parentBar?.querySelector('#ag-selection-kitty-divider');
        if (kittyBtn) kittyBtn.remove();
        if (kittyDivider) kittyDivider.remove();
        if (parentBar && quoteBtn) {
            syncSelectionBarLayout(parentBar, quoteBtn);
        }
        return;
    }

    const quoteBtn = document.querySelector('button[data-testid="selection-quote-button"]');
    if (!quoteBtn || !quoteBtn.parentElement) return;

    const parentBar = quoteBtn.parentElement;
    const selection = typeof window.getSelection === 'function' ? window.getSelection() : null;
    const isValid = isValidConversationSelection(selection);

    let kittyBtn = parentBar.querySelector('#ag-selection-kitty-btn');
    let kittyDivider = parentBar.querySelector('#ag-selection-kitty-divider');

    if (!isValid) {
        if (isSendingKitty) return;
        if (kittyBtn && typeof kittyBtn.matches === 'function') {
            try {
                if (kittyBtn.matches(':active') || kittyBtn.matches(':hover')) return;
            } catch (e) {}
        }

        if (kittyBtn) kittyBtn.remove();
        if (kittyDivider) kittyDivider.remove();
        syncSelectionBarLayout(parentBar, quoteBtn);
        return;
    }

    const cleanedSelection = selection.toString()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\r\n/g, '\n')
        .trim();

    if (cleanedSelection) {
        lastSelectedCommandText = cleanedSelection;
    }

    if (kittyBtn) {
        kittyBtn.dataset.commandText = lastSelectedCommandText;
        syncSelectionBarLayout(parentBar, quoteBtn);
        return;
    }

    kittyDivider = document.createElement('div');
    kittyDivider.id = 'ag-selection-kitty-divider';
    kittyDivider.style.width = '1px';
    kittyDivider.style.height = '12px';
    kittyDivider.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
    kittyDivider.style.margin = '0 3px';
    kittyDivider.style.flexShrink = '0';
    kittyDivider.style.alignSelf = 'center';

    kittyBtn = document.createElement('button');
    kittyBtn.type = 'button';
    kittyBtn.id = 'ag-selection-kitty-btn';
    kittyBtn.dataset.testid = 'selection-kitty-button';
    kittyBtn.dataset.commandText = lastSelectedCommandText;
    kittyBtn.className = 'flex items-center gap-1 justify-center transition-colors cursor-pointer hover:bg-secondary text-xs rounded select-none';
    kittyBtn.style.setProperty('flex', '0 0 auto', 'important');
    kittyBtn.style.setProperty('padding', '3px 8px', 'important');
    kittyBtn.style.setProperty('white-space', 'nowrap', 'important');
    kittyBtn.style.setProperty('min-width', 'auto', 'important');
    kittyBtn.title = '发送到伴生 Kitty 终端 (默认上膛不回车; 按住 ⌥ 点击直接回车运行)';
    kittyBtn.innerHTML = `${SELECTION_KITTY_ICON_SVG}<span class="text-xs font-medium">Kitty</span>`;

    let isHandlingThisBtn = false;
    async function handleKittySelectionAction(e) {
        if (isHandlingThisBtn || isSendingKitty) return;
        isHandlingThisBtn = true;
        isSendingKitty = true;

        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        const cmdToSend = kittyBtn.dataset.commandText || lastSelectedCommandText;
        const shouldExecute = Boolean(e && e.altKey);
        const btnRect = kittyBtn.getBoundingClientRect();

        try {
            await dispatchCommandToKitty({
                command: cmdToSend,
                execute: shouldExecute,
                anchorElement: kittyBtn,
                anchorRect: btnRect
            });
        } finally {
            setTimeout(() => {
                isHandlingThisBtn = false;
                isSendingKitty = false;
            }, 600);
        }
    }

    kittyBtn.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            handleKittySelectionAction(e);
        }
    });

    kittyBtn.addEventListener('click', (e) => {
        handleKittySelectionAction(e);
    });

    parentBar.appendChild(kittyDivider);
    parentBar.appendChild(kittyBtn);
    syncSelectionBarLayout(parentBar, quoteBtn);
}

function initSelectionKittyButton() {
    document.addEventListener('selectionchange', () => {
        requestAnimationFrame(checkAndInjectSelectionKittyButton);
        setTimeout(checkAndInjectSelectionKittyButton, 40);
        setTimeout(checkAndInjectSelectionKittyButton, 120);
    });

    document.addEventListener('mouseup', (e) => {
        if (e.target && e.target.closest && e.target.closest('#ag-selection-kitty-btn, #ag-selection-editor-btn')) {
            return;
        }
        setTimeout(checkAndInjectSelectionKittyButton, 10);
        setTimeout(checkAndInjectSelectionKittyButton, 50);
        setTimeout(checkAndInjectSelectionKittyButton, 150);
        setTimeout(checkAndInjectSelectionKittyButton, 300);
    });
}

// ==========================================
// 7. Feature B: Live AI Codeblock Header Quick-Send Button
// ==========================================
export function extractCodeFromPre(pre) {
    if (!pre) return '';
    const lineEls = pre.querySelectorAll('.code-line .line-content');
    const rawText = lineEls.length > 0
        ? Array.from(lineEls).map(el => el.textContent || '').join('\n')
        : (pre.querySelector('code')?.innerText || pre.querySelector('code')?.textContent || pre.querySelector('.code-block')?.innerText || pre.querySelector('.code-block')?.textContent || '');
    return rawText
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/^\n+|\n+$/g, '');
}

export function isEligibleShellCodeblock(langLabel, codeText) {
    const normalizedLang = String(langLabel || '').trim().toLowerCase();
    if (!SHELL_LANGUAGES.has(normalizedLang)) {
        return false;
    }

    const trimmed = String(codeText || '').trim();
    if (!trimmed) {
        return false;
    }

    // Extra structural guard when the header has an empty language label ('')
    if (normalizedLang === '') {
        if (/^(\{\s*["'\n\r}]|\[\s*[\{\["'\d\n\r\]])/.test(trimmed)) return false;
        if (/^<(!doctype|html|head|body|div|span|p|section|table|svg|style|script)\b/i.test(trimmed)) return false;
        if (/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|xychart-beta)\b/.test(trimmed)) return false;
        if (/^[.#]?[a-zA-Z0-9_-]+\s*\{\s*\n[^}]*:\s*[^;]+;/m.test(trimmed)) return false;
    }

    return true;
}

export function scanAndInjectCodeblockButtons() {
    if (isKittyAvailable === false) {
        removeAllKittyButtons();
        return;
    }

    // Self-healing cleanup: remove any accidental buttons outside conversation-view
    const strayButtons = document.querySelectorAll('.ag-codeblock-kitty-btn');
    for (const btn of strayButtons) {
        if (!btn.closest('[data-testid="conversation-view"]')) {
            btn.remove();
        }
    }

    const convoViews = document.querySelectorAll('[data-testid="conversation-view"]');
    for (const convoView of convoViews) {
        const preBlocks = convoView.querySelectorAll('pre');
        for (const pre of preBlocks) {
            const copyBtn = pre.querySelector('button[aria-label="Copy code"]') || pre.querySelector('button[aria-label*="Copy" i]');
            const actionGroup = copyBtn?.parentElement;
            if (!copyBtn || !actionGroup) continue;

            const headerRow = actionGroup.parentElement;
            const firstHeaderChild = headerRow?.firstElementChild;
            const langLabel = (firstHeaderChild && firstHeaderChild !== actionGroup)
                ? (firstHeaderChild.textContent || '').trim().toLowerCase()
                : '';

            const codeSample = extractCodeFromPre(pre);
            const existingBtn = actionGroup.querySelector('.ag-codeblock-kitty-btn');

            if (!isEligibleShellCodeblock(langLabel, codeSample)) {
                if (existingBtn) existingBtn.remove();
                continue;
            }

            if (existingBtn) continue;

            const kittyBtn = document.createElement('button');
            kittyBtn.type = 'button';
            kittyBtn.className = 'ag-codeblock-kitty-btn appearance-none bg-transparent border-0 p-0 cursor-pointer text-secondary-foreground hover:text-foreground transition-colors flex items-center justify-center';
            kittyBtn.title = '发送到伴生 Kitty 终端 (默认上膛不回车; ⌥ 点击直接运行)';
            kittyBtn.setAttribute('aria-label', '发送到伴生 Kitty 终端 (默认上膛不回车; ⌥ 点击直接运行)');
            kittyBtn.innerHTML = CODEBLOCK_KITTY_ICON_SVG;

            let resetTimer = null;
            let isDispatchingBlock = false;

            kittyBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isDispatchingBlock) return;
                isDispatchingBlock = true;

                const shouldExecute = Boolean(e.altKey);
                const latestCode = extractCodeFromPre(pre);

                try {
                    await dispatchCommandToKitty({
                        command: latestCode,
                        execute: shouldExecute,
                        anchorElement: kittyBtn,
                        onSuccess: () => {
                            if (resetTimer) clearTimeout(resetTimer);
                            kittyBtn.innerHTML = CODEBLOCK_CHECK_ICON_SVG;
                            resetTimer = setTimeout(() => {
                                kittyBtn.innerHTML = CODEBLOCK_KITTY_ICON_SVG;
                                resetTimer = null;
                            }, 1200);
                        }
                    });
                } finally {
                    isDispatchingBlock = false;
                }
            });

            actionGroup.insertBefore(kittyBtn, actionGroup.firstChild);
        }
    }
}

/**
 * Bug Fix & Enhancement Documentation:
 * 1. Problem Fixed:
 *    When Kitty terminal is not installed on the system, the companion UI still rendered
 *    `.ag-codeblock-kitty-btn` on shell codeblocks and `#ag-selection-kitty-btn` on selected text.
 *    Interacting with them resulted in silent failures or error logs.
 * 2. Resolution Method:
 *    - In `initKittyCompanion()`, asynchronously query `checkKittyInstalled()`.
 *    - If `installed === false`, set `isKittyAvailable = false`, log info message:
 *      '🐱 [Antigravity Mod] 未检测到系统安装 Kitty，已自动隐藏代码块与选区伴生终端快捷按钮',
 *      remove any existing `.ag-codeblock-kitty-btn`, `#ag-selection-kitty-btn`, `#ag-selection-kitty-divider`,
 *      and gracefully terminate initialization without injecting buttons or listeners.
 *    - In `scanAndInjectCodeblockButtons()` and `checkAndInjectSelectionKittyButton()`, guard against
 *      `isKittyAvailable === false` to immediately remove any stray elements and return.
 *    - In `dispatchCommandToKitty()`, if backend returns `code === 'NOT_INSTALLED'`, set `isKittyAvailable = false`,
 *      remove stray buttons, and show a clear error toast guiding the user to install Kitty.
 * 3. Caveats & Subsequent Development:
 *    If the user installs Kitty during runtime, calling `checkKittyInstalled(true)` will update cache
 *    and setting `isKittyAvailable = true` allows injecting the buttons.
 */
export async function initKittyCompanion() {
    console.log('🐱 [Antigravity Mod] KitiGravity 伴生终端前端联动组件已启动');
    ensureKittyStyles();

    try {
        const installed = await checkKittyInstalled();
        if (installed === false) {
            isKittyAvailable = false;
            console.info('🐱 [Antigravity Mod] 未检测到系统安装 Kitty，已自动隐藏代码块与选区伴生终端快捷按钮');
            removeAllKittyButtons();
            return;
        }
        isKittyAvailable = true;
    } catch (e) {
        isKittyAvailable = false;
        removeAllKittyButtons();
        return;
    }

    initSelectionKittyButton();
    scanAndInjectCodeblockButtons();

    let rafPending = false;
    const scheduleScan = () => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            scanAndInjectCodeblockButtons();
        });
    };

    const isOwnInjectedNode = (node) => {
        if (!node || node.nodeType !== 1) return false;
        const id = node.id || '';
        if (
            id === 'ag-selection-kitty-btn' ||
            id === 'ag-selection-kitty-divider' ||
            id === 'ag-selection-editor-btn' ||
            id === 'ag-selection-editor-divider' ||
            id === 'ag-kitty-companion-toast' ||
            id === 'ag-kitty-multidir-popover' ||
            id === 'ag-file-editor-toast'
        ) {
            return true;
        }
        return Boolean(node.classList && node.classList.contains('ag-codeblock-kitty-btn'));
    };

    const observer = new MutationObserver((mutations) => {
        if (isKittyAvailable === false) return;

        let shouldCheckSelection = false;
        let shouldScanBlocks = false;

        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                const hasExternalNode = Array.from(m.addedNodes).some(n => !isOwnInjectedNode(n));
                if (!hasExternalNode) continue;

                shouldScanBlocks = true;
                if (document.querySelector('button[data-testid="selection-quote-button"]')) {
                    shouldCheckSelection = true;
                }
                break;
            }
        }

        if (shouldCheckSelection) {
            checkAndInjectSelectionKittyButton();
            setTimeout(checkAndInjectSelectionKittyButton, 50);
        }
        if (shouldScanBlocks) {
            scheduleScan();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}
