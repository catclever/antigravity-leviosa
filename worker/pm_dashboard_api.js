const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NON_ACTIVE_TASK_STATES = new Set([
    'backlog', 'todo', 'pending', 'open',
    'completed', 'done', 'closed', 'resolved'
]);

function normalizeSessionUuid(raw) {
    if (raw === undefined || raw === null) return null;
    const cleaned = String(raw).trim().replace(/^['"]|['"]$/g, '').trim();
    if (!cleaned || cleaned.toLowerCase() === 'null' || cleaned === '~') {
        return null;
    }
    return UUID_REGEX.test(cleaned) ? cleaned.toLowerCase() : null;
}

function parseTaskFrontmatter(content) {
    const parts = content.split('---');
    if (parts.length < 3) return null;

    const frontmatterText = parts[1];
    let frontmatterId = null;
    let title = 'Unknown';
    let status = 'backlog';
    let priority = 'low';
    let tags = [];
    let completedAt = null;
    let session = null;

    const lines = frontmatterText.split('\n');
    let inTags = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        if (!line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('-')) {
            inTags = false;
        }

        if (line.startsWith('id:')) {
            frontmatterId = line.substring(3).trim().replace(/^['"]|['"]$/g, '');
        } else if (line.startsWith('title:')) {
            title = line.substring(6).trim().replace(/^['"]|['"]$/g, '');
        } else if (line.startsWith('status:')) {
            status = line.substring(7).trim().replace(/^['"]|['"]$/g, '').toLowerCase();
        } else if (line.startsWith('priority:')) {
            priority = line.substring(9).trim().replace(/^['"]|['"]$/g, '').toLowerCase();
        } else if (line.startsWith('completed_at:')) {
            completedAt = line.substring(13).trim().replace(/^['"]|['"]$/g, '');
        } else if (line.startsWith('session:')) {
            session = normalizeSessionUuid(line.substring(8));
        } else if (line.startsWith('tags:')) {
            inTags = true;
            const inlineTags = line.substring(5).trim().replace(/[\[\]]/g, '');
            if (inlineTags) {
                tags = inlineTags.split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
                inTags = false;
            }
        } else if (inTags && trimmed.startsWith('-')) {
            tags.push(trimmed.substring(1).trim().replace(/^['"]|['"]$/g, ''));
        }
    }

    const body = parts.slice(2).join('---').trim();
    return {
        frontmatterId,
        title,
        status,
        priority,
        tags,
        completedAt,
        session,
        body
    };
}

function resolveCleanSubagentsScript() {
    if (process.env.AGY_CLEAN_SUBAGENTS_SCRIPT) {
        return process.env.AGY_CLEAN_SUBAGENTS_SCRIPT;
    }
    const candidates = [
        path.join(__dirname, '../scripts/clean_subagents.py'),
        path.join(__dirname, 'scripts/clean_subagents.py'),
        path.join(os.homedir(), '.gemini/config/scripts/clean_subagents.py')
    ];
    return candidates.find(p => fs.existsSync(p)) || path.join(os.homedir(), '.gemini/config/scripts/clean_subagents.py');
}

module.exports = async function(query) {
    const action = query.action;
    const rawProjectName = query.project || 'antigravity-leviosa';

    // 解析真实的项目目录 (包含模糊匹配 taichi_launcher -> taichi 的逻辑，并支持测试沙盒环境变量覆盖)
    const projectsRoot = process.env.AGY_PROJECTS_ROOT || path.join(os.homedir(), '.gemini/Projects');
    const workspaceRoot = process.env.AGY_WORKSPACE_ROOT || path.join(os.homedir(), '.gemini/antigravity');
    const archivesIndexPath = process.env.AGY_ARCHIVES_INDEX || path.join(__dirname, '..', 'web', 'archives', 'archive_index.json');
    const tmpDir = process.env.AGY_TMP_DIR || '/tmp';
    const skipRemoteSync = process.env.AGY_SKIP_REMOTE_SYNC === '1';

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
        const rawTasks = [];
        const uniqueSessionsSet = new Set();

        for (const file of files) {
            try {
                const filePath = path.join(tasksDir, file);
                const stat = fs.statSync(filePath);
                const mtimeMs = stat.mtimeMs;
                const content = fs.readFileSync(filePath, 'utf-8');
                const parsed = parseTaskFrontmatter(content);
                if (parsed) {
                    const parsedCompletedAt = parsed.completedAt ? (Date.parse(parsed.completedAt) || mtimeMs) : mtimeMs;
                    if (parsed.session) {
                        uniqueSessionsSet.add(parsed.session);
                    }
                    rawTasks.push({
                        id: file,
                        title: parsed.title,
                        status: parsed.status,
                        priority: parsed.priority,
                        tags: parsed.tags,
                        filePath,
                        body: parsed.body,
                        mtimeMs,
                        completedAt: parsedCompletedAt,
                        session: parsed.session
                    });
                }
            } catch (e) {
                // Ignore parse errors
            }
        }

        // 批量单次查询 SQLite 会话元数据
        const dbSessionMap = new Map();
        const dbPath = path.join(workspaceRoot, 'conversation_summaries.db');
        if (uniqueSessionsSet.size > 0 && fs.existsSync(dbPath)) {
            try {
                const quotedUuids = Array.from(uniqueSessionsSet).map(u => `'${u}'`).join(',');
                const sql = `
                    SELECT cs.conversation_id, REPLACE(REPLACE(cs.title, '|', ' '), CHAR(10), ' '), COALESCE(fts.archived, 0)
                    FROM conversation_summaries cs
                    LEFT JOIN (SELECT conversation_id, MAX(archived) as archived FROM conversations_fts GROUP BY conversation_id) fts
                    ON cs.conversation_id = fts.conversation_id
                    WHERE cs.conversation_id IN (${quotedUuids});
                `;
                const output = execSync(`sqlite3 "${dbPath}" "${sql}"`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'ignore'],
                    maxBuffer: 5 * 1024 * 1024
                }).trim();

                if (output) {
                    for (const rowLine of output.split('\n')) {
                        if (!rowLine.trim()) continue;
                        const cols = rowLine.split('|');
                        if (cols.length < 3) continue;
                        const cid = cols[0].trim().toLowerCase();
                        const cleanTitle = cols[1].replace(/\r/g, '').trim();
                        const archivedVal = cols[2].trim();
                        dbSessionMap.set(cid, {
                            title: cleanTitle || null,
                            archived: archivedVal
                        });
                    }
                }
            } catch (e) {
                // Non-fatal SQLite query failure
            }
        }

        // 单次读取冷备归档索引 archive_index.json
        let archiveIndex = {};
        if (fs.existsSync(archivesIndexPath)) {
            try {
                const parsedIdx = JSON.parse(fs.readFileSync(archivesIndexPath, 'utf-8'));
                if (parsedIdx && typeof parsedIdx === 'object') {
                    archiveIndex = parsedIdx;
                }
            } catch (e) {
                // Ignore malformed archive index
            }
        }

        const tasks = rawTasks.map(t => {
            if (!t.session) {
                return { ...t, sessionInfo: null };
            }
            const dbRow = dbSessionMap.get(t.session) || null;
            const archiveEntry = archiveIndex[t.session] || null;
            return {
                ...t,
                sessionInfo: {
                    existsInDb: Boolean(dbRow),
                    archived: dbRow ? String(dbRow.archived) === '1' : false,
                    deepArchived: Boolean(archiveEntry && archiveEntry.deepArchive),
                    localEvicted: Boolean(archiveEntry && archiveEntry.deepArchive && archiveEntry.deepArchive.localEvicted),
                    sessionTitle: (dbRow && dbRow.title) || (archiveEntry && archiveEntry.title) || null
                }
            };
        });

        return { success: true, tasks, path: tasksDir };
    }

    // 全新接口：一键完成任务 + 引用计数安全 GC (防并行任务误伤)
    if (action === 'complete_task') {
        const taskId = query.task;
        if (!taskId) return { success: false, error: 'No task id' };

        const safeTaskId = path.basename(taskId);
        const taskPath = path.join(tasksDir, safeTaskId);
        if (fs.existsSync(taskPath)) {
            try {
                let content = fs.readFileSync(taskPath, 'utf-8');
                const parsedTask = parseTaskFrontmatter(content);

                const nowIso = new Date().toISOString();
                if (/^completed_at:\s*.*$/m.test(content)) {
                    content = content.replace(/^completed_at:\s*.*$/m, `completed_at: ${nowIso}`);
                } else {
                    content = content.replace(/^status:\s*.*$/m, `status: completed\ncompleted_at: ${nowIso}`);
                }
                content = content.replace(/^status:\s*.*$/m, 'status: completed');
                fs.writeFileSync(taskPath, content, 'utf-8');

                const gcSummary = {
                    tmpCleaned: [],
                    subagentGc: { executed: false, reason: 'no_valid_session' }
                };

                // Step 1: 任务级隔离 /tmp 临时派发日志清理 (并行安全，仅清理当前任务词干)
                const stems = new Set();
                const collectStem = (rawStem) => {
                    if (!rawStem) return;
                    const base = String(rawStem).trim().replace(/\.md$/i, '');
                    if (/^[a-zA-Z0-9_.-]+$/.test(base)) {
                        stems.add(base);
                        const strippedSeq = base.replace(/_\d+$/, '');
                        if (strippedSeq && /^[a-zA-Z0-9_.-]+$/.test(strippedSeq)) {
                            stems.add(strippedSeq);
                        }
                    }
                };
                collectStem(safeTaskId);
                if (parsedTask && parsedTask.frontmatterId) {
                    collectStem(parsedTask.frontmatterId);
                }

                const remoteTmpTargets = [];
                for (const stem of stems) {
                    const candidateNames = [
                        `descartes_${stem}.log`,
                        `remote_${stem}.log`,
                        `remote_${stem}.stdin`,
                        `${stem}.signal`
                    ];
                    for (const fname of candidateNames) {
                        const localTmpFile = path.join(tmpDir, fname);
                        try {
                            if (fs.existsSync(localTmpFile)) {
                                fs.unlinkSync(localTmpFile);
                                gcSummary.tmpCleaned.push(localTmpFile);
                            }
                        } catch (unlinkErr) {
                            // Best-effort local tmp cleanup
                        }
                        remoteTmpTargets.push(`/tmp/${fname}`);
                    }
                }

                if (!skipRemoteSync && remoteTmpTargets.length > 0) {
                    try {
                        const child = exec(
                            `ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no Antigravity "rm -f ${remoteTmpTargets.join(' ')}"`,
                            { timeout: 4000 },
                            () => {}
                        );
                        if (child && typeof child.unref === 'function') child.unref();
                    } catch (sshErr) {
                        // Best-effort non-blocking remote tmp cleanup
                    }
                }

                // Step 2: 会话引用计数 Subagent 安全清理 (严禁浅层归档主会话，且存在并行兄弟任务时跳过)
                const session = parsedTask ? parsedTask.session : null;
                if (session) {
                    let siblingActiveCount = 0;
                    if (fs.existsSync(tasksDir)) {
                        const allTaskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md') && f !== safeTaskId);
                        for (const otherFile of allTaskFiles) {
                            try {
                                const otherContent = fs.readFileSync(path.join(tasksDir, otherFile), 'utf-8');
                                const otherParsed = parseTaskFrontmatter(otherContent);
                                if (
                                    otherParsed &&
                                    otherParsed.session === session &&
                                    otherParsed.status &&
                                    !NON_ACTIVE_TASK_STATES.has(otherParsed.status)
                                ) {
                                    siblingActiveCount++;
                                }
                            } catch (e) {
                                // Ignore unreadable sibling task
                            }
                        }
                    }

                    if (siblingActiveCount > 0) {
                        gcSummary.subagentGc = {
                            executed: false,
                            reason: 'sibling_active_tasks',
                            siblingActiveCount
                        };
                    } else {
                        const dbPath = path.join(workspaceRoot, 'conversation_summaries.db');
                        let isParentRunning = false;

                        if (fs.existsSync(dbPath)) {
                            try {
                                const checkSql = `
                                    SELECT COALESCE(status, ''), COALESCE(CAST(not_fully_idle AS TEXT), '0')
                                    FROM conversation_summaries
                                    WHERE conversation_id = '${session}'
                                    LIMIT 1;
                                `;
                                const checkRow = execSync(`sqlite3 "${dbPath}" "${checkSql}"`, {
                                    encoding: 'utf-8',
                                    stdio: ['pipe', 'pipe', 'ignore']
                                }).trim();

                                if (checkRow) {
                                    const [parentStatus = '', parentNotIdle = '0'] = checkRow.split('|');
                                    if (parentStatus.trim() === 'CASCADE_RUN_STATUS_RUNNING' || String(parentNotIdle).trim() === '1') {
                                        isParentRunning = true;
                                    }
                                }
                            } catch (e) {
                                // Proceed if status check fails cleanly
                            }
                        }

                        if (isParentRunning) {
                            gcSummary.subagentGc = {
                                executed: false,
                                reason: 'parent_session_running',
                                siblingActiveCount: 0
                            };
                        } else {
                            // 1) 删除本地 SQLite 中挂载在该主会话下的空闲 Subagent 记录
                            if (fs.existsSync(dbPath)) {
                                try {
                                    const deleteIdleSubagentsSql = `
                                        DELETE FROM conversation_summaries
                                        WHERE parent_conversation_id = '${session}'
                                          AND (status IS NULL OR status != 'CASCADE_RUN_STATUS_RUNNING')
                                          AND (not_fully_idle IS NULL OR CAST(not_fully_idle AS TEXT) != '1');
                                        DELETE FROM conversations_fts
                                        WHERE conversation_id NOT IN (SELECT conversation_id FROM conversation_summaries);
                                    `;
                                    execSync(`sqlite3 "${dbPath}" "${deleteIdleSubagentsSql}"`, {
                                        stdio: ['pipe', 'pipe', 'ignore']
                                    });
                                } catch (e) {
                                    // Best-effort SQLite cleanup
                                }
                            }

                            // 2) Best-effort 异步清理 Antigravity (PVE) 远端数据库同源空闲 Subagent 记录
                            if (!skipRemoteSync) {
                                try {
                                    const remotePy = `import sqlite3, os; db=os.path.expanduser('~/.gemini/antigravity/conversation_summaries.db'); conn=sqlite3.connect(db) if os.path.exists(db) else None; conn and (conn.execute("DELETE FROM conversation_summaries WHERE parent_conversation_id = '${session}' AND (status IS NULL OR status != 'CASCADE_RUN_STATUS_RUNNING') AND (not_fully_idle IS NULL OR CAST(not_fully_idle AS TEXT) != '1')"), conn.execute("DELETE FROM conversations_fts WHERE conversation_id NOT IN (SELECT conversation_id FROM conversation_summaries)"), conn.commit())`;
                                    const child = exec(
                                        `ssh -o ConnectTimeout=2 -o StrictHostKeyChecking=no Antigravity "python3 -c \\"${remotePy.replace(/"/g, '\\"')}\\""`,
                                        { timeout: 5000 },
                                        () => {}
                                    );
                                    if (child && typeof child.unref === 'function') child.unref();
                                } catch (e) {
                                    // Best-effort remote SQLite cleanup
                                }
                            }

                            // 3) 调用 clean_subagents.py 物理清理该会话派生的磁盘孤儿 Subagent 目录
                            const cleanScriptPath = resolveCleanSubagentsScript();
                            if (cleanScriptPath && fs.existsSync(cleanScriptPath)) {
                                try {
                                    execSync(`python3 "${cleanScriptPath}" --session "${session}" --min-age-hours 0 --quiet`, {
                                        stdio: ['pipe', 'pipe', 'pipe'],
                                        timeout: 20000
                                    });
                                } catch (e) {
                                    // Best-effort subagent disk cleanup
                                }
                            }

                            gcSummary.subagentGc = { executed: true };
                        }
                    }
                }

                return { success: true, gc: gcSummary };
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
            exec(`open "qled://open?path=${encodeURI(taskPath)}"`, (err) => {
                if (err) console.error('[pm_dashboard_api] open qled error:', err);
            });
            return { success: true, path: taskPath };
        }
        return { success: false, error: 'Task not found' };
    }

    return { success: false, error: 'Unknown action' };
};
