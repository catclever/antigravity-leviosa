/**
 * Antigravity Multi-Account Archive & Switch Backend
 * Path: worker/account_manager.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { spawn, spawnSync, execSync } = require('child_process');
const { URL, URLSearchParams } = require('url');

const ACCOUNTS_DIR = path.join(os.homedir(), '.gemini/.accounts');
const JETSKI_TOKEN_PATH = path.join(os.homedir(), '.gemini/jetski-standalone-oauth-token');
const DB_PATH = path.join(os.homedir(), 'Library/Application Support/Antigravity/User/globalStorage/state.vscdb');
const LS_LOG_PATH = path.join(os.homedir(), 'Library/Logs/Antigravity/language_server.log');
const KEYRING_SERVICE = 'gemini';
const KEYRING_ACCOUNT = 'antigravity';
const KEYRING_PREFIX = 'go-keyring-base64:';

const _b64 = (s) => Buffer.from(s, 'base64').toString('utf8');

// ------------------ Externalized OAuth Configuration ------------------
const OAUTH_CONFIG_CANDIDATES = [
    path.join(__dirname, 'oauth_clients.json'),
    path.join(__dirname, '../oauth_clients.json'),
    path.join(ACCOUNTS_DIR, 'oauth_clients.json'),
];

let _cachedOAuthClients = null;

function loadOAuthClients() {
    for (const configPath of OAUTH_CONFIG_CANDIDATES) {
        try {
            if (fs.existsSync(configPath)) {
                const raw = fs.readFileSync(configPath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && (parsed.consumer || parsed.business)) {
                    _cachedOAuthClients = parsed;
                    return parsed;
                }
            }
        } catch (e) {
            console.error(`[account_manager] Failed to parse oauth config from ${configPath}:`, e.message);
        }
    }

    if (process.env.ANTIGRAVITY_CONSUMER_CLIENT_ID && process.env.ANTIGRAVITY_CONSUMER_CLIENT_SECRET) {
        _cachedOAuthClients = {
            consumer: {
                client_id: process.env.ANTIGRAVITY_CONSUMER_CLIENT_ID,
                client_secret: process.env.ANTIGRAVITY_CONSUMER_CLIENT_SECRET,
            },
            business: {
                client_id: process.env.ANTIGRAVITY_BUSINESS_CLIENT_ID || process.env.ANTIGRAVITY_CONSUMER_CLIENT_ID,
                client_secret: process.env.ANTIGRAVITY_BUSINESS_CLIENT_SECRET || process.env.ANTIGRAVITY_CONSUMER_CLIENT_SECRET,
            },
        };
        return _cachedOAuthClients;
    }

    return null;
}

function getOAuthClient(clientType = 'consumer') {
    const clients = _cachedOAuthClients || loadOAuthClients();
    if (!clients) {
        throw new Error(
            "未检测到 OAuth 客户端凭据配置。请在终端执行 `python3 scripts/extract_oauth_clients.py` 自动提取，或在 `~/.gemini/.accounts/oauth_clients.json` 中配置。"
        );
    }
    const info = clients[clientType] || clients.consumer;
    if (!info || !info.client_id || !info.client_secret) {
        throw new Error(`OAuth 客户端凭据缺失 (${clientType})。请检查 oauth_clients.json 配置。`);
    }
    return info;
}


const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function ensureAccountsDir() {
    if (!fs.existsSync(ACCOUNTS_DIR)) {
        fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
    }
}

function safeDecode(val) {
    if (!val) return '';
    try {
        return decodeURIComponent(String(val)).trim();
    } catch (e) {
        return String(val).replace(/%40/gi, '@').trim();
    }
}

function normalizeEmail(val) {
    return safeDecode(val).toLowerCase().replace(/%40/gi, '@');
}

function findAccountFile(email) {
    ensureAccountsDir();
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) return null;

    const directPath = path.join(ACCOUNTS_DIR, `${cleanEmail}.json`);
    if (fs.existsSync(directPath)) return directPath;

    // Scan directory for case-insensitive or encoded match
    const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json') && f !== 'oauth_clients.json');
    for (const f of files) {
        const base = f.replace(/\.json$/i, '').toLowerCase().replace(/%40/gi, '@');
        if (base === cleanEmail) {
            return path.join(ACCOUNTS_DIR, f);
        }
    }
    return null;
}

// ------------------ Network & Proxy Utilities ------------------

function getProxyList() {
    const list = [];
    const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    let scutilProxy = null;
    try {
        const out = execSync("scutil --proxy", { encoding: "utf-8", timeout: 1000 });
        const httpsEnable = /HTTPSEnable\s*:\s*1/.test(out);
        const httpEnable = /HTTPEnable\s*:\s*1/.test(out);
        const hostMatch = out.match(/HTTPSProxy\s*:\s*([^\s]+)/) || out.match(/HTTPProxy\s*:\s*([^\s]+)/);
        const portMatch = out.match(/HTTPSPort\s*:\s*(\d+)/) || out.match(/HTTPPort\s*:\s*(\d+)/);
        if ((httpsEnable || httpEnable) && hostMatch && portMatch) {
            scutilProxy = `http://${hostMatch[1]}:${portMatch[1]}`;
        }
    } catch (e) {}

    // Prefer scutilProxy (user system proxy like Clash/Mihomo)
    if (scutilProxy) list.push(scutilProxy);
    if (envProxy && !list.includes(envProxy)) list.push(envProxy);
    list.push(null); // direct
    return list;
}

function sendHttpRequest(targetUrl, options = {}, postData = null, proxyStr = null) {
    return new Promise((resolve, reject) => {
        const dest = new URL(targetUrl);
        const headers = { ...options.headers };
        if (!headers['Host'] && !headers['host']) {
            headers['Host'] = dest.hostname;
        }

        const doDirect = () => {
            const req = https.request({
                hostname: dest.hostname,
                port: dest.port || 443,
                path: dest.pathname + dest.search,
                method: options.method || "GET",
                headers: headers,
                rejectUnauthorized: false
            }, res => {
                let data = "";
                res.setEncoding("utf-8");
                res.on("data", c => data += c);
                res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
            });
            req.on("error", reject);
            if (postData) req.write(postData);
            req.end();
        };

        if (!proxyStr) return doDirect();

        const proxy = new URL(proxyStr);
        const connectReq = http.request({
            host: proxy.hostname,
            port: proxy.port || 80,
            method: "CONNECT",
            path: `${dest.hostname}:${dest.port || 443}`
        });

        connectReq.on("connect", (res, socket) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Proxy CONNECT failed with status: ${res.statusCode}`));
            }
            const tlsSocket = tls.connect({
                socket: socket,
                servername: dest.hostname,
                rejectUnauthorized: false
            }, () => {
                const req = http.request({
                    hostname: dest.hostname,
                    path: dest.pathname + dest.search,
                    method: options.method || "GET",
                    headers: headers,
                    createConnection: () => tlsSocket
                }, res => {
                    let data = "";
                    res.setEncoding("utf-8");
                    res.on("data", c => data += c);
                    res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
                });
                req.on("error", reject);
                if (postData) req.write(postData);
                req.end();
            });
            tlsSocket.on("error", reject);
        });

        connectReq.on("error", reject);
        connectReq.end();
    });
}

async function requestWithFallback(targetUrl, options = {}, postData = null) {
    const proxies = getProxyList();
    let lastErr = null;
    for (const p of proxies) {
        try {
            const res = await sendHttpRequest(targetUrl, options, postData, p);
            // If internal sandbox policy blocked, try next
            if (res.statusCode === 403 && res.body && res.body.includes("not allowed by policy")) {
                continue;
            }
            return res;
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error("All request attempts failed");
}

async function refreshOAuthToken(refreshToken, clientType = "consumer") {
    const clientInfo = getOAuthClient(clientType);
    const params = new URLSearchParams();
    params.append("client_id", clientInfo.client_id);
    params.append("client_secret", clientInfo.client_secret);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken.trim());

    const postData = params.toString();
    const res = await requestWithFallback(TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData)
        }
    }, postData);

    if (res.statusCode !== 200) {
        throw new Error(`Google OAuth error (${res.statusCode}): ${res.body}`);
    }
    return JSON.parse(res.body);
}

async function fetchUserInfo(accessToken) {
    const res = await requestWithFallback(USERINFO_URL, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json"
        }
    });

    if (res.statusCode !== 200) {
        throw new Error(`Google UserInfo error (${res.statusCode}): ${res.body}`);
    }
    return JSON.parse(res.body);
}

// ------------------ Protobuf Low-Level Encoders ------------------

function encodeVarint(val) {
    let num = BigInt(val);
    const bytes = [];
    while (true) {
        const b = Number(num & 0x7Fn);
        num >>= 7n;
        if (num > 0n) {
            bytes.push(b | 0x80);
        } else {
            bytes.push(b);
            break;
        }
    }
    return Buffer.from(bytes);
}

function encodeField(fieldNum, wireType, valBuffer) {
    const tag = (fieldNum << 3) | wireType;
    return Buffer.concat([encodeVarint(tag), valBuffer]);
}

function encodeString(fieldNum, str) {
    const buf = Buffer.from(str || "", "utf-8");
    return encodeField(fieldNum, 2, Buffer.concat([encodeVarint(buf.length), buf]));
}

function encodeMessage(fieldNum, msgBuffer) {
    return encodeField(fieldNum, 2, Buffer.concat([encodeVarint(msgBuffer.length), msgBuffer]));
}

function encodeVarintField(fieldNum, val) {
    return encodeField(fieldNum, 0, encodeVarint(val));
}

function buildOAuthTokenInfo(accessToken, refreshToken, expiryUnix, isGcpTos = false, enableBusinessLogin = false) {
    const timestampBytes = encodeVarintField(1, expiryUnix);
    const parts = [
        encodeString(1, accessToken),
        encodeString(2, "Bearer"),
        encodeString(3, refreshToken),
        encodeMessage(4, timestampBytes)
    ];
    if (isGcpTos) parts.push(encodeVarintField(5, 1));
    if (enableBusinessLogin) parts.push(encodeVarintField(6, 1));
    return Buffer.concat(parts);
}

function buildUnifiedSyncMap(entries) {
    const parts = [];
    for (const [k, v] of entries) {
        const valWrapper = encodeString(1, v);
        const entryBytes = Buffer.concat([
            encodeString(1, k),
            encodeMessage(2, valWrapper)
        ]);
        parts.push(encodeMessage(1, entryBytes));
    }
    return Buffer.concat(parts);
}

// ------------------ Protobuf Low-Level Decoders ------------------

function readVarint(buf, offset) {
    let res = 0n;
    let shift = 0n;
    let pos = offset;
    while (pos < buf.length) {
        const b = BigInt(buf[pos++]);
        res |= (b & 0x7fn) << shift;
        shift += 7n;
        if ((b & 0x80n) === 0n) break;
    }
    return [Number(res), pos];
}

function parseProto(buf) {
    let pos = 0;
    const fields = [];
    while (pos < buf.length) {
        if (pos >= buf.length) break;
        const [tag, nextPos] = readVarint(buf, pos);
        pos = nextPos;
        const fieldNum = tag >> 3;
        const wireType = tag & 0x07;
        if (wireType === 0) {
            const [val, nPos] = readVarint(buf, pos);
            pos = nPos;
            fields.push({ fieldNum, wireType, val });
        } else if (wireType === 2) {
            const [len, nPos] = readVarint(buf, pos);
            pos = nPos;
            const data = buf.slice(pos, pos + len);
            pos += len;
            fields.push({ fieldNum, wireType, data });
        } else if (wireType === 1) {
            pos += 8;
        } else if (wireType === 5) {
            pos += 4;
        } else {
            break;
        }
    }
    return fields;
}

function extractRefreshTokenFromOauthTokenSync(syncB64) {
    if (!syncB64) return null;
    try {
        const syncBuf = Buffer.from(syncB64, "base64");
        const topFields = parseProto(syncBuf);
        for (const f of topFields) {
            if (f.fieldNum === 1 && f.wireType === 2) {
                const sub = parseProto(f.data);
                const key = sub.find(s => s.fieldNum === 1)?.data?.toString("utf-8");
                const valWrapper = sub.find(s => s.fieldNum === 2)?.data;
                if (key === "oauthTokenInfoSentinelKey" && valWrapper) {
                    const valFields = parseProto(valWrapper);
                    const valStr = valFields.find(s => s.fieldNum === 1)?.data?.toString("utf-8");
                    if (valStr) {
                        const tokenBuf = Buffer.from(valStr, "base64");
                        const tokenFields = parseProto(tokenBuf);
                        const rfField = tokenFields.find(tf => tf.fieldNum === 3 && tf.wireType === 2);
                        if (rfField) {
                            return rfField.data.toString("utf-8");
                        }
                    }
                }
            }
        }
    } catch (e) {}

    // Fallback: search for standard Google refresh token pattern
    try {
        const rawStr = Buffer.from(syncB64, "base64").toString("utf-8");
        const m = rawStr.match(/1\/[a-zA-Z0-9_\-]+/);
        if (m) return m[0];
    } catch (e) {}

    return null;
}

function findRichUserStatusTemplate() {
    // 1. Check if active account in state.vscdb has a rich proto
    const active = getActiveAccountInfo();
    if (active && active.user_status_proto_b64 && active.user_status_proto_b64.length > 500) {
        return active.user_status_proto_b64;
    }

    // 2. Check saved accounts in ~/.gemini/.accounts/*.json
    if (fs.existsSync(ACCOUNTS_DIR)) {
        const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith('.json'));
        for (const f of files) {
            try {
                const acc = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), 'utf-8'));
                if (acc.user_status_proto_b64 && acc.user_status_proto_b64.length > 500) {
                    return acc.user_status_proto_b64;
                }
            } catch (e) {}
        }
    }

    return null;
}

function buildUserStatusProto(name, email, avatarUrl, existingUserStatusB64 = null) {
    let templateB64 = (existingUserStatusB64 && existingUserStatusB64.length > 500)
        ? existingUserStatusB64
        : findRichUserStatusTemplate();

    if (templateB64) {
        try {
            const buf = Buffer.from(templateB64, 'base64');
            const fields = parseProto(buf);
            const newParts = [];
            newParts.push(encodeString(3, name));
            newParts.push(encodeString(7, email));
            for (const f of fields) {
                if (f.fieldNum !== 3 && f.fieldNum !== 7 && f.fieldNum !== 38) {
                    if (f.wireType === 2) {
                        newParts.push(encodeMessage(f.fieldNum, f.data));
                    } else if (f.wireType === 0) {
                        newParts.push(encodeVarintField(f.fieldNum, f.val));
                    }
                }
            }
            if (avatarUrl) {
                newParts.push(encodeString(38, avatarUrl));
            }
            return Buffer.concat(newParts).toString('base64');
        } catch (e) {
            console.error('Error synthesizing rich userStatus proto:', e);
        }
    }

    // Fallback if no rich template available
    const userParts = [
        encodeString(3, name),
        encodeString(7, email)
    ];
    if (avatarUrl) {
        userParts.push(encodeString(38, avatarUrl));
    }
    return Buffer.concat(userParts).toString('base64');
}

function constructAntigravityState(accessToken, refreshToken, expiresIn, name, email, avatarUrl, existingUserStatusB64 = null) {
    const expiryUnix = Math.floor(Date.now() / 1000) + (expiresIn || 3600);

    // 1. Build OAuthTokenInfo proto & Base64
    const tokenProto = buildOAuthTokenInfo(accessToken, refreshToken, expiryUnix);
    const tokenB64 = tokenProto.toString("base64");

    // 2. Build UnifiedStateSync for oauthToken
    const authCtxJson = JSON.stringify({
        state: "signedIn",
        context: {
            project: "",
            showProjectError: false,
            errorMessage: "",
            ineligibleMessage: "",
            verificationUrl: "",
            isGcpTos: false,
            browserOpenFailed: false,
            appealUrl: "",
            appealLinkText: ""
        }
    });

    const oauthMapBytes = buildUnifiedSyncMap([
        ["oauthTokenInfoSentinelKey", tokenB64],
        ["authStateWithContextSentinelKey", authCtxJson]
    ]);
    const vscdbOauthToken = oauthMapBytes.toString("base64");

    // 3. Handle UserStatus proto & Base64
    const userStatusB64 = buildUserStatusProto(name, email, avatarUrl, existingUserStatusB64);

    const userMapBytes = buildUnifiedSyncMap([
        ["userStatusSentinelKey", userStatusB64]
    ]);
    const vscdbUserStatus = userMapBytes.toString("base64");

    // 4. Build antigravityAuthStatus JSON
    const vscdbAuthStatus = JSON.stringify({
        name: name,
        apiKey: accessToken,
        email: email,
        userStatusProtoBinaryBase64: userStatusB64
    });

    return {
        "antigravityAuthStatus": vscdbAuthStatus,
        "antigravityUnifiedStateSync.oauthToken": vscdbOauthToken,
        "antigravityUnifiedStateSync.userStatus": vscdbUserStatus,
        "antigravity.profileUrl": avatarUrl || ""
    };
}

// ------------------ SQLite Helpers ------------------

function readVscdbKeys(dbPath, keys) {
    if (!fs.existsSync(dbPath)) return {};
    const keyList = keys.map(k => `'${k.replace(/'/g, "''")}'`).join(",");
    const sql = `SELECT key, value FROM ItemTable WHERE key IN (${keyList});`;
    const res = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf-8" });
    if (res.status !== 0 || !res.stdout) return {};
    try {
        const rows = JSON.parse(res.stdout.trim());
        const map = {};
        for (const row of rows) {
            map[row.key] = row.value;
        }
        return map;
    } catch (e) {
        return {};
    }
}

function writeVscdbKeys(dbPath, keyValueMap) {
    const pyScript = `import sqlite3, json, sys
db_path = sys.argv[1]
data = json.loads(sys.stdin.read())
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("PRAGMA busy_timeout = 5000")
for k, v in data.items():
    cur.execute("INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)", (k, v))
conn.commit()
conn.close()
`;
    const res = spawnSync("python3", ["-c", pyScript, dbPath], {
        input: JSON.stringify(keyValueMap),
        encoding: "utf-8"
    });
    if (res.status !== 0) {
        throw new Error(`Failed to write to state.vscdb: ${res.stderr || res.stdout}`);
    }
}

// ------------------ Antigravity 2.0 CompositeTokenStorage & OIDC Helpers ------------------

function decodeJwtClaims(jwtStr) {
    if (!jwtStr || typeof jwtStr !== "string") return null;
    const parts = jwtStr.split(".");
    if (parts.length !== 3) return null;
    try {
        const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        const jsonStr = Buffer.from(padded, "base64").toString("utf-8");
        return JSON.parse(jsonStr);
    } catch (e) {
        return null;
    }
}

function buildIdToken({ oauthIdToken, existingIdToken, email, name, picture, clientType = "consumer" }) {
    // 1. If Google OAuth returned a fresh id_token that has both email & name, use it directly
    if (oauthIdToken) {
        const claims = decodeJwtClaims(oauthIdToken);
        if (claims && claims.email && claims.name) {
            return oauthIdToken;
        }
    }

    // 2. Otherwise synthesize a valid 3-part JWT that satisfies parseIDToken (0x1019820d0)
    // parseIDToken splits by '.', checks len == 3, base64url-decodes parts[1], and unmarshals { name, email }
    const existingClaims = decodeJwtClaims(oauthIdToken || existingIdToken) || {};
    let clientId = existingClaims.azp || existingClaims.aud;
    if (!clientId) {
        try {
            const clientInfo = getOAuthClient(clientType);
            clientId = clientInfo.client_id;
        } catch (e) {
            clientId = "";
        }
    }
    const now = Math.floor(Date.now() / 1000);
    const displayName = name || existingClaims.name || email.split("@")[0];

    const headerObj = { alg: "RS256", typ: "JWT" };
    const payloadObj = {
        iss: "https://accounts.google.com",
        azp: clientId,
        aud: clientId,
        sub: existingClaims.sub || email,
        email: email,
        email_verified: true,
        name: displayName,
        picture: picture || existingClaims.picture || "",
        given_name: existingClaims.given_name || displayName.split(" ")[0] || displayName,
        family_name: existingClaims.family_name || displayName.split(" ").slice(1).join(" ") || "",
        iat: now,
        exp: now + 3600
    };

    const toB64Url = (obj) =>
        Buffer.from(JSON.stringify(obj), "utf-8")
            .toString("base64")
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");

    return `${toB64Url(headerObj)}.${toB64Url(payloadObj)}.sig`;
}

function formatRfc3339Local(date) {
    const pad = (n, len = 2) => String(Math.floor(Math.abs(n))).padStart(len, "0");
    const tzOffsetMin = -date.getTimezoneOffset();
    const sign = tzOffsetMin >= 0 ? "+" : "-";
    const tzHours = pad(Math.floor(Math.abs(tzOffsetMin) / 60));
    const tzMins = pad(Math.abs(tzOffsetMin) % 60);
    const ms = pad(date.getMilliseconds(), 3) + "000";
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}${sign}${tzHours}:${tzMins}`
    );
}

function readJetskiStoredToken() {
    // 1. Check ~/.gemini/jetski-standalone-oauth-token first (deleted immediately by AuthLogout)
    if (fs.existsSync(JETSKI_TOKEN_PATH)) {
        try {
            const raw = fs.readFileSync(JETSKI_TOKEN_PATH, "utf-8").trim();
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.token && (parsed.token.refresh_token || parsed.token.access_token)) {
                    return parsed;
                }
            }
        } catch (e) {}
    }

    // 2. Fallback to macOS Keychain (service="gemini", account="antigravity")
    try {
        const res = spawnSync("security", ["find-generic-password", "-s", KEYRING_SERVICE, "-a", KEYRING_ACCOUNT, "-w"], {
            encoding: "utf-8",
            timeout: 2000
        });
        if (res.status === 0 && res.stdout) {
            let secret = res.stdout.trim();
            if (secret.startsWith(KEYRING_PREFIX)) {
                secret = Buffer.from(secret.slice(KEYRING_PREFIX.length), "base64").toString("utf-8");
            }
            const parsed = JSON.parse(secret);
            if (parsed && parsed.token && (parsed.token.refresh_token || parsed.token.access_token)) {
                return parsed;
            }
        }
    } catch (e) {}

    return null;
}

function writeJetskiStoredToken(storedToken) {
    const jsonStr = JSON.stringify(storedToken);

    // 1. Write ~/.gemini/jetski-standalone-oauth-token (mode 0600)
    const dir = path.dirname(JETSKI_TOKEN_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(JETSKI_TOKEN_PATH, jsonStr, { encoding: "utf-8", mode: 0o600 });

    // 2. Write macOS Keychain (service="gemini", account="antigravity", value="go-keyring-base64:<base64>")
    const keyringVal = KEYRING_PREFIX + Buffer.from(jsonStr, "utf-8").toString("base64");
    const res = spawnSync("security", [
        "add-generic-password",
        "-U",
        "-s", KEYRING_SERVICE,
        "-a", KEYRING_ACCOUNT,
        "-w", keyringVal
    ], { encoding: "utf-8", timeout: 3000 });

    if (res.status !== 0) {
        console.error("Warning: security add-generic-password returned non-zero:", res.stderr || res.stdout);
    }
}

function getLanguageServerStatus() {
    if (!fs.existsSync(LS_LOG_PATH)) {
        return { pid: null, port: null, ready: false, url: null };
    }
    try {
        const raw = fs.readFileSync(LS_LOG_PATH, "utf-8");
        const pidMatch = raw.match(/Starting language server process with pid (\d+)/);
        const portMatch = raw.match(/Language server listening on random port at (\d+) for HTTPS/);
        const ready =
            raw.includes("Serving UI bundle from embedded assets") ||
            raw.includes("initialized server successfully");
        const pid = pidMatch ? Number(pidMatch[1]) : null;
        const port = portMatch ? Number(portMatch[1]) : null;
        return {
            pid,
            port,
            ready,
            url: port ? `https://127.0.0.1:${port}/` : null
        };
    } catch (e) {
        return { pid: null, port: null, ready: false, url: null };
    }
}

function scheduleLanguageServerRestart(delayMs = 300) {
    // Electron's monitorLsCrashInternal watches language_server exit, respawns it with all original flags,
    // runs NewAuthClient -> tryRestoreToken() to load the new CompositeTokenStorage credentials,
    // and onPortChanged automatically calls win.loadURL("https://127.0.0.1:<newPort>/") on all windows.
    setTimeout(() => {
        try {
            const child = spawn("pkill", ["-TERM", "-f", "/Applications/Antigravity.app/Contents/Resources/bin/language_server"], {
                detached: true,
                stdio: "ignore"
            });
            child.unref();
        } catch (e) {
            console.error("Failed to trigger language_server restart:", e);
        }
    }, delayMs);
}

// ------------------ Core Business Actions ------------------

function getActiveAccountInfo() {
    const stored = readJetskiStoredToken();
    if (!stored || !stored.token) {
        // When logged out in Antigravity 2.0, both Keychain and jetski-standalone-oauth-token are removed.
        // Do NOT fall back to state.vscdb because Antigravity 2.0 never clears state.vscdb on logout.
        return null;
    }

    const refreshToken = stored.token.refresh_token || "";
    const accessToken = stored.token.access_token || "";
    const idToken = stored.id_token || "";
    const authMethod = stored.auth_method || "consumer";

    const claims = decodeJwtClaims(idToken) || {};
    let email = claims.email || "";
    let name = claims.name || "";
    let picture = claims.picture || "";
    let userStatusProtoB64 = null;

    // Cross-reference with archived accounts in ~/.gemini/.accounts if any field is missing
    if (fs.existsSync(ACCOUNTS_DIR)) {
        const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith(".json"));
        for (const f of files) {
            try {
                const item = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, f), "utf-8"));
                const matchByEmail = email && item.email && normalizeEmail(item.email) === normalizeEmail(email);
                const matchByRt = refreshToken && item.refresh_token && item.refresh_token === refreshToken;
                if (matchByEmail || matchByRt) {
                    if (!email) email = item.email || "";
                    if (!name) name = item.name || "";
                    if (!picture) picture = item.picture || "";
                    userStatusProtoB64 = item.user_status_proto_b64 || null;
                    break;
                }
            } catch (e) {}
        }
    }

    if (!email) return null;

    return {
        email: email,
        name: name || email.split("@")[0],
        picture: picture,
        apiKey: accessToken,
        refresh_token: refreshToken,
        id_token: idToken,
        client_type: authMethod === "business" ? "business" : "consumer",
        user_status_proto_b64: userStatusProtoB64
    };
}

function archiveAccountData(account) {
    ensureAccountsDir();
    const cleanEmail = normalizeEmail(account.email);
    const filePath = path.join(ACCOUNTS_DIR, `${cleanEmail}.json`);

    let existing = {};
    const isNew = !fs.existsSync(filePath);
    if (!isNew) {
        try {
            existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (e) {}
    }

    let userStatusProto = account.user_status_proto_b64 || existing.user_status_proto_b64;
    userStatusProto = buildUserStatusProto(
        account.name || existing.name || "Unknown",
        account.email,
        account.picture || existing.picture || "",
        userStatusProto
    );

    const idToken = buildIdToken({
        oauthIdToken: account.id_token,
        existingIdToken: existing.id_token,
        email: account.email,
        name: account.name || existing.name || account.email.split("@")[0],
        picture: account.picture || existing.picture || "",
        clientType: account.client_type || existing.client_type || "consumer"
    });

    const accountData = {
        email: account.email,
        name: account.name || existing.name || "Unknown",
        picture: account.picture || existing.picture || "",
        refresh_token: account.refresh_token || existing.refresh_token || "",
        id_token: idToken,
        client_type: account.client_type || existing.client_type || "consumer",
        created_at: existing.created_at || new Date().toISOString(),
        last_used_at: account.last_used_at || existing.last_used_at || new Date().toISOString(),
        user_status_proto_b64: userStatusProto,
        is_new: isNew
    };

    fs.writeFileSync(filePath, JSON.stringify(accountData, null, 2), "utf-8");
    return accountData;
}

// ------------------ Export Contract ------------------

module.exports = async function(query = {}) {
    const action = safeDecode(query.action) || "list";

    try {
        switch (action) {
            case "list": {
                ensureAccountsDir();
                const active = getActiveAccountInfo();
                const activeEmail = active ? normalizeEmail(active.email) : null;

                // Automatically sync/archive the currently logged-in account so its latest refresh_token & id_token are preserved
                if (active && active.email && active.refresh_token) {
                    try {
                        archiveAccountData(active);
                    } catch (e) {}
                }

                const files = fs.readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith(".json") && f !== "oauth_clients.json");
                const accounts = [];

                for (const f of files) {
                    try {
                        const fullPath = path.join(ACCOUNTS_DIR, f);
                        const raw = fs.readFileSync(fullPath, "utf-8");
                        const item = JSON.parse(raw);
                        if (!item.email) continue;

                        const isCurrentActive = activeEmail ? (normalizeEmail(item.email) === activeEmail) : false;
                        accounts.push({
                            email: item.email,
                            name: item.name || "",
                            picture: item.picture || "",
                            client_type: item.client_type || "consumer",
                            created_at: item.created_at || null,
                            last_used_at: item.last_used_at || null,
                            is_active: isCurrentActive,
                            has_refresh_token: !!item.refresh_token
                        });
                    } catch (e) {}
                }

                // Sort: active account first, then by last_used_at descending
                accounts.sort((a, b) => {
                    if (a.is_active && !b.is_active) return -1;
                    if (!a.is_active && b.is_active) return 1;
                    const timeA = new Date(a.last_used_at || 0).getTime();
                    const timeB = new Date(b.last_used_at || 0).getTime();
                    return timeB - timeA;
                });

                return {
                    success: true,
                    active_email: active ? active.email : null,
                    accounts: accounts
                };
            }

            case "get_oauth_status": {
                const clients = loadOAuthClients();
                return {
                    success: true,
                    configured: !!clients,
                    client_types: clients ? Object.keys(clients) : []
                };
            }

            case "get_active": {
                const active = getActiveAccountInfo();
                if (!active) {
                    return {
                        success: true,
                        active: null
                    };
                }
                return {
                    success: true,
                    active: {
                        email: active.email,
                        name: active.name,
                        picture: active.picture,
                        has_refresh_token: !!active.refresh_token,
                        user_status_proto_b64: active.user_status_proto_b64
                    }
                };
            }

            case "archive_current": {
                const active = getActiveAccountInfo();
                if (!active || !active.email) {
                    return { success: false, error: "当前处于未登录状态，未检测到活跃账号" };
                }
                if (!active.refresh_token) {
                    return { success: false, error: "当前活跃账号缺少 refresh_token" };
                }

                const saved = archiveAccountData({
                    ...active,
                    last_used_at: new Date().toISOString()
                });
                return {
                    success: true,
                    email: saved.email,
                    is_new: !!saved.is_new,
                    account: saved
                };
            }

            case "add": {
                const refreshToken = safeDecode(query.refresh_token);
                const clientType = safeDecode(query.client_type || "consumer").toLowerCase();

                if (!refreshToken) {
                    return { success: false, error: "Missing refresh_token parameter" };
                }

                // 1. Exchange refresh token for access token (and id_token if openid scope was granted)
                const tokenRes = await refreshOAuthToken(refreshToken, clientType);
                const accessToken = tokenRes.access_token;
                if (!accessToken) {
                    return { success: false, error: "Failed to retrieve access token from Google OAuth" };
                }

                // 2. Fetch UserInfo
                const userInfo = await fetchUserInfo(accessToken);
                const email = userInfo.email;
                if (!email) {
                    return { success: false, error: "Failed to retrieve user email from Google UserInfo" };
                }

                // 3. Save to ~/.gemini/.accounts/<email>.json
                const saved = archiveAccountData({
                    email: email,
                    name: userInfo.name || email.split("@")[0],
                    picture: userInfo.picture || "",
                    refresh_token: refreshToken,
                    id_token: tokenRes.id_token || null,
                    client_type: clientType,
                    last_used_at: new Date().toISOString()
                });

                return {
                    success: true,
                    email: email,
                    account: saved
                };
            }

            case "switch": {
                const targetEmail = normalizeEmail(query.email);
                if (!targetEmail) {
                    return { success: false, error: "Missing email parameter" };
                }

                ensureAccountsDir();
                const targetFile = findAccountFile(targetEmail);
                if (!targetFile || !fs.existsSync(targetFile)) {
                    return { success: false, error: `Account ${targetEmail} not found in archives` };
                }

                let targetAccount;
                try {
                    targetAccount = JSON.parse(fs.readFileSync(targetFile, "utf-8"));
                } catch (e) {
                    return { success: false, error: `Failed to parse account archive: ${e.message}` };
                }

                if (!targetAccount.refresh_token) {
                    return { success: false, error: `Account ${targetAccount.email} has no refresh_token stored` };
                }

                // 1. Auto-archive currently active account if present
                const currentActive = getActiveAccountInfo();
                if (currentActive && currentActive.email && currentActive.refresh_token) {
                    try {
                        archiveAccountData(currentActive);
                    } catch (e) {
                        console.error("Auto-archive of current account failed:", e);
                    }
                }

                // 2. Refresh access token with Google OAuth
                const clientType = targetAccount.client_type || "consumer";
                const tokenRes = await refreshOAuthToken(targetAccount.refresh_token, clientType);
                const accessToken = tokenRes.access_token;
                const expiresIn = tokenRes.expires_in || 3600;

                // 3. Fetch fresh UserInfo to keep name/picture accurate
                let name = targetAccount.name;
                let picture = targetAccount.picture;
                try {
                    const freshInfo = await fetchUserInfo(accessToken);
                    if (freshInfo.name) name = freshInfo.name;
                    if (freshInfo.picture) picture = freshInfo.picture;
                } catch (e) {}

                // 4. Build valid OIDC id_token required by Antigravity 2.0 language_server (parseIDToken / fetchPeopleInfo)
                const idToken = buildIdToken({
                    oauthIdToken: tokenRes.id_token,
                    existingIdToken: targetAccount.id_token,
                    email: targetAccount.email,
                    name: name,
                    picture: picture,
                    clientType: clientType
                });

                // 5. Construct Antigravity 2.0 StoredToken & write to CompositeTokenStorage (Keychain + ~/.gemini/jetski-standalone-oauth-token)
                const expiryDate = new Date(Date.now() + expiresIn * 1000);
                const storedToken = {
                    token: {
                        access_token: accessToken,
                        token_type: "Bearer",
                        refresh_token: targetAccount.refresh_token,
                        expiry: formatRfc3339Local(expiryDate)
                    },
                    auth_method: clientType === "business" ? "business" : "consumer",
                    id_token: idToken
                };
                writeJetskiStoredToken(storedToken);

                // 6. Also update legacy state.vscdb (best-effort for 1.x compatibility)
                let backupPath = null;
                try {
                    if (fs.existsSync(DB_PATH)) {
                        const timestamp = Math.floor(Date.now() / 1000);
                        backupPath = path.join(path.dirname(DB_PATH), `state.vscdb.backup.${timestamp}`);
                        fs.copyFileSync(DB_PATH, backupPath);
                        const statePayload = constructAntigravityState(
                            accessToken,
                            targetAccount.refresh_token,
                            expiresIn,
                            name,
                            targetAccount.email,
                            picture,
                            targetAccount.user_status_proto_b64 || null
                        );
                        writeVscdbKeys(DB_PATH, statePayload);
                        targetAccount.user_status_proto_b64 = JSON.parse(statePayload.antigravityAuthStatus).userStatusProtoBinaryBase64;
                    }
                } catch (e) {
                    console.error("Legacy state.vscdb update skipped:", e.message);
                }

                // 7. Save updated profile, id_token & last_used_at in ~/.gemini/.accounts/<email>.json
                targetAccount.name = name;
                targetAccount.picture = picture;
                targetAccount.id_token = idToken;
                targetAccount.last_used_at = new Date().toISOString();
                fs.writeFileSync(targetFile, JSON.stringify(targetAccount, null, 2), "utf-8");

                // 8. Trigger language_server restart so NewAuthClient -> tryRestoreToken() loads the new credentials
                // and Electron's onPortChanged reloads all windows into the authenticated workspace
                const prevLsStatus = getLanguageServerStatus();
                const shouldRestart = safeDecode(query.no_restart) !== "1";
                if (shouldRestart) {
                    scheduleLanguageServerRestart(350);
                }

                return {
                    success: true,
                    switched_to: targetAccount.email,
                    restarting_ls: shouldRestart,
                    previous_ls_pid: prevLsStatus.pid,
                    previous_ls_port: prevLsStatus.port,
                    backup: backupPath
                };
            }

            case "get_ls_status": {
                const status = getLanguageServerStatus();
                return {
                    success: true,
                    ...status
                };
            }

            case "delete": {
                const targetEmail = normalizeEmail(query.email);
                if (!targetEmail) {
                    return { success: false, error: "Missing email parameter" };
                }

                ensureAccountsDir();
                const targetFile = findAccountFile(targetEmail);
                if (targetFile && fs.existsSync(targetFile)) {
                    fs.unlinkSync(targetFile);
                    return { success: true, deleted: targetEmail };
                } else {
                    return { success: false, error: `Account ${targetEmail} not found` };
                }
            }

            default:
                return { success: false, error: `Unknown action: ${action}` };
        }
    } catch (err) {
        return {
            success: false,
            error: err.message || String(err)
        };
    }
};
