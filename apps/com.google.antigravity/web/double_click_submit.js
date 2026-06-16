// double_click_submit.js
export function initDoubleClickSubmit() {
    // 1. 注入选中的金色高亮样式
    const style = document.createElement('style');
    style.textContent = `
        /* 为包裹单选框的 label 增加金色边框和微光效果 */
        label:has(input[type="radio"]:checked) {
            border-color: #FFD700 !important;
            box-shadow: 0 0 8px rgba(255, 215, 0, 0.3) !important;
            transition: all 0.2s ease-in-out;
        }
        
        /* 数字小方块也跟着亮起来 */
        label:has(input[type="radio"]:checked) > div.bg-border {
            background-color: #FFD700 !important;
        }
        
        label:has(input[type="radio"]:checked) > div.bg-border > span {
            color: #000000 !important;
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);

    // 2. 双击（重复点击）直接提交逻辑
    // 记录鼠标按下时的单选框状态
    document.addEventListener('mousedown', (e) => {
        // 如果点击的是输入框（比如 __write_in__ 里的 textarea），不要拦截
        if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
            return;
        }

        const label = e.target.closest('label');
        if (!label) return;
        
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

        const radioGroup = label.closest('[role="radiogroup"]');
        if (!radioGroup) return;

        const wasChecked = label.getAttribute('data-was-checked') === 'true';
        
        // 只有当它在点击前就已经是被选中的，意味着这是“第二次点击”
        if (wasChecked) {
            // 往上寻找包含 Submit 按钮的容器
            let ancestor = radioGroup.parentElement;
            while(ancestor && ancestor.tagName !== 'BODY') {
                const buttons = Array.from(ancestor.querySelectorAll('button'));
                // 寻找包含 Submit 文字的按钮
                const submitBtn = buttons.find(btn => btn.textContent.includes('Submit'));
                
                if (submitBtn) {
                    // 模拟点击 Submit
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
