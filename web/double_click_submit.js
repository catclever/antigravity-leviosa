// double_click_submit.js
export function initDoubleClickSubmit() {
    // 1. 注入选中的金色高亮样式（同时支持单选框与多选复选框）
    const style = document.createElement('style');
    style.textContent = `
        /* 为包裹单选框与多选复选框的 label 增加金色边框和微光效果 */
        label:has(input[type="radio"]:checked),
        label:has(input[type="checkbox"]:checked) {
            border-color: #FFD700 !important;
            box-shadow: 0 0 8px rgba(255, 215, 0, 0.3) !important;
            transition: all 0.2s ease-in-out;
        }
        
        /* 数字小方块也跟着亮起来 */
        label:has(input[type="radio"]:checked) > div.bg-border,
        label:has(input[type="checkbox"]:checked) > div.bg-border,
        label:has(input[type="radio"]:checked) > div[data-testid*="shortcut-badge"],
        label:has(input[type="checkbox"]:checked) > div[data-testid*="shortcut-badge"] {
            background-color: #FFD700 !important;
        }
        
        label:has(input[type="radio"]:checked) > div.bg-border > span,
        label:has(input[type="checkbox"]:checked) > div.bg-border > span,
        label:has(input[type="radio"]:checked) > div[data-testid*="shortcut-badge"] > span,
        label:has(input[type="checkbox"]:checked) > div[data-testid*="shortcut-badge"] > span {
            color: #000000 !important;
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);

    // 2. 双击（重复点击）直接提交逻辑（仅对单选框生效，多选与输入项严格排除）
    // 记录鼠标按下时的单选框状态
    document.addEventListener('mousedown', (e) => {
        // 如果点击的是输入框（比如 __write_in__ 里的 textarea），不要拦截
        if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
            return;
        }

        const label = e.target.closest('label');
        if (!label) return;

        // 严格排除多选组件（复选框），多选绝不触发双击提交
        if (label.querySelector('input[type="checkbox"]')) {
            return;
        }
        
        const input = label.querySelector('input[type="radio"]');
        if (!input) return;

        const radioGroup = label.closest('[role="radiogroup"]');
        if (!radioGroup) return;

        // 如果在点击之前，这个选项已经是被选中的状态，就打个标记
        if (input.checked) {
            label.setAttribute('data-was-checked', 'true');
        } else {
            label.setAttribute('data-was-checked', 'false');
        }
    });

    // 鼠标抬起完成点击时触发提交
    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
            return;
        }

        const label = e.target.closest('label');
        if (!label) return;

        // 严格排除多选组件（复选框），多选绝不触发双击提交
        if (label.querySelector('input[type="checkbox"]')) {
            label.removeAttribute('data-was-checked');
            return;
        }

        const input = label.querySelector('input[type="radio"]');
        if (!input) {
            label.removeAttribute('data-was-checked');
            return;
        }

        const radioGroup = label.closest('[role="radiogroup"]');
        if (!radioGroup) {
            label.removeAttribute('data-was-checked');
            return;
        }

        const wasChecked = label.getAttribute('data-was-checked') === 'true';
        
        // 只有当它在点击前就已经是被选中的，意味着这是“第二次点击”
        if (wasChecked) {
            // 往上寻找包含 Submit / Continue 按钮的容器
            let ancestor = radioGroup.parentElement;
            while(ancestor && ancestor.tagName !== 'BODY') {
                const buttons = Array.from(ancestor.querySelectorAll('button'));
                // 寻找包含 Submit / Continue 的确认按钮（排除 Skip 按钮）
                const submitBtn = ancestor.querySelector('[data-testid="interaction-continue-button"]') ||
                                  buttons.find(btn => {
                                      const txt = (btn.textContent || '').trim();
                                      return (txt.includes('Submit') || txt.includes('Continue')) &&
                                             btn.getAttribute('data-testid') !== 'interaction-skip-button';
                                  });
                
                if (submitBtn && !submitBtn.disabled) {
                    // 模拟点击 Submit / Continue
                    setTimeout(() => submitBtn.click(), 50);
                    break;
                }
                ancestor = ancestor.parentElement;
            }
        }
        
        // 清理状态
        label.removeAttribute('data-was-checked');
    });
}
