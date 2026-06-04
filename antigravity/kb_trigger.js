// kb_trigger.js
import { extractActiveProjectName } from './project_opener.js';
import { fetchKnowledgeIndex } from './api.js';

export function initKbTrigger() {
    console.log('📚 [Antigravity Mod] 初始化 #kb 知识注入触发器 (支持 Global/Local 双库)');

    let dropdownContainer = null;
    let rulesData = [];
    let isMenuVisible = false;
    let currentMatchLength = 0;

    // 创建下拉菜单 UI
    function createDropdown() {
        if (dropdownContainer) return dropdownContainer;

        dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'ag-kb-dropdown absolute left-0 w-full -top-2 -translate-y-full bg-card max-h-[200px] overflow-y-auto rounded-md border border-solid border-gray-500/20 z-30 shadow-lg';
        dropdownContainer.style.cssText = `
            display: none;
            backdrop-filter: blur(24px) saturate(150%);
            background-color: rgba(20, 20, 22, 0.95);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
        `;
        return dropdownContainer;
    }

    function renderRules(rules) {
        if (!dropdownContainer) return;
        dropdownContainer.innerHTML = '';
        
        if (rules.length === 0) {
            dropdownContainer.innerHTML = '<div class="p-3 text-xs text-gray-500 text-center">暂无知识卡片</div>';
            return;
        }

        rules.forEach((rule, index) => {
            const item = document.createElement('div');
            item.className = 'flex w-full px-2 py-1.5 items-center gap-2 cursor-pointer hover:bg-secondary/80 transition-colors';
            item.setAttribute('role', 'option');
            item.setAttribute('id', `kb-item-${index}`);
            
            const badgeColor = rule.scope === 'Global' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30';
            
            let typeBadge = '';
            if (rule.scope === 'Local' && rule.type) {
                const typeColor = rule.type === 'Knowledge' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-orange-500/20 text-orange-400 border-orange-500/30';
                typeBadge = `<span class="text-[10px] px-1 py-0.5 rounded border border-solid ${typeColor} shrink-0 leading-none">${rule.type}</span>`;
            }
            
            item.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500 shrink-0"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
                <span class="text-[10px] px-1 py-0.5 rounded border border-solid ${badgeColor} shrink-0 leading-none">${rule.scope || 'Local'}</span>
                ${typeBadge}
                <span class="text-xs shrink-0 font-medium">${rule.tag}</span>
                <span class="text-[11px] opacity-60 min-w-0 truncate" dir="auto">${rule.description || '知识片段'}</span>
            `;

            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 防止输入框失焦
                insertRuleTag(rule);
                hideMenu();
            });

            dropdownContainer.appendChild(item);
        });
    }

    function insertRuleTag(rule) {
        // Option A: 明文展开 (所见即所得)
        const injectionText = `\n<rule name="${rule.tag}" scope="${rule.scope}">\n${rule.content}\n</rule>\n`;
        
        // 尝试覆盖输入框里的触发词文本 (例如 "#kbg ")
        for (let i = 0; i < currentMatchLength; i++) {
            document.execCommand('delete', false, null);
        }
        
        // 插入完整规则文本
        document.execCommand('insertText', false, injectionText);
    }

    function showMenu(inputElement) {
        if (!dropdownContainer) {
            dropdownContainer = createDropdown();
        }
        
        // 核心修复：React 的每次重新渲染都可能会把我们注入的 DOM 节点给“偷偷删掉”
        if (!document.body.contains(dropdownContainer)) {
            const wrapper = inputElement.closest('.relative.w-full');
            if (wrapper) {
                wrapper.appendChild(dropdownContainer);
            } else {
                inputElement.parentElement.appendChild(dropdownContainer);
            }
        }
        
        dropdownContainer.style.display = 'block';
        isMenuVisible = true;
    }

    function hideMenu() {
        if (dropdownContainer) {
            dropdownContainer.style.display = 'none';
        }
        isMenuVisible = false;
    }

    // 核心拦截器：监听键盘输入
    document.addEventListener('keyup', async (e) => {
        const inputSelector = 'div[aria-label="Message input"][contenteditable="true"], div[data-lexical-editor="true"]';
        
        // 兼容处理：在富文本编辑器中，触发键盘事件的 target 可能是内部的 span 或 p 标签
        const activeEl = e.target.closest ? e.target.closest(inputSelector) : null;
        
        if (!activeEl) {
            if (isMenuVisible) hideMenu();
            return;
        }

        // 清理富文本编辑器里经常出现的“零宽字符”和“不换行空格”
        let rawText = activeEl.textContent || '';
        let cleanText = rawText.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ');

        let matchScope = null;
        if (cleanText.endsWith('#kb ')) { matchScope = 'all'; currentMatchLength = 4; }
        else if (cleanText.endsWith('#kbg ')) { matchScope = 'global'; currentMatchLength = 5; }
        else if (cleanText.endsWith('#kbl ')) { matchScope = 'local'; currentMatchLength = 5; }

        if (matchScope) {
            const projName = extractActiveProjectName();
            
            // 只要不是纯本地模式，或者能拿到项目名，就可以去 fetch
            if (matchScope === 'global' || projName) {
                if (!dropdownContainer) showMenu(activeEl);
                dropdownContainer.innerHTML = '<div class="p-3 text-xs opacity-50 text-center">Loading rules...</div>';
                
                rulesData = await fetchKnowledgeIndex(projName, matchScope);
                renderRules(rulesData);
                showMenu(activeEl);
            } else {
                console.warn('[kb_trigger] 无法解析当前项目名称且当前作用域为 Local，无法获取本地知识库');
            }
        } else if (isMenuVisible && !cleanText.includes('#kb')) {
            hideMenu();
        }
    });

    // 点击其他地方隐藏
    document.addEventListener('click', (e) => {
        if (isMenuVisible && !e.target.closest('.ag-kb-dropdown')) {
            hideMenu();
        }
    });
}
