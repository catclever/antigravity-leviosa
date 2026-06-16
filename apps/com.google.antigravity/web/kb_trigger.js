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

    let selectedIndex = -1;

    function renderRules(rules) {
        if (!dropdownContainer) return;
        dropdownContainer.innerHTML = '';
        
        if (rules.length === 0) {
            dropdownContainer.innerHTML = '<div class="p-3 text-xs text-gray-500 text-center">暂无知识卡片</div>';
            return;
        }

        selectedIndex = 0;

        rules.forEach((rule, index) => {
            const item = document.createElement('div');
            // 移除 hover:bg-secondary/80, 改用 JS 控制 bg-secondary
            item.className = 'flex w-full px-2 py-1.5 items-center gap-2 cursor-pointer transition-colors';
            item.setAttribute('role', 'option');
            item.setAttribute('id', `kb-item-${index}`);
            
            let badgeText = 'Local';
            let badgeColor = 'bg-gray-500/20 text-gray-400 border-gray-500/30';
            
            if (rule.scope === 'Global') {
                badgeText = 'Global';
                badgeColor = 'bg-purple-500/20 text-purple-400 border-purple-500/30';
            } else if (rule.scope === 'Local') {
                if (rule.type === 'Knowledge') {
                    badgeText = 'Knowledge';
                    badgeColor = 'bg-green-500/20 text-green-400 border-green-500/30';
                } else {
                    badgeText = 'Instruction';
                    badgeColor = 'bg-orange-500/20 text-orange-400 border-orange-500/30';
                }
            }

            item.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500 shrink-0"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
                <span class="text-[10px] px-1 py-0.5 rounded border border-solid ${badgeColor} shrink-0 leading-none">${badgeText}</span>
                <span class="text-xs shrink-0 font-medium">${rule.tag}</span>
                <span class="text-[11px] opacity-60 min-w-0 truncate" dir="auto">${rule.description || '知识片段'}</span>
            `;

            // 鼠标悬停更新选择
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateSelection();
            });

            item.addEventListener('mousedown', (e) => {
                e.preventDefault(); // 防止输入框失焦
                insertRuleTag(rule);
                hideMenu();
            });

            dropdownContainer.appendChild(item);
        });

        updateSelection();
    }

    function updateSelection() {
        if (!dropdownContainer) return;
        const items = dropdownContainer.querySelectorAll('div[role="option"]');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                // 使用内联样式确保高亮生效，防止 Tailwind 类被剔除
                item.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
            } else {
                item.style.backgroundColor = 'transparent';
            }
        });
        
        const selectedEl = dropdownContainer.querySelector(`#kb-item-${selectedIndex}`);
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
    }

    function insertRuleTag(rule) {
        try {
            const injectionText = `\n<rule name="${rule.tag}" scope="${rule.scope}">\n${rule.content}\n</rule>\n`;
            
            // 返璞归真：最简单粗暴的 delete，对 Lexical 这种接管了 Selection 的富文本引擎最为安全
            // 每次执行 delete 都会触发原生的 beforeinput 和 input 事件，Lexical 可以完美捕捉
            for (let i = 0; i < currentMatchLength; i++) {
                document.execCommand('delete', false, null);
            }
            
            // 插入完整规则文本
            document.execCommand('insertText', false, injectionText);
        } catch (e) {
            console.error('[kb_trigger] 插入规则失败:', e);
        }
    }

    function showMenu(inputElement) {
        if (!dropdownContainer) {
            dropdownContainer = createDropdown();
        }
        
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
        selectedIndex = -1;
    }

    // 监听按键导航和回车确认 (核心修复：使用 capture 捕获阶段，并且 stopImmediatePropagation 彻底阻断 React 合成事件)
    document.addEventListener('keydown', (e) => {
        if (!isMenuVisible || rulesData.length === 0) return;
        
        const inputSelector = 'div[aria-label="Message input"][contenteditable="true"], div[data-lexical-editor="true"]';
        const activeEl = e.target.closest ? e.target.closest(inputSelector) : null;
        if (!activeEl) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopImmediatePropagation();
            selectedIndex = (selectedIndex + 1) % rulesData.length;
            updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopImmediatePropagation();
            selectedIndex = (selectedIndex - 1 + rulesData.length) % rulesData.length;
            updateSelection();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); // 彻底截断，防止触发发送
            
            if (selectedIndex >= 0 && selectedIndex < rulesData.length) {
                const selectedRule = rulesData[selectedIndex];
                
                // 必须同步执行！如果用 setTimeout 会丢失用户的 Trusted Event 上下文，导致浏览器拦截 execCommand
                insertRuleTag(selectedRule);
                hideMenu();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            hideMenu();
        }
    }, true); // <--- 注意这里的 true: 在事件捕获阶段就将其拦截

    // 核心拦截器：监听键盘输入触发菜单
    document.addEventListener('keyup', async (e) => {
        // 忽略方向键和回车键，避免重复触发或干扰 keydown
        if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return;

        const inputSelector = 'div[aria-label="Message input"][contenteditable="true"], div[data-lexical-editor="true"]';
        const activeEl = e.target.closest ? e.target.closest(inputSelector) : null;
        
        if (!activeEl) {
            if (isMenuVisible) hideMenu();
            return;
        }

        let rawText = activeEl.textContent || '';
        let cleanText = rawText.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ');

        let matchScope = null;
        if (cleanText.endsWith('#kb ')) { matchScope = 'all'; currentMatchLength = 4; }
        else if (cleanText.endsWith('#kbg ')) { matchScope = 'global'; currentMatchLength = 5; }
        else if (cleanText.endsWith('#kbl ')) { matchScope = 'local'; currentMatchLength = 5; }

        if (matchScope) {
            const projName = extractActiveProjectName();
            
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
