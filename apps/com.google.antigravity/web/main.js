// main.js
import { initTopbar } from './topbar_color.js';
import { initProjectDots } from './project_dots.js';
import { initBackground } from './background.js';
import { initProjectSearch } from './project_search.js';
import { initDoubleClickSubmit } from './double_click_submit.js';
import { initProjectOpener } from './project_opener.js';
import { initSidebarReorder } from './sidebar_reorder.js';
import { initArchiveHook } from './archive_hook.js';
import { initKbTrigger } from './kb_trigger.js';
import { initSessionSwitcher } from './session_switcher.js';

console.log('🚀 [Antigravity Mod] 正在加载模块化组件...');

if (window === window.top) {
    // 依次激活各大功能模块
    initBackground();
    initTopbar();
    initProjectDots();
    initProjectSearch();
    initDoubleClickSubmit();
    initProjectOpener();
    initSidebarReorder();
    initArchiveHook();
    initKbTrigger();
    initSessionSwitcher();

    console.log('✅ [Antigravity Mod] 所有模块加载完毕！');
} else {
    console.log('⏭️ [Antigravity Mod] 检测到处于 iframe 中，跳过执行。');
}
