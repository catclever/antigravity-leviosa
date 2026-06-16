// archive_hook.js

const HOOK_CONFIG = {
    enableShallowArchive: true,  // 开启/关闭浅层归档监听（点击普通归档按钮时触发清理）
    enableDeepArchive: true      // 开启/关闭深层归档监听（注入 Deep Archive 按钮到删除弹窗）
};

export function initArchiveHook() {
    console.log('[Antigravity Mod] 初始化 Archive Hook 监听器, Config:', HOOK_CONFIG);

    // 从 DOM 中提取 UUID、标题和项目名
    // 终极黑客魔法：通过 React Fiber 树逆向读取绑定的数据
    function extractMetadataFromElement(el) {
        let metadata = { uuid: null, title: 'Unknown', project: 'Unknown' };
        
        // 1. 最高优先级：尝试从原生 DOM 的 data-testid 中提取（侧边栏适用）
        const rowDom = el.closest('div[role="button"], button.hover\\:bg-muted, .group');
        if (rowDom) {
            const pillSpan = rowDom.querySelector('[data-testid^="convo-pill-"]');
            if (pillSpan) {
                const testId = pillSpan.getAttribute('data-testid');
                metadata.uuid = testId.replace('convo-pill-', '');
                metadata.title = pillSpan.textContent.trim();
            } else {
                // 如果没有 pillSpan，尝试提取 title 文本兜底
                const titleSpan = rowDom.querySelector('.text-sm.truncate');
                if (titleSpan) metadata.title = titleSpan.textContent.trim();
            }
            
            const projectSpan = rowDom.querySelector('.text-xs.text-muted-foreground');
            if (projectSpan) {
                const cloned = projectSpan.cloneNode(true);
                metadata.project = cloned.textContent.trim();
            }
            
            // 如果在 DOM 里直接找到了 uuid，就直接返回，不再去爬虚拟树！
            if (metadata.uuid) return metadata;
        }

        // 2. 利用 React Fiber 树强行扒出深埋的 UUID（对话历史列表适用）
        // 既然我们在 DOM 提取到了 Title，我们就可以用这个 Title 作为“指纹”，去内存里做精准匹配！
        let current = el;
        while (current) {
            const fiberKey = Object.keys(current).find(k => k.startsWith('__reactFiber$'));
            if (fiberKey) {
                let fiber = current[fiberKey];
                let attempts = 0;
                
                // 为了防止深层递归卡死浏览器，我们只检查最常见的几个属性层级
                function fastSearchUUID(props, targetTitle) {
                    if (!props || typeof props !== 'object') return null;
                    
                    const idRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    const normalize = (s) => (s || '').replace(/\\s+/g, '').toLowerCase();
                    const normTarget = normalize(targetTitle);
                    
                    function safeFindUUID(obj, maxDepth = 2, currentDepth = 0, visited = new Set()) {
                        if (!obj || typeof obj !== 'object' || currentDepth > maxDepth || visited.has(obj)) return null;
                        visited.add(obj);

                        const idRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                        // 支持常见的各种命名
                        let possibleId = obj.id || obj.uuid || obj._id || obj.conversationId || obj.convoId;
                        let objTitle = obj.title || obj.name;

                        if (typeof possibleId === 'string' && idRegex.test(possibleId)) {
                            if (normTarget && objTitle) {
                                const nTitle = normalize(objTitle);
                                if (nTitle.includes(normTarget) || normTarget.includes(nTitle)) {
                                    return possibleId;
                                }
                            } else if (!normTarget) {
                                // 没能提取到指纹就盲信
                                return possibleId;
                            }
                        }

                        const keys = Object.keys(obj);
                        if (keys.length > 50) return null; // 忽略属性太多的庞然大物（如整个 store），防止卡死

                        for (const key of keys) {
                            // 排除常见的带有巨大循环引用风险的底层对象
                            if (key.startsWith('__') || key === 'children' || key === 'parent' || key === 'owner' || key === 'store' || key === 'queryClient' || key === 'client') continue;
                            const res = safeFindUUID(obj[key], maxDepth, currentDepth + 1, visited);
                            if (res) return res;
                        }
                        
                        return null;
                    }

                    return safeFindUUID(props);
                }

                // 向上遍历虚拟 DOM 树，最多找 15 层
                while (fiber && attempts < 15) {
                    if (fiber.memoizedProps) {
                        // 打印出来看看里面的结构，方便分析为什么之前找不到
                        console.log('[Antigravity Mod] 尝试解析 Fiber Props (Level ' + attempts + '):', fiber.memoizedProps);
                        
                        const foundUUID = fastSearchUUID(fiber.memoizedProps, metadata.title);
                        if (foundUUID) {
                            console.log('[Antigravity Mod] 成功在 Fiber 中提取到 UUID:', foundUUID);
                            metadata.uuid = foundUUID;
                            return metadata; // 精准命中！
                        }
                    }
                    fiber = fiber.return;
                    attempts++;
                }
            }
            current = current.parentElement;
        }

        // 不再使用 URL 兜底！如果虚拟树提取失败，直接返回，宁可失败也不能归档错误的对话！
        
        return metadata;
    }

    // 全局定义放行开关，用于“借刀杀人”触发原生删除
    let bypassDeleteIntercept = false;

    document.addEventListener('click', async (e) => {
        const target = e.target;
        const btn = target.closest('button');
        if (!btn) return;

        // 如果放行开关打开，直接放行给原生 React 处理！
        if (bypassDeleteIntercept) {
            bypassDeleteIntercept = false; // 消费一次就关上
            return;
        }

        // 通过判断按钮内的 SVG path 来精准定位是否为“归档”按钮
        // 归档图标（向下的箭头）包含 M480-256.16L626.15，去除了共通的盒子部分，防止和 Restore 按钮冲突！
        const isArchiveButton = btn.innerHTML.includes('M480-256.16L626.15');

        if (HOOK_CONFIG.enableShallowArchive && isArchiveButton) {
            const { uuid, title, project } = extractMetadataFromElement(target);
            if (uuid) {
                console.log(`[Antigravity Mod] 监听到浅层归档动作，UUID: ${uuid}，触发浅层清理...`);
                try {
                    const url = `http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/archive_brain?action=shallow&uuid=${uuid}&title=${encodeURIComponent(title)}&project=${encodeURIComponent(project)}`;
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
                console.warn('[Antigravity Mod] 监听到浅层归档动作，但未能提取到 UUID。');
            }
            return;
        }



    }, true); // 使用捕获阶段

    // ==========================================
    // 注入“Deep Archive”按钮到删除弹窗的逻辑
    // ==========================================
    if (HOOK_CONFIG.enableDeepArchive) {
        let pendingDeepArchiveConvo = null;

        // 记录用户最后点击的对话（为了拿到上下文）
        document.addEventListener('click', (e) => {
        // 放宽限制，只要是可点击的列表项或带有 hover 效果的按钮就尝试提取
        const row = e.target.closest('div[role="button"], button.hover\\:bg-muted, .group');
        if (row) {
            const extracted = extractMetadataFromElement(e.target);
            if (extracted && (extracted.uuid || (extracted.title && extracted.title !== 'Unknown'))) {
                pendingDeepArchiveConvo = extracted;
            }
        }
    }, true);

    const observer = new MutationObserver(() => {
        // 寻找弹窗的标题 "Delete Conversation"
        const popupHeaders = Array.from(document.querySelectorAll('.font-medium.text-foreground'));
        const targetHeader = popupHeaders.find(el => el.textContent.trim() === 'Delete Conversation');
        
        if (targetHeader) {
            const popupContainer = targetHeader.closest('.p-4');
            if (popupContainer) {
                const btnGroup = popupContainer.querySelector('.flex.justify-end.gap-3');
                // 确保找到了按钮组，并且还没有被我们注入过
                if (btnGroup && !btnGroup.querySelector('#ag-deep-archive-btn')) {
                    console.log('[Antigravity Mod] 发现 Delete 弹窗，准备注入 Deep Archive 按钮');
                    
                    const deepBtn = document.createElement('button');
                    deepBtn.id = 'ag-deep-archive-btn';
                    // 使用稍微不同于原生 Delete 按钮的颜色（比如蓝色背景）以作区分
                    deepBtn.className = 'select-none text-sm font-medium transition-all rounded-md px-3 py-1 outline-none bg-blue-600 text-white hover:bg-blue-700 cursor-pointer flex flex-row items-center gap-2';
                    deepBtn.innerHTML = 'Deep Archive <span class="opacity-60 text-xs">📦</span>';
                    
                    // 将它插入在 Delete 按钮的前面（或者直接插在容器里）
                    const deleteBtn = btnGroup.lastElementChild;
                    btnGroup.insertBefore(deepBtn, deleteBtn);
                    
                    deepBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const info = pendingDeepArchiveConvo || { uuid: null, title: 'N/A' };
                        
                        // 改变按钮状态为 Loading
                        deepBtn.innerHTML = 'Archiving... <span class="opacity-60 text-xs">⏳</span>';
                        deepBtn.disabled = true;

                        if (!info.uuid && info.title !== 'N/A') {
                            console.log(`[Antigravity Mod] DOM 提取失败，启动账本兜底查询 (Title: ${info.title})`);
                            const lookupUrl = `http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/archive_brain?action=lookup&title=${encodeURIComponent(info.title)}`;
                            fetch(lookupUrl).then(res => res.json()).then(lookupData => {
                                if (lookupData.success && lookupData.uuid) {
                                    console.log(`[Antigravity Mod] 账本兜底成功！找到 UUID: ${lookupData.uuid}`);
                                    info.uuid = lookupData.uuid;
                                    if (lookupData.project) info.project = lookupData.project;
                                    triggerPopupDeepArchive(info, deepBtn, deleteBtn);
                                } else {
                                    // 终极保底：如果账本查不到，看看是不是就是当前正在看的这个对话
                                    const urlMatch = window.location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
                                    const pageTitle = document.title || '';
                                    if (urlMatch && (pageTitle.includes(info.title) || info.title === 'N/A')) {
                                        console.log(`[Antigravity Mod] 账本未找到，但当前页面 URL 匹配，且标题一致，安全使用当前 URL UUID`);
                                        info.uuid = urlMatch[0];
                                        triggerPopupDeepArchive(info, deepBtn, deleteBtn);
                                    } else {
                                        alert(`未找到对话 UUID，且账本兜底查询失败：\n${lookupData.error || '未知错误'}\n（提示：只能归档曾经活动过或当前打开的对话）`);
                                        deepBtn.innerHTML = 'Deep Archive <span class="opacity-60 text-xs">📦</span>';
                                        deepBtn.disabled = false;
                                    }
                                }
                            }).catch(err => {
                                alert('兜底查询请求失败: ' + err);
                                deepBtn.innerHTML = 'Deep Archive <span class="opacity-60 text-xs">📦</span>';
                                deepBtn.disabled = false;
                            });
                            return;
                        } else if (!info.uuid) {
                            alert('未找到对话 UUID，且没有标题，无法执行归档。');
                            deepBtn.innerHTML = 'Deep Archive <span class="opacity-60 text-xs">📦</span>';
                            deepBtn.disabled = false;
                            return;
                        }
                        
                        triggerPopupDeepArchive(info, deepBtn, deleteBtn);

                        function triggerPopupDeepArchive(info, deepBtn, deleteBtn) {
                            console.log(`[Antigravity Mod] 触发深层归档 (弹窗按钮), UUID: ${info.uuid}`);
                            const url = `http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/archive_brain?action=deep&uuid=${info.uuid}&title=${encodeURIComponent(info.title)}&project=${encodeURIComponent(info.project)}`;
                            
                            fetch(url).then(res => res.json()).then(data => {
                                if (data.success) {
                                    console.log('[Antigravity Mod] Deep Archive 弹窗打包成功！准备点击原生 Delete。');
                                    if (deleteBtn) deleteBtn.click();
                                } else {
                                    alert('深层归档打包失败: ' + data.error);
                                    deepBtn.innerHTML = 'Deep Archive <span class="opacity-60 text-xs">📦</span>';
                                    deepBtn.disabled = false;
                                }
                            }).catch(err => {
                                alert('请求深层归档失败: ' + err);
                                deepBtn.innerHTML = 'Deep Archive <span class="opacity-60 text-xs">📦</span>';
                                deepBtn.disabled = false;
                            });
                        }
                    });
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
}
}
