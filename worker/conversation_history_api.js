const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
        const utcDate = new Date(dateStr.replace(' ', 'T') + 'Z');
        const diffMs = Date.now() - utcDate.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        
        if (diffSec < 60) return 'now';
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin}m`;
        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return `${diffHours}h`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 30) return `${diffDays}d`;
        const diffMonths = Math.floor(diffDays / 30);
        return `${diffMonths}mo`;
    } catch (e) {
        return '';
    }
}

function extractProjectName(workspaceUrisRaw) {
    if (!workspaceUrisRaw) return 'General';
    try {
        const uris = JSON.parse(workspaceUrisRaw);
        if (Array.isArray(uris) && uris.length > 0) {
            const first = uris[0];
            const clean = decodeURIComponent(first.split('/').filter(Boolean).pop());
            if (clean) return clean;
        }
    } catch (e) {}
    return 'General';
}

function deriveConversationTitle(title, preview) {
    if (title && title.trim() && title !== 'Untitled Conversation') {
        return title.trim();
    }
    if (!preview || !preview.trim()) {
        return 'Untitled Conversation';
    }
    const p = preview.trim();
    // 优先匹配 Task ID (如 Task: bugu_dual_track...)
    const taskMatch = p.match(/(?:Execute\s+)?Task\s+(?:ID:\s*)?([a-zA-Z0-9_\-]+)/i);
    if (taskMatch) {
        return `Task: ${taskMatch[1]}`;
    }
    // 匹配 /goal 意图
    const goalMatch = p.match(/^\/goal\s+([^\r\n]+)/i);
    if (goalMatch) {
        return `/goal ${goalMatch[1].slice(0, 35)}`;
    }
    // 降级取首行前 40 字符
    const firstLine = p.split(/[\r\n]+/)[0].trim();
    return firstLine.slice(0, 45) || 'Untitled Conversation';
}

module.exports = async function(query) {
    const action = query.action || 'list';
    const filter = query.filter || 'all'; // 'all', 'active', 'archived'
    const search = (query.search || '').trim();
    const groupBy = query.groupBy || 'project'; // 'project' or 'none'
    const includeSubagents = query.includeSubagents === 'true';

    const dbPath = path.join(os.homedir(), '.gemini/antigravity/conversation_summaries.db');
    if (!fs.existsSync(dbPath)) {
        return { success: false, error: 'Database conversation_summaries.db not found' };
    }

    if (action === 'list') {
        try {
            let sql = `
                SELECT 
                    cs.conversation_id, 
                    cs.title, 
                    cs.status, 
                    cs.not_fully_idle, 
                    cs.workspace_uris, 
                    datetime(cs.last_modified_time) as last_mod,
                    COALESCE(fts.archived, 0) as archived,
                    REPLACE(REPLACE(SUBSTR(cs.preview, 1, 120), '|', ' '), CHAR(10), ' ') as clean_preview
                FROM conversation_summaries cs
                LEFT JOIN (
                    SELECT conversation_id, MAX(archived) as archived 
                    FROM conversations_fts 
                    GROUP BY conversation_id
                ) fts ON cs.conversation_id = fts.conversation_id
            `;

            const whereClauses = [];

            // 过滤子代理与 CLI 自动化任务会话 (只保留真正的主会话)
            if (!includeSubagents) {
                whereClauses.push("cs.nesting_depth = 0 AND (cs.parent_conversation_id IS NULL OR cs.parent_conversation_id = '') AND (cs.source IS NULL OR cs.source = '' OR cs.source != 'CORTEX_TRAJECTORY_SOURCE_CLI')");
            }

            // 过滤未发言且无内容的空白草稿会话 (避免 untitled 污染历史列表)
            whereClauses.push("NOT ((cs.title IS NULL OR cs.title = '' OR cs.title = 'Untitled Conversation') AND cs.last_user_input_step_index = -1 AND (cs.preview IS NULL OR cs.preview = ''))");

            if (filter === 'active') {
                whereClauses.push('COALESCE(fts.archived, 0) = 0');
            } else if (filter === 'archived') {
                whereClauses.push('COALESCE(fts.archived, 0) = 1');
            }

            if (search) {
                const escapedSearch = search.replace(/'/g, "''");
                whereClauses.push(`(cs.title LIKE '%${escapedSearch}%' OR cs.workspace_uris LIKE '%${escapedSearch}%')`);
            }

            if (whereClauses.length > 0) {
                sql += ' WHERE ' + whereClauses.join(' AND ');
            }

            sql += ' ORDER BY cs.last_modified_time DESC;';

            // Query SQLite
            const output = execSync(`sqlite3 "${dbPath}" "${sql}"`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
                maxBuffer: 10 * 1024 * 1024
            }).trim();

            if (!output) {
                return { success: true, total: 0, groups: [], items: [] };
            }

            const lines = output.split('\n');
            const projectMap = new Map();
            const allItems = [];
            let totalCount = 0;

            for (const line of lines) {
                if (!line.trim()) continue;
                const parts = line.split('|');
                if (parts.length < 7) continue;

                const [conversation_id, rawTitle, status, not_fully_idle, workspace_uris, last_mod, archived, clean_preview] = parts;
                const projectName = extractProjectName(workspace_uris);
                const isRunning = status === 'CASCADE_RUN_STATUS_RUNNING' || not_fully_idle === '1';
                const isArchived = archived === '1';
                const finalTitle = deriveConversationTitle(rawTitle, clean_preview);

                const item = {
                    id: conversation_id,
                    title: finalTitle,
                    project: projectName,
                    isRunning: isRunning,
                    archived: isArchived,
                    lastModTime: last_mod,
                    relativeTime: formatRelativeTime(last_mod)
                };

                allItems.push(item);

                if (!projectMap.has(projectName)) {
                    projectMap.set(projectName, {
                        project: projectName,
                        latestTime: last_mod,
                        conversations: []
                    });
                }
                projectMap.get(projectName).conversations.push(item);
                totalCount++;
            }

            // 统计各项目的 Subagent / CLI 自动化任务会话数量
            let totalSubagentsCount = 0;
            const subagentCountsByProject = new Map();
            try {
                const subagentSql = `
                    SELECT cs.workspace_uris, COUNT(*) as cnt
                    FROM conversation_summaries cs
                    WHERE (cs.source = 'CORTEX_TRAJECTORY_SOURCE_CLI' OR cs.nesting_depth > 0 OR (cs.parent_conversation_id IS NOT NULL AND cs.parent_conversation_id != ''))
                    GROUP BY cs.workspace_uris;
                `;
                const subagentOutput = execSync(`sqlite3 "${dbPath}" "${subagentSql}"`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'ignore']
                }).trim();

                if (subagentOutput) {
                    for (const row of subagentOutput.split('\n')) {
                        if (!row.trim()) continue;
                        const [uris, cntStr] = row.split('|');
                        const pName = extractProjectName(uris);
                        const cnt = parseInt(cntStr, 10) || 0;
                        subagentCountsByProject.set(pName, (subagentCountsByProject.get(pName) || 0) + cnt);
                        totalSubagentsCount += cnt;
                    }
                }
            } catch (e) {}

            const groups = Array.from(projectMap.values()).map(g => ({
                project: g.project,
                count: g.conversations.length,
                subagentCount: subagentCountsByProject.get(g.project) || 0,
                latestTime: g.latestTime,
                conversations: g.conversations
            }));

            return {
                success: true,
                total: totalCount,
                totalSubagents: totalSubagentsCount,
                groupBy,
                groups,
                items: allItems
            };

        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    if (action === 'archive' || action === 'unarchive') {
        const uuid = query.uuid;
        if (!uuid) return { success: false, error: 'Missing uuid' };
        const newArchivedVal = action === 'archive' ? '1' : '0';
        try {
            // 更新 FTS 搜索表中的归档标记
            const updateSql = `UPDATE conversations_fts SET archived = '${newArchivedVal}' WHERE conversation_id = '${uuid}';`;
            execSync(`sqlite3 "${dbPath}" "${updateSql}"`, { stdio: ['pipe', 'pipe', 'ignore'] });

            // 若执行归档，顺便触发 brain 的浅层压缩清理与 archive_index.json 同步
            if (action === 'archive') {
                const title = query.title || '';
                const project = query.project || '';
                try {
                    const scriptPath = path.join(__dirname, '..', 'web', 'agy_archive.js');
                    if (fs.existsSync(scriptPath)) {
                        const titleB64 = Buffer.from(title).toString('base64');
                        const projectB64 = Buffer.from(project).toString('base64');
                        execSync(`node "${scriptPath}" clean --shallow ${uuid} "${titleB64}" "${projectB64}"`, { stdio: ['pipe', 'pipe', 'ignore'] });
                    }
                } catch (e) {
                    console.warn('[Archive] shallow clean warning:', e.message);
                }
            }

            return { success: true, action, uuid };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    if (action === 'delete') {
        const uuid = query.uuid;
        if (!uuid) return { success: false, error: 'Missing uuid' };
        try {
            // 1. 删除前执行深层归档备份，确保脑目录数据被 tarball 安全归档保存，不会永久丢失
            const title = query.title || '';
            const project = query.project || '';
            try {
                const scriptPath = path.join(__dirname, '..', 'web', 'agy_archive.js');
                if (fs.existsSync(scriptPath)) {
                    const titleB64 = Buffer.from(title).toString('base64');
                    const projectB64 = Buffer.from(project).toString('base64');
                    execSync(`node "${scriptPath}" clean --deep ${uuid} "${titleB64}" "${projectB64}"`, { stdio: ['pipe', 'pipe', 'ignore'] });
                }
            } catch (e) {
                console.warn('[Delete] deep archive backup warning:', e.message);
            }

            // 2. 从官方 SQLite 数据库中移除该会话记录
            const deleteSql = `
                DELETE FROM conversation_summaries WHERE conversation_id = '${uuid}';
                DELETE FROM conversations_fts WHERE conversation_id = '${uuid}';
            `;
            execSync(`sqlite3 "${dbPath}" "${deleteSql}"`, { stdio: ['pipe', 'pipe', 'ignore'] });

            return { success: true, action: 'delete', uuid };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    if (action === 'cleanup_empty') {
        try {
            // 查找所有无标题、未产生实际发言且无预览的空白草稿会话
            const selectSql = `
                SELECT conversation_id 
                FROM conversation_summaries 
                WHERE (title IS NULL OR title = '' OR title = 'Untitled Conversation')
                  AND last_user_input_step_index = -1 
                  AND (preview IS NULL OR preview = '');
            `;
            const rawOutput = execSync(`sqlite3 "${dbPath}" "${selectSql}"`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();

            if (!rawOutput) {
                return { success: true, cleanedCount: 0 };
            }

            const ids = rawOutput.split('\n').map(id => id.trim()).filter(Boolean);
            if (ids.length === 0) {
                return { success: true, cleanedCount: 0 };
            }

            // 批量从 SQLite 数据库移除孤立记录
            const quotedIds = ids.map(id => `'${id}'`).join(',');
            const deleteSql = `
                DELETE FROM conversation_summaries WHERE conversation_id IN (${quotedIds});
                DELETE FROM conversations_fts WHERE conversation_id IN (${quotedIds});
            `;
            execSync(`sqlite3 "${dbPath}" "${deleteSql}"`, { stdio: ['pipe', 'pipe', 'ignore'] });

            // 安全清理对应的 brain 空目录
            const brainBasePath = path.join(os.homedir(), '.gemini/antigravity/brain');
            let cleanedDirs = 0;
            for (const id of ids) {
                const convBrainDir = path.join(brainBasePath, id);
                try {
                    if (fs.existsSync(convBrainDir)) {
                        const files = fs.readdirSync(convBrainDir);
                        const isSafeToDelete = files.length === 0 || 
                            (files.length === 1 && files[0] === '.user_uploaded' && fs.readdirSync(path.join(convBrainDir, '.user_uploaded')).length === 0);
                        if (isSafeToDelete) {
                            fs.rmSync(convBrainDir, { recursive: true, force: true });
                            cleanedDirs++;
                        }
                    }
                } catch (e) {}
            }

            // 自动回填带有 preview 但尚未命名（或无标题）的会话，杜绝出现 untitled 脏记录
            try {
                const unTitledSql = `
                    SELECT conversation_id, REPLACE(REPLACE(SUBSTR(preview, 1, 120), '|', ' '), CHAR(10), ' ')
                    FROM conversation_summaries
                    WHERE (title IS NULL OR title = '' OR title = 'Untitled Conversation')
                      AND preview IS NOT NULL AND TRIM(preview) != '';
                `;
                const unTitledRows = execSync(`sqlite3 "${dbPath}" "${unTitledSql}"`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'ignore']
                }).trim();
                if (unTitledRows) {
                    for (const row of unTitledRows.split('\n')) {
                        const [cid, prev] = row.split('|');
                        if (cid && prev) {
                            const derived = deriveConversationTitle('', prev);
                            if (derived && derived !== 'Untitled Conversation') {
                                const escaped = derived.replace(/'/g, "''");
                                execSync(`sqlite3 "${dbPath}" "UPDATE conversation_summaries SET title = '${escaped}' WHERE conversation_id = '${cid}'; UPDATE conversations_fts SET title = '${escaped}' WHERE conversation_id = '${cid}';"`, { stdio: ['pipe', 'pipe', 'ignore'] });
                            }
                        }
                    }
                }
            } catch (e) {}

            return { success: true, action: 'cleanup_empty', cleanedCount: ids.length, cleanedDirs };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    if (action === 'clean_subagents') {
        try {
            // 1. 同步从本地 SQLite 数据库彻底移除 subagent / CLI 自动化任务记录
            const deleteSubagentsSql = `
                DELETE FROM conversation_summaries WHERE (source = 'CORTEX_TRAJECTORY_SOURCE_CLI' OR nesting_depth > 0 OR (parent_conversation_id IS NOT NULL AND parent_conversation_id != ''));
                DELETE FROM conversations_fts WHERE conversation_id NOT IN (SELECT conversation_id FROM conversation_summaries);
            `;
            execSync(`sqlite3 "${dbPath}" "${deleteSubagentsSql}"`, { stdio: ['pipe', 'pipe', 'ignore'] });

            // 2. 同步清理 PVE 远程服务器上的数据库记录，避免 Mutagen 双向同步将其重新拉回 Mac
            try {
                execSync(`ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no Antigravity 'python3 -c "import sqlite3, os; conn=sqlite3.connect(os.path.expanduser(\\"~/.gemini/antigravity/conversation_summaries.db\\")); conn.execute(\\"DELETE FROM conversation_summaries WHERE (source = \\x27CORTEX_TRAJECTORY_SOURCE_CLI\\x27 OR nesting_depth > 0 OR (parent_conversation_id IS NOT NULL AND parent_conversation_id != \\x27\\x27))\\"); conn.commit()"'`, {
                    stdio: ['ignore', 'ignore', 'ignore'],
                    timeout: 5000
                });
            } catch (pveErr) {
                console.warn('[clean_subagents] PVE remote sync cleanup warning:', pveErr.message);
            }

            // 3. 运行本地 subagent 文件物理清理脚本
            const scriptPath = path.join(os.homedir(), '.gemini/config/scripts/clean_subagents.py');
            let stdout = '';
            if (fs.existsSync(scriptPath)) {
                const excludeArg = query.exclude ? `--exclude "${query.exclude}"` : '';
                try {
                    stdout = execSync(`python3 "${scriptPath}" ${excludeArg}`, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 30000
                    });
                } catch (scriptErr) {
                    stdout = scriptErr.stdout || scriptErr.message;
                }
            }

            return { success: true, action: 'clean_subagents', stdout, message: 'Subagents successfully cleaned on Mac and PVE' };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    return { success: false, error: `Unknown action: ${action}` };
};
