# DIY Mock Server (Python 3)

**Using Python 3:**

1. Save this as `server.py`:
   ```python
   from http.server import BaseHTTPRequestHandler, HTTPServer
   import json
   import urllib.parse
   import os
   import re

   # Configuration: Add the absolute paths to the directories where your projects are stored
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
           if parsed_path.path == '/api/script/antigravity_theme_sync':
               query = urllib.parse.parse_qs(parsed_path.query)
               project_param = query.get('project', [''])[0]
               color = '#999999' # Default fallback color
               
               if project_param:
                   # 1. Handle VS Code Multi-Root Workspaces (comma-separated names)
                   sub_projects = [p.strip() for p in project_param.split(',') if p.strip()]
                   
                   for project in sub_projects:
                       for root in PROJECT_ROOTS:
                           settings_path = os.path.join(root, project, '.vscode', 'settings.json')
                           
                           # 2. Exact Match Check
                           if not os.path.exists(settings_path):
                               # 3. Fallback: Fuzzy Match (find directory containing the name)
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
                           
                           # If we found a valid settings file, extract the color
                           if os.path.exists(settings_path):
                               try:
                                   with open(settings_path, 'r', encoding='utf-8') as f:
                                       content = f.read()
                                       # Using regex to safely extract the color, avoiding JSON.loads errors
                                       match = re.search(r'"peacock\.color"\s*:\s*"([^"]+)"', content)
                                       if match:
                                           color = match.group(1)
                                           break # Stop searching root directories if color is found
                               except Exception as e:
                                   print(f"Error reading {settings_path}: {e}")
                       
                       if color != '#999999':
                           break # Stop searching sub-projects if color is found
               
               response = {"success": True, "color": color}
               self.wfile.write(json.dumps(response).encode('utf-8'))
           else:
               self.wfile.write(b'{"success": False}')

   HTTPServer(('127.0.0.1', 9216), MockServer).serve_forever()
   ```
2. Run it with `python3 server.py`.