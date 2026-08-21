const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MAILTD_BASE_URL = "https://api.mail.td";
const MAILTD_API_TOKEN = process.env.MAILTD_API_TOKEN || "td_8b2d277088cad4179c89deb467b26fc32aecc67273b178c074e59574e9a4dfbe";
const FIRSTMAIL_API_KEY = process.env.FIRSTMAIL_API_KEY || "gItjn0iQ3zHIEqWapS9AIksprmgj1NGwjz40WI2xQGwOHymUh-qCE-X20WH4IYB0";
const LOCAL_STATIC_ROOT = path.resolve(__dirname, "../../functions");

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

exports.handler = async function(event) {
    if (event.httpMethod === "OPTIONS") {
        return jsonResponse(204, {});
    }

    if (event.httpMethod !== "POST") {
        return jsonResponse(405, { error: "method_not_allowed" });
    }

    try {
        const payload = JSON.parse(event.body || "{}");
        const data = await handleAction(payload);
        return jsonResponse(200, data);
    } catch (error) {
        return jsonResponse(error.statusCode || 500, {
            error: error.code || "request_failed",
            message: error.message
        });
    }
};

async function handleAction(payload) {
    switch (payload.action) {
        case "firstmailLatest":
            return fetchFirstmailLatest(payload);
        case "mailtdLatest":
            return fetchMailtdLatest(payload);
        case "domains":
            return mailtdRequest("/api/domains", { authRequired: false });
        case "createAccount":
            return createAccount(payload);
        case "createAccounts":
            return createAccounts(payload);
        case "mailManagerMessages":
            return fetchManagerMessages(payload);
        case "mailManagerMessageDetail":
            return fetchManagerMessageDetail(payload);
        default:
            throw httpError(400, "invalid_action", "Unknown mail action.");
    }
}

async function fetchFirstmailLatest(payload) {
    const email = String(payload.email || "").trim();
    const password = String(payload.password || "").trim();

    if (!email || !password) {
        throw httpError(400, "missing_mailbox", "Email and password are required.");
    }

    const response = await fetch("https://firstmail.ltd/api/v1/email/messages/latest", {
        method: "POST",
        headers: {
            "X-API-KEY": FIRSTMAIL_API_KEY,
            "Content-Type": "application/json",
            "Authorization": `Bearer ${FIRSTMAIL_API_KEY}`
        },
        body: JSON.stringify({
            email,
            password,
            folder: "INBOX"
        })
    });

    const data = await readJsonResponse(response);

    if (response.status === 404) {
        return {
            empty: true,
            message: "未获取到邮件"
        };
    }

    if (!response.ok) {
        throw httpError(response.status, data.error || "firstmail_error", data.message || `firstmail HTTP ${response.status}`);
    }

    return data;
}

async function fetchMailtdLatest(payload) {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "").trim();

    if (!email || !email.includes("@")) {
        throw httpError(400, "invalid_email", "Invalid email address.");
    }

    const attempts = [];

    if (password) {
        try {
            const mailboxSession = await loginMailtdMailbox(email, password);
            return await fetchMailtdLatestWithToken(mailboxSession.id || email, mailboxSession.token);
        } catch (error) {
            attempts.push(`mailbox_login:${error.message}`);
        }
    }

    try {
        return await fetchMailtdLatestWithToken(email, MAILTD_API_TOKEN);
    } catch (error) {
        attempts.push(`api_token:${error.message}`);

        if (!shouldTryMailboxFallback(error)) {
            throw error;
        }
    }

    if (password) {
        try {
            const account = await createMailtdAccountWithRetry({
                address: email,
                password
            });
            const accountId = account.id || account.address || email;
            await delay(350);
            return await fetchMailtdLatestWithToken(accountId, MAILTD_API_TOKEN);
        } catch (error) {
            attempts.push(`create:${error.message}`);
        }
    }

    throw httpError(404, "mailtd_fetch_failed", `Mail.td fetch failed. ${attempts.join(" | ")}`);
}

async function fetchMailtdLatestWithToken(accountId, token) {
    const encodedAccount = encodeURIComponent(accountId);
    const list = await mailtdRequest(`/api/accounts/${encodedAccount}/messages?page=1`, { token });
    const messages = Array.isArray(list.messages) ? list.messages : [];
    const latest = messages[0];

    if (!latest || !latest.id) {
        return {
            empty: true,
            message: "未获取到邮件"
        };
    }

    return mailtdRequest(`/api/accounts/${encodedAccount}/messages/${encodeURIComponent(latest.id)}`, { token });
}

async function loginMailtdMailbox(email, password) {
    const variants = [
        { address: email, password },
        { email, password }
    ];
    let lastError = null;

    for (const body of variants) {
        try {
            const data = await mailtdRequest("/api/token", {
                method: "POST",
                body,
                authRequired: false
            });
            const token = data.token || data.access_token || data.mailbox_token;

            if (!token) {
                throw httpError(502, "missing_mailbox_token", "Mailbox login did not return a token.");
            }

            return {
                id: data.id,
                address: data.address || email,
                token
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || httpError(401, "mailbox_login_failed", "Mailbox login failed.");
}

async function createAccount(payload) {
    const address = normalizeAddress(payload.address);
    const password = String(payload.password || "").trim();

    if (!password) {
        throw httpError(400, "missing_password", "Password is required.");
    }

    return createMailtdAccountWithRetry({ address, password });
}

async function createAccounts(payload) {
    const domain = normalizeDomain(payload.domain || "nqmo.com");
    const count = clampInteger(payload.count, 1, 200);
    const prefix = sanitizePrefix(payload.prefix);
    const fixedPassword = String(payload.password || "").trim();
    const usedLocalParts = new Set();
    const results = [];

    for (let index = 0; index < count; index += 1) {
        const password = fixedPassword || generatePassword();
        const requestedLocalPart = buildLocalPart({ count, index, prefix, usedLocalParts });
        const result = await createGeneratedAccount({
            domain,
            password,
            requestedLocalPart,
            canChangeLocalPart: !(count === 1 && prefix)
        });

        if (result.ok) {
            usedLocalParts.add(result.address.split("@")[0]);
        }

        results.push(result);
    }

    return { results };
}

async function fetchManagerMessages(payload) {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "").trim();
    const provider = String(payload.provider || "").trim() || resolveProviderFromEmail(email);

    if (!email || !email.includes("@")) {
        throw httpError(400, "invalid_email", "Invalid email address.");
    }

    if (provider === "mailtd") {
        return fetchMailtdAllMessages(email, password);
    }

    return fetchFirstmailMessages(email, password);
}

async function fetchManagerMessageDetail(payload) {
    const email = String(payload.email || "").trim().toLowerCase();
    const password = String(payload.password || "").trim();
    const messageId = String(payload.messageId || "").trim();
    const provider = String(payload.provider || "").trim() || resolveProviderFromEmail(email);
    const fallbackMessage = payload.message && typeof payload.message === "object" ? payload.message : null;

    if (!email || !email.includes("@")) {
        throw httpError(400, "invalid_email", "Invalid email address.");
    }

    if (!messageId && fallbackMessage) {
        return normalizeMessageDetail(provider, fallbackMessage);
    }

    if (provider === "mailtd") {
        return fetchMailtdMessageDetail(email, password, messageId);
    }

    return fetchFirstmailMessageDetail(email, password, messageId, fallbackMessage);
}

async function fetchMailtdAllMessages(email, password) {
    const session = await getMailtdReadSession(email, password);
    const messages = [];

    for (let page = 1; page <= 20; page += 1) {
        const data = await mailtdRequest(`/api/accounts/${encodeURIComponent(session.accountId)}/messages?page=${page}`, {
            token: session.token
        });
        const pageMessages = Array.isArray(data.messages) ? data.messages : [];
        messages.push(...pageMessages.map(message => normalizeMessageSummary("mailtd", message, {
            accountId: session.accountId
        })));

        if (pageMessages.length < 30) {
            break;
        }
    }

    return {
        provider: "mailtd",
        accountId: session.accountId,
        messages
    };
}

async function fetchMailtdMessageDetail(email, password, messageId) {
    const session = await getMailtdReadSession(email, password);
    const data = await mailtdRequest(`/api/accounts/${encodeURIComponent(session.accountId)}/messages/${encodeURIComponent(messageId)}`, {
        token: session.token
    });

    return normalizeMessageDetail("mailtd", data);
}

async function getMailtdReadSession(email, password) {
    if (password) {
        try {
            const mailboxSession = await loginMailtdMailbox(email, password);
            return {
                provider: "mailtd",
                accountId: mailboxSession.id || email,
                token: mailboxSession.token
            };
        } catch (error) {
            // Fall back to the configured Pro token below.
        }
    }

    try {
        await mailtdRequest(`/api/accounts/${encodeURIComponent(email)}/messages?page=1`, {
            token: MAILTD_API_TOKEN
        });
        return {
            provider: "mailtd",
            accountId: email,
            token: MAILTD_API_TOKEN
        };
    } catch (error) {
        if (!shouldTryMailboxFallback(error) || !password) {
            throw error;
        }
    }

    const mailboxSession = await loginMailtdMailbox(email, password);
    return {
        provider: "mailtd",
        accountId: mailboxSession.id || email,
        token: mailboxSession.token
    };
}

async function fetchFirstmailMessages(email, password) {
    if (!password) {
        throw httpError(400, "missing_mailbox", "Email and password are required.");
    }

    const body = {
        email,
        password,
        limit: 100,
        folder: "INBOX"
    };
    const candidates = [
        "/api/v1/email/messages",
        "/api/v1/email/messages/",
        "/api/v1/email/messages/list",
        "/api/v1/email/messages/all"
    ];
    const errors = [];

    for (const path of candidates) {
        try {
            const data = await firstmailRequest(path, body);
            const messages = normalizeMessageArray(data);

            if (messages.length) {
                return {
                    provider: "firstmail",
                    messages: messages.map(message => normalizeMessageSummary("firstmail", message))
                };
            }
        } catch (error) {
            errors.push(`${path}:${error.message}`);
        }
    }

    try {
        const latest = await fetchFirstmailLatest({ email, password });
        if (latest && !latest.empty) {
            return {
                provider: "firstmail",
                messages: [normalizeMessageSummary("firstmail", latest, { syntheticId: "latest" })]
            };
        }

        return {
            provider: "firstmail",
            messages: []
        };
    } catch (error) {
        errors.push(`latest:${error.message}`);
    }

    throw httpError(502, "firstmail_messages_failed", `firstmail message list failed. ${errors.join(" | ")}`);
}

async function fetchFirstmailMessageDetail(email, password, messageId, fallbackMessage) {
    if (!password) {
        throw httpError(400, "missing_mailbox", "Email and password are required.");
    }

    if (!messageId || messageId === "latest") {
        const latest = await fetchFirstmailLatest({ email, password });
        return normalizeMessageDetail("firstmail", latest);
    }

    if (fallbackMessage && hasMessageBody(fallbackMessage)) {
        return normalizeMessageDetail("firstmail", fallbackMessage);
    }

    const candidates = [
        { path: `/api/v1/email/messages/${encodeURIComponent(messageId)}`, body: { email, password, folder: "INBOX" } },
        { path: "/api/v1/email/message", body: { email, password, folder: "INBOX", id: messageId } },
        { path: "/api/v1/email/messages/detail", body: { email, password, folder: "INBOX", id: messageId } }
    ];

    for (const candidate of candidates) {
        try {
            const data = await firstmailRequest(candidate.path, candidate.body);
            return normalizeMessageDetail("firstmail", data);
        } catch (error) {
            // The public API page requires login, so keep trying known endpoint shapes.
        }
    }

    if (fallbackMessage) {
        return normalizeMessageDetail("firstmail", fallbackMessage);
    }

    throw httpError(404, "firstmail_message_not_found", "firstmail message detail was not found.");
}

function hasMessageBody(message) {
    return Boolean(message && (
        message.text_body ||
        message.textBody ||
        message.html_body ||
        message.htmlBody ||
        message.text ||
        message.body ||
        message.content ||
        message.html
    ));
}

async function firstmailRequest(path, body) {
    const response = await fetch(`https://firstmail.ltd${path}`, {
        method: "POST",
        headers: {
            "X-API-KEY": FIRSTMAIL_API_KEY,
            "Content-Type": "application/json",
            "Authorization": `Bearer ${FIRSTMAIL_API_KEY}`
        },
        body: JSON.stringify(body)
    });
    const data = await readJsonResponse(response);

    if (response.status === 404) {
        throw httpError(404, "firstmail_not_found", data.message || "firstmail HTTP 404");
    }

    if (!response.ok) {
        throw httpError(response.status, data.error || "firstmail_error", data.message || `firstmail HTTP ${response.status}`);
    }

    return data;
}

async function createGeneratedAccount(options) {
    const maxAddressAttempts = options.canChangeLocalPart ? 8 : 1;
    let localPart = options.requestedLocalPart;
    let lastError = null;

    for (let attempt = 0; attempt < maxAddressAttempts; attempt += 1) {
        const address = `${localPart}@${options.domain}`;

        try {
            const account = await createMailtdAccountWithRetry({
                address,
                password: options.password
            });

            return {
                ok: true,
                id: account.id,
                address: account.address || address,
                password: options.password,
                token: account.token || ""
            };
        } catch (error) {
            lastError = error;

            if (!isConflictError(error)) {
                break;
            }

            localPart = `${options.requestedLocalPart}${randomLocalPart(5)}`;
        }
    }

    return {
        ok: false,
        address: `${localPart}@${options.domain}`,
        password: options.password,
        error: lastError ? lastError.message : "create_failed"
    };
}

async function createMailtdAccountWithRetry(account) {
    const retryDelays = [0, 900, 1800, 3600, 6000];
    let lastError = null;

    for (let index = 0; index < retryDelays.length; index += 1) {
        if (retryDelays[index] > 0) {
            await delay(retryDelays[index]);
        }

        try {
            return await mailtdRequest("/api/accounts", {
                method: "POST",
                body: account
            });
        } catch (error) {
            lastError = error;

            if (!isRetriableMailtdError(error)) {
                throw error;
            }
        }
    }

    throw lastError;
}

async function mailtdRequest(path, options = {}) {
    const headers = {
        "Content-Type": "application/json"
    };

    if (options.authRequired !== false) {
        headers.Authorization = `Bearer ${options.token || MAILTD_API_TOKEN}`;
    }

    const response = await fetch(`${MAILTD_BASE_URL}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await readJsonResponse(response);

    if (!response.ok) {
        throw httpError(response.status, data.error || "mailtd_error", data.message || `Mail.td HTTP ${response.status}`);
    }

    return data;
}

async function readJsonResponse(response) {
    const text = await response.text();

    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return { message: text };
    }
}

function isRetriableMailtdError(error) {
    return error && (
        error.statusCode === 408 ||
        error.statusCode === 425 ||
        error.statusCode === 429 ||
        error.statusCode === 500 ||
        error.statusCode === 502 ||
        error.statusCode === 503 ||
        error.statusCode === 504
    );
}

function shouldTryMailboxFallback(error) {
    return error && (
        error.statusCode === 401 ||
        error.statusCode === 403 ||
        error.statusCode === 404
    );
}

function isConflictError(error) {
    return error && (
        error.statusCode === 409 ||
        error.statusCode === 422 ||
        String(error.message || "").toLowerCase().includes("exist") ||
        String(error.message || "").toLowerCase().includes("already")
    );
}

function resolveProviderFromEmail(email) {
    const domain = String(email || "").split("@").pop().toLowerCase();
    return isMailtdDomain(domain) ? "mailtd" : "firstmail";
}

function isMailtdDomain(domain) {
    return [
        "nqmo.com",
        "end.tw",
        "uuf.me",
        "6n9.net",
        "sugtbt.com",
        "qabq.com"
    ].includes(String(domain || "").toLowerCase());
}

function normalizeMessageArray(data) {
    data = unwrapApiPayload(data);

    if (Array.isArray(data)) return data;
    if (Array.isArray(data.messages)) return data.messages;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (data.message && typeof data.message === "object") return [data.message];
    if (data.id || data.subject || data.text_body || data.html_body || data.body_text || data.body_html || data.body) return [data];
    return [];
}

function normalizeMessageSummary(provider, message, options = {}) {
    message = unwrapMessagePayload(message);

    const id = String(message.id || message.message_id || message.messageId || message.uid || options.syntheticId || stableMessageId(message));
    const createdAt = message.created_at || message.createdAt || message.received_at || message.receivedAt || message.date || message.time || "";
    const from = message.from || message.sender || message.sender_email || message.from_email || "";
    const preview = message.preview_text || message.preview || message.snippet || message.text || message.text_body || message.body_text || message.body || message.body_html || "";

    return {
        id,
        provider,
        accountId: options.accountId || "",
        from,
        subject: message.subject || "(no subject)",
        preview: stripText(String(preview)).slice(0, 260),
        created_at: createdAt,
        is_read: Boolean(message.is_read || message.read),
        size: message.size || null,
        raw: message
    };
}

function stableMessageId(message) {
    const source = [
        message.subject || "",
        message.from || message.sender || "",
        message.created_at || message.createdAt || message.date || "",
        message.preview_text || message.preview || message.text_body || message.body || ""
    ].join("|");

    return crypto.createHash("sha1").update(source || JSON.stringify(message)).digest("hex").slice(0, 16);
}

function normalizeMessageDetail(provider, message) {
    message = unwrapMessagePayload(message);

    const summary = normalizeMessageSummary(provider, message);
    const text = message.text_body || message.textBody || message.body_text || message.text || message.body || message.content || "";
    const html = message.html_body || message.htmlBody || message.body_html || message.html || "";
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];

    return {
        ...summary,
        address: message.address || message.to || "",
        text_body: text || stripText(html),
        html_body: html,
        attachments,
        headers: message.headers || null,
        raw: message
    };
}

function unwrapApiPayload(data) {
    if (data && typeof data === "object" && data.success === true && data.data && typeof data.data === "object") {
        return data.data;
    }

    return data;
}

function unwrapMessagePayload(message) {
    let data = unwrapApiPayload(message);

    if (data && typeof data === "object" && data.raw && typeof data.raw === "object") {
        const raw = unwrapApiPayload(data.raw);
        if (raw && typeof raw === "object" && (
            raw.subject ||
            raw.from ||
            raw.body_html ||
            raw.body_text ||
            raw.html_body ||
            raw.text_body ||
            raw.messages
        )) {
            data = raw;
        }
    }

    return data || {};
}

function stripText(value) {
    return String(value || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function buildLocalPart(options) {
    if (options.count === 1 && options.prefix) {
        options.usedLocalParts.add(options.prefix);
        return options.prefix;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const localPart = options.prefix
            ? `${options.prefix}${randomLocalPart(8)}`
            : randomLocalPart(12);

        if (!options.usedLocalParts.has(localPart)) {
            options.usedLocalParts.add(localPart);
            return localPart;
        }
    }

    return `${options.prefix || "mail"}${Date.now().toString(36)}${options.index}`;
}

function normalizeAddress(value) {
    const address = String(value || "").trim().toLowerCase();
    const parts = address.split("@");

    if (parts.length !== 2 || !parts[0] || !normalizeDomain(parts[1])) {
        throw httpError(400, "invalid_email", "Invalid email address.");
    }

    return address;
}

function normalizeDomain(value) {
    const domain = String(value || "").trim().toLowerCase().replace(/^@/, "");

    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        throw httpError(400, "invalid_domain", "Invalid email domain.");
    }

    return domain;
}

function sanitizePrefix(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
}

function clampInteger(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.floor(number)));
}

function randomLocalPart(length) {
    return randomString("abcdefghijklmnopqrstuvwxyz0123456789", length);
}

function generatePassword() {
    return randomString("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%", 16);
}

function randomString(chars, length) {
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes, byte => chars[byte % chars.length]).join("");
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function httpError(statusCode, code, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function jsonResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
        },
        body: statusCode === 204 ? "" : JSON.stringify(body)
    };
}

function resolveLocalStaticPath(requestUrl) {
    const pathname = new URL(requestUrl, "http://127.0.0.1").pathname;
    const routeMap = {
        "/": "socks5QR.html",
        "/mailapi": "mailApi.html",
        "/mailApi": "mailApi.html",
        "/mailcreate": "mailCreate.html",
        "/mailCreate": "mailCreate.html",
        "/mailmanager": "mailManager.html",
        "/mailManager": "mailManager.html",
        "/mailview": "mailView.html",
        "/mailView": "mailView.html",
        "/boobar": "mailView.html",
        "/m": "mailView.html"
    };
    const mappedPath = routeMap[pathname] || pathname.replace(/^\/functions\//, "/").replace(/^\//, "");

    if (!mappedPath || mappedPath.includes("\0")) {
        return "";
    }

    const filePath = path.resolve(LOCAL_STATIC_ROOT, mappedPath);
    if (!filePath.startsWith(`${LOCAL_STATIC_ROOT}${path.sep}`) && filePath !== LOCAL_STATIC_ROOT) {
        return "";
    }

    return filePath;
}

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml; charset=utf-8"
    };

    return types[ext] || "application/octet-stream";
}

function serveLocalStatic(req, res) {
    const filePath = resolveLocalStaticPath(req.url);
    if (!filePath) {
        return false;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return false;
    }

    res.writeHead(200, {
        "Content-Type": getContentType(filePath),
        "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
}

if (require.main === module) {
    const server = http.createServer((req, res) => {
        Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === "GET" && serveLocalStatic(req, res)) {
            return;
        }

        if (req.method !== "POST" || req.url !== "/mail") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "not_found" }));
            return;
        }

        let body = "";
        req.on("data", chunk => {
            body += chunk;
        });

        req.on("end", async () => {
            try {
                const payload = JSON.parse(body || "{}");
                const data = await handleAction(payload);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(data));
            } catch (error) {
                res.writeHead(error.statusCode || 500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    error: error.code || "request_failed",
                    message: error.message
                }));
            }
        });
    });

    server.on("error", error => {
        if (error.code === "EADDRINUSE") {
            console.log("Mail proxy is already running on http://127.0.0.1:3000/mail");
            process.exit(0);
        }

        throw error;
    });

    server.listen(3000, () => {
        console.log("Mail proxy running: http://127.0.0.1:3000/mail");
    });
}
