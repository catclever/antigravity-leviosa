// main.js
import { initTopbar } from './topbar_color.js';
import { initProjectDots } from './project_dots.js';
import { initBackground } from './background.js';
import { initProjectSearch } from './project_search.js';
import { initDoubleClickSubmit } from './double_click_submit.js';

console.log('🚀 [Antigravity Mod] 正在加载模块化组件...');

// 依次激活各大功能模块
initBackground();
initTopbar();
initProjectDots();
initProjectSearch();
initDoubleClickSubmit();

console.log('✅ [Antigravity Mod] 所有模块加载完毕！');
