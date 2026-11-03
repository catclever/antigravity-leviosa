/**
 * web/file_editor.js
 * 
 * Antigravity Right Panel Local File Inline Editor (Pro IDE Ultra Edition)
 * - Deeply injected CSS with -webkit-text-fill-color: transparent !important for authentic syntax highlighting
 * - Native line gutter with white-space: pre !important (never wraps numbers)
 * - Full-surface wheel & scroll synchronization (scrolls smoothly anywhere, zero dead zones)
 * - True 1-to-1 code alignment (white-space: pre default + wrap toggle button)
 * - Pure icon top action buttons with rich tooltips
 * - Dedicated bottom status bar (Line/Col, Total Lines, Char count, Encoding, Language, Wrap toggle)
 * - Dynamic viewport tracking with ResizeObserver
 * - Fixed root overlay immune to clipping and z-index traps
 */

import { extractActiveProjectName } from './project_opener.js';
import { openFileInFinderBackend } from './api.js';

const API_BASE = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/antigravity_file_api';

let activeEditorInstance = null;

const FORBIDDEN_EXTENSIONS = new Set([
    '.mp3', '.mp4', '.mov', '.wav', '.flac', '.ogg', '.m4a',
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.svgz',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.exe', '.dylib', '.so', '.dll', '.bin', '.wasm',
    '.woff', '.woff2', '.ttf', '.eot', '.otf'
]);

// 允许原地编辑的合法代码、配置与文本文件白名单
const ALLOWED_CODE_EXTENSIONS = new Set([
    // Code & Scripting
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.pyw', '.rb', '.go', '.rs', '.java', '.kt', '.kts',
    '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.cs', '.php',
    '.swift', '.sh', '.bash', '.zsh', '.fish', '.lua', '.r', '.jl',
    '.pl', '.pm', '.sql', '.dart', '.scala', '.erl', '.ex', '.exs',
    // Web & Markup
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg',
    '.vue', '.svelte', '.astro',
    // Data & Config
    '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.xml',
    '.ini', '.env', '.properties', '.conf', '.config',
    // Docs & Text
    '.md', '.markdown', '.txt', '.log', '.csv', '.tsv', '.diff', '.patch',
    '.gitignore', '.dockerignore', '.editorconfig'
]);

const ALLOWED_SPECIAL_FILENAMES = new Set([
    'dockerfile', 'makefile', 'gemfile', 'procfile', 'rakefile', 'cmakelists.txt'
]);

function getFileExt(filename) {
    if (!filename || typeof filename !== 'string') return '';
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.substring(lastDot).toLowerCase();
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==========================================
// 1. 全局 CSS 规则注入 (确保透明文字与高亮层微米对齐，彻底清除一切蒙层/滤镜)
// ==========================================
function ensureEditorStyles() {
    const styleId = 'ag-file-editor-injected-styles';
    const existing = document.getElementById(styleId);
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* 根容器：视口切片全景背景映射 + 高度磨砂毛玻璃质感 (高不透明度保证代码高对比度与纯净背景) */
        #ag-inline-file-editor {
            background-image:
                linear-gradient(rgba(11, 14, 20, 0.88), rgba(11, 14, 20, 0.92)),
                var(--antigravity-bg, none) !important;
            background-size: cover !important;
            background-position: center !important;
            background-repeat: no-repeat !important;
            background-attachment: fixed !important;
            backdrop-filter: blur(28px) saturate(140%) !important;
            -webkit-backdrop-filter: blur(28px) saturate(140%) !important;
            mask: none !important;
            -webkit-mask: none !important;
        }

        #ag-inline-file-editor #ag-editor-toolbar {
            background: rgba(21, 25, 33, 0.55) !important;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        }

        #ag-inline-file-editor #ag-editor-body {
            background: transparent !important;
        }

        #ag-inline-file-editor #ag-editor-statusbar {
            background: rgba(8, 10, 15, 0.65) !important;
            border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
        }

        #ag-inline-file-editor #ag-editor-code-container {
            position: relative !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            filter: none !important;
            mask: none !important;
            -webkit-mask: none !important;
            background: transparent !important;
            box-shadow: none !important;
        }

        /* 底层透明打字 Textarea：负责光标、输入、选择与键盘导航 (处于底层 Z:1) */
        #ag-inline-file-editor textarea#ag-editor-textarea {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 1 !important;
            color: transparent !important;
            -webkit-text-fill-color: transparent !important;
            caret-color: #38bdf8 !important;
            background: transparent !important;
            background-color: transparent !important;
            box-sizing: border-box !important;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "PingFang SC", "Microsoft YaHei", monospace !important;
            -webkit-font-smoothing: antialiased !important;
            font-size: 13px !important;
            line-height: 21px !important;
            letter-spacing: 0px !important;
            tab-size: 2 !important;
            border: none !important;
            outline: none !important;
            resize: none !important;
            margin: 0 !important;
            padding: 10px 14px 28px 14px !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            filter: none !important;
            box-shadow: none !important;
            -webkit-box-shadow: none !important;
            text-shadow: none !important;
            mask: none !important;
            -webkit-mask: none !important;
            opacity: 1 !important;
        }

        /* 选区高亮色：置于文字底层，形成类似 Monaco Editor 的通透底色 */
        #ag-inline-file-editor textarea#ag-editor-textarea::selection {
            background: rgba(56, 189, 248, 0.35) !important;
            color: transparent !important;
            -webkit-text-fill-color: transparent !important;
        }

        /* 顶层纯净高亮 Pre 容器：直接处于最顶层 Z:2，完全无任何蒙层遮挡，字符清晰锐利！ */
        #ag-inline-file-editor pre#ag-editor-pre {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            min-width: 100% !important;
            min-height: 100% !important;
            z-index: 2 !important;
            pointer-events: none !important;
            user-select: none !important;
            color: #f1f5f9 !important;
            background: transparent !important;
            background-color: transparent !important;
            box-sizing: border-box !important;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "PingFang SC", "Microsoft YaHei", monospace !important;
            -webkit-font-smoothing: antialiased !important;
            font-size: 13px !important;
            line-height: 21px !important;
            letter-spacing: 0px !important;
            tab-size: 2 !important;
            margin: 0 !important;
            padding: 10px 14px 28px 14px !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            filter: none !important;
            box-shadow: none !important;
            -webkit-box-shadow: none !important;
            text-shadow: none !important;
            mask: none !important;
            -webkit-mask: none !important;
            opacity: 1 !important;
        }

        /* 行号条必须严格 pre，杜绝数字折行变成一行多字 */
        #ag-inline-file-editor #ag-editor-gutter {
            background: rgba(8, 10, 15, 0.45) !important;
            border-right: 1px solid rgba(255, 255, 255, 0.06) !important;
            white-space: pre !important;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "PingFang SC", "Microsoft YaHei", monospace !important;
            -webkit-font-smoothing: antialiased !important;
            font-size: 12px !important;
            line-height: 21px !important;
            letter-spacing: 0px !important;
            user-select: none !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 10px 10px 28px 0 !important;
            overflow: hidden !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
        }

        /* 默认不折行模式 (横向滚动，行号完美对齐) */
        #ag-inline-file-editor.nowrap textarea#ag-editor-textarea,
        #ag-inline-file-editor.nowrap pre#ag-editor-pre {
            white-space: pre !important;
            word-break: normal !important;
            overflow-wrap: normal !important;
        }

        /* 可选折行模式 */
        #ag-inline-file-editor.wrap textarea#ag-editor-textarea,
        #ag-inline-file-editor.wrap pre#ag-editor-pre {
            white-space: pre-wrap !important;
            word-break: break-all !important;
            overflow-wrap: anywhere !important;
        }

        /* 滚动条美化 */
        #ag-inline-file-editor textarea#ag-editor-textarea::-webkit-scrollbar {
            width: 10px;
            height: 10px;
        }
        #ag-inline-file-editor textarea#ag-editor-textarea::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.2);
        }
        #ag-inline-file-editor textarea#ag-editor-textarea::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.18);
            border-radius: 5px;
        }
        #ag-inline-file-editor textarea#ag-editor-textarea::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

// ==========================================
// 2. 核心轻量语法高亮引擎 (Single-Pass Tokenizer)
// ==========================================
function highlightCode(code, ext) {
    if (!code) return '';

    // A. JSON 语法高亮
    if (ext === '.json' || ext === '.jsonc' || ext === '.json5') {
        const pattern = /(\"(?:\\.|[^\\\"\n])*\")(\s*:)?|(\b(?:true|false|null)\b)|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, str, colon, bool, num] = match;
            if (colon) {
                result += '<span style="color:#38bdf8;font-weight:600;">' + escapeHtml(str) + '</span>' + escapeHtml(colon);
            } else if (str) {
                result += '<span style="color:#34d399;">' + escapeHtml(str) + '</span>';
            } else if (bool) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(bool) + '</span>';
            } else if (num) {
                result += '<span style="color:#fbbf24;">' + escapeHtml(num) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    // B. JavaScript / TypeScript 语法高亮
    if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs') {
        const pattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|(\`(?:\\.|[^\\\`])*\`|\"(?:\\.|[^\\\"\n])*\"|\'(?:\\.|[^\\\'\n])*\')|(\b(?:const|let|var|function|return|if|else|for|while|import|export|from|class|async|await|new|this|try|catch|finally|throw|typeof|instanceof|switch|case|default|break|continue|void|delete|null|undefined|true|false)\b)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\())/g;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, comment, string, keyword, number, func] = match;
            if (comment) {
                result += '<span style="color:#64748b;font-style:italic;">' + escapeHtml(comment) + '</span>';
            } else if (string) {
                result += '<span style="color:#34d399;">' + escapeHtml(string) + '</span>';
            } else if (keyword) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(keyword) + '</span>';
            } else if (number) {
                result += '<span style="color:#fbbf24;">' + escapeHtml(number) + '</span>';
            } else if (func) {
                result += '<span style="color:#60a5fa;">' + escapeHtml(func) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    // C. Markdown 语法高亮
    if (ext === '.md' || ext === '.markdown') {
        const lines = code.split('\n');
        return lines.map(line => {
            if (/^#{1,6}\s+/.test(line)) {
                return '<span style="color:#38bdf8;font-weight:700;">' + escapeHtml(line) + '</span>';
            }
            if (/^>\s+/.test(line)) {
                return '<span style="color:#94a3b8;font-style:italic;">' + escapeHtml(line) + '</span>';
            }
            if (/^\s*[-*+]\s+/.test(line)) {
                return '<span style="color:#fbbf24;font-weight:600;">' + escapeHtml(line.slice(0, 2)) + '</span>' + escapeHtml(line.slice(2));
            }
            let esc = escapeHtml(line);
            esc = esc.replace(/`([^`]+)`/g, '<span style="color:#fbbf24;background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;">`$1`</span>');
            esc = esc.replace(/\*\*([^*]+)\*\*/g, '<span style="color:#ffffff;font-weight:700;">**$1**</span>');
            esc = esc.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span style="color:#60a5fa;text-decoration:underline;">[$1]</span><span style="color:#64748b;">($2)</span>');
            return esc;
        }).join('\n');
    }

    // D. Python 语法高亮
    if (ext === '.py' || ext === '.pyw') {
        const pattern = /(#.*$)|(\"\"\"[\s\S]*?\"\"\"|\'\'\'[\s\S]*?\'\'\'|\"(?:\\.|[^\\\"\n])*\"|\'(?:\\.|[^\\\'\n])*\')|(\b(?:def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|with|pass|lambda|yield|None|True|False|self|and|or|not|is|raise|break|continue|async|await)\b)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_]*(?=\s*\())/gm;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, comment, string, keyword, number, func] = match;
            if (comment) {
                result += '<span style="color:#64748b;font-style:italic;">' + escapeHtml(comment) + '</span>';
            } else if (string) {
                result += '<span style="color:#34d399;">' + escapeHtml(string) + '</span>';
            } else if (keyword) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(keyword) + '</span>';
            } else if (number) {
                result += '<span style="color:#fbbf24;">' + escapeHtml(number) + '</span>';
            } else if (func) {
                result += '<span style="color:#60a5fa;">' + escapeHtml(func) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    // E. HTML / XML / SVG 语法高亮
    if (ext === '.html' || ext === '.htm' || ext === '.xml' || ext === '.svg') {
        const pattern = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z0-9_-]+)|([a-zA-Z0-9_-]+(?=\=))|(\"[^\"]*\"|\'[^\']*\')/g;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, comment, tag, attr, str] = match;
            if (comment) {
                result += '<span style="color:#64748b;font-style:italic;">' + escapeHtml(comment) + '</span>';
            } else if (tag) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(tag) + '</span>';
            } else if (attr) {
                result += '<span style="color:#38bdf8;">' + escapeHtml(attr) + '</span>';
            } else if (str) {
                result += '<span style="color:#34d399;">' + escapeHtml(str) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    // F. CSS / SCSS / LESS 语法高亮
    if (ext === '.css' || ext === '.scss' || ext === '.less') {
        const pattern = /(\/\*[\s\S]*?\*\/)|(\"(?:\\.|[^\\\"\n])*\"|\'(?:\\.|[^\\\'\n])*\')|([a-zA-Z0-9_.-]+)(?=\s*\{)|([a-zA-Z-]+)(?=\s*:)|(#[a-fA-F0-9]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg)?\b)|(\b(?:!important|none|block|flex|grid|absolute|relative|fixed|auto|inherit|initial)\b)/g;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, comment, str, selector, prop, val, keyword] = match;
            if (comment) {
                result += '<span style="color:#64748b;font-style:italic;">' + escapeHtml(comment) + '</span>';
            } else if (str) {
                result += '<span style="color:#34d399;">' + escapeHtml(str) + '</span>';
            } else if (selector) {
                result += '<span style="color:#38bdf8;font-weight:600;">' + escapeHtml(selector) + '</span>';
            } else if (prop) {
                result += '<span style="color:#60a5fa;">' + escapeHtml(prop) + '</span>';
            } else if (val) {
                result += '<span style="color:#fbbf24;">' + escapeHtml(val) + '</span>';
            } else if (keyword) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(keyword) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    // G. Shell / Bash 语法高亮
    if (ext === '.sh' || ext === '.bash' || ext === '.zsh') {
        const pattern = /(#.*$)|(\`(?:\\.|[^\\\`])*\`|\"(?:\\.|[^\\\"\n])*\"|\'(?:\\.|[^\\\'\n])*\')|(\$[a-zA-Z0-9_]+|\$\{[^}]+\})|(\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|local|echo)\b)|(\b\d+\b)/gm;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, comment, string, variable, keyword, number] = match;
            if (comment) {
                result += '<span style="color:#64748b;font-style:italic;">' + escapeHtml(comment) + '</span>';
            } else if (string) {
                result += '<span style="color:#34d399;">' + escapeHtml(string) + '</span>';
            } else if (variable) {
                result += '<span style="color:#38bdf8;font-weight:600;">' + escapeHtml(variable) + '</span>';
            } else if (keyword) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(keyword) + '</span>';
            } else if (number) {
                result += '<span style="color:#fbbf24;">' + escapeHtml(number) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    // H. YAML 语法高亮
    if (ext === '.yml' || ext === '.yaml') {
        const pattern = /(#.*$)|(\"(?:\\.|[^\\\"\n])*\"|\'(?:\\.|[^\\\'\n])*\')|(^[ \t]*[a-zA-Z0-9_.-]+)(?=\s*:)|(\b(?:true|false|null|yes|no)\b)|(-?\b\d+(?:\.\d+)?\b)/gm;
        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = pattern.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(code.substring(lastIndex, match.index));
            }
            const [full, comment, string, key, bool, num] = match;
            if (comment) {
                result += '<span style="color:#64748b;font-style:italic;">' + escapeHtml(comment) + '</span>';
            } else if (string) {
                result += '<span style="color:#34d399;">' + escapeHtml(string) + '</span>';
            } else if (key) {
                result += '<span style="color:#38bdf8;font-weight:600;">' + escapeHtml(key) + '</span>';
            } else if (bool) {
                result += '<span style="color:#f43f5e;font-weight:600;">' + escapeHtml(bool) + '</span>';
            } else if (num) {
                result += '<span style="color:#fbbf24;">' + escapeHtml(num) + '</span>';
            }
            lastIndex = pattern.lastIndex;
        }
        if (lastIndex < code.length) {
            result += escapeHtml(code.substring(lastIndex));
        }
        return result;
    }

    return escapeHtml(code);
}

// ==========================================
// 3. Toast 提示组件
// ==========================================
function showToast(message, type = 'success', duration = 2400) {
    const existing = document.getElementById('ag-file-editor-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'ag-file-editor-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '36px';
    toast.style.right = '24px';
    toast.style.zIndex = '999999999';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '500';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';
    toast.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.5)';
    toast.style.backdropFilter = 'blur(12px)';
    toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.transform = 'translateY(10px) scale(0.95)';
    toast.style.opacity = '0';

    if (type === 'success') {
        toast.style.backgroundColor = 'rgba(16, 185, 129, 0.95)';
        toast.style.color = '#FFFFFF';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    } else if (type === 'error') {
        toast.style.backgroundColor = 'rgba(239, 68, 68, 0.95)';
        toast.style.color = '#FFFFFF';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.2)';
    } else {
        toast.style.backgroundColor = 'rgba(30, 41, 59, 0.95)';
        toast.style.color = '#F1F5F9';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    }

    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0) scale(1)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.transform = 'translateY(8px) scale(0.95)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// ==========================================
// 4. 后端通信服务
// ==========================================
async function checkFileStat(filePath) {
    try {
        const url = `${API_BASE}?action=stat&path=${encodeURIComponent(filePath)}&nocache=1`;
        const res = await fetch(url);
        return await res.json();
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function readFileFromBackend(filePath) {
    try {
        const url = `${API_BASE}?action=read&path=${encodeURIComponent(filePath)}&nocache=1`;
        const res = await fetch(url);
        return await res.json();
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function stringToSafeBase64(str) {
    try {
        const bytes = new TextEncoder().encode(str);
        let binString = '';
        const len = bytes.byteLength;
        for (let i = 0; i < len; i += 8192) {
            binString += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)));
        }
        return btoa(binString);
    } catch (e) {
        return btoa(unescape(encodeURIComponent(str)));
    }
}

async function writeFileToBackend(filePath, content) {
    try {
        const b64 = stringToSafeBase64(content);

        if (b64.length < 3000) {
            const url = `${API_BASE}?action=write&path=${encodeURIComponent(filePath)}&content_b64=${encodeURIComponent(b64)}&nocache=1`;
            const res = await fetch(url);
            return await res.json();
        }

        const chunkSize = 2400;
        const totalChunks = Math.ceil(b64.length / chunkSize);
        const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

        let finalRes = null;
        for (let i = 0; i < totalChunks; i++) {
            const chunk = b64.substring(i * chunkSize, (i + 1) * chunkSize);
            const url = `${API_BASE}?action=write_chunk&upload_id=${uploadId}&index=${i}&total=${totalChunks}&path=${encodeURIComponent(filePath)}&chunk_b64=${encodeURIComponent(chunk)}&nocache=1`;
            const res = await fetch(url);
            finalRes = await res.json();
            if (!finalRes.success) {
                return finalRes;
            }
        }
        return finalRes || { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ==========================================
// 5. 页面已渲染文本提取 (强力保底)
// ==========================================
function extractVisibleTextFromDOM(container) {
    if (!container) return '';

    try {
        if (window.monaco && window.monaco.editor) {
            const models = window.monaco.editor.getModels();
            if (models && models.length > 0) {
                for (const m of models) {
                    const val = m.getValue();
                    if (val && val.trim().length > 0) {
                        return val;
                    }
                }
            }
        }
    } catch (e) {}

    const preEls = container.querySelectorAll('pre code, pre, code');
    for (const el of preEls) {
        const txt = el.textContent || '';
        if (txt.trim().length > 0) {
            return txt;
        }
    }

    const mdBody = container.querySelector('.markdown-body, [class*="markdown"]');
    if (mdBody && mdBody.innerText && mdBody.innerText.trim().length > 0) {
        return mdBody.innerText;
    }

    return (container.innerText || container.textContent || '').trim();
}

// ==========================================
// 6. 路径特征校验与提取
// ==========================================
function isCandidateFilePath(val) {
    if (!val || typeof val !== 'string') return false;
    val = val.trim();
    if (val.length < 3 || val.length > 500) return false;
    if (val.includes('<') || val.includes('>') || val.includes('\n') || val.includes('\r')) return false;

    // 排除明显的句子标点符号
    if (/[,，?？!！;；]/.test(val)) return false;

    // 如果带有空格：必须具备明确的路径特征 (包含 / 或以 ~/ 开头)，否则视为普通文本
    if (val.includes(' ')) {
        const isPathLike = val.startsWith('/') || val.startsWith('~/') || val.startsWith('./') || val.startsWith('../') || val.includes('/');
        if (!isPathLike) {
            return false;
        }
    }

    // 严厉排除形如 exa.language_server_pb.Plugin 的 Java/Protobuf 消息类名/包名（无斜杠且有多个点）
    if (!val.includes('/') && (val.match(/\./g) || []).length > 1) {
        return false;
    }

    const lastSlash = val.lastIndexOf('/');
    const basename = (lastSlash === -1 ? val : val.substring(lastSlash + 1)).toLowerCase();
    const ext = getFileExt(basename);

    if (ALLOWED_SPECIAL_FILENAMES.has(basename)) {
        return true;
    }

    if (!ext || !ALLOWED_CODE_EXTENSIONS.has(ext)) {
        return false;
    }

    if (FORBIDDEN_EXTENSIONS.has(ext)) {
        return false;
    }

    // 绝对路径特征 (涵盖 ~, /Users, /Library, /Applications, /private, /tmp, /Volumes 等)
    if (val.startsWith('/') || val.startsWith('~/')) {
        return true;
    }

    // 相对路径特征 (含有 / 且分段合法)
    if (val.includes('/') && !val.startsWith('http://') && !val.startsWith('https://')) {
        const segments = val.split('/');
        if (segments.length >= 2 && segments[segments.length - 1].includes('.')) {
            return true;
        }
    }

    // 单个合法文件名 (具有合法白名单扩展名，且不含空格)
    if (!val.includes(' ') && /^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9_-]+$/.test(val)) {
        return true;
    }

    return false;
}

// 提取路径中的行号（支持 :123:45, :123 或 #L123-L145, #L123）
export function extractLineNumber(text) {
    if (!text || typeof text !== 'string') return null;
    const hashMatch = text.match(/#L(\d+)/i);
    if (hashMatch) return parseInt(hashMatch[1], 10);
    const colonMatch = text.match(/:(\d+)(?::\d+)?$/);
    if (colonMatch) return parseInt(colonMatch[1], 10);
    return null;
}

// 清洗选中文本中的修饰字符、包裹符号、Markdown 格式及行号
export function cleanSelectedFilePath(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let text = raw.trim();

    // 0. 去除不可见零宽字符与多余首尾空白
    text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

    // 1. 去除首尾常见的包裹符号：引号、反引号、括号、书名号、中括号等
    text = text.replace(/^[`"'\(\[\{《「“‘]+|[`"'\)\]\}》」”’]+$/g, '').trim();

    // 2. 如果包含 markdown 链接形如 [xxx](url)，提取 url
    const mdMatch = text.match(/\[.*?\]\((.+?)\)/);
    if (mdMatch) {
        text = mdMatch[1].trim();
    }

    // 3. 去除 file:// 协议头与 URL 编码
    if (text.startsWith('file://')) {
        text = text.replace(/^file:\/\//, '');
    }
    if (text.includes('%20') || text.includes('%')) {
        try { text = decodeURIComponent(text); } catch (e) {}
    }

    // 4. 去除末尾的行号锚点，如 #L123-L145, #L123, :123:45, :123
    text = text.replace(/#L\d+(-L\d+)?$/i, '');
    text = text.replace(/:\d+(:\d+)?$/, '');

    // 5. 去除首尾可能附带的标点符号（如冒号、逗号、分号）
    text = text.replace(/^[:：\s]+|[,，:：;；\s]+$/g, '').trim();

    // 6. 再次去除两端可能残留的包裹引号或反引号
    text = text.replace(/^[`"'\s]+|[`"'\s]+$/g, '').trim();

    return text;
}

// 多层级解析磁盘真实绝对路径 (支持绝对路径、用户家目录~、当前激活项目及公共工程路径)
export async function resolveFilePathOnDisk(rawPath) {
    if (!rawPath) return null;
    let pathToCheck = rawPath.trim();

    if (pathToCheck.startsWith('file://')) {
        pathToCheck = pathToCheck.replace(/^file:\/\//, '');
    }

    // 1. 如果以 ~ 开头，后端 resolveHome 会自动展开，同时在前端提供双重保障
    if (pathToCheck.startsWith('~/')) {
        const stat = await checkFileStat(pathToCheck);
        if (stat && stat.success && stat.isFile) {
            return stat.path;
        }
        const expandedHome = `/Users/kael/${pathToCheck.slice(2)}`;
        const expStat = await checkFileStat(expandedHome);
        if (expStat && expStat.success && expStat.isFile) {
            return expStat.path || expandedHome;
        }
    }

    // 2. 如果本身就是绝对路径
    if (pathToCheck.startsWith('/')) {
        const stat = await checkFileStat(pathToCheck);
        if (stat && stat.success && stat.isFile) {
            return stat.path;
        }
    }

    // 3. 如果是相对路径，优先在当前激活项目目录下寻找
    const activeProject = extractActiveProjectName();
    const candidates = [];
    if (activeProject) {
        candidates.push(`/Users/kael/Projects/${activeProject}/${pathToCheck}`);
        candidates.push(`/Users/kael/Library/Services/taichi/apps/${activeProject}/${pathToCheck}`);
    }

    // 3.5 增加当前会话 Brain Artifact 目录候选探测 (如会话产物 README.md)
    try {
        const uuidMatch = window.location.pathname.match(/\/c\/([a-f0-9\-]+)/i);
        if (uuidMatch && uuidMatch[1]) {
            candidates.push(`/Users/kael/.gemini/antigravity/brain/${uuidMatch[1]}/${pathToCheck}`);
        }
    } catch (e) {}

    candidates.push(`/Users/kael/Projects/antigravity-leviosa/${pathToCheck}`);
    candidates.push(`/Users/kael/Projects/${pathToCheck}`);
    candidates.push(`/Users/kael/${pathToCheck}`);

    for (const cand of candidates) {
        const stat = await checkFileStat(cand);
        if (stat && stat.success && stat.isFile) {
            return stat.path;
        }
    }

    // 4. 后端直接 fallback 校验
    const fallbackStat = await checkFileStat(pathToCheck);
    if (fallbackStat && fallbackStat.success && fallbackStat.isFile) {
        return fallbackStat.path;
    }

    return null;
}

const PATH_PROP_KEYS = new Set([
    'filepath', 'filepaths', 'path', 'uri', 'filename', 'fileuri',
    'sourcepath', 'targetpath', 'abspath', 'localpath',
    'artifact', 'file', 'item', 'doc', 'tab', 'fileinfo'
]);

function findAbsolutePathInFiber(el) {
    let current = el;
    let depth = 0;
    while (current && depth < 8) {
        const fiberKey = Object.keys(current).find(k => k.startsWith('__reactFiber$'));
        if (fiberKey) {
            let fiber = current[fiberKey];
            let attempts = 0;
            while (fiber && attempts < 15) {
                if (fiber.memoizedProps) {
                    let foundPath = null;
                    function safeFind(obj, maxDepth = 4, currentDepth = 0, visited = new Set()) {
                        if (!obj || typeof obj !== 'object' || currentDepth > maxDepth || visited.has(obj) || foundPath) return;
                        visited.add(obj);

                        const keys = Object.keys(obj);
                        if (keys.length > 50) return;

                        for (const key of keys) {
                            if (key.startsWith('__') || key === 'children' || key === 'parent' || key === 'owner' || key === 'store') continue;
                            const lowerKey = key.toLowerCase();
                            if (!PATH_PROP_KEYS.has(lowerKey)) continue;

                            const val = obj[key];
                            if (typeof val === 'string' && isCandidateFilePath(val)) {
                                if (val.startsWith('/') || val.startsWith('~/') || val.startsWith('file://')) {
                                    foundPath = val;
                                    return;
                                }
                                if (!foundPath) foundPath = val;
                            } else if (val && typeof val === 'object') {
                                safeFind(val, maxDepth, currentDepth + 1, visited);
                            }
                        }
                    }
                    safeFind(fiber.memoizedProps);
                    if (foundPath) return foundPath;
                }
                fiber = fiber.return;
                attempts++;
            }
        }
        current = current.parentElement;
        depth++;
    }
    return null;
}

function extractPathFromElementOrChildren(el) {
    if (!el) return null;

    // 0. 优先检测当前页面 URL 的激活 tab 路由 (如 tab=artifact__file%3A%2F%2F... 或 tab=file%3A%2F%2F...)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get('tab');
        if (tabParam) {
            let decoded = decodeURIComponent(tabParam);
            if (decoded.startsWith('artifact__file://')) {
                const pathFromUrl = decoded.replace('artifact__file://', '');
                if (isCandidateFilePath(pathFromUrl)) return pathFromUrl;
            } else if (decoded.startsWith('file://')) {
                const pathFromUrl = decoded.replace('file://', '');
                if (isCandidateFilePath(pathFromUrl)) return pathFromUrl;
            }
        }
    } catch (e) {}

    // 1. 优先通过 React Fiber 深度提取组件内绑定的物理绝对路径（避免被 DOM 缩略短名截断）
    const fiberPath = findAbsolutePathInFiber(el);
    if (fiberPath && isCandidateFilePath(fiberPath)) {
        return fiberPath;
    }

    // 2. 检查显式属性 [data-path], [data-filepath], [data-uri]
    const dataEls = [el, ...Array.from(el.querySelectorAll('[data-path], [data-filepath], [data-file-path], [data-uri]'))];
    for (const dEl of dataEls) {
        const p = dEl.getAttribute('data-path') || dEl.getAttribute('data-filepath') || dEl.getAttribute('data-file-path') || dEl.getAttribute('data-uri');
        if (isCandidateFilePath(p)) {
            return p;
        }
    }

    // 3. 检查 [title] 属性
    const titleEls = [el, ...Array.from(el.querySelectorAll('[title]'))];
    for (const tEl of titleEls) {
        const title = (tEl.getAttribute('title') || '').trim();
        if (isCandidateFilePath(title)) {
            return title;
        }
    }

    // 4. 检查 DOM 节点文本：优先提取包含路径层级的绝对或相对路径，纯文件名暂作兜底
    let fallbackShortName = null;
    const allNodes = [el, ...Array.from(el.querySelectorAll('span, div, p, a, code, h1, h2, h3, h4'))];
    for (const node of allNodes) {
        if (node.children.length > 2) continue;
        const text = (node.textContent || '').trim();

        const match = text.match(/(?:\/Users\/|\/home\/|\/private\/|\/tmp\/|\/Volumes\/|~\/)[^\s"':<>]+\.[a-zA-Z0-9_-]+/);
        if (match && isCandidateFilePath(match[0])) {
            return match[0];
        }

        const relMatch = text.match(/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9_-]+/);
        if (relMatch && isCandidateFilePath(relMatch[0])) {
            return relMatch[0];
        }

        if (isCandidateFilePath(text)) {
            if (!fallbackShortName) {
                fallbackShortName = text;
            }
        }
    }

    return fallbackShortName;
}

// ==========================================
// 6.5 寻获右侧工作区根容器（覆盖代码查看器与文件树侧边栏）
// ==========================================
function findWorkspaceRootContainer(hintElement = null) {
    const activeViewer = hintElement?.closest?.('.file-viewer-root') || document.querySelector('.file-viewer-root');
    const treeSidebar = document.querySelector('[data-testid="tab-file-tree-sidebar"]');

    if (activeViewer && treeSidebar) {
        // 两者都存在：寻找同时包含代码查看器和文件树侧边栏的最外层公共容器
        let probe = activeViewer.parentElement;
        let commonContainer = null;
        while (probe && probe !== document.body && probe !== document.documentElement) {
            if (probe.contains(treeSidebar)) {
                commonContainer = probe;
                break;
            }
            probe = probe.parentElement;
        }

        if (commonContainer) {
            // 继续尝试向上找到该右侧工作区的顶级容器（避免截断外层 padding/border），但绝不越界侵入左侧栏
            let outer = commonContainer;
            while (outer.parentElement && 
                   outer.parentElement !== document.body && 
                   outer.parentElement !== document.documentElement) {
                const parentRect = outer.parentElement.getBoundingClientRect();
                // 确保父容器仍在右半侧，不越界侵入左侧对话栏 (left >= 200)，且宽度不发生全屏式跳跃
                if (parentRect.left >= 200 && parentRect.width >= outer.getBoundingClientRect().width) {
                    outer = outer.parentElement;
                } else {
                    break;
                }
            }
            return outer;
        }
    }

    // 仅存在代码查看器或仅存在文件树
    const baseEl = activeViewer || treeSidebar;
    if (baseEl) {
        let probe = baseEl;
        let bestPanel = baseEl;
        while (probe && probe !== document.body && probe !== document.documentElement) {
            // 如果向上回溯到了左侧边栏或对话流容器，立即中止
            if (probe.matches && probe.matches('aside, nav, .bg-sidebar, #leviosa-history-view, #leviosa-kanban-panel, [role="dialog"], [data-testid="conversation-view"], [data-testid="conversation-list"]')) {
                break;
            }
            const rect = probe.getBoundingClientRect();
            if (rect.left >= 200 && rect.height >= 200) {
                bestPanel = probe;
            }
            // 命中工作区分栏标准容器特征
            if (probe.matches && (probe.matches('[style*="container-type"]') || probe.matches('.relative.flex.w-full.h-full') || probe.matches('.w-full.h-full.flex.flex-col'))) {
                bestPanel = probe;
                break;
            }
            probe = probe.parentElement;
        }
        return bestPanel;
    }

    return null;
}

function detectPanelAndFilePath(targetElement) {
    if (!targetElement) return null;

    // 核心区域防护锁：绝不在左侧栏、历史记录、对话聊天流、设置对话框或看板中触发！
    if (targetElement.closest('aside, nav, .bg-sidebar, #leviosa-history-view, #leviosa-kanban-panel, [role="dialog"], [data-testid="conversation-view"], [data-testid="conversation-list"]')) {
        return null;
    }

    // 1. 优先检测新版本全功能工作区代码查看器 (Antigravity Workspace Code Viewer)
    const fileViewerRoot = targetElement.closest('.file-viewer-root');
    if (fileViewerRoot) {
        const codeLine = targetElement.closest('.code-line') || fileViewerRoot.querySelector('.code-line[data-file-uri]');
        let rawUri = codeLine?.getAttribute('data-file-uri');
        let targetLine = null;
        if (codeLine) {
            const lineStr = codeLine.getAttribute('data-line-number');
            if (lineStr) targetLine = parseInt(lineStr, 10);
        }

        if (!rawUri) {
            const anyLine = fileViewerRoot.querySelector('[data-file-uri]');
            rawUri = anyLine?.getAttribute('data-file-uri');
        }

        if (rawUri) {
            let cleanPath = decodeURIComponent(rawUri.replace(/^file:\/\//, '').trim());

            // 寻找同时容纳代码查看器与右侧文件树的顶级父容器（覆盖整块工作区与文件树）
            const workspaceContainer = findWorkspaceRootContainer(fileViewerRoot) || fileViewerRoot;

            return {
                panel: workspaceContainer,
                contentContainer: fileViewerRoot,
                filePath: cleanPath,
                header: null,
                rawBtn: null,
                previewBtn: null,
                targetLine: targetLine,
                isWorkspaceViewer: true
            };
        }
    }

    // 2. 如果点击或悬停在工作区右侧文件树上：
    if (targetElement.closest('[data-testid="tab-file-tree-sidebar"]')) {
        // 文件树侧边栏本身不触发常规探测，避免在文件树容器上误触发提示
        return null;
    }

    // 3. 经典右侧文件预览面板探测
    let curr = targetElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
        // 如果向上回溯到了侧边栏或对话流容器，立即中止
        if (curr.matches('aside, nav, .bg-sidebar, #leviosa-history-view, #leviosa-kanban-panel, [role="dialog"], [data-testid="conversation-view"], [data-testid="conversation-list"]')) {
            return null;
        }

        const rect = curr.getBoundingClientRect();
        
        // 文件预览面板必须在屏幕右侧区域（横坐标绝不会在左侧栏 x < 200 内）
        if (rect.width >= 200 && rect.height >= 200 && rect.left >= 200) {
            const headerCandidate = curr.firstElementChild;
            if (headerCandidate && !headerCandidate.contains(targetElement)) {
                const rawPath = extractPathFromElementOrChildren(headerCandidate);
                if (rawPath) {
                    const buttons = Array.from(curr.querySelectorAll('button, [role="tab"], div[role="button"]'));
                    const rawBtn = buttons.find(b => b.textContent.trim().toLowerCase() === 'raw');
                    const previewBtn = buttons.find(b => b.textContent.trim().toLowerCase() === 'preview');

                    return {
                        panel: curr,
                        contentContainer: curr.children[1] || curr,
                        filePath: rawPath.replace(/^file:\/\//, '').trim(),
                        header: headerCandidate,
                        rawBtn,
                        previewBtn
                    };
                }
            }

            const headerEl = curr.querySelector('header, .border-b, div[class*="header"]');
            if (headerEl && !headerEl.contains(targetElement)) {
                const rawPath = extractPathFromElementOrChildren(headerEl);
                if (rawPath) {
                    const buttons = Array.from(curr.querySelectorAll('button, [role="tab"], div[role="button"]'));
                    const rawBtn = buttons.find(b => b.textContent.trim().toLowerCase() === 'raw');
                    const previewBtn = buttons.find(b => b.textContent.trim().toLowerCase() === 'preview');

                    return {
                        panel: curr,
                        contentContainer: curr.children[curr.children.length - 1] || curr,
                        filePath: rawPath.replace(/^file:\/\//, '').trim(),
                        header: headerEl,
                        rawBtn,
                        previewBtn
                    };
                }
            }
        }

        curr = curr.parentElement;
    }

    return null;
}

// ==========================================
// 7. 全新极简 Pro 编辑器实现
// ==========================================
function mountInlineEditor(panelInfo, initialContent, targetLine = null) {
    if (activeEditorInstance) {
        activeEditorInstance.destroy();
    }

    ensureEditorStyles();

    const { panel, contentContainer, header, filePath, rawBtn, previewBtn } = panelInfo;
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
    const ext = getFileExt(fileName);
    const isJson = ext === '.json' || ext === '.jsonc' || ext === '.json5';
    const isMd = ext === '.md' || ext === '.markdown';

    let textToSet = (typeof initialContent === 'string' && initialContent.length > 0) ? initialContent : '';
    if (!textToSet && contentContainer) {
        textToSet = extractVisibleTextFromDOM(contentContainer);
    }
    if (!textToSet && panel) {
        textToSet = extractVisibleTextFromDOM(panel);
    }

    const langMap = {
        '.js': 'JavaScript', '.jsx': 'React JSX',
        '.ts': 'TypeScript', '.tsx': 'React TSX',
        '.json': 'JSON', '.md': 'Markdown',
        '.py': 'Python', '.html': 'HTML',
        '.css': 'CSS', '.scss': 'SCSS',
        '.sh': 'Shell Script', '.yml': 'YAML', '.yaml': 'YAML',
        '.toml': 'TOML', '.sql': 'SQL', '.rs': 'Rust', '.go': 'Go'
    };
    const langLabel = langMap[ext] || (ext ? ext.slice(1).toUpperCase() : 'Plain Text');

    // 默认保持不折行模式 (nowrap: 横向滚动，行号严格 1 对 1 对齐)
    let isWordWrap = false;

    // 直接挂载到 document.body
    const wrapper = document.createElement('div');
    wrapper.id = 'ag-inline-file-editor';
    wrapper.className = 'nowrap';
    wrapper.style.position = 'fixed';
    wrapper.style.zIndex = '9999999';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.backgroundColor = 'transparent';
    wrapper.style.color = '#F1F5F9';
    wrapper.style.boxSizing = 'border-box';
    wrapper.style.boxShadow = '0 12px 48px rgba(0, 0, 0, 0.7)';
    wrapper.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    wrapper.style.overflow = 'hidden';

    function syncBounds() {
        // 计算理想的抽屉/工作区宽度（至少 560px，或占屏幕 48%~50%，最大 1100px）
        const idealDrawerWidth = Math.min(1100, Math.max(560, Math.round(window.innerWidth * 0.48)));

        if (panel) {
            const panelRect = panel.getBoundingClientRect();
            const headerRect = header ? header.getBoundingClientRect() : null;

            let top = headerRect ? headerRect.bottom : panelRect.top;
            let left = panelRect.left;
            let width = panelRect.width;
            let height = Math.max(150, panelRect.bottom - top);

            // 保底宽度自适应升级（方案 A 核心）：
            // 如果底层宿主面板宽度过窄（例如处于折叠/未展开状态，宽度 < 560px）：
            // 绝不挤在窄条里，自动提升为至少 idealDrawerWidth 宽，且贴齐屏幕右边缘！
            if (width < 560) {
                width = Math.min(window.innerWidth - 200, idealDrawerWidth);
                left = Math.round(window.innerWidth - width);
                top = Math.max(38, Math.min(top, 38));
                height = Math.max(200, window.innerHeight - top);
                wrapper.style.borderRadius = '12px 0 0 12px';
                wrapper.style.boxShadow = '-16px 0 48px rgba(0, 0, 0, 0.75)';
            } else {
                // 宿主面板宽大时：若右侧距离屏幕边缘小于 40px，吸附贴齐至屏幕最右端（消除微小缝隙并完整遮盖右侧文件树）
                if (window.innerWidth - (left + width) < 40) {
                    width = Math.round(window.innerWidth - left);
                }
                wrapper.style.borderRadius = panelInfo.isWorkspaceViewer ? '6px 0 0 6px' : '0';
                wrapper.style.boxShadow = panelInfo.isWorkspaceViewer ? '-12px 0 40px rgba(0, 0, 0, 0.65)' : '0 12px 48px rgba(0, 0, 0, 0.7)';
            }

            wrapper.style.top = `${Math.round(top)}px`;
            wrapper.style.left = `${Math.round(left)}px`;
            wrapper.style.width = `${Math.round(width)}px`;
            wrapper.style.height = `${Math.round(height)}px`;
            wrapper.style.borderLeft = '1px solid rgba(255, 255, 255, 0.16)';
        } else {
            // 独立抽屉模式 (Drawer Mode)：右侧滑出 Pro 编辑器
            const top = 38;
            const width = idealDrawerWidth;
            const left = Math.round(window.innerWidth - width);
            const height = Math.max(200, window.innerHeight - top);

            wrapper.style.top = `${top}px`;
            wrapper.style.left = `${left}px`;
            wrapper.style.width = `${width}px`;
            wrapper.style.height = `${height}px`;
            wrapper.style.borderRadius = '12px 0 0 12px';
            wrapper.style.borderLeft = '1px solid rgba(255, 255, 255, 0.16)';
            wrapper.style.boxShadow = '-16px 0 48px rgba(0, 0, 0, 0.75)';
        }
    }

    syncBounds();

    // ==========================================
    // 7.1 极简轻量顶栏 (绝不拥挤，按钮纯图标化)
    // ==========================================
    const toolbar = document.createElement('div');
    toolbar.id = 'ag-editor-toolbar';
    toolbar.style.height = '36px';
    toolbar.style.flexShrink = '0';
    toolbar.style.display = 'flex';
    toolbar.style.alignItems = 'center';
    toolbar.style.justifyContent = 'space-between';
    toolbar.style.padding = '0 10px';
    toolbar.style.userSelect = 'none';

    // 左侧：文件图标与文件名
    const leftGroup = document.createElement('div');
    leftGroup.style.display = 'flex';
    leftGroup.style.alignItems = 'center';
    leftGroup.style.gap = '8px';
    leftGroup.style.minWidth = '0';
    leftGroup.style.flex = '1';

    const fileIcon = document.createElement('span');
    fileIcon.textContent = isJson ? '🏷️' : isMd ? '📝' : '📄';
    fileIcon.style.fontSize = '13px';
    fileIcon.style.flexShrink = '0';

    const fileTitle = document.createElement('span');
    fileTitle.textContent = fileName;
    fileTitle.style.fontWeight = '600';
    fileTitle.style.fontSize = '12.5px';
    fileTitle.style.color = '#F8FAFC';
    fileTitle.style.overflow = 'hidden';
    fileTitle.style.textOverflow = 'ellipsis';
    fileTitle.style.whiteSpace = 'nowrap';
    fileTitle.title = filePath;

    leftGroup.appendChild(fileIcon);
    leftGroup.appendChild(fileTitle);

    // 右侧：纯图标操作组
    const rightGroup = document.createElement('div');
    rightGroup.style.display = 'flex';
    rightGroup.style.alignItems = 'center';
    rightGroup.style.gap = '6px';
    rightGroup.style.flexShrink = '0';

    // JSON 错误警示
    let jsonErrorPill = null;
    let formatBtn = null;

    if (isJson) {
        jsonErrorPill = document.createElement('span');
        jsonErrorPill.style.display = 'none';
        jsonErrorPill.style.fontSize = '11px';
        jsonErrorPill.style.padding = '2px 6px';
        jsonErrorPill.style.borderRadius = '3px';
        jsonErrorPill.style.backgroundColor = 'rgba(239, 68, 68, 0.18)';
        jsonErrorPill.style.color = '#F87171';
        jsonErrorPill.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        rightGroup.appendChild(jsonErrorPill);

        // 格式化纯图标按钮 (✨)
        formatBtn = document.createElement('button');
        formatBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4"/>
                <path d="M19 17v4"/>
                <path d="M3 5h4"/>
                <path d="M17 19h4"/>
            </svg>
        `;
        formatBtn.title = '格式化 JSON 排版';
        formatBtn.style.width = '28px';
        formatBtn.style.height = '28px';
        formatBtn.style.borderRadius = '5px';
        formatBtn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        formatBtn.style.backgroundColor = 'transparent';
        formatBtn.style.color = '#94A3B8';
        formatBtn.style.display = 'flex';
        formatBtn.style.alignItems = 'center';
        formatBtn.style.justifyContent = 'center';
        formatBtn.style.cursor = 'pointer';
        formatBtn.style.transition = 'all 0.15s ease';

        formatBtn.addEventListener('mouseenter', () => {
            formatBtn.style.color = '#38BDF8';
            formatBtn.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
            formatBtn.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        });
        formatBtn.addEventListener('mouseleave', () => {
            formatBtn.style.color = '#94A3B8';
            formatBtn.style.backgroundColor = 'transparent';
            formatBtn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        });

        rightGroup.appendChild(formatBtn);
    }

    // 保存纯图标按钮 (💾)
    const saveBtn = document.createElement('button');
    saveBtn.id = 'ag-btn-save-exit';
    saveBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
        </svg>
    `;
    saveBtn.title = '保存并退出 (⌘S)';
    saveBtn.style.width = '28px';
    saveBtn.style.height = '28px';
    saveBtn.style.borderRadius = '5px';
    saveBtn.style.border = 'none';
    saveBtn.style.backgroundColor = '#2563EB';
    saveBtn.style.color = '#FFFFFF';
    saveBtn.style.display = 'flex';
    saveBtn.style.alignItems = 'center';
    saveBtn.style.justifyContent = 'center';
    saveBtn.style.cursor = 'pointer';
    saveBtn.style.transition = 'background-color 0.15s ease';

    saveBtn.addEventListener('mouseenter', () => saveBtn.style.backgroundColor = '#1D4ED8');
    saveBtn.addEventListener('mouseleave', () => saveBtn.style.backgroundColor = '#2563EB');

    // 退出纯图标按钮 (✕)
    const exitBtn = document.createElement('button');
    exitBtn.id = 'ag-btn-cancel-exit';
    exitBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
    `;
    exitBtn.title = '退出编辑 (Esc)';
    exitBtn.style.width = '28px';
    exitBtn.style.height = '28px';
    exitBtn.style.borderRadius = '5px';
    exitBtn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    exitBtn.style.backgroundColor = 'transparent';
    exitBtn.style.color = '#94A3B8';
    exitBtn.style.display = 'flex';
    exitBtn.style.alignItems = 'center';
    exitBtn.style.justifyContent = 'center';
    exitBtn.style.cursor = 'pointer';
    exitBtn.style.transition = 'all 0.15s ease';

    exitBtn.addEventListener('mouseenter', () => {
        exitBtn.style.color = '#FFFFFF';
        exitBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    });
    exitBtn.addEventListener('mouseleave', () => {
        exitBtn.style.color = '#94A3B8';
        exitBtn.style.backgroundColor = 'transparent';
    });

    rightGroup.appendChild(saveBtn);
    rightGroup.appendChild(exitBtn);

    toolbar.appendChild(leftGroup);
    toolbar.appendChild(rightGroup);
    wrapper.appendChild(toolbar);

    // ==========================================
    // 7.2 主体编辑区域 (行号 + 双层同轴绝对对齐)
    // ==========================================
    const editorBody = document.createElement('div');
    editorBody.id = 'ag-editor-body';
    editorBody.style.flex = '1 1 0%';
    editorBody.style.minHeight = '0';
    editorBody.style.display = 'flex';
    editorBody.style.position = 'relative';
    editorBody.style.overflow = 'hidden';
    editorBody.style.backgroundColor = 'transparent';

    // 智能弹性宽度的行号条 (确保 white-space: pre !important 绝不换行)
    const lineGutter = document.createElement('div');
    lineGutter.id = 'ag-editor-gutter';
    lineGutter.style.width = '48px';
    lineGutter.style.flexShrink = '0';
    lineGutter.style.textAlign = 'right';
    lineGutter.style.color = '#475569';
    lineGutter.style.backgroundColor = 'transparent';

    // 清除原生双击可能残留的文档选区高亮
    try {
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }
    } catch (e) {}

    // 代码滚动同轴容器
    const codeScrollContainer = document.createElement('div');
    codeScrollContainer.id = 'ag-editor-code-container';
    codeScrollContainer.style.position = 'relative';
    codeScrollContainer.style.flex = '1 1 0%';
    codeScrollContainer.style.minWidth = '0';
    codeScrollContainer.style.height = '100%';
    codeScrollContainer.style.overflow = 'hidden';

    // 底层打字 Textarea (负责键盘输入、光标与选区，置于 Z:1)
    const textarea = document.createElement('textarea');
    textarea.id = 'ag-editor-textarea';
    textarea.value = textToSet;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.autocorrect = 'off';
    textarea.autocapitalize = 'off';
    textarea.style.position = 'absolute';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '100%';
    textarea.style.height = '100%';
    textarea.style.overflow = 'auto';
    textarea.style.setProperty('background', 'transparent', 'important');
    textarea.style.setProperty('background-color', 'transparent', 'important');
    textarea.style.setProperty('backdrop-filter', 'none', 'important');
    textarea.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    textarea.style.setProperty('filter', 'none', 'important');
    textarea.style.setProperty('box-shadow', 'none', 'important');
    textarea.style.setProperty('text-shadow', 'none', 'important');
    textarea.style.setProperty('opacity', '1', 'important');
    textarea.style.setProperty('z-index', '1', 'important');

    // 顶层高亮 Pre (直接展现多彩语法，完全无蒙层遮挡，置于 Z:2，点击穿透给 textarea)
    const preHighlight = document.createElement('pre');
    preHighlight.id = 'ag-editor-pre';
    preHighlight.style.position = 'absolute';
    preHighlight.style.top = '0';
    preHighlight.style.left = '0';
    preHighlight.style.minWidth = '100%';
    preHighlight.style.minHeight = '100%';
    preHighlight.style.setProperty('background', 'transparent', 'important');
    preHighlight.style.setProperty('background-color', 'transparent', 'important');
    preHighlight.style.setProperty('pointer-events', 'none', 'important');
    preHighlight.style.setProperty('user-select', 'none', 'important');
    preHighlight.style.setProperty('backdrop-filter', 'none', 'important');
    preHighlight.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    preHighlight.style.setProperty('filter', 'none', 'important');
    preHighlight.style.setProperty('opacity', '1', 'important');
    preHighlight.style.setProperty('z-index', '2', 'important');

    // 严谨 DOM 挂载顺序：textarea 先挂载(Z:1)，preHighlight 后挂载且在顶层(Z:2)
    codeScrollContainer.appendChild(textarea);
    codeScrollContainer.appendChild(preHighlight);

    editorBody.appendChild(lineGutter);
    editorBody.appendChild(codeScrollContainer);
    wrapper.appendChild(editorBody);

    // ==========================================
    // 7.3 专属独立底栏状态条 (字数统计单独一行)
    // ==========================================
    const statusBar = document.createElement('div');
    statusBar.id = 'ag-editor-statusbar';
    statusBar.style.height = '24px';
    statusBar.style.flexShrink = '0';
    statusBar.style.display = 'flex';
    statusBar.style.alignItems = 'center';
    statusBar.style.justifyContent = 'space-between';
    statusBar.style.padding = '0 12px';
    statusBar.style.backgroundColor = 'transparent';
    statusBar.style.color = '#64748B';
    statusBar.style.fontSize = '11px';
    statusBar.style.userSelect = 'none';

    // 状态栏左侧：语言模式与折行切换开关
    const statusLeft = document.createElement('div');
    statusLeft.style.display = 'flex';
    statusLeft.style.alignItems = 'center';
    statusLeft.style.gap = '8px';

    const langBadge = document.createElement('span');
    langBadge.textContent = langLabel;

    const wrapToggleBtn = document.createElement('button');
    wrapToggleBtn.textContent = '↔ 单行滚动';
    wrapToggleBtn.title = '切换自动折行模式 (默认单行滚动，行号严格对齐)';
    wrapToggleBtn.style.background = 'transparent';
    wrapToggleBtn.style.border = 'none';
    wrapToggleBtn.style.color = '#64748B';
    wrapToggleBtn.style.cursor = 'pointer';
    wrapToggleBtn.style.padding = '1px 4px';
    wrapToggleBtn.style.borderRadius = '3px';
    wrapToggleBtn.style.fontSize = '11px';

    wrapToggleBtn.addEventListener('click', () => {
        isWordWrap = !isWordWrap;
        if (isWordWrap) {
            wrapper.className = 'wrap';
            wrapToggleBtn.textContent = '↩ 自动折行';
            wrapToggleBtn.style.color = '#38BDF8';
        } else {
            wrapper.className = 'nowrap';
            wrapToggleBtn.textContent = '↔ 单行滚动';
            wrapToggleBtn.style.color = '#64748B';
        }
        syncScroll();
    });

    statusLeft.appendChild(langBadge);
    statusLeft.appendChild(document.createTextNode('·'));
    statusLeft.appendChild(document.createTextNode('UTF-8'));
    statusLeft.appendChild(document.createTextNode('·'));
    statusLeft.appendChild(wrapToggleBtn);

    // 状态栏右侧：光标位置与字符/行数统计
    const statusRight = document.createElement('div');
    statusRight.style.display = 'flex';
    statusRight.style.alignItems = 'center';
    statusRight.style.gap = '12px';

    const cursorPositionSpan = document.createElement('span');
    cursorPositionSpan.textContent = '行 1, 列 1';

    const countStatSpan = document.createElement('span');
    countStatSpan.textContent = `${textToSet.length.toLocaleString()} 字符 · ${(textToSet.match(/\n/g) || []).length + 1} 行`;

    statusRight.appendChild(cursorPositionSpan);
    statusRight.appendChild(countStatSpan);

    statusBar.appendChild(statusLeft);
    statusBar.appendChild(statusRight);
    wrapper.appendChild(statusBar);

    // ==========================================
    // 7.4 滚动与双层同轴同步 (消除滚动盲区)
    // ==========================================
    function syncScroll() {
        const top = textarea.scrollTop;
        const left = textarea.scrollLeft;
        preHighlight.style.transform = `translate(${-left}px, ${-top}px)`;
        lineGutter.scrollTop = top;
    }

    textarea.addEventListener('scroll', syncScroll);

    // 在整个编辑器区域（包括左侧行号条）监听滚轮，确保在任何角落都能丝滑滚动
    editorBody.addEventListener('wheel', (e) => {
        if (e.target !== textarea) {
            textarea.scrollTop += e.deltaY;
            textarea.scrollLeft += e.deltaX;
            syncScroll();
        }
    }, { passive: true });

    function updateHighlightAndStats() {
        const val = textarea.value;

        // 1. 同步高亮 HTML (末尾如果换行，补齐空格保持行高对齐)
        const trailingFix = val.endsWith('\n') ? ' ' : '';
        preHighlight.innerHTML = highlightCode(val, ext) + trailingFix;

        // 2. 行号更新 (确保格式与宽度根据位数自适应)
        const lineCount = (val.match(/\n/g) || []).length + 1;
        let numbers = '';
        for (let i = 1; i <= lineCount; i++) {
            numbers += i + '\n';
        }
        lineGutter.textContent = numbers;

        // 动态调整行号区宽度，支持千行万行大文件
        const digitCount = String(lineCount).length;
        const idealWidth = Math.max(44, digitCount * 8 + 18);
        lineGutter.style.width = `${idealWidth}px`;

        // 3. 统计底栏更新
        countStatSpan.textContent = `${val.length.toLocaleString()} 字符 · ${lineCount} 行`;

        // 4. 滚动位校准
        syncScroll();

        // 5. JSON 验证
        validateJsonSyntax();
    }

    function updateCursorPosition() {
        const selStart = textarea.selectionStart;
        const val = textarea.value.substring(0, selStart);
        const lines = val.split('\n');
        const curLine = lines.length;
        const curCol = lines[lines.length - 1].length + 1;
        cursorPositionSpan.textContent = `行 ${curLine}, 列 ${curCol}`;
    }

    let isJsonValid = true;
    function validateJsonSyntax() {
        if (!isJson) return true;
        try {
            JSON.parse(textarea.value);
            isJsonValid = true;
            if (jsonErrorPill) jsonErrorPill.style.display = 'none';
            saveBtn.style.opacity = '1';
            saveBtn.disabled = false;
            return true;
        } catch (err) {
            isJsonValid = false;
            let errMsg = err.message;
            if (errMsg.length > 25) errMsg = errMsg.substring(0, 25) + '...';
            if (jsonErrorPill) {
                jsonErrorPill.textContent = `❌ ${errMsg}`;
                jsonErrorPill.style.display = 'inline-block';
            }
            return false;
        }
    }

    if (formatBtn) {
        formatBtn.addEventListener('click', (e) => {
            e.preventDefault();
            try {
                const parsed = JSON.parse(textarea.value);
                textarea.value = JSON.stringify(parsed, null, 2);
                updateHighlightAndStats();
                updateCursorPosition();
                showToast('✨ JSON 格式化成功', 'success', 1500);
            } catch (err) {
                showToast(`格式化失败: ${err.message}`, 'error', 2000);
            }
        });
    }

    let isComposing = false;
    textarea.addEventListener('compositionstart', () => {
        isComposing = true;
        // 中文拼音/选词期间临时使文本可见，确保用户能清晰看清自己正在输入的拼音及输入法下划线
        textarea.style.setProperty('-webkit-text-fill-color', '#e2e8f0', 'important');
    });

    textarea.addEventListener('compositionend', () => {
        isComposing = false;
        // 汉字上屏后恢复全透明，将显示无缝交还给顶层纯净语法高亮层
        textarea.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
        updateHighlightAndStats();
        updateCursorPosition();
    });

    textarea.addEventListener('input', () => {
        if (!isComposing) {
            updateHighlightAndStats();
        }
        updateCursorPosition();
    });

    textarea.addEventListener('click', updateCursorPosition);
    textarea.addEventListener('keyup', updateCursorPosition);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
            updateHighlightAndStats();
            updateCursorPosition();
        }
    });

    updateHighlightAndStats();
    updateCursorPosition();

    document.body.appendChild(wrapper);

    // 观察面板大小变动 (如拖动右侧栏宽度分割线)
    let resizeObserver = null;
    if (window.ResizeObserver && panel) {
        resizeObserver = new ResizeObserver(() => {
            syncBounds();
        });
        resizeObserver.observe(panel);
    }

    window.addEventListener('resize', syncBounds);

    requestAnimationFrame(() => {
        textarea.focus();
        if (targetLine && targetLine > 0) {
            const lines = textarea.value.split('\n');
            let charPos = 0;
            for (let i = 0; i < Math.min(targetLine - 1, lines.length); i++) {
                charPos += lines[i].length + 1;
            }
            try {
                textarea.setSelectionRange(charPos, charPos);
                textarea.scrollTop = Math.max(0, (targetLine - 4) * 21);
                syncScroll();
                updateCursorPosition();
            } catch (e) {}
        }
    });

    let isSaving = false;
    async function handleSaveAndExit() {
        if (isSaving) return;

        if (isJson && !validateJsonSyntax()) {
            showToast('⚠️ JSON 语法有误，请修复后再保存', 'error', 2500);
            return;
        }

        isSaving = true;
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';

        const newContent = textarea.value;
        const res = await writeFileToBackend(filePath, newContent);

        if (res.success) {
            showToast(`✓ 文件已保存并退出编辑: ${fileName}`, 'success', 2200);
            destroyEditor();

            // 1. 同步回写底层面板已渲染的 DOM 视图，让用户所见即所得
            if (contentContainer) {
                try {
                    const targetTextEl = contentContainer.querySelector('pre, code, textarea') || contentContainer;
                    if (targetTextEl && (targetTextEl.tagName === 'PRE' || targetTextEl.tagName === 'CODE' || targetTextEl.tagName === 'TEXTAREA' || targetTextEl.children.length === 0)) {
                        targetTextEl.textContent = newContent;
                    }
                } catch (e) {}
            }

            // 2. 经典预览面板刷新
            if (previewBtn) {
                setTimeout(() => {
                    if (rawBtn) {
                        try { rawBtn.click(); } catch (e) {}
                        setTimeout(() => {
                            try { previewBtn.click(); } catch (e) {}
                        }, 60);
                    } else {
                        try { previewBtn.click(); } catch (e) {}
                    }
                }, 100);
            }

            // 3. 新版工作区联动刷新：如果存在侧边栏刷新按钮，触发一次重载更新磁盘最新内容
            const refreshBtn = document.querySelector('button[aria-label="Refresh"][data-tooltip-id*="Workspaces"]') ||
                               document.querySelector('button[aria-label="Refresh"]');
            if (refreshBtn) {
                setTimeout(() => {
                    try { refreshBtn.click(); } catch (e) {}
                }, 120);
            }
        } else {
            isSaving = false;
            saveBtn.disabled = false;
            saveBtn.style.opacity = '1';
            showToast(`保存失败: ${res.error || '未知错误'}`, 'error', 3000);
        }
    }

    function handleCancelExit() {
        destroyEditor();
        showToast('已退出编辑', 'info', 1400);
    }

    saveBtn.addEventListener('click', handleSaveAndExit);
    exitBtn.addEventListener('click', handleCancelExit);

    function onKeyDown(e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            e.stopPropagation();
            handleSaveAndExit();
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            handleCancelExit();
            return;
        }
    }

    window.addEventListener('keydown', onKeyDown, true);

    function destroyEditor() {
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', syncBounds);
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        if (wrapper && wrapper.parentElement) {
            wrapper.remove();
        }
        activeEditorInstance = null;
    }

    activeEditorInstance = {
        filePath,
        destroy: destroyEditor
    };
}

// ==========================================
// 8. 全局双击事件与初始化
// ==========================================
// 8.1 外部/快捷调用的直接打开编辑器函数
export async function openFileInEditor(targetPath, targetLine = null) {
    if (!targetPath) return;

    const baseName = targetPath.substring(targetPath.lastIndexOf('/') + 1);
    showToast(`正在定位文件: ${baseName}...`, 'info', 800);

    const resolvedPath = await resolveFilePathOnDisk(targetPath);
    if (!resolvedPath) {
        showToast(`⚠️ 本地未找到该文件: ${targetPath}`, 'error', 3000);
        return;
    }

    const statRes = await checkFileStat(resolvedPath);
    if (!statRes || !statRes.success || !statRes.isFile) {
        showToast(`⚠️ 无法访问文件: ${resolvedPath}`, 'error', 3000);
        return;
    }

    if (statRes.isBinary) {
        showToast(`⚠️ 二进制文件不支持原地编辑: ${resolvedPath.substring(resolvedPath.lastIndexOf('.') || 0)}`, 'error', 3000);
        return;
    }

    const fileData = await readFileFromBackend(resolvedPath);
    if (!fileData || !fileData.success || typeof fileData.content !== 'string') {
        showToast(`读取失败: ${fileData?.error || '无法读取文件内容'}`, 'error', 3000);
        return;
    }

    // 从外部或对话选区打开文件：优先覆盖当前活动的工作区（包含代码查看器与文件树），营造独占专注编辑体验
    const activeWorkspacePanel = findWorkspaceRootContainer();

    const panelInfo = {
        panel: activeWorkspacePanel,
        contentContainer: null,
        header: null,
        filePath: resolvedPath,
        rawBtn: null,
        previewBtn: null,
        isWorkspaceViewer: Boolean(activeWorkspacePanel)
    };

    mountInlineEditor(panelInfo, fileData.content, targetLine);
}

// ==========================================
// 8.2 对话选中文本「在编辑器中打开」注入模块
// ==========================================
let lastActiveSelectionPath = '';
let lastActiveSelectionLine = null;
let isOpeningAnyFile = false;

function initSelectionEditorButton() {
    console.log('⚡ [Antigravity Mod] 对话选中文档/代码快速编辑注入已启动');

    function checkAndInjectButton() {
        const quoteBtn = document.querySelector('button[data-testid="selection-quote-button"]');
        if (!quoteBtn || !quoteBtn.parentElement) return;

        const parentBar = quoteBtn.parentElement;

        // 1. 获取当前用户选中的文字
        const selection = window.getSelection();
        let rawSelectedText = '';
        let targetLine = null;
        let candidatePath = '';

        if (selection && !selection.isCollapsed) {
            rawSelectedText = selection.toString();
            targetLine = extractLineNumber(rawSelectedText);
            candidatePath = cleanSelectedFilePath(rawSelectedText);

            // 如果选中文本本身不是直接的路径，尝试看是否选中了带 href 的 a 标签
            if (!isCandidateFilePath(candidatePath)) {
                try {
                    const anchorEl = selection.anchorNode?.parentElement?.closest('a[href]') || 
                                     selection.focusNode?.parentElement?.closest('a[href]');
                    if (anchorEl && anchorEl.href) {
                        const href = decodeURIComponent(anchorEl.href);
                        targetLine = targetLine || extractLineNumber(href);
                        const cleanHref = cleanSelectedFilePath(href);
                        if (isCandidateFilePath(cleanHref)) {
                            candidatePath = cleanHref;
                        }
                    }
                } catch (e) {}
            }
        }

        const isValid = isCandidateFilePath(candidatePath);

        let editorBtn = parentBar.querySelector('#ag-selection-editor-btn');
        let divider = parentBar.querySelector('#ag-selection-editor-divider');

        if (!isValid) {
            // 如果用户正在点击打开文件，绝对不能提前销毁按钮！
            if (isOpeningAnyFile) return;
            // 如果鼠标正按在或悬停在 Edit 按钮上，延缓销毁以避免打断点击事件链
            if (editorBtn && (editorBtn.matches(':active') || editorBtn.matches(':hover'))) return;

            // 如果当前选中的不是合法文件路径，保持原生 Quote 浮层纯净并还原原生样式
            if (editorBtn) editorBtn.remove();
            if (divider) divider.remove();
            parentBar.style.transform = '';
            parentBar.style.display = '';
            parentBar.style.width = '';
            parentBar.style.padding = '';
            quoteBtn.style.flex = '';
            quoteBtn.style.padding = '';
            quoteBtn.style.minWidth = '';
            return;
        }

        lastActiveSelectionPath = candidatePath;
        lastActiveSelectionLine = targetLine;

        // 1. 规范父容器布局：采用 inline-flex + 自适应内容包裹，彻底消除内部空白与非对称拉伸
        parentBar.style.setProperty('display', 'inline-flex', 'important');
        parentBar.style.setProperty('flex-direction', 'row', 'important');
        parentBar.style.setProperty('align-items', 'center', 'important');
        parentBar.style.setProperty('width', 'auto', 'important');
        parentBar.style.setProperty('max-width', 'none', 'important');
        parentBar.style.setProperty('box-sizing', 'border-box', 'important');
        parentBar.style.setProperty('padding', '2px 4px', 'important');

        // 2. 规范原生 Quote 按钮：去除 flex-1 挤压，给足两侧呼吸空间，与 Edit 完美对称
        quoteBtn.style.setProperty('flex', '0 0 auto', 'important');
        quoteBtn.style.setProperty('padding', '3px 8px', 'important');
        quoteBtn.style.setProperty('white-space', 'nowrap', 'important');
        quoteBtn.style.setProperty('min-width', 'auto', 'important');

        // 3. 浮层视觉重心重平衡：因增加 Edit 按钮宽度，向左微调 20px 使浮层整体中心贴合选区末尾，不再向右过度悬挂
        parentBar.style.setProperty('transform', 'translateX(-20px)', 'important');

        // 若已存在，更新当前目标路径与行号
        if (editorBtn) {
            editorBtn.dataset.targetPath = candidatePath;
            if (targetLine) editorBtn.dataset.targetLine = String(targetLine);
            else delete editorBtn.dataset.targetLine;
            return;
        }

        // 创建微型视觉分割线 (完美垂直居中)
        divider = document.createElement('div');
        divider.id = 'ag-selection-editor-divider';
        divider.style.width = '1px';
        divider.style.height = '12px';
        divider.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
        divider.style.margin = '0 3px';
        divider.style.flexShrink = '0';
        divider.style.alignSelf = 'center';

        // 创建「Edit」快捷按钮，100% 继承原生 Quote 按钮交互与 Tailwind 状态，无缝对称
        editorBtn = document.createElement('button');
        editorBtn.id = 'ag-selection-editor-btn';
        editorBtn.dataset.testid = 'selection-open-editor-button';
        editorBtn.dataset.targetPath = candidatePath;
        if (targetLine) editorBtn.dataset.targetLine = String(targetLine);
        editorBtn.className = 'flex items-center gap-1 justify-center transition-colors cursor-pointer hover:bg-secondary text-xs rounded select-none';
        editorBtn.style.setProperty('flex', '0 0 auto', 'important');
        editorBtn.style.setProperty('padding', '3px 8px', 'important');
        editorBtn.style.setProperty('white-space', 'nowrap', 'important');
        editorBtn.style.setProperty('min-width', 'auto', 'important');
        editorBtn.title = '在编辑器中打开 (⌘S 保存退出, Esc 退出; ⌥ 在外部打开)';
        editorBtn.innerHTML = `<span class="text-xs font-medium">Edit</span>`;

        let isOpeningThis = false;
        async function handleEditAction(e) {
            if (isOpeningThis) return;
            isOpeningThis = true;
            isOpeningAnyFile = true;

            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            const targetPath = editorBtn.dataset.targetPath || lastActiveSelectionPath;
            const targetLineNum = editorBtn.dataset.targetLine ? parseInt(editorBtn.dataset.targetLine, 10) : lastActiveSelectionLine;
            console.log('⚡ [SelectionEditor] 触发打开编辑:', targetPath, '行号:', targetLineNum);

            if (!targetPath) {
                isOpeningThis = false;
                isOpeningAnyFile = false;
                return;
            }

            try {
                if (e && e.altKey) {
                    openFileInFinderBackend('', '', targetPath);
                } else {
                    await openFileInEditor(targetPath, targetLineNum);
                }
            } catch (err) {
                console.error('⚡ [SelectionEditor] 打开失败:', err);
                showToast(`打开失败: ${err?.message || '未知异常'}`, 'error', 3000);
            } finally {
                setTimeout(() => {
                    isOpeningThis = false;
                    isOpeningAnyFile = false;
                }, 1000);
            }
        }

        // 关键机制：在 mousedown 阶段即刻触发，绝不因 selection 塌缩或 mouseup 延迟导致事件被取消！
        editorBtn.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                handleEditAction(e);
            }
        });

        // 兜底保障 click 事件
        editorBtn.addEventListener('click', (e) => {
            handleEditAction(e);
        });

        // 紧贴在 Quote 按钮右侧插入
        if (quoteBtn.nextSibling) {
            parentBar.insertBefore(divider, quoteBtn.nextSibling);
            parentBar.insertBefore(editorBtn, divider.nextSibling);
        } else {
            parentBar.appendChild(divider);
            parentBar.appendChild(editorBtn);
        }
    }

    // 监听选取变化与鼠标释放，增加多阶段延迟以匹配 React 浮层挂载时序
    document.addEventListener('selectionchange', () => {
        requestAnimationFrame(checkAndInjectButton);
        setTimeout(checkAndInjectButton, 40);
        setTimeout(checkAndInjectButton, 120);
    });

    document.addEventListener('mouseup', (e) => {
        // 若鼠标释放发生在 Edit 按钮内部，绝对不触发选区清理
        if (e.target && e.target.closest && e.target.closest('#ag-selection-editor-btn')) {
            return;
        }
        setTimeout(checkAndInjectButton, 10);
        setTimeout(checkAndInjectButton, 50);
        setTimeout(checkAndInjectButton, 150);
        setTimeout(checkAndInjectButton, 300);
    });

    // MutationObserver 监听 Quote 浮动栏动态挂载
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.addedNodes.length > 0) {
                const quoteBtn = document.querySelector('button[data-testid="selection-quote-button"]');
                if (quoteBtn) {
                    checkAndInjectButton();
                    setTimeout(checkAndInjectButton, 50);
                    break;
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

export function initFileEditor() {
    console.log('⚡ [Antigravity Mod] 本地文件双击编辑组件 (Pro IDE Ultra版) 已启动');

    // 启动选中文本 Quote 浮层按钮注入
    initSelectionEditorButton();

    document.addEventListener('dblclick', async (e) => {
        if (e.target.closest('input, textarea, button, a, [role="button"], #ag-inline-file-editor, aside, nav, .bg-sidebar, #leviosa-history-view, #leviosa-kanban-panel, [role="dialog"], [data-testid="conversation-view"], [data-testid="conversation-list"]')) {
            return;
        }

        const panelInfo = detectPanelAndFilePath(e.target);
        console.log('⚡ [FileEditor] 双击事件触发:', e.target, '探测结果:', panelInfo);

        if (!panelInfo || !panelInfo.filePath) {
            return;
        }

        let filePath = panelInfo.filePath;

        if (activeEditorInstance && activeEditorInstance.filePath === filePath) {
            return;
        }

        const domContent = extractVisibleTextFromDOM(panelInfo.contentContainer);

        const resolved = await resolveFilePathOnDisk(filePath);
        if (resolved) {
            filePath = resolved;
            panelInfo.filePath = resolved;
        }

        let statRes = await checkFileStat(filePath);

        let diskContent = '';
        if (statRes && statRes.success && statRes.isFile && !statRes.isBinary) {
            showToast(`载入中: ${filePath.substring(filePath.lastIndexOf('/') + 1)}...`, 'info', 800);
            const fileData = await readFileFromBackend(filePath);
            if (fileData && fileData.success && typeof fileData.content === 'string') {
                diskContent = fileData.content;
            }
        }

        const initialContent = diskContent || domContent;

        if (!initialContent && (!statRes || !statRes.success)) {
            console.warn('⚡ [FileEditor] 既无磁盘内容也无 DOM 文本，忽略编辑触发');
            return;
        }

        mountInlineEditor(panelInfo, initialContent, panelInfo.targetLine || null);
    }, true);

    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
        if (target.dataset?.agEditorHintReady) return;

        if (target.closest('button, a, input, textarea, #ag-inline-file-editor')) return;

        // 核心屏障：左侧边栏、历史记录、看板或聊天对话区绝对不触发任何悬停探测
        if (target.closest('aside, nav, .bg-sidebar, #leviosa-history-view, #leviosa-kanban-panel, [role="dialog"], [data-testid="conversation-view"], [data-testid="conversation-list"]')) return;

        // 文件树侧边栏绝不触发乱跳的悬停提示
        if (target.closest('[data-testid="tab-file-tree-sidebar"]')) return;

        // 新版代码查看器：仅针对有效行元素设置提示
        if (target.closest('.file-viewer-root')) {
            const line = target.closest('.code-line');
            if (line && line.dataset?.fileUri) {
                target.dataset.agEditorHintReady = 'true';
                if (!target.title) {
                    const baseName = line.dataset.fileUri.substring(line.dataset.fileUri.lastIndexOf('/') + 1);
                    target.title = `💡 双击可编辑本地文件: ${decodeURIComponent(baseName)} (⌘S 保存退出, Esc 退出)`;
                }
            }
            return;
        }

        const panelInfo = detectPanelAndFilePath(target);
        if (panelInfo && panelInfo.filePath) {
            // 确保光标切实位于该文件预览面板的内容区内部，绝不在外部卡片或标题上提示
            if (panelInfo.contentContainer && panelInfo.contentContainer.contains(target)) {
                target.dataset.agEditorHintReady = 'true';
                if (!target.title) {
                    target.title = `💡 双击可编辑本地文件: ${panelInfo.filePath.substring(panelInfo.filePath.lastIndexOf('/') + 1)} (⌘S 保存退出, Esc 退出)`;
                }
            }
        }
    });
}
