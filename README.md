# Antigravity Leviosa

<p align="center">
  <img src="images/preview-1.png" alt="Preview 1" width="48%">
  <img src="images/preview-2.png" alt="Preview 2" width="48%">
</p>

## What's in the Box? 

- 🌠 **Soul-Infused Wallpaper**: How can you even write code with a soul without a custom background image?<br>
  🌠 **注入背景图**：没有背景图，怎么能写出有灵魂的代码！

- 🎨 **Peacock Topbar**: Reuses your VS Code Peacock extension configs, saving you from the absolute tragedy of running a command in the wrong project.<br>
  🎨 **孔雀顶栏**：复用 Peacock 插件的配置，避免了把某个项目的指令发送到另一个项目的悲剧。

- 🟢 **Peacock Indicator Dots**: The native project grouping is ugly and un-sortable. Lighting up these colored indicators is the only way to survive.<br>
  🟢 **孔雀提示灯**：按项目分组太丑还不能排序，只有开提示灯才能维持生活啊。

- 🔍 **Project Search Filter**: Because Google engineers probably only have one project... or they're secretly using Claude Code.<br>
  🔍 **项目列表搜索**：Google 的工程师可能只有一个项目，或者他们其实用的是 Claude Code...

- 🖱️ **Permission UX Overhaul**:Double-click to submit, plus highlighted borders. Isn't this basic UX? This Electron app's interaction design is literally worse than a CLI...<br>
  🖱️ **权限操作优化**：支持双击提交，增加高亮边框（这不基操么，Electron 交互做得连 CLI 都不如的玩意儿...

- 🚀 **One-Click IDE Opener**: Replaces the native IDE button with a slick multi-app dropdown menu. Open any project directly in VS Code, Kitty terminal, or Finder with a single click!<br>
  🚀 **一键闪现 IDE**：无缝接管原生的打开按钮，注入多应用下拉菜单。一键直达 VS Code、Kitty 终端或者 Finder，告别繁琐的路径跳转！

## Background

Google decided to bless us with a whole bunch of updates on May 20th:
- More colour Gemini web and app with STRANGE (aka Ugly) Chinese typography (I'm sure AI wrote the i18n code...)
- Antigravity became an AI-first dashboard, and the original IDE mode got renamed to *Antigravity IDE*. All the original data got hooked up to the new Antigravity (where a single conversation is treated as a project). Meanwhile, the data in the IDE went... completely wiped out. (Seriously, does any PM actually have the authority to make a decision like this?)


So Antigravity? Well... Gemini is smart, but *only* inside Antigravity. After all, it's tens of light years away — you literally *need* Antigravity to not look like an idiot.


Be fair, the dashboard is cool, especially for someone with as many concurrent projects as me (or those who are forced to split themselves into multiple clones...). And it should be Antigravity's destined role (we already have too many VS Code clones out there...).

 However, switching projects on the old panel was painfully slow. But now, it is as smooth as butter so be glad to unload Antigravity IDE now! (since it become pure white and with almost twice size of the dashboard..)


Sure, the dashboard still has a few clunky spots, and RIP to our VS Code extensions. But hey, thanks to Electron, we can just hit it with a good ol' *Leviosa*!

## Quick Start 快速开始

At its core, this extension works by injecting custom JavaScript and CSS directly into the dashboard to override the default UI and introduce new behaviors. While many features run entirely in the browser, some dynamic functionalities rely on querying a local data source.

**核心原理**：本质上，这个扩展是通过直接向面板注入自定义的 JavaScript 和 CSS 来覆盖默认 UI 并引入新功能的。虽然很多功能完全在浏览器内运行，但部分动态功能需要依赖于查询本地数据源。

> 🇨🇳 [点击这里中文版指南](./QUICKSTART_zh.md)

To get everything up and running, follow these three steps:

### Step 1: Download the Scripts
First, you need to get the extension files onto your local machine:
1. Clone or download this repository to your preferred directory:
   ```bash
   git clone https://github.com/catclever/antigravity-leviosa.git
   ```
2. Note the absolute path to this directory, as you'll need it for the configuration step.

### Step 2: Setup the Local Data Source
To unlock the full potential of this extension, you'll need a local API endpoint running in the background. You have two ways to set this up:

#### Method 1: The "Taichi" Way (Recommended, Mac Only)
This extension is designed to work seamlessly with my local **Taichi** service (currently Mac Only), which acts as the primary data source for these dynamic configurations. 

1. Clone and start the Taichi service: [https://github.com/catclever/taichi](https://github.com/catclever/taichi)
2. Simply copy the `apps` folder from the downloaded repository into your Taichi's local scripts directory. (This will merge the `com.google.antigravity` app into your Taichi environment).
3. Once Taichi is running locally, it automatically hosts these files and exposes the required endpoint at `http://127.0.0.1:9216`.
4. You're good to go!

#### Method 2: The DIY Mock Server
If you don't want to pull the entire Taichi repo, no worries! You can easily spin up a tiny local mock server using Node.js to satisfy the API requirements. 

We have prepared a quick-start guide. Click the link below for the full scripts:
- [Using Node.js (Quick & Easy)](./mock_server_node.md)

Whichever method you choose, ensure the service is running before proceeding to the final step.

### Step 3: Configure Antigravity
Finally, you need to tell the Antigravity dashboard to load these custom scripts.

1. In the Antigravity dashboard, open the Developer Tools by pressing `Command + Option + I` (on Mac). *(Note: Following the June 12, 2026 Google update, this shortcut is now disabled. You will need to access it via web-based debugging mode instead. Please search for instructions on how to enable this.)*
2. Navigate to the **Sources** tab.
3. In the left panel (you might need to click the `>>` icon), select **Snippets** and create a new snippet.
4. Enter the following code into the snippet editor:
   ```javascript
   import('http://127.0.0.1:9216/src/apps/com.google.antigravity/web/main.js')
   ```
   *(Note: The port and endpoint here should match your configuration. If you used the DIY mock server in Step 2 instead of Taichi, you'll need to ensure your local server also serves the directory containing `main.js` statically at this path).*
5. Right-click the snippet name and select **Run** (or press `Command + Enter`) to execute the code.

## Important Notes 注意事项

- **Re-injection Required:** Since we are dynamically injecting this mod via Developer Tools, it will not persist across app restarts. Every time you fully quit and reopen the Antigravity dashboard, you will need to re-run the Snippet (Step 3).<br>
  **每次重启需重新注入**：通过开发者工具动态注入的功能不会在应用重启后驻留。每次完全退出并重新打开 Antigravity 后，你都需要重新运行一次 Snippet（即重复第三步）。
- **Google "Moves Fast and Breaks Things":** Antigravity is an actively updated product. Future updates to their dashboard's DOM structure or React components might cause some of these features to temporarily or permanently break. (Honestly, I hope Google just natively integrates these features soon so we don't have to keep injecting scripts...)<br>
  **速生速死**：Antigravity 是一个在积极更新的产品。如果未来 DOM 结构或者 React 组件发生重大变动，可能会导致某些功能暂时或者永久失效。（早用早享受哦~）

## Features & Configuration

Every feature in this mod is cleanly separated into its own module. Here is a breakdown of what each script does and how you can tweak it:

### 1. `main.js` (The Entry Point)
This is the conductor that imports and initializes all other modules.
- **Customization:** If you don't like a specific feature (e.g., the background image), you can easily disable it by simply commenting out its `initX()` function call. This is also the place to import and initialize any of your own custom feature scripts!

### 2. `api.js` (The Data Bridge)
Handles the communication between the dashboard and your local data source (Taichi or Mock Server) to fetch project theme colors.
- **Caching:** To keep the UI snappy and avoid spamming your local service, this module features a built-in L2 memory cache with a Time-To-Live (TTL) of **1 hour**.
- **Color Extraction Mechanism:** The theme colors depend on the `.vscode/settings.json` located in your local project folders. When requesting colors, the backend script employs a highly robust zero-config scanning mechanism:
  1. **Multi-Root Workspace Parsing:** It splits comma-separated project names and scans each sub-project sequentially.
  2. **SQLite Exact Matching:** It directly queries the IDE's local SQLite database (`state.vscdb`) to fetch the absolute paths of your recently opened workspaces. This ensures `O(1)` precision and gracefully handles duplicate folder names without requiring any manual path configuration!
  3. **Fuzzy Fallback:** If the exact path isn't found in the database, it falls back to a fuzzy search across common fallback directories.

### 3. `background.js` (Workspace Background)
Injects a custom background image into the dashboard along with some base CSS tweaks to make the UI look gorgeous.
- **Customization:** By default, the `bgImage` variable in this script is left empty for you to supply your own Base64 image string or a direct image URL. Feel free to dive into the CSS within this file to explore and tweak properties like the background blur (`backdrop-filter: blur(...)`), overlay opacity, and layout spacing to match your exact aesthetic preferences!

### 4. `topbar_color.js` (Dynamic Topbar)
Dynamically changes the topbar's background color based on the project you are currently viewing. It automatically calculates the color luminance to ensure the text remains readable (intelligently switching between dark and light text).

### 5. `project_dots.js` (Project Indicators)
Adds a slick, colored indicator dot next to the project names in the sidebar or subtitles, giving you a quick visual cue of your current project context.
- **⚠️ Limitation:** Please note that this feature currently only works if your Antigravity conversation list is set to **"No Grouping"** and uses the **"Workspace"** as the subtitle.

### 6. `project_search.js` (Project Filter)
Injects a highly responsive search box directly into the project selection popover dialog. Since the new dashboard groups conversations into a massive list, this makes filtering and finding your specific project a breeze!

### 7. `double_click_submit.js` (Fast Submit & UI Polish)
Adds a slick golden border and glow to the currently selected radio button options in dialogs, making it much clearer what you have selected. More importantly, it introduces a "click-again to submit" behavior: if you click an already-selected radio option, it will automatically find and trigger the "Submit" button for you. This dramatically speeds up interactions when dealing with multiple-choice workflows!

### 8. `project_opener.js` & `antigravity_open_project.js` (One-Click IDE Opener)
Overrides the native "Open in IDE" button by injecting a customizable dropdown menu, allowing you to open the active project directly into your preferred tools (VS Code, Kitty, Finder, etc.). It supports both single directories and multi-root workspaces.
- **Customization:** You can modify the `CONFIG.apps` array at the top of `project_opener.js` to add custom IDEs, change the default application, or update the SVG icons.
- **Backend Requirement:** This feature relies on the local service (Taichi or Mock Server) to execute the actual shell commands. It expects the endpoint `/api/script/apps/com.google.antigravity/worker/antigravity_open_project` to be available. If using a DIY mock server, you must implement this endpoint to handle the `open` commands.

### 9. `sidebar_reorder.js` (Sidebar Reorder)
Reorders the sidebar layout by visually moving the "Projects" section above "Pinned Conversations". It achieves this purely through CSS `order` (`-1` and `1`), ensuring no interference with the native React Virtual DOM.

### 10. `archive_brain.js` & `archive_hook.js` (Shallow Archive Tool)
An intelligent archiving module that manages local disk usage by cleaning up verbose `.system_generated` logs and `scratch` directories within individual `brain` folders. It compresses the cleaned files into `.tar.gz` archives and maintains an `archive_index.json` metadata record. It now runs fully asynchronously as a backend Worker script.

### 11. `kb_trigger.js` & `antigravity_knowledge_index.js` (Knowledge Base Injector)
A powerful feature that lets you instantly inject knowledge fragments into your chat prompt. Simply type `#kb ` (for all), `#kbg ` (for global), or `#kbl ` (for local) in the message input box to trigger a beautiful dropdown menu containing your reusable markdown knowledge files. Select an item, and it's instantly formatted and injected into your prompt!
- **Global Scope:** Reads from `~/.gemini/kb/*.md`
- **Local Scope:** Reads from `<project_dir>/.agent/kb/*.md`

### 12. `session_switcher.js` (Fast Session Switcher)
Brings the standard browser tab-switching experience to the Antigravity sidebar! Use `Ctrl + Tab` to cycle to the next active project session, and `Ctrl + Shift + Tab` to cycle to the previous one. It intelligently calculates the DOM position to ensure smooth scrolling.

## Todos
- 🐱 **KitiGravity**: God might have given us a hundred ways to open a terminal, but who could possibly resist summoning a kitty with a single click?<br>**🐱 KitiGravity**：虽然上帝给了100种打开终端的方式，但是谁能拒绝一键召唤小猫呢？
- 💻 **VSGGravity**: Even if it absolutely has to be opened in an IDE, Google probably pick Antigravtity IDE...But why not VSCode?<br>💻 **VSGGravity**：就算一定要在IDE中打开，Google应该也不会选它吧？但是为什么不选它呢？
- ⚡ **ZediGravity**: Did you say IDE? Step aside, you sins of Electron!<br>⚡ **ZediGravity**：你说IDE？就让我来涤荡Eletron的罪孽吧！
- ……

**幸甚至哉，鸽以咏志！**

（如果你看得懂，请不要尝试翻译，把它留给ai吧...）