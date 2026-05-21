# 自建 Mock 服务 (Node.js)

**使用 Node.js（简单快捷）:**

1. 初始化一个新文件夹并安装依赖：
   ```bash
   npm init -y
   npm install express cors
   ```
2. 创建一个 `server.js` 文件：
   ```javascript
   const express = require('express');
   const cors = require('cors');
   const fs = require('fs');
   const path = require('path');
   const app = express();

   app.use(cors());

   // 配置项：在此处添加你所有存放项目文件夹的根目录的绝对路径
   const PROJECT_ROOTS = [
       '/Users/YourName/Projects',
       '/Users/YourName/Documents',
       '/Users/YourName/workbench'
   ];

   app.get('/api/script/taichi_theme_sync', (req, res) => {
       const projectParam = req.query.project;
       let color = '#999999'; // 默认保底颜色
       
       if (projectParam) {
           // 1. 处理 VS Code 的 Multi-Root Workspaces（以逗号分隔的项目名）
           const subProjects = projectParam.split(',').map(p => p.trim()).filter(Boolean);
           
           for (const project of subProjects) {
               for (const root of PROJECT_ROOTS) {
                   let settingsPath = path.join(root, project, '.vscode', 'settings.json');
                   
                   // 2. 检查精确匹配的文件夹
                   if (!fs.existsSync(settingsPath)) {
                       // 3. 降级方案：模糊匹配（查找包含该名称的目录）
                       if (fs.existsSync(root)) {
                           try {
                               const items = fs.readdirSync(root, { withFileTypes: true });
                               for (const item of items) {
                                   if (item.isDirectory() && item.name.includes(project)) {
                                       const fuzzyPath = path.join(root, item.name, '.vscode', 'settings.json');
                                       if (fs.existsSync(fuzzyPath)) {
                                           settingsPath = fuzzyPath;
                                           break;
                                       }
                                   }
                               }
                           } catch (e) {}
                       }
                   }

                   // 如果找到了有效的 settings 文件，提取颜色
                   if (fs.existsSync(settingsPath)) {
                       try {
                           const content = fs.readFileSync(settingsPath, 'utf8');
                           // 使用正则表达式安全提取颜色，避免因为带注释导致 JSON.parse 解析失败
                           const match = content.match(/"peacock\.color"\s*:\s*"([^"]+)"/);
                           if (match) {
                               color = match[1];
                               break; // 如果找到颜色，停止搜索根目录列表
                           }
                       } catch (e) {
                           console.error(`Error reading settings for ${project}:`, e);
                       }
                   }
               }
               if (color !== '#999999') break; // 如果找到颜色，停止搜索子项目
           }
       }

       res.json({ success: true, color: color });
   });

   app.listen(9216, '127.0.0.1', () => console.log('Mock server running on port 9216!'));
   ```
3. 运行它： `node server.js`。
