# DIY Mock Server (Node.js)

**Using Node.js (Quick & Easy):**

1. Initialize a new folder and install dependencies:
   ```bash
   npm init -y
   npm install express cors
   ```
2. Create a `server.js` file:
   ```javascript
   const express = require('express');
   const cors = require('cors');
   const fs = require('fs');
   const path = require('path');
   const app = express();

   app.use(cors());

   // Configuration: Add the absolute paths to the directories where your projects are stored
   const PROJECT_ROOTS = [
       '/Users/YourName/Projects',
       '/Users/YourName/Documents',
       '/Users/YourName/workbench'
   ];

   app.get('/api/script/antigravity_theme_sync', (req, res) => {
       const projectParam = req.query.project;
       let color = '#999999'; // Default fallback color
       
       if (projectParam) {
           // 1. Handle VS Code Multi-Root Workspaces (comma-separated names)
           const subProjects = projectParam.split(',').map(p => p.trim()).filter(Boolean);
           
           for (const project of subProjects) {
               for (const root of PROJECT_ROOTS) {
                   let settingsPath = path.join(root, project, '.vscode', 'settings.json');
                   
                   // 2. Exact Match Check
                   if (!fs.existsSync(settingsPath)) {
                       // 3. Fallback: Fuzzy Match (find directory containing the name)
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

                   // If we found a valid settings file, extract the color
                   if (fs.existsSync(settingsPath)) {
                       try {
                           const content = fs.readFileSync(settingsPath, 'utf8');
                           // Using regex to safely extract the color, avoiding JSON.parse errors due to comments
                           const match = content.match(/"peacock\.color"\s*:\s*"([^"]+)"/);
                           if (match) {
                               color = match[1];
                               break; // Stop searching root directories if color is found
                           }
                       } catch (e) {
                           console.error(`Error reading settings for ${project}:`, e);
                       }
                   }
               }
               if (color !== '#999999') break; // Stop searching sub-projects if color is found
           }
       }

       res.json({ success: true, color: color });
   });

   app.listen(9216, '127.0.0.1', () => console.log('Mock server running on port 9216!'));
   ```
3. Run it with `node server.js`.