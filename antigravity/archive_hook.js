// archive_hook.js

export function initArchiveHook() {
    console.log('[Antigravity Mod] 初始化 Archive Hook 监听器');

    // 从 DOM 中提取 UUID、标题和项目名
    function extractMetadataFromElement(el) {
        let metadata = { uuid: null, title: '', project: '' };
        
        // 查找包含整个对话条目的父容器
        const row = el.closest('div[role="button"]');
        if (row) {
            const pillSpan = row.querySelector('[data-testid^="convo-pill-"]');
            if (pillSpan) {
                const testId = pillSpan.getAttribute('data-testid');
                metadata.uuid = testId.replace('convo-pill-', '');
                metadata.title = pillSpan.textContent.trim();
            }
            
            const projectDiv = row.querySelector('.text-xs.text-muted-foreground.truncate');
            if (projectDiv) {
                const cloned = projectDiv.cloneNode(true);
                const dot = cloned.querySelector('.ag-project-dot');
                if (dot) dot.remove();
                metadata.project = cloned.textContent.trim();
            }
            return metadata;
        }
        
        // 兜底：从当前页面 URL 提取
        const urlMatch = window.location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (urlMatch) metadata.uuid = urlMatch[0];
        
        return metadata;
    }

    document.addEventListener('click', async (e) => {
        const target = e.target;
        
        // 必须是按钮才触发
        const btn = target.closest('button');
        if (!btn) return;

        // 通过判断按钮内的 SVG path 来精准定位是否为“归档”按钮
        // 归档图标的 SVG path 包含 M480-256.16L626.15
        const isArchiveButton = btn.innerHTML.includes('M480-256.16L626.15') || btn.innerHTML.includes('M200-643.85v431.54');

        if (isArchiveButton) {
            const { uuid, title, project } = extractMetadataFromElement(target);
            if (uuid) {
                console.log(`[Antigravity Mod] 监听到归档动作，UUID: ${uuid}，触发浅层清理...`);
                try {
                    const url = `http://127.0.0.1:9216/api/script/archive_brain?uuid=${uuid}&title=${encodeURIComponent(title)}&project=${encodeURIComponent(project)}`;
                    const res = await fetch(url);
                    const data = await res.json();
                    if (data.success) {
                        console.log(`[Antigravity Mod] 归档浅层清理成功:`, data.output);
                    } else {
                        console.error(`[Antigravity Mod] 归档清理失败:`, data.error);
                    }
                } catch (err) {
                    console.error(`[Antigravity Mod] 请求 TaiChi 后端失败:`, err);
                }
            } else {
                console.warn('[Antigravity Mod] 监听到归档动作，但未能提取到 UUID。');
            }
        }
    }, true); // 使用捕获阶段，确保在前端原生事件阻止前触发
}
