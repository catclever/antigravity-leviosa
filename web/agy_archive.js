#!/usr/bin/env node

/*
 * [Bug Fix Document]
 * 1. Problem: Previously, `agy_archive.js clean --deep` (and History View deletion) only packaged
 *    parent files into a local `.tar.gz` without cleaning up `brain/<uuid>`, `conversations/<uuid>.pb`,
 *    spawned subagent directories/DB records/PB files, or `/tmp` watchdog task logs (`descartes_<id>.log`,
 *    `remote_<id>.log`, `<id>.signal`), causing severe local disk & SQLite bloat. Furthermore, deep archives
 *    accumulated indefinitely on local Mac SSD without verified cloud offloading or cold restore.
 * 2. Method:
 *    - Extract all descendant subagent UUIDs (via 3-level recursive scan across `conversation_summaries.db`,
 *      live `transcript.jsonl`, and prior shallow `.tar.gz` archives) and linked Kanban task stems
 *      (strictly read-only YAML frontmatter scan on `Projects/<project>/tasks/<task>.md`) BEFORE `handleShallowClean`
 *      removes `.system_generated`.
 *    - Package `.pb`, `brain/<uuid>`, and merged shallow tarballs into `${uuid}_deep_${ts}.tar.gz`,
 *      recording `sizeBytes`, `sha256`, and `localEvicted: false` in `archive_index.json` (clearing
 *      merged `shallowArchives` to `[]`).
 *    - Only after verifying the deep tarball exists and has `size > 0`, perform cascading physical &
 *      SQLite cleanup of subagents, `/tmp` task execution logs, `brain/<uuid>`, and (when `--purge-parent`
 *      is passed) parent `.pb` + local/remote `Antigravity` SQLite records, then trigger detached
 *      `offload <uuid>` (unless `--no-auto-offload` is specified).
 *    - Implement `offload <uuid|--all>` and `restore <uuid>` via PVE `/tmp` staging + `rclone` to
 *      `alist:115`, strictly verifying `rclone lsjson` byte size before local eviction and verifying
 *      `sizeBytes` + `sha256` on cold restore (including nested shallow tarball extraction).
 * 3. Caveat:
 *    - Kanban task discovery in `Projects/<project>/tasks/<task>.md` MUST remain strictly read-only; never modify
 *      or delete task markdown cards during archive or purge.
 *    - Never run `mkdir` on PVE during offload/restore; always stage directly in `/tmp/${tarballName}`
 *      and remove `/tmp/${tarballName}` inside a `finally` block.
 *
 * [Bug Fix & Auto-Lifecycle Document - Task 073]
 * 1. Problem:
 *    (a) Cold-restored deep-archived conversations extracted `.pb` and `brain/<uuid>` on disk, but remained
 *        invisible in History View & sidebar because `clean --deep --purge-parent` deleted their rows from
 *        `conversation_summaries` and `conversations_fts`.
 *    (b) Idle conversations accumulated indefinitely without automated two-stage aging (30d active -> shallow
 *        archive; 30d shallow -> deep archive + cloud 115 offload), and batch runs needed error isolation
 *        (`throwOnError`), Kanban active-task session protection, and a Revival Guard for reopened chats.
 * 2. Method:
 *    - Snapshot `sqliteMeta` from `conversation_summaries` into `archive_index.json[uuid]` prior to deep purge,
 *      and re-hydrate `conversation_summaries` + `conversations_fts` (`archived = '0'`, fresh UTC `last_modified_time`)
 *      during `restore <uuid>`.
 *    - Add `lifecycle` subcommand with 24h debounce (`lifecycle_meta.json`), strictly read-only Kanban active
 *      session lock scanning, Stage 1 (>30d active -> shallow), and Stage 2 (>30d shallow -> deep + offload
 *      evaluated strictly against pre-run `archived == '1'` and `Math.max(lastModMs, latestShallowMs)`).
 * 3. Caveat:
 *    - NEVER store non-UUID metadata keys inside `archive_index.json`; `lifecycle` debounce state lives in
 *      `${ARCHIVES_DIR}/lifecycle_meta.json`.
 *    - Revival Guard: Stage 2 MUST only evaluate conversations already `archived == '1'` before the current
 *      `lifecycle` run started so newly Stage-1-archived or user-unarchived conversations are never deep-purged
 *      prematurely.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const child_process = require('child_process');
const { execSync, execFileSync } = child_process;

const ARGS = process.argv.slice(2);
const SCRIPT_DIR = __dirname;
const ARCHIVES_DIR = process.env.AGY_ARCHIVES_DIR || path.join(SCRIPT_DIR, 'archives');
const INDEX_FILE = path.join(ARCHIVES_DIR, 'archive_index.json');
const LIFECYCLE_META_FILE = path.join(ARCHIVES_DIR, 'lifecycle_meta.json');
const WORKSPACE_ROOT = process.env.AGY_WORKSPACE_ROOT || path.join(os.homedir(), '.gemini', 'antigravity');
const GEMINI_DIR = WORKSPACE_ROOT;
const BRAIN_DIR = path.join(GEMINI_DIR, 'brain');
const PROJECTS_ROOT = process.env.AGY_PROJECTS_ROOT || path.join(os.homedir(), '.gemini', 'Projects');
const TMP_DIR = process.env.AGY_TMP_DIR || '/tmp';
const ARCHIVE_CONFIG_FILE = process.env.AGY_ARCHIVE_CONFIG_FILE || path.join(ARCHIVES_DIR, 'archive_config.json');
const USER_ARCHIVE_CONFIG_FILE = path.join(os.homedir(), '.gemini', 'antigravity', 'archive_config.json');

/**
 * 存储配置解析：配置文件优先 -> 环境变量降级 -> 留空（无任何内置硬编码缺省值）
 */
function loadStorageConfig() {
    let fileConfig = {};
    let configFileUsed = null;

    if (fs.existsSync(ARCHIVE_CONFIG_FILE)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(ARCHIVE_CONFIG_FILE, 'utf8'));
            configFileUsed = ARCHIVE_CONFIG_FILE;
        } catch (e) {
            console.error(`[Archive Storage] Failed to parse ${ARCHIVE_CONFIG_FILE}:`, e.message);
        }
    } else if (fs.existsSync(USER_ARCHIVE_CONFIG_FILE)) {
        try {
            fileConfig = JSON.parse(fs.readFileSync(USER_ARCHIVE_CONFIG_FILE, 'utf8'));
            configFileUsed = USER_ARCHIVE_CONFIG_FILE;
        } catch (e) {
            console.error(`[Archive Storage] Failed to parse ${USER_ARCHIVE_CONFIG_FILE}:`, e.message);
        }
    }

    // 1. 配置文件优先；2. 环境变量次之；3. 绝无硬编码缺省值，未设置即为空字符串
    let rawRcloneDest = '';
    let rawPveHost = '';
    let source = 'none';

    if (fileConfig && fileConfig.rcloneDest !== undefined) {
        rawRcloneDest = String(fileConfig.rcloneDest).trim();
        source = 'config_file';
    } else if (process.env.AGY_RCLONE_DEST !== undefined) {
        rawRcloneDest = String(process.env.AGY_RCLONE_DEST).trim();
        source = 'env';
    }

    if (fileConfig && fileConfig.pveHost !== undefined) {
        rawPveHost = String(fileConfig.pveHost).trim();
    } else if (process.env.AGY_PVE_HOST !== undefined) {
        rawPveHost = String(process.env.AGY_PVE_HOST).trim();
    }

    const rcloneDest = rawRcloneDest.replace(/\/+$/, '');
    const pveHost = rawPveHost;

    // 只要 rcloneDest 留空，或者显式配置 enabled === false，均视为禁用云端（纯本地深归档模式）
    const enabled = (fileConfig && fileConfig.enabled !== undefined)
        ? Boolean(fileConfig.enabled && rcloneDest)
        : Boolean(rcloneDest);

    return {
        rcloneDest,
        pveHost,
        enabled,
        source,
        configFile: configFileUsed
    };
}

function saveStorageConfig(config) {
    if (!fs.existsSync(ARCHIVES_DIR)) {
        fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
    }
    const current = loadStorageConfig();
    const newDest = config.rcloneDest !== undefined ? String(config.rcloneDest).trim().replace(/\/+$/, '') : current.rcloneDest;
    const newHost = config.pveHost !== undefined ? String(config.pveHost).trim() : current.pveHost;
    const newEnabled = config.enabled !== undefined
        ? Boolean(config.enabled && newDest)
        : (config.rcloneDest !== undefined ? Boolean(newDest) : current.enabled);

    const updated = {
        rcloneDest: newDest,
        pveHost: newHost,
        enabled: newEnabled
    };
    fs.writeFileSync(ARCHIVE_CONFIG_FILE, JSON.stringify(updated, null, 2));
    return loadStorageConfig();
}
const ANTIGRAVITY_HOST = process.env.AGY_ANTIGRAVITY_HOST || 'Antigravity';
const SKIP_REMOTE_SYNC = process.env.AGY_SKIP_REMOTE_SYNC === '1';

const TRANSCRIPT_UUID_REGEX = /\\*"conversationId\\*"\s*:\s*\\*"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\*"/g;
const NON_ACTIVE_KANBAN_STATUSES = new Set([
    'backlog', 'todo', 'pending', 'open',
    'completed', 'done', 'closed', 'resolved'
]);

if (!fs.existsSync(ARCHIVES_DIR)) {
    fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
}

function isValidUuid(id) {
    return typeof id === 'string' && /^[a-f0-9][a-f0-9\-]{3,63}$/i.test(id);
}

function isSafeFilename(name) {
    return typeof name === 'string' && /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes('..');
}

function loadIndex() {
    if (fs.existsSync(INDEX_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
        } catch (e) {
            console.error('Failed to parse index file, initializing empty object.');
        }
    }
    return {};
}

function saveIndex(indexData) {
    if (!fs.existsSync(ARCHIVES_DIR)) {
        fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
    }
    fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2));
}

function loadLifecycleMeta() {
    if (fs.existsSync(LIFECYCLE_META_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(LIFECYCLE_META_FILE, 'utf8'));
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) {}
    }
    return {};
}

function saveLifecycleMeta(metaObj) {
    if (!fs.existsSync(ARCHIVES_DIR)) {
        fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
    }
    fs.writeFileSync(LIFECYCLE_META_FILE, JSON.stringify(metaObj, null, 2));
}

function formatNowSqliteUtc() {
    return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

function sqlQuote(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') {
        return Number.isFinite(val) ? String(val) : '0';
    }
    return `'${String(val).replace(/'/g, "''")}'`;
}

function sqliteQueryJson(dbPath, sql) {
    if (!fs.existsSync(dbPath)) return [];
    const out = execFileSync('sqlite3', ['-json', dbPath, sql], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 20 * 1024 * 1024
    }).trim();
    if (!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
}

function sqliteExec(dbPath, sql) {
    if (!fs.existsSync(dbPath)) return;
    execFileSync('sqlite3', [dbPath, sql], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}

function getTableColumns(dbPath, tableName) {
    try {
        return sqliteQueryJson(dbPath, `PRAGMA table_info(${tableName});`);
    } catch (e) {
        return [];
    }
}

function parseProjectFromWorkspaceUris(wsRaw) {
    if (!wsRaw) return '';
    try {
        const uris = JSON.parse(wsRaw);
        if (Array.isArray(uris) && uris.length > 0) {
            return decodeURIComponent(String(uris[0]).split('/').filter(Boolean).pop() || '');
        }
    } catch (e) {}
    return '';
}

function deriveTitleFromSummary(title, preview) {
    if (title && String(title).trim() && String(title).trim() !== 'Untitled Conversation') {
        return String(title).trim();
    }
    if (!preview || !String(preview).trim()) {
        return 'Untitled Conversation';
    }
    const p = String(preview).trim();
    const taskMatch = p.match(/(?:Execute\s+)?Task\s+(?:ID:\s*)?([a-zA-Z0-9_\-]+)/i);
    if (taskMatch) {
        return `Task: ${taskMatch[1]}`;
    }
    const goalMatch = p.match(/^\/goal\s+([^\r\n]+)/i);
    if (goalMatch) {
        return `/goal ${goalMatch[1].slice(0, 35)}`;
    }
    const firstLine = p.split(/[\r\n]+/)[0].trim();
    return firstLine.slice(0, 45) || 'Untitled Conversation';
}

function parseSqliteUtcMs(rawTime) {
    if (rawTime === null || rawTime === undefined) return NaN;
    const str = String(rawTime).trim();
    if (!str) return NaN;
    if (/^\d+$/.test(str)) {
        const n = Number(str);
        return n < 1e11 ? n * 1000 : n;
    }
    // Standard SQLite UTC string: 'YYYY-MM-DD HH:MM:SS' (or fractional seconds)
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
        return Date.parse(str.replace(/\s+/, 'T') + 'Z');
    }
    // ISO string without explicit timezone suffix
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
        return Date.parse(str + 'Z');
    }
    return Date.parse(str);
}

function computeSha256Sync(filePath) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(4 * 1024 * 1024);
    try {
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
            hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
        }
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

function makeWritableRecursive(targetPath) {
    try {
        const stat = fs.lstatSync(targetPath);
        if (stat.isDirectory()) {
            fs.chmodSync(targetPath, 0o700);
            for (const entry of fs.readdirSync(targetPath)) {
                makeWritableRecursive(path.join(targetPath, entry));
            }
        } else if (!stat.isSymbolicLink()) {
            fs.chmodSync(targetPath, 0o600);
        }
    } catch (e) {
        // Ignore chmod errors on concurrent/missing files
    }
}

function safeRmRf(targetPath) {
    if (!fs.existsSync(targetPath)) return;
    try {
        fs.rmSync(targetPath, { recursive: true, force: true });
    } catch (err) {
        makeWritableRecursive(targetPath);
        fs.rmSync(targetPath, { recursive: true, force: true });
    }
}

function safeUnlink(filePath) {
    try {
        fs.unlinkSync(filePath);
        return true;
    } catch (err) {
        if (err && err.code === 'ENOENT') return false;
        try {
            fs.chmodSync(filePath, 0o600);
            fs.unlinkSync(filePath);
            return true;
        } catch (e) {
            return false;
        }
    }
}

/**
 * Queries `conversation_summaries` for `<uuid>` BEFORE deep clean deletes parent SQLite rows,
 * returning `{ title, project, sqliteMeta }` so cold restore can re-hydrate `conversation_summaries`.
 */
function extractSqliteMetaFromDb(uuid) {
    const dbPath = path.join(WORKSPACE_ROOT, 'conversation_summaries.db');
    if (!fs.existsSync(dbPath) || !isValidUuid(uuid)) {
        return { title: '', project: '', sqliteMeta: null };
    }
    try {
        const escapedUuid = uuid.replace(/'/g, "''");
        const rows = sqliteQueryJson(
            dbPath,
            `SELECT * FROM conversation_summaries WHERE conversation_id = '${escapedUuid}' LIMIT 1;`
        );
        if (!rows || rows.length === 0) {
            return { title: '', project: '', sqliteMeta: null };
        }
        const row = rows[0];
        const sqliteMeta = {};
        if (row.title !== undefined && row.title !== null) sqliteMeta.title = String(row.title);
        if (row.preview !== undefined && row.preview !== null) sqliteMeta.preview = String(row.preview).slice(0, 1000);
        if (row.step_count !== undefined && row.step_count !== null) sqliteMeta.step_count = Number(row.step_count);
        if (row.workspace_uris !== undefined && row.workspace_uris !== null) sqliteMeta.workspace_uris = String(row.workspace_uris);
        if (row.project_id !== undefined && row.project_id !== null) sqliteMeta.project_id = String(row.project_id);
        if (row.last_user_input_step_index !== undefined && row.last_user_input_step_index !== null) {
            sqliteMeta.last_user_input_step_index = Number(row.last_user_input_step_index);
        }
        if (row.app_data_dir !== undefined && row.app_data_dir !== null) sqliteMeta.app_data_dir = String(row.app_data_dir);
        if (row.created_time !== undefined && row.created_time !== null) sqliteMeta.created_time = String(row.created_time);
        if (row.source !== undefined && row.source !== null) sqliteMeta.source = String(row.source);

        const derivedTitle = deriveTitleFromSummary(row.title, row.preview);
        const rawTitle = (row.title && String(row.title).trim()) ? String(row.title).trim() : (derivedTitle !== 'Untitled Conversation' ? derivedTitle : '');
        const project = parseProjectFromWorkspaceUris(row.workspace_uris);
        return {
            title: rawTitle,
            project,
            sqliteMeta: Object.keys(sqliteMeta).length > 0 ? sqliteMeta : null
        };
    } catch (e) {
        return { title: '', project: '', sqliteMeta: null };
    }
}

function lookupMetadataFromDb(uuid) {
    const res = extractSqliteMetaFromDb(uuid);
    return { title: res.title, project: res.project };
}

function updateIndex(uuid, entry) {
    const indexData = loadIndex();

    if (!indexData[uuid]) {
        indexData[uuid] = {
            title: entry.title || 'Unknown Title',
            project: entry.project || 'Unknown Project',
            shallowArchives: [],
            deepArchive: null
        };
    } else {
        if (entry.title && entry.title !== 'Unknown Title' && entry.title !== 'Unknown') {
            indexData[uuid].title = entry.title;
        }
        if (entry.project && entry.project !== 'Unknown Project' && entry.project !== 'Unknown') {
            indexData[uuid].project = entry.project;
        }
    }

    if (entry.sqliteMeta && typeof entry.sqliteMeta === 'object' && Object.keys(entry.sqliteMeta).length > 0) {
        indexData[uuid].sqliteMeta = {
            ...(indexData[uuid].sqliteMeta || {}),
            ...entry.sqliteMeta
        };
    }

    if (entry.lastShallowAt) {
        indexData[uuid].lastShallowAt = entry.lastShallowAt;
    }

    if (entry.type === 'shallow') {
        if (!Array.isArray(indexData[uuid].shallowArchives)) {
            indexData[uuid].shallowArchives = [];
        }
        if (entry.tarball) {
            indexData[uuid].shallowArchives.push({
                timestamp: entry.timestamp,
                tarball: entry.tarball
            });
        }
        if (entry.timestamp && !entry.lastShallowAt) {
            indexData[uuid].lastShallowAt = entry.timestamp;
        }
    } else if (entry.type === 'shallow_mark') {
        if (!Array.isArray(indexData[uuid].shallowArchives)) {
            indexData[uuid].shallowArchives = [];
        }
        indexData[uuid].lastShallowAt = entry.lastShallowAt || entry.timestamp || new Date().toISOString();
    } else if (entry.type === 'deep') {
        // Once shallow archives are merged into the deep tarball, clear shallowArchives to []
        indexData[uuid].shallowArchives = [];
        indexData[uuid].deepArchive = {
            timestamp: entry.timestamp,
            tarball: entry.deepTarball || entry.tarball,
            sizeBytes: entry.sizeBytes,
            sha256: entry.sha256,
            localEvicted: Boolean(entry.localEvicted)
        };
    }

    saveIndex(indexData);
}

function extractUuidsFromTranscriptText(content, rootUuidLower, targetSet) {
    if (!content) return [];
    const newlyFound = [];
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        if (!line.includes('conversationId')) continue;
        TRANSCRIPT_UUID_REGEX.lastIndex = 0;
        let match;
        while ((match = TRANSCRIPT_UUID_REGEX.exec(line)) !== null) {
            const candidate = match[1];
            const lower = candidate.toLowerCase();
            if (lower === rootUuidLower) continue;
            if (!targetSet.has(lower)) {
                targetSet.set(lower, candidate);
                newlyFound.push(candidate);
            }
        }
    }
    return newlyFound;
}

/**
 * Collects all descendant subagent UUIDs spawned by `uuid` BEFORE shallow clean removes `.system_generated`:
 *  a) SQLite `conversation_summaries.db` (`parent_conversation_id`, up to 3 levels deep)
 *  b) Live `${BRAIN_DIR}/<id>/.system_generated/logs/transcript.jsonl` (up to 3 levels deep)
 *  c) Existing `${ARCHIVES_DIR}/${uuid}_shallow_*.tar.gz` tarballs containing `.system_generated/logs/transcript.jsonl`
 */
function collectDescendantSubagentUuids(uuid) {
    const rootLower = uuid.toLowerCase();
    const discoveredByLower = new Map(); // lowerUuid -> originalUuid
    const dbPath = path.join(WORKSPACE_ROOT, 'conversation_summaries.db');
    const hasDb = fs.existsSync(dbPath);

    let frontier = [uuid];

    for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
        const nextFrontier = [];

        // (a) Query SQLite conversation_summaries for children of current frontier
        if (hasDb) {
            try {
                const validFrontier = frontier.filter(isValidUuid);
                if (validFrontier.length > 0) {
                    const quoted = validFrontier.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
                    const sql = `SELECT conversation_id FROM conversation_summaries WHERE parent_conversation_id IN (${quoted});`;
                    const out = execFileSync('sqlite3', [dbPath, sql], {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'ignore']
                    }).trim();
                    if (out) {
                        for (const rawLine of out.split(/\r?\n/)) {
                            const childId = rawLine.trim();
                            if (!isValidUuid(childId)) continue;
                            const lower = childId.toLowerCase();
                            if (lower !== rootLower && !discoveredByLower.has(lower)) {
                                discoveredByLower.set(lower, childId);
                                nextFrontier.push(childId);
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore SQLite read errors and continue scanning transcripts
            }
        }

        // (b) Scan live brain transcript.jsonl for each session in current frontier
        for (const currentId of frontier) {
            const transcriptPath = path.join(BRAIN_DIR, currentId, '.system_generated', 'logs', 'transcript.jsonl');
            if (fs.existsSync(transcriptPath)) {
                try {
                    const content = fs.readFileSync(transcriptPath, 'utf8');
                    const found = extractUuidsFromTranscriptText(content, rootLower, discoveredByLower);
                    nextFrontier.push(...found);
                } catch (e) {}
            }
        }

        // (c) At depth 0 (parent uuid), also scan any existing shallow tarballs for transcript.jsonl
        if (depth === 0 && fs.existsSync(ARCHIVES_DIR)) {
            const shallowFiles = fs.readdirSync(ARCHIVES_DIR).filter(
                f => f.startsWith(`${uuid}_shallow_`) && f.endsWith('.tar.gz')
            );
            for (const shallowFile of shallowFiles) {
                const shallowPath = path.join(ARCHIVES_DIR, shallowFile);
                for (const memberName of ['.system_generated/logs/transcript.jsonl', './.system_generated/logs/transcript.jsonl']) {
                    try {
                        const tarTranscript = execFileSync('tar', ['-xOzf', shallowPath, memberName], {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'ignore'],
                            maxBuffer: 50 * 1024 * 1024
                        });
                        if (tarTranscript) {
                            const found = extractUuidsFromTranscriptText(tarTranscript, rootLower, discoveredByLower);
                            nextFrontier.push(...found);
                            break;
                        }
                    } catch (e) {
                        // Member may not exist in this shallow archive; safely ignore
                    }
                }
            }
        }

        frontier = nextFrontier;
    }

    return Array.from(discoveredByLower.values());
}

/**
 * Strictly READ-ONLY scan of `${PROJECTS_ROOT}/<project>/tasks/*.md` YAML frontmatter.
 * If `session:` matches `<uuid>` (supporting raw UUID or `conversation://<uuid>`), collects:
 *   - filename stem (e.g. `foo_bar_072`)
 *   - frontmatter `id:` (if present)
 *   - bare slug without trailing `_\d+`
 * NEVER writes to or modifies any file in `tasks/`.
 */
function collectLinkedTaskIds(uuid) {
    const linkedIds = new Set();
    if (!fs.existsSync(PROJECTS_ROOT)) return [];

    const targetLower = uuid.toLowerCase();

    function addCandidateId(rawId) {
        if (!rawId || typeof rawId !== 'string') return;
        const trimmed = rawId.trim();
        if (!/^[a-zA-Z0-9_-]{2,128}$/.test(trimmed)) return;
        if (!/^\d+$/.test(trimmed)) {
            linkedIds.add(trimmed);
        }
        const bareSlug = trimmed.replace(/_\d+$/, '');
        if (bareSlug && bareSlug !== trimmed && /^[a-zA-Z0-9_-]{2,128}$/.test(bareSlug) && !/^\d+$/.test(bareSlug)) {
            linkedIds.add(bareSlug);
        }
    }

    function inspectTasksDir(dirPath, depth = 0) {
        if (depth > 2 || !fs.existsSync(dirPath)) return;
        let entries = [];
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                inspectTasksDir(fullPath, depth + 1);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
                    if (!fmMatch) continue;
                    const fmLines = fmMatch[1].split(/\r?\n/);
                    let sessionVal = '';
                    let idVal = '';
                    for (const line of fmLines) {
                        const sessionMatch = line.match(/^\s*session\s*:\s*(.+?)\s*$/);
                        if (sessionMatch) {
                            sessionVal = sessionMatch[1]
                                .replace(/^['"]|['"]$/g, '')
                                .trim()
                                .replace(/^conversation:\/\//i, '')
                                .trim();
                        }
                        const idMatch = line.match(/^\s*id\s*:\s*(.+?)\s*$/);
                        if (idMatch) {
                            idVal = idMatch[1].replace(/^['"]|['"]$/g, '').trim();
                        }
                    }
                    if (sessionVal && sessionVal.toLowerCase() === targetLower) {
                        const fileStem = path.basename(entry.name, '.md');
                        addCandidateId(fileStem);
                        if (idVal) addCandidateId(idVal);
                    }
                } catch (e) {
                    // Strictly read-only; ignore unreadable files
                }
            }
        }
    }

    try {
        const projects = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
        for (const proj of projects) {
            if (!proj.isDirectory()) continue;
            const tasksDir = path.join(PROJECTS_ROOT, proj.name, 'tasks');
            inspectTasksDir(tasksDir, 0);
        }
    } catch (e) {}

    return Array.from(linkedIds);
}

/**
 * Strictly READ-ONLY scan of `${PROJECTS_ROOT}/<project>/tasks/*.md` YAML frontmatter to build
 * the active Kanban session lock set. Any valid `session` UUID whose task `status` (lowercased)
 * is NOT in NON_ACTIVE_KANBAN_STATUSES (e.g. `active`, `in_progress`, `in_review`) is locked.
 * Also locks `currentUuid` if valid.
 */
function collectActiveKanbanLockedSessions(currentUuid = '') {
    const locked = new Map(); // lowerUuid -> { reason, status, taskFile, project }

    if (currentUuid && isValidUuid(currentUuid)) {
        locked.set(currentUuid.toLowerCase(), {
            reason: 'current_open_session'
        });
    }

    if (!fs.existsSync(PROJECTS_ROOT)) return locked;

    function inspectTasksDir(projName, dirPath, depth = 0) {
        if (depth > 2 || !fs.existsSync(dirPath)) return;
        let entries = [];
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                inspectTasksDir(projName, fullPath, depth + 1);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
                    if (!fmMatch) continue;
                    const fmLines = fmMatch[1].split(/\r?\n/);
                    let sessionVal = '';
                    let statusVal = '';
                    for (const line of fmLines) {
                        const sessionMatch = line.match(/^\s*session\s*:\s*(.+?)\s*$/);
                        if (sessionMatch) {
                            sessionVal = sessionMatch[1]
                                .replace(/^['"]|['"]$/g, '')
                                .trim()
                                .replace(/^conversation:\/\//i, '')
                                .trim();
                        }
                        const statusMatch = line.match(/^\s*status\s*:\s*(.+?)\s*$/);
                        if (statusMatch) {
                            statusVal = statusMatch[1].replace(/^['"]|['"]$/g, '').trim().toLowerCase();
                        }
                    }
                    if (
                        sessionVal &&
                        sessionVal.toLowerCase() !== 'null' &&
                        sessionVal !== '~' &&
                        isValidUuid(sessionVal) &&
                        statusVal &&
                        !NON_ACTIVE_KANBAN_STATUSES.has(statusVal)
                    ) {
                        const key = sessionVal.toLowerCase();
                        if (!locked.has(key)) {
                            locked.set(key, {
                                reason: 'kanban_active_task',
                                status: statusVal,
                                taskFile: entry.name,
                                project: projName
                            });
                        }
                    }
                } catch (e) {
                    // Strictly read-only
                }
            }
        }
    }

    try {
        const projects = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true });
        for (const proj of projects) {
            if (!proj.isDirectory()) continue;
            const tasksDir = path.join(PROJECTS_ROOT, proj.name, 'tasks');
            inspectTasksDir(proj.name, tasksDir, 0);
        }
    } catch (e) {}

    return locked;
}

function deleteUuidsFromLocalSqlite(uuids) {
    const valid = uuids.filter(isValidUuid);
    if (valid.length === 0) return;
    const dbPath = path.join(WORKSPACE_ROOT, 'conversation_summaries.db');
    if (!fs.existsSync(dbPath)) return;

    const quoted = valid.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
    try {
        execFileSync('sqlite3', [dbPath, `DELETE FROM conversation_summaries WHERE conversation_id IN (${quoted});`], {
            stdio: ['ignore', 'pipe', 'ignore']
        });
    } catch (e) {}
    try {
        execFileSync('sqlite3', [dbPath, `DELETE FROM conversations_fts WHERE conversation_id IN (${quoted});`], {
            stdio: ['ignore', 'pipe', 'ignore']
        });
    } catch (e) {}
}

function deleteUuidsFromRemoteSqlite(uuids) {
    if (SKIP_REMOTE_SYNC) return;
    const valid = uuids.filter(isValidUuid);
    if (valid.length === 0) return;

    const quotedPy = valid.map(id => `'${id.replace(/'/g, '')}'`).join(',');
    const pyScript = [
        'import sqlite3, os',
        'p = os.path.expanduser("~/.gemini/antigravity/conversation_summaries.db")',
        'if os.path.exists(p):',
        '    conn = sqlite3.connect(p)',
        `    ids = (${quotedPy}${valid.length === 1 ? ',' : ''})`,
        '    ph = ",".join(["?"] * len(ids))',
        '    conn.execute(f"DELETE FROM conversation_summaries WHERE conversation_id IN ({ph})", ids)',
        '    try:',
        '        conn.execute(f"DELETE FROM conversations_fts WHERE conversation_id IN ({ph})", ids)',
        '    except Exception:',
        '        pass',
        '    conn.commit()',
        '    conn.close()'
    ].join('\n');

    try {
        execFileSync('ssh', [
            '-o', 'ConnectTimeout=3',
            '-o', 'StrictHostKeyChecking=no',
            ANTIGRAVITY_HOST,
            `python3 -c ${JSON.stringify(pyScript)}`
        ], { stdio: 'ignore', timeout: 5000 });
    } catch (e) {
        // Best-effort remote sync
    }
}

function cleanTaskExecutionLogs(linkedTaskIds) {
    if (!linkedTaskIds || linkedTaskIds.length === 0) return [];
    const removedLocal = [];
    const remoteTargets = [];

    for (const taskId of linkedTaskIds) {
        if (!/^[a-zA-Z0-9_-]{2,128}$/.test(taskId)) continue;
        const names = [
            `descartes_${taskId}.log`,
            `remote_${taskId}.log`,
            `remote_${taskId}.stdin`,
            `${taskId}.signal`
        ];
        for (const name of names) {
            const localPath = path.join(TMP_DIR, name);
            if (safeUnlink(localPath)) {
                removedLocal.push(localPath);
            }
            remoteTargets.push(`/tmp/${name}`);
        }
    }

    if (!SKIP_REMOTE_SYNC && remoteTargets.length > 0) {
        try {
            const quotedRemote = remoteTargets.map(p => `'${p}'`).join(' ');
            execFileSync('ssh', [
                '-o', 'ConnectTimeout=3',
                '-o', 'StrictHostKeyChecking=no',
                ANTIGRAVITY_HOST,
                `rm -f ${quotedRemote}`
            ], { stdio: 'ignore', timeout: 5000 });
        } catch (e) {
            // Best-effort remote /tmp cleanup
        }
    }

    return removedLocal;
}

async function handleShallowClean(uuid, title, project, options = {}) {
    const bestEffort = Boolean(options.bestEffort);
    const quiet = Boolean(options.quiet);
    const throwOnError = Boolean(options.throwOnError);
    const log = (...args) => { if (!quiet) console.log(...args); };

    const targetBrain = path.join(BRAIN_DIR, uuid);
    if (!fs.existsSync(targetBrain)) {
        if (bestEffort) {
            return null;
        }
        const errMsg = `Brain directory not found for ${uuid} at ${targetBrain}`;
        if (throwOnError) {
            throw new Error(errMsg);
        }
        console.error(errMsg);
        process.exit(1);
    }

    const sysGenDir = path.join(targetBrain, '.system_generated');
    const scratchDir = path.join(targetBrain, 'scratch');

    const pathsToArchive = [];
    if (fs.existsSync(sysGenDir)) pathsToArchive.push('.system_generated');
    if (fs.existsSync(scratchDir)) pathsToArchive.push('scratch');

    if (pathsToArchive.length === 0) {
        log(`Nothing to shallow archive for ${uuid}. Directories may have already been cleaned.`);
        return null;
    }

    const timestampMs = Date.now();
    const tarballName = `${uuid}_shallow_${timestampMs}.tar.gz`;
    const tarballPath = path.join(ARCHIVES_DIR, tarballName);

    try {
        log(`[EXEC] tar -czf "${tarballPath}" -C "${targetBrain}" ${pathsToArchive.join(' ')}`);
        execFileSync('tar', ['-czf', tarballPath, '-C', targetBrain, ...pathsToArchive], {
            env: { ...process.env, COPYFILE_DISABLE: '1' },
            stdio: quiet ? 'ignore' : 'inherit'
        });
    } catch (err) {
        if (bestEffort || throwOnError) {
            throw err;
        }
        console.error(`[ERROR] Shallow tar failed for ${uuid}: ${err.message}`);
        process.exit(1);
    }

    for (const p of pathsToArchive) {
        safeRmRf(path.join(targetBrain, p));
    }

    const nowIso = new Date().toISOString();
    updateIndex(uuid, {
        type: 'shallow',
        title: title,
        project: project,
        timestamp: nowIso,
        lastShallowAt: nowIso,
        tarball: tarballPath
    });

    log(`✅ Shallow archive complete for ${uuid}.`);
    log(`📦 Saved to: ${tarballPath}`);
    log(`📝 Record updated in: ${INDEX_FILE}`);
    return tarballPath;
}

async function handleDeepClean(uuid, title, project, options = {}) {
    const purgeParent = Boolean(options.purgeParent);
    const noAutoOffload = Boolean(options.noAutoOffload);
    const jsonOutput = Boolean(options.json);
    const quiet = Boolean(options.quiet);
    const throwOnError = Boolean(options.throwOnError);
    const log = (...args) => {
        if (quiet) return;
        if (jsonOutput) {
            console.error(...args);
        } else {
            console.log(...args);
        }
    };

    // Snapshot SQLite row metadata BEFORE any shallow clean or DB row deletion runs
    const dbSnapshot = extractSqliteMetaFromDb(uuid);
    let resolvedTitle = title;
    let resolvedProject = project;
    if (!resolvedTitle && dbSnapshot.title) resolvedTitle = dbSnapshot.title;
    if (!resolvedProject && dbSnapshot.project) resolvedProject = dbSnapshot.project;
    const sqliteMeta = dbSnapshot.sqliteMeta;

    // 1. Pre-Clean Dependency Extraction (MUST run BEFORE handleShallowClean deletes .system_generated)
    const subagentUuids = collectDescendantSubagentUuids(uuid);
    const linkedTaskIds = collectLinkedTaskIds(uuid);
    log(`[Antigravity Mod] Pre-clean scan found ${subagentUuids.length} subagent(s) and ${linkedTaskIds.length} linked task stem(s).`);

    // 2. Best-effort Shallow Archive
    log(`[Antigravity Mod] Deep Archive 开启 - 先执行兜底 Shallow Archive...`);
    try {
        await handleShallowClean(uuid, resolvedTitle, resolvedProject, {
            bestEffort: true,
            quiet: jsonOutput || quiet,
            throwOnError: true
        });
    } catch (err) {
        log(`[Antigravity Mod] 浅层兜底跳过或无需清理 (${err.message})，继续深层打包...`);
    }

    // 3. Deep Tarball Packaging
    const pbFilePath = path.join(WORKSPACE_ROOT, 'conversations', `${uuid}.pb`);
    const targetBrain = path.join(BRAIN_DIR, uuid);
    const archiveFiles = fs.existsSync(ARCHIVES_DIR) ? fs.readdirSync(ARCHIVES_DIR) : [];
    const shallowTarballs = archiveFiles.filter(f => f.startsWith(`${uuid}_shallow_`) && f.endsWith('.tar.gz'));

    const hasPb = fs.existsSync(pbFilePath);
    const hasBrain = fs.existsSync(targetBrain);
    const hasParentFiles = hasPb || hasBrain || shallowTarballs.length > 0;

    let deepTarballName = null;
    let deepTarballPath = null;
    let sizeBytes = 0;
    let sha256 = null;

    if (!hasParentFiles) {
        if (!purgeParent) {
            const failMsg = '[Antigravity Mod] Deep Archive 失败: 未找到任何可归档的文件。';
            if (throwOnError) {
                throw new Error(failMsg);
            }
            console.error(failMsg);
            process.exit(1);
        }
        log(`[Antigravity Mod] 未发现本地待归档的父级文件（可能已归档），继续执行级联残余清理...`);
        if (sqliteMeta) {
            const existingIdx = loadIndex();
            if (existingIdx[uuid]) {
                existingIdx[uuid].sqliteMeta = { ...(existingIdx[uuid].sqliteMeta || {}), ...sqliteMeta };
                if (resolvedTitle && (!existingIdx[uuid].title || existingIdx[uuid].title === 'Unknown Title')) {
                    existingIdx[uuid].title = resolvedTitle;
                }
                if (resolvedProject && (!existingIdx[uuid].project || existingIdx[uuid].project === 'Unknown Project')) {
                    existingIdx[uuid].project = resolvedProject;
                }
                saveIndex(existingIdx);
            }
        }
    } else {
        const timestamp = Date.now();
        deepTarballName = `${uuid}_deep_${timestamp}.tar.gz`;
        deepTarballPath = path.join(ARCHIVES_DIR, deepTarballName);

        const tarArgs = ['-czf', deepTarballPath];
        if (hasPb) tarArgs.push('-C', WORKSPACE_ROOT, `conversations/${uuid}.pb`);
        if (hasBrain) tarArgs.push('-C', WORKSPACE_ROOT, `brain/${uuid}`);
        for (const file of shallowTarballs) {
            tarArgs.push('-C', ARCHIVES_DIR, file);
        }

        try {
            log(`[Antigravity Mod] 运行 tar 命令...`, tarArgs.join(' '));
            execFileSync('tar', tarArgs, {
                env: { ...process.env, COPYFILE_DISABLE: '1' },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            if (!fs.existsSync(deepTarballPath)) {
                throw new Error('Deep tarball was not created on disk');
            }
            const stat = fs.statSync(deepTarballPath);
            if (!stat.size || stat.size <= 0) {
                safeUnlink(deepTarballPath);
                throw new Error('Deep tarball size is 0 bytes');
            }

            sizeBytes = stat.size;
            sha256 = computeSha256Sync(deepTarballPath);
            log(`[Antigravity Mod] Deep Archive 打包成功: ${deepTarballName} (${sizeBytes} bytes)`);

            for (const file of shallowTarballs) {
                safeUnlink(path.join(ARCHIVES_DIR, file));
                log(`[Antigravity Mod] 已删除合并的浅层压缩包: ${file}`);
            }

            updateIndex(uuid, {
                type: 'deep',
                title: resolvedTitle,
                project: resolvedProject,
                timestamp: new Date().toISOString(),
                deepTarball: deepTarballName,
                sizeBytes,
                sha256,
                localEvicted: false,
                sqliteMeta
            });
        } catch (error) {
            if (throwOnError) {
                throw error;
            }
            console.error('[Antigravity Mod] 深层归档打包失败:', error.message);
            process.exit(1);
        }
    }

    // 4. Cascading Physical & DB Cleanup (ONLY reached after tar succeeded & verified > 0 bytes, or purgeParent with 0 local files)
    for (const subUuid of subagentUuids) {
        if (!isValidUuid(subUuid) || subUuid.toLowerCase() === uuid.toLowerCase()) continue;
        safeRmRf(path.join(BRAIN_DIR, subUuid));
        safeUnlink(path.join(WORKSPACE_ROOT, 'conversations', `${subUuid}.pb`));
    }

    const removedTmpLogs = cleanTaskExecutionLogs(linkedTaskIds);

    // Always remove parent brain/<uuid> once safely inside deep tarball
    safeRmRf(targetBrain);

    const dbUuidsToPurge = [...subagentUuids];
    if (purgeParent) {
        safeUnlink(pbFilePath);
        dbUuidsToPurge.push(uuid);
    }

    if (dbUuidsToPurge.length > 0) {
        deleteUuidsFromLocalSqlite(dbUuidsToPurge);
        deleteUuidsFromRemoteSqlite(dbUuidsToPurge);
    }

    // 5. Auto-Offload Trigger (detached background upload + eviction)
    let autoOffloadSpawned = false;
    const storageConfig = loadStorageConfig();
    if (!noAutoOffload && storageConfig.enabled && storageConfig.rcloneDest && deepTarballPath && fs.existsSync(deepTarballPath)) {
        try {
            const child = child_process.spawn(process.execPath, [__filename, 'offload', uuid], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            });
            child.unref();
            autoOffloadSpawned = true;
            log(`[Antigravity Mod] 已触发后台自动上云卸载 (offload ${uuid})。`);
        } catch (spawnErr) {
            log(`[Antigravity Mod] 后台 offload 派生警告: ${spawnErr.message}`);
        }
    } else if (!storageConfig.enabled || !storageConfig.rcloneDest) {
        log(`[Antigravity Mod] 远端归档存储未配置（留空），深归档包保留在本地，跳过自动上云。`);
    }

    const summary = {
        success: true,
        uuid,
        deepTarball: deepTarballName,
        sizeBytes,
        sha256,
        purgedParent: purgeParent,
        cleanedSubagents: subagentUuids,
        linkedTaskIds,
        removedTmpLogs,
        autoOffloadSpawned
    };

    if (jsonOutput) {
        console.log(JSON.stringify(summary));
    } else {
        log(`[Antigravity Mod] 深层归档与级联清理已完成 (子代理: ${subagentUuids.length}, 任务日志: ${removedTmpLogs.length}, 父级彻底清除: ${purgeParent})。`);
    }
    return summary;
}

function reconcileLocalDeepTarballsInIndex() {
    const indexData = loadIndex();
    if (!fs.existsSync(ARCHIVES_DIR)) return { indexData, localDeepFiles: [] };

    const allFiles = fs.readdirSync(ARCHIVES_DIR);
    const parsedDeepFiles = [];

    for (const file of allFiles) {
        const match = file.match(/^([a-f0-9][a-f0-9\-]{3,63})_deep_(\d+)\.tar\.gz$/i);
        if (!match) continue;
        const fileUuid = match[1];
        const tsNum = Number(match[2]);
        const fullPath = path.join(ARCHIVES_DIR, file);
        let stat;
        try {
            stat = fs.statSync(fullPath);
            if (!stat.isFile()) continue;
        } catch (e) {
            continue;
        }
        parsedDeepFiles.push({
            uuid: fileUuid,
            tarball: file,
            tsNum,
            fullPath,
            sizeBytes: stat.size
        });
    }

    // Sort ascending by uuid, then timestamp so the newest deep archive for a UUID is processed last
    parsedDeepFiles.sort((a, b) => {
        if (a.uuid !== b.uuid) return a.uuid.localeCompare(b.uuid);
        return a.tsNum - b.tsNum;
    });

    let dirty = false;
    for (const item of parsedDeepFiles) {
        if (!indexData[item.uuid]) {
            const dbMeta = extractSqliteMetaFromDb(item.uuid);
            indexData[item.uuid] = {
                title: dbMeta.title || 'Unknown Title',
                project: dbMeta.project || 'Unknown Project',
                shallowArchives: [],
                deepArchive: null
            };
            if (dbMeta.sqliteMeta) {
                indexData[item.uuid].sqliteMeta = dbMeta.sqliteMeta;
            }
            dirty = true;
        }
        const curDeep = indexData[item.uuid].deepArchive;
        if (!curDeep) {
            indexData[item.uuid].deepArchive = {
                timestamp: new Date(item.tsNum).toISOString(),
                tarball: item.tarball,
                sizeBytes: item.sizeBytes,
                localEvicted: false
            };
            dirty = true;
        } else if (curDeep.tarball !== item.tarball) {
            const curMatch = String(curDeep.tarball || '').match(/_deep_(\d+)\.tar\.gz$/);
            const curTs = curMatch ? Number(curMatch[1]) : 0;
            if (!Array.isArray(indexData[item.uuid].extraDeepArchives)) {
                indexData[item.uuid].extraDeepArchives = [];
            }
            if (item.tsNum >= curTs) {
                if (curDeep.tarball && !indexData[item.uuid].extraDeepArchives.some(x => x.tarball === curDeep.tarball)) {
                    indexData[item.uuid].extraDeepArchives.push({ ...curDeep });
                }
                indexData[item.uuid].deepArchive = {
                    timestamp: new Date(item.tsNum).toISOString(),
                    tarball: item.tarball,
                    sizeBytes: item.sizeBytes,
                    localEvicted: false
                };
                dirty = true;
            } else if (!indexData[item.uuid].extraDeepArchives.some(x => x.tarball === item.tarball)) {
                indexData[item.uuid].extraDeepArchives.push({
                    timestamp: new Date(item.tsNum).toISOString(),
                    tarball: item.tarball,
                    sizeBytes: item.sizeBytes,
                    localEvicted: false
                });
                dirty = true;
            }
        }
    }

    if (dirty) {
        saveIndex(indexData);
    }

    return { indexData, localDeepFiles: parsedDeepFiles };
}

function offloadSingleTarball(fileUuid, tarballName, log) {
    const storageConfig = loadStorageConfig();
    if (!storageConfig.enabled || !storageConfig.rcloneDest) {
        throw new Error(`Remote archive storage is not configured (empty or disabled). Offload aborted.`);
    }
    const { rcloneDest, pveHost } = storageConfig;
    if (!pveHost) {
        throw new Error(`Remote host is not configured (empty). Offload aborted.`);
    }

    if (!isSafeFilename(tarballName)) {
        throw new Error(`Unsafe tarball filename: ${tarballName}`);
    }
    const localPath = path.join(ARCHIVES_DIR, tarballName);
    if (!fs.existsSync(localPath)) {
        throw new Error(`Local tarball does not exist: ${localPath}`);
    }

    const sizeBytes = fs.statSync(localPath).size;
    const sha256 = computeSha256Sync(localPath);
    const remotePath = `${rcloneDest}/${tarballName}`;

    log(`[Offload] Uploading ${tarballName} (${sizeBytes} bytes, sha256=${sha256.slice(0, 12)}...) via ${pveHost} -> ${remotePath}`);

    let lsjsonOutput = '';
    const stagingDir = '/mnt/pve/hdd-storage/UploadCache';
    const remoteDir = rcloneDest.replace(/^alist:\/?/, '/');
    const pyCopyScript = [
        'import sys, subprocess, json, urllib.request, time, os',
        'filename = sys.argv[1]',
        'dst_dir = sys.argv[2]',
        'uc_path = f"/mnt/pve/hdd-storage/UploadCache/{filename}"',
        'try:',
        '    r = subprocess.run(["pct", "exec", "103", "--", "python3", "-c", "import sqlite3; c=sqlite3.connect(\'file:/opt/alist/data/data.db?mode=ro\', uri=True); print(c.execute(\\"SELECT value FROM x_setting_items WHERE key=\'token\'\\").fetchone()[0])"], capture_output=True, text=True, timeout=10)',
        '    token = r.stdout.strip()',
        '    if not token: raise RuntimeError("Failed to read AList token from CT103")',
        '    def ap(path, data):',
        '        req = urllib.request.Request("http://172.16.51.13:5244" + path, data=json.dumps(data).encode("utf-8"), headers={"Authorization": token, "Content-Type": "application/json"}, method="POST")',
        '        with urllib.request.urlopen(req, timeout=25) as resp: return json.loads(resp.read())',
        '    def ag(path):',
        '        req = urllib.request.Request("http://172.16.51.13:5244" + path, headers={"Authorization": token}, method="GET")',
        '        with urllib.request.urlopen(req, timeout=25) as resp: return json.loads(resp.read())',
        '    found = False',
        '    for _ in range(15):',
        '        res = ap("/api/fs/list", {"path": "/UploadCache", "refresh": True})',
        '        items = (res.get("data") or {}).get("content") or []',
        '        if any(x.get("name") == filename for x in items): found = True; break',
        '        time.sleep(0.5)',
        '    if not found: raise RuntimeError(f"File {filename} not visible in /UploadCache")',
        '    ap("/api/fs/list", {"path": dst_dir, "refresh": True})',
        '    rc = ap("/api/fs/copy", {"src_dir": "/UploadCache", "dst_dir": dst_dir, "names": [filename]})',
        '    if rc.get("code") != 200:',
        '        if "exists" not in str(rc.get("message", "")).lower(): raise RuntimeError(f"AList copy failed: {rc.get(\'message\')}")',
        '    else:',
        '        tid = rc["data"]["tasks"][0]["id"]',
        '        for _ in range(300):',
        '            time.sleep(1)',
        '            done = ag("/api/admin/task/copy/done")',
        '            t = next((x for x in (done.get("data") or []) if x.get("id") == tid), None)',
        '            if t:',
        '                if t.get("state") == 2: break',
        '                else: raise RuntimeError(f"AList copy failed state={t.get(\'state\')}: {t.get(\'error\')}")',
        '    ap("/api/fs/list", {"path": dst_dir, "refresh": True})',
        '    r_ls = subprocess.run(["rclone", "lsjson", f"alist:{dst_dir.lstrip(\'/\')}/{filename}"], capture_output=True, text=True, timeout=20)',
        '    if r_ls.returncode != 0: raise RuntimeError(f"rclone lsjson failed: {r_ls.stderr}")',
        '    print(r_ls.stdout.strip())',
        'finally:',
        '    if os.path.exists(uc_path): os.remove(uc_path)',
        '    try: ap("/api/fs/list", {"path": "/UploadCache", "refresh": True})',
        '    except Exception: pass'
    ].join('\n');

    try {
        execFileSync('scp', [
            '-o', 'ConnectTimeout=15',
            '-o', 'StrictHostKeyChecking=no',
            localPath,
            `${pveHost}:${stagingDir}/${tarballName}`
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 600000
        });

        lsjsonOutput = execFileSync('ssh', [
            '-o', 'ConnectTimeout=15',
            '-o', 'StrictHostKeyChecking=no',
            pveHost,
            `python3 - '${tarballName}' '${remoteDir}'`
        ], {
            input: pyCopyScript,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 600000
        });
    } finally {
        try {
            execFileSync('ssh', [
                '-o', 'ConnectTimeout=15',
                '-o', 'StrictHostKeyChecking=no',
                pveHost,
                `rm -f '${stagingDir}/${tarballName}'`
            ], {
                stdio: 'ignore',
                timeout: 30000
            });
        } catch (cleanupErr) {
            // Ignore cleanup failure in finally
        }
    }

    let parsed;
    try {
        parsed = JSON.parse((lsjsonOutput || '').trim());
    } catch (parseErr) {
        throw new Error(`Failed to parse rclone lsjson output for ${tarballName}: ${lsjsonOutput}`);
    }

    if (!Array.isArray(parsed) || parsed.length !== 1 || Number(parsed[0].Size) !== sizeBytes) {
        const gotSize = Array.isArray(parsed) && parsed.length === 1 ? parsed[0].Size : 'invalid';
        throw new Error(`Remote size verification failed for ${tarballName}: expected ${sizeBytes}, got ${gotSize}`);
    }

    // Verification passed! Update archive_index.json (preserving sqliteMeta & metadata) and unlink local tarball
    const indexData = loadIndex();
    if (!indexData[fileUuid]) {
        const dbMeta = extractSqliteMetaFromDb(fileUuid);
        indexData[fileUuid] = {
            title: dbMeta.title || 'Unknown Title',
            project: dbMeta.project || 'Unknown Project',
            shallowArchives: [],
            deepArchive: null
        };
        if (dbMeta.sqliteMeta) {
            indexData[fileUuid].sqliteMeta = dbMeta.sqliteMeta;
        }
    }

    const tsMatch = tarballName.match(/_deep_(\d+)\.tar\.gz$/);
    const derivedTs = tsMatch ? new Date(Number(tsMatch[1])).toISOString() : new Date().toISOString();
    const curDeep = indexData[fileUuid].deepArchive;
    const existingTimestamp = (curDeep && curDeep.tarball === tarballName && curDeep.timestamp)
        ? curDeep.timestamp
        : derivedTs;

    const offloadedRecord = {
        timestamp: existingTimestamp,
        tarball: tarballName,
        sizeBytes,
        sha256,
        storage: rcloneDest.startsWith('alist:') ? 'alist:115' : 'cloud',
        remotePath,
        offloadedAt: new Date().toISOString(),
        localEvicted: true
    };

    if (!curDeep || curDeep.tarball === tarballName) {
        indexData[fileUuid].deepArchive = offloadedRecord;
    } else {
        const curMatch = String(curDeep.tarball || '').match(/_deep_(\d+)\.tar\.gz$/);
        const curTs = curMatch ? Number(curMatch[1]) : 0;
        const newTs = tsMatch ? Number(tsMatch[1]) : Date.now();
        if (!Array.isArray(indexData[fileUuid].extraDeepArchives)) {
            indexData[fileUuid].extraDeepArchives = [];
        }
        if (newTs >= curTs) {
            indexData[fileUuid].extraDeepArchives = indexData[fileUuid].extraDeepArchives.filter(x => x.tarball !== curDeep.tarball);
            indexData[fileUuid].extraDeepArchives.push({ ...curDeep });
            indexData[fileUuid].deepArchive = offloadedRecord;
        } else {
            indexData[fileUuid].extraDeepArchives = indexData[fileUuid].extraDeepArchives.filter(x => x.tarball !== tarballName);
            indexData[fileUuid].extraDeepArchives.push(offloadedRecord);
        }
    }

    saveIndex(indexData);
    fs.unlinkSync(localPath);
    log(`[Offload] ✅ Verified & evicted local file: ${tarballName}`);

    return {
        uuid: fileUuid,
        tarball: tarballName,
        sizeBytes,
        sha256,
        remotePath,
        localEvicted: true
    };
}

function handleOffload(targetUuidOrAll, options = {}) {
    const isAll = targetUuidOrAll === '--all' || Boolean(options.all);
    const jsonOutput = Boolean(options.json);
    const log = (...args) => {
        if (jsonOutput) {
            console.error(...args);
        } else {
            console.log(...args);
        }
    };

    const storageConfig = loadStorageConfig();
    if (!storageConfig.enabled || !storageConfig.rcloneDest) {
        log(`[Offload] 远端存储未配置（留空或已禁用），跳过上云。`);
        if (jsonOutput) {
            console.log(JSON.stringify({
                success: true,
                skipped: true,
                reason: 'unconfigured',
                offloadedCount: 0,
                failedCount: 0
            }));
        }
        return;
    }

    if (isAll) {
        const { localDeepFiles } = reconcileLocalDeepTarballsInIndex();
        const uploaded = [];
        const failed = [];

        for (const item of localDeepFiles) {
            try {
                const res = offloadSingleTarball(item.uuid, item.tarball, log);
                uploaded.push(res);
            } catch (err) {
                log(`[Offload] ❌ Failed ${item.tarball}: ${err.message}`);
                failed.push({
                    uuid: item.uuid,
                    tarball: item.tarball,
                    error: err.message
                });
            }
        }

        const result = {
            success: failed.length === 0,
            mode: 'all',
            offloadedCount: uploaded.length,
            failedCount: failed.length,
            offloaded: uploaded,
            failed
        };

        if (jsonOutput) {
            console.log(JSON.stringify(result));
        } else {
            log(`[Offload] Batch complete: ${uploaded.length} offloaded, ${failed.length} failed.`);
        }
        if (failed.length > 0) {
            process.exit(1);
        }
        return;
    }

    if (!isValidUuid(targetUuidOrAll)) {
        const msg = `Invalid or missing UUID for offload: ${targetUuidOrAll || ''}`;
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, error: msg }));
        } else {
            console.error(msg);
        }
        process.exit(1);
    }

    const uuid = targetUuidOrAll;
    const allFiles = fs.existsSync(ARCHIVES_DIR) ? fs.readdirSync(ARCHIVES_DIR) : [];
    const matchingFiles = allFiles
        .filter(f => f.startsWith(`${uuid}_deep_`) && f.endsWith('.tar.gz'))
        .sort();

    const indexData = loadIndex();
    const indexedTarball = indexData[uuid] && indexData[uuid].deepArchive && indexData[uuid].deepArchive.tarball
        ? path.basename(indexData[uuid].deepArchive.tarball)
        : null;

    if (indexedTarball && !matchingFiles.includes(indexedTarball) && fs.existsSync(path.join(ARCHIVES_DIR, indexedTarball))) {
        matchingFiles.push(indexedTarball);
    }

    if (matchingFiles.length === 0) {
        const existingDeep = indexData[uuid] && indexData[uuid].deepArchive;
        if (existingDeep && existingDeep.localEvicted && existingDeep.remotePath) {
            const alreadyResult = {
                success: true,
                uuid,
                alreadyOffloaded: true,
                deepArchive: existingDeep
            };
            if (jsonOutput) {
                console.log(JSON.stringify(alreadyResult));
            } else {
                log(`[Offload] ${uuid} is already offloaded to ${existingDeep.remotePath}.`);
            }
            return;
        }
        const errMsg = `No local deep tarball found for ${uuid}`;
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, error: errMsg }));
        } else {
            console.error(errMsg);
        }
        process.exit(1);
    }

    try {
        const results = [];
        for (const tarballName of matchingFiles) {
            results.push(offloadSingleTarball(uuid, tarballName, log));
        }
        const payload = {
            success: true,
            uuid,
            offloadedCount: results.length,
            offloaded: results
        };
        if (jsonOutput) {
            console.log(JSON.stringify(payload));
        }
    } catch (err) {
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, uuid, error: err.message }));
        } else {
            console.error(`[Offload] Error offloading ${uuid}: ${err.message}`);
        }
        process.exit(1);
    }
}

function upsertConversationsFtsArchived(dbPath, uuid, archivedStr, nowUtc, title, project) {
    const ftsCols = getTableColumns(dbPath, 'conversations_fts');
    if (ftsCols.length === 0) return;

    const escapedUuid = uuid.replace(/'/g, "''");
    const countRows = sqliteQueryJson(
        dbPath,
        `SELECT COUNT(*) AS cnt FROM conversations_fts WHERE conversation_id = '${escapedUuid}';`
    );
    const count = countRows.length > 0 ? Number(countRows[0].cnt || 0) : 0;
    const colSet = new Set(ftsCols.map(c => c.name));

    if (count > 0) {
        const setParts = [`archived = ${sqlQuote(archivedStr)}`];
        if (archivedStr === '0' && colSet.has('last_modified_time') && nowUtc) {
            setParts.push(`last_modified_time = ${sqlQuote(nowUtc)}`);
        }
        sqliteExec(
            dbPath,
            `UPDATE conversations_fts SET ${setParts.join(', ')} WHERE conversation_id = '${escapedUuid}';`
        );
    } else {
        const desiredFts = {
            conversation_id: uuid,
            chunk_index: 0,
            chunk_first_step: 0,
            chunk_last_step: 1,
            last_modified_time: nowUtc || formatNowSqliteUtc(),
            step_count: 1,
            last_step_created_at: nowUtc || formatNowSqliteUtc(),
            archived: archivedStr,
            user_step_byte_offsets: '',
            agent_step_byte_offsets: '',
            title: title || '',
            workspace: '',
            project: project || '',
            user_body: '',
            agent_body: ''
        };
        const insertCols = [];
        const insertVals = [];
        for (const col of ftsCols) {
            if (Object.prototype.hasOwnProperty.call(desiredFts, col.name)) {
                insertCols.push(col.name);
                insertVals.push(sqlQuote(desiredFts[col.name]));
            }
        }
        if (insertCols.length > 0) {
            sqliteExec(
                dbPath,
                `INSERT INTO conversations_fts (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')});`
            );
        }
    }
}

/**
 * Re-hydrates `conversation_summaries` and `conversations_fts` (`archived = '0'`, fresh UTC `last_modified_time`)
 * when restoring a cold-archived session so it immediately reappears as an active conversation with a fresh 30d timer.
 */
function rehydrateSqliteOnRestore(uuid, entryRecord) {
    const dbPath = path.join(WORKSPACE_ROOT, 'conversation_summaries.db');
    if (!fs.existsSync(dbPath) || !isValidUuid(uuid)) {
        return false;
    }

    const nowUtc = formatNowSqliteUtc();
    const escapedUuid = uuid.replace(/'/g, "''");
    const meta = (entryRecord && entryRecord.sqliteMeta) || {};
    const entryTitle = (entryRecord && entryRecord.title && entryRecord.title !== 'Unknown Title' && entryRecord.title !== 'Unknown')
        ? String(entryRecord.title)
        : '';
    const resolvedTitle = (meta.title && String(meta.title).trim()) ? String(meta.title).trim() : (entryTitle || `Restored (${uuid.slice(0, 8)})`);
    const resolvedProject = (entryRecord && entryRecord.project && entryRecord.project !== 'Unknown Project' && entryRecord.project !== 'Unknown')
        ? String(entryRecord.project)
        : (parseProjectFromWorkspaceUris(meta.workspace_uris) || 'General');

    const resolvedWsUris = (meta.workspace_uris !== undefined && meta.workspace_uris !== null && meta.workspace_uris !== '')
        ? String(meta.workspace_uris)
        : (resolvedProject && resolvedProject !== 'General' && resolvedProject !== 'Unknown Project'
            ? JSON.stringify(['file:///restored/' + encodeURIComponent(resolvedProject)])
            : '[]');

    const stepCount = Math.max(1, Number(meta.step_count) || 1);
    const lastUserStepIdx = (
        meta.last_user_input_step_index !== undefined &&
        meta.last_user_input_step_index !== null &&
        Number(meta.last_user_input_step_index) >= 0
    )
        ? Number(meta.last_user_input_step_index)
        : 0;

    const csCols = getTableColumns(dbPath, 'conversation_summaries');
    if (csCols.length > 0) {
        const existingRows = sqliteQueryJson(
            dbPath,
            `SELECT conversation_id FROM conversation_summaries WHERE conversation_id = '${escapedUuid}' LIMIT 1;`
        );
        const csColNames = new Set(csCols.map(c => c.name));

        if (existingRows.length > 0) {
            const setClauses = [];
            if (csColNames.has('last_modified_time')) setClauses.push(`last_modified_time = ${sqlQuote(nowUtc)}`);
            if (csColNames.has('last_user_input_time')) setClauses.push(`last_user_input_time = ${sqlQuote(nowUtc)}`);
            if (setClauses.length > 0) {
                sqliteExec(
                    dbPath,
                    `UPDATE conversation_summaries SET ${setClauses.join(', ')} WHERE conversation_id = '${escapedUuid}';`
                );
            }
        } else {
            const desiredCs = {
                conversation_id: uuid,
                title: resolvedTitle,
                preview: meta.preview !== undefined && meta.preview !== null ? String(meta.preview) : resolvedTitle,
                status: 'CASCADE_RUN_STATUS_IDLE',
                not_fully_idle: 0,
                step_count: stepCount,
                workspace_uris: resolvedWsUris,
                project_id: meta.project_id !== undefined && meta.project_id !== null ? String(meta.project_id) : '',
                nesting_depth: 0,
                parent_conversation_id: '',
                source: meta.source !== undefined && meta.source !== null ? String(meta.source) : '',
                last_user_input_step_index: lastUserStepIdx,
                app_data_dir: meta.app_data_dir !== undefined && meta.app_data_dir !== null ? String(meta.app_data_dir) : WORKSPACE_ROOT,
                created_time: meta.created_time || nowUtc,
                last_modified_time: nowUtc,
                last_user_input_time: nowUtc
            };

            const insertCols = [];
            const insertVals = [];
            for (const col of csCols) {
                if (Object.prototype.hasOwnProperty.call(desiredCs, col.name)) {
                    insertCols.push(col.name);
                    insertVals.push(sqlQuote(desiredCs[col.name]));
                } else if (Number(col.notnull) === 1 && col.dflt_value === null && Number(col.pk) === 0) {
                    insertCols.push(col.name);
                    const isNumType = /INT|REAL|FLOA|DOUB|NUM|BOOL/i.test(String(col.type || ''));
                    insertVals.push(isNumType ? '0' : "''");
                }
            }

            if (insertCols.length > 0) {
                sqliteExec(
                    dbPath,
                    `INSERT INTO conversation_summaries (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')});`
                );
            }
        }
    }

    upsertConversationsFtsArchived(dbPath, uuid, '0', nowUtc, resolvedTitle, resolvedProject);
    return true;
}

function handleRestore(uuid, options = {}) {
    const jsonOutput = Boolean(options.json);
    const log = (...args) => {
        if (jsonOutput) {
            console.error(...args);
        } else {
            console.log(...args);
        }
    };

    if (!isValidUuid(uuid)) {
        const msg = `Invalid or missing UUID for restore: ${uuid || ''}`;
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, error: msg }));
        } else {
            console.error(msg);
        }
        process.exit(1);
    }

    const indexData = loadIndex();
    let deep = indexData[uuid] && indexData[uuid].deepArchive ? indexData[uuid].deepArchive : null;

    if (!deep && fs.existsSync(ARCHIVES_DIR)) {
        const fallbackFiles = fs.readdirSync(ARCHIVES_DIR)
            .filter(f => f.startsWith(`${uuid}_deep_`) && f.endsWith('.tar.gz'))
            .sort();
        if (fallbackFiles.length > 0) {
            deep = { tarball: fallbackFiles[fallbackFiles.length - 1] };
        }
    }

    if (!deep || !deep.tarball) {
        const msg = `No deep archive record found for ${uuid}`;
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, uuid, error: msg }));
        } else {
            console.error(msg);
        }
        process.exit(1);
    }

    const tarballName = path.basename(deep.tarball);
    if (!isSafeFilename(tarballName)) {
        const msg = `Unsafe tarball name in index: ${tarballName}`;
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, uuid, error: msg }));
        } else {
            console.error(msg);
        }
        process.exit(1);
    }

    if (!fs.existsSync(ARCHIVES_DIR)) {
        fs.mkdirSync(ARCHIVES_DIR, { recursive: true });
    }
    const localTarballPath = path.join(ARCHIVES_DIR, tarballName);
    let downloadedFromRemote = false;

    try {
        if (!fs.existsSync(localTarballPath)) {
            if (!deep.remotePath) {
                throw new Error(`Local tarball missing (${tarballName}) and no remotePath recorded in archive_index.json`);
            }
            if (/['"`$\\;]/.test(deep.remotePath)) {
                throw new Error(`Unsafe remotePath in index: ${deep.remotePath}`);
            }

            const storageConfig = loadStorageConfig();
            const pveHost = storageConfig.pveHost;
            if (!pveHost) {
                throw new Error(`Cannot pull cold archive: remote host is not configured (empty). Please configure archive_config.json.`);
            }

            log(`[Restore] Pulling ${deep.remotePath} via ${pveHost} -> ${localTarballPath}...`);
            try {
                execFileSync('ssh', [
                    '-o', 'ConnectTimeout=15',
                    '-o', 'StrictHostKeyChecking=no',
                    pveHost,
                    `rclone copyto '${deep.remotePath}' '/tmp/${tarballName}'`
                ], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 600000
                });

                execFileSync('scp', [
                    '-o', 'ConnectTimeout=15',
                    '-o', 'StrictHostKeyChecking=no',
                    `${pveHost}:/tmp/${tarballName}`,
                    localTarballPath
                ], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 600000
                });
                downloadedFromRemote = true;
            } finally {
                try {
                    execFileSync('ssh', [
                        '-o', 'ConnectTimeout=15',
                        '-o', 'StrictHostKeyChecking=no',
                        pveHost,
                        `rm -f '/tmp/${tarballName}'`
                    ], {
                        stdio: 'ignore',
                        timeout: 30000
                    });
                } catch (cleanupErr) {}
            }
        }

        if (!fs.existsSync(localTarballPath)) {
            throw new Error(`Failed to obtain local tarball at ${localTarballPath}`);
        }

        const actualSize = fs.statSync(localTarballPath).size;
        if (typeof deep.sizeBytes === 'number' && deep.sizeBytes > 0 && actualSize !== deep.sizeBytes) {
            if (downloadedFromRemote) safeUnlink(localTarballPath);
            throw new Error(`Size verification failed on restore: expected ${deep.sizeBytes}, got ${actualSize}`);
        }

        const actualSha256 = computeSha256Sync(localTarballPath);
        if (deep.sha256 && actualSha256 !== deep.sha256) {
            if (downloadedFromRemote) safeUnlink(localTarballPath);
            throw new Error(`SHA-256 verification failed on restore: expected ${deep.sha256}, got ${actualSha256}`);
        }

        fs.mkdirSync(path.join(WORKSPACE_ROOT, 'conversations'), { recursive: true });
        fs.mkdirSync(BRAIN_DIR, { recursive: true });

        execFileSync('tar', ['-xzf', localTarballPath, '-C', WORKSPACE_ROOT], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Extract any nested *_shallow_*.tar.gz packed inside the deep tarball back into brain/<uuid>
        const wsFiles = fs.readdirSync(WORKSPACE_ROOT);
        const extractedShallows = wsFiles
            .filter(f => f.startsWith(`${uuid}_shallow_`) && f.endsWith('.tar.gz'))
            .sort();

        const restoredBrainDir = path.join(BRAIN_DIR, uuid);
        let nestedShallowsRestored = 0;
        if (extractedShallows.length > 0) {
            fs.mkdirSync(restoredBrainDir, { recursive: true });
            for (const shallowName of extractedShallows) {
                const shallowFullPath = path.join(WORKSPACE_ROOT, shallowName);
                try {
                    execFileSync('tar', ['-xzf', shallowFullPath, '-C', restoredBrainDir], {
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                    nestedShallowsRestored++;
                } catch (nestedErr) {
                    log(`[Restore] Warning: could not extract nested shallow archive ${shallowName}: ${nestedErr.message}`);
                } finally {
                    safeUnlink(shallowFullPath);
                }
            }
        }

        // Update archive_index.json with restoredAt (preserving sqliteMeta)
        const latestIndex = loadIndex();
        if (!latestIndex[uuid]) {
            latestIndex[uuid] = {
                title: 'Unknown Title',
                project: 'Unknown Project',
                shallowArchives: [],
                deepArchive: { tarball: tarballName }
            };
        }
        if (!latestIndex[uuid].deepArchive) {
            latestIndex[uuid].deepArchive = { tarball: tarballName };
        }
        latestIndex[uuid].deepArchive.restoredAt = new Date().toISOString();
        latestIndex[uuid].deepArchive.localEvicted = false;
        latestIndex[uuid].deepArchive.sizeBytes = actualSize;
        latestIndex[uuid].deepArchive.sha256 = actualSha256;
        delete latestIndex[uuid].lastShallowAt;
        saveIndex(latestIndex);

        const rehydratedSqlite = rehydrateSqliteOnRestore(uuid, latestIndex[uuid]);
        const restoredPb = fs.existsSync(path.join(WORKSPACE_ROOT, 'conversations', `${uuid}.pb`));
        const restoredBrain = fs.existsSync(restoredBrainDir);

        const payload = {
            success: true,
            uuid,
            tarball: tarballName,
            downloadedFromRemote,
            sizeBytes: actualSize,
            sha256: actualSha256,
            restoredPb,
            restoredBrain,
            nestedShallowsRestored,
            rehydratedSqlite,
            restoredAt: latestIndex[uuid].deepArchive.restoredAt
        };

        if (jsonOutput) {
            console.log(JSON.stringify(payload));
        } else {
            log(`[Restore] ✅ Cold restore complete for ${uuid} (pb=${restoredPb}, brain=${restoredBrain}, nestedShallow=${nestedShallowsRestored}, sqlite=${rehydratedSqlite}).`);
        }
    } catch (err) {
        if (jsonOutput) {
            console.log(JSON.stringify({ success: false, uuid, error: err.message }));
        } else {
            console.error(`[Restore] ❌ Failed to restore ${uuid}: ${err.message}`);
        }
        process.exit(1);
    }
}

async function handleLifecycle(options = {}) {
    const dryRun = Boolean(options.dryRun);
    const force = Boolean(options.force);
    const noAutoOffload = Boolean(options.noAutoOffload);
    const jsonOutput = Boolean(options.json);
    const shallowDays = (options.shallowDays !== undefined && Number.isFinite(Number(options.shallowDays)) && Number(options.shallowDays) >= 0)
        ? Number(options.shallowDays)
        : 30;
    const deepDays = (options.deepDays !== undefined && Number.isFinite(Number(options.deepDays)) && Number(options.deepDays) >= 0)
        ? Number(options.deepDays)
        : 30;
    const currentUuid = options.currentUuid || '';

    const log = (...args) => {
        if (jsonOutput) {
            console.error(...args);
        } else {
            console.log(...args);
        }
    };

    // 1. 24h Server-Side Debounce (stored exclusively in lifecycle_meta.json, NEVER inside archive_index.json)
    const meta = loadLifecycleMeta();
    if (!dryRun && !force && meta.lastAutoLifecycleAt) {
        const lastMs = Date.parse(meta.lastAutoLifecycleAt);
        if (Number.isFinite(lastMs) && (Date.now() - lastMs < 24 * 3600 * 1000)) {
            const skippedPayload = {
                success: true,
                skipped: true,
                reason: 'debounced_24h',
                lastAutoLifecycleAt: meta.lastAutoLifecycleAt
            };
            if (jsonOutput) {
                console.log(JSON.stringify(skippedPayload));
            } else {
                log(`[Lifecycle] Skipped (24h debounce active since ${meta.lastAutoLifecycleAt}).`);
            }
            return skippedPayload;
        }
    }

    const dbPath = path.join(WORKSPACE_ROOT, 'conversation_summaries.db');
    const stage1Candidates = [];
    const stage2Candidates = [];
    const stage1Executed = [];
    const stage2Executed = [];
    const lockedSkipped = [];
    const errors = [];

    if (!fs.existsSync(dbPath)) {
        const emptyRes = {
            success: true,
            dryRun,
            shallowDays,
            deepDays,
            stage1Candidates,
            stage2Candidates,
            stage1Executed,
            stage2Executed,
            lockedSkipped,
            errors,
            lastAutoLifecycleAt: meta.lastAutoLifecycleAt || null
        };
        if (jsonOutput) console.log(JSON.stringify(emptyRes));
        return emptyRes;
    }

    // 2. Active Kanban Session Lock Set + Current Open Session Lock
    const lockedSessions = collectActiveKanbanLockedSessions(currentUuid);

    // 3. Query Main Conversations BEFORE any Stage 1 mutation (preserving Revival Guard pre-run state)
    const initialIndexData = loadIndex();
    const sql = `
        SELECT
            cs.conversation_id,
            COALESCE(cs.title, '') AS title,
            COALESCE(cs.preview, '') AS preview,
            COALESCE(cs.status, '') AS status,
            COALESCE(CAST(cs.not_fully_idle AS TEXT), '0') AS not_fully_idle,
            COALESCE(cs.workspace_uris, '') AS workspace_uris,
            COALESCE(cs.last_modified_time, '') AS last_modified_time,
            COALESCE(fts.archived, 0) AS archived
        FROM conversation_summaries cs
        LEFT JOIN (
            SELECT conversation_id, MAX(CAST(archived AS INTEGER)) AS archived
            FROM conversations_fts
            GROUP BY conversation_id
        ) fts ON cs.conversation_id = fts.conversation_id
        WHERE cs.nesting_depth = 0
          AND (cs.parent_conversation_id IS NULL OR cs.parent_conversation_id = '')
          AND (cs.source IS NULL OR cs.source = '' OR cs.source != 'CORTEX_TRAJECTORY_SOURCE_CLI')
          AND NOT (
              (cs.title IS NULL OR cs.title = '' OR cs.title = 'Untitled Conversation')
              AND cs.last_user_input_step_index = -1
              AND (cs.preview IS NULL OR cs.preview = '')
          );
    `;

    const rows = sqliteQueryJson(dbPath, sql);
    const nowMs = Date.now();
    const shallowThresholdMs = shallowDays * 86400 * 1000;
    const deepThresholdMs = deepDays * 86400 * 1000;

    const stage1Rows = [];
    const stage2Rows = [];

    for (const row of rows) {
        const uuid = String(row.conversation_id || '').trim();
        if (!isValidUuid(uuid)) continue;

        const isRunning = row.status === 'CASCADE_RUN_STATUS_RUNNING' || String(row.not_fully_idle) === '1';
        if (isRunning) continue;

        const title = deriveTitleFromSummary(row.title, row.preview);
        const project = parseProjectFromWorkspaceUris(row.workspace_uris) || 'General';

        const lockInfo = lockedSessions.get(uuid.toLowerCase());
        if (lockInfo) {
            lockedSkipped.push({
                uuid,
                title,
                project,
                ...lockInfo
            });
            continue;
        }

        const lastModMs = parseSqliteUtcMs(row.last_modified_time);
        if (!Number.isFinite(lastModMs)) continue;

        const wasAlreadyArchived = String(row.archived) === '1';

        if (!wasAlreadyArchived) {
            // Stage 1 evaluation: active conversation idle > shallowDays
            if (nowMs - lastModMs > shallowThresholdMs) {
                stage1Rows.push({
                    uuid,
                    title,
                    project,
                    lastModifiedTime: row.last_modified_time,
                    idleDays: Math.floor((nowMs - lastModMs) / 86400000)
                });
            }
        } else {
            // Stage 2 evaluation (with Revival Guard: strictly ONLY conversations already archived == '1' before run)
            const idxEntry = initialIndexData[uuid] || null;
            const shallowTimestamps = [];
            if (idxEntry && Array.isArray(idxEntry.shallowArchives)) {
                for (const sa of idxEntry.shallowArchives) {
                    const parsedTs = sa && sa.timestamp ? Date.parse(sa.timestamp) : NaN;
                    if (Number.isFinite(parsedTs)) shallowTimestamps.push(parsedTs);
                }
            }
            if (idxEntry && idxEntry.lastShallowAt) {
                const parsedLastShallow = Date.parse(idxEntry.lastShallowAt);
                if (Number.isFinite(parsedLastShallow)) shallowTimestamps.push(parsedLastShallow);
            }
            const latestShallowMs = shallowTimestamps.length > 0 ? Math.max(...shallowTimestamps) : 0;
            const anchorMs = Math.max(lastModMs, latestShallowMs);

            if (nowMs - anchorMs > deepThresholdMs) {
                stage2Rows.push({
                    uuid,
                    title,
                    project,
                    lastModifiedTime: row.last_modified_time,
                    anchorIso: new Date(anchorMs).toISOString(),
                    archivedIdleDays: Math.floor((nowMs - anchorMs) / 86400000)
                });
            }
        }
    }

    for (const cand of stage1Rows) {
        stage1Candidates.push(cand);
        if (!dryRun) {
            try {
                const nowIso = new Date().toISOString();
                const ftsModTime = cand.lastModifiedTime || formatNowSqliteUtc();
                upsertConversationsFtsArchived(dbPath, cand.uuid, '1', ftsModTime, cand.title, cand.project);

                const shallowTarPath = await handleShallowClean(cand.uuid, cand.title, cand.project, {
                    bestEffort: true,
                    quiet: true,
                    throwOnError: true
                });

                // Always record lastShallowAt even if brain/<uuid> had no .system_generated / scratch left to tar
                updateIndex(cand.uuid, {
                    type: 'shallow_mark',
                    title: cand.title,
                    project: cand.project,
                    lastShallowAt: nowIso
                });

                stage1Executed.push({
                    uuid: cand.uuid,
                    title: cand.title,
                    project: cand.project,
                    shallowTarball: shallowTarPath ? path.basename(shallowTarPath) : null,
                    lastShallowAt: nowIso
                });
            } catch (err) {
                errors.push({
                    stage: 'stage1',
                    uuid: cand.uuid,
                    title: cand.title,
                    error: err.message
                });
            }
        }
    }

    for (const cand of stage2Rows) {
        stage2Candidates.push(cand);
        if (!dryRun) {
            try {
                const summary = await handleDeepClean(cand.uuid, cand.title, cand.project, {
                    purgeParent: true,
                    noAutoOffload,
                    json: false,
                    quiet: true,
                    throwOnError: true
                });
                stage2Executed.push({
                    uuid: cand.uuid,
                    title: cand.title,
                    project: cand.project,
                    deepTarball: summary.deepTarball,
                    autoOffloadSpawned: summary.autoOffloadSpawned
                });
            } catch (err) {
                errors.push({
                    stage: 'stage2',
                    uuid: cand.uuid,
                    title: cand.title,
                    error: err.message
                });
            }
        }
    }

    let lastAutoLifecycleAt = meta.lastAutoLifecycleAt || null;
    if (!dryRun) {
        lastAutoLifecycleAt = new Date().toISOString();
        saveLifecycleMeta({ lastAutoLifecycleAt });
    }

    const result = {
        success: true,
        dryRun,
        shallowDays,
        deepDays,
        stage1Candidates,
        stage2Candidates,
        stage1Executed,
        stage2Executed,
        lockedSkipped,
        errors,
        lastAutoLifecycleAt
    };

    if (jsonOutput) {
        console.log(JSON.stringify(result));
    } else {
        log(
            `[Lifecycle] Complete (dryRun=${dryRun}): stage1=${dryRun ? stage1Candidates.length : stage1Executed.length}, ` +
            `stage2=${dryRun ? stage2Candidates.length : stage2Executed.length}, lockedSkipped=${lockedSkipped.length}, errors=${errors.length}`
        );
    }

    return result;
}

async function main() {
    const command = ARGS[0];

    if (!command) {
        console.log('Usage: node agy_archive.js <clean|lookup|offload|restore|lifecycle|config> ...');
        process.exit(1);
    }

    if (command === 'config') {
        const restArgs = ARGS.slice(1);
        const flags = new Set();
        const positionals = [];
        for (const arg of restArgs) {
            if (typeof arg === 'string' && arg.startsWith('--')) {
                flags.add(arg);
            } else {
                positionals.push(arg);
            }
        }
        const subCmd = positionals[0];
        if (subCmd === 'set') {
            const rcloneDest = positionals[1] !== undefined ? positionals[1] : '';
            const pveHost = positionals[2] !== undefined ? positionals[2] : '';
            const enabled = positionals[3] !== undefined ? (positionals[3] === 'true' || positionals[3] === '1') : Boolean(rcloneDest);
            const saved = saveStorageConfig({ rcloneDest, pveHost, enabled });
            if (flags.has('--json')) {
                console.log(JSON.stringify({ success: true, config: saved }));
            } else {
                console.log(`[Archive Storage] Config saved: rcloneDest="${saved.rcloneDest}", pveHost="${saved.pveHost}", enabled=${saved.enabled}`);
            }
            return;
        }

        const current = loadStorageConfig();
        if (flags.has('--json')) {
            console.log(JSON.stringify({ success: true, config: current }));
        } else {
            console.log(`[Archive Storage] Current Config:`);
            console.log(`  Source:     ${current.source}`);
            console.log(`  ConfigFile: ${current.configFile || '(none)'}`);
            console.log(`  Enabled:    ${current.enabled}`);
            console.log(`  RcloneDest: ${current.rcloneDest || '(empty - local only)'}`);
            console.log(`  PveHost:    ${current.pveHost || '(empty)'}`);
        }
        return;
    }

    if (command === 'lookup') {
        const titleDecoded = ARGS[1] ? Buffer.from(ARGS[1], 'base64').toString('utf8') : '';
        const indexData = loadIndex();

        let foundUuid = null;
        let foundProject = null;

        // 1. Exact title match in archive_index.json
        for (const [uuid, entry] of Object.entries(indexData)) {
            if (entry && entry.title && entry.title === titleDecoded) {
                foundUuid = uuid;
                foundProject = entry.project;
                break;
            }
        }

        // 2. Fallback lookup in conversation_summaries.db
        if (!foundUuid) {
            try {
                const dbPath = path.join(WORKSPACE_ROOT, 'conversation_summaries.db');
                if (fs.existsSync(dbPath)) {
                    const escapedTitle = titleDecoded.replace(/'/g, "''");
                    const query = `SELECT conversation_id, workspace_uris FROM conversation_summaries WHERE title = '${escapedTitle}' LIMIT 1;`;
                    let result = execSync(`sqlite3 "${dbPath}" "${query}"`, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'ignore']
                    }).trim();

                    if (!result) {
                        const fuzzyQuery = `SELECT conversation_id, workspace_uris FROM conversation_summaries WHERE title LIKE '%${escapedTitle}%' ORDER BY last_modified_time DESC LIMIT 1;`;
                        result = execSync(`sqlite3 "${dbPath}" "${fuzzyQuery}"`, {
                            encoding: 'utf-8',
                            stdio: ['pipe', 'pipe', 'ignore']
                        }).trim();
                    }

                    if (result) {
                        const [cId, wsUrisRaw] = result.split('|');
                        foundUuid = cId.trim();

                        if (wsUrisRaw && !foundProject) {
                            try {
                                const uris = JSON.parse(wsUrisRaw);
                                if (Array.isArray(uris) && uris.length > 0) {
                                    foundProject = decodeURIComponent(uris[0].split('/').filter(Boolean).pop());
                                }
                            } catch (e) {}
                        }
                        console.error(`[Archive Brain] 从 conversation_summaries.db 成功命中 UUID: ${foundUuid}, Project: ${foundProject}`);
                    }
                }
            } catch (err) {
                console.error('[Archive Brain] 查询 conversation_summaries.db 失败:', err.message);
            }
        }

        if (foundUuid) {
            const deepArchive = indexData[foundUuid] ? (indexData[foundUuid].deepArchive || null) : null;
            console.log(JSON.stringify({ success: true, uuid: foundUuid, project: foundProject, deepArchive }));
        } else {
            console.log(JSON.stringify({ success: false, error: '未能在账本中找到该对话记录' }));
        }
        process.exit(0);
    }

    if (command === 'clean') {
        const restArgs = ARGS.slice(1);
        const flags = new Set();
        const positionals = [];

        for (const arg of restArgs) {
            if (typeof arg === 'string' && arg.startsWith('--')) {
                flags.add(arg);
            } else {
                positionals.push(arg);
            }
        }

        const mode = flags.has('--deep') ? '--deep' : (flags.has('--shallow') ? '--shallow' : '');
        const uuid = positionals[0] || '';
        const title = positionals[1] ? Buffer.from(positionals[1], 'base64').toString('utf8') : '';
        const project = positionals[2] ? Buffer.from(positionals[2], 'base64').toString('utf8') : '';

        if (!mode || !isValidUuid(uuid)) {
            console.error('Usage: node agy_archive.js clean <--shallow|--deep> <uuid> [titleB64] [projectB64] [--purge-parent] [--no-auto-offload]');
            process.exit(1);
        }

        if (mode === '--shallow') {
            await handleShallowClean(uuid, title, project, { quiet: flags.has('--json') });
        } else if (mode === '--deep') {
            await handleDeepClean(uuid, title, project, {
                purgeParent: flags.has('--purge-parent'),
                noAutoOffload: flags.has('--no-auto-offload'),
                json: flags.has('--json')
            });
        }
        return;
    }

    if (command === 'offload') {
        const restArgs = ARGS.slice(1);
        const flags = new Set();
        const positionals = [];
        for (const arg of restArgs) {
            if (typeof arg === 'string' && arg.startsWith('--')) {
                flags.add(arg);
            } else {
                positionals.push(arg);
            }
        }
        const target = flags.has('--all') ? '--all' : (positionals[0] || '');
        handleOffload(target, {
            all: flags.has('--all'),
            json: flags.has('--json')
        });
        return;
    }

    if (command === 'restore') {
        const restArgs = ARGS.slice(1);
        const flags = new Set();
        const positionals = [];
        for (const arg of restArgs) {
            if (typeof arg === 'string' && arg.startsWith('--')) {
                flags.add(arg);
            } else {
                positionals.push(arg);
            }
        }
        const uuid = positionals[0] || '';
        handleRestore(uuid, {
            json: flags.has('--json')
        });
        return;
    }

    if (command === 'lifecycle') {
        const restArgs = ARGS.slice(1);
        const opts = {
            dryRun: false,
            force: false,
            noAutoOffload: false,
            json: false,
            shallowDays: 30,
            deepDays: 30,
            currentUuid: ''
        };

        for (let i = 0; i < restArgs.length; i++) {
            const arg = restArgs[i];
            if (arg === '--dry-run') opts.dryRun = true;
            else if (arg === '--force') opts.force = true;
            else if (arg === '--no-auto-offload') opts.noAutoOffload = true;
            else if (arg === '--json') opts.json = true;
            else if (arg === '--shallow-days' && restArgs[i + 1] !== undefined) opts.shallowDays = Number(restArgs[++i]);
            else if (typeof arg === 'string' && arg.startsWith('--shallow-days=')) opts.shallowDays = Number(arg.split('=')[1]);
            else if (arg === '--deep-days' && restArgs[i + 1] !== undefined) opts.deepDays = Number(restArgs[++i]);
            else if (typeof arg === 'string' && arg.startsWith('--deep-days=')) opts.deepDays = Number(arg.split('=')[1]);
            else if (arg === '--current-uuid' && restArgs[i + 1] !== undefined) opts.currentUuid = String(restArgs[++i]);
            else if (typeof arg === 'string' && arg.startsWith('--current-uuid=')) opts.currentUuid = String(arg.split('=')[1]);
        }

        await handleLifecycle(opts);
        return;
    }

    console.error(`Unsupported command: ${command}`);
    process.exit(1);
}

main();
