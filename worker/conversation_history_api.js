const { execSync, execFileSync, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

function isValidUuid(id) {
    return typeof id === 'string' && /^[a-f0-9][a-f0-9\-]{3,63}$/i.test(id) && id.includes('-');
}

function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    try {
        const normalized = String(dateStr).trim();
        const isoStr = normalized.includes('T')
            ? (/[zZ]|[+\-]\d{2}:?\d{2}$/.test(normalized) ? normalized : normalized + 'Z')
            : normalized.replace(' ', 'T') + 'Z';
        const utcDate = new Date(isoStr);
        if (isNaN(utcDate.getTime())) return '';
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

function formatIsoToSqliteUtc(isoStr) {
    if (!isoStr) return '1970-01-01 00:00:00';
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '1970-01-01 00:00:00';
        return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
    } catch (e) {
        return '1970-01-01 00:00:00';
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

function runArchiveJsonAsync(scriptPath, args) {
    return new Promise((resolve) => {
        execFile(process.execPath, [scriptPath, ...args], {
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 610000
        }, (error, stdout, stderr) => {
            const trimmed = (stdout || '').trim();
            if (trimmed) {
                try {
                    resolve(JSON.parse(trimmed));
                    return;
                } catch (e) {
                    if (!error) {
                        resolve({ success: false, error: 'Failed to parse agy_archive JSON output', output: stdout, stderr });
                        return;
                    }
                }
            }
            if (error) {
                resolve({ success: false, error: error.message, stderr });
            } else {
                resolve({ success: false, error: 'Empty output from agy_archive.js', stderr });
            }
        });
    });
}

module.exports = async function(query) {
    const action = query.action || 'list';
    const filter = query.filter || 'all'; // 'all', 'active', 'archived'
    const search = (query.search || '').trim();
    const groupBy = query.groupBy || 'project'; // 'project' or 'none'
    const includeSubagents = query.includeSubagents === 'true';

    const workspaceRoot = process.env.AGY_WORKSPACE_ROOT || path.join(os.homedir(), '.gemini/antigravity');
    const dbPath = path.join(workspaceRoot, 'conversation_summaries.db');
    const archiveScriptPath = process.env.AGY_ARCHIVE_SCRIPT_PATH || path.join(__dirname, '..', 'web', 'agy_archive.js');
    const archivesIndexPath = process.env.AGY_ARCHIVES_INDEX || (
        process.env.AGY_ARCHIVES_DIR
            ? path.join(process.env.AGY_ARCHIVES_DIR, 'archive_index.json')
            : path.join(__dirname, '..', 'web', 'archives', 'archive_index.json')
    );

    if (action === 'restore_deep') {
        const uuid = query.uuid ? decodeURIComponent(query.uuid) : '';
        if (!uuid) return { success: false, error: 'Missing uuid' };
        if (!/^[a-f0-9\-]+$/i.test(uuid)) return { success: false, error: 'Invalid uuid format' };
        if (!fs.existsSync(archiveScriptPath)) {
            return { success: false, error: `Archive script not found at ${archiveScriptPath}` };
        }
        const res = await runArchiveJsonAsync(archiveScriptPath, ['restore', uuid, '--json']);
        return { action: 'restore_deep', ...res };
    }

    if (action === 'get_storage_config') {
        if (!fs.existsSync(archiveScriptPath)) {
            return { success: false, error: `Archive script not found at ${archiveScriptPath}` };
        }
        const res = await runArchiveJsonAsync(archiveScriptPath, ['config', '--json']);
        return { action: 'get_storage_config', ...res };
    }

    if (action === 'set_storage_config') {
        if (!fs.existsSync(archiveScriptPath)) {
            return { success: false, error: `Archive script not found at ${archiveScriptPath}` };
        }
        const rcloneDest = query.rcloneDest !== undefined ? decodeURIComponent(query.rcloneDest) : '';
        const pveHost = query.pveHost !== undefined ? decodeURIComponent(query.pveHost) : '';
        const enabled = query.enabled !== undefined ? (query.enabled === 'true' || query.enabled === true) : Boolean(rcloneDest);
        const args = ['config', 'set', rcloneDest, pveHost, String(enabled), '--json'];
        const res = await runArchiveJsonAsync(archiveScriptPath, args);
        return { action: 'set_storage_config', ...res };
    }

    if (action === 'offload_archives') {
        if (!fs.existsSync(archiveScriptPath)) {
            return { success: false, error: `Archive script not found at ${archiveScriptPath}` };
        }
        const uuid = query.uuid ? decodeURIComponent(query.uuid) : '';
        const offloadAll = query.all === true || query.all === 'true' || !uuid || uuid === '--all';
        if (!offloadAll && !/^[a-f0-9\-]+$/i.test(uuid)) {
            return { success: false, error: 'Invalid uuid format' };
        }
        const args = offloadAll ? ['offload', '--all', '--json'] : ['offload', uuid, '--json'];
        const res = await runArchiveJsonAsync(archiveScriptPath, args);
        return { action: 'offload_archives', ...res };
    }

    if (action === 'auto_lifecycle') {
        if (!fs.existsSync(archiveScriptPath)) {
            return { success: false, error: `Archive script not found at ${archiveScriptPath}` };
        }
        const args = ['lifecycle', '--json'];
        if (query.dryRun === 'true' || query.dryRun === true) {
            args.push('--dry-run');
        }
        if (query.force === 'true' || query.force === true) {
            args.push('--force');
        }
        if (query.noAutoOffload === 'true' || query.noAutoOffload === true) {
            args.push('--no-auto-offload');
        }
        if (query.shallowDays !== undefined && query.shallowDays !== '' && !isNaN(Number(query.shallowDays))) {
            args.push('--shallow-days', String(Number(query.shallowDays)));
        }
        if (query.deepDays !== undefined && query.deepDays !== '' && !isNaN(Number(query.deepDays))) {
            args.push('--deep-days', String(Number(query.deepDays)));
        }
        if (query.currentUuid && /^[a-f0-9\-]+$/i.test(String(query.currentUuid))) {
            args.push('--current-uuid', String(query.currentUuid));
        }
        const res = await runArchiveJsonAsync(archiveScriptPath, args);
        return { action: 'auto_lifecycle', ...res };
    }

    if (!fs.existsSync(dbPath)) {
        return { success: false, error: 'Database conversation_summaries.db not found' };
    }

    /*
     * [Bug Fix Document - Task 073]
     * 1. Problem: Previously, `action === 'list'` returned early (`{ total: 0, groups: [], items: [] }`)
     *    whenever SQLite returned 0 rows (e.g. `filter === 'archived'` when all archived items had been
     *    deep-archived and purged from SQLite), and never surfaced cold-archived conversations stored in
     *    `archive_index.json` / `alist:115`.
     * 2. Method:
     *    - Query `allDbUuidSet` across `conversation_summaries` so we know definitively which indexed
     *      deep archives are no longer in SQLite (`coldArchived: true`).
     *    - Do not return early on empty SQLite output; when `filter === 'all' || filter === 'archived'`,
     *      merge cold-archived records from `archivesIndexPath`, apply search filtering, and sort all items
     *      and project groups chronologically descending by `lastModTime`.
     * 3. Caveat:
     *    - Validate every key in `archive_index.json` with `isValidUuid` before merging so non-UUID keys
     *      (if ever introduced) can never pollute conversation lists.
     */
    if (action === 'list') {
        try {
            let sql = `
                SELECT 
                    cs.conversation_id, 
                    REPLACE(REPLACE(COALESCE(cs.title, ''), '|', ' '), CHAR(10), ' ') as clean_title, 
                    COALESCE(cs.status, '') as status, 
                    COALESCE(CAST(cs.not_fully_idle AS TEXT), '0') as not_fully_idle, 
                    REPLACE(COALESCE(cs.workspace_uris, ''), '|', ' ') as workspace_uris, 
                    datetime(cs.last_modified_time) as last_mod,
                    COALESCE(fts.archived, 0) as archived,
                    REPLACE(REPLACE(SUBSTR(COALESCE(cs.preview, ''), 1, 120), '|', ' '), CHAR(10), ' ') as clean_preview
                FROM conversation_summaries cs
                LEFT JOIN (
                    SELECT conversation_id, MAX(CAST(archived AS INTEGER)) as archived 
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
                whereClauses.push(`(cs.title LIKE '%${escapedSearch}%' OR cs.workspace_uris LIKE '%${escapedSearch}%' OR cs.conversation_id LIKE '%${escapedSearch}%')`);
            }

            if (whereClauses.length > 0) {
                sql += ' WHERE ' + whereClauses.join(' AND ');
            }

            sql += ' ORDER BY cs.last_modified_time DESC;';

            // Query SQLite safely via execFileSync (no shell interpolation)
            const output = execFileSync('sqlite3', [dbPath, sql], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore'],
                maxBuffer: 10 * 1024 * 1024
            }).trim();

            // Query complete set of UUIDs present in conversation_summaries to distinguish cold-purged items
            const allDbUuidSet = new Set();
            try {
                const allIdsRaw = execFileSync('sqlite3', [dbPath, 'SELECT conversation_id FROM conversation_summaries;'], {
                    encoding: 'utf-8',
                    stdio: ['ignore', 'pipe', 'ignore'],
                    maxBuffer: 10 * 1024 * 1024
                }).trim();
                if (allIdsRaw) {
                    for (const rawId of allIdsRaw.split(/\r?\n/)) {
                        const cleanId = rawId.trim();
                        if (cleanId) allDbUuidSet.add(cleanId.toLowerCase());
                    }
                }
            } catch (e) {}

            const projectMap = new Map();
            const allItems = [];
            let totalCount = 0;
            let totalColdArchived = 0;

            if (output) {
                const lines = output.split(/\r?\n/);
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const parts = line.split('|');
                    if (parts.length < 7) continue;

                    const [conversation_id, rawTitle, status, not_fully_idle, workspace_uris, last_mod, archived, clean_preview] = parts;
                    const projectName = extractProjectName(workspace_uris);
                    const isRunning = status === 'CASCADE_RUN_STATUS_RUNNING' || not_fully_idle === '1';
                    const isArchived = String(archived).trim() === '1';
                    const finalTitle = deriveConversationTitle(rawTitle, clean_preview);

                    const item = {
                        id: conversation_id,
                        title: finalTitle,
                        project: projectName,
                        isRunning: isRunning,
                        archived: isArchived,
                        coldArchived: false,
                        localEvicted: false,
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
            }

            // Merge cold-archived conversations from archive_index.json when filter === 'all' || filter === 'archived'
            if ((filter === 'all' || filter === 'archived') && fs.existsSync(archivesIndexPath)) {
                try {
                    const archiveIndex = JSON.parse(fs.readFileSync(archivesIndexPath, 'utf-8'));
                    if (archiveIndex && typeof archiveIndex === 'object') {
                        const searchLower = search ? search.toLowerCase() : '';
                        for (const [uuid, entry] of Object.entries(archiveIndex)) {
                            if (!isValidUuid(uuid)) continue;
                            if (!entry || typeof entry !== 'object' || !entry.deepArchive) continue;
                            if (allDbUuidSet.has(uuid.toLowerCase())) continue;

                            const rawTitle = (entry.title && entry.title !== 'Unknown Title' && entry.title !== 'Unknown')
                                ? String(entry.title).trim()
                                : (entry.sqliteMeta && entry.sqliteMeta.title ? String(entry.sqliteMeta.title).trim() : '');
                            const title = rawTitle || ('Cold Archive (' + uuid.slice(0, 8) + ')');

                            const project = (entry.project && entry.project !== 'Unknown Project' && entry.project !== 'Unknown')
                                ? String(entry.project).trim()
                                : (entry.sqliteMeta && entry.sqliteMeta.workspace_uris
                                    ? extractProjectName(entry.sqliteMeta.workspace_uris)
                                    : 'General');

                            if (searchLower) {
                                const hit = title.toLowerCase().includes(searchLower)
                                    || project.toLowerCase().includes(searchLower)
                                    || uuid.toLowerCase().includes(searchLower);
                                if (!hit) continue;
                            }

                            const lastMod = formatIsoToSqliteUtc(entry.deepArchive.timestamp);
                            const localEvicted = Boolean(entry.deepArchive.localEvicted);
                            const coldItem = {
                                id: uuid,
                                title,
                                project,
                                isRunning: false,
                                archived: true,
                                coldArchived: true,
                                localEvicted,
                                storage: entry.deepArchive.storage || (localEvicted ? 'cloud' : 'local'),
                                sizeBytes: entry.deepArchive.sizeBytes || 0,
                                lastModTime: lastMod,
                                relativeTime: formatRelativeTime(lastMod)
                            };

                            allItems.push(coldItem);

                            if (!projectMap.has(project)) {
                                projectMap.set(project, {
                                    project,
                                    latestTime: lastMod,
                                    conversations: []
                                });
                            }
                            projectMap.get(project).conversations.push(coldItem);
                            totalCount++;
                            totalColdArchived++;
                        }
                    }
                } catch (e) {
                    // Non-fatal if archive_index.json is temporarily unreadable
                }
            }

            if (allItems.length === 0) {
                return {
                    success: true,
                    total: 0,
                    totalColdArchived: 0,
                    totalSubagents: 0,
                    groupBy,
                    groups: [],
                    items: []
                };
            }

            // Sort merged items & project groups chronologically descending by lastModTime
            allItems.sort((a, b) => String(b.lastModTime || '').localeCompare(String(a.lastModTime || '')));
            for (const g of projectMap.values()) {
                g.conversations.sort((a, b) => String(b.lastModTime || '').localeCompare(String(a.lastModTime || '')));
                if (g.conversations.length > 0) {
                    g.latestTime = g.conversations[0].lastModTime;
                }
            }

            // 统计各项目的 Subagent / CLI 自动化任务会话数量
            let totalSubagentsCount = 0;
            const subagentCountsByProject = new Map();
            try {
                const subagentSql = `
                    SELECT cs.workspace_uris, COUNT(*) as cnt
                    FROM conversation_summaries cs
                    WHERE (cs.source = 'CORTEX_TRAJECTORY_SOURCE_CLI' OR cs.nesting_depth > 0 OR (cs.parent_conversation_id IS NOT NULL AND parent_conversation_id != ''))
                    GROUP BY cs.workspace_uris;
                `;
                const subagentOutput = execFileSync('sqlite3', [dbPath, subagentSql], {
                    encoding: 'utf-8',
                    stdio: ['ignore', 'pipe', 'ignore']
                }).trim();

                if (subagentOutput) {
                    for (const row of subagentOutput.split(/\r?\n/)) {
                        if (!row.trim()) continue;
                        const [uris, cntStr] = row.split('|');
                        const pName = extractProjectName(uris);
                        const cnt = parseInt(cntStr, 10) || 0;
                        subagentCountsByProject.set(pName, (subagentCountsByProject.get(pName) || 0) + cnt);
                        totalSubagentsCount += cnt;
                    }
                }
            } catch (e) {}

            const groups = Array.from(projectMap.values())
                .map(g => ({
                    project: g.project,
                    count: g.conversations.length,
                    subagentCount: subagentCountsByProject.get(g.project) || 0,
                    latestTime: g.latestTime,
                    conversations: g.conversations
                }))
                .sort((a, b) => String(b.latestTime || '').localeCompare(String(a.latestTime || '')));

            return {
                success: true,
                total: totalCount,
                totalColdArchived,
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
        if (!/^[a-f0-9\-]+$/i.test(uuid)) return { success: false, error: 'Invalid uuid format' };
        const newArchivedVal = action === 'archive' ? '1' : '0';
        try {
            const escapedUuid = uuid.replace(/'/g, "''");
            const cntOut = execFileSync('sqlite3', [dbPath, `SELECT COUNT(*) FROM conversations_fts WHERE conversation_id = '${escapedUuid}';`], {
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'ignore']
            }).trim();
            const rowCount = parseInt(cntOut, 10) || 0;

            if (rowCount > 0) {
                const updateSql = `UPDATE conversations_fts SET archived = '${newArchivedVal}' WHERE conversation_id = '${escapedUuid}';`;
                execFileSync('sqlite3', [dbPath, updateSql], { stdio: ['ignore', 'pipe', 'ignore'] });
            } else {
                const nowUtc = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
                const escapedTitle = String(query.title || '').replace(/'/g, "''");
                const escapedProject = String(query.project || '').replace(/'/g, "''");
                const insertSql = `INSERT INTO conversations_fts (conversation_id, chunk_index, chunk_first_step, chunk_last_step, last_modified_time, step_count, last_step_created_at, archived, user_step_byte_offsets, agent_step_byte_offsets, title, workspace, project, user_body, agent_body) VALUES ('${escapedUuid}', 0, 0, 1, '${nowUtc}', 1, '${nowUtc}', '${newArchivedVal}', '', '', '${escapedTitle}', '', '${escapedProject}', '', '');`;
                execFileSync('sqlite3', [dbPath, insertSql], { stdio: ['ignore', 'pipe', 'ignore'] });
            }

            // 若执行归档，顺便触发 brain 的浅层压缩清理与 archive_index.json 同步
            if (action === 'archive') {
                const title = query.title || '';
                const project = query.project || '';
                try {
                    if (fs.existsSync(archiveScriptPath)) {
                        const titleB64 = Buffer.from(title).toString('base64');
                        const projectB64 = Buffer.from(project).toString('base64');
                        execFileSync(process.execPath, [archiveScriptPath, 'clean', '--shallow', uuid, titleB64, projectB64], {
                            env: process.env,
                            stdio: ['pipe', 'pipe', 'ignore']
                        });
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

    /*
     * [Bug Fix Document]
     * 1. Problem: Previously, `action === 'delete'` in History View invoked `agy_archive.js clean --deep`
     *    without `--purge-parent` (and swallowed failures), leaving behind orphaned `brain/<uuid>`,
     *    `conversations/<uuid>.pb`, spawned subagents, `/tmp` task execution logs, remote `Antigravity`
     *    SQLite rows, and un-offloaded local deep tarballs.
     * 2. Method: Invoke `agy_archive.js clean --deep <uuid> "<titleB64>" "<projectB64>" --purge-parent`
     *    so History View deletion atomically packages the deep tarball, cascades cleanup across all
     *    descendant subagents + `.pb` + `brain/` + `/tmp` logs + local/remote SQLite, and spawns
     *    background auto-offload to `alist:115`.
     * 3. Caveat: If `agy_archive.js` fails while archiving existing local parent files (e.g. disk full),
     *    `delete` aborts and returns `{ success: false }` rather than deleting SQLite rows without backup.
     */
    if (action === 'delete') {
        const uuid = query.uuid;
        if (!uuid) return { success: false, error: 'Missing uuid' };
        if (!/^[a-f0-9\-]+$/i.test(uuid)) return { success: false, error: 'Invalid uuid format' };
        try {
            const title = query.title || '';
            const project = query.project || '';
            if (!fs.existsSync(archiveScriptPath)) {
                return { success: false, error: `Archive script not found at ${archiveScriptPath}` };
            }

            const titleB64 = Buffer.from(title).toString('base64');
            const projectB64 = Buffer.from(project).toString('base64');
            const cleanArgs = [archiveScriptPath, 'clean', '--deep', uuid, titleB64, projectB64, '--purge-parent'];
            if (query.noAutoOffload === true || query.noAutoOffload === 'true') {
                cleanArgs.push('--no-auto-offload');
            }

            execFileSync(process.execPath, cleanArgs, {
                env: process.env,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe']
            });

            // Idempotent safeguard to ensure parent rows are removed from local SQLite
            const escapedUuid = uuid.replace(/'/g, "''");
            const deleteSql = `
                DELETE FROM conversation_summaries WHERE conversation_id = '${escapedUuid}';
                DELETE FROM conversations_fts WHERE conversation_id = '${escapedUuid}';
            `;
            execFileSync('sqlite3', [dbPath, deleteSql], { stdio: ['ignore', 'pipe', 'ignore'] });

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
            const brainBasePath = path.join(workspaceRoot, 'brain');
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
            // 时间过滤与运行保护：
            // 1. 支持按时间过滤 (默认保留最近 1.0 小时内活跃的 subagent)
            // 2. 处于非空闲状态 (not_fully_idle = '1' 或 status = 'CASCADE_RUN_STATUS_RUNNING') 的子代理一律强制保护不删除
            const minAgeHours = (query.minAgeHours !== undefined && query.minAgeHours !== null && !isNaN(parseFloat(query.minAgeHours)))
                ? parseFloat(query.minAgeHours)
                : 1.0;
            const minutesOffset = Math.max(0, Math.round(minAgeHours * 60));

            const timeCondition = minAgeHours > 0
                ? `AND datetime(last_modified_time) < datetime('now', '-${minutesOffset} minutes') AND (not_fully_idle IS NULL OR not_fully_idle != '1') AND (status IS NULL OR status != 'CASCADE_RUN_STATUS_RUNNING')`
                : `AND (not_fully_idle IS NULL OR not_fully_idle != '1') AND (status IS NULL OR status != 'CASCADE_RUN_STATUS_RUNNING')`;

            // 1. 同步从本地 SQLite 数据库移除过期且非活跃的 subagent / CLI 自动化任务记录
            const deleteSubagentsSql = `
                DELETE FROM conversation_summaries 
                WHERE (source = 'CORTEX_TRAJECTORY_SOURCE_CLI' OR nesting_depth > 0 OR (parent_conversation_id IS NOT NULL AND parent_conversation_id != ''))
                ${timeCondition};
                DELETE FROM conversations_fts WHERE conversation_id NOT IN (SELECT conversation_id FROM conversation_summaries);
            `;
            execSync(`sqlite3 "${dbPath}" "${deleteSubagentsSql}"`, { stdio: ['pipe', 'pipe', 'ignore'] });

            // 2. 同步清理 PVE 远程服务器上的过期数据库记录，避免 Mutagen 双向同步将其重新拉回 Mac
            if (process.env.AGY_SKIP_REMOTE_SYNC !== '1') {
                try {
                    const antigravityHost = process.env.AGY_ANTIGRAVITY_HOST || 'Antigravity';
                    const pveCondition = minAgeHours > 0
                        ? `AND datetime(last_modified_time) < datetime(\\'now\\', \\'-${minutesOffset} minutes\\') AND (not_fully_idle IS NULL OR not_fully_idle != \\'1\\') AND (status IS NULL OR status != \\'CASCADE_RUN_STATUS_RUNNING\\')`
                        : `AND (not_fully_idle IS NULL OR not_fully_idle != \\'1\\') AND (status IS NULL OR status != \\'CASCADE_RUN_STATUS_RUNNING\\')`;
                    execSync(`ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no ${antigravityHost} 'python3 -c "import sqlite3, os; conn=sqlite3.connect(os.path.expanduser(\\"~/.gemini/antigravity/conversation_summaries.db\\")); conn.execute(\\"DELETE FROM conversation_summaries WHERE (source = \\x27CORTEX_TRAJECTORY_SOURCE_CLI\\x27 OR nesting_depth > 0 OR (parent_conversation_id IS NOT NULL AND parent_conversation_id != \\x27\\x27)) ${pveCondition}\\"); conn.commit()"'`, {
                        stdio: ['ignore', 'ignore', 'ignore'],
                        timeout: 5000
                    });
                } catch (pveErr) {
                    console.warn('[clean_subagents] PVE remote sync cleanup warning:', pveErr.message);
                }
            }

            // 3. 运行本地 subagent 文件物理清理脚本 (优先使用内置 scripts/ 目录，降级回退全局配置)
            const candidatePaths = [
                path.join(__dirname, '../scripts/clean_subagents.py'),
                path.join(__dirname, 'scripts/clean_subagents.py'),
                path.join(os.homedir(), '.gemini/config/scripts/clean_subagents.py')
            ];
            const scriptPath = candidatePaths.find(p => fs.existsSync(p));
            let stdout = '';
            if (scriptPath) {
                const minAgeArg = minAgeHours > 0 ? `--min-age-hours ${minAgeHours}` : '--min-age-hours 0';
                const excludeArg = query.exclude ? `--exclude "${query.exclude}"` : '';
                try {
                    stdout = execSync(`python3 "${scriptPath}" ${minAgeArg} ${excludeArg}`, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        timeout: 30000
                    });
                } catch (scriptErr) {
                    stdout = scriptErr.stdout || scriptErr.message;
                }
            }

            return { 
                success: true, 
                action: 'clean_subagents', 
                minAgeHours,
                stdout, 
                message: `Subagents older than ${minAgeHours}h successfully cleaned on Mac and PVE (recent and active subagents protected)` 
            };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    return { success: false, error: `Unknown action: ${action}` };
};
