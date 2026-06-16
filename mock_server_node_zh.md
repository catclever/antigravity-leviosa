# DIY Mock 服务器 (Node.js)

**使用 Node.js (简单快捷)：**

由于我们最近将后端的逻辑重构为了模块化的异步函数（存放在 `worker` 目录中），现在搭建一个 Mock 服务器变得异常简单。你只需要用 Express 写一个基础的外壳，把请求路由给这些 Worker 脚本去处理即可！

1. 在下载好的仓库目录（也就是包含 `apps` 文件夹的那个目录）下，初始化一个新项目并安装依赖：
   ```bash
   npm init -y
   npm install express cors
   ```
2. 在同级目录下创建一个 `server.js` 文件：
   ```javascript
   const express = require('express');
   const cors = require('cors');
   const path = require('path');
   const app = express();

   app.use(cors());

   // 静态托管 web 目录下的前端 UI 脚本
   app.use('/src/apps/com.google.antigravity/web', express.static(path.join(__dirname, 'apps/com.google.antigravity/web')));

   // 统一将 API 请求路由给对应的 worker 模块
   app.get('/api/script/apps/com.google.antigravity/worker/:scriptName', async (req, res) => {
       try {
           const scriptPath = path.join(__dirname, 'apps/com.google.antigravity/worker', req.params.scriptName + '.js');
           
           // 动态引入 worker 脚本
           const workerModule = require(scriptPath);
           
           // 执行模块导出的异步函数，并传入请求参数
           const result = await workerModule(req.query);
           
           // 直接返回 JSON 结果
           res.json(result);
       } catch (e) {
           console.error(`Error executing ${req.params.scriptName}:`, e);
           res.status(500).json({ success: false, error: e.message });
       }
   });

   app.listen(9216, '127.0.0.1', () => console.log('Mock server 运行在 9216 端口!'));
   ```
3. 使用 `node server.js` 启动服务。
