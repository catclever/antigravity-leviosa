// background.js
export function initBackground() {
  console.log("[Antigravity Mod] 背景图与基础 CSS 模块初始化");
  "use strict";

    // ============================================
    // 1. 配置区域
    // ============================================
    const bgImage = ""; // <-- Replace with your own base64 image or URL

    const THEME_VAR = "--my-custom-theme-color";
    const DEFAULT_COLOR = "#1e1e1e";

    const sidebarSelector = `
            sidebar, aside,
            [id*="sidebar" i]:not([class*="item"]):not([class*="icon"]),
            [class*="sidebar" i]:not([class*="item"]):not([class*="icon"])
        `;

    const tintColor = `color-mix(in srgb, var(${THEME_VAR}, ${DEFAULT_COLOR}) 75%, transparent)`;

    // ============================================
    // 2. 核心 CSS
    // ============================================
    const css = `
            :root {
                ${THEME_VAR}: ${DEFAULT_COLOR};
            }

            /* === 1. 基础环境 === */
            html, body, #root {
                background-image: url('${bgImage}') !important;
                background-size: cover !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
                background-attachment: fixed !important;
                background-color: transparent !important;
            }

            /* === 2. 左侧边栏 (原汁原味的 3.1) === */
            ${sidebarSelector},
            .bg-background${sidebarSelector},
            .bg-muted${sidebarSelector} {
                background-image:
                    linear-gradient(${tintColor}, ${tintColor}),
                    linear-gradient(135deg, transparent 0%, rgba(0, 0, 0, 0.05) 40%),
                    url('${bgImage}') !important;
                background-size: cover !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
                background-attachment: fixed !important;

                background-color: transparent !important;
                backdrop-filter: blur(2px) !important;
                border-right: 1px solid rgba(255, 255, 255, 0.1) !important;
                box-shadow: inset 1px 0 0 0 rgba(255, 255, 255, 0.05) !important;
            }

            /* === 3. 基础毛玻璃层 (完美继承 V4.2 右侧的神仙质感) === */
            .bg-background, .bg-muted,
            [data-testid="conversation-view"] {
                background-color: color-mix(in srgb, var(${THEME_VAR}, ${DEFAULT_COLOR}) 65%, transparent) !important;
                backdrop-filter: blur(12px) !important;
                background-image: none !important;
            }

            /* === 4. Anti-Stacking 反套娃机制 (彻底粉碎中间的叠加死黑) 💥 === */
            /* 这是核心魔法：凡是嵌套在背景容器里的次级背景容器，全部强行扒光！
               这意味着无论中间聊天区里套娃了多少层 div，磨砂滤镜永远只会应用在最外层那一次！ */
            .bg-background .bg-background,
            .bg-muted .bg-background,
            [data-testid="conversation-view"] .bg-background,
            .bg-background .bg-muted,
            .bg-muted .bg-muted,
            [data-testid="conversation-view"] .bg-muted,
            .bg-background [data-testid="conversation-view"],
            .bg-muted [data-testid="conversation-view"] {
                background-color: transparent !important;
                backdrop-filter: none !important;
                box-shadow: none !important;
            }

            div[aria-label="User message"]::after,
            .after\\:from-background::after {
                display: none !important;
            }

            /* === 5. 消息气泡 & 交互小卡片浮雕化 === */
            /* 作为悬浮卡片，允许独立存在一层轻微毛玻璃 */
            .bg-card, .bg-secondary, .bg-card-border {
                background-color: color-mix(in srgb, var(${THEME_VAR}, ${DEFAULT_COLOR}) 45%, transparent) !important;
                backdrop-filter: blur(8px) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            }

            button:hover, [role="button"]:hover {
                background-color: color-mix(in srgb, var(${THEME_VAR}, ${DEFAULT_COLOR}) 50%, transparent) !important;
            }

            textarea, input {
                background-color: color-mix(in srgb, var(${THEME_VAR}, ${DEFAULT_COLOR}) 30%, transparent) !important;
                backdrop-filter: blur(12px) !important;
                color: #fff !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
            }
        `;

    // ============================================
    // 3. 注入 CSS
    // ============================================
    const styleId = "user-custom-theme-combined";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.type = "text/css";
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      console.log("🎨 [Antigravity V4.4 反套娃版] 样式已注入！");
    }

    // ============================================
    // 4. 提取 Tailwind 主题色
    // ============================================
    function extractAndSetThemeColor() {
      const style = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const candidates = ["--background", "--card", "--md-sys-color-surface"];

      for (let cssVar of candidates) {
        let color =
          style.getPropertyValue(cssVar).trim() ||
          bodyStyle.getPropertyValue(cssVar).trim();
        if (
          color &&
          !color.includes("transparent") &&
          !color.includes("0, 0, 0, 0")
        ) {
          if (
            /^[\d\s\.%]+$/.test(color) ||
            /^[\d]+,[\d]+%,[\d]+%/.test(color.replace(/\s/g, ""))
          ) {
            color = `hsl(${color.replace(/,/g, " ")})`;
          }
          document.documentElement.style.setProperty(THEME_VAR, color);
          return true;
        }
      }
      return false;
    }

    let attempts = 0;
    const interval = setInterval(() => {
      if (extractAndSetThemeColor()) clearInterval(interval);
      else if (++attempts > 50) clearInterval(interval);
    }, 200);
}
