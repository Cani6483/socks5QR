const MAIL_CODE_VALID_MS = 30 * 60 * 1000;
const mailtdDomains = new Set(["nqmo.com"]);

const els = {
    mailInput: document.getElementById("mailInput"),
    mailProvider: document.getElementById("mailProvider"),
    codeStatus: document.getElementById("codeStatus"),
    fetchCodes: document.getElementById("fetchCodes"),
    copyApiLinks: document.getElementById("copyApiLinks"),
    copyCodes: document.getElementById("copyCodes"),
    codeResults: document.getElementById("codeResults")
};

els.fetchCodes.addEventListener("click", fetchCodes);
els.copyApiLinks.addEventListener("click", copyApiLinks);
els.copyCodes.addEventListener("click", copyCodes);
loadMailtdDomains();

async function fetchCodes() {
    setStatus(els.codeStatus, "");
    els.codeResults.innerHTML = "";

    const accounts = parseMailboxLines(els.mailInput.value);
    if (!accounts.length) {
        setStatus(els.codeStatus, "Please enter email and password, one per line.");
        return;
    }

    setBusy(els.fetchCodes, true, "加载中...");

    try {
        const rows = accounts.map((account, index) => {
            const provider = resolveProvider(account.email);
            return {
                account,
                provider,
                row: appendCodeResult(els.codeResults, index + 1, account.email, account.password, provider, "加载中...", "-")
            };
        });

        await Promise.all(rows.map(item => refreshCodeRow(item.row, item.account.email, item.account.password, item.provider)
            .catch(error => {
                item.row.codeBtn.textContent = error.message || "Failed";
                item.row.codeBtn.classList.remove("loading");
                item.row.refreshBtn.disabled = false;
                item.row.refreshBtn.textContent = "刷新";
            })));
    } finally {
        setBusy(els.fetchCodes, false, "获取邮件验证码");
    }
}

async function copyApiLinks() {
    const accounts = parseMailboxLines(els.mailInput.value);

    if (!accounts.length) {
        setStatus(els.codeStatus, "请输入邮箱账号和密码，一行一个。");
        return;
    }

    const links = accounts.map(account => buildMailViewUrl(account.email, account.password));
    await copyText(links.join("\n"), els.copyApiLinks);
    setStatus(els.codeStatus, `已复制 ${links.length} 个API链接。`, "success");
}

async function copyCodes() {
    const codes = Array.from(els.codeResults.querySelectorAll(".mail-code"))
        .map(button => ({
            index: button.dataset.index || "",
            code: button.textContent.trim()
        }))
        .filter(item => item.index && /^\d+$/.test(item.code));

    if (!codes.length) {
        setStatus(els.codeStatus, "暂无可复制的验证码。");
        return;
    }

    const text = codes.map(item => `${item.index}. ${item.code}`).join("\n");
    await copyText(text, els.copyCodes);
    setStatus(els.codeStatus, `已复制 ${codes.length} 个验证码。`, "success");
}

async function loadMailtdDomains() {
    try {
        const data = await postMailProxy({ action: "domains" });
        const domains = Array.isArray(data.domains) ? data.domains : [];
        domains
            .filter(item => item && item.domain && item.is_active !== false)
            .forEach(item => mailtdDomains.add(normalizeDomain(item.domain)));
    } catch (error) {
        mailtdDomains.add("nqmo.com");
    }
}

async function postMailProxy(payload) {
    const response = await fetch(getMailProxyUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data;

    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        data = { error: text || `HTTP ${response.status}` };
    }

    if (!response.ok || data.error) {
        throw new Error(getMailErrorMessage(response.status, data));
    }

    return data;
}

function getMailErrorMessage(status, data) {
    const message = data.message || data.error || `HTTP ${status}`;
    return status === 401 || String(message).includes("HTTP 401") ? "账号密码错误" : message;
}

function getMailProxyUrl() {
    const isNetlifyDev = location.hostname === "localhost" && location.port === "8888";
    const isLocalPage = location.protocol === "file:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";

    if (isNetlifyDev || !isLocalPage) {
        return "/.netlify/functions/mailProxy";
    }

    return "http://127.0.0.1:3000/mail";
}

function buildMailViewUrl(email, password) {
    const isLocalPage = location.protocol === "file:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";
    const path = isLocalPage ? "./mailView.html" : "/m";
    const account = password
        ? `${encodeShortParam(email)}~${encodeShortParam(password)}`
        : encodeShortParam(email);
    const url = new URL(path, location.href);
    url.search = `?a=${account}`;

    return url.href;
}

function encodeShortParam(value) {
    return encodeURIComponent(value).replace(/%40/g, "@");
}

function parseMailboxLines(text) {
    const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const accounts = [];

    for (let index = 0; index < lines.length; index += 1) {
        const parts = splitMailboxLine(lines[index]);
        const email = normalizeEmailAddress(parts[0]);
        let password = parts.slice(1).join(" ") || "";

        if (!email.includes("@")) {
            continue;
        }

        if (!password && index + 1 < lines.length) {
            const nextParts = splitMailboxLine(lines[index + 1]);
            const nextEmail = normalizeEmailAddress(nextParts[0]);

            if (!nextEmail.includes("@")) {
                password = lines[index + 1].trim();
                index += 1;
            }
        }

        if (shouldSkipMailboxEmail(email)) {
            continue;
        }

        accounts.push({ email, password });
    }

    return accounts;
}

function splitMailboxLine(line) {
    return String(line || "")
        .replace(/\\@/g, "@")
        .split(/\s*(?:----|\||,|\t|\s)\s*/)
        .filter(Boolean);
}

function normalizeEmailAddress(value) {
    return String(value || "").trim().replace(/\\@/g, "@");
}

function shouldSkipMailboxEmail(email) {
    return getEmailDomain(email) === "kakao.com";
}

function resolveProvider(email) {
    return mailtdDomains.has(getEmailDomain(email)) ? "mailtd" : "firstmail";
}

function getEmailDomain(email) {
    return normalizeDomain(String(email || "").split("@").pop() || "");
}

function normalizeDomain(domain) {
    return String(domain || "").trim().toLowerCase().replace(/^@/, "");
}

function extractMailMessage(responseText) {
    let content = responseText;
    let receivedAt = null;

    try {
        const data = JSON.parse(responseText);
        if (data && data.empty) {
            return { code: "未获取到邮件", receivedAt: null };
        }

        content = collectText(data).join("\n");
        receivedAt = findMailTime(data) || extractMailHeaderTime(content);
    } catch (error) {
        receivedAt = extractMailHeaderTime(content);
    }

    const match = String(content).match(/(^|\D)(\d{8})(?!\d)/);
    const code = getValidMailCode(match ? match[2] : "", receivedAt);

    return {
        code,
        receivedAt: receivedAt || null
    };
}

function collectText(value) {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(collectText);
    if (value && typeof value === "object") return Object.values(value).flatMap(collectText);
    return [];
}

function findMailTime(value) {
    const timeKeys = [
        "receivedAt",
        "received_at",
        "receivedDate",
        "received_date",
        "arrivalTime",
        "arrival_time",
        "sentAt",
        "sent_at",
        "createdAt",
        "created_at",
        "date",
        "time",
        "timestamp"
    ];

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findMailTime(item);
            if (found) return found;
        }
    }

    if (value && typeof value === "object") {
        for (const key of timeKeys) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                const date = parseMailTime(value[key]);
                if (date) return date;
            }
        }

        for (const item of Object.values(value)) {
            const found = findMailTime(item);
            if (found) return found;
        }
    }

    return null;
}

function parseMailTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    if (typeof value === "number") {
        const time = value < 10000000000 ? value * 1000 : value;
        const date = new Date(time);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "string" && value.trim()) {
        const text = value.trim();
        if (/^\d+$/.test(text)) return parseMailTime(Number(text));
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
}

function extractMailHeaderTime(text) {
    const dateHeader = String(text).match(/(?:^|\n)Date:\s*([^\n\r]+)/i);
    if (dateHeader) return parseMailTime(dateHeader[1]);
    const receivedHeader = String(text).match(/(?:^|\n)Received:[\s\S]*?;\s*([^\n\r]+)/i);
    return receivedHeader ? parseMailTime(receivedHeader[1]) : null;
}

function getValidMailCode(code, receivedAt) {
    if (!code) return "No code";
    if (!receivedAt) return "Invalid time";
    return isMailCodeValid(receivedAt) ? code : "验证码已失效";
}

function isMailCodeValid(receivedAt) {
    const date = parseMailTime(receivedAt);
    if (!date) return false;
    const age = Date.now() - date.getTime();
    return age >= 0 && age <= MAIL_CODE_VALID_MS;
}

async function refreshCodeRow(row, email, password, provider) {
    row.refreshBtn.disabled = true;
    row.refreshBtn.textContent = "加载";
    row.codeBtn.textContent = "加载中...";
    row.codeBtn.classList.add("loading");

    try {
        const selectedProvider = provider || resolveProvider(email);
        const data = await postMailProxy({
            action: selectedProvider === "mailtd" ? "mailtdLatest" : "firstmailLatest",
            email,
            password
        });
        const message = extractMailMessage(JSON.stringify(data));
        setMailCode(row.timeEl, row.codeBtn, message);
    } finally {
        row.codeBtn.classList.remove("loading");
        row.refreshBtn.disabled = false;
        row.refreshBtn.textContent = "刷新";
    }
}

function appendCodeResult(container, index, account, password, provider, code, time) {
    const row = document.createElement("div");
    row.className = "mail-result";

    const apiLink = buildMailViewUrl(account, password);
    const accountEl = document.createElement("button");
    accountEl.type = "button";
    accountEl.className = "mail-account";
    accountEl.title = apiLink;
    accountEl.textContent = `${index}. ${account} (${provider === "mailtd" ? "Mail.td" : "firstmail"})`;
    accountEl.addEventListener("click", () => copyText(apiLink, accountEl));

    const timeEl = document.createElement("div");
    timeEl.className = "mail-time";
    timeEl.textContent = time;

    const codeBtn = document.createElement("button");
    codeBtn.type = "button";
    codeBtn.className = "mail-code";
    codeBtn.dataset.index = String(index);
    codeBtn.textContent = code;
    codeBtn.addEventListener("click", () => copyText(codeBtn.textContent, codeBtn));

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "mail-refresh";
    refreshBtn.textContent = "刷新";
    refreshBtn.title = "Refresh this mailbox only";
    refreshBtn.addEventListener("click", async () => {
        try {
            await refreshCodeRow({ timeEl, codeBtn, refreshBtn }, account, password, resolveProvider(account));
        } catch (error) {
            codeBtn.textContent = error.message || "Failed";
            codeBtn.classList.remove("loading");
            refreshBtn.disabled = false;
            refreshBtn.textContent = "刷新";
        }
    });

    row.appendChild(accountEl);
    row.appendChild(timeEl);
    row.appendChild(codeBtn);
    row.appendChild(refreshBtn);
    container.appendChild(row);

    return { row, timeEl, codeBtn, refreshBtn };
}

function setMailCode(timeElement, button, message) {
    timeElement.textContent = formatMailTime(message.receivedAt);
    button.textContent = message.code || "No code";
}

function formatMailTime(value) {
    const date = parseMailTime(value);
    if (!date) return "-";
    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function setBusy(button, busy, text) {
    button.disabled = busy;
    button.textContent = text;
}

function setStatus(element, text, type = "error") {
    element.textContent = text;
    element.classList.toggle("success", type === "success");
}

async function copyText(text, button) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (error) {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
    }

    const oldText = button.textContent;
    button.textContent = "已复制";
    button.classList.add("copied");

    setTimeout(() => {
        button.textContent = oldText;
        button.classList.remove("copied");
    }, 1200);
}
