// project_dots.js
import { fetchThemeColor } from './api.js';

export function initProjectDots() {
    const processedContainers = new WeakSet();

    const renderDots = async () => {
        // 定位侧边栏的副标题
        const subtitles = document.querySelectorAll('.text-xs.text-muted-foreground.truncate.text-left');
        for (let sub of subtitles) {
            if (processedContainers.has(sub)) continue;

            const text = sub.textContent.trim();
            if (!text) continue;

            // 如果包含 '/'，提取斜杠前的部分作为项目名；否则直接使用全部文本
            const projectPart = text.includes('/') ? text.split('/')[0].trim() : text;
            processedContainers.add(sub);

            const color = await fetchThemeColor(projectPart);
            if (color) {
                // 防止因 React 重绘导致重复添加
                if (sub.querySelector('.ag-project-dot')) continue;

                const dot = document.createElement('span');
                dot.className = 'ag-project-dot';
                dot.style.cssText = `
                    display: inline-block;
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    margin-right: 6px;
                    background-color: ${color};
                    vertical-align: middle;
                    transform: translateY(-1px);
                    box-shadow: 0 0 3px rgba(0,0,0,0.3);
                `;
                sub.prepend(dot);
            }
        }
    };

    const observer = new MutationObserver(() => {
        renderDots();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(renderDots, 1500);
}
