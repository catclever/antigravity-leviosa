/**
 * KitiGravity Companion Terminal Remote-Control API
 * Path: worker/antigravity_kitty_api.js
 *
 * Manages stateful project-bound Companion Kitty OS Windows with Rhythm 2
 * exclusive visibility, Companion Pool isolation (100% protection of normal
 * user Kitty windows), Busy Guard tab spawning, Smart Lenient CWD alignment,
 * prompt prefix sanitization, and chunked Base64 command staging/execution.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const projectResolver = require('./project_resolver');

const KITTEN_CANDIDATES = [
    '/opt/homebrew/bin/kitten',
    '/usr/local/bin/kitten',
    '/Applications/kitty.app/Contents/MacOS/kitten',
    'kitten'
];

const KITTY_CANDIDATES = [
    '/opt/homebrew/bin/kitty',
    '/usr/local/bin/kitty',
    '/Applications/kitty.app/Contents/MacOS/kitty',
    'kitty'
];

const SHELL_NAMES = new Set([
    'zsh', '-zsh',
    'bash', '-bash',
    'fish', '-fish',
    'sh', '-sh',
    'dash', '-dash',
    'ksh', '-ksh',
    'tcsh', '-tcsh',
    'csh', '-csh',
    'nu', '-nu',
    'login'
]);

// In-memory chunk buffer for large commands: uploadId -> { chunks, received, total, timestamp }
const CHUNK_SESSIONS = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, session] of CHUNK_SESSIONS.entries()) {
        if (now - session.timestamp > 5 * 60 * 1000) {
            CHUNK_SESSIONS.delete(id);
        }
    }
}, 60 * 1000).unref();

function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createDefaultDeps() {
    return {
        fs,
        os,
        spawnSync: childProcess.spawnSync,
        spawn: childProcess.spawn,
        execSync: childProcess.execSync,
        projectResolver,
        sleep: defaultSleep,
        tmpDir: '/tmp',
        stateFilePath: '/tmp/agy_kitty_companion_state.json',
        logFilePath: '/tmp/ag_kitty_api.log',
        projectsConfigDir: path.join(os.homedir(), '.gemini/config/projects'),
        timings: {
            pollSocketIntervalMs: 150,
            pollSocketTimeoutMs: 5000,
            launchOsWinDelayMs: 180,
            launchTabDelayMs: 220,
            cdDelayMs: 100,
            execEnterDelayMs: 40
        }
    };
}

function safeLog(deps, msg) {
    if (!deps.logFilePath) return;
    try {
        deps.fs.appendFileSync(deps.logFilePath, `[${new Date().toISOString()}] ${msg}\n`);
    } catch (e) {}
}

function safeDecodeURIComponent(val) {
    if (typeof val !== 'string') return '';
    if (!val.includes('%')) return val;
    try {
        return decodeURIComponent(val);
    } catch (e) {
        return val;
    }
}

function resolveHome(filepath, homedir) {
    if (!filepath) return '';
    if (filepath === '~') return homedir;
    if (filepath.startsWith('~/')) {
        return path.join(homedir, filepath.slice(2));
    }
    return filepath;
}

function normalizePath(p) {
    if (!p || typeof p !== 'string') return '';
    if (p === '/') return '/';
    return p.replace(/\/+$/, '');
}

function shellSingleQuote(str) {
    return `'${String(str).replace(/'/g, "'\\''")}'`;
}

function resolveBinary(candidates, deps) {
    for (const candidate of candidates) {
        if (!candidate.includes('/')) {
            return candidate;
        }
        try {
            if (deps.fs.existsSync(candidate)) {
                return candidate;
            }
        } catch (e) {}
    }
    return candidates[candidates.length - 1];
}

/**
 * Bug Fix & Enhancement Documentation:
 * 1. Problem Fixed:
 *    When Kitty terminal is not installed on the host system, the companion API attempted to discover
 *    sockets or cold-start non-existent binaries, failing with vague error messages and giving frontend
 *    no definitive signal to gracefully hide inoperable UI quick-send buttons.
 * 2. Resolution Method:
 *    Added `isKittyInstalled(deps)` probe checking both candidate absolute paths and system PATH ('which kitten' / 'which kitty').
 *    In `executeKittyApi`:
 *    - For `action === 'status'`: always includes `installed: Boolean(installed)`. If uninstalled, returns
 *      `{ success: true, action: 'status', installed: false, running: false, exists: false, state: 'uninstalled', projectKey, message }`.
 *    - For interactive actions (`summon`, `send`, `toggle`, `send_chunk`): if uninstalled, returns
 *      `{ success: false, code: 'NOT_INSTALLED', installed: false, error: '未检测到 Kitty 终端。请先安装 Kitty (例如: brew install kitty)', projectKey }`.
 *    - Exposed `isKittyInstalled` on `handler._internals.isKittyInstalled` for testability.
 * 3. Caveats & Subsequent Development:
 *    Detection relies on standard macOS Homebrew / Applications paths or system PATH. If custom paths are used,
 *    they should be registered in KITTEN_CANDIDATES / KITTY_CANDIDATES.
 */
function isKittyInstalled(deps) {
    // Check fixed candidates
    for (const cand of KITTEN_CANDIDATES) {
        try {
            if (cand.includes('/') && deps.fs.existsSync(cand)) return true;
        } catch (e) {}
    }
    for (const cand of KITTY_CANDIDATES) {
        try {
            if (cand.includes('/') && deps.fs.existsSync(cand)) return true;
        } catch (e) {}
    }
    // Check system PATH
    try {
        const res = deps.spawnSync('which', ['kitten'], { encoding: 'utf-8', timeout: 1000 });
        if (res && res.status === 0 && res.stdout && res.stdout.trim()) return true;
    } catch (e) {}
    try {
        const res = deps.spawnSync('which', ['kitty'], { encoding: 'utf-8', timeout: 1000 });
        if (res && res.status === 0 && res.stdout && res.stdout.trim()) return true;
    } catch (e) {}
    return false;
}

function loadCompanionState(deps) {
    try {
        if (deps.fs.existsSync(deps.stateFilePath)) {
            const raw = deps.fs.readFileSync(deps.stateFilePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.hiddenOsWinIds && typeof parsed.hiddenOsWinIds === 'object') {
                return { hiddenOsWinIds: { ...parsed.hiddenOsWinIds } };
            }
        }
    } catch (e) {}
    return { hiddenOsWinIds: {} };
}

function saveCompanionState(state, lsData, deps) {
    try {
        const cleanedHidden = {};
        const validIds = Array.isArray(lsData) ? new Set(lsData.map(w => String(w.id))) : null;
        for (const [id, isHidden] of Object.entries(state.hiddenOsWinIds || {})) {
            if (!isHidden) continue;
            if (validIds && !validIds.has(String(id))) continue;
            cleanedHidden[String(id)] = true;
        }
        const payload = { hiddenOsWinIds: cleanedHidden, updatedAt: Date.now() };
        deps.fs.writeFileSync(deps.stateFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (e) {
        safeLog(deps, `Failed saving companion state: ${e.message}`);
    }
}

/**
 * Companion Pool Rule:
 * An osWin belongs to the Companion Pool IFF at least one window across any of its tabs
 * carries user_vars.agy_companion === '1'.
 * Returns the canonical agy_project string for Companion OS windows, or null for normal user windows.
 */
function getCompanionProjectKey(osWin) {
    if (!osWin || !Array.isArray(osWin.tabs)) return null;
    for (const tab of osWin.tabs) {
        if (!tab || !Array.isArray(tab.windows)) continue;
        for (const win of tab.windows) {
            if (win && win.user_vars && String(win.user_vars.agy_companion) === '1') {
                return typeof win.user_vars.agy_project === 'string' ? win.user_vars.agy_project : '';
            }
        }
    }
    return null;
}

function isCompanionOsWin(osWin) {
    return getCompanionProjectKey(osWin) !== null;
}

function flattenOsWinWindows(osWin) {
    const entries = [];
    if (!osWin || !Array.isArray(osWin.tabs)) return entries;
    for (const tab of osWin.tabs) {
        if (!tab || !Array.isArray(tab.windows)) continue;
        for (const win of tab.windows) {
            if (win && win.id !== undefined) {
                entries.push({ tab, win });
            }
        }
    }
    return entries;
}

function getRepresentativeWindow(osWin) {
    const entries = flattenOsWinWindows(osWin);
    if (entries.length === 0) return null;
    const activeBoth = entries.find(e => e.tab.is_active && e.win.is_active);
    if (activeBoth) return activeBoth.win;
    const activeWin = entries.find(e => e.win.is_active);
    if (activeWin) return activeWin.win;
    return entries[0].win;
}

function isWindowBusy(win) {
    if (!win) return true;
    if (win.in_alternate_screen === true) return true;
    if (win.at_prompt === false) return true;
    if (win.at_prompt === true) return false;

    const fgList = Array.isArray(win.foreground_processes) ? win.foreground_processes : [];
    for (const proc of fgList) {
        if (proc && Array.isArray(proc.cmdline) && proc.cmdline.length > 0 && proc.cmdline[0]) {
            const base = path.basename(String(proc.cmdline[0]).trim());
            if (base && !SHELL_NAMES.has(base)) {
                return true;
            }
        }
    }
    return false;
}

function cleanCommandText(rawCmd, cleanPrompt = true) {
    if (typeof rawCmd !== 'string') return '';

    // Normalize CRLF / lone CR -> LF
    const normalized = rawCmd.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    // Trim leading blank lines and all trailing blank lines / newlines
    while (lines.length > 0 && lines[0].trim() === '') {
        lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
    }

    if (lines.length === 0) return '';

    if (cleanPrompt) {
        // Track backslash line continuations so multi-line commands like `$ docker run \`
        // strip the leading prompt cleanly without corrupting continuation arguments or heredocs.
        const isContinuation = lines.map((_, idx) => idx > 0 && /\\\s*$/.test(lines[idx - 1]));
        const logicalStartIndices = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (isContinuation[i]) continue;
            if (line.trim() === '' || /^\s*#/.test(line)) continue;
            logicalStartIndices.push(i);
        }

        if (
            logicalStartIndices.length > 0 &&
            logicalStartIndices.every(idx => /^\s*[$%]\s+/.test(lines[idx]))
        ) {
            for (const idx of logicalStartIndices) {
                lines[idx] = lines[idx].replace(/^\s*[$%]\s+/, '');
            }
        }
    }

    // Ensure zero trailing \r or \n so staging never auto-executes
    return lines.join('\n').replace(/[\r\n]+$/, '');
}

function readProjectsJsonConfigs(deps) {
    const configs = [];
    try {
        if (!deps.projectsConfigDir || !deps.fs.existsSync(deps.projectsConfigDir)) {
            return configs;
        }
        const files = deps.fs.readdirSync(deps.projectsConfigDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const raw = deps.fs.readFileSync(path.join(deps.projectsConfigDir, file), 'utf-8');
                const data = JSON.parse(raw);
                if (!data || typeof data !== 'object') continue;
                const resources = (data.projectResources && Array.isArray(data.projectResources.resources))
                    ? data.projectResources.resources
                    : [];
                const extractedPaths = [];
                for (const r of resources) {
                    const uri = (r && r.folderUri) || (r && r.gitFolder && r.gitFolder.folderUri);
                    if (typeof uri === 'string' && uri.startsWith('file://')) {
                        const decoded = safeDecodeURIComponent(uri.substring(7));
                        if (decoded) {
                            extractedPaths.push(normalizePath(path.resolve(decoded)));
                        }
                    }
                }
                configs.push({
                    name: typeof data.name === 'string' ? data.name.trim() : '',
                    paths: extractedPaths
                });
            } catch (e) {}
        }
    } catch (e) {}
    return configs;
}

function isExistingDir(dirPath, deps) {
    if (!dirPath) return false;
    try {
        return deps.fs.existsSync(dirPath) && deps.fs.statSync(dirPath).isDirectory();
    } catch (e) {
        return false;
    }
}

function resolveProjectContext(query, deps) {
    const homedir = deps.os.homedir();
    const rawProject = query.project ? safeDecodeURIComponent(String(query.project)).trim() : '';
    const uuid = query.uuid ? safeDecodeURIComponent(String(query.uuid)).trim() : '';
    const rawCwd = query.cwd ? safeDecodeURIComponent(String(query.cwd)).trim() : '';

    let baseProjectName = '';
    let subDir = '';
    if (rawProject) {
        if (rawProject.includes('/')) {
            const parts = rawProject.split('/');
            baseProjectName = parts[0].trim();
            subDir = parts.slice(1).join('/').trim();
        } else {
            baseProjectName = rawProject;
        }
    }

    const projectConfigs = readProjectsJsonConfigs(deps);
    const allProjectPaths = [];
    const addDir = (p) => {
        if (!p) return;
        const norm = normalizePath(path.resolve(p));
        if (norm && !allProjectPaths.includes(norm) && isExistingDir(norm, deps)) {
            allProjectPaths.push(norm);
        }
    };

    // 1. Check ~/.gemini/config/projects/*.json matching baseProjectName / rawProject
    if (baseProjectName || rawProject) {
        for (const cfg of projectConfigs) {
            if (cfg.name && (cfg.name === baseProjectName || cfg.name === rawProject)) {
                for (const p of cfg.paths) {
                    addDir(p);
                }
                if (allProjectPaths.length > 0) break;
            }
        }
    }

    // 2. Fallback to UUID exact workspace directories (avoids scanning large .pb when projects JSON already matched)
    if (allProjectPaths.length === 0 && uuid && deps.projectResolver && typeof deps.projectResolver.findProjectDirByUUID === 'function') {
        try {
            const uuidPaths = deps.projectResolver.findProjectDirByUUID(uuid) || [];
            for (const p of uuidPaths) {
                addDir(p);
            }
        } catch (e) {}
    }

    // 3. Fuzzy fallback via findProjectDir
    if (allProjectPaths.length === 0 && rawProject && deps.projectResolver && typeof deps.projectResolver.findProjectDir === 'function') {
        const subProjects = rawProject.split(',').map(s => s.trim()).filter(Boolean);
        for (const token of subProjects) {
            try {
                const found = deps.projectResolver.findProjectDir(token);
                if (found) addDir(found);
            } catch (e) {}
        }
        if (allProjectPaths.length === 0 && baseProjectName && baseProjectName !== rawProject) {
            try {
                const foundBase = deps.projectResolver.findProjectDir(baseProjectName);
                if (foundBase) addDir(foundBase);
            } catch (e) {}
        }
    }

    // Check explicit query.cwd
    let explicitCwd = '';
    if (rawCwd) {
        const stripped = rawCwd.startsWith('file://') ? rawCwd.replace(/^file:\/\//, '') : rawCwd;
        const resolved = normalizePath(path.resolve(resolveHome(stripped, homedir)));
        if (isExistingDir(resolved, deps)) {
            explicitCwd = resolved;
        }
    }

    let narrowedBySubDir = false;
    let validPaths = [];
    let targetCwd = '';

    if (explicitCwd) {
        targetCwd = explicitCwd;
        validPaths = allProjectPaths.length > 0 ? [...allProjectPaths] : [explicitCwd];
        if (!allProjectPaths.includes(explicitCwd)) {
            allProjectPaths.unshift(explicitCwd);
        }
    } else if (subDir) {
        let matched = allProjectPaths.find(
            p => p === subDir || p.endsWith('/' + subDir) || path.basename(p) === subDir
        );
        if (!matched && deps.projectResolver && typeof deps.projectResolver.findProjectDir === 'function') {
            try {
                const foundSub = deps.projectResolver.findProjectDir(rawProject);
                if (foundSub && isExistingDir(foundSub, deps)) {
                    matched = normalizePath(path.resolve(foundSub));
                    addDir(matched);
                }
            } catch (e) {}
        }
        if (matched) {
            narrowedBySubDir = true;
            targetCwd = matched;
            validPaths = [matched];
        } else {
            validPaths = [...allProjectPaths];
            targetCwd = validPaths[0] || '';
        }
    } else {
        validPaths = [...allProjectPaths];
        targetCwd = validPaths[0] || '';
    }

    // Derive canonical displayProjName and Kitty-safe projectKey
    let displayProjName = baseProjectName;
    if (!displayProjName) {
        const probePaths = [targetCwd, ...allProjectPaths].filter(Boolean);
        for (const cfg of projectConfigs) {
            if (!cfg.name) continue;
            const hit = probePaths.some(probe =>
                cfg.paths.some(root => probe === root || probe.startsWith(root + '/'))
            );
            if (hit) {
                displayProjName = cfg.name;
                for (const p of cfg.paths) {
                    addDir(p);
                }
                break;
            }
        }
    }
    if (!displayProjName && targetCwd) {
        displayProjName = path.basename(targetCwd);
    }
    if (!displayProjName && uuid) {
        displayProjName = uuid;
    }
    if (!displayProjName) {
        displayProjName = 'default';
    }

    const projectKey = encodeURIComponent(displayProjName);
    const encodedUuid = uuid ? encodeURIComponent(uuid) : '';

    return {
        rawProject,
        baseProjectName,
        subDir,
        uuid,
        encodedUuid,
        explicitCwd,
        narrowedBySubDir,
        validPaths,
        allProjectPaths,
        targetCwd,
        displayProjName,
        projectKey
    };
}

function runKitten(kittenBin, sockAddr, subArgs, deps, options = {}) {
    const args = ['@', '--to', sockAddr, ...subArgs];
    const spawnOpts = {
        encoding: 'utf-8',
        timeout: options.timeout || 3000
    };
    if (options.input !== undefined) {
        spawnOpts.input = options.input;
    }
    return deps.spawnSync(kittenBin, args, spawnOpts);
}

function fetchKittyLs(kittenBin, sockAddr, deps) {
    const res = runKitten(kittenBin, sockAddr, ['ls'], deps, { timeout: 2500 });
    if (!res || res.error || res.status !== 0 || !res.stdout) {
        return null;
    }
    try {
        const parsed = JSON.parse(res.stdout);
        return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
        return null;
    }
}

function discoverKittySocket(kittenBin, deps) {
    let entries = [];
    try {
        if (!deps.fs.existsSync(deps.tmpDir)) return null;
        entries = deps.fs.readdirSync(deps.tmpDir).filter(name => /^mykitty(-\d+)?$/.test(name));
    } catch (e) {
        return null;
    }

    if (entries.length === 0) return null;

    const candidates = [];
    for (const name of entries) {
        const fullPath = path.join(deps.tmpDir, name);
        let mtimeMs = 0;
        try {
            const st = deps.fs.statSync(fullPath);
            mtimeMs = st.mtimeMs || 0;
        } catch (e) {
            continue;
        }
        candidates.push({ name, fullPath, mtimeMs });
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const cand of candidates) {
        const sockAddr = `unix:${cand.fullPath}`;
        const lsData = fetchKittyLs(kittenBin, sockAddr, deps);
        if (lsData) {
            const pidMatch = cand.name.match(/^mykitty-(\d+)$/);
            const pid = pidMatch ? parseInt(pidMatch[1], 10) : null;
            return {
                sockAddr,
                socketPath: cand.fullPath,
                pid,
                lsData
            };
        }
    }
    return null;
}

async function coldStartKitty(kittenBin, kittyBin, targetCwd, ctx, deps) {
    const listenBase = `unix:${path.join(deps.tmpDir, 'mykitty')}`;
    const launchDir = targetCwd || deps.os.homedir();

    safeLog(deps, `Cold-starting Kitty in ${launchDir} for projectKey=${ctx.projectKey}`);

    const openRes = deps.spawnSync(
        'open',
        [
            '-g', '-a', 'kitty',
            '--args',
            '--single-instance',
            '--directory', launchDir,
            '-o', 'allow_remote_control=yes',
            '--listen-on', listenBase
        ],
        { encoding: 'utf-8', timeout: 4000 }
    );

    if (!openRes || openRes.error || openRes.status !== 0) {
        try {
            const child = deps.spawn(
                kittyBin,
                [
                    '--single-instance',
                    '--directory', launchDir,
                    '-o', 'allow_remote_control=yes',
                    '--listen-on', listenBase
                ],
                { detached: true, stdio: 'ignore' }
            );
            if (child && typeof child.unref === 'function') {
                child.unref();
            }
        } catch (e) {
            return { error: `Failed to cold-start Kitty: ${e.message}` };
        }
    }

    const intervalMs = (deps.timings && deps.timings.pollSocketIntervalMs) ?? 150;
    const timeoutMs = (deps.timings && deps.timings.pollSocketTimeoutMs) ?? 5000;
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / Math.max(1, intervalMs)));
    const deadline = Date.now() + timeoutMs;

    let sockInfo = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await deps.sleep(intervalMs);
        sockInfo = discoverKittySocket(kittenBin, deps);
        if (sockInfo) break;
        if (Date.now() >= deadline && attempt > 2) break;
    }

    if (!sockInfo) {
        return { error: 'Timed out waiting for Kitty Unix socket (/tmp/mykitty*) after cold start' };
    }

    // Tag initial cold-started window into the Companion Pool for this project
    const existingTarget = sockInfo.lsData.find(osWin => getCompanionProjectKey(osWin) === ctx.projectKey);
    if (!existingTarget && sockInfo.lsData.length > 0) {
        const firstNonCompanion = sockInfo.lsData.find(osWin => !isCompanionOsWin(osWin)) || sockInfo.lsData[0];
        const initWin = getRepresentativeWindow(firstNonCompanion);
        if (initWin) {
            const setVarArgs = [
                'set-user-vars',
                '--match', `id:${initWin.id}`,
                'agy_companion=1',
                `agy_project=${ctx.projectKey}`
            ];
            if (ctx.encodedUuid) {
                setVarArgs.push(`agy_uuid=${ctx.encodedUuid}`);
            }
            runKitten(kittenBin, sockInfo.sockAddr, setVarArgs, deps);
            runKitten(kittenBin, sockInfo.sockAddr, [
                'set-window-title',
                '--match', `id:${initWin.id}`,
                `🐱 ${ctx.displayProjName}`
            ], deps);

            const refreshed = fetchKittyLs(kittenBin, sockInfo.sockAddr, deps);
            if (refreshed) {
                sockInfo.lsData = refreshed;
            }
        }
    }

    return { sockInfo, coldStarted: true };
}

function activateKittyApp(pid, deps) {
    if (pid && Number.isInteger(pid) && pid > 0) {
        const res = deps.spawnSync(
            'osascript',
            [
                '-e',
                `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`
            ],
            { encoding: 'utf-8', timeout: 2500 }
        );
        if (res && !res.error && res.status === 0) {
            return true;
        }
    }
    const fallback = deps.spawnSync(
        'osascript',
        ['-e', 'tell application "kitty" to activate'],
        { encoding: 'utf-8', timeout: 2500 }
    );
    return Boolean(fallback && !fallback.error && fallback.status === 0);
}

/**
 * Ensures Rhythm 2 exclusive visibility inside the Companion Pool:
 * 1. Hides all OTHER Companion OS windows (never touching normal user Kitty OS windows).
 * 2. Shows existing Companion OS window for ctx.projectKey, or launches a new one.
 */
async function ensureCompanionOsWindowShown(kittenBin, sockInfo, ctx, state, deps, wasColdStarted = false) {
    let lsData = sockInfo.lsData;
    let targetOsWin = null;
    const otherCompanionOsWins = [];

    for (const osWin of lsData) {
        const compProjKey = getCompanionProjectKey(osWin);
        if (compProjKey === null) {
            // Normal user Kitty OS window -> strictly untouched!
            continue;
        }
        if (compProjKey === ctx.projectKey) {
            if (!targetOsWin || osWin.is_focused) {
                targetOsWin = osWin;
            }
        } else {
            otherCompanionOsWins.push(osWin);
        }
    }

    // 1. Hide all OTHER Companion OS windows
    for (const otherOsWin of otherCompanionOsWins) {
        const repWin = getRepresentativeWindow(otherOsWin);
        if (repWin) {
            runKitten(kittenBin, sockInfo.sockAddr, [
                'resize-os-window',
                '--match', `id:${repWin.id}`,
                '--action=hide'
            ], deps);
            state.hiddenOsWinIds[String(otherOsWin.id)] = true;
        }
    }

    // 2. Show or Create current project's targetOsWin
    let createdNewOsWin = Boolean(wasColdStarted);
    if (targetOsWin) {
        const repWin = getRepresentativeWindow(targetOsWin);
        if (repWin) {
            runKitten(kittenBin, sockInfo.sockAddr, [
                'resize-os-window',
                '--match', `id:${repWin.id}`,
                '--action=show'
            ], deps);
        }
        delete state.hiddenOsWinIds[String(targetOsWin.id)];
    } else {
        if (!ctx.targetCwd) {
            return {
                error: 'Project directory not found',
                project: ctx.rawProject,
                projectKey: ctx.projectKey
            };
        }
        const launchArgs = [
            'launch',
            '--type=os-window',
            '--cwd', ctx.targetCwd,
            '--var', 'agy_companion=1',
            '--var', `agy_project=${ctx.projectKey}`
        ];
        if (ctx.encodedUuid) {
            launchArgs.push('--var', `agy_uuid=${ctx.encodedUuid}`);
        }
        launchArgs.push('--os-window-title', `🐱 ${ctx.displayProjName}`);

        const launchRes = runKitten(kittenBin, sockInfo.sockAddr, launchArgs, deps, { timeout: 4000 });
        if (!launchRes || launchRes.error || launchRes.status !== 0) {
            return {
                error: `Failed to launch Companion OS window: ${(launchRes && (launchRes.stderr || (launchRes.error && launchRes.error.message))) || 'unknown error'}`,
                projectKey: ctx.projectKey
            };
        }

        const launchedWinId = parseInt(String(launchRes.stdout || '').trim(), 10);
        createdNewOsWin = true;

        const delayMs = (deps.timings && deps.timings.launchOsWinDelayMs) ?? 180;
        await deps.sleep(delayMs);

        const updatedLs = fetchKittyLs(kittenBin, sockInfo.sockAddr, deps);
        if (updatedLs) {
            lsData = updatedLs;
            sockInfo.lsData = updatedLs;
        }

        targetOsWin = lsData.find(osWin => getCompanionProjectKey(osWin) === ctx.projectKey);
        if (!targetOsWin && !isNaN(launchedWinId)) {
            targetOsWin = lsData.find(osWin =>
                flattenOsWinWindows(osWin).some(e => e.win.id === launchedWinId)
            );
        }
        if (!targetOsWin) {
            return {
                error: 'Launched Companion OS window could not be located in kitten @ ls',
                projectKey: ctx.projectKey
            };
        }
        delete state.hiddenOsWinIds[String(targetOsWin.id)];
    }

    saveCompanionState(state, lsData, deps);
    return { targetOsWin, createdNewOsWin, lsData };
}

function selectCandidateWindow(targetOsWin, encodedUuid) {
    const entries = flattenOsWinWindows(targetOsWin);
    if (entries.length === 0) return null;

    if (encodedUuid) {
        const idleUuidMatch = entries.find(
            e => e.win.user_vars && e.win.user_vars.agy_uuid === encodedUuid && !isWindowBusy(e.win)
        );
        if (idleUuidMatch) return idleUuidMatch.win;

        const anyUuidMatch = entries.find(
            e => e.win.user_vars && e.win.user_vars.agy_uuid === encodedUuid
        );
        if (anyUuidMatch) return anyUuidMatch.win;
    }

    const activeEntry = entries.find(e => e.tab.is_active && e.win.is_active);
    if (activeEntry) return activeEntry.win;

    const anyActiveWin = entries.find(e => e.win.is_active);
    if (anyActiveWin) return anyActiveWin.win;

    return entries[0].win;
}

function findFallbackIdleWindow(targetOsWin, encodedUuid, excludeWinId) {
    const entries = flattenOsWinWindows(targetOsWin).filter(e => e.win.id !== excludeWinId);
    if (encodedUuid) {
        const uuidIdle = entries.find(
            e => e.win.user_vars && e.win.user_vars.agy_uuid === encodedUuid && !isWindowBusy(e.win)
        );
        if (uuidIdle) return uuidIdle.win;
    }
    const activeIdle = entries.find(e => e.tab.is_active && e.win.is_active && !isWindowBusy(e.win));
    if (activeIdle) return activeIdle.win;
    return null;
}

async function executeKittyApi(query = {}, deps = createDefaultDeps()) {
    const action = String(query.action || 'summon').trim();
    const installed = isKittyInstalled(deps);

    if (action === 'send_chunk') {
        if (!installed) {
            const ctx = resolveProjectContext(query, deps);
            return {
                success: false,
                code: 'NOT_INSTALLED',
                installed: false,
                error: '未检测到 Kitty 终端。请先安装 Kitty (例如: brew install kitty)',
                projectKey: ctx.projectKey
            };
        }

        const uploadId = query.upload_id ? String(query.upload_id) : '';
        const index = parseInt(query.index, 10);
        const total = parseInt(query.total, 10);

        if (!uploadId || isNaN(index) || isNaN(total) || total <= 0 || index < 0 || index >= total) {
            return { success: false, error: 'Invalid chunk parameters' };
        }

        let chunkB64 = '';
        if (typeof query.chunk_b64 === 'string') {
            chunkB64 = query.chunk_b64.replace(/ /g, '+');
        } else if (typeof query.chunk === 'string') {
            chunkB64 = Buffer.from(safeDecodeURIComponent(query.chunk), 'utf-8').toString('base64');
        } else {
            return { success: false, error: 'Missing chunk_b64 parameter' };
        }

        let session = CHUNK_SESSIONS.get(uploadId);
        if (!session) {
            session = {
                chunks: new Array(total),
                received: 0,
                total,
                timestamp: Date.now()
            };
            CHUNK_SESSIONS.set(uploadId, session);
        }

        if (session.chunks[index] === undefined) {
            session.chunks[index] = chunkB64;
            session.received++;
        }
        session.timestamp = Date.now();

        if (session.received < session.total) {
            return {
                success: true,
                done: false,
                received: session.received,
                total: session.total
            };
        }

        CHUNK_SESSIONS.delete(uploadId);
        const fullBase64 = session.chunks.join('');
        const assembledCmd = Buffer.from(fullBase64, 'base64').toString('utf-8');

        const sendResult = await executeKittyApi(
            {
                ...query,
                action: 'send',
                _assembledCmd: assembledCmd
            },
            deps
        );
        return {
            ...sendResult,
            done: true
        };
    }

    const ctx = resolveProjectContext(query, deps);
    const requireExplicitMultiDir =
        query.requireExplicitMultiDir === '1' ||
        query.requireExplicitMultiDir === 'true' ||
        query.requireExplicitMultiDir === true;

    safeLog(deps, `Action=${action} projectKey=${ctx.projectKey} targetCwd=${ctx.targetCwd} validPaths=${ctx.validPaths.length} installed=${installed}`);

    // Fast-fail interactive invocations when Kitty is not installed
    if (action === 'summon' || action === 'send' || action === 'toggle') {
        if (!installed) {
            return {
                success: false,
                code: 'NOT_INSTALLED',
                installed: false,
                error: '未检测到 Kitty 终端。请先安装 Kitty (例如: brew install kitty)',
                projectKey: ctx.projectKey
            };
        }
    }

    // Multi-root directory picker gate before launching or sending
    if (
        (action === 'summon' || action === 'send' || action === 'toggle') &&
        requireExplicitMultiDir &&
        !ctx.explicitCwd &&
        !ctx.narrowedBySubDir &&
        ctx.validPaths.length > 1
    ) {
        return {
            success: false,
            code: 'MULTI_DIR',
            paths: ctx.validPaths,
            projectKey: ctx.projectKey
        };
    }

    const kittenBin = resolveBinary(KITTEN_CANDIDATES, deps);
    const kittyBin = resolveBinary(KITTY_CANDIDATES, deps);
    const state = loadCompanionState(deps);

    if (action === 'status') {
        if (!installed) {
            return {
                success: true,
                action: 'status',
                installed: false,
                running: false,
                exists: false,
                state: 'uninstalled',
                projectKey: ctx.projectKey,
                message: 'Kitty is not installed on this system'
            };
        }

        const sockInfo = discoverKittySocket(kittenBin, deps);
        if (!sockInfo) {
            return {
                success: true,
                action: 'status',
                installed: true,
                running: false,
                exists: false,
                state: 'closed',
                projectKey: ctx.projectKey
            };
        }
        const targetOsWin = sockInfo.lsData.find(osWin => getCompanionProjectKey(osWin) === ctx.projectKey);
        if (!targetOsWin) {
            return {
                success: true,
                action: 'status',
                installed: true,
                running: true,
                exists: false,
                state: 'closed',
                projectKey: ctx.projectKey
            };
        }
        const isHidden = Boolean(state.hiddenOsWinIds[String(targetOsWin.id)]);
        return {
            success: true,
            action: 'status',
            installed: true,
            running: true,
            exists: true,
            state: isHidden ? 'hidden' : 'shown',
            isFocused: Boolean(targetOsWin.is_focused),
            osWinId: targetOsWin.id,
            projectKey: ctx.projectKey
        };
    }

    if (action === 'hide') {
        if (!installed) {
            return {
                success: true,
                action: 'hide',
                installed: false,
                state: 'hidden',
                exists: false,
                projectKey: ctx.projectKey
            };
        }
        const sockInfo = discoverKittySocket(kittenBin, deps);
        if (!sockInfo) {
            return {
                success: true,
                action: 'hide',
                installed: true,
                state: 'hidden',
                exists: false,
                projectKey: ctx.projectKey
            };
        }
        const targetOsWin = sockInfo.lsData.find(osWin => getCompanionProjectKey(osWin) === ctx.projectKey);
        if (!targetOsWin) {
            return {
                success: true,
                action: 'hide',
                installed: true,
                state: 'hidden',
                exists: false,
                projectKey: ctx.projectKey
            };
        }
        const repWin = getRepresentativeWindow(targetOsWin);
        if (repWin) {
            runKitten(kittenBin, sockInfo.sockAddr, [
                'resize-os-window',
                '--match', `id:${repWin.id}`,
                '--action=hide'
            ], deps);
        }
        state.hiddenOsWinIds[String(targetOsWin.id)] = true;
        saveCompanionState(state, sockInfo.lsData, deps);
        return {
            success: true,
            action: 'hide',
            installed: true,
            state: 'hidden',
            osWinId: targetOsWin.id,
            winId: repWin ? repWin.id : null,
            projectKey: ctx.projectKey
        };
    }

    if (action === 'toggle') {
        const sockInfo = discoverKittySocket(kittenBin, deps);
        if (sockInfo) {
            const targetOsWin = sockInfo.lsData.find(osWin => getCompanionProjectKey(osWin) === ctx.projectKey);
            const isMarkedHidden = targetOsWin ? Boolean(state.hiddenOsWinIds[String(targetOsWin.id)]) : false;
            if (targetOsWin && !isMarkedHidden) {
                const repWin = getRepresentativeWindow(targetOsWin);
                if (repWin) {
                    runKitten(kittenBin, sockInfo.sockAddr, [
                        'resize-os-window',
                        '--match', `id:${repWin.id}`,
                        '--action=hide'
                    ], deps);
                }
                state.hiddenOsWinIds[String(targetOsWin.id)] = true;
                saveCompanionState(state, sockInfo.lsData, deps);
                return {
                    success: true,
                    action: 'toggle',
                    installed: true,
                    state: 'hidden',
                    osWinId: targetOsWin.id,
                    winId: repWin ? repWin.id : null,
                    projectKey: ctx.projectKey
                };
            }
        }
        // Otherwise fall through to full summon flow and report state: 'shown'
    }

    if (action !== 'summon' && action !== 'toggle' && action !== 'send') {
        return { success: false, error: `Unknown action: ${action}` };
    }

    // Validate command upfront when action === 'send'
    let cleanedCmd = '';
    if (action === 'send') {
        let rawCmd = '';
        if (typeof query._assembledCmd === 'string') {
            rawCmd = query._assembledCmd;
        } else if (typeof query.cmd_b64 === 'string') {
            // URL query decoding may convert '+' into space ' '; restore '+' before Base64 decode
            const cleanB64 = query.cmd_b64.replace(/ /g, '+');
            rawCmd = Buffer.from(cleanB64, 'base64').toString('utf-8');
        } else if (typeof query.cmd === 'string') {
            rawCmd = safeDecodeURIComponent(query.cmd);
        } else {
            return { success: false, error: 'Missing cmd_b64 or cmd parameter' };
        }

        const shouldCleanPrompt = query.clean_prompt !== 'false' && query.clean_prompt !== '0' && query.clean_prompt !== false;
        cleanedCmd = cleanCommandText(rawCmd, shouldCleanPrompt);
        if (!cleanedCmd) {
            return { success: false, error: 'Command is empty after sanitization' };
        }
    }

    // Discover active Kitty socket or Cold-Start Kitty
    let sockInfo = discoverKittySocket(kittenBin, deps);
    let wasColdStarted = false;

    if (!sockInfo) {
        if (!ctx.targetCwd) {
            return {
                success: false,
                error: 'Project directory not found',
                project: ctx.rawProject,
                projectKey: ctx.projectKey
            };
        }
        const coldRes = await coldStartKitty(kittenBin, kittyBin, ctx.targetCwd, ctx, deps);
        if (coldRes.error) {
            return { success: false, error: coldRes.error, projectKey: ctx.projectKey };
        }
        sockInfo = coldRes.sockInfo;
        wasColdStarted = Boolean(coldRes.coldStarted);
    }

    // Rhythm 2 Exclusive Visibility: hide other Companion OS windows & show/launch targetOsWin
    const ensured = await ensureCompanionOsWindowShown(kittenBin, sockInfo, ctx, state, deps, wasColdStarted);
    if (ensured.error) {
        return {
            success: false,
            error: ensured.error,
            project: ensured.project || ctx.rawProject,
            projectKey: ctx.projectKey
        };
    }

    let { targetOsWin, createdNewOsWin } = ensured;

    if (action === 'summon' || action === 'toggle') {
        const focusWin = selectCandidateWindow(targetOsWin, ctx.encodedUuid);
        if (focusWin) {
            runKitten(kittenBin, sockInfo.sockAddr, [
                'focus-window',
                '--match', `id:${focusWin.id}`
            ], deps);
        }
        activateKittyApp(sockInfo.pid, deps);
        return {
            success: true,
            action,
            installed: true,
            state: 'shown',
            projectKey: ctx.projectKey,
            osWinId: targetOsWin.id,
            winId: focusWin ? focusWin.id : null,
            cwd: ctx.targetCwd,
            created: createdNewOsWin
        };
    }

    // === action === 'send' ===
    let candidateWin = selectCandidateWindow(targetOsWin, ctx.encodedUuid);
    if (!candidateWin) {
        return {
            success: false,
            error: 'No window available inside Companion OS window',
            projectKey: ctx.projectKey
        };
    }

    let selectedWin = candidateWin;
    let didSpawnTab = false;

    // Busy Guard: never blindly paste into an active foreground process or alternate screen (vim/less/htop)
    if (!createdNewOsWin && isWindowBusy(candidateWin)) {
        const fallbackIdle = findFallbackIdleWindow(targetOsWin, ctx.encodedUuid, candidateWin.id);
        if (fallbackIdle) {
            selectedWin = fallbackIdle;
        } else {
            const tabCwd = ctx.targetCwd || normalizePath(candidateWin.cwd || '') || deps.os.homedir();
            const tabArgs = [
                'launch',
                '--type=tab',
                '--match', `window_id:${candidateWin.id}`,
                '--cwd', tabCwd,
                '--var', 'agy_companion=1',
                '--var', `agy_project=${ctx.projectKey}`
            ];
            if (ctx.encodedUuid) {
                tabArgs.push('--var', `agy_uuid=${ctx.encodedUuid}`);
            }

            const tabRes = runKitten(kittenBin, sockInfo.sockAddr, tabArgs, deps, { timeout: 4000 });
            if (!tabRes || tabRes.error || tabRes.status !== 0) {
                return {
                    success: false,
                    error: `Failed to spawn clean tab for busy window: ${(tabRes && (tabRes.stderr || (tabRes.error && tabRes.error.message))) || 'unknown error'}`,
                    projectKey: ctx.projectKey
                };
            }

            didSpawnTab = true;
            const spawnedTabWinId = parseInt(String(tabRes.stdout || '').trim(), 10);
            const tabDelayMs = (deps.timings && deps.timings.launchTabDelayMs) ?? 220;
            await deps.sleep(tabDelayMs);

            const refreshedLs = fetchKittyLs(kittenBin, sockInfo.sockAddr, deps);
            if (refreshedLs) {
                sockInfo.lsData = refreshedLs;
                const updatedTarget = refreshedLs.find(osWin => osWin.id === targetOsWin.id) ||
                    refreshedLs.find(osWin => getCompanionProjectKey(osWin) === ctx.projectKey);
                if (updatedTarget) {
                    targetOsWin = updatedTarget;
                }
            }

            const allWins = flattenOsWinWindows(targetOsWin);
            let matchedNewWin = !isNaN(spawnedTabWinId)
                ? allWins.find(e => e.win.id === spawnedTabWinId)
                : null;
            if (!matchedNewWin && allWins.length > 0) {
                matchedNewWin = allWins[allWins.length - 1];
            }
            if (matchedNewWin) {
                selectedWin = matchedNewWin.win;
            }
        }
    }

    // Smart Lenient CWD Alignment
    const rawLiveCwd =
        (selectedWin.foreground_processes &&
            selectedWin.foreground_processes[0] &&
            selectedWin.foreground_processes[0].cwd) ||
        selectedWin.cwd ||
        (createdNewOsWin || didSpawnTab ? ctx.targetCwd : '');
    const liveCwd = normalizePath(rawLiveCwd);
    const normTargetCwd = normalizePath(ctx.targetCwd);

    let didCd = false;
    if (normTargetCwd && !createdNewOsWin && !didSpawnTab) {
        let isAcceptable = false;
        const hasExplicitCwd = Boolean(ctx.explicitCwd || ctx.narrowedBySubDir);

        if (hasExplicitCwd) {
            isAcceptable =
                Boolean(liveCwd) &&
                (liveCwd === normTargetCwd ||
                    normTargetCwd === '/' ||
                    liveCwd.startsWith(normTargetCwd + '/'));
        } else {
            const allowedProjectRoots = Array.from(
                new Set([normTargetCwd, ...ctx.allProjectPaths.map(normalizePath)].filter(Boolean))
            );
            isAcceptable =
                Boolean(liveCwd) &&
                allowedProjectRoots.some(
                    root => liveCwd === root || root === '/' || liveCwd.startsWith(root + '/')
                );
        }

        if (!isAcceptable) {
            const quotedCwd = shellSingleQuote(normTargetCwd);
            runKitten(
                kittenBin,
                sockInfo.sockAddr,
                ['send-text', '--match', `id:${selectedWin.id}`, '--stdin'],
                deps,
                { input: `cd ${quotedCwd}\r` }
            );
            didCd = true;
            const cdDelayMs = (deps.timings && deps.timings.cdDelayMs) ?? 100;
            await deps.sleep(cdDelayMs);
        }
    }

    // Focus target window inside Kitty & stage command with bracketed paste
    runKitten(kittenBin, sockInfo.sockAddr, [
        'focus-window',
        '--match', `id:${selectedWin.id}`
    ], deps);

    const stageRes = runKitten(
        kittenBin,
        sockInfo.sockAddr,
        ['send-text', '--match', `id:${selectedWin.id}`, '--stdin', '--bracketed-paste=enable'],
        deps,
        { input: cleanedCmd }
    );

    if (!stageRes || stageRes.error || stageRes.status !== 0) {
        return {
            success: false,
            error: `Failed sending command text to Kitty: ${(stageRes && (stageRes.stderr || (stageRes.error && stageRes.error.message))) || 'unknown error'}`,
            projectKey: ctx.projectKey
        };
    }

    const shouldExecute =
        query.execute === 'true' ||
        query.execute === '1' ||
        query.execute === true;

    if (shouldExecute) {
        const execDelayMs = (deps.timings && deps.timings.execEnterDelayMs) ?? 40;
        await deps.sleep(execDelayMs);
        runKitten(kittenBin, sockInfo.sockAddr, [
            'send-text',
            '--match', `id:${selectedWin.id}`,
            '\\r'
        ], deps);
    }

    activateKittyApp(sockInfo.pid, deps);

    return {
        success: true,
        action: 'send',
        installed: true,
        projectKey: ctx.projectKey,
        osWinId: targetOsWin.id,
        winId: selectedWin.id,
        cwd: normTargetCwd,
        liveCwd: didCd ? normTargetCwd : liveCwd,
        previousLiveCwd: liveCwd,
        alignedCwd: Boolean(didCd),
        spawnedNewTab: Boolean(didSpawnTab),
        executed: Boolean(shouldExecute)
    };
}

const handler = async function(query = {}) {
    return executeKittyApi(query);
};

handler._withDeps = function(customDeps = {}) {
    const base = createDefaultDeps();
    const mergedTimings = { ...base.timings, ...(customDeps.timings || {}) };
    const deps = { ...base, ...customDeps, timings: mergedTimings };
    return async function(query = {}) {
        return executeKittyApi(query, deps);
    };
};

handler._internals = {
    cleanCommandText,
    isWindowBusy,
    getCompanionProjectKey,
    isCompanionOsWin,
    selectCandidateWindow,
    resolveProjectContext,
    shellSingleQuote,
    normalizePath,
    isKittyInstalled,
    KITTEN_CANDIDATES,
    KITTY_CANDIDATES
};

module.exports = handler;
