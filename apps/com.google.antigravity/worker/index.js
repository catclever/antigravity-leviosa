module.exports = async function(query) {
    const port = query.port;
    if (!port) {
        return { success: false, error: "Missing port parameter" };
    }

    const appId = "com.google.antigravity";
    const entryUrl = `http://127.0.0.1:9216/src/apps/${appId}/web/main.js`;

    const fs = require('fs');
    const logFile = '/tmp/taichi_worker.log';
    const log = (msg) => fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    
    log(`Starting injection for app ${appId} on port ${port}...`);

    try {
        // 1. Fetch CDP targets (with retry logic for slow startup)
        log(`Fetching targets from http://127.0.0.1:${port}/json/list...`);
        const injectedTargets = new Set();
        const maxTime = Date.now() + 15000; // Poll for 15 seconds

        const expression = `
            (function() {
                if (window.__taichi_injected) return;
                window.__taichi_injected = true;
                console.log("[TaiChi] Injection script active on " + window.location.href);
                
                const loadMod = () => {
                    import('${entryUrl}')
                        .then(() => console.log("[TaiChi] Import successful! Mod should be active."))
                        .catch(e => console.error("[TaiChi] Import Error:", e));
                };

                const startMod = () => {
                    setTimeout(loadMod, 1500);
                };

                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                    startMod();
                } else {
                    window.addEventListener('load', startMod);
                }
            })();
        `;

        const injectIntoTarget = (target) => {
            return new Promise((resolve) => {
                const ws = new WebSocket(target.webSocketDebuggerUrl);
                let timeoutId = setTimeout(() => {
                    ws.close();
                    resolve();
                }, 5000);

                ws.onopen = () => {
                    log(`WebSocket opened for ${target.id}. Sending Page.enable...`);
                    ws.send(JSON.stringify({ id: 1, method: "Page.enable" }));
                };

                ws.onmessage = (event) => {
                    const res = JSON.parse(event.data);
                    if (res.id === 1) {
                        ws.send(JSON.stringify({
                            id: 2,
                            method: "Page.addScriptToEvaluateOnNewDocument",
                            params: { source: expression }
                        }));
                    } else if (res.id === 2) {
                        ws.send(JSON.stringify({
                            id: 3,
                            method: "Runtime.evaluate",
                            params: { expression: expression }
                        }));
                    } else if (res.id === 3) {
                        log(`Injection successful for target ${target.id}!`);
                        clearTimeout(timeoutId);
                        // We DO NOT close the WebSocket, so Page.addScriptToEvaluateOnNewDocument survives redirects!
                        resolve();
                    }
                };

                ws.onerror = (err) => {
                    clearTimeout(timeoutId);
                    resolve();
                };
            });
        };

        log(`Polling for targets for 15 seconds...`);
        while (Date.now() < maxTime) {
            try {
                const response = await fetch(`http://127.0.0.1:${port}/json/list`);
                const targets = await response.json();
                
                for (const t of targets) {
                    if (t.type === 'page' && !t.url.includes('devtools://') && !t.url.startsWith('data:')) {
                        if (!injectedTargets.has(t.id)) {
                            injectedTargets.add(t.id);
                            log(`Discovered new target: ${t.id} - ${t.url}`);
                            // Fire and forget injection
                            injectIntoTarget(t);
                        }
                    }
                }
            } catch (e) {}
            
            await new Promise(r => setTimeout(r, 1000));
        }

        if (injectedTargets.size === 0) {
            log(`Error: No suitable page target found for CDP injection after 15 seconds.`);
            return { success: false, error: "No suitable page target found for CDP injection." };
        }

        log(`Finished polling. Injected into ${injectedTargets.size} targets.`);
        return { success: true, message: `Injected into ${injectedTargets.size} targets.` };

    } catch (e) {
        log(`Exception caught: ${e.message}`);
        return { success: false, error: e.message };
    }
};
