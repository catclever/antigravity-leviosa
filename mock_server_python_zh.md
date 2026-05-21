# 自建 Mock 服务 (Python 3)

**使用 Python 3:**

1. 将以下代码保存为 `server.py`：
   ```python
   from http.server import BaseHTTPRequestHandler, HTTPServer
   import json
   import urllib.parse
   import os
   import re

   # 配置项：在此处添加你所有存放项目文件夹的根目录的绝对路径
   PROJECT_ROOTS = [
       '/Users/YourName/Projects',
       '/Users/YourName/Documents',
       '/Users/YourName/workbench'
   ]

   class MockServer(BaseHTTPRequestHandler):
       def do_GET(self):
           self.send_response(200)
           self.send_header('Access-Control-Allow-Origin', '*')
           self.send_header('Content-type', 'application/json')
           self.end_headers()

           parsed_path = urllib.parse.urlparse(self.path)
           if parsed_path.path == '/api/script/taichi_theme_sync':
               query = urllib.parse.parse_qs(parsed_path.query)
               project_param = query.get('project', [''])[0]
               color = '#999999' # 默认保底颜色
               
               if project_param:
                   # 1. 处理 VS Code 的 Multi-Root Workspaces（以逗号分隔的项目名）
                   sub_projects = [p.strip() for p in project_param.split(',') if p.strip()]
                   
                   for project in sub_projects:
                       for root in PROJECT_ROOTS:
                           settings_path = os.path.join(root, project, '.vscode', 'settings.json')
                           
                           # 2. 检查精确匹配的文件夹
                           if not os.path.exists(settings_path):
                               # 3. 降级方案：模糊匹配（查找包含该名称的目录）
                               if os.path.exists(root):
                                   try:
                                       for item in os.listdir(root):
                                           if project in item and os.path.isdir(os.path.join(root, item)):
                                               fuzzy_path = os.path.join(root, item, '.vscode', 'settings.json')
                                               if os.path.exists(fuzzy_path):
                                                   settings_path = fuzzy_path
                                                   break
                                   except Exception:
                                       pass
                           
                           # 如果找到了有效的 settings 文件，提取颜色
                           if os.path.exists(settings_path):
                               try:
                                   with open(settings_path, 'r', encoding='utf-8') as f:
                                       content = f.read()
                                       # 使用正则表达式安全提取颜色，避免因为带注释导致 JSON.loads 解析失败
                                       match = re.search(r'"peacock\.color"\s*:\s*"([^"]+)"', content)
                                       if match:
                                           color = match.group(1)
                                           break # 如果找到颜色，停止搜索根目录列表
                               except Exception as e:
                                   print(f"Error reading {settings_path}: {e}")
                       
                       if color != '#999999':
                           break # 如果找到颜色，停止搜索子项目
               
               response = {"success": True, "color": color}
               self.wfile.write(json.dumps(response).encode('utf-8'))
           else:
               self.wfile.write(b'{"success": False}')

   HTTPServer(('127.0.0.1', 9216), MockServer).serve_forever()
   ```
2. 运行它： `python3 server.py`。
