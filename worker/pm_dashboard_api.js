const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = async function(query) {
    const action = query.action;
    const rawProjectName = query.project || 'antigravity-leviosa';
    
    // 解析真实的项目目录 (包含模糊匹配 taichi_launcher -> taichi 的逻辑)
    const projectsRoot = path.join(os.homedir(), '.gemini/Projects');
    let targetDir = path.join(projectsRoot, rawProjectName);
    
    if (!fs.existsSync(targetDir) && fs.existsSync(projectsRoot)) {
        const dirs = fs.readdirSync(projectsRoot);
        const fuzzy = dirs.find(d => {
            const a = rawProjectName.toLowerCase();
            const b = d.toLowerCase();
            return a.startsWith(b) || b.startsWith(a);
        });
        if (fuzzy) {
            targetDir = path.join(projectsRoot, fuzzy);
        }
    }

    const tasksDir = path.join(targetDir, 'tasks');
    
    if (action === 'get_tasks') {
        if (!fs.existsSync(tasksDir)) {
            return { success: true, tasks: [], path: tasksDir };
        }
        
        const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md'));
        const tasks = [];
        
        for (const file of files) {
            try {
                const content = fs.readFileSync(path.join(tasksDir, file), 'utf-8');
                const parts = content.split('---');
                if (parts.length >= 3) {
                    const frontmatterText = parts[1];
                    let title = "Unknown", status = "backlog", priority = "low", tags = [];
                    
                    const lines = frontmatterText.split('\n');
                    let inTags = false;
                    for (let line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.length === 0) continue;
                        
                        if (!line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('-')) {
                            inTags = false;
                        }
                        
                        if (line.startsWith('title:')) {
                            title = line.substring(6).trim().replace(/^['"]|['"]$/g, '');
                        } else if (line.startsWith('status:')) {
                            status = line.substring(7).trim().toLowerCase();
                        } else if (line.startsWith('priority:')) {
                            priority = line.substring(9).trim().toLowerCase();
                        } else if (line.startsWith('tags:')) {
                            inTags = true;
                            let inlineTags = line.substring(5).trim().replace(/[\[\]]/g, '');
                            if (inlineTags) {
                                tags = inlineTags.split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
                                inTags = false;
                            }
                        } else if (inTags && trimmed.startsWith('-')) {
                            tags.push(trimmed.substring(1).trim().replace(/^['"]|['"]$/g, ''));
                        }
                    }
                    
                    const body = parts.slice(2).join('---').trim();
                    tasks.push({ id: file, title, status, priority, tags, filePath: path.join(tasksDir, file), body });
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
        return { success: true, tasks, path: tasksDir };
    }
    
    // 全新接口：一键完成任务
    if (action === 'complete_task') {
        const taskId = query.task;
        if (!taskId) return { success: false, error: 'No task id' };
        
        const taskPath = path.join(tasksDir, taskId);
        if (fs.existsSync(taskPath)) {
            try {
                let content = fs.readFileSync(taskPath, 'utf-8');
                // 正则替换 status 字段为 completed
                content = content.replace(/^status:\s*.*$/m, 'status: completed');
                fs.writeFileSync(taskPath, content, 'utf-8');
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: 'Task not found' };
    }
    
    // 全新接口：放弃/删除任务 (直接删除对应的 Markdown 文件)
    if (action === 'abandon_task' || action === 'delete_task') {
        const taskId = query.task;
        if (!taskId) return { success: false, error: 'No task id' };
        
        const safeTaskId = path.basename(taskId);
        const taskPath = path.join(tasksDir, safeTaskId);
        if (fs.existsSync(taskPath)) {
            try {
                fs.unlinkSync(taskPath);
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: 'Task not found' };
    }
    
    // 全新接口：使用 Qled 打开任务 Markdown 文件
    if (action === 'open_task' || action === 'open_qled') {
        const taskId = query.task;
        if (!taskId) return { success: false, error: 'No task id' };
        
        const safeTaskId = path.basename(taskId);
        const taskPath = path.join(tasksDir, safeTaskId);
        if (fs.existsSync(taskPath)) {
            const { exec } = require('child_process');
            exec(`open "qled://open?path=${encodeURI(taskPath)}"`, (err) => {
                if (err) console.error('[pm_dashboard_api] open qled error:', err);
            });
            return { success: true, path: taskPath };
        }
        return { success: false, error: 'Task not found' };
    }
    
    return { success: false, error: 'Unknown action' };
};
