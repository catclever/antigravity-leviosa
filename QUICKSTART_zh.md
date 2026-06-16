# 快速开始

为了让一切运转起来，请按照以下三个步骤操作：

### 第一步：下载脚本
首先，你需要把扩展文件下载到本地电脑：
1. 将此仓库克隆或下载到你常用的目录：
   ```bash
   git clone https://github.com/catclever/antigravity-leviosa.git
   ```
2. 请记住这个目录的绝对路径，在之后的配置步骤中会用到它。

### 第二步：配置本地数据源
为了解锁这个扩展的全部潜力，你需要在一个后台运行本地 API 服务。你有两种方法来进行配置：

#### 方法一：“Taichi” 方式（推荐，仅限 Mac）
这个扩展旨在与我本地的 **Taichi** 服务（目前仅限 Mac）无缝协作，该服务将作为这些动态配置的主要数据源。

1. 克隆或下载 Taichi 服务：[https://github.com/catclever/taichi](https://github.com/catclever/taichi)
2. 将刚才下载的仓库中的 `apps` 文件夹直接复制到 Taichi 的本地脚本目录中。（这会将 `com.google.antigravity` 应用合并到你的 Taichi 环境里）。
3. 只要 Taichi 在本地运行，它就会自动托管这些文件，并在 `http://127.0.0.1:9216` 暴露所需的端点。
4. 一切准备就绪！

#### 方法 2：DIY Mock 服务器
如果你不想下载整个 Taichi 仓库，完全没问题！你可以用 Node.js 轻松搭建一个本地的微型 Mock 服务器来满足 API 需求。

我们准备了一个快速开始指南。点击下方链接查看完整脚本：
- [使用 Node.js (简单快捷)](./mock_server_node_zh.md)

无论你选择哪种方法，在进入最后一步之前，请确保该服务正在运行。

### 第三步：配置 Antigravity
最后，你需要让 Antigravity 去加载这些自定义脚本。

1. 在 Antigravity 界面中，按下 `Command + Option + I`（Mac 系统）打开开发者工具 (Developer Tools)。*（注：在 2026 年 6 月 12 日 Google 更新后，该快捷键已被禁用。现在需要通过开启网页端调试模式来进行注入，具体做法请自行搜索。）*
2. 切换到 **Sources**（源代码）标签页。
3. 在左侧面板中（你可能需要点击 `>>` 图标），选择 **Snippets**（代码段）并创建一个新的 snippet。
4. 在编辑器中输入以下代码：
   ```javascript
   import('http://127.0.0.1:9216/src/apps/com.google.antigravity/web/main.js')
   ```
   *（注：这里的端口和端点应当与你的配置相匹配。如果你在第二步使用的是 DIY mock 服务器而不是 Taichi，你需要确保你的本地服务器也将包含 `main.js` 的目录作为静态资源映射在这个路径上）。*
5. 右键点击该 snippet 的名字，选择 **Run**（或按下 `Command + Enter`）来执行代码。
