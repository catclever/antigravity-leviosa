/**
 * Antigravity Project-Level Permissions Worker API
 * Path: worker/project_permissions_api.js
 * Task ID: project_permissions_ux_merge_and_prompt_shield_077
 *
 * Restores and manages per-project permission presets, granular execution/file/network policies,
 * project-scoped allow/deny/ask permission grants, and per-project rejected merge ancestor directories
 * across ~/.gemini/config/projects/*.json and ~/.gemini/antigravity/project_permissions.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.gemini/config/projects');
const DEFAULT_GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.gemini/config/config.json');
const DEFAULT_CANONICAL_STORE_PATH = path.join(os.homedir(), '.gemini/antigravity/project_permissions.json');

function resolveStorePaths() {
    return {
        PROJECTS_DIR: process.env.LEVIOSA_TEST_PROJECTS_DIR || DEFAULT_PROJECTS_DIR,
        GLOBAL_CONFIG_PATH: process.env.LEVIOSA_TEST_GLOBAL_CONFIG_PATH || DEFAULT_GLOBAL_CONFIG_PATH,
        CANONICAL_STORE_PATH: process.env.LEVIOSA_TEST_CANONICAL_STORE_PATH || DEFAULT_CANONICAL_STORE_PATH
    };
}

function safeDecode(val) {
    if (typeof val !== 'string') return '';
    try {
        return val.includes('%') ? decodeURIComponent(val) : val;
    } catch (e) {
        return val;
    }
}

function readJsonSafe(filePath, fallback = null) {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

function writeJsonAtomic(filePath, data) {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

function loadCanonicalStore(canonicalStorePath) {
    const data = readJsonSafe(canonicalStorePath, null);
    if (data && typeof data === 'object') {
        data.projects = data.projects && typeof data.projects === 'object' ? data.projects : {};
        data.byName = data.byName && typeof data.byName === 'object' ? data.byName : {};
        return data;
    }
    return { version: 1, updatedAt: new Date().toISOString(), projects: {}, byName: {} };
}

function saveCanonicalStore(canonicalStorePath, store) {
    store.updatedAt = new Date().toISOString();
    writeJsonAtomic(canonicalStorePath, store);
}

function loadGlobalBaseline(globalConfigPath) {
    const cfg = readJsonSafe(globalConfigPath, {});
    const us = (cfg && cfg.userSettings) || {};
    const grantsObj = us.globalPermissionGrants || {};
    return {
        permissionPreset: us.permissionPreset || 'AGENT_PERMISSION_PRESET_DEFAULT',
        autoExecutionPolicy: us.autoExecutionPolicy || 'CASCADE_COMMANDS_AUTO_EXECUTION_PROCEED_IN_SANDBOX',
        sandboxMode: us.enableTerminalSandbox !== undefined ? Boolean(us.enableTerminalSandbox) : true,
        fileAccessPolicy: us.nonWorkspaceFileAccessPolicy || 'AGENT_SETTING_POLICY_ASK',
        internetPolicy: us.internetPolicy || 'AGENT_SETTING_POLICY_ASK',
        artifactReviewMode: us.artifactReviewMode || 'ARTIFACT_REVIEW_MODE_DEFAULT',
        permissionGrants: {
            allow: Array.isArray(grantsObj.allow) ? grantsObj.allow : [],
            deny: Array.isArray(grantsObj.deny) ? grantsObj.deny : [],
            ask: Array.isArray(grantsObj.ask) ? grantsObj.ask : []
        }
    };
}

function extractWorkspacePaths(rawProject) {
    const workspaces = [];
    const resources = rawProject?.projectResources?.resources;
    if (Array.isArray(resources)) {
        for (const r of resources) {
            const uri = r?.gitFolder?.folderUri || r?.folderUri || '';
            if (uri) {
                const cleanPath = safeDecode(uri.replace(/^file:\/\//, ''));
                workspaces.push(cleanPath);
            }
        }
    }
    const envs = rawProject?.environments?.environments;
    if (Array.isArray(envs)) {
        for (const env of envs) {
            const envRes = env?.resources?.resources;
            if (Array.isArray(envRes)) {
                for (const r of envRes) {
                    const uri = r?.gitFolder?.folderUri || r?.folderUri || '';
                    if (uri) {
                        const cleanPath = safeDecode(uri.replace(/^file:\/\//, ''));
                        if (!workspaces.includes(cleanPath)) workspaces.push(cleanPath);
                    }
                }
            }
        }
    }
    return workspaces;
}

function normalizeGrants(rawGrantsContainer, canonicalGrants) {
    const inner = rawGrantsContainer?.permissionGrants || rawGrantsContainer || {};
    const allow = Array.isArray(inner.allow)
        ? inner.allow
        : Array.isArray(canonicalGrants?.allow)
            ? canonicalGrants.allow
            : [];
    const deny = Array.isArray(inner.deny)
        ? inner.deny
        : Array.isArray(canonicalGrants?.deny)
            ? canonicalGrants.deny
            : [];
    const ask = Array.isArray(inner.ask)
        ? inner.ask
        : Array.isArray(canonicalGrants?.ask)
            ? canonicalGrants.ask
            : [];
    return {
        allow: Array.from(new Set(allow.map(s => String(s).trim()).filter(Boolean))),
        deny: Array.from(new Set(deny.map(s => String(s).trim()).filter(Boolean))),
        ask: Array.from(new Set(ask.map(s => String(s).trim()).filter(Boolean)))
    };
}

function normalizeSingleRejectedDir(dirVal) {
    const raw = String(dirVal || '').trim();
    if (!raw) return '';

    const urlMatch = raw.match(/^(https?:\/\/[^\/]+)(\/.*)?$/i);
    if (urlMatch) {
        const origin = urlMatch[1].toLowerCase();
        const strippedRest = (urlMatch[2] || '').replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const segs = strippedRest.split('/').filter(Boolean);
        return segs.length === 0 ? `${origin}/` : `${origin}/${segs.join('/')}/`;
    }

    const decoded = safeDecode(raw.replace(/^file:\/\//i, '')).trim();
    if (!decoded) return '';

    if (decoded.startsWith('~/') || decoded === '~' || decoded === '~/**' || decoded === '~/*') {
        const stripped = decoded.replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const sub = stripped === '~' ? '' : stripped.slice(2);
        const segs = sub.split('/').filter(Boolean);
        return segs.length === 0 ? '~/' : `~/${segs.join('/')}/`;
    }

    if (decoded.startsWith('/')) {
        const stripped = decoded.replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const segs = stripped.split('/').filter(Boolean);
        return segs.length === 0 ? '/' : `/${segs.join('/')}/`;
    }

    return decoded.replace(/\/+$/, '') + '/';
}

function normalizeRejectedMergeDirs(rawArr, canonicalArr) {
    const source = Array.isArray(rawArr)
        ? rawArr
        : Array.isArray(canonicalArr)
            ? canonicalArr
            : [];
    const out = [];
    const seen = new Set();
    for (const item of source) {
        const norm = normalizeSingleRejectedDir(item);
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            out.push(norm);
        }
    }
    return out;
}

function normalizeSettings(rawSettings, canonicalSettings, globalBaseline) {
    const s = { ...(canonicalSettings || {}), ...(rawSettings || {}) };
    return {
        permissionPreset: s.permissionPreset || globalBaseline.permissionPreset || 'AGENT_PERMISSION_PRESET_DEFAULT',
        autoExecutionPolicy: s.autoExecutionPolicy || globalBaseline.autoExecutionPolicy || 'CASCADE_COMMANDS_AUTO_EXECUTION_PROCEED_IN_SANDBOX',
        sandboxMode: s.sandboxMode !== undefined ? Boolean(s.sandboxMode) : Boolean(globalBaseline.sandboxMode),
        fileAccessPolicy: s.fileAccessPolicy || globalBaseline.fileAccessPolicy || 'AGENT_SETTING_POLICY_ASK',
        internetPolicy: s.internetPolicy || globalBaseline.internetPolicy || 'AGENT_SETTING_POLICY_ASK',
        artifactReviewMode: s.artifactReviewMode || globalBaseline.artifactReviewMode || 'ARTIFACT_REVIEW_MODE_ALWAYS'
    };
}

function hasConfiguredProjectPermissions(rawProject, permissionGrants) {
    const s = rawProject?.settings;
    const hasSettings = Boolean(
        s &&
        typeof s === 'object' &&
        (
            (s.autoExecutionPolicy && s.autoExecutionPolicy !== 'CASCADE_COMMANDS_AUTO_EXECUTION_UNSPECIFIED') ||
            (s.fileAccessPolicy && s.fileAccessPolicy !== 'AGENT_SETTING_POLICY_UNSPECIFIED') ||
            (s.internetPolicy && s.internetPolicy !== 'AGENT_SETTING_POLICY_UNSPECIFIED') ||
            s.sandboxMode !== undefined
        )
    );
    const hasGrants = Boolean(
        permissionGrants &&
        (
            (Array.isArray(permissionGrants.allow) && permissionGrants.allow.length > 0) ||
            (Array.isArray(permissionGrants.deny) && permissionGrants.deny.length > 0) ||
            (Array.isArray(permissionGrants.ask) && permissionGrants.ask.length > 0)
        )
    );
    return hasSettings || hasGrants;
}

function normalizeProjectRecord(rawProject, filePath, canonicalStore, globalBaseline) {
    const id = rawProject.id || path.basename(filePath, '.json');
    const name = rawProject.name || (id === 'outside-of-project' ? 'Outside of Project' : id);
    const canonical = canonicalStore.projects[id] || canonicalStore.byName[name] || null;
    const workspaces = extractWorkspacePaths(rawProject);
    const workspaceBasenames = workspaces.map(w => path.basename(w)).filter(Boolean);
    const permissionGrants = normalizeGrants(rawProject.permissionGrants, canonical?.permissionGrants);
    const rejectedMergeDirs = normalizeRejectedMergeDirs(rawProject.taichiRejectedMergeDirs, canonical?.rejectedMergeDirs);
    const settings = normalizeSettings(rawProject.settings, canonical?.settings, globalBaseline);

    let enabled = false;
    if (canonical && typeof canonical.enabled === 'boolean') {
        enabled = canonical.enabled;
    } else if (typeof rawProject.taichiProjectPermissionsEnabled === 'boolean') {
        enabled = rawProject.taichiProjectPermissionsEnabled;
    } else {
        enabled = hasConfiguredProjectPermissions(rawProject, permissionGrants);
    }

    return {
        id,
        name,
        filePath,
        workspaces,
        workspaceBasenames,
        enabled,
        taichiProjectPermissionsEnabled: enabled,
        settings,
        permissionGrants,
        rejectedMergeDirs,
        isWorkspaceOnly: Boolean(rawProject.isWorkspaceOnly),
        archived: Boolean(rawProject.archived),
        updatedAt: rawProject.updatedAt || canonical?.updatedAt || null
    };
}

function scanAllProjects(projectsDir, canonicalStore, globalBaseline) {
    const results = [];
    if (fs.existsSync(projectsDir)) {
        const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const fullPath = path.join(projectsDir, file);
            const raw = readJsonSafe(fullPath, null);
            if (!raw || typeof raw !== 'object') continue;
            results.push(normalizeProjectRecord(raw, fullPath, canonicalStore, globalBaseline));
        }
    }
    return results;
}

function matchProject(projects, projectId, projectName) {
    const cleanId = (projectId || '').trim();
    const cleanName = (projectName || '').trim();
    const lowerName = cleanName.toLowerCase();

    if (cleanId) {
        const byId = projects.find(p => p.id === cleanId);
        if (byId) return byId;
    }
    if (cleanName) {
        const byExactName = projects.find(p => (p.name || '').toLowerCase() === lowerName);
        if (byExactName) return byExactName;

        const byBasename = projects.find(p =>
            Array.isArray(p.workspaceBasenames) &&
            p.workspaceBasenames.some(b => b.toLowerCase() === lowerName)
        );
        if (byBasename) return byBasename;

        const byWorkspaceSuffix = projects.find(p =>
            Array.isArray(p.workspaces) &&
            p.workspaces.some(w => w.toLowerCase().endsWith('/' + lowerName))
        );
        if (byWorkspaceSuffix) return byWorkspaceSuffix;
    }
    return null;
}

function decodeBase64Json(rawB64) {
    if (typeof rawB64 !== 'string' || !rawB64.trim()) return null;
    const candidates = [rawB64.trim(), safeDecode(rawB64.trim())];
    for (const cand of candidates) {
        try {
            // Normalize URL-safe base64 (-_ -> +/) and restore spaces mangled from +
            let normalized = cand.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
            const padMod = normalized.length % 4;
            if (padMod === 2) normalized += '==';
            else if (padMod === 3) normalized += '=';
            const jsonStr = Buffer.from(normalized, 'base64').toString('utf-8');
            const parsed = JSON.parse(jsonStr);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) {}
    }
    return null;
}

function parseInputPayload(query = {}, body = {}) {
    if (
        body &&
        typeof body === 'object' &&
        Object.keys(body).length > 0 &&
        (body.settings || body.permissionGrants || body.projectId || body.enabled !== undefined || body.rejectedMergeDirs !== undefined)
    ) {
        return body;
    }
    if (typeof query.payload_b64 === 'string' && query.payload_b64.trim()) {
        const decoded = decodeBase64Json(query.payload_b64);
        if (decoded) return decoded;
    }
    if (typeof query.payload === 'string' && query.payload.trim()) {
        try {
            return JSON.parse(safeDecode(query.payload));
        } catch (e) {}
    }
    return {
        projectId: safeDecode(query.projectId || query.id || ''),
        projectName: safeDecode(query.projectName || query.project || query.name || ''),
        enabled: query.enabled !== undefined ? (query.enabled === 'true' || query.enabled === true || query.enabled === '1') : undefined
    };
}

function cleanupBogusCustomProject(projectsDir, canonicalStorePath, canonicalStore) {
    let storeMutated = false;
    const bogusPath = path.join(projectsDir, 'custom-project.json');
    if (fs.existsSync(bogusPath)) {
        try { fs.unlinkSync(bogusPath); } catch (e) {}
    }
    if (canonicalStore && canonicalStore.projects && canonicalStore.projects['custom-project']) {
        delete canonicalStore.projects['custom-project'];
        storeMutated = true;
    }
    if (canonicalStore && canonicalStore.byName && canonicalStore.byName['custom-project']) {
        delete canonicalStore.byName['custom-project'];
        storeMutated = true;
    }
    if (storeMutated) {
        saveCanonicalStore(canonicalStorePath, canonicalStore);
    }
}

module.exports = async function(query = {}, body = {}) {
    const { PROJECTS_DIR, GLOBAL_CONFIG_PATH, CANONICAL_STORE_PATH } = resolveStorePaths();
    const action = safeDecode(query.action || body?.action || 'list') || 'list';
    const canonicalStore = loadCanonicalStore(CANONICAL_STORE_PATH);
    cleanupBogusCustomProject(PROJECTS_DIR, CANONICAL_STORE_PATH, canonicalStore);
    const globalBaseline = loadGlobalBaseline(GLOBAL_CONFIG_PATH);

    try {
        if (action === 'list' || action === 'get') {
            const payload = parseInputPayload(query, body);
            const projects = scanAllProjects(PROJECTS_DIR, canonicalStore, globalBaseline);
            const reqId = (payload.projectId || safeDecode(query.projectId || query.id || '')).trim();
            const reqName = (payload.projectName || safeDecode(query.projectName || query.project || query.name || '')).trim();

            const matched = (reqId || reqName) ? matchProject(projects, reqId, reqName) : null;

            return {
                success: true,
                action,
                project: matched,
                projects,
                globalBaseline,
                canonicalStorePath: CANONICAL_STORE_PATH
            };
        }

        if (action === 'enable_all_configured') {
            let enabledCount = 0;
            const updatedProjects = [];
            const nowIso = new Date().toISOString();

            if (fs.existsSync(PROJECTS_DIR)) {
                const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const fullPath = path.join(PROJECTS_DIR, file);
                    const rawProject = readJsonSafe(fullPath, null);
                    if (!rawProject || typeof rawProject !== 'object') continue;

                    const grants = rawProject.permissionGrants?.permissionGrants || rawProject.permissionGrants || {};
                    const hasGrants = (Array.isArray(grants.allow) && grants.allow.length > 0) ||
                                      (Array.isArray(grants.deny) && grants.deny.length > 0) ||
                                      (Array.isArray(grants.ask) && grants.ask.length > 0);
                    const s = rawProject.settings;
                    const hasSettings = s && typeof s === 'object' && (
                        (s.autoExecutionPolicy && s.autoExecutionPolicy !== 'CASCADE_COMMANDS_AUTO_EXECUTION_UNSPECIFIED') ||
                        (s.fileAccessPolicy && s.fileAccessPolicy !== 'AGENT_SETTING_POLICY_UNSPECIFIED') ||
                        (s.internetPolicy && s.internetPolicy !== 'AGENT_SETTING_POLICY_UNSPECIFIED') ||
                        s.sandboxMode !== undefined
                    );

                    if (hasGrants || hasSettings) {
                        const id = rawProject.id || path.basename(file, '.json');
                        const name = rawProject.name || id;
                        const norm = normalizeProjectRecord(rawProject, fullPath, canonicalStore, globalBaseline);
                        norm.enabled = true;

                        rawProject.taichiProjectPermissionsEnabled = true;
                        rawProject.taichiRejectedMergeDirs = norm.rejectedMergeDirs;
                        rawProject.updatedAt = nowIso;
                        writeJsonAtomic(fullPath, rawProject);

                        canonicalStore.projects[id] = {
                            id,
                            name,
                            enabled: true,
                            settings: norm.settings,
                            permissionGrants: norm.permissionGrants,
                            rejectedMergeDirs: norm.rejectedMergeDirs,
                            updatedAt: nowIso
                        };
                        if (name) {
                            canonicalStore.byName[name] = canonicalStore.projects[id];
                        }
                        enabledCount++;
                        updatedProjects.push(name);
                    }
                }
                saveCanonicalStore(CANONICAL_STORE_PATH, canonicalStore);
            }

            return {
                success: true,
                action,
                enabledCount,
                projects: updatedProjects,
                timestamp: nowIso
            };
        }

        if (action === 'save') {
            const payload = parseInputPayload(query, body);
            const projects = scanAllProjects(PROJECTS_DIR, canonicalStore, globalBaseline);
            const reqId = (payload.projectId || safeDecode(query.projectId || '')).trim();
            const reqName = (payload.projectName || safeDecode(query.projectName || query.project || '')).trim();

            let matched = matchProject(projects, reqId, reqName);
            let targetFilePath = matched ? matched.filePath : null;
            let rawProject = targetFilePath ? readJsonSafe(targetFilePath, null) : null;

            if (!rawProject) {
                if (!reqId || reqId === 'custom-project') {
                    return {
                        success: false,
                        action: 'save',
                        error: `Cannot save project permissions: missing or unmatched projectId (reqId="${reqId}", reqName="${reqName}")`
                    };
                }
                const effectiveId = reqId;
                targetFilePath = path.join(PROJECTS_DIR, `${effectiveId}.json`);
                rawProject = readJsonSafe(targetFilePath, null) || {
                    id: effectiveId,
                    name: reqName || effectiveId,
                    projectResources: { resources: [] },
                    permissionGrants: { permissionGrants: { allow: [], deny: [], ask: [] }, v2Migrated: true },
                    settings: {}
                };
            }

            const prevNormalized = normalizeProjectRecord(rawProject, targetFilePath, canonicalStore, globalBaseline);
            const nextEnabled = payload.enabled !== undefined ? Boolean(payload.enabled) : prevNormalized.enabled;

            const incomingSettings = payload.settings || {};
            const nextSettings = {
                fileAccessPolicy: incomingSettings.fileAccessPolicy || prevNormalized.settings.fileAccessPolicy || globalBaseline.fileAccessPolicy || 'AGENT_SETTING_POLICY_ASK',
                internetPolicy: incomingSettings.internetPolicy || prevNormalized.settings.internetPolicy || globalBaseline.internetPolicy || 'AGENT_SETTING_POLICY_ASK',
                sandboxMode: incomingSettings.sandboxMode !== undefined ? Boolean(incomingSettings.sandboxMode) : prevNormalized.settings.sandboxMode,
                autoExecutionPolicy: incomingSettings.autoExecutionPolicy || prevNormalized.settings.autoExecutionPolicy || globalBaseline.autoExecutionPolicy || 'CASCADE_COMMANDS_AUTO_EXECUTION_PROCEED_IN_SANDBOX',
                artifactReviewMode: incomingSettings.artifactReviewMode || prevNormalized.settings.artifactReviewMode || 'ARTIFACT_REVIEW_MODE_ALWAYS',
                permissionPreset: incomingSettings.permissionPreset || prevNormalized.settings.permissionPreset || globalBaseline.permissionPreset || 'AGENT_PERMISSION_PRESET_DEFAULT'
            };

            const incomingGrants = payload.permissionGrants || prevNormalized.permissionGrants || {};
            const nextGrants = {
                allow: Array.isArray(incomingGrants.allow)
                    ? Array.from(new Set(incomingGrants.allow.map(s => String(s).trim()).filter(Boolean)))
                    : prevNormalized.permissionGrants.allow,
                deny: Array.isArray(incomingGrants.deny)
                    ? Array.from(new Set(incomingGrants.deny.map(s => String(s).trim()).filter(Boolean)))
                    : prevNormalized.permissionGrants.deny,
                ask: Array.isArray(incomingGrants.ask)
                    ? Array.from(new Set(incomingGrants.ask.map(s => String(s).trim()).filter(Boolean)))
                    : prevNormalized.permissionGrants.ask
            };

            const nextRejectedMergeDirs = Array.isArray(payload.rejectedMergeDirs)
                ? normalizeRejectedMergeDirs(payload.rejectedMergeDirs, [])
                : prevNormalized.rejectedMergeDirs;

            const nowIso = new Date().toISOString();

            // Preserve all existing fields on rawProject
            rawProject.taichiProjectPermissionsEnabled = nextEnabled;
            rawProject.taichiRejectedMergeDirs = nextRejectedMergeDirs;
            rawProject.settings = {
                ...(rawProject.settings || {}),
                ...nextSettings
            };
            rawProject.permissionGrants = {
                ...(rawProject.permissionGrants || {}),
                permissionGrants: {
                    ...(rawProject.permissionGrants?.permissionGrants || {}),
                    allow: nextGrants.allow,
                    ...(nextGrants.deny.length > 0 ? { deny: nextGrants.deny } : {}),
                    ...(nextGrants.ask.length > 0 ? { ask: nextGrants.ask } : {})
                },
                v2Migrated: true
            };
            if (nextGrants.deny.length === 0 && rawProject.permissionGrants.permissionGrants) {
                delete rawProject.permissionGrants.permissionGrants.deny;
            }
            if (nextGrants.ask.length === 0 && rawProject.permissionGrants.permissionGrants) {
                delete rawProject.permissionGrants.permissionGrants.ask;
            }
            rawProject.updatedAt = nowIso;

            writeJsonAtomic(targetFilePath, rawProject);

            const canonicalEntry = {
                id: rawProject.id,
                name: rawProject.name,
                enabled: nextEnabled,
                settings: nextSettings,
                permissionGrants: nextGrants,
                rejectedMergeDirs: nextRejectedMergeDirs,
                updatedAt: nowIso
            };
            canonicalStore.projects[rawProject.id] = canonicalEntry;
            if (rawProject.name) {
                canonicalStore.byName[rawProject.name] = canonicalEntry;
            }
            saveCanonicalStore(CANONICAL_STORE_PATH, canonicalStore);

            const updatedProject = normalizeProjectRecord(rawProject, targetFilePath, canonicalStore, globalBaseline);
            const allProjects = scanAllProjects(PROJECTS_DIR, canonicalStore, globalBaseline);

            return {
                success: true,
                action: 'save',
                project: updatedProject,
                projects: allProjects,
                globalBaseline
            };
        }

        return {
            success: false,
            error: `Unknown action: ${action}`
        };
    } catch (err) {
        return {
            success: false,
            error: err.message || String(err)
        };
    }
};

module.exports.normalizeRejectedMergeDirs = normalizeRejectedMergeDirs;
