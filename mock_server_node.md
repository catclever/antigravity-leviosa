# DIY Mock Server (Node.js)

**Using Node.js (Quick & Easy):**

Because the repository's backend logic has been restructured into modular async functions in the `worker` directory, building a mock server is now incredibly simple. You just need an Express server to route requests directly to these worker scripts!

1. Inside the downloaded repository folder (the one containing the `apps` directory), initialize a new project and install dependencies:
   ```bash
   npm init -y
   npm install express cors
   ```
2. Create a `server.js` file in the same directory:
   ```javascript
   const express = require('express');
   const cors = require('cors');
   const path = require('path');
   const app = express();

   app.use(cors());

   // Serve static UI scripts from the web directory
   app.use('/src/apps/com.google.antigravity/web', express.static(path.join(__dirname, 'apps/com.google.antigravity/web')));

   // Route API requests to the worker modules
   app.get('/api/script/apps/com.google.antigravity/worker/:scriptName', async (req, res) => {
       try {
           const scriptPath = path.join(__dirname, 'apps/com.google.antigravity/worker', req.params.scriptName + '.js');
           
           // Dynamically require the worker script
           const workerModule = require(scriptPath);
           
           // Execute the exported async function with the query parameters
           const result = await workerModule(req.query);
           
           // Return the JSON response
           res.json(result);
       } catch (e) {
           console.error(`Error executing ${req.params.scriptName}:`, e);
           res.status(500).json({ success: false, error: e.message });
       }
   });

   app.listen(9216, '127.0.0.1', () => console.log('Mock server running on port 9216!'));
   ```
3. Run it with `node server.js`.