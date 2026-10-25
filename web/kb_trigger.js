// kb_trigger.js
import { extractActiveProjectName } from './project_opener.js';
import { fetchKnowledgeIndex } from './api.js';

export function initKbTrigger() {
    console.log('📚 [Antigravity Mod] 初始化 #cmd 知识注入触发器 (支持 Global/Local 双库)');

    let dropdownContainer = null;
    let rulesData = [];
    let isMenuVisible = false;
    let currentMatchLength = 0;
    
    // UI 锁定标记，防止在插入大规模文本期间用户按回车发送或乱敲字符
    let isProcessing = false;
    const blockEventsIfProcessing = (e) => {
        if (isProcessing) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    };
    
    // 在最顶层捕获阶段拦截所有输入和点击事件
    document.addEventListener('keydown', blockEventsIfProcessing, true);
    document.addEventListener('keypress', blockEventsIfProcessing, true);
    document.addEventListener('keyup', blockEventsIfProcessing, true);
    document.addEventListener('click', blockEventsIfProcessing, true);

    // 创建下拉菜单 UI (采用 fixed 定位，直接挂载在 document.body，防止被父级 overflow: hidden 截断)
    function createDropdown() {
        if (dropdownContainer) return dropdownContainer;

        dropdownContainer = document.createElement('div');
        dropdownContainer.className = 'ag-kb-dropdown';
        dropdownContainer.style.cssText = `
            position: fixed;
            display: none;
            backdrop-filter: blur(24px) saturate(150%);
            -webkit-backdrop-filter: blur(24px) saturate(150%);
            background-color: rgba(20, 20, 22, 0.96);
            color: #ffffff;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(128, 128, 128, 0.25);
            border-radius: 8px;
            max-height: 240px;
            overflow-y: auto;
            z-index: 999999;
            box-sizing: border-box;
        `;
        document.body.appendChild(dropdownContainer);
        return dropdownContainer;
    }

    let selectedIndex = -1;

    function renderRules(rules) {
        if (!dropdownContainer) return;
        dropdownContainer.innerHTML = '';
        
        if (rules.length === 0) {
            dropdownContainer.innerHTML = '<div class="p-3 text-xs text-gray-400 text-center">暂无知识卡片</div>';
            return;
        }

        selectedIndex = 0;

        rules.forEach((rule, index) => {
            const item = document.createElement('div');
            item.className = 'flex w-full px-2 py-1.5 items-center gap-2 cursor-pointer transition-colors text-white';
            item.setAttribute('role', 'option');
            item.setAttribute('id', `kb-item-${index}`);
            
            let badgeText = 'Local';
            let customStyle = 'background-color: rgba(107, 114, 128, 0.2); color: rgb(156, 163, 175); border-color: rgba(107, 114, 128, 0.3);';
            
            if (rule.scope === 'Global') {
                badgeText = 'Global';
                customStyle = 'background-color: rgba(168, 85, 247, 0.2); color: rgb(192, 132, 252); border-color: rgba(168, 85, 247, 0.3);';
            } else if (rule.scope === 'Local') {
                if (rule.type === 'Knowledge') {
                    badgeText = 'Knowledge';
                    customStyle = 'background-color: rgba(34, 197, 94, 0.2); color: rgb(74, 222, 128); border-color: rgba(34, 197, 94, 0.3);';
                } else {
                    badgeText = 'Instruction';
                    customStyle = 'background-color: rgba(249, 115, 22, 0.2); color: rgb(251, 146, 60); border-color: rgba(249, 115, 22, 0.3);';
                }
            }

            item.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-400 shrink-0"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
                <span class="text-[10px] px-1 py-0.5 rounded border border-solid shrink-0 leading-none" style="${customStyle}">${badgeText}</span>
                <span class="text-xs shrink-0 font-medium text-white">${rule.tag}</span>
                <span class="text-[11px] text-gray-300 opacity-70 min-w-0 truncate" dir="auto">${rule.description || '知识片段'}</span>
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
        if (isProcessing) return;
        isProcessing = true;
        
        try {
            const injectionText = `\n<rule name="${rule.tag}" scope="${rule.scope}">\n${rule.content}\n</rule>\n`;
            
            // 性能优化：不再循环调用 delete (会导致 Lexical 触发多次由于 input 事件引起的重新渲染从而卡顿)
            // 而是通过 Selection API 向后扩选对应数量的字符，然后一次性 delete
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
                for (let i = 0; i < currentMatchLength; i++) {
                    sel.modify('extend', 'backward', 'character');
                }
                document.execCommand('delete', false, null);
            } else {
                // 兜底逻辑
                for (let i = 0; i < currentMatchLength; i++) {
                    document.execCommand('delete', false, null);
                }
            }
            
            // 插入完整规则文本
            document.execCommand('insertText', false, injectionText);
        } catch (e) {
            console.error('[kb_trigger] 插入规则失败:', e);
        } finally {
            // 利用 setTimeout 将解锁操作推迟到事件循环的下一个 Tick
            // 这样在同步阻塞期间被浏览器放入队列的按键/点击事件（比如连按回车），
            // 就会在 isProcessing=true 的拦截器中被直接丢弃。
            setTimeout(() => {
                isProcessing = false;
            }, 100); // 100ms 的缓冲期足以消化排队的冗余事件
        }
    }

    function showMenu(inputElement) {
        if (!dropdownContainer) {
            dropdownContainer = createDropdown();
        } else if (!document.body.contains(dropdownContainer)) {
            document.body.appendChild(dropdownContainer);
        }
        
        // 基于屏幕视口绝对坐标计算，防止被包含 overflow: hidden 的父级元素截断
        const rect = inputElement.getBoundingClientRect();
        dropdownContainer.style.width = `${Math.max(rect.width, 320)}px`;
        dropdownContainer.style.left = `${rect.left}px`;

        const spaceAbove = rect.top;
        if (spaceAbove > 220 || rect.top > window.innerHeight / 2) {
            // 普通对话流，输入框在下方，向上弹起
            dropdownContainer.style.top = 'auto';
            dropdownContainer.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        } else {
            // 新对话或居中布局，向下弹起
            dropdownContainer.style.bottom = 'auto';
            dropdownContainer.style.top = `${rect.bottom + 8}px`;
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
        // 过滤不可见字符，同时去除末尾多余换行
        let cleanText = rawText.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\n+$/, '');

        // 正则匹配结尾的触发词，兼容带空格或不带空格两种输入习惯
        const match = cleanText.match(/(?:^|\s)(#(?:cmdg|cmdl|cmd|kbg|kbl|kb))(\s)?$/);

        if (match) {
            const trigger = match[1];
            const hasSpace = !!match[2];
            currentMatchLength = trigger.length + (hasSpace ? 1 : 0);

            let matchScope = 'all';
            if (trigger === '#cmdg') matchScope = 'global';
            else if (trigger === '#cmdl') matchScope = 'local';
            else if (trigger === '#cmd') matchScope = 'all'; // #cmd 默认载入全部指令和知识，体验最佳
            else if (trigger === '#kbg') matchScope = 'global';
            else if (trigger === '#kbl') matchScope = 'kb-local';
            else if (trigger === '#kb') matchScope = 'kb-all';

            const projName = extractActiveProjectName();
            const isPureLocal = (matchScope === 'local' || matchScope === 'kb-local');
            
            if (!isPureLocal || projName) {
                showMenu(activeEl);
                dropdownContainer.innerHTML = '<div class="p-3 text-xs opacity-50 text-center">Loading rules...</div>';
                
                rulesData = await fetchKnowledgeIndex(projName || '', matchScope);
                renderRules(rulesData);
                showMenu(activeEl);
            } else {
                console.warn('[kb_trigger] 无法解析当前项目名称且当前作用域为 Local，无法获取本地知识库');
                if (isMenuVisible) hideMenu();
            }
        } else {
            if (isMenuVisible) hideMenu();
        }
    });

    // 窗口尺寸变化时自动关闭或重新校准
    window.addEventListener('resize', () => {
        if (isMenuVisible) hideMenu();
    });

    // 点击其他地方隐藏
    document.addEventListener('click', (e) => {
        if (isMenuVisible && !e.target.closest('.ag-kb-dropdown')) {
            hideMenu();
        }
    });
}
