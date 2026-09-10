// session_switcher.js

export function initSessionSwitcher() {
    console.log('🔄 [Antigravity Mod] 初始化会话切换快捷键 (Ctrl+Tab)');

    document.addEventListener('keydown', (e) => {
        // 判断快捷键：Ctrl + Tab (切换到下一个) 或 Ctrl + Shift + Tab (切换到上一个)
        if (e.ctrlKey && e.code === 'Tab') {
            e.preventDefault();
            e.stopImmediatePropagation();

            // 1. 获取所有会话的按钮
            // 特征：内部包含 data-testid="convo-pill-..." 的外层 div[role="button"]
            const pills = Array.from(document.querySelectorAll('span[data-testid^="convo-pill-"]'));
            const sessionButtons = pills.map(pill => pill.closest('div[role="button"]')).filter(btn => btn !== null);

            if (sessionButtons.length === 0) return;

            // 2. 找到当前处于 active 状态的会话索引
            // 特征：拥有 bg-sidebar-secondary 类名
            const currentIndex = sessionButtons.findIndex(btn => btn.classList.contains('bg-sidebar-secondary'));

            let nextIndex = 0;
            
            if (currentIndex !== -1) {
                if (e.shiftKey) {
                    // Ctrl + Shift + Tab：上一个
                    nextIndex = currentIndex - 1;
                    if (nextIndex < 0) nextIndex = sessionButtons.length - 1;
                } else {
                    // Ctrl + Tab：下一个
                    nextIndex = currentIndex + 1;
                    if (nextIndex >= sessionButtons.length) nextIndex = 0;
                }
            }

            // 3. 触发点击，并保证在视野内
            const nextButton = sessionButtons[nextIndex];
            if (nextButton) {
                nextButton.click();
                nextButton.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, true); // 使用 true 捕获阶段，防止被 Electron 或 React 的其他逻辑拦截
}
