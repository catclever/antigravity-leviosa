"use strict";

/**
 * 🛡️ Antigravity Project-Level Permissions Restoration & Concurrent Isolation
 * Task ID: project_permissions_ux_merge_and_prompt_shield_077
 *
 * Responsibilities:
 * 1. Conversation-Level Presets (Native Chat Footer):
 *    - Unlocks `conversationScopedPermissions` in FeatureManagerV2 / SetMendelFlagOverrides
 *      so Antigravity's native "This Conversation" preset selector in the chat footer works independently.
 *    - Does NOT overwrite conversation presets from project settings.
 * 2. Project-Level File & Execution Permissions (Topbar Icon + Project Settings Card + Daemon):
 *    - Manages per-project Execution Permissions (`autoExecutionPolicy`, `sandboxMode`, `command(...)` grants)
 *      and File/Network Permissions (`fileAccessPolicy`, `internetPolicy`, `read_file`/`write_file`/`read_url`/`mcp` grants).
 *    - Injects a pure icon button (`#leviosa-topbar-project-perm-btn`) in the Topbar immediately left of the Project Name.
 *    - Restores the "Project Permissions" card (`#leviosa-project-settings-perm-wrapper`) in Project Settings.
 *    - Background ConnectRPC Auto-Approval Daemon evaluates `waitingSteps` across all concurrent conversations
 *      and subagents belonging to the project without touching global `config.json`.
 * 3. UX Enhancements (Task 077):
 *    - Top-anchored minimalist 3-element auto-approval toast right below `#leviosa-topbar-project-perm-btn`.
 *    - Pure pill badges (`✓ read`, `× write`, etc.) + bare target paths across Popover & Settings Card + inline editor.
 *    - Bottom-up post-order Trie parent-path merge detector (`detectMergeableGrantGroups`) stopping at first common ancestor,
 *      with per-project Ceiling Barrier (`rejectedMergeDirs`) to block unwanted ancestor merges without upward leakage.
 *    - Native permission prompt `this conversation` right-side pure shield button (`maintainPermissionPromptButtons`).
 */

import { extractActiveProjectName, extractActiveUUID } from './project_opener.js';

const WORKER_API_URL = 'http://127.0.0.1:9216/api/script/apps/com.google.antigravity/worker/project_permissions_api';

const AUTO_EXEC_OPTIONS = [
    {
        value: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF',
        label: 'Off (总是询问确认)',
        shortLabel: 'Off (需确认)',
        desc: '绝不自动执行终端命令（命中 Allow 白名单除外）',
        protoInt: 1
    },
    {
        value: 'CASCADE_COMMANDS_AUTO_EXECUTION_PROCEED_IN_SANDBOX',
        label: 'Proceed in Sandbox (沙盒内自动执行)',
        shortLabel: '沙盒内自动',
        desc: '沙盒内的命令自动放行，超出沙盒需确认',
        protoInt: 4
    },
    {
        value: 'CASCADE_COMMANDS_AUTO_EXECUTION_AUTO',
        label: 'Auto (智能判断)',
        shortLabel: '智能自动',
        desc: '由模型评估命令安全性并按规则放行',
        protoInt: 2
    },
    {
        value: 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER',
        label: 'Always Proceed (总是自动执行)',
        shortLabel: '总是自动执行',
        desc: '自动放行该项目下的终端命令（命中 Deny 黑名单除外）',
        protoInt: 3
    }
];

const FILE_POLICY_OPTIONS = [
    { value: 'AGENT_SETTING_POLICY_ASK', label: 'Ask (询问确认)', shortLabel: 'Ask (询问)', protoInt: 2 },
    { value: 'AGENT_SETTING_POLICY_ALLOW', label: 'Allow (允许读写)', shortLabel: 'Allow (允许)', protoInt: 1 },
    { value: 'AGENT_SETTING_POLICY_DENY', label: 'Deny (禁止访问)', shortLabel: 'Deny (禁止)', protoInt: 3 }
];

const INTERNET_POLICY_OPTIONS = [
    { value: 'AGENT_SETTING_POLICY_ALLOW', label: 'Allow (允许访问)', shortLabel: 'Allow (允许)', protoInt: 1 },
    { value: 'AGENT_SETTING_POLICY_ASK', label: 'Ask (询问确认)', shortLabel: 'Ask (询问)', protoInt: 2 },
    { value: 'AGENT_SETTING_POLICY_DENY', label: 'Deny (禁止访问)', shortLabel: 'Deny (禁止)', protoInt: 3 }
];

const GRANT_CATEGORIES = [
    { value: 'read_file', label: 'read', group: 'file', placeholder: '输入文件或目录路径，如 /Users/kael/.gemini/' },
    { value: 'write_file', label: 'write', group: 'file', placeholder: '输入文件或目录路径，如 /Users/kael/Projects/' },
    { value: 'read_url', label: 'url', group: 'net', placeholder: '输入 URL 或域名前缀，如 https://github.com/' },
    { value: 'command', label: 'command', group: 'exec', placeholder: '输入命令或通配符，如 git * 或 npm test' },
    { value: 'mcp', label: 'mcp', group: 'net', placeholder: '输入 MCP 工具匹配，如 kanban-task-manager:*' }
];

const KNOWN_ACTION_TOKENS = new Set([
    'read', 'read_file',
    'write', 'write_file',
    'url', 'read_url', 'execute_url', 'download_url',
    'command', 'unsandboxed',
    'mcp'
]);

const MERGEABLE_CANONICAL_ACTIONS = new Set(['read_file', 'write_file', 'read_url']);

// Runtime State
const projectPermissionsMap = new Map(); // projectId -> normalized project config
const projectByNameMap = new Map();      // lowercase name / workspace basename -> project config
const convProjectIdCache = new Map();    // cascadeId -> resolved projectId
const processedSteps = new Set();        // `${trajectoryId}:${stepIndex}`
let cachedAgRuntime = null;
let globalBaselineConfig = null;
let lastResolvedProjectId = null;
let popoverEl = null;
let isPopoverOpen = false;
let activeAnchorEl = null;
let autoApprovedCount = 0;
let backendConvScopedSupported = false;
let mendelUnlockAttempted = false;
let storeUnsubscribe = null;

/**
 * Helpers: String escaping, URI decoding, Action mapping & Enum conversions
 */
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeDecodeURIComponent(str) {
    const raw = String(str || '');
    try {
        return decodeURIComponent(raw);
    } catch (e) {
        return raw;
    }
}

export function actionToShortLabel(action) {
    const norm = String(action || '').trim().toLowerCase();
    switch (norm) {
        case 'read_file':
        case 'read':
            return 'read';
        case 'write_file':
        case 'write':
            return 'write';
        case 'read_url':
        case 'execute_url':
        case 'download_url':
        case 'url':
            return 'url';
        case 'command':
        case 'unsandboxed':
            return 'command';
        case 'mcp':
            return 'mcp';
        default:
            return norm;
    }
}

export function shortLabelToCanonicalAction(shortOrRaw) {
    const norm = String(shortOrRaw || '').trim().toLowerCase();
    switch (norm) {
        case 'read':
        case 'read_file':
            return 'read_file';
        case 'write':
        case 'write_file':
            return 'write_file';
        case 'url':
        case 'read_url':
        case 'execute_url':
        case 'download_url':
            return 'read_url';
        case 'command':
        case 'unsandboxed':
            return 'command';
        case 'mcp':
            return 'mcp';
        default:
            return norm;
    }
}

export function unwrapGrantRule(ruleStr) {
    const raw = String(ruleStr || '').trim();
    const m = raw.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\(([\s\S]*)\)$/);
    if (!m) {
        return {
            canonicalAction: 'read_file',
            shortAction: 'read',
            bareTarget: raw
        };
    }
    const rawAction = m[1].trim();
    const canonicalAction = shortLabelToCanonicalAction(rawAction);
    const shortAction = actionToShortLabel(canonicalAction);
    const bareTarget = m[2].trim();
    return {
        canonicalAction,
        shortAction,
        bareTarget
    };
}

export function formatToastTarget(rawTarget, shortAction) {
    const stripped = String(rawTarget || '').replace(/^file:\/\//i, '');
    const cleaned = safeDecodeURIComponent(stripped).replace(/[\r\n]+/g, ' ').trim();
    if (!cleaned) return '';
    if (cleaned.length <= 54) return cleaned;

    const isPath = shortAction === 'read' || shortAction === 'write' || cleaned.startsWith('/') || cleaned.startsWith('~/');
    if (isPath) {
        const hasTrailingSlash = cleaned.length > 2 && cleaned.endsWith('/');
        const trailing = hasTrailingSlash ? '/' : '';

        let head = '';
        let rest = '';
        if (cleaned.startsWith('~/')) {
            head = '~';
            rest = cleaned.slice(2);
        } else if (cleaned.startsWith('/')) {
            const trimmed = cleaned.replace(/^\/+/, '').replace(/\/+$/, '');
            const segs = trimmed.split('/').filter(Boolean);
            if (segs.length >= 3) {
                head = `/${segs[0]}`;
                rest = segs.slice(1).join('/');
            } else {
                return cleaned.slice(0, 52) + '…';
            }
        } else {
            const segs = cleaned.replace(/\/+$/, '').split('/').filter(Boolean);
            if (segs.length >= 3) {
                head = segs[0];
                rest = segs.slice(1).join('/');
            } else {
                return cleaned.slice(0, 52) + '…';
            }
        }

        const restSegs = rest.replace(/\/+$/, '').split('/').filter(Boolean);
        if (restSegs.length <= 2 && head === '~') {
            return cleaned.length <= 56 ? cleaned : cleaned.slice(0, 52) + '…';
        }

        const tail2Segs = restSegs.slice(-2);
        let tailStr = tail2Segs.join('/') + trailing;
        let candidate = `${head}/…/${tailStr}`;
        if (candidate.length <= 56) {
            return candidate;
        }

        // Keep filename intact if possible while shortening long parent segment (e.g. UUID dir)
        const prefixLen = head.length + 3; // `${head}/…/`
        const maxTailBudget = Math.max(18, 56 - prefixLen);
        if (tail2Segs.length === 2) {
            const parentSeg = tail2Segs[0];
            const leafSeg = tail2Segs[1] + trailing;
            if (leafSeg.length + 4 <= maxTailBudget) {
                const parentBudget = Math.max(4, maxTailBudget - leafSeg.length - 2);
                return `${head}/…/${parentSeg.slice(0, parentBudget)}…/${leafSeg}`;
            }
            if (leafSeg.length <= maxTailBudget) {
                return `${head}/…/${leafSeg}`;
            }
            return `${head}/…/${leafSeg.slice(0, maxTailBudget - 1)}…`;
        }

        return `${head}/…/${tailStr.slice(0, maxTailBudget - 1)}…`;
    }

    return cleaned.slice(0, 50) + '…';
}

function getModeSymbol(mode) {
    if (mode === 'deny') return '×';
    if (mode === 'ask') return '?';
    return '✓';
}

function getModePillStyleObj(mode) {
    if (mode === 'deny') {
        return {
            background: 'rgba(239,68,68,0.20)',
            color: '#fca5a5',
            borderColor: 'rgba(239,68,68,0.35)'
        };
    }
    if (mode === 'ask') {
        return {
            background: 'rgba(245,158,11,0.20)',
            color: '#fcd34d',
            borderColor: 'rgba(245,158,11,0.35)'
        };
    }
    return {
        background: 'rgba(16,185,129,0.20)',
        color: '#6ee7b7',
        borderColor: 'rgba(16,185,129,0.35)'
    };
}

function getModePillCss(mode) {
    const st = getModePillStyleObj(mode);
    return `background:${st.background};color:${st.color};border:1px solid ${st.borderColor};`;
}

function applySelectModePillStyle(selectEl, mode) {
    if (!selectEl) return;
    const st = getModePillStyleObj(mode);
    selectEl.style.background = st.background;
    selectEl.style.color = st.color;
    selectEl.style.border = `1px solid ${st.borderColor}`;
}

function buildNormalizedRuleFromInput(rawInput, selectedCanonicalAction, allowOverrideFromWrapped = true) {
    const trimmed = String(rawInput || '').trim();
    if (!trimmed) return '';
    const m = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\(([\s\S]*)\)$/);
    if (m && KNOWN_ACTION_TOKENS.has(m[1].trim().toLowerCase())) {
        const innerTarget = m[2].trim();
        if (!innerTarget) return '';
        const finalAct = allowOverrideFromWrapped
            ? shortLabelToCanonicalAction(m[1].trim())
            : shortLabelToCanonicalAction(selectedCanonicalAction);
        return `${finalAct}(${innerTarget})`;
    }
    const canon = shortLabelToCanonicalAction(selectedCanonicalAction || 'read_file');
    return `${canon}(${trimmed})`;
}

function getAutoExecDef(val) {
    return AUTO_EXEC_OPTIONS.find(o => o.value === val) || AUTO_EXEC_OPTIONS[1];
}

function getFilePolicyDef(val) {
    return FILE_POLICY_OPTIONS.find(o => o.value === val) || FILE_POLICY_OPTIONS[0];
}

function getInternetPolicyDef(val) {
    return INTERNET_POLICY_OPTIONS.find(o => o.value === val) || INTERNET_POLICY_OPTIONS[1];
}

function policyToProtoInt(policyStr) {
    const found = FILE_POLICY_OPTIONS.find(o => o.value === policyStr);
    return found ? found.protoInt : 2;
}

function autoExecToProtoInt(execStr) {
    const found = AUTO_EXEC_OPTIONS.find(o => o.value === execStr);
    return found ? found.protoInt : 2;
}

/**
 * Parent-Path Merge Detection Algorithm (Bottom-Up Post-Order Trie + Ceiling Barrier)
 */
export function normalizeRejectedMergeDirEntry(dirVal) {
    const raw = String(dirVal || '').trim();
    if (!raw) return '';

    const urlMatch = raw.match(/^(https?:\/\/[^\/]+)(\/.*)?$/i);
    if (urlMatch) {
        const origin = urlMatch[1].toLowerCase();
        const strippedRest = (urlMatch[2] || '').replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const segs = strippedRest.split('/').filter(Boolean);
        return segs.length === 0 ? `${origin}/` : `${origin}/${segs.join('/')}/`;
    }

    const decoded = safeDecodeURIComponent(raw.replace(/^file:\/\//i, '')).trim();
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

export function normalizeRejectedMergeDirsList(rawList) {
    if (!Array.isArray(rawList)) return [];
    const out = [];
    const seen = new Set();
    for (const item of rawList) {
        const norm = normalizeRejectedMergeDirEntry(item);
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            out.push(norm);
        }
    }
    return out;
}

export function isSafeFilesystemMergeDir(rootKind, dirSegs) {
    if (!Array.isArray(dirSegs)) return false;
    if (dirSegs.some(seg => !seg || seg.includes('*') || seg.includes('?'))) {
        return false;
    }
    if (rootKind === 'tilde') {
        return dirSegs.length >= 1;
    }
    if (rootKind === 'abs') {
        if (dirSegs.length === 0) return false;
        const first = dirSegs[0];
        if (first === 'Users' || first === 'home') {
            return dirSegs.length >= 3;
        }
        if (first === 'private' && (dirSegs[1] === 'tmp' || dirSegs[1] === 'var')) {
            return dirSegs.length >= 3;
        }
        return dirSegs.length >= 2;
    }
    return false;
}

function parseRuleTargetForMergeTree(bareTarget) {
    const raw = String(bareTarget || '').trim();
    if (!raw) return null;

    // 1. Check HTTP/HTTPS URL path
    const urlMatch = raw.match(/^(https?:\/\/[^\/]+)(\/.*)?$/i);
    if (urlMatch) {
        const origin = urlMatch[1].toLowerCase();
        const rawRest = urlMatch[2] || '';
        const isExplicitDir = rawRest === '' || rawRest === '/' || /(?:\/\*\*|\/\*|\/)$/.test(rawRest);
        const strippedRest = rawRest.replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const segs = strippedRest.split('/').filter(Boolean);
        return {
            treeKey: `url:${origin}`,
            kind: 'url',
            origin,
            rootKind: null,
            segs,
            isExplicitDir
        };
    }

    // 2. Check Local Filesystem path (/... or ~/...)
    const decoded = safeDecodeURIComponent(raw.replace(/^file:\/\//i, '')).trim();
    if (decoded.startsWith('~/') || decoded === '~/**' || decoded === '~/*') {
        const isExplicitDir = /(?:\/\*\*|\/\*|\/)$/.test(decoded);
        const stripped = decoded.replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const sub = stripped === '~' ? '' : stripped.slice(2);
        const segs = sub.split('/').filter(Boolean);
        return {
            treeKey: 'fs:tilde',
            kind: 'fs',
            origin: null,
            rootKind: 'tilde',
            segs,
            isExplicitDir
        };
    }

    if (decoded.startsWith('/')) {
        const isExplicitDir = /(?:\/\*\*|\/\*|\/)$/.test(decoded);
        const stripped = decoded.replace(/(?:\/\*\*|\/\*|\/)+$/, '');
        const segs = stripped.split('/').filter(Boolean);
        return {
            treeKey: 'fs:abs',
            kind: 'fs',
            origin: null,
            rootKind: 'abs',
            segs,
            isExplicitDir
        };
    }

    return null;
}

function formatMergedDirTargetPath(treeMeta, dirSegs) {
    if (treeMeta.kind === 'url') {
        return dirSegs.length === 0
            ? `${treeMeta.origin}/`
            : `${treeMeta.origin}/${dirSegs.join('/')}/`;
    }
    if (treeMeta.rootKind === 'tilde') {
        return `~/${dirSegs.join('/')}/`;
    }
    return `/${dirSegs.join('/')}/`;
}

function isValidCandidateMergeDir(treeMeta, dirSegs) {
    if (dirSegs.some(seg => !seg || seg.includes('*') || seg.includes('?'))) {
        return false;
    }
    if (treeMeta.kind === 'url') {
        return dirSegs.length >= 0;
    }
    return isSafeFilesystemMergeDir(treeMeta.rootKind, dirSegs);
}

function isStrictSegPrefix(ancestorSegs, descendantSegs) {
    if (ancestorSegs.length >= descendantSegs.length) return false;
    for (let i = 0; i < ancestorSegs.length; i++) {
        if (ancestorSegs[i] !== descendantSegs[i]) return false;
    }
    return true;
}

function hasRejectedBarrierBetween(treeMeta, ancestorSegs, descendantSegs, rejectedSet) {
    if (rejectedSet.size === 0) return false;
    for (let len = ancestorSegs.length + 1; len <= descendantSegs.length; len++) {
        const interPath = formatMergedDirTargetPath(treeMeta, descendantSegs.slice(0, len));
        if (rejectedSet.has(interPath)) {
            return true;
        }
    }
    return false;
}

export function detectMergeableGrantGroups(permissionGrants, rejectedMergeDirs = []) {
    if (!permissionGrants || typeof permissionGrants !== 'object') return [];

    const rejectedSet = new Set(normalizeRejectedMergeDirsList(rejectedMergeDirs));
    const allDetectedGroups = [];

    for (const mode of ['allow', 'deny']) {
        const modeList = Array.isArray(permissionGrants[mode]) ? permissionGrants[mode] : [];
        if (modeList.length < 2) continue;

        // Bucket by canonicalAction -> treeKey
        const actionBuckets = new Map();

        modeList.forEach((rawRule, orderIdx) => {
            const unwrapped = unwrapGrantRule(rawRule);
            if (!MERGEABLE_CANONICAL_ACTIONS.has(unwrapped.canonicalAction)) return;

            const parsedPath = parseRuleTargetForMergeTree(unwrapped.bareTarget);
            if (!parsedPath) return;

            if (!actionBuckets.has(unwrapped.canonicalAction)) {
                actionBuckets.set(unwrapped.canonicalAction, new Map());
            }
            const treeMap = actionBuckets.get(unwrapped.canonicalAction);
            if (!treeMap.has(parsedPath.treeKey)) {
                treeMap.set(parsedPath.treeKey, {
                    meta: {
                        kind: parsedPath.kind,
                        origin: parsedPath.origin,
                        rootKind: parsedPath.rootKind
                    },
                    entries: []
                });
            }
            treeMap.get(parsedPath.treeKey).entries.push({
                orderIdx,
                rawRule,
                segs: parsedPath.segs,
                isExplicitDir: parsedPath.isExplicitDir
            });
        });

        const modeGroups = [];

        for (const [canonicalAction, treeMap] of actionBuckets.entries()) {
            const shortAction = actionToShortLabel(canonicalAction);

            for (const { meta, entries } of treeMap.values()) {
                if (entries.length < 2) continue;

                // Build Trie
                const createTrieNode = (segs) => ({
                    segs,
                    children: new Map(),
                    rules: []
                });
                const root = createTrieNode([]);
                const allNodes = [root];

                for (const entry of entries) {
                    let curr = root;
                    for (let i = 0; i < entry.segs.length; i++) {
                        const seg = entry.segs[i];
                        if (!curr.children.has(seg)) {
                            const nextNode = createTrieNode(entry.segs.slice(0, i + 1));
                            curr.children.set(seg, nextNode);
                            allNodes.push(nextNode);
                        }
                        curr = curr.children.get(seg);
                    }
                    curr.rules.push(entry);
                }

                // Filter candidate directory nodes:
                // - Strict prefixes (children.size > 0) are always directory nodes
                // - Leaf nodes (children.size === 0) are directory nodes ONLY if at least one rule on the node has isExplicitDir === true
                const candidateDirNodes = allNodes.filter(node => {
                    if (node.children.size > 0) return true;
                    return node.rules.some(r => r.isExplicitDir);
                });

                // Sort deepest first (bottom-up post-order)
                candidateDirNodes.sort((a, b) => b.segs.length - a.segs.length);

                const consumedOrders = new Set();
                const collectUnconsumedSubtreeRules = (node, acc) => {
                    for (const r of node.rules) {
                        if (!consumedOrders.has(r.orderIdx)) {
                            acc.push(r);
                        }
                    }
                    for (const child of node.children.values()) {
                        collectUnconsumedSubtreeRules(child, acc);
                    }
                };

                const treeActiveGroups = [];

                for (const dirNode of candidateDirNodes) {
                    if (!isValidCandidateMergeDir(meta, dirNode.segs)) continue;

                    const candidateTargetPath = formatMergedDirTargetPath(meta, dirNode.segs);
                    const pending = [];
                    collectUnconsumedSubtreeRules(dirNode, pending);

                    // Ceiling Barrier: if the user explicitly rejected merging into `candidateTargetPath`,
                    // seal all unconsumed rules under this node so they NEVER bubble past this ceiling
                    // to merge into an even broader parent directory, while keeping deeper childGroups intact.
                    if (rejectedSet.has(candidateTargetPath)) {
                        for (const r of pending) {
                            consumedOrders.add(r.orderIdx);
                        }
                        continue;
                    }

                    // Find strict child groups inside dirNode's subtree that are NOT separated by a rejected barrier
                    const childGroups = treeActiveGroups.filter(
                        g => isStrictSegPrefix(dirNode.segs, g.dirSegs) &&
                             !hasRejectedBarrierBetween(meta, dirNode.segs, g.dirSegs, rejectedSet)
                    );
                    const hasDirectExplicitDirRule = dirNode.rules.some(r => r.isExplicitDir && !consumedOrders.has(r.orderIdx));

                    // Trigger if >= 2 unconsumed rules meet here (spanning >= 2 distinct targets or an explicit dir),
                    // OR if this node already has an explicit directory grant covering >= 1 child rule/group
                    const distinctPendingTargets = new Set(pending.map(r => `${r.isExplicitDir ? 'd' : 'f'}:${r.segs.join('/')}`));
                    const hasMultipleDistinctTargets = distinctPendingTargets.size >= 2 || (pending.some(r => r.isExplicitDir) && pending.length >= 2);
                    const shouldTrigger =
                        (pending.length >= 2 && hasMultipleDistinctTargets) ||
                        (hasDirectExplicitDirRule && (pending.length + childGroups.length >= 2));
                    if (!shouldTrigger) continue;

                    for (const r of pending) {
                        consumedOrders.add(r.orderIdx);
                    }

                    const combinedEntries = [...pending];
                    if (childGroups.length > 0) {
                        const childSet = new Set(childGroups);
                        for (const cg of childGroups) {
                            combinedEntries.push(...cg.entries);
                        }
                        for (let i = treeActiveGroups.length - 1; i >= 0; i--) {
                            if (childSet.has(treeActiveGroups[i])) {
                                treeActiveGroups.splice(i, 1);
                            }
                        }
                    }

                    combinedEntries.sort((a, b) => a.orderIdx - b.orderIdx);
                    if (combinedEntries.length >= 2) {
                        const targetPath = candidateTargetPath;
                        const targetRule = `${canonicalAction}(${targetPath})`;
                        const sourceRules = combinedEntries.map(e => e.rawRule);
                        if (sourceRules.length >= 2) {
                            treeActiveGroups.push({
                                dirSegs: dirNode.segs,
                                minOrderIdx: combinedEntries[0].orderIdx,
                                entries: combinedEntries,
                                id: `${mode}:${canonicalAction}:${targetPath}`,
                                mode,
                                canonicalAction,
                                shortAction,
                                targetPath,
                                targetRule,
                                sourceRules
                            });
                        }
                    }
                }

                for (const g of treeActiveGroups) {
                    modeGroups.push(g);
                }
            }
        }

        modeGroups.sort((a, b) => a.minOrderIdx - b.minOrderIdx);
        for (const g of modeGroups) {
            allDetectedGroups.push({
                id: g.id,
                mode: g.mode,
                canonicalAction: g.canonicalAction,
                shortAction: g.shortAction,
                targetPath: g.targetPath,
                targetRule: g.targetRule,
                sourceRules: g.sourceRules
            });
        }
    }

    return allDetectedGroups;
}

/**
 * Inspect React Root Fiber on #root to extract Redux store, agentService, and projectManagementService
 * Also unlocks `conversationScopedPermissions` in FeatureManagerV2 caches so native "This Conversation" preset works.
 */
function getAgRuntime() {
    if (cachedAgRuntime && cachedAgRuntime.store && document.getElementById('root')) {
        return cachedAgRuntime;
    }
    const rootEl = document.getElementById('root');
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$'));
    if (!containerKey) return null;

    let fiber = rootEl[containerKey];
    let rootProps = null;
    const queue = [fiber];
    let visited = 0;

    while (queue.length > 0 && visited < 200) {
        const curr = queue.shift();
        visited++;
        if (!curr) continue;

        const mp = curr.memoizedProps;
        if (mp && typeof mp === 'object') {
            if (mp.store && mp.agentService && !rootProps) {
                rootProps = mp;
            }
            // Patch FeatureManagerV2 instances so native conversation-level preset selector ("This Conversation") is enabled
            const val = mp.value || mp.featureManagerV2;
            if (val && val.getCache instanceof Map && val.runtimeEnvironment) {
                val.getCache.set('conversationScopedPermissions', { enabled: true });
                val.getCache.set('additionalPermissionPresets', { default: true, auto: true });
                if (Array.isArray(val.runtimeEnvironment.customFlags) && !val.runtimeEnvironment.customFlags.includes('enable-conversation-scoped-permissions')) {
                    val.runtimeEnvironment.customFlags.push('enable-conversation-scoped-permissions');
                }
            }
        }

        if (curr.child) queue.push(curr.child);
        if (curr.sibling) queue.push(curr.sibling);
    }

    if (!rootProps) return null;
    const pmService = rootProps.services?.core?.projectManagementService || null;
    const lsClient = pmService?.lsClient || rootProps.services?.core?.authService?._lsClient || null;

    cachedAgRuntime = {
        store: rootProps.store,
        agentService: rootProps.agentService,
        pmService,
        lsClient,
        settingsProvider: rootProps.settingsProvider,
        featureManagerV2: rootProps.featureManagerV2
    };
    return cachedAgRuntime;
}

async function getConnectRpcBaseAndHeaders() {
    let baseUrl = window.location.origin;
    if (window.lsClient && typeof window.lsClient.getPort === 'function') {
        try {
            const port = await window.lsClient.getPort();
            if (port) baseUrl = `https://127.0.0.1:${port}`;
        } catch (e) {}
    }
    let csrfToken = window.__APP_CONFIG__?.csrfToken || '';
    if (!csrfToken && window.lsClient && typeof window.lsClient.getCsrfToken === 'function') {
        try {
            csrfToken = (await window.lsClient.getCsrfToken()) || '';
        } catch (e) {}
    }
    return {
        baseUrl,
        headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            ...(csrfToken ? { 'x-codeium-csrf-token': csrfToken } : {})
        }
    };
}

/**
 * Worker API Communication
 */
async function loadAllProjectsFromWorker() {
    try {
        const res = await fetch(`${WORKER_API_URL}?action=list&nocache=1&_t=${Date.now()}`);
        const data = await res.json();
        if (data && data.success && Array.isArray(data.projects)) {
            if (data.globalBaseline) {
                globalBaselineConfig = data.globalBaseline;
            }
            projectPermissionsMap.delete('custom-project');
            projectByNameMap.delete('custom-project');
            for (const proj of data.projects) {
                if (proj && proj.id !== 'custom-project') {
                    indexProjectConfig(proj);
                }
            }
            return data;
        }
    } catch (err) {
        console.warn('[Project Permissions] Failed to load project permissions from worker:', err);
    }
    return null;
}

function indexProjectConfig(proj) {
    if (!proj || !proj.id || proj.id === 'custom-project') return;
    proj.rejectedMergeDirs = normalizeRejectedMergeDirsList(proj.rejectedMergeDirs);
    projectPermissionsMap.set(proj.id, proj);
    if (proj.name) {
        projectByNameMap.set(proj.name.toLowerCase(), proj);
    }
    if (Array.isArray(proj.workspaceBasenames)) {
        for (const base of proj.workspaceBasenames) {
            if (base) {
                const lower = base.toLowerCase();
                if (!projectByNameMap.has(lower)) {
                    projectByNameMap.set(lower, proj);
                }
            }
        }
    }
}

async function saveProjectToWorker(payload) {
    const safePayload = payload || {};
    const jsonStr = JSON.stringify(safePayload);
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    const chunkLen = 8192;
    for (let i = 0; i < bytes.length; i += chunkLen) {
        const slice = bytes.subarray(i, Math.min(i + chunkLen, bytes.length));
        for (let j = 0; j < slice.length; j++) {
            binary += String.fromCharCode(slice[j]);
        }
    }
    // Use URL-safe base64 (no +, /, or = that proxies or URL parsers can mangle)
    const b64Url = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const params = new URLSearchParams({
        action: 'save',
        nocache: '1',
        _t: String(Date.now()),
        payload_b64: b64Url
    });
    if (safePayload.projectId) params.set('projectId', String(safePayload.projectId));
    if (safePayload.projectName) params.set('projectName', String(safePayload.projectName));

    const res = await fetch(`${WORKER_API_URL}?${params.toString()}`);
    const data = await res.json();
    if (data && data.success && data.project) {
        indexProjectConfig(data.project);
        if (Array.isArray(data.projects)) {
            for (const p of data.projects) indexProjectConfig(p);
        }
    }
    return data;
}

/**
 * Resolve Project ID for any conversation (including subagents up to 8 levels deep)
 */
function resolveConversationProjectId(cascadeId, summaries, storeState) {
    if (!cascadeId || !summaries) return null;
    if (convProjectIdCache.has(cascadeId)) {
        return convProjectIdCache.get(cascadeId);
    }

    let currId = cascadeId;
    const visited = new Set();

    for (let depth = 0; depth < 8 && currId && !visited.has(currId); depth++) {
        visited.add(currId);
        if (convProjectIdCache.has(currId)) {
            const hit = convProjectIdCache.get(currId);
            convProjectIdCache.set(cascadeId, hit);
            return hit;
        }
        const sum = summaries[currId];
        const meta = sum?.trajectoryMetadata;

        if (meta?.projectId) {
            convProjectIdCache.set(cascadeId, meta.projectId);
            return meta.projectId;
        }
        const mappedByNewConvo = storeState?.newConvoWorkspace?.projectIdsByCascadeId?.[currId];
        if (mappedByNewConvo) {
            convProjectIdCache.set(cascadeId, mappedByNewConvo);
            return mappedByNewConvo;
        }
        if (meta?.rootConversationId && meta.rootConversationId !== currId && summaries[meta.rootConversationId]?.trajectoryMetadata?.projectId) {
            const rootPid = summaries[meta.rootConversationId].trajectoryMetadata.projectId;
            convProjectIdCache.set(cascadeId, rootPid);
            return rootPid;
        }

        // Match by workspace URI if available
        const wsUris = [
            ...(Array.isArray(meta?.workspaceUris) ? meta.workspaceUris : []),
            ...(Array.isArray(sum?.workspaces) ? sum.workspaces.map(w => w?.workspaceFolderAbsoluteUri).filter(Boolean) : [])
        ];
        for (const rawUri of wsUris) {
            const cleanPath = safeDecodeURIComponent(String(rawUri).replace(/^file:\/\//, ''));
            for (const proj of projectPermissionsMap.values()) {
                if (Array.isArray(proj.workspaces) && proj.workspaces.some(w => cleanPath === w || cleanPath.startsWith(w + '/'))) {
                    convProjectIdCache.set(cascadeId, proj.id);
                    return proj.id;
                }
            }
        }

        const nextParent = meta?.parentConversationId || meta?.battleModeMetadata?.parentConversationId || sum?.forkParentConversationId || '';
        if (!nextParent) break;
        currId = nextParent;
    }

    return null;
}

/**
 * Resolve currently active Project in UI (Chat view, New Chat view, or Project Settings view)
 */
function resolveCurrentUiProject() {
    const ag = getAgRuntime();
    const state = ag?.store?.getState?.() || null;
    const summaries = state?.trajectorySummaries?.summaries || {};

    // 1. Check URL ?project=<id>
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlProjId = urlParams.get('project');
        if (urlProjId && projectPermissionsMap.has(urlProjId)) {
            lastResolvedProjectId = urlProjId;
            return projectPermissionsMap.get(urlProjId);
        }
    } catch (e) {}

    // 2. Check Project Settings screen contextProjectId / selectedProjectId
    const settingsProjId = state?.settingsScreen?.contextProjectId || state?.settingsScreen?.selectedProjectId;
    if (settingsProjId && projectPermissionsMap.has(settingsProjId)) {
        const deleteBtn = document.querySelector('[data-testid="delete-project-button"]');
        const custView = document.querySelector('[data-testid="workspace-customizations-view"]');
        const activeScreenStr = String(state?.settingsScreen?.activeScreen || '');
        if (deleteBtn || custView || activeScreenStr === 'Project' || activeScreenStr.startsWith('Project ')) {
            lastResolvedProjectId = settingsProjId;
            return projectPermissionsMap.get(settingsProjId);
        }
    }

    // 3. Check active conversation /c/<cascadeId>
    const activeCascadeId = extractActiveUUID();
    if (activeCascadeId) {
        const convProjId = resolveConversationProjectId(activeCascadeId, summaries, state);
        if (convProjId && projectPermissionsMap.has(convProjId)) {
            lastResolvedProjectId = convProjId;
            return projectPermissionsMap.get(convProjId);
        }
    }

    // 4. Check extracted project name from Topbar / Trigger
    const activeName = extractActiveProjectName();
    if (activeName) {
        const byName = projectByNameMap.get(activeName.toLowerCase());
        if (byName) {
            lastResolvedProjectId = byName.id;
            return byName;
        }
    }

    // 5. Fallback to lastResolvedProjectId
    if (lastResolvedProjectId && projectPermissionsMap.has(lastResolvedProjectId)) {
        return projectPermissionsMap.get(lastResolvedProjectId);
    }

    return null;
}

/**
 * Engine 1: Unlock Native Conversation-Scoped Permissions (for Chat Footer "This Conversation" Preset)
 * & Sync Project File/Execution Settings to Native projectManagementService
 */
async function unlockConversationScopedPermissions() {
    const ag = getAgRuntime();
    if (mendelUnlockAttempted) return backendConvScopedSupported;
    mendelUnlockAttempted = true;

    const isDevMode = Boolean(window.__APP_CONFIG__?.devMode);
    let overrides = {};
    try {
        const raw = localStorage.getItem('jetski.developer.customFlagOverrides');
        if (raw) overrides = JSON.parse(raw) || {};
    } catch (e) {}

    const nextOverrides = {
        ...overrides,
        'enable-conversation-scoped-permissions': true
    };

    try {
        const { baseUrl, headers } = await getConnectRpcBaseAndHeaders();
        const res = await fetch(`${baseUrl}/exa.language_server_pb.LanguageServerService/SetMendelFlagOverrides`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ overrides: nextOverrides })
        });
        if (res.ok) {
            backendConvScopedSupported = true;
            localStorage.setItem('jetski.developer.customFlagOverrides', JSON.stringify(nextOverrides));
            console.log('🔓 [Project Permissions] 已通过 SetMendelFlagOverrides 解锁会话级独立权限预设');
        } else if (!isDevMode) {
            localStorage.removeItem('jetski.developer.customFlagOverrides');
        }
    } catch (e) {
        if (!isDevMode) {
            localStorage.removeItem('jetski.developer.customFlagOverrides');
        }
    }

    // Always patch in-memory FeatureManagerV2 caches so native "This Conversation" preset selector is active
    if (ag?.featureManagerV2?.getCache instanceof Map) {
        ag.featureManagerV2.getCache.set('conversationScopedPermissions', { enabled: true });
        ag.featureManagerV2.getCache.set('additionalPermissionPresets', { default: true, auto: true });
    }

    return backendConvScopedSupported;
}

/**
 * Sync updated project Execution & File settings + grants into Antigravity's in-memory ProjectStateProvider.
 *
 * IMPORTANT: Do NOT call `pm.updateProject(rawProj)` here!
 * 1) `saveProjectToWorker` already atomically persists both `~/.gemini/config/projects/<id>.json`
 *    and `~/.gemini/antigravity/project_permissions.json` on disk (and `language_server` watches the directory).
 * 2) Calling `pm.updateProject(rawProj)` sends a ConnectRPC `UpdateProject` with a plain/mutated protobuf object:
 *    - If `rawProj.permissionGrants` was initially `undefined` (for projects starting with 0 rules),
 *      `language_server` overwrites `~/.gemini/config/projects/<id>.json` with empty `permissionGrants`!
 *    - `language_server`'s `protojson` marshaler also strips custom fields like `taichiProjectPermissionsEnabled: true`!
 */
async function syncProjectToNativePmService(projConfig) {
    if (!projConfig || !projConfig.id) return false;
    const ag = getAgRuntime();
    const pm = ag?.pmService;
    if (!pm || typeof pm.getProjectStateProvider !== 'function') return false;

    try {
        const provider = pm.getProjectStateProvider(projConfig.id);
        const st = provider?.getState?.();
        if (!st || !st.project) return false;

        const rawProj = st.project;
        if (rawProj.settings && typeof rawProj.settings === 'object') {
            if (projConfig.enabled) {
                rawProj.settings.autoExecutionPolicy = autoExecToProtoInt(projConfig.settings.autoExecutionPolicy);
                rawProj.settings.fileAccessPolicy = policyToProtoInt(projConfig.settings.fileAccessPolicy);
                rawProj.settings.internetPolicy = policyToProtoInt(projConfig.settings.internetPolicy);
                rawProj.settings.sandboxMode = Boolean(projConfig.settings.sandboxMode);
            } else {
                rawProj.settings.autoExecutionPolicy = 0;
                rawProj.settings.fileAccessPolicy = 0;
                rawProj.settings.internetPolicy = 0;
            }
        }

        if (rawProj.permissionGrants && rawProj.permissionGrants.permissionGrants) {
            rawProj.permissionGrants.permissionGrants.allow = [...(projConfig.permissionGrants?.allow || [])];
            rawProj.permissionGrants.permissionGrants.deny = [...(projConfig.permissionGrants?.deny || [])];
            rawProj.permissionGrants.permissionGrants.ask = [...(projConfig.permissionGrants?.ask || [])];
        }

        return true;
    } catch (e) {
        console.warn('[Project Permissions] In-memory pmService state sync warning:', e);
        return false;
    }
}

/**
 * Engine 2: Rule & Policy Evaluation (Execution + File/Network Only) + Background Auto-Approval Daemon
 */
function parseRuleString(ruleStr) {
    const m = String(ruleStr || '').trim().match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\(([\s\S]*)\)$/);
    if (!m) return null;
    const action = shortLabelToCanonicalAction(m[1].trim());
    return {
        action,
        pattern: m[2].trim()
    };
}

function globToRegExp(globStr, subpathSuffix = '') {
    let escaped = '';
    for (let i = 0; i < globStr.length; i++) {
        const ch = globStr[i];
        if (ch === '*') {
            if (globStr[i + 1] === '*') {
                escaped += '.*';
                i++;
            } else {
                escaped += '.*';
            }
        } else if (ch === '?') {
            escaped += '.';
        } else if ('+^$()[]{}|\\'.includes(ch)) {
            escaped += '\\' + ch;
        } else {
            escaped += ch;
        }
    }
    return new RegExp(`^${escaped}${subpathSuffix}$`, 'is');
}

function matchGrantPattern(rulePattern, targetValue, normalizedAction) {
    if (!rulePattern || !targetValue) return false;
    if (rulePattern === '*' || rulePattern === '**') return true;

    const cleanRule = String(rulePattern).trim();
    const cleanTarget = String(targetValue).trim();

    if (cleanRule === cleanTarget) return true;

    if (normalizedAction === 'read_file' || normalizedAction === 'write_file') {
        const normRulePath = safeDecodeURIComponent(cleanRule.replace(/^file:\/\//i, '')).replace(/\/+$/, '');
        const normTargetPath = safeDecodeURIComponent(cleanTarget.replace(/^file:\/\//i, '')).replace(/\/+$/, '');

        if (normRulePath === normTargetPath) return true;
        if (!normRulePath.includes('*') && normTargetPath.startsWith(normRulePath + '/')) {
            return true;
        }
        if (normRulePath.includes('*')) {
            return globToRegExp(normRulePath, '(?:\\/.*)?').test(normTargetPath);
        }
        return false;
    }

    if (normalizedAction === 'command') {
        if (cleanRule.includes('*')) {
            return globToRegExp(cleanRule).test(cleanTarget);
        }
        if (cleanTarget === cleanRule || cleanTarget.startsWith(cleanRule + ' ')) {
            return true;
        }
        return false;
    }

    if (normalizedAction === 'read_url' || normalizedAction === 'execute_url' || normalizedAction === 'download_url') {
        const normRuleUrl = cleanRule.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        const normTargetUrl = cleanTarget.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        if (normTargetUrl === normRuleUrl || normTargetUrl.startsWith(normRuleUrl + '/')) return true;
        if (cleanRule.includes('*')) {
            const wildcardRuleUrl = cleanRule.replace(/^[a-zA-Z*]+:\/\//i, '').replace(/\/+$/, '');
            const ruleSlashIdx = wildcardRuleUrl.indexOf('/');
            const targetBoundaryIdx = normTargetUrl.search(/[/?#]/);
            const ruleHost = ruleSlashIdx === -1 ? wildcardRuleUrl : wildcardRuleUrl.slice(0, ruleSlashIdx);
            const targetHost = targetBoundaryIdx === -1 ? normTargetUrl : normTargetUrl.slice(0, targetBoundaryIdx);

            const ruleSchemeMatch = cleanRule.match(/^([a-zA-Z*]+):\/\//i);
            const targetSchemeMatch = cleanTarget.match(/^([a-zA-Z]+):\/\//i);
            if (ruleSchemeMatch && targetSchemeMatch && !globToRegExp(ruleSchemeMatch[1]).test(targetSchemeMatch[1])) {
                return false;
            }

            if (!globToRegExp(ruleHost).test(targetHost)) return false;
            if (ruleSlashIdx === -1) return true;

            const rulePath = wildcardRuleUrl.slice(ruleSlashIdx + 1);
            if (rulePath === '*' || rulePath === '**') return true;

            const targetSlashIdx = normTargetUrl.indexOf('/');
            if (targetSlashIdx === -1) return false;

            const targetPath = normTargetUrl.slice(targetSlashIdx + 1);
            return globToRegExp(rulePath, '(?:[/?#].*)?').test(targetPath);
        }
        return false;
    }

    if (normalizedAction === 'mcp') {
        const normRuleMcp = cleanRule.replace(/:/g, '/');
        const normTargetMcp = cleanTarget.replace(/:/g, '/');
        if (normRuleMcp === normTargetMcp) return true;
        if (normRuleMcp.includes('*')) {
            return globToRegExp(normRuleMcp).test(normTargetMcp);
        }
        return false;
    }

    if (cleanRule.includes('*')) {
        return globToRegExp(cleanRule).test(cleanTarget);
    }
    return false;
}

export function matchGrantList(grantList, action, target) {
    if (!Array.isArray(grantList) || grantList.length === 0) return null;
    const rawAct = String(action || '').trim();
    const canonAct = shortLabelToCanonicalAction(rawAct);

    for (const ruleStr of grantList) {
        const parsed = parseRuleString(ruleStr);
        if (!parsed) continue;

        const isSameAction =
            parsed.action === canonAct ||
            (rawAct === 'unsandboxed' && parsed.action === 'command') ||
            ((rawAct === 'execute_url' || rawAct === 'download_url' || rawAct === 'read_url' || rawAct === 'url') && parsed.action === 'read_url');

        if (isSameAction && matchGrantPattern(parsed.pattern, target, parsed.action)) {
            return ruleStr;
        }
    }
    return null;
}

function evaluatePermissionStep(projConfig, rawAction, targetValue, isUnsandboxed = false) {
    if (!projConfig || !projConfig.enabled) {
        return { decision: 'skip', reason: 'project override disabled' };
    }

    const normAction = shortLabelToCanonicalAction(rawAction);
    const grants = projConfig.permissionGrants || { allow: [], deny: [], ask: [] };

    // 1. Check DENY rules first (highest priority)
    const matchedDeny = matchGrantList(grants.deny, rawAction, targetValue);
    if (matchedDeny) {
        return { decision: 'deny', reason: `命中项目拒绝规则 ${matchedDeny}` };
    }

    // 2. Check ASK rules second
    const matchedAsk = matchGrantList(grants.ask, rawAction, targetValue);
    if (matchedAsk) {
        return { decision: 'ask', reason: `命中项目询问规则 ${matchedAsk}` };
    }

    // 3. Check ALLOW rules third
    const matchedAllow = matchGrantList(grants.allow, rawAction, targetValue);
    if (matchedAllow) {
        return { decision: 'allow', reason: `命中项目白名单 ${matchedAllow}` };
    }

    // 4. Evaluate Project Execution Permissions & File/Network Policies (No Preset coupling)
    const settings = projConfig.settings || {};

    if (normAction === 'command') {
        if (settings.autoExecutionPolicy === 'CASCADE_COMMANDS_AUTO_EXECUTION_EAGER') {
            return { decision: 'allow', reason: '项目执行权限: Always Proceed (总是自动执行)' };
        }
        if (
            settings.autoExecutionPolicy === 'CASCADE_COMMANDS_AUTO_EXECUTION_PROCEED_IN_SANDBOX' &&
            !isUnsandboxed &&
            rawAction !== 'unsandboxed' &&
            settings.sandboxMode !== false
        ) {
            return { decision: 'allow', reason: '项目执行权限: Proceed in Sandbox (沙盒内自动执行)' };
        }
    }

    if (normAction === 'read_file' || normAction === 'write_file') {
        if (settings.fileAccessPolicy === 'AGENT_SETTING_POLICY_ALLOW') {
            return { decision: 'allow', reason: '项目文件权限: Allow (允许跨工作区读写)' };
        }
        if (settings.fileAccessPolicy === 'AGENT_SETTING_POLICY_DENY') {
            return { decision: 'deny', reason: '项目文件权限: Deny (禁止跨工作区读写)' };
        }
    }

    if (normAction === 'read_url' || rawAction === 'execute_url' || rawAction === 'download_url') {
        if (settings.internetPolicy === 'AGENT_SETTING_POLICY_ALLOW') {
            return { decision: 'allow', reason: '项目网络权限: Allow (允许访问)' };
        }
        if (settings.internetPolicy === 'AGENT_SETTING_POLICY_DENY') {
            return { decision: 'deny', reason: '项目网络权限: Deny (禁止访问)' };
        }
    }

    return { decision: 'skip', reason: 'no matching allow rule' };
}

function extractWaitingStepPermission(waitingStep) {
    const step = waitingStep?.step || waitingStep;
    if (!step) return null;

    const sourceInfo = step.metadata?.sourceTrajectoryStepInfo;
    const interaction = step.requestedInteraction?.interaction;

    if (interaction?.case === 'permission' && interaction.value?.resource) {
        const rawAct = interaction.value.resource.action || '';
        return {
            action: rawAct,
            target: interaction.value.resource.target || '',
            isUnsandboxed: rawAct === 'unsandboxed',
            sourceInfo
        };
    }

    if (interaction?.case === 'filePermission' && interaction.value) {
        return {
            action: 'read_file',
            target: interaction.value.absolutePathUri || '',
            isUnsandboxed: false,
            sourceInfo
        };
    }

    if (step.step?.case === 'runCommand' && step.step.value) {
        return {
            action: 'command',
            target: step.step.value.commandLine || '',
            isUnsandboxed: Boolean(step.step.value.bypassSandbox || step.step.value.unsandboxed),
            sourceInfo
        };
    }

    return null;
}

async function approveWaitingStepRpc(cascadeId, trajectoryId, stepIndex, projConfig, action, target, reason) {
    const ag = getAgRuntime();
    const shortTarget = String(target || '').length > 60 ? String(target).slice(0, 57) + '...' : String(target || '');
    const summaryDesc = `${action}(${shortTarget})`;

    try {
        if (ag?.agentService?.handleCascadeUserInteraction) {
            await ag.agentService.handleCascadeUserInteraction(cascadeId, {
                trajectoryId,
                stepIndex,
                interaction: {
                    case: 'permission',
                    value: {
                        allow: true,
                        scope: 1 // PermissionScope.ONCE
                    }
                }
            });
        } else {
            const { baseUrl, headers } = await getConnectRpcBaseAndHeaders();
            await fetch(`${baseUrl}/exa.language_server_pb.LanguageServerService/HandleCascadeUserInteraction`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    cascadeId,
                    interaction: {
                        trajectoryId,
                        stepIndex,
                        permission: {
                            allow: true,
                            scope: 1
                        }
                    }
                })
            });
        }

        autoApprovedCount++;
        console.log(`🛡️ [Project Permissions] 后台自动放行 [${projConfig.name}] -> ${summaryDesc} (${reason})`);
        showAutoApproveToast(projConfig.name, action, target);
        return true;
    } catch (err) {
        console.warn(`[Project Permissions] 自动放行失败 [${projConfig.name}] -> ${summaryDesc}:`, err);
        return false;
    }
}

async function scanAndAutoApproveWaitingSteps() {
    const ag = getAgRuntime();
    if (!ag || !ag.store) return;

    const state = ag.store.getState();
    const summaries = state?.trajectorySummaries?.summaries;
    if (!summaries || typeof summaries !== 'object') return;

    for (const [cascadeId, summary] of Object.entries(summaries)) {
        if (!summary) continue;

        const waitingSteps = summary.waitingSteps;
        if (!Array.isArray(waitingSteps) || waitingSteps.length === 0) continue;

        const projectId = resolveConversationProjectId(cascadeId, summaries, state);
        if (!projectId) continue;

        const projConfig = projectPermissionsMap.get(projectId);
        if (!projConfig || !projConfig.enabled) continue;

        for (const ws of waitingSteps) {
            const permInfo = extractWaitingStepPermission(ws);
            if (!permInfo || !permInfo.action) continue;

            const targetCascadeId = permInfo.sourceInfo?.cascadeId || cascadeId;
            const trajectoryId = permInfo.sourceInfo?.trajectoryId || summary.trajectoryId || cascadeId;
            const stepIndex = permInfo.sourceInfo?.stepIndex !== undefined ? permInfo.sourceInfo.stepIndex : ws.stepIndex;
            if (stepIndex === undefined || stepIndex === null) continue;

            const stepKey = `${trajectoryId}:${stepIndex}`;
            if (processedSteps.has(stepKey)) continue;

            const evalResult = evaluatePermissionStep(projConfig, permInfo.action, permInfo.target, permInfo.isUnsandboxed);
            if (evalResult.decision === 'allow') {
                processedSteps.add(stepKey);
                approveWaitingStepRpc(
                    targetCascadeId,
                    trajectoryId,
                    stepIndex,
                    projConfig,
                    permInfo.action,
                    permInfo.target,
                    evalResult.reason
                );
            } else if (evalResult.decision === 'deny') {
                processedSteps.add(stepKey);
                console.log(`⛔ [Project Permissions] 命中项目拒绝规则，保持拦截 [${projConfig.name}] -> ${permInfo.action}(${permInfo.target})`);
            }
        }
    }
}

/**
 * Count active/total conversations in Redux belonging to a project
 */
function getProjectConversationStats(projectId) {
    const ag = getAgRuntime();
    const state = ag?.store?.getState?.();
    const summaries = state?.trajectorySummaries?.summaries || {};
    let totalRoot = 0;
    let activeWorking = 0;

    for (const [cascadeId, sum] of Object.entries(summaries)) {
        if (!sum) continue;
        const pid = resolveConversationProjectId(cascadeId, summaries, state);
        if (pid === projectId) {
            if (!sum.trajectoryMetadata?.parentConversationId) {
                totalRoot++;
            }
            if (sum.notFullyIdle || sum.hasRunningSubagents || (sum.waitingSteps && sum.waitingSteps.length > 0)) {
                activeWorking++;
            }
        }
    }
    return { totalRoot, activeWorking };
}

/**
 * Top-Anchored Minimalist 3-Element Hit Toast (Anchored directly below #leviosa-topbar-project-perm-btn)
 */
function showAutoApproveToast(projectName, rawAction, rawTarget) {
    let toast = document.getElementById('leviosa-perm-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'leviosa-perm-toast';
        Object.assign(toast.style, {
            position: 'fixed',
            zIndex: '1000001',
            padding: '6px 11px',
            borderRadius: '9px',
            backgroundColor: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(14px)',
            webkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(16, 185, 129, 0.42)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            color: '#e2e8f0',
            fontSize: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            pointerEvents: 'none',
            transition: 'opacity 0.22s ease, transform 0.22s ease',
            opacity: '0',
            transform: 'translateY(-6px)'
        });
        document.body.appendChild(toast);
    }

    const btn = document.getElementById('leviosa-topbar-project-perm-btn');
    if (btn) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0) {
            toast.style.top = Math.max(8, Math.round(rect.bottom + 6)) + 'px';
            toast.style.left = Math.max(12, Math.min(Math.round(rect.left), Math.max(12, window.innerWidth - 420))) + 'px';
            toast.style.right = 'auto';
            toast.style.bottom = 'auto';
        } else {
            toast.style.top = '40px';
            toast.style.left = '76px';
            toast.style.right = 'auto';
            toast.style.bottom = 'auto';
        }
    } else {
        toast.style.top = '40px';
        toast.style.left = '76px';
        toast.style.right = 'auto';
        toast.style.bottom = 'auto';
    }

    const shortAction = actionToShortLabel(rawAction);
    const displayTarget = formatToastTarget(rawTarget, shortAction);

    toast.innerHTML = `
        <span style="color:#f8fafc;font-weight:600;white-space:nowrap;flex-shrink:0;">🛡️ ${escapeHtml(projectName)}</span>
        <span class="leviosa-perm-action-pill" style="background:rgba(16,185,129,0.22);border:1px solid rgba(16,185,129,0.40);color:#6ee7b7;">${escapeHtml(shortAction)}</span>
        <span style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#cbd5e1;">${escapeHtml(displayTarget)}</span>
    `;

    // Trigger top-down reveal
    requestAnimationFrame(() => {
        if (toast) {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }
    });

    if (toast._hideTimer) clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        if (toast) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-6px)';
        }
    }, 3000);
}

/**
 * Inject Global Styles for Topbar Icon Button, Floating Popover, Project Settings Card, and Prompt Shield Button
 */
function ensureStylesInjected() {
    let style = document.getElementById('leviosa-project-perm-styles');
    if (!style) {
        style = document.createElement('style');
        style.id = 'leviosa-project-perm-styles';
        document.head.appendChild(style);
    }
    const cssText = `
        #leviosa-project-perm-badge {
            display: none !important;
        }
        #leviosa-topbar-project-perm-btn {
            -webkit-app-region: no-drag !important;
            app-region: no-drag !important;
            pointer-events: auto !important;
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            padding: 0;
            margin-right: 2px;
            border-radius: 7px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--topbar-text-color, currentColor) !important;
            cursor: pointer;
            user-select: none;
            flex-shrink: 0;
            outline: none;
            transition: background-color 0.16s ease, border-color 0.16s ease, opacity 0.16s ease;
            opacity: 0.72;
        }
        #leviosa-topbar-project-perm-btn:hover {
            opacity: 1;
            background: rgba(128, 128, 128, 0.16);
            border-color: rgba(128, 128, 128, 0.22);
        }
        #leviosa-topbar-project-perm-btn[data-enabled="true"] {
            opacity: 0.96;
        }
        #leviosa-topbar-project-perm-btn svg {
            width: 15px;
            height: 15px;
            pointer-events: none;
            color: var(--topbar-text-color, currentColor) !important;
        }
        #leviosa-topbar-project-perm-btn .leviosa-topbar-perm-dot {
            position: absolute;
            right: 3px;
            bottom: 3px;
            width: 5.5px;
            height: 5.5px;
            border-radius: 9999px;
            background-color: #10b981 !important;
            box-shadow: 0 0 5px rgba(16, 185, 129, 0.85);
            pointer-events: none;
            display: none;
        }
        #leviosa-topbar-project-perm-btn[data-enabled="true"] .leviosa-topbar-perm-dot {
            display: block;
        }
        #leviosa-project-perm-popover {
            position: fixed;
            z-index: 999999;
            width: 420px;
            max-width: calc(100vw - 24px);
            max-height: min(560px, calc(100vh - 48px));
            display: flex;
            flex-direction: column;
            border-radius: 14px;
            background: rgba(17, 20, 28, 0.95);
            backdrop-filter: blur(20px) saturate(160%);
            -webkit-backdrop-filter: blur(20px) saturate(160%);
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
            color: #e2e8f0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            overflow: hidden;
        }
        .leviosa-perm-scroll {
            overflow-y: auto;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 11px;
        }
        .leviosa-perm-section-box {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px 11px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.028);
            border: 1px solid rgba(255, 255, 255, 0.075);
        }
        .leviosa-perm-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 12px;
        }
        .leviosa-perm-select, .leviosa-perm-input {
            background: rgba(15, 17, 23, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 7px;
            color: #f1f5f9;
            font-size: 11.5px;
            padding: 4px 8px;
            outline: none;
            user-select: text !important;
            -webkit-user-select: text !important;
            pointer-events: auto;
        }
        .leviosa-perm-select option {
            background: #0f172a;
            color: #f1f5f9;
        }
        .leviosa-perm-select:focus, .leviosa-perm-input:focus {
            border-color: rgba(59, 130, 246, 0.7);
        }
        .leviosa-perm-muted-icon-btn {
            width: 20px;
            height: 20px;
            padding: 0;
            border-radius: 5px;
            background: transparent;
            border: 1px solid rgba(148, 163, 184, 0.16);
            color: #64748b;
            opacity: 0.72;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
            transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
        }
        .leviosa-perm-muted-icon-btn:hover {
            opacity: 1;
            color: #cbd5e1;
            background: rgba(148, 163, 184, 0.12);
            border-color: rgba(148, 163, 184, 0.28);
        }
        .leviosa-perm-muted-icon-btn svg {
            width: 12px;
            height: 12px;
            pointer-events: none;
        }
        [data-status-msg]:empty {
            display: none !important;
        }
        .leviosa-perm-action-pill {
            box-sizing: border-box !important;
            width: 72px !important;
            min-width: 72px !important;
            max-width: 72px !important;
            height: 20px !important;
            padding: 0 !important;
            border-radius: 999px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
            font-size: 10.5px !important;
            font-weight: 600 !important;
            line-height: 1 !important;
            flex-shrink: 0 !important;
            white-space: nowrap !important;
            text-align: center !important;
        }
        .leviosa-perm-grant-chip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            padding: 4px 8px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 11px;
            transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .leviosa-perm-grant-chip:hover {
            background: rgba(255, 255, 255, 0.07);
            border-color: rgba(255, 255, 255, 0.15);
        }
        .leviosa-perm-grant-rule-text {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #e2e8f0;
            cursor: text;
            padding: 1px 3px;
            border-radius: 4px;
            flex: 1;
            min-width: 0;
        }
        .leviosa-perm-grant-rule-text:hover {
            background: rgba(255, 255, 255, 0.06);
            color: #ffffff;
        }
        .leviosa-perm-icon-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            cursor: pointer;
            font-size: 12px;
            padding: 2px 4px;
            border-radius: 4px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, background-color 0.15s ease;
        }
        .leviosa-perm-icon-btn:hover {
            color: #f8fafc;
            background: rgba(255, 255, 255, 0.1);
        }
        .leviosa-perm-toggle {
            position: relative;
            display: inline-flex;
            width: 36px;
            height: 20px;
            border-radius: 9999px;
            cursor: pointer;
            transition: background-color 0.2s ease;
            border: none;
            padding: 2px;
            background: rgba(100, 116, 139, 0.45);
        }
        .leviosa-perm-toggle[data-checked="true"] {
            background: #10b981;
        }
        .leviosa-perm-toggle-knob {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #ffffff;
            transition: transform 0.2s ease;
            transform: translateX(0);
        }
        .leviosa-perm-toggle[data-checked="true"] .leviosa-perm-toggle-knob {
            transform: translateX(16px);
        }
        [data-testid="ask-question-option-text"][data-leviosa-short-label] {
            font-size: 0 !important;
            line-height: 0 !important;
            min-width: 0 !important;
            overflow: hidden !important;
        }
        [data-testid="ask-question-option-text"][data-leviosa-short-label]::after {
            content: attr(data-leviosa-short-label);
            font-size: var(--leviosa-opt-fs, 13px) !important;
            line-height: var(--leviosa-opt-lh, 20px) !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            display: block !important;
        }
        .leviosa-conv-perm-row {
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            align-items: stretch !important;
            gap: 6px !important;
            width: 100% !important;
            box-sizing: border-box !important;
            overflow: hidden !important;
        }
        .leviosa-conv-label-full {
            flex: 1 1 0% !important;
            min-width: 0 !important;
            width: auto !important;
            max-width: 100% !important;
            transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .leviosa-conv-label-collapsed {
            flex: 0 0 32px !important;
            width: 32px !important;
            max-width: 32px !important;
            min-width: 32px !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
            gap: 0 !important;
            overflow: hidden !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            cursor: pointer !important;
            transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        label.leviosa-conv-label-collapsed [data-testid="ask-question-option-text"],
        label.leviosa-conv-label-collapsed [data-testid="ask-question-option-text"][data-leviosa-short-label] {
            display: none !important;
        }
        .leviosa-conv-to-project-perm-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            min-width: 28px;
            flex: 0 0 28px;
            align-self: stretch;
            min-height: 28px;
            padding: 0;
            border-radius: 8px;
            border: 1px solid rgba(148, 163, 184, 0.22);
            background: rgba(148, 163, 184, 0.08);
            color: #94a3b8;
            cursor: pointer;
            outline: none;
            box-sizing: border-box;
            transition: all 0.24s cubic-bezier(0.4, 0, 0.2, 1);
            user-select: none;
        }
        .leviosa-conv-to-project-perm-btn:hover {
            background: rgba(148, 163, 184, 0.18);
            border-color: rgba(148, 163, 184, 0.40);
            color: #e2e8f0;
        }
        .leviosa-conv-to-project-perm-btn:active {
            transform: scale(0.97);
        }
        .leviosa-conv-to-project-perm-btn svg {
            width: 14px;
            height: 14px;
            pointer-events: none;
            flex-shrink: 0;
        }
        .leviosa-conv-to-project-perm-btn[data-active="true"] {
            flex: 1 1 0% !important;
            width: 100% !important;
            min-width: 0 !important;
            align-self: stretch !important;
            min-height: 28px !important;
            justify-content: space-between !important;
            padding: 0 10px !important;
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(217, 119, 6, 0.26) 100%) !important;
            border-color: rgba(245, 158, 11, 0.60) !important;
            color: #fbbf24 !important;
            box-shadow: 0 0 10px rgba(245, 158, 11, 0.22) !important;
            font-size: 12px;
            font-weight: 500;
        }
        .leviosa-conv-to-project-perm-btn[data-active="true"]:hover {
            background: linear-gradient(135deg, rgba(245, 158, 11, 0.26) 0%, rgba(217, 119, 6, 0.36) 100%) !important;
            border-color: rgba(245, 158, 11, 0.80) !important;
            color: #fef08a !important;
        }
        .leviosa-conv-to-project-perm-btn [data-action="deactivate-shield"] {
            border-radius: 4px;
            padding: 1px 4px !important;
            transition: all 0.15s ease;
        }
        .leviosa-conv-to-project-perm-btn [data-action="deactivate-shield"]:hover {
            background: rgba(245, 158, 11, 0.35);
            color: #ffffff !important;
            opacity: 1 !important;
        }
    `;
    if (style.textContent !== cssText) {
        style.textContent = cssText;
    }
}

/**
 * Locate the exact Topbar Project Name element / left cluster so we can place the icon button immediately to its left
 */
function findTopbarProjectNameAnchor() {
    // 1. Check new-chat project selector trigger if visible in topbar
    const projTrigger = document.querySelector('[data-testid="project-selector-trigger"]');
    if (projTrigger && projTrigger.parentElement && projTrigger.getBoundingClientRect().width > 0) {
        return {
            container: projTrigger.parentElement,
            beforeNode: projTrigger
        };
    }

    // 2. Check topbar breadcrumb segments (first segment is the Project Name)
    const firstBreadcrumb = document.querySelector('span[data-testid="breadcrumb-segment"]');
    if (firstBreadcrumb) {
        const leftCluster = firstBreadcrumb.closest('.agy-layout-vars') || firstBreadcrumb.parentElement;
        if (leftCluster) {
            let directChild = firstBreadcrumb;
            while (directChild && directChild.parentElement && directChild.parentElement !== leftCluster) {
                directChild = directChild.parentElement;
            }
            if (directChild && directChild.parentElement === leftCluster) {
                return {
                    container: leftCluster,
                    beforeNode: directChild
                };
            }
        }
        if (firstBreadcrumb.parentElement) {
            return {
                container: firstBreadcrumb.parentElement,
                beforeNode: firstBreadcrumb
            };
        }
    }

    // 3. Fallback: topbar left cluster when on a blank New Chat tab
    const titlebar = document.querySelector('[class*="@container/titlebar"]') ||
        document.querySelector('div.select-none.justify-between[style*="app-region: drag"]');
    if (titlebar) {
        const leftCluster = titlebar.querySelector('.agy-layout-vars.flex.items-center');
        if (leftCluster) {
            return {
                container: leftCluster,
                beforeNode: leftCluster.firstElementChild || null
            };
        }
    }

    return null;
}

/**
 * Entry Point 1: Inject Pure Icon Button in Topbar (Immediately Left of Project Name)
 */
function maintainTopbarPermissionButton() {
    ensureStylesInjected();

    // Ensure any obsolete chat footer badge is removed
    const legacyFooterBadge = document.getElementById('leviosa-project-perm-badge');
    if (legacyFooterBadge) {
        legacyFooterBadge.remove();
    }

    const anchor = findTopbarProjectNameAnchor();
    if (!anchor || !anchor.container) return;

    const projConfig = resolveCurrentUiProject();
    let btn = document.getElementById('leviosa-topbar-project-perm-btn');

    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'leviosa-topbar-project-perm-btn';
        btn.type = 'button';
        btn.setAttribute('data-testid', 'leviosa-topbar-project-perm-btn');
        btn.setAttribute('data-no-drag', '');
        btn.style.webkitAppRegion = 'no-drag';
        btn.style.appRegion = 'no-drag';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePermissionPopover(btn);
        });
    }

    // Ensure button is positioned immediately before the Project Name element
    if (anchor.beforeNode && anchor.beforeNode !== btn) {
        if (btn.parentElement !== anchor.container || btn.nextElementSibling !== anchor.beforeNode) {
            anchor.container.insertBefore(btn, anchor.beforeNode);
        }
    } else if (btn.parentElement !== anchor.container) {
        anchor.container.appendChild(btn);
    }

    updateTopbarButtonDisplay(btn, projConfig);
}

function updateTopbarButtonDisplay(btnEl, projConfig) {
    if (!btnEl) return;

    const shieldCheckSvg = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <path d="m9 12 2 2 4-4"></path>
        </svg>
        <span class="leviosa-topbar-perm-dot"></span>
    `;

    const shieldOutlineSvg = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <path d="M12 8v4"></path>
            <path d="M12 16h.01"></path>
        </svg>
        <span class="leviosa-topbar-perm-dot"></span>
    `;

    if (!projConfig) {
        if (btnEl.getAttribute('data-render-sig') === 'none') return;
        btnEl.setAttribute('data-render-sig', 'none');
        btnEl.setAttribute('data-enabled', 'false');
        btnEl.title = '项目权限 (未启用独立覆盖)\n点击配置当前项目独立文件与执行权限';
        btnEl.setAttribute('aria-label', 'Project Permissions');
        btnEl.innerHTML = shieldOutlineSvg;
        return;
    }

    const enabled = Boolean(projConfig.enabled);
    const grantsCount = (projConfig.permissionGrants?.allow?.length || 0) + (projConfig.permissionGrants?.deny?.length || 0);
    const execDef = getAutoExecDef(projConfig.settings?.autoExecutionPolicy);
    const fileDef = getFilePolicyDef(projConfig.settings?.fileAccessPolicy);
    const sig = `${projConfig.id}:${enabled}:${execDef.value}:${fileDef.value}:${grantsCount}`;

    if (btnEl.getAttribute('data-render-sig') === sig) return;
    btnEl.setAttribute('data-render-sig', sig);
    btnEl.setAttribute('data-enabled', enabled ? 'true' : 'false');
    btnEl.setAttribute('aria-label', `Project Permissions (${projConfig.name})`);

    if (enabled) {
        btnEl.title = `项目权限已启用: ${projConfig.name} (${grantsCount} 条规则)\n执行权限: ${execDef.shortLabel} | 文件权限: ${fileDef.shortLabel}\n点击配置项目文件与执行权限`;
        btnEl.innerHTML = shieldCheckSvg;
    } else {
        btnEl.title = `项目权限 (未启用独立覆盖): ${projConfig.name}${grantsCount > 0 ? ` (已存 ${grantsCount} 条规则)` : ''}\n点击开启当前项目独立文件与执行权限`;
        btnEl.innerHTML = shieldOutlineSvg;
    }
}

/**
 * Build interactive inner HTML and bind events for either Floating Popover or Project Settings Card
 */
function renderPermissionConfigControls(containerEl, projConfig, isEmbeddedCard = false) {
    if (!containerEl) return;
    if (!projConfig) {
        containerEl.innerHTML = `
            <div style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">
                未检测到活动项目，请先进入一个项目会话或选择项目。
            </div>
        `;
        return;
    }

    const enabled = Boolean(projConfig.enabled);
    const settings = projConfig.settings || {};
    const grants = projConfig.permissionGrants || { allow: [], deny: [], ask: [] };
    const allowList = Array.isArray(grants.allow) ? grants.allow : [];
    const denyList = Array.isArray(grants.deny) ? grants.deny : [];
    const askList = Array.isArray(grants.ask) ? grants.ask : [];
    const rejectedMergeDirs = normalizeRejectedMergeDirsList(projConfig.rejectedMergeDirs);

    const allRules = [
        ...allowList.map(r => ({ mode: 'allow', rule: r })),
        ...denyList.map(r => ({ mode: 'deny', rule: r })),
        ...askList.map(r => ({ mode: 'ask', rule: r }))
    ];

    const defaultCat = GRANT_CATEGORIES[0];

    containerEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:${isEmbeddedCard ? '12px 16px' : '10px 14px'};border-bottom:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);">
            <div style="display:flex;align-items:center;gap:7px;">
                <span style="font-size:14px;">🛡️</span>
                <span style="font-size:13px;font-weight:600;color:#f8fafc;" title="${escapeHtml(projConfig.name)}">项目权限</span>
                <span style="font-size:10.5px;font-weight:500;padding:1.5px 7px;border-radius:999px;background:${enabled ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.15)'};color:${enabled ? '#6ee7b7' : '#94a3b8'};">
                    ${enabled ? '已启用' : '未启用'}
                </span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                <button type="button" class="leviosa-perm-toggle" data-action="toggle-enabled" data-checked="${enabled ? 'true' : 'false'}" aria-label="Toggle project permission override">
                    <span class="leviosa-perm-toggle-knob"></span>
                </button>
                ${!isEmbeddedCard ? `<button type="button" data-action="close-popover" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:15px;padding:2px 4px;" title="关闭">✕</button>` : ''}
            </div>
        </div>

        <div class="leviosa-perm-scroll" style="opacity:${enabled ? '1' : '0.8'};">
            ${isEmbeddedCard ? `
            <!-- Section 1: Execution Permissions (仅设置面板展示，快捷面板由对话底栏预设接管) -->
            <div class="leviosa-perm-section-box">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-size:11.5px;font-weight:600;color:#e2e8f0;">⚡ 执行权限 (Execution Permissions)</span>
                    <span style="font-size:10.5px;color:#64748b;">终端命令与沙盒</span>
                </div>

                <div class="leviosa-perm-row">
                    <span style="color:#94a3b8;">终端命令自动执行 (Terminal Auto-Execution)</span>
                    <select class="leviosa-perm-select" data-field="autoExecutionPolicy">
                        ${AUTO_EXEC_OPTIONS.map(o => `<option value="${o.value}" ${settings.autoExecutionPolicy === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
                    </select>
                </div>

                <div class="leviosa-perm-row">
                    <span style="color:#94a3b8;">启用终端沙盒隔离 (Terminal Sandbox)</span>
                    <input type="checkbox" data-field="sandboxMode" ${settings.sandboxMode !== false ? 'checked' : ''} style="cursor:pointer;accent-color:#10b981;width:14px;height:14px;" />
                </div>
            </div>
            ` : ''}

            <!-- Section 2: File & Network Permissions (文件与网络权限) -->
            <div class="leviosa-perm-section-box">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-size:11.5px;font-weight:600;color:#e2e8f0;">📂 文件与网络权限 (File &amp; Network Access)</span>
                    <span style="font-size:10.5px;color:#64748b;">跨工作区读写与外部 URL</span>
                </div>

                <div class="leviosa-perm-row">
                    <span style="color:#94a3b8;">跨目录文件读写 (Non-Workspace File Access)</span>
                    <select class="leviosa-perm-select" data-field="fileAccessPolicy">
                        ${FILE_POLICY_OPTIONS.map(o => `<option value="${o.value}" ${settings.fileAccessPolicy === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
                    </select>
                </div>

                <div class="leviosa-perm-row">
                    <span style="color:#94a3b8;">外部网络请求策略 (Internet Access)</span>
                    <select class="leviosa-perm-select" data-field="internetPolicy">
                        ${INTERNET_POLICY_OPTIONS.map(o => `<option value="${o.value}" ${settings.internetPolicy === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
                    </select>
                </div>
            </div>

            <!-- Section 3: Project-Level Permission Grants (项目专属权限规则) -->
            <div class="leviosa-perm-section-box">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:11.5px;font-weight:600;color:#e2e8f0;white-space:nowrap;">🔐 项目权限</span>
                        <span style="font-size:10.5px;color:#64748b;white-space:nowrap;">共${allRules.length}条</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                        ${rejectedMergeDirs.length > 0 ? `
                        <button type="button" class="leviosa-perm-muted-icon-btn" data-action="manage-rejected-merges" title="已屏蔽 ${rejectedMergeDirs.length} 个合并父目录（点击查看或恢复）" aria-label="查看或恢复已屏蔽父目录">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="9"></circle>
                                <line x1="5.7" y1="5.7" x2="18.3" y2="18.3"></line>
                            </svg>
                        </button>
                        ` : ''}
                        <button type="button" class="leviosa-perm-muted-icon-btn" data-action="detect-merge-grants" title="合并同类型规则的公共父路径" aria-label="合并路径">
                            <span style="font-size:12px;line-height:1;pointer-events:none;">🪄</span>
                        </button>
                    </div>
                </div>

                <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
                    <select class="leviosa-perm-select" data-grant-mode style="width:46px;padding:4px 5px;font-weight:700;text-align:center;${getModePillCss('allow')}" title="允许(✓) / 拒绝(×)">
                        <option value="allow">✓</option>
                        <option value="deny">×</option>
                    </select>
                    <select class="leviosa-perm-select" data-grant-cat style="width:86px;padding:4px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">
                        ${GRANT_CATEGORIES.map(c => `<option value="${c.value}">${escapeHtml(c.label)}</option>`).join('')}
                    </select>
                    <input type="text" class="leviosa-perm-input" data-grant-input="pattern" placeholder="${escapeHtml(defaultCat.placeholder)}" style="flex:1;min-width:110px;" />
                    <button type="button" data-action="add-grant" style="padding:4px 10px;border-radius:7px;background:#2563eb;color:#fff;border:none;font-size:11.5px;font-weight:500;cursor:pointer;white-space:nowrap;">
                        + 添加
                    </button>
                </div>

                <!-- Inline Secondary Confirmation / Rejected Merge Dirs Box -->
                <div data-merge-preview-box style="display:none;flex-direction:column;gap:7px;padding:9px 10px;border-radius:8px;background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.28);"></div>

                <div style="display:flex;flex-direction:column;gap:4px;max-height:${isEmbeddedCard ? '260px' : '185px'};overflow-y:auto;">
                    ${allRules.length === 0 ? `
                        <div style="padding:8px;text-align:center;color:#64748b;font-size:11px;">
                            暂无项目专属权限规则（可在上方选择类型并输入路径或命令添加）
                        </div>
                    ` : allRules.map((item, idx) => {
                        const unwrapped = unwrapGrantRule(item.rule);
                        const pillCss = getModePillCss(item.mode);
                        const sym = getModeSymbol(item.mode);
                        return `
                        <div class="leviosa-perm-grant-chip" data-grant-chip-idx="${idx}" data-rule="${escapeHtml(item.rule)}" data-mode="${escapeHtml(item.mode)}">
                            <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
                                <button type="button" class="leviosa-perm-action-pill" data-action="toggle-grant-mode" data-idx="${idx}" title="点击切换允许(✓) / 拒绝(×)" style="cursor:pointer;${pillCss}">
                                    ${sym} ${escapeHtml(unwrapped.shortAction)}
                                </button>
                                <span class="leviosa-perm-grant-rule-text" data-action="edit-grant" data-idx="${idx}" title="点击直接编辑路径: ${escapeHtml(unwrapped.bareTarget)}">${escapeHtml(unwrapped.bareTarget)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
                                <button type="button" class="leviosa-perm-icon-btn" data-action="edit-grant" data-idx="${idx}" title="编辑此规则">✎</button>
                                <button type="button" class="leviosa-perm-icon-btn" data-action="remove-grant" data-idx="${idx}" style="font-size:14px;" title="移除此规则">×</button>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Transient Status Msg (hidden when empty) -->
            <div data-status-msg style="font-size:10.5px;color:#10b981;text-align:right;line-height:1.3;"></div>
        </div>
    `;

    bindPermissionControlEvents(containerEl, projConfig, isEmbeddedCard, allRules);
}

function bindPermissionControlEvents(containerEl, projConfig, isEmbeddedCard, allRules = []) {
    const flashStatus = (text) => {
        const liveStatusSpan = containerEl.querySelector('[data-status-msg]');
        if (liveStatusSpan) {
            liveStatusSpan.textContent = text;
            if (liveStatusSpan._clearTimer) clearTimeout(liveStatusSpan._clearTimer);
            liveStatusSpan._clearTimer = setTimeout(() => {
                if (liveStatusSpan.isConnected) liveStatusSpan.textContent = '';
            }, 2600);
        }
    };

    const persistAndRefresh = async (nextPayload, customSuccessMsg = '') => {
        flashStatus('正在保存...');
        const res = await saveProjectToWorker({
            projectId: projConfig.id,
            projectName: projConfig.name,
            ...nextPayload
        });
        if (res && res.success && res.project && res.project.id === projConfig.id) {
            const updated = res.project;
            await syncProjectToNativePmService(updated);
            scanAndAutoApproveWaitingSteps();
            maintainPermissionPromptButtons();

            const topbarBtn = document.getElementById('leviosa-topbar-project-perm-btn');
            if (topbarBtn) updateTopbarButtonDisplay(topbarBtn, resolveCurrentUiProject());

            renderPermissionConfigControls(containerEl, updated, isEmbeddedCard);
            if (customSuccessMsg) {
                const refreshedStatus = containerEl.querySelector('[data-status-msg]');
                if (refreshedStatus) {
                    refreshedStatus.textContent = customSuccessMsg;
                    refreshedStatus._clearTimer = setTimeout(() => {
                        if (refreshedStatus.isConnected) refreshedStatus.textContent = '';
                    }, 3000);
                }
            }

            if (isEmbeddedCard && popoverEl && isPopoverOpen) {
                renderPermissionConfigControls(popoverEl, updated, false);
            } else if (!isEmbeddedCard) {
                const settingsCard = document.getElementById('leviosa-project-settings-perm-card');
                if (settingsCard && settingsCard.getAttribute('data-rendered-project-id') === updated.id) {
                    settingsCard.setAttribute('data-rendered-sig', JSON.stringify({
                        id: updated.id,
                        enabled: Boolean(updated.enabled),
                        settings: updated.settings || {},
                        grants: updated.permissionGrants || {},
                        rejectedMergeDirs: updated.rejectedMergeDirs || []
                    }));
                    renderPermissionConfigControls(settingsCard, updated, true);
                }
            }
            return updated;
        } else {
            const errMsg = res?.error || '保存失败';
            console.warn('[Project Permissions] Save rejected or mismatched project:', res);
            flashStatus(`保存失败: ${errMsg}`);
            return null;
        }
    };

    // Close button
    const closeBtn = containerEl.querySelector('[data-action="close-popover"]');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hidePermissionPopover();
        });
    }

    // Toggle enabled switch
    const toggleBtn = containerEl.querySelector('[data-action="toggle-enabled"]');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const nextEnabled = !projConfig.enabled;
            await persistAndRefresh({
                enabled: nextEnabled,
                settings: projConfig.settings,
                permissionGrants: projConfig.permissionGrants
            });
        });
    }

    // Granular policy selects (Execution + File/Network)
    containerEl.querySelectorAll('select[data-field]').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            e.stopPropagation();
            const field = sel.getAttribute('data-field');
            const nextSettings = {
                ...projConfig.settings,
                [field]: sel.value
            };
            await persistAndRefresh({
                enabled: true,
                settings: nextSettings,
                permissionGrants: projConfig.permissionGrants
            });
        });
    });

    // Sandbox checkbox
    const sandboxChk = containerEl.querySelector('input[data-field="sandboxMode"]');
    if (sandboxChk) {
        sandboxChk.addEventListener('change', async (e) => {
            e.stopPropagation();
            const nextSettings = {
                ...projConfig.settings,
                sandboxMode: Boolean(sandboxChk.checked)
            };
            await persistAndRefresh({
                enabled: true,
                settings: nextSettings,
                permissionGrants: projConfig.permissionGrants
            });
        });
    }

    // Add Grant Rule Bar
    const addGrantBtn = containerEl.querySelector('[data-action="add-grant"]');
    const patternInput = containerEl.querySelector('[data-grant-input="pattern"]');
    const categorySelect = containerEl.querySelector('select[data-grant-cat]');
    const modeSelect = containerEl.querySelector('select[data-grant-mode]');

    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            applySelectModePillStyle(modeSelect, modeSelect.value);
        });
    }

    if (categorySelect && patternInput) {
        categorySelect.addEventListener('change', () => {
            const cat = GRANT_CATEGORIES.find(c => c.value === categorySelect.value);
            if (cat && cat.placeholder) {
                patternInput.placeholder = cat.placeholder;
            }
        });
    }

    const rulesToGrantsPayload = (rulesArr) => {
        const allow = [];
        const deny = [];
        const ask = [];
        for (const r of rulesArr) {
            const cleanRule = (r.rule || '').trim();
            if (!cleanRule) continue;
            if (r.mode === 'deny') {
                if (!deny.includes(cleanRule)) deny.push(cleanRule);
            } else if (r.mode === 'ask') {
                if (!ask.includes(cleanRule)) ask.push(cleanRule);
            } else {
                if (!allow.includes(cleanRule)) allow.push(cleanRule);
            }
        }
        return { allow, deny, ask };
    };

    const handleAddGrant = async () => {
        const rawPattern = (patternInput?.value || '').trim();
        if (!rawPattern) return;
        const category = categorySelect?.value || 'read_file';
        const mode = modeSelect?.value || 'allow';
        const formattedRule = buildNormalizedRuleFromInput(rawPattern, category, true);
        if (!formattedRule) return;

        const filtered = allRules.filter(r => r.rule !== formattedRule);
        filtered.push({ mode, rule: formattedRule });

        await persistAndRefresh({
            enabled: true,
            settings: projConfig.settings,
            permissionGrants: rulesToGrantsPayload(filtered)
        });
    };

    if (addGrantBtn) {
        addGrantBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleAddGrant();
        });
    }
    if (patternInput) {
        patternInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddGrant();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                patternInput.blur();
            }
        });
        patternInput.addEventListener('keyup', (e) => e.stopPropagation());
    }

    // Detect & Confirm Parent-Path Merge + Manage Rejected Merge Dirs
    const detectMergeBtn = containerEl.querySelector('[data-action="detect-merge-grants"]');
    const manageRejectedBtn = containerEl.querySelector('[data-action="manage-rejected-merges"]');
    const mergePreviewBox = containerEl.querySelector('[data-merge-preview-box]');

    const closeMergePreview = () => {
        if (!mergePreviewBox) return;
        mergePreviewBox.removeAttribute('data-merge-preview-open');
        mergePreviewBox.removeAttribute('data-preview-mode');
        mergePreviewBox.style.display = 'none';
        mergePreviewBox.innerHTML = '';
    };

    const renderRejectedMergeDirsPanel = (targetProj) => {
        const box = containerEl.querySelector('[data-merge-preview-box]');
        if (!box) return;
        const rejectedList = normalizeRejectedMergeDirsList(targetProj?.rejectedMergeDirs);
        if (rejectedList.length === 0) {
            box.removeAttribute('data-merge-preview-open');
            box.removeAttribute('data-preview-mode');
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.setAttribute('data-merge-preview-open', 'true');
        box.setAttribute('data-preview-mode', 'rejected');
        box.style.background = 'rgba(148, 163, 184, 0.06)';
        box.style.border = '1px solid rgba(148, 163, 184, 0.20)';
        box.style.display = 'flex';
        box.innerHTML = `
            <div style="font-size:11.5px;font-weight:600;color:#cbd5e1;">
                已拒绝合并的父目录（${rejectedList.length}）：
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;max-height:160px;overflow-y:auto;">
                ${rejectedList.map((dirPath, rIdx) => `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;border-radius:6px;background:rgba(15,23,42,0.68);border:1px solid rgba(255,255,255,0.08);">
                        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;" title="${escapeHtml(dirPath)}">${escapeHtml(dirPath)}</span>
                        <button type="button" data-action="restore-rejected-dir" data-rejected-idx="${rIdx}" style="padding:2px 8px;border-radius:5px;background:rgba(16,185,129,0.16);border:1px solid rgba(16,185,129,0.34);color:#6ee7b7;font-size:10.5px;font-weight:500;cursor:pointer;flex-shrink:0;white-space:nowrap;">恢复</button>
                    </div>
                `).join('')}
            </div>
            <div style="display:flex;align-items:center;justify-content:flex-end;padding-top:2px;">
                <button type="button" data-action="close-rejected-merges" style="padding:3px 10px;border-radius:6px;background:rgba(148,163,184,0.14);border:1px solid rgba(148,163,184,0.28);color:#cbd5e1;font-size:11px;cursor:pointer;">收起</button>
            </div>
        `;

        const closeRejectedBtn = box.querySelector('[data-action="close-rejected-merges"]');
        if (closeRejectedBtn) {
            closeRejectedBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                box.removeAttribute('data-merge-preview-open');
                box.removeAttribute('data-preview-mode');
                box.style.display = 'none';
                box.innerHTML = '';
            });
        }

        box.querySelectorAll('[data-action="restore-rejected-dir"]').forEach(restoreBtn => {
            restoreBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const rIdx = Number(restoreBtn.getAttribute('data-rejected-idx'));
                const dirToRestore = rejectedList[rIdx];
                if (!dirToRestore) return;

                const liveProj = projectPermissionsMap.get(projConfig.id) || targetProj || projConfig;
                const nextRejected = normalizeRejectedMergeDirsList(liveProj.rejectedMergeDirs).filter(d => d !== dirToRestore);
                const updated = await persistAndRefresh(
                    {
                        enabled: liveProj.enabled,
                        settings: liveProj.settings,
                        permissionGrants: liveProj.permissionGrants,
                        rejectedMergeDirs: nextRejected
                    },
                    '✓ 已恢复该父目录的合并检测'
                );
                if (updated && Array.isArray(updated.rejectedMergeDirs) && updated.rejectedMergeDirs.length > 0) {
                    const reopenBtn = containerEl.querySelector('[data-action="manage-rejected-merges"]');
                    if (reopenBtn) reopenBtn.click();
                }
            });
        });
    };

    const renderMergeCandidatesPanel = (targetProj) => {
        const box = containerEl.querySelector('[data-merge-preview-box]');
        if (!box) return false;
        const candidateGroups = detectMergeableGrantGroups(targetProj.permissionGrants, targetProj.rejectedMergeDirs);

        if (!candidateGroups || candidateGroups.length === 0) {
            box.removeAttribute('data-merge-preview-open');
            box.removeAttribute('data-preview-mode');
            box.style.display = 'none';
            box.innerHTML = '';
            return false;
        }

        box.setAttribute('data-merge-preview-open', 'true');
        box.setAttribute('data-preview-mode', 'merge');
        box.style.background = 'rgba(16, 185, 129, 0.07)';
        box.style.border = '1px solid rgba(16, 185, 129, 0.28)';
        box.style.display = 'flex';
        box.innerHTML = `
            <div style="font-size:11.5px;font-weight:600;color:#a7f3d0;">
                🪄 检测到 ${candidateGroups.length} 组可合并父路径：
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:175px;overflow-y:auto;">
                ${candidateGroups.map((group, gIdx) => {
                    const pillCss = getModePillCss(group.mode);
                    const sym = getModeSymbol(group.mode);
                    const bareSources = group.sourceRules.map(sr => unwrapGrantRule(sr).bareTarget);
                    return `
                    <div style="display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:6px;background:rgba(15,23,42,0.68);border:1px solid rgba(255,255,255,0.09);">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                            <label style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;cursor:pointer;">
                                <input type="checkbox" data-merge-check="${gIdx}" checked style="cursor:pointer;accent-color:#10b981;flex-shrink:0;" />
                                <span class="leviosa-perm-action-pill" style="${pillCss}">${sym} ${escapeHtml(group.shortAction)}</span>
                                <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;color:#f8fafc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(group.targetPath)}">${escapeHtml(group.targetPath)}</span>
                            </label>
                            <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
                                <span style="font-size:10px;color:#94a3b8;white-space:nowrap;">(${group.sourceRules.length} -> 1)</span>
                                <button type="button" class="leviosa-perm-muted-icon-btn" data-action="reject-merge-group" data-group-idx="${gIdx}" title="屏蔽此父目录（后续不再提示合并到此层级）" aria-label="屏蔽此父目录">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <circle cx="12" cy="12" r="9"></circle>
                                        <line x1="5.7" y1="5.7" x2="18.3" y2="18.3"></line>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div style="display:flex;flex-direction:column;gap:2px;padding-left:22px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:#94a3b8;">
                            ${bareSources.map(bs => `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(bs)}">↳ ${escapeHtml(bs)}</div>`).join('')}
                        </div>
                    </div>
                    `;
                }).join('')}
            </div>
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:6px;padding-top:2px;">
                <button type="button" data-action="cancel-merge-grants" style="padding:3px 10px;border-radius:6px;background:rgba(148,163,184,0.14);border:1px solid rgba(148,163,184,0.28);color:#cbd5e1;font-size:11px;cursor:pointer;">取消</button>
                <button type="button" data-action="confirm-merge-grants" style="padding:3px 11px;border-radius:6px;background:#10b981;border:none;color:#052e16;font-size:11px;font-weight:600;cursor:pointer;">✓ 确认合并</button>
            </div>
        `;

        // Per-group immediate reject ("🚫 不再合并")
        box.querySelectorAll('[data-action="reject-merge-group"]').forEach(rejBtn => {
            rejBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const gIdx = Number(rejBtn.getAttribute('data-group-idx'));
                const grp = candidateGroups[gIdx];
                if (!grp) return;

                const liveProj = projectPermissionsMap.get(projConfig.id) || targetProj || projConfig;
                const nextRejected = normalizeRejectedMergeDirsList([
                    ...(liveProj.rejectedMergeDirs || []),
                    grp.targetPath
                ]);

                const updated = await persistAndRefresh({
                    enabled: liveProj.enabled,
                    settings: liveProj.settings,
                    permissionGrants: liveProj.permissionGrants,
                    rejectedMergeDirs: nextRejected
                });
                if (!updated) return;

                const remaining = detectMergeableGrantGroups(updated.permissionGrants, updated.rejectedMergeDirs);
                if (remaining.length > 0) {
                    const reopenMergeBtn = containerEl.querySelector('[data-action="detect-merge-grants"]');
                    if (reopenMergeBtn) reopenMergeBtn.click();
                    const refreshedStatus = containerEl.querySelector('[data-status-msg]');
                    if (refreshedStatus) {
                        refreshedStatus.textContent = '✓ 已屏蔽该父目录，已刷新剩余候选';
                        if (refreshedStatus._clearTimer) clearTimeout(refreshedStatus._clearTimer);
                        refreshedStatus._clearTimer = setTimeout(() => {
                            if (refreshedStatus.isConnected) refreshedStatus.textContent = '';
                        }, 2600);
                    }
                } else {
                    const refreshedStatus = containerEl.querySelector('[data-status-msg]');
                    if (refreshedStatus) {
                        refreshedStatus.textContent = '✓ 已屏蔽该父目录，后续不再合并到此层级';
                        if (refreshedStatus._clearTimer) clearTimeout(refreshedStatus._clearTimer);
                        refreshedStatus._clearTimer = setTimeout(() => {
                            if (refreshedStatus.isConnected) refreshedStatus.textContent = '';
                        }, 3000);
                    }
                }
            });
        });

        const cancelMergeBtn = box.querySelector('[data-action="cancel-merge-grants"]');
        const confirmMergeBtn = box.querySelector('[data-action="confirm-merge-grants"]');

        if (cancelMergeBtn) {
            cancelMergeBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                closeMergePreview();
            });
        }

        if (confirmMergeBtn) {
            confirmMergeBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const selectedGroups = [];
                const uncheckedGroups = [];

                box.querySelectorAll('input[type="checkbox"][data-merge-check]').forEach(chk => {
                    const gIdx = Number(chk.getAttribute('data-merge-check'));
                    const grp = candidateGroups[gIdx];
                    if (!grp) return;
                    if (chk.checked) {
                        selectedGroups.push(grp);
                    } else {
                        uncheckedGroups.push(grp);
                    }
                });

                const liveProj = projectPermissionsMap.get(projConfig.id) || targetProj || projConfig;
                const nextRejected = normalizeRejectedMergeDirsList([
                    ...(liveProj.rejectedMergeDirs || []),
                    ...uncheckedGroups.map(g => g.targetPath)
                ]);

                // If user unchecked ALL groups and clicked Confirm, persist rejected dirs and close cleanly
                if (selectedGroups.length === 0) {
                    await persistAndRefresh(
                        {
                            enabled: liveProj.enabled,
                            settings: liveProj.settings,
                            permissionGrants: liveProj.permissionGrants,
                            rejectedMergeDirs: nextRejected
                        },
                        '✓ 已记录拒绝合并的父目录'
                    );
                    return;
                }

                const origGrants = liveProj.permissionGrants || { allow: [], deny: [], ask: [] };
                const rebuildModeList = (modeName) => {
                    const rawArr = Array.isArray(origGrants[modeName]) ? origGrants[modeName] : [];
                    const modeSelected = selectedGroups.filter(g => g.mode === modeName);
                    if (modeSelected.length === 0) return [...rawArr];

                    const ruleToGroup = new Map();
                    for (const grp of modeSelected) {
                        for (const sr of grp.sourceRules) {
                            ruleToGroup.set(sr, grp);
                        }
                    }

                    const emittedGroupIds = new Set();
                    const seenRules = new Set();
                    const out = [];

                    for (const r of rawArr) {
                        const matchedGrp = ruleToGroup.get(r);
                        if (matchedGrp) {
                            if (!emittedGroupIds.has(matchedGrp.id)) {
                                emittedGroupIds.add(matchedGrp.id);
                                if (!seenRules.has(matchedGrp.targetRule)) {
                                    seenRules.add(matchedGrp.targetRule);
                                    out.push(matchedGrp.targetRule);
                                }
                            }
                        } else if (!seenRules.has(r)) {
                            seenRules.add(r);
                            out.push(r);
                        }
                    }
                    return out;
                };

                const nextGrants = {
                    allow: rebuildModeList('allow'),
                    deny: rebuildModeList('deny'),
                    ask: rebuildModeList('ask')
                };

                const beforeCount = (origGrants.allow?.length || 0) + (origGrants.deny?.length || 0) + (origGrants.ask?.length || 0);
                const afterCount = nextGrants.allow.length + nextGrants.deny.length + nextGrants.ask.length;
                const reduced = Math.max(0, beforeCount - afterCount);

                const statusMsg = uncheckedGroups.length > 0
                    ? `✓ 已完成合并，共精简 ${reduced} 条规则（已屏蔽 ${uncheckedGroups.length} 个父目录）`
                    : `✓ 已完成合并，共精简 ${reduced} 条路径规则`;

                await persistAndRefresh(
                    {
                        enabled: liveProj.enabled,
                        settings: liveProj.settings,
                        permissionGrants: nextGrants,
                        rejectedMergeDirs: nextRejected
                    },
                    statusMsg
                );
            });
        }

        return true;
    };

    if (manageRejectedBtn && mergePreviewBox) {
        manageRejectedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (
                mergePreviewBox.getAttribute('data-merge-preview-open') === 'true' &&
                mergePreviewBox.getAttribute('data-preview-mode') === 'rejected'
            ) {
                closeMergePreview();
                return;
            }
            const currentProj = projectPermissionsMap.get(projConfig.id) || projConfig;
            renderRejectedMergeDirsPanel(currentProj);
        });
    }

    if (detectMergeBtn && mergePreviewBox) {
        detectMergeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentProj = projectPermissionsMap.get(projConfig.id) || projConfig;
            const opened = renderMergeCandidatesPanel(currentProj);
            if (!opened) {
                flashStatus('✨ 未检测到可合并的同类型公共父路径');
            }
        });
    }

    // Toggle Grant Mode on Pill Click (allow <-> deny)
    containerEl.querySelectorAll('[data-action="toggle-grant-mode"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-idx'));
            const target = allRules[idx];
            if (!target) return;
            const nextMode = target.mode === 'allow' ? 'deny' : 'allow';
            const updatedRules = allRules.map((item, i) => i === idx ? { ...item, mode: nextMode } : item);
            await persistAndRefresh({
                enabled: projConfig.enabled,
                settings: projConfig.settings,
                permissionGrants: rulesToGrantsPayload(updatedRules)
            });
        });
    });

    // In-Place Edit Grant Rule (Click on bare target text or ✎ icon)
    const openInlineGrantEditor = (idx) => {
        const target = allRules[idx];
        const chipEl = containerEl.querySelector(`[data-grant-chip-idx="${idx}"]`);
        if (!target || !chipEl) return;
        if (chipEl.getAttribute('data-editing') === 'true') return;
        chipEl.setAttribute('data-editing', 'true');

        const unwrapped = unwrapGrantRule(target.rule);
        const actionInitial = (unwrapped.shortAction || 'r').charAt(0).toLowerCase();
        let currentEditMode = target.mode;

        chipEl.innerHTML = `
            <button type="button" data-inline-mode-pill title="类型: ${escapeHtml(unwrapped.shortAction)}（不可更改 · 点击切换允许/拒绝）" style="box-sizing:border-box;width:24px;min-width:24px;max-width:24px;height:20px;padding:0;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;font-weight:700;line-height:1;flex-shrink:0;cursor:pointer;${getModePillCss(currentEditMode)}">${escapeHtml(actionInitial)}</button>
            <input type="text" class="leviosa-perm-input" data-inline-input style="flex:1;min-width:0;padding:3px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;" />
            <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
                <button type="button" class="leviosa-perm-icon-btn" data-inline-save style="color:#10b981;font-weight:700;font-size:13px;" title="保存修改 (Enter)">✓</button>
                <button type="button" class="leviosa-perm-icon-btn" data-inline-cancel style="color:#94a3b8;font-size:12px;" title="取消 (Esc)">✕</button>
            </div>
        `;

        const inlineModePill = chipEl.querySelector('[data-inline-mode-pill]');
        const inlineInput = chipEl.querySelector('input[data-inline-input]');
        const saveBtn = chipEl.querySelector('[data-inline-save]');
        const cancelBtn = chipEl.querySelector('[data-inline-cancel]');

        inlineModePill.addEventListener('click', (e) => {
            e.stopPropagation();
            currentEditMode = currentEditMode === 'allow' ? 'deny' : 'allow';
            applySelectModePillStyle(inlineModePill, currentEditMode);
            inlineInput.focus();
        });

        inlineInput.value = unwrapped.bareTarget;
        inlineInput.focus();
        inlineInput.select();

        const commitInlineEdit = async () => {
            const val = (inlineInput.value || '').trim();
            const newMode = currentEditMode || target.mode;
            const lockedAction = unwrapped.canonicalAction;
            if (!val) {
                renderPermissionConfigControls(containerEl, projConfig, isEmbeddedCard);
                return;
            }

            const formatted = buildNormalizedRuleFromInput(val, lockedAction, false);
            if (!formatted) {
                renderPermissionConfigControls(containerEl, projConfig, isEmbeddedCard);
                return;
            }

            const updatedRules = [];
            allRules.forEach((item, i) => {
                if (i === idx) {
                    updatedRules.push({ mode: newMode, rule: formatted });
                } else if (item.rule !== formatted) {
                    updatedRules.push(item);
                }
            });

            await persistAndRefresh({
                enabled: projConfig.enabled,
                settings: projConfig.settings,
                permissionGrants: rulesToGrantsPayload(updatedRules)
            });
        };

        const cancelInlineEdit = () => {
            renderPermissionConfigControls(containerEl, projConfig, isEmbeddedCard);
        };

        inlineInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                commitInlineEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelInlineEdit();
            }
        });
        inlineInput.addEventListener('keyup', (e) => e.stopPropagation());
        inlineModePill.addEventListener('keydown', (e) => e.stopPropagation());

        saveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            commitInlineEdit();
        });
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelInlineEdit();
        });
    };

    containerEl.querySelectorAll('[data-action="edit-grant"]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = Number(el.getAttribute('data-idx'));
            openInlineGrantEditor(idx);
        });
    });

    // Remove Grant Rule
    containerEl.querySelectorAll('[data-action="remove-grant"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const idx = Number(btn.getAttribute('data-idx'));
            const updatedRules = allRules.filter((_, i) => i !== idx);
            await persistAndRefresh({
                enabled: projConfig.enabled,
                settings: projConfig.settings,
                permissionGrants: rulesToGrantsPayload(updatedRules)
            });
        });
    });
}

/**
 * Singleton Floating Popover on document.body (Anchored below #leviosa-topbar-project-perm-btn)
 */
function ensurePopoverElement() {
    ensureStylesInjected();
    if (popoverEl && document.body.contains(popoverEl)) return popoverEl;

    document.querySelectorAll('#leviosa-project-perm-popover').forEach(el => el.remove());

    popoverEl = document.createElement('div');
    popoverEl.id = 'leviosa-project-perm-popover';
    popoverEl.style.display = 'none';
    popoverEl.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    document.body.appendChild(popoverEl);
    return popoverEl;
}

function positionPopover(anchorEl) {
    if (!popoverEl || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popWidth = Math.min(420, window.innerWidth - 24);
    const popHeight = popoverEl.offsetHeight || 420;

    let left = rect.left;
    if (left + popWidth > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - popWidth - 12);
    }
    if (left < 12) left = 12;

    let top = rect.bottom + 6;
    if (top + popHeight > window.innerHeight - 12 && rect.top > popHeight + 12) {
        top = rect.top - popHeight - 6;
    }

    popoverEl.style.left = `${Math.round(left)}px`;
    popoverEl.style.top = `${Math.round(Math.max(8, top))}px`;
}

async function togglePermissionPopover(anchorEl) {
    ensurePopoverElement();
    if (isPopoverOpen) {
        hidePermissionPopover();
        return;
    }

    activeAnchorEl = anchorEl;
    isPopoverOpen = true;

    if (projectPermissionsMap.size === 0) {
        await loadAllProjectsFromWorker();
    } else {
        loadAllProjectsFromWorker().then(() => {
            if (isPopoverOpen && popoverEl) {
                const isEditingOrBusy = Boolean(
                    popoverEl.querySelector('[data-editing="true"]') ||
                    popoverEl.querySelector('[data-merge-preview-open="true"]') ||
                    (document.activeElement && popoverEl.contains(document.activeElement))
                );
                if (!isEditingOrBusy) {
                    const refreshed = resolveCurrentUiProject();
                    if (refreshed) renderPermissionConfigControls(popoverEl, refreshed, false);
                }
            }
        });
    }

    const projConfig = resolveCurrentUiProject();
    renderPermissionConfigControls(popoverEl, projConfig, false);
    popoverEl.style.display = 'flex';
    positionPopover(anchorEl);
    setTimeout(() => {
        if (isPopoverOpen) positionPopover(anchorEl);
    }, 10);
}

function hidePermissionPopover() {
    isPopoverOpen = false;
    activeAnchorEl = null;
    if (popoverEl) {
        popoverEl.style.display = 'none';
    }
}

/**
 * Locate the Skills section or its parent container in Project Settings
 * so we can inject the Project Permissions card directly above Skills
 */
function findSkillsSectionAnchor() {
    const headings = Array.from(document.querySelectorAll('h3, h2, h4, [class*="font-medium"], [class*="text-sm"]'));
    for (const h of headings) {
        if (h.children.length > 0) continue;
        const text = (h.textContent || '').trim();
        if (text === 'Skills' || text.startsWith('Skills (') || text.startsWith('Skills\n')) {
            const sec = h.closest('.space-y-2, .space-y-6, .border');
            if (sec && sec.parentElement) {
                return { container: sec.parentElement, beforeNode: sec };
            }
        }
    }

    const custView = document.querySelector('[data-testid="workspace-customizations-view"]');
    if (custView) {
        const skillsHeader = Array.from(custView.querySelectorAll('h3, h2, h4, span')).find(
            el => (el.textContent || '').trim() === 'Skills' || (el.textContent || '').trim().startsWith('Skills')
        );
        if (skillsHeader) {
            const sec = skillsHeader.closest('.space-y-2') || skillsHeader.parentElement?.parentElement;
            if (sec && sec.parentElement) {
                return { container: sec.parentElement, beforeNode: sec };
            }
        }
        if (custView.parentElement) {
            return { container: custView.parentElement, beforeNode: custView };
        }
    }

    for (const h of headings) {
        if (h.children.length > 0) continue;
        const text = (h.textContent || '').trim();
        if (text === 'Customizations' || text.startsWith('Customizations (')) {
            const sec = h.closest('.space-y-2, .space-y-6, .border');
            if (sec && sec.parentElement) {
                return { container: sec.parentElement, beforeNode: sec };
            }
        }
    }

    const deleteProjectBtn = document.querySelector('[data-testid="delete-project-button"]');
    if (deleteProjectBtn) {
        let dangerSection = deleteProjectBtn.closest('.space-y-6, .flex-col.gap-8, .flex-col.gap-6');
        if (!dangerSection) {
            let curr = deleteProjectBtn.parentElement;
            for (let i = 0; i < 6 && curr; i++) {
                if (curr.parentElement && curr.parentElement.children.length >= 2) {
                    dangerSection = curr;
                }
                curr = curr.parentElement;
            }
        }
        if (dangerSection && dangerSection.parentElement) {
            return { container: dangerSection.parentElement, beforeNode: dangerSection.parentElement.firstChild };
        }
    }

    return null;
}

/**
 * Entry Point 2: Inject Restored "Project Permissions" Card into Project Settings Page (FBb) - Above Skills
 */
function maintainProjectSettingsCard() {
    ensureStylesInjected();

    const anchor = findSkillsSectionAnchor();
    if (!anchor || !anchor.container) return;

    const projConfig = resolveCurrentUiProject();
    if (!projConfig) return;

    let cardWrapper = document.getElementById('leviosa-project-settings-perm-wrapper');
    if (!cardWrapper) {
        cardWrapper = document.createElement('div');
        cardWrapper.id = 'leviosa-project-settings-perm-wrapper';
        cardWrapper.setAttribute('data-testid', 'leviosa-project-settings-perm-wrapper');
        cardWrapper.style.marginBottom = '20px';

        const header = document.createElement('div');
        header.style.cssText = 'font-size:14px;font-weight:600;color:var(--foreground, #f8fafc);margin-bottom:8px;display:flex;align-items:center;gap:6px;';
        header.innerHTML = `<span>🛡️ Project Permissions (项目文件与执行权限细粒度控制)</span>`;

        const card = document.createElement('div');
        card.id = 'leviosa-project-settings-perm-card';
        card.style.cssText = 'border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(17,20,28,0.65);overflow:hidden;';

        cardWrapper.appendChild(header);
        cardWrapper.appendChild(card);

        if (anchor.beforeNode && anchor.beforeNode !== cardWrapper) {
            anchor.container.insertBefore(cardWrapper, anchor.beforeNode);
        } else {
            anchor.container.appendChild(cardWrapper);
        }

        const sig = JSON.stringify({
            id: projConfig.id,
            enabled: Boolean(projConfig.enabled),
            settings: projConfig.settings || {},
            grants: projConfig.permissionGrants || {},
            rejectedMergeDirs: projConfig.rejectedMergeDirs || []
        });
        card.setAttribute('data-rendered-project-id', projConfig.id);
        card.setAttribute('data-rendered-sig', sig);
        renderPermissionConfigControls(card, projConfig, true);
    } else {
        if (anchor.beforeNode && anchor.beforeNode !== cardWrapper) {
            if (cardWrapper.parentElement !== anchor.container || cardWrapper.nextElementSibling !== anchor.beforeNode) {
                anchor.container.insertBefore(cardWrapper, anchor.beforeNode);
            }
        }
        const card = document.getElementById('leviosa-project-settings-perm-card');
        if (card) {
            const sig = JSON.stringify({
                id: projConfig.id,
                enabled: Boolean(projConfig.enabled),
                settings: projConfig.settings || {},
                grants: projConfig.permissionGrants || {},
                rejectedMergeDirs: projConfig.rejectedMergeDirs || []
            });
            const isEditingOrBusy = Boolean(
                card.querySelector('[data-editing="true"]') ||
                card.querySelector('[data-merge-preview-open="true"]') ||
                (document.activeElement && card.contains(document.activeElement))
            );
            if (card.getAttribute('data-rendered-project-id') !== projConfig.id || (!isEditingOrBusy && card.getAttribute('data-rendered-sig') !== sig)) {
                card.setAttribute('data-rendered-project-id', projConfig.id);
                card.setAttribute('data-rendered-sig', sig);
                renderPermissionConfigControls(card, projConfig, true);
            }
        }
    }
}

/**
 * Entry Point 3: Native Permission Confirmation Prompt `this conversation` Pure Shield Button
 */
function extractPermissionPromptFiberContext(radioGroupEl) {
    if (!radioGroupEl) return null;
    const fiberKey = Object.keys(radioGroupEl).find(k => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;

    let curr = radioGroupEl[fiberKey];
    let j0Props = null;
    let mwcProps = null;
    let cascadeId = '';
    let trajectoryId = '';

    for (let depth = 0; depth < 35 && curr; depth++, curr = curr.return) {
        const mp = curr.memoizedProps;
        if (!mp || typeof mp !== 'object') continue;

        if (!j0Props && (mp.toolName === 'ask_permission' || mp.permissionAction)) {
            j0Props = mp;
        }
        if (!mwcProps && mp.permissionSpec && typeof mp.permissionSpec === 'object') {
            mwcProps = mp;
        }
        if (!cascadeId && typeof mp.cascadeId === 'string' && mp.cascadeId) {
            cascadeId = mp.cascadeId;
        }
        if (!trajectoryId && typeof mp.trajectoryId === 'string' && mp.trajectoryId) {
            trajectoryId = mp.trajectoryId;
        }
    }

    const isAskPermission = Boolean(mwcProps?.permissionSpec?.resource || j0Props?.toolName === 'ask_permission');
    if (!isAskPermission) return null;

    return {
        j0Props,
        mwcProps,
        cascadeId,
        trajectoryId
    };
}

function restoreStyledPromptElement(el, attrName) {
    if (!el || el.getAttribute(attrName) !== 'true') return;
    const origStyle = el.getAttribute('data-leviosa-orig-style') || '';
    if (origStyle) {
        el.setAttribute('style', origStyle);
    } else {
        el.removeAttribute('style');
    }
    el.removeAttribute(attrName);
    el.removeAttribute('data-leviosa-orig-style');
}

function cleanupPromptShieldButtonsInScope(scopeEl) {
    if (!scopeEl) return;
    scopeEl.querySelectorAll('[data-leviosa-orig-text], [data-leviosa-short-label]').forEach(textEl => {
        if (textEl.hasAttribute('data-leviosa-orig-text')) {
            textEl.textContent = textEl.getAttribute('data-leviosa-orig-text');
            textEl.removeAttribute('data-leviosa-orig-text');
        }
        textEl.removeAttribute('data-leviosa-short-label');
        textEl.style.whiteSpace = '';
        textEl.style.overflow = '';
        textEl.style.textOverflow = '';
    });
    scopeEl.querySelectorAll('.leviosa-conv-to-project-perm-btn').forEach(btn => {
        const rowWrapper = btn.parentElement;
        btn.remove();
        if (rowWrapper) {
            const expandBox = rowWrapper.querySelector('.leviosa-prompt-project-expand');
            if (expandBox) expandBox.remove();
            rowWrapper.classList.remove('leviosa-conv-perm-row');
            restoreStyledPromptElement(rowWrapper, 'data-leviosa-row-styled');
            const lbl = rowWrapper.querySelector('label[data-testid="ask-question-option"]');
            if (lbl) {
                lbl.classList.remove('leviosa-conv-label-collapsed', 'leviosa-conv-label-full');
                restoreStyledPromptElement(lbl, 'data-leviosa-label-styled');
            }
        }
    });
}

/**
 * Strip redundant command/file/URL payloads from permission prompt option labels
 * while strictly distinguishing ONCE vs CONVERSATION vs GLOBAL (always allow) scopes.
 */
function simplifyPermissionOptionLabel(origText) {
    const s = String(origText || '').trim();
    if (!s) return { label: s, isConversation: false };

    // 1. Scope: CONVERSATION (always ends with "in this conversation")
    if (/\bin this conversation\s*$/i.test(s)) {
        if (/^yes,\s*save rule\b/i.test(s)) {
            return { label: 'Yes, save rule in this conversation', isConversation: true };
        }
        if (/^yes,\s*allow downloads\b/i.test(s)) {
            return { label: 'Yes, allow downloads in this conversation', isConversation: true };
        }
        return { label: 'Yes, always allow in this conversation', isConversation: true };
    }

    // 2. Scope: ONCE ("Yes, allow this time", "Yes, allow", "Yes, allow this download", "Yes, allow downloads from ... for this run")
    if (/\bfor this run\s*$/i.test(s) || /^yes,\s*allow this download\s*$/i.test(s)) {
        return { label: 'Yes, allow this download', isConversation: false };
    }
    if (/^yes,\s*allow\s*$/i.test(s)) {
        return { label: 'Yes, allow', isConversation: false };
    }
    if (/^yes,\s*allow this time\s*$/i.test(s)) {
        return { label: 'Yes, allow this time', isConversation: false };
    }

    // 3. Scope: GLOBAL ("Yes, and always allow '...'", "Yes, always allow ...", "Yes, save rule ... globally")
    if (/\bglobally\s*$/i.test(s) || /^yes,\s*save rule\b/i.test(s)) {
        return { label: 'Yes, save rule globally', isConversation: false };
    }
    if (/^yes,\s*(?:and\s+)?always allow downloads\b/i.test(s)) {
        return { label: 'Yes, always allow downloads', isConversation: false };
    }
    if (/^yes,\s*(?:and\s+)?always allow\b/i.test(s)) {
        return { label: 'Yes, always allow', isConversation: false };
    }

    return { label: s, isConversation: false };
}

function resolvePromptProjectConfig(cascadeId) {
    const ag = getAgRuntime();
    const state = ag?.store?.getState?.() || null;
    const summaries = state?.trajectorySummaries?.summaries || {};

    let projectId = cascadeId ? resolveConversationProjectId(cascadeId, summaries, state) : null;
    if (!projectId) {
        projectId = resolveCurrentUiProject()?.id || null;
    }
    return projectId ? (projectPermissionsMap.get(projectId) || null) : null;
}

function findPermissionPromptCardRoot(radioGroupEl) {
    let curr = radioGroupEl?.parentElement || null;
    while (curr && curr !== document.body) {
        if (curr.querySelector('[data-testid="interaction-continue-button"]')) {
            return curr;
        }
        curr = curr.parentElement;
    }
    return radioGroupEl?.parentElement || null;
}

function triggerPermissionSubmit(radioGroupEl) {
    const cardRoot = findPermissionPromptCardRoot(radioGroupEl);
    let submitBtn = cardRoot ? cardRoot.querySelector('[data-testid="interaction-continue-button"]') : null;
    if (!submitBtn) {
        let ancestor = radioGroupEl.parentElement;
        while (ancestor && ancestor !== document.body) {
            submitBtn = ancestor.querySelector('[data-testid="interaction-continue-button"]');
            if (!submitBtn) {
                const buttons = Array.from(ancestor.querySelectorAll('button'));
                submitBtn = buttons.find(b => (b.textContent || '').trim().includes('Submit'));
            }
            if (submitBtn) break;
            ancestor = ancestor.parentElement;
        }
    }
    if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        return true;
    }
    return false;
}

function maintainPermissionPromptButtons() {
    ensureStylesInjected();

    const radioGroups = document.querySelectorAll('[role="radiogroup"]');
    if (radioGroups.length === 0) return;

    const shieldPureSvg = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            <path d="m9 12 2 2 4-4"></path>
        </svg>
    `;

    const shieldActiveInnerHtml = `
        <div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;pointer-events:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:14px;height:14px;flex-shrink:0;">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <path d="m9 12 2 2 4-4"></path>
            </svg>
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:12px;">Always in this project</span>
        </div>
        <span data-action="deactivate-shield" style="font-size:13px;opacity:0.8;line-height:1;margin-left:4px;flex-shrink:0;cursor:pointer;" title="收起并取消项目授权（恢复仅当前会话）">✕</span>
    `;

    radioGroups.forEach(radioGroupEl => {
        // 1. Strict Component Type Guard via React Fiber (only permission prompts, never user ask_question)
        const fiberCtx = extractPermissionPromptFiberContext(radioGroupEl);
        if (!fiberCtx) {
            if (radioGroupEl.querySelector('.leviosa-conv-to-project-perm-btn, [data-leviosa-short-label], [data-leviosa-orig-text]')) {
                cleanupPromptShieldButtonsInScope(radioGroupEl);
            }
            return;
        }

        // 2. Simplify verbose option labels via pure CSS ::after (preserves React VDOM textNode intact)
        const optionLabels = radioGroupEl.querySelectorAll('label[data-testid="ask-question-option"]');
        let targetLabel = null;
        let fontVarsSynced = false;

        for (const lbl of optionLabels) {
            if (!fontVarsSynced) {
                const cs = window.getComputedStyle(lbl);
                if (cs.fontSize && cs.fontSize !== '0px') {
                    radioGroupEl.style.setProperty('--leviosa-opt-fs', cs.fontSize);
                    if (cs.lineHeight && cs.lineHeight !== 'normal' && cs.lineHeight !== '0px') {
                        radioGroupEl.style.setProperty('--leviosa-opt-lh', cs.lineHeight);
                    }
                    fontVarsSynced = true;
                }
            }

            const textEl = lbl.querySelector('[data-testid="ask-question-option-text"]');
            if (!textEl) continue;

            // Recover if an earlier build mutated textContent and stored data-leviosa-orig-text
            if (textEl.hasAttribute('data-leviosa-orig-text')) {
                textEl.textContent = textEl.getAttribute('data-leviosa-orig-text');
                textEl.removeAttribute('data-leviosa-orig-text');
            }

            const orig = (textEl.textContent || '').trim();
            const { label: shortLabel, isConversation } = simplifyPermissionOptionLabel(orig);

            if (isConversation) {
                const radioInput = lbl.querySelector('input[type="radio"]');
                if (radioInput && !radioInput.disabled) {
                    targetLabel = lbl;
                }
            }

            if (shortLabel && shortLabel !== orig) {
                if (textEl.getAttribute('data-leviosa-short-label') !== shortLabel) {
                    textEl.setAttribute('data-leviosa-short-label', shortLabel);
                }
            } else if (textEl.hasAttribute('data-leviosa-short-label')) {
                textEl.removeAttribute('data-leviosa-short-label');
            }

            if (lbl.title !== orig) {
                lbl.title = orig;
            }
        }

        // 3. Project Enabled State Guard for the morphing project shield button
        const projConfig = resolvePromptProjectConfig(fiberCtx.cascadeId);
        if (!projConfig || !projConfig.enabled) {
            if (radioGroupEl.querySelector('.leviosa-conv-to-project-perm-btn')) {
                radioGroupEl.querySelectorAll('.leviosa-conv-to-project-perm-btn').forEach(btn => {
                    const rw = btn.parentElement;
                    btn.remove();
                    if (rw) {
                        rw.classList.remove('leviosa-conv-perm-row');
                        restoreStyledPromptElement(rw, 'data-leviosa-row-styled');
                        const l = rw.querySelector('label[data-testid="ask-question-option"]');
                        if (l) l.classList.remove('leviosa-conv-label-collapsed', 'leviosa-conv-label-full');
                    }
                });
            }
            return;
        }

        if (!targetLabel || !targetLabel.parentElement || targetLabel.parentElement === radioGroupEl) {
            if (radioGroupEl.querySelector('.leviosa-conv-to-project-perm-btn')) {
                cleanupPromptShieldButtonsInScope(radioGroupEl);
            }
            return;
        }

        const rowWrapper = targetLabel.parentElement;
        const cardRoot = findPermissionPromptCardRoot(radioGroupEl);

        // Remove any stale buttons attached to other rows in the same radiogroup
        radioGroupEl.querySelectorAll('.leviosa-conv-to-project-perm-btn').forEach(existing => {
            if (existing.parentElement !== rowWrapper) {
                const oldRow = existing.parentElement;
                existing.remove();
                if (oldRow) {
                    oldRow.classList.remove('leviosa-conv-perm-row');
                    const exp = oldRow.querySelector('.leviosa-prompt-project-expand');
                    if (exp) exp.remove();
                    const oldLbl = oldRow.querySelector('[data-leviosa-label-styled="true"]');
                    if (oldLbl) restoreStyledPromptElement(oldLbl, 'data-leviosa-label-styled');
                    restoreStyledPromptElement(oldRow, 'data-leviosa-row-styled');
                }
            }
        });

        // Remove any legacy expand element inside this row
        const legacyExp = rowWrapper.querySelector('.leviosa-prompt-project-expand');
        if (legacyExp) legacyExp.remove();

        // Apply Morphing Row layout to rowWrapper
        if (!rowWrapper.classList.contains('leviosa-conv-perm-row')) {
            rowWrapper.classList.add('leviosa-conv-perm-row');
        }
        if (rowWrapper.getAttribute('data-leviosa-row-styled') !== 'true') {
            rowWrapper.setAttribute('data-leviosa-orig-style', rowWrapper.getAttribute('style') || '');
            rowWrapper.setAttribute('data-leviosa-row-styled', 'true');
        }

        // Helper to compute currently active target rule
        const computeCurrentPromptRule = () => {
            const liveCtx = extractPermissionPromptFiberContext(radioGroupEl);
            const spec = liveCtx?.mwcProps?.permissionSpec || {};
            const j0Props = liveCtx?.j0Props || {};
            const rawAction = spec.resource?.action || j0Props.permissionAction || 'read_file';
            const rawTarget = String(spec.resource?.target || '');
            const editorEl = cardRoot ? cardRoot.querySelector('textarea[data-testid="permission-target-editor"]') : null;
            const targetTextEl = targetLabel.querySelector('[data-testid="ask-question-option-text"]');
            const origOptText = (targetTextEl?.textContent || targetLabel.title || '').trim();
            const suggested = String(spec.suggestedPersistPattern || '').trim();

            let finalTarget = '';
            if (editorEl && editorEl.value.trim() && editorEl.value.trim() !== rawTarget.trim()) {
                finalTarget = editorEl.value.trim();
            } else if (suggested && origOptText.includes(suggested)) {
                finalTarget = suggested;
            } else {
                finalTarget = String(editorEl?.value || rawTarget).trim();
            }

            const canonAction = shortLabelToCanonicalAction(rawAction);
            const ruleStr = buildNormalizedRuleFromInput(finalTarget, canonAction, false);
            return { canonAction, finalTarget, ruleStr };
        };

        // 4. Mount or locate shield button
        let shieldBtn = rowWrapper.querySelector(':scope > .leviosa-conv-to-project-perm-btn');

        const setMorphState = (active) => {
            if (!shieldBtn) return;
            shieldBtn.setAttribute('data-active', active ? 'true' : 'false');
            if (active) {
                targetLabel.classList.remove('leviosa-conv-label-full');
                targetLabel.classList.add('leviosa-conv-label-collapsed');
                shieldBtn.innerHTML = shieldActiveInnerHtml;
                const tooltipText = `已启用项目授权：再次点击直接确认提交（点击右侧 ✕ 取消）`;
                shieldBtn.title = tooltipText;
                shieldBtn.setAttribute('aria-label', tooltipText);
            } else {
                targetLabel.classList.remove('leviosa-conv-label-collapsed');
                targetLabel.classList.add('leviosa-conv-label-full');
                shieldBtn.innerHTML = shieldPureSvg;
                const tooltipText = `加入 [${projConfig.name}] 项目权限（点击开启）`;
                shieldBtn.title = tooltipText;
                shieldBtn.setAttribute('aria-label', tooltipText);
            }
        };

        if (!shieldBtn) {
            shieldBtn = document.createElement('button');
            shieldBtn.type = 'button';
            shieldBtn.className = 'leviosa-conv-to-project-perm-btn';
            shieldBtn.setAttribute('data-testid', 'leviosa-conv-to-project-perm-btn');
            shieldBtn.setAttribute('data-active', 'false');
            shieldBtn.innerHTML = shieldPureSvg;
            targetLabel.classList.add('leviosa-conv-label-full');

            shieldBtn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });

            shieldBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const isDeactivateClick = Boolean(
                    e.target && typeof e.target.closest === 'function' && e.target.closest('[data-action="deactivate-shield"]')
                );
                const wasActive = shieldBtn.getAttribute('data-active') === 'true';

                if (wasActive) {
                    if (isDeactivateClick) {
                        // 收起必须点击 x
                        setMorphState(false);
                    } else {
                        // 第二次点击就是确认！
                        const radio = targetLabel.querySelector('input[type="radio"]');
                        if (radio && !radio.checked) {
                            targetLabel.click();
                        }
                        setTimeout(() => {
                            triggerPermissionSubmit(radioGroupEl);
                        }, 30);
                    }
                } else {
                    // 第一次点击开启展开
                    const radio = targetLabel.querySelector('input[type="radio"]');
                    if (radio && !radio.checked) {
                        targetLabel.click();
                    }
                    setMorphState(true);
                }
            });

            // If user clicks the collapsed option label directly when shield is active, also treat as confirm rather than collapsing
            targetLabel.addEventListener('click', (e) => {
                if (!e.isTrusted) return;
                if (shieldBtn && shieldBtn.getAttribute('data-active') === 'true') {
                    // 第二次点击也是确认提交，绝不收起（收起必须点击 x）
                    setTimeout(() => {
                        triggerPermissionSubmit(radioGroupEl);
                    }, 30);
                }
            });

            if (targetLabel.nextSibling) {
                rowWrapper.insertBefore(shieldBtn, targetLabel.nextSibling);
            } else {
                rowWrapper.appendChild(shieldBtn);
            }
        }

        // Sync initial/current state classes (also auto-reverts if keyboard 1/3/No unchecked targetRadio)
        const targetRadio = targetLabel.querySelector('input[type="radio"]');
        const isCurrentActive = shieldBtn.getAttribute('data-active') === 'true';
        if (isCurrentActive && targetRadio && !targetRadio.checked) {
            setMorphState(false);
        } else if (isCurrentActive) {
            if (!targetLabel.classList.contains('leviosa-conv-label-collapsed')) {
                setMorphState(true);
            }
        } else {
            if (!targetLabel.classList.contains('leviosa-conv-label-full')) {
                setMorphState(false);
            }
        }

        // 5. Listen to radioGroup changes: uncheck shield if user picks another option
        if (!radioGroupEl._leviosaChangeBound) {
            radioGroupEl._leviosaChangeBound = true;
            radioGroupEl.addEventListener('change', () => {
                const checkedRadio = radioGroupEl.querySelector('input[type="radio"]:checked');
                const liveTargetRadio = targetLabel?.querySelector('input[type="radio"]');
                if (checkedRadio !== liveTargetRadio) {
                    setMorphState(false);
                }
            });
        }

        // 6. Bind submit hook to cardRoot to persist rule on confirm
        if (cardRoot && !cardRoot._leviosaSubmitBound) {
            cardRoot._leviosaSubmitBound = true;

            const executeProjectPermSaveOnSubmit = async () => {
                const liveBtn = radioGroupEl.querySelector('.leviosa-conv-to-project-perm-btn[data-active="true"]');
                if (!liveBtn) return;

                const checkedRadio = radioGroupEl.querySelector('input[type="radio"]:checked');
                const targetRadio = targetLabel?.querySelector('input[type="radio"]');
                if (!checkedRadio || !targetRadio || checkedRadio !== targetRadio) {
                    return;
                }

                try {
                    const liveCtx = extractPermissionPromptFiberContext(radioGroupEl);
                    const liveProj = resolvePromptProjectConfig(liveCtx?.cascadeId || fiberCtx.cascadeId);
                    if (liveCtx && liveProj && liveProj.enabled) {
                        const { canonAction, ruleStr } = computeCurrentPromptRule();
                        if (ruleStr) {
                            const cleanBareTarget = unwrapGrantRule(ruleStr).bareTarget;
                            const prevGrants = liveProj.permissionGrants || { allow: [], deny: [], ask: [] };
                            const nextAllow = Array.isArray(prevGrants.allow) ? [...prevGrants.allow] : [];
                            if (!nextAllow.includes(ruleStr)) {
                                nextAllow.push(ruleStr);
                            }
                            const nextDeny = (Array.isArray(prevGrants.deny) ? prevGrants.deny : []).filter(r => r !== ruleStr);
                            const nextAsk = (Array.isArray(prevGrants.ask) ? prevGrants.ask : []).filter(r => r !== ruleStr);
                            const nextGrants = { allow: nextAllow, deny: nextDeny, ask: nextAsk };

                            liveProj.permissionGrants = nextGrants;
                            showAutoApproveToast(liveProj.name, canonAction, cleanBareTarget);

                            await saveProjectToWorker({
                                projectId: liveProj.id,
                                projectName: liveProj.name,
                                enabled: liveProj.enabled,
                                settings: liveProj.settings,
                                permissionGrants: nextGrants
                            });
                            await syncProjectToNativePmService(liveProj);
                            scanAndAutoApproveWaitingSteps();

                            const topbarBtn = document.getElementById('leviosa-topbar-project-perm-btn');
                            if (topbarBtn) updateTopbarButtonDisplay(topbarBtn, resolveCurrentUiProject());

                            if (popoverEl && isPopoverOpen) {
                                const activeUiProj = resolveCurrentUiProject();
                                if (activeUiProj && activeUiProj.id === liveProj.id) {
                                    renderPermissionConfigControls(popoverEl, liveProj, false);
                                }
                            }
                            const settingsCard = document.getElementById('leviosa-project-settings-perm-card');
                            if (settingsCard && settingsCard.getAttribute('data-rendered-project-id') === liveProj.id) {
                                renderPermissionConfigControls(settingsCard, liveProj, true);
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Project Permissions] Submit save rule error:', err);
                }
            };

            cardRoot.addEventListener('click', (ev) => {
                const isSubmit = Boolean(
                    ev.target && typeof ev.target.closest === 'function' && (
                        ev.target.closest('[data-testid="interaction-continue-button"]') ||
                        (ev.target.closest('button') && (ev.target.closest('button').textContent || '').trim().includes('Submit'))
                    )
                );
                if (isSubmit) {
                    executeProjectPermSaveOnSubmit();
                }
            }, true);

            cardRoot.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
                    if (ev.target && ev.target.tagName === 'TEXTAREA') return;
                    executeProjectPermSaveOnSubmit();
                }
            }, true);
        }
    });
}

/**
 * Main Initialization (with hot-reload cleanup hook)
 */
export function initProjectPermissions() {
    if (typeof window.__leviosaProjectPermCleanup === 'function') {
        try {
            window.__leviosaProjectPermCleanup();
        } catch (e) {}
    }

    window._leviosa_project_permissions_initialized = true;
    console.log('🛡️ [Antigravity Mod] 正在初始化项目级文件与执行权限守护引擎 (Topbar Icon + Merge + Prompt Shield)...');

    // Clean up any legacy footer badge, stale popover, stale toast, or stale prompt buttons on re-init
    document.querySelectorAll('#leviosa-project-perm-badge, #leviosa-project-perm-popover, #leviosa-perm-toast, #leviosa-topbar-project-perm-btn, #leviosa-project-settings-perm-wrapper').forEach(el => el.remove());
    cleanupPromptShieldButtonsInScope(document);
    popoverEl = null;
    isPopoverOpen = false;

    ensureStylesInjected();
    maintainTopbarPermissionButton();
    maintainProjectSettingsCard();
    maintainPermissionPromptButtons();

    // 1. Load project permission configs from Worker & unlock conversation-scoped permissions for chat footer
    loadAllProjectsFromWorker().then(async () => {
        await unlockConversationScopedPermissions();
        maintainTopbarPermissionButton();
        maintainProjectSettingsCard();
        maintainPermissionPromptButtons();
        scanAndAutoApproveWaitingSteps();
    });

    // 2. Continuous MutationObserver (never disconnects across SPA routes, rAF-throttled)
    let rafPending = false;
    const observer = new MutationObserver(() => {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            maintainTopbarPermissionButton();
            maintainProjectSettingsCard();
            maintainPermissionPromptButtons();
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 3. Subscribe to Redux store & run background auto-approval daemon every 600ms
    const trySubscribeStore = () => {
        if (storeUnsubscribe) return;
        const ag = getAgRuntime();
        if (ag && ag.store && typeof ag.store.subscribe === 'function') {
            let lastCheck = 0;
            storeUnsubscribe = ag.store.subscribe(() => {
                const now = Date.now();
                if (now - lastCheck > 250) {
                    lastCheck = now;
                    scanAndAutoApproveWaitingSteps();
                }
            });
        }
    };

    const daemonInterval = setInterval(() => {
        trySubscribeStore();
        maintainTopbarPermissionButton();
        maintainProjectSettingsCard();
        maintainPermissionPromptButtons();
        scanAndAutoApproveWaitingSteps();
        if (isPopoverOpen && activeAnchorEl) {
            positionPopover(activeAnchorEl);
        }
    }, 600);

    // 4. Periodically refresh worker config in case ~/.gemini/config/projects/*.json changed externally
    const workerSyncInterval = setInterval(() => {
        loadAllProjectsFromWorker();
    }, 15000);

    // 5. Global click/keydown listeners to close floating popover cleanly
    const onDocClick = (e) => {
        if (!isPopoverOpen) return;
        if (popoverEl && popoverEl.contains(e.target)) return;
        const topbarBtn = document.getElementById('leviosa-topbar-project-perm-btn');
        if (topbarBtn && topbarBtn.contains(e.target)) return;
        hidePermissionPopover();
    };

    const onDocKeydown = (e) => {
        if (e.key === 'Escape' && isPopoverOpen) {
            if (e.target && typeof e.target.closest === 'function' && e.target.closest('[data-editing="true"]')) {
                return;
            }
            const openPreview = popoverEl?.querySelector('[data-merge-preview-open="true"]');
            if (openPreview) {
                openPreview.removeAttribute('data-merge-preview-open');
                openPreview.removeAttribute('data-preview-mode');
                openPreview.style.display = 'none';
                openPreview.innerHTML = '';
                return;
            }
            hidePermissionPopover();
        }
    };

    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onDocKeydown, true);

    window.__leviosaProjectPermCleanup = () => {
        observer.disconnect();
        clearInterval(daemonInterval);
        clearInterval(workerSyncInterval);
        if (typeof storeUnsubscribe === 'function') {
            try { storeUnsubscribe(); } catch (e) {}
            storeUnsubscribe = null;
        }
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onDocKeydown, true);
        hidePermissionPopover();
        if (popoverEl) {
            popoverEl.remove();
            popoverEl = null;
        }
        document.getElementById('leviosa-perm-toast')?.remove();
        document.getElementById('leviosa-project-perm-badge')?.remove();
        cleanupPromptShieldButtonsInScope(document);
    };
}
