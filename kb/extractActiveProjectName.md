# extractActiveProjectName()

## 简介
`extractActiveProjectName()` 是一个在前端执行的实用函数，专门用于从当前页面的 DOM（如 Gemini 网页端）中动态抓取用户当前正在操作的项目名称（Project Name）。它通过嗅探页面元素和类名的特征来获取信息，无需依赖官方 API。

## 核心逻辑
该函数采用了“见招拆招”的多级降级策略，确保在不同版本的 UI 或不同的显示模式下都能尽可能准确地提取到项目名：

1. **新版 UI 提取 (最优策略)**
   - 寻找属性为 `[data-testid="project-selector-trigger"]` 的元素（通常是项目切换下拉按钮）。
   - 解析其 `aria-label` 属性（通过正则匹配 `current:\s*(.+)$`）。
   - 如果没有 `aria-label`，则抓取该元素内部包含 `span.truncate` 类名的子元素的纯文本。

2. **多目录模式回退策略**
   - 收集页面上所有带有 `span.truncate.inline-block` 样式的元素。
   - 从后往前倒序遍历，如果某个元素的下一个兄弟节点（`nextElementSibling`）的文本内容正好是 `/`，说明这是一个表示路径的面包屑，此时提取该元素的文本作为项目名。

3. **单目录模式终极降级策略**
   - 如果上述方法均未找到，再次倒序遍历所有的 `span.truncate.inline-block` 元素。
   - 直接提取页面上**最后一个处于可见状态（渲染宽度 > 0）**且文本不是 `/` 的元素的文本内容。

## 典型用法
在需要向本地/后端发送与项目上下文相关的请求时，使用该函数来确定当前的 `projectName`。

```javascript
import { extractActiveProjectName } from './project_opener.js';

// 获取当前项目名
const projName = extractActiveProjectName();

if (projName) {
    console.log(`当前激活的项目是: ${projName}`);
    // 发起带参请求，例如获取项目相关的私有命令
    fetch(`http://127.0.0.1:9216/api/get_info?project=${encodeURIComponent(projName)}`)
        .then(res => res.json())
        .then(data => console.log(data));
} else {
    console.warn("无法从当前页面提取出项目名");
}
```

## 注意事项
由于该函数重度依赖 DOM 结构和特定的 CSS 类名（如 `.truncate`、`[data-testid=...]` 等），如果宿主网页的 UI 发生重大破坏性更新，此函数可能会失效并返回 `null`。在未来的维护中，需在 UI 变更后及时更新抓取规则。
