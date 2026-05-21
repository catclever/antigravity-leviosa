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

1. 克隆并启动 Taichi 服务：[https://github.com/catclever/taichi](https://github.com/catclever/taichi)
2. 只需将第一步下载的**整个**文件夹复制到你 Taichi 的本地 scripts 目录中。（这个文件夹既包含了我们的 UI 脚本，也包含了 Taichi 所需的 `taichi_theme_sync.js` 后端插件）。
3. 一旦 Taichi 在本地运行，它就会自动托管这些文件，并在 `http://127.0.0.1:9216` 暴露所需的接口。
4. 大功告成！

#### 方法二：自建 Mock 服务
如果你不想拉取整个 Taichi 仓库，完全没问题！你可以轻松启动一个微型的本地 Mock 服务来满足 API 请求。

*（注意：如果你使用这种方法，你完全可以无视下载包里的 `taichi_theme_sync.js` 文件，因为你的 mock 服务会接管它的工作！）*

> *注意：扩展会向 `http://127.0.0.1:9216/api/script/taichi_theme_sync?project=<name>` 发送 GET 请求。路径名叫 `taichi_theme_sync` 是因为它在 Taichi 环境中作为特定脚本执行。我们在 mock 服务里直接复用这个路径，只是为了保证完全兼容而不需要去改动扩展的前端代码！*

我们为你准备了两种常用语言的快速上手指南。点击下方链接查看完整脚本：
- [使用 Node.js（简单快捷）](./mock_server_node_zh.md)
- [使用 Python 3](./mock_server_python_zh.md)

无论你选择哪种方法，在进入最后一步之前，请确保该服务正在运行。

### 第三步：配置 Antigravity
最后，你需要让 Antigravity 去加载这些自定义脚本。

1. 在 Antigravity 界面中，按下 `Command + Option + I`（Mac 系统）打开开发者工具 (Developer Tools)。
2. 切换到 **Sources**（源代码）标签页。
3. 在左侧面板中（你可能需要点击 `>>` 图标），选择 **Snippets**（代码段）并创建一个新的 snippet。
4. 在编辑器中输入以下代码：
   ```javascript
   import('http://127.0.0.1:9216/src/antigravity/main.js')
   ```
   *（注意：此处的端口和路径需要与你的配置匹配。如果你在第二步使用的是 DIY mock 服务而不是 Taichi，请确保你的本地服务也在该路径下静态托管了包含 `main.js` 的目录）。*
5. 右键点击该 snippet 的名字，选择 **Run**（或按下 `Command + Enter`）来执行代码。
