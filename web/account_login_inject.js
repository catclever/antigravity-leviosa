/**
 * Antigravity Login Page Multi-Account Injection
 * Path: web/account_login_inject.js
 */

const API_BASE = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/account_manager';

async function callAccountApi(params = {}) {
    const qs = new URLSearchParams({ ...params, nocache: '1' }).toString();
    const res = await fetch(`${API_BASE}?${qs}`);
    return await res.json();
}

/**
 * Global Styles for Account Injection & Modals
 */
function ensureStyles() {
    const styleId = 'leviosa-account-login-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        @keyframes leviosaFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes leviosaScaleIn {
            from { opacity: 0; transform: scale(0.96) translateY(-4px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes leviosaSpin {
            to { transform: rotate(360deg); }
        }

        .leviosa-auth-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-weight: 500 !important;
            font-size: 14px !important;
            line-height: 1 !important;
            user-select: none !important;
            outline: none !important;
            cursor: pointer !important;
            border: 1px solid var(--border, rgba(140, 140, 140, 0.28)) !important;
            background: transparent !important;
            color: var(--foreground, #ededed) !important;
            position: relative !important;
            width: 100% !important;
            height: 40px !important;
            gap: 8px !important;
            border-radius: 8px !important;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .leviosa-auth-btn:hover {
            background-color: var(--muted, rgba(140, 140, 140, 0.12)) !important;
            border-color: color-mix(in srgb, var(--foreground, #fff) 30%, var(--border, rgba(140, 140, 140, 0.3))) !important;
        }
        .leviosa-auth-btn:active {
            transform: scale(0.99) !important;
        }

        .leviosa-modal-overlay {
            position: fixed !important;
            inset: 0 !important;
            z-index: 99999 !important;
            background: rgba(0, 0, 0, 0.65) !important;
            backdrop-filter: blur(6px) !important;
            -webkit-backdrop-filter: blur(6px) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            padding: 16px !important;
            animation: leviosaFadeIn 0.2s ease !important;
        }

        .leviosa-modal-card {
            background: var(--card, #1c1c1e) !important;
            border: 1px solid var(--border, rgba(255, 255, 255, 0.12)) !important;
            border-radius: 16px !important;
            width: 460px !important;
            max-width: 92vw !important;
            max-height: 85vh !important;
            box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.5) !important;
            display: flex !important;
            flex-direction: column !important;
            overflow: hidden !important;
            color: var(--foreground, #ededed) !important;
            font-family: inherit !important;
            animation: leviosaScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }

        .leviosa-modal-header {
            padding: 18px 20px 14px 20px !important;
            border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08)) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
        }

        .leviosa-modal-body {
            padding: 16px 20px !important;
            overflow-y: auto !important;
            flex: 1 1 auto !important;
        }

        .leviosa-modal-footer {
            padding: 14px 20px !important;
            border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08)) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: flex-end !important;
            gap: 10px !important;
            background: rgba(0, 0, 0, 0.08) !important;
        }

        .leviosa-account-item {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 10px 12px !important;
            border-radius: 10px !important;
            border: 1px solid transparent !important;
            cursor: pointer !important;
            transition: all 0.18s ease !important;
            margin-bottom: 8px !important;
        }
        .leviosa-account-item:hover {
            background: var(--muted, rgba(255, 255, 255, 0.06)) !important;
            border-color: var(--border, rgba(255, 255, 255, 0.12)) !important;
        }
        .leviosa-account-item.is-active {
            background: color-mix(in srgb, var(--primary, #3b82f6) 10%, transparent) !important;
            border-color: color-mix(in srgb, var(--primary, #3b82f6) 35%, transparent) !important;
        }

        .leviosa-spinner {
            width: 16px !important;
            height: 16px !important;
            border: 2px solid rgba(255, 255, 255, 0.25) !important;
            border-top-color: currentColor !important;
            border-radius: 50% !important;
            animation: leviosaSpin 0.7s linear infinite !important;
            display: inline-block !important;
        }

        .leviosa-toast {
            position: fixed !important;
            top: 24px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            z-index: 100000 !important;
            padding: 10px 18px !important;
            border-radius: 10px !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            box-shadow: 0 12px 24px -4px rgba(0, 0, 0, 0.35) !important;
            animation: leviosaScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
            backdrop-filter: blur(8px) !important;
            -webkit-backdrop-filter: blur(8px) !important;
        }
        .leviosa-toast-success {
            background: rgba(16, 185, 129, 0.92) !important;
            color: #ffffff !important;
        }
        .leviosa-toast-error {
            background: rgba(239, 68, 68, 0.92) !important;
            color: #ffffff !important;
        }
        .leviosa-toast-info {
            background: rgba(30, 41, 59, 0.95) !important;
            color: #f8fafc !important;
            border: 1px solid rgba(255, 255, 255, 0.15) !important;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Toast Notification Helper
 */
function showToast(message, type = 'info', duration = 3000) {
    const existing = document.getElementById('leviosa-floating-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'leviosa-floating-toast';
    toast.className = `leviosa-toast leviosa-toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'error') {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
    } else {
        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(-10px)';
            setTimeout(() => toast.remove(), 250);
        }
    }, duration);
}

/**
 * Close any active modal
 */
function closeModal() {
    const modal = document.querySelector('.leviosa-modal-overlay');
    if (modal) modal.remove();
}

/**
 * Polls language_server.log via backend API until the new language_server process
 * has finished initializing ("Serving UI bundle from embedded assets") and navigates
 * directly to the new port URL. Never calls window.location.reload() on the dead old port!
 */
function waitForLanguageServerAndNavigate(previousPid = null, previousPort = null) {
    let attempts = 0;
    const maxAttempts = 60; // up to ~60s
    const timer = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(timer);
            return;
        }
        try {
            const st = await callAccountApi({ action: 'get_ls_status' });
            if (!st || !st.success || !st.port || !st.ready) return;

            const isNewProcess =
                (previousPid && st.pid && st.pid !== previousPid) ||
                (previousPort && st.port && st.port !== previousPort) ||
                (!previousPid && !previousPort);

            if (isNewProcess && st.url) {
                clearInterval(timer);
                // If Electron's onPortChanged hasn't already switched us to the new port, navigate directly
                if (!window.location.href.startsWith(st.url)) {
                    window.location.href = st.url;
                }
            }
        } catch (e) {}
    }, 1000);
}

/**
 * Modal A: 选择已有账号
 */
async function openAccountSelectorModal() {
    closeModal();
    ensureStyles();

    const overlay = document.createElement('div');
    overlay.className = 'leviosa-modal-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    const card = document.createElement('div');
    card.className = 'leviosa-modal-card';

    // Header
    card.innerHTML = `
        <div class="leviosa-modal-header">
            <div>
                <h3 style="font-size: 16px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    选择已有账号
                </h3>
                <p style="font-size: 12px; color: var(--muted-foreground, #9ca3af); margin: 4px 0 0 0;">点击直接切换登录，无需重复扫码授权</p>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <button id="leviosa-btn-add-new-header" title="添加新账号" style="background: transparent; border: 1px solid var(--border, rgba(255, 255, 255, 0.15)); cursor: pointer; color: var(--foreground, #ededed); width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
                <button id="leviosa-modal-close-btn" title="关闭" style="background: transparent; border: none; cursor: pointer; color: var(--muted-foreground, #9ca3af); padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        </div>
        <div class="leviosa-modal-body" id="leviosa-account-list-container">
            <div style="display: flex; align-items: center; justify-content: center; padding: 32px 0; gap: 10px; color: var(--muted-foreground, #9ca3af); font-size: 14px;">
                <span class="leviosa-spinner"></span>
                <span>正在加载已保存账号...</span>
            </div>
        </div>
        <div class="leviosa-modal-footer" style="justify-content: space-between;">
            <button id="leviosa-btn-add-new-from-list" title="添加新账号" style="background: transparent; border: 1px solid var(--border, rgba(255, 255, 255, 0.15)); cursor: pointer; color: var(--primary, #3b82f6); width: 32px; height: 32px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button id="leviosa-btn-cancel-list" class="leviosa-auth-btn" style="width: auto; padding: 0 16px; height: 32px; font-size: 13px;">
                取消
            </button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    card.querySelector('#leviosa-modal-close-btn').addEventListener('click', closeModal);
    card.querySelector('#leviosa-btn-cancel-list').addEventListener('click', closeModal);
    
    const triggerAddToken = () => {
        closeModal();
        openTokenLoginModal();
    };
    card.querySelector('#leviosa-btn-add-new-from-list')?.addEventListener('click', triggerAddToken);
    card.querySelector('#leviosa-btn-add-new-header')?.addEventListener('click', triggerAddToken);

    // Fetch account list
    try {
        const data = await callAccountApi({ action: 'list' });

        const container = card.querySelector('#leviosa-account-list-container');
        if (!container) return;

        if (!data.success || !data.accounts || data.accounts.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 36px 16px; color: var(--muted-foreground, #9ca3af);">
                    <svg style="margin: 0 auto 12px auto; opacity: 0.5;" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                    <div style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">暂无归档账号</div>
                    <div style="font-size: 12px; opacity: 0.8;">请先通过 Refresh Token 添加并保存您的 Google 账号</div>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        data.accounts.forEach((acc) => {
            const item = document.createElement('div');
            item.className = `leviosa-account-item ${acc.is_active ? 'is-active' : ''}`;

            const avatarLetter = (acc.name || acc.email || 'U')[0].toUpperCase();
            const avatarHtml = acc.picture 
                ? `<img src="${acc.picture}" alt="" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border, rgba(255,255,255,0.1));" onerror="this.outerHTML='<div style=\\'width:38px;height:38px;border-radius:50%;background:rgba(59,130,246,0.15);color:#3b82f6;font-weight:600;display:flex;align-items:center;justify-content:center;font-size:15px;border:1px solid rgba(59,130,246,0.3);\\'>${avatarLetter}</div>'">`
                : `<div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(59,130,246,0.15); color: #3b82f6; font-weight: 600; display: flex; align-items: center; justify-content: center; font-size: 15px; border: 1px solid rgba(59,130,246,0.3);">${avatarLetter}</div>`;

            const badgeHtml = acc.is_active 
                ? `<span style="font-size: 11px; font-weight: 500; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;">
                     当前已登录
                   </span>`
                : '';

            const clientTag = acc.client_type === 'business'
                ? `<span style="font-size: 10px; opacity: 0.65; border: 1px solid var(--border, rgba(255,255,255,0.15)); padding: 0 4px; border-radius: 3px;">企业</span>`
                : '';

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1 1 auto;">
                    ${avatarHtml}
                    <div style="min-width: 0; flex: 1 1 auto;">
                        <div style="display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 500; color: var(--foreground, #ededed);">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${acc.name || acc.email.split('@')[0]}</span>
                            ${clientTag}
                            ${badgeHtml}
                        </div>
                        <div style="font-size: 12px; color: var(--muted-foreground, #9ca3af); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">
                            ${acc.email}
                        </div>
                    </div>
                </div>
                <div class="leviosa-item-action" style="margin-left: 12px; flex-shrink: 0;">
                    <button class="leviosa-btn-switch-item leviosa-auth-btn" style="height: 28px; padding: 0 12px; font-size: 12px; width: auto; font-weight: 500;">
                        登录
                    </button>
                </div>
            `;

            item.addEventListener('click', async () => {
                const actionContainer = item.querySelector('.leviosa-item-action');
                if (actionContainer) {
                    actionContainer.innerHTML = `<span class="leviosa-spinner" style="color: var(--primary, #3b82f6);"></span>`;
                }
                showToast(`正在以 ${acc.email} 登录...`, 'info', 2500);

                try {
                    const switchData = await callAccountApi({ action: 'switch', email: acc.email });

                    if (switchData.success) {
                        closeModal();
                        showToast(`登录成功: ${acc.email}，正在重启语言服务并进入工作台...`, 'success', 12000);
                        waitForLanguageServerAndNavigate(switchData.previous_ls_pid, switchData.previous_ls_port);
                    } else {
                        showToast(`登录失败: ${switchData.error || '未知错误'}`, 'error', 4000);
                        if (actionContainer) {
                            actionContainer.innerHTML = `<button class="leviosa-btn-switch-item leviosa-auth-btn" style="height: 28px; padding: 0 12px; font-size: 12px; width: auto; font-weight: 500;">重试</button>`;
                        }
                    }
                } catch (err) {
                    showToast(`网络请求失败: ${err.message}`, 'error', 4000);
                    if (actionContainer) {
                        actionContainer.innerHTML = `<button class="leviosa-btn-switch-item leviosa-auth-btn" style="height: 28px; padding: 0 12px; font-size: 12px; width: auto; font-weight: 500;">重试</button>`;
                    }
                }
            });

            container.appendChild(item);
        });

    } catch (err) {
        const container = card.querySelector('#leviosa-account-list-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 24px 16px; color: #ef4444; font-size: 13px;">
                    获取账号列表失败: ${err.message}
                </div>
            `;
        }
    }
}

/**
 * Modal B: 通过 Refresh Token 获取账号
 */
function openTokenLoginModal() {
    closeModal();
    ensureStyles();

    const overlay = document.createElement('div');
    overlay.className = 'leviosa-modal-overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    const card = document.createElement('div');
    card.className = 'leviosa-modal-card';

    card.innerHTML = `
        <div class="leviosa-modal-header">
            <div>
                <h3 style="font-size: 16px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"></path><path d="m21 2-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle></svg>
                    通过 Refresh Token 获取账号
                </h3>
                <p style="font-size: 12px; color: var(--muted-foreground, #9ca3af); margin: 4px 0 0 0;">输入 Google OAuth Refresh Token，自动同步个人信息并切换登录</p>
            </div>
            <button id="leviosa-token-modal-close" style="background: transparent; border: none; cursor: pointer; color: var(--muted-foreground, #9ca3af); padding: 4px; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div class="leviosa-modal-body">
            <div style="margin-bottom: 14px;">
                <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--foreground, #ededed);">
                    Google Refresh Token <span style="color: #ef4444;">*</span>
                </label>
                <textarea id="leviosa-token-input" rows="3" placeholder="1//0..." style="width: 100%; box-sizing: border-box; background: var(--muted, rgba(0,0,0,0.25)); border: 1px solid var(--border, rgba(255,255,255,0.15)); border-radius: 8px; padding: 10px 12px; color: var(--foreground, #ededed); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12.5px; line-height: 1.4; outline: none; resize: vertical; transition: border-color 0.2s;"></textarea>
            </div>
            <div style="margin-bottom: 14px;">
                <label style="display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--foreground, #ededed);">
                    账号类型
                </label>
                <div style="display: flex; gap: 16px;">
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                        <input type="radio" name="leviosa-client-type" value="consumer" checked style="accent-color: #3b82f6;">
                        <span>个人版 (Consumer)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;">
                        <input type="radio" name="leviosa-client-type" value="business" style="accent-color: #3b82f6;">
                        <span>企业版 (Business)</span>
                    </label>
                </div>
            </div>
            <div id="leviosa-token-error-msg" style="display: none; padding: 8px 12px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 8px; color: #f87171; font-size: 12px; line-height: 1.4; margin-top: 10px;"></div>
        </div>
        <div class="leviosa-modal-footer">
            <button id="leviosa-token-cancel-btn" class="leviosa-auth-btn" style="width: auto; padding: 0 16px; height: 34px; font-size: 13px;">
                取消
            </button>
            <button id="leviosa-token-submit-btn" class="leviosa-auth-btn" style="width: auto; padding: 0 20px; height: 34px; font-size: 13px; background: color-mix(in srgb, var(--primary, #3b82f6) 20%, transparent) !important; border-color: color-mix(in srgb, var(--primary, #3b82f6) 50%, transparent) !important; color: #60a5fa !important; font-weight: 600;">
                登录并切换
            </button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const tokenInput = card.querySelector('#leviosa-token-input');
    const submitBtn = card.querySelector('#leviosa-token-submit-btn');
    const cancelBtn = card.querySelector('#leviosa-token-cancel-btn');
    const closeBtn = card.querySelector('#leviosa-token-modal-close');
    const errorBox = card.querySelector('#leviosa-token-error-msg');

    setTimeout(() => tokenInput?.focus(), 50);

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    submitBtn.addEventListener('click', async () => {
        const token = tokenInput.value.trim();
        if (!token) {
            tokenInput.style.borderColor = '#ef4444';
            tokenInput.focus();
            return;
        }

        const clientType = card.querySelector('input[name="leviosa-client-type"]:checked')?.value || 'consumer';

        // Set loading state
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
        submitBtn.innerHTML = `<span class="leviosa-spinner"></span><span>验证并获取中...</span>`;
        errorBox.style.display = 'none';

        try {
            // Step 1: Add account via refresh token
            const addData = await callAccountApi({ action: 'add', refresh_token: token, client_type: clientType });

            if (!addData.success) {
                throw new Error(addData.error || 'Token 验证失败，请检查是否有效');
            }

            const targetEmail = addData.email || addData.account?.email;

            // Step 2: Switch to newly added account
            submitBtn.innerHTML = `<span class="leviosa-spinner"></span><span>正在切换登录...</span>`;
            const switchData = await callAccountApi({ action: 'switch', email: targetEmail });

            if (!switchData.success) {
                throw new Error(switchData.error || '账号切换写入失败');
            }

            closeModal();
            showToast(`登录成功: ${targetEmail}，正在重启语言服务并进入工作台...`, 'success', 12000);
            waitForLanguageServerAndNavigate(switchData.previous_ls_pid, switchData.previous_ls_port);

        } catch (err) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
            submitBtn.innerHTML = '登录并切换';
            errorBox.style.display = 'block';
            errorBox.textContent = `操作失败: ${err.message}`;
        }
    });
}

/**
 * Creates one of the two action buttons
 */
function createActionButton({ id, text, iconSvg, onClick }) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'leviosa-auth-btn';
    btn.type = 'button';
    btn.innerHTML = `${iconSvg}<span>${text}</span>`;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    return btn;
}

/**
 * Inspects DOM and injects buttons into entrance auth panel
 */
function tryInjectEntranceButtons() {
    if (document.getElementById('leviosa-account-buttons-container')) return;

    const authPanel = document.querySelector('.entrance-auth-panel');
    if (!authPanel) return;

    // Find card container inside entrance-auth-panel
    const card = authPanel.querySelector('.border.bg-card') || 
                 authPanel.querySelector('.bg-card') || 
                 authPanel.querySelector('.rounded-2xl') ||
                 authPanel.firstElementChild;
    if (!card) return;

    const buttons = Array.from(card.querySelectorAll('button'));
    if (buttons.length === 0) return;

    // Locate "Use Business Account" button
    let businessBtn = buttons.find(b => /business|企业/i.test(b.textContent));
    if (!businessBtn && buttons.length > 1) {
        businessBtn = buttons[buttons.length - 1];
    }

    const container = document.createElement('div');
    container.id = 'leviosa-account-buttons-container';
    container.className = 'w-full flex flex-col gap-2.5 my-1';

    const selectBtn = createActionButton({
        id: 'leviosa-btn-select-account',
        text: '选择已有账号',
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
        onClick: openAccountSelectorModal
    });

    const tokenBtn = createActionButton({
        id: 'leviosa-btn-token-login',
        text: '通过 Refresh Token 获取账号',
        iconSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"></path><path d="m21 2-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle></svg>`,
        onClick: openTokenLoginModal
    });

    container.appendChild(selectBtn);
    container.appendChild(tokenBtn);

    if (businessBtn && businessBtn.parentNode === card) {
        card.insertBefore(container, businessBtn);
    } else if (buttons[0] && buttons[0].nextSibling) {
        card.insertBefore(container, buttons[0].nextSibling);
    } else {
        card.appendChild(container);
    }

    console.log('[Antigravity Mod] 成功在登录面板注入多账号管理按钮！');
}

let cachedActiveAccount = null;

async function getCachedActive() {
    if (!cachedActiveAccount) {
        try {
            const res = await callAccountApi({ action: 'get_active' });
            if (res && res.success && res.active) {
                cachedActiveAccount = res.active;
            }
        } catch (e) {}
    }
    return cachedActiveAccount;
}

/**
 * Inspects DOM and injects Change account button next to Settings "Sign Out" button
 */
function tryInjectSettingsChangeButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const signOutBtn = buttons.find(b => b.textContent.trim() === 'Sign Out');
    if (!signOutBtn) return;

    const parent = signOutBtn.parentElement;
    if (!parent) return;

    // Avoid duplicate injection
    if (parent.querySelector('#leviosa-change-account-btn')) return;

    const changeBtn = document.createElement('button');
    changeBtn.id = 'leviosa-change-account-btn';
    changeBtn.type = 'button';
    changeBtn.className = signOutBtn.className;
    changeBtn.title = '切换账号';
    changeBtn.style.cursor = 'pointer';
    changeBtn.style.padding = '0 8px';
    changeBtn.style.gap = '6px';

    const renderBtnContent = (picUrl = null, isLoading = false) => {
        const avatarHtml = picUrl
            ? `<img src="${picUrl}" alt="" style="width: 15px; height: 15px; border-radius: 50%; object-fit: cover; display: inline-block;" onerror="this.outerHTML='<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'13\\' height=\\'13\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\'><path d=\\'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\\'/><circle cx=\\'12\\' cy=\\'7\\' r=\\'4\\'/></svg>'">`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

        if (isLoading) {
            return `<span style="display: inline-flex; align-items: center; justify-content: center;">${avatarHtml}</span><span class="leviosa-spinner" style="width: 11px; height: 11px; border-width: 1.5px;"></span>`;
        }

        const swapArrowHtml = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.85;"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg>`;

        return `<span style="display: inline-flex; align-items: center; justify-content: center;">${avatarHtml}</span>${swapArrowHtml}`;
    };

    changeBtn.innerHTML = renderBtnContent(cachedActiveAccount?.picture || null, false);

    // Fetch active account picture asynchronously if not yet loaded
    if (!cachedActiveAccount) {
        getCachedActive().then(acc => {
            if (acc && acc.picture && document.body.contains(changeBtn) && !changeBtn.disabled) {
                changeBtn.innerHTML = renderBtnContent(acc.picture, false);
            }
        });
    }

    // Ensure horizontal alignment with Sign Out
    parent.style.display = 'inline-flex';
    parent.style.alignItems = 'center';
    parent.style.gap = '8px';

    changeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        changeBtn.disabled = true;
        changeBtn.style.opacity = '0.7';
        changeBtn.innerHTML = renderBtnContent(cachedActiveAccount?.picture || null, true);

        try {
            // 1. 检查当前活跃账号是否已归档，若无则入库
            const activeRes = await callAccountApi({ action: 'archive_current' });
            if (activeRes && activeRes.success) {
                if (activeRes.account?.picture) {
                    cachedActiveAccount = activeRes.account;
                }
                if (activeRes.is_new) {
                    showToast(`当前账号 (${activeRes.email}) 已自动入库归档！`, 'success', 3000);
                } else {
                    console.log('[Antigravity Mod] 当前账号已在库中:', activeRes.email);
                }
            } else if (activeRes && activeRes.error) {
                console.warn('[Antigravity Mod] 检查账号入库提醒:', activeRes.error);
            }
        } catch (err) {
            console.warn('[Antigravity Mod] 检查账号入库请求异常:', err);
        } finally {
            changeBtn.disabled = false;
            changeBtn.style.opacity = '1';
            changeBtn.innerHTML = renderBtnContent(cachedActiveAccount?.picture || null, false);
        }

        // 2. 打开账号选择面板
        openAccountSelectorModal();
    });

    parent.insertBefore(changeBtn, signOutBtn);
    console.log('[Antigravity Mod] 成功在 Settings 面板 Sign Out 旁注入纯图标 Change 按钮！');
}

function tryInjectAll() {
    tryInjectEntranceButtons();
    tryInjectSettingsChangeButton();
}

/**
 * Main Entry Point
 */
export function initAccountLoginInject() {
    ensureStyles();

    // Auto-recover if Electron landed on chrome-error://chromewebdata/ due to ERR_CONNECTION_REFUSED or ERR_TIMED_OUT
    if (window.location.href.startsWith('chrome-error://') || (!document.getElementById('root') && document.body?.classList?.contains('neterror'))) {
        showToast('正在等待语言服务初始化就绪并自动进入界面...', 'info', 20000);
        waitForLanguageServerAndNavigate(null, null);
        return;
    }

    // Auto-sync currently logged-in account (if any) into ~/.gemini/.accounts/
    callAccountApi({ action: 'list' }).catch(() => {});

    // Listen for Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Try initial injection
    tryInjectAll();

    // Observe dynamic DOM changes (e.g. navigation / modal appearance)
    const observer = new MutationObserver(() => {
        tryInjectAll();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('✅ [Antigravity Mod] 账号注入与管理模块已初始化！');
}
