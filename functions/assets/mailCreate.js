const mailtdDomains = new Set(["nqmo.com"]);

const els = {
    loadDomains: document.getElementById("loadDomains"),
    domain: document.getElementById("domain"),
    createCount: document.getElementById("createCount"),
    prefix: document.getElementById("prefix"),
    fixedPassword: document.getElementById("fixedPassword"),
    createAccounts: document.getElementById("createAccounts"),
    createStatus: document.getElementById("createStatus"),
    createOutput: document.getElementById("createOutput"),
    copyCreated: document.getElementById("copyCreated"),
    generateApiLinks: document.getElementById("generateApiLinks"),
    apiLinks: document.getElementById("apiLinks")
};

const createdAccounts = [];

els.loadDomains.addEventListener("click", loadDomains);
els.createAccounts.addEventListener("click", createAccounts);
els.copyCreated.addEventListener("click", () => copyText(els.createOutput.value, els.copyCreated));
els.generateApiLinks.addEventListener("click", generateApiLinks);

loadDomains();

async function loadDomains() {
    setBusy(els.loadDomains, true, "Loading");

    try {
        const data = await postMailProxy({ action: "domains" });
        const domains = Array.isArray(data.domains) ? data.domains : [];
        const current = els.domain.value || "nqmo.com";
        els.domain.innerHTML = "";
        mailtdDomains.clear();

        appendDomainOption("nqmo.com");

        domains
            .filter(item => item && item.domain && item.is_active !== false)
            .forEach(item => appendDomainOption(item.domain, item.pro_only));

        els.domain.value = Array.from(els.domain.options).some(option => option.value === current) ? current : "nqmo.com";
    } catch (error) {
        setStatus(els.createStatus, error.message || "Domain load failed");
    } finally {
        setBusy(els.loadDomains, false, "刷新域名");
    }
}

function appendDomainOption(domain, proOnly = false) {
    const normalized = normalizeDomain(domain);
    if (!normalized || mailtdDomains.has(normalized)) return;

    mailtdDomains.add(normalized);

    const option = document.createElement("option");
    option.value = normalized;
    option.textContent = proOnly ? `@${normalized} (Pro)` : `@${normalized}`;
    els.domain.appendChild(option);
}

async function createAccounts() {
    setStatus(els.createStatus, "");
    els.createOutput.value = "";
    createdAccounts.length = 0;
    renderApiLinks([]);

    const domain = (els.domain.value || "nqmo.com").trim();
    const count = readNumber(els.createCount, 1, 200);
    const prefix = sanitizePrefix(els.prefix.value);
    const fixedPassword = els.fixedPassword.value.trim();
    const usedLocalParts = new Set();
    let okCount = 0;
    let failCount = 0;

    setBusy(els.createAccounts, true, "Creating...");

    try {
        for (let index = 0; index < count; index += 1) {
            const password = fixedPassword || generatePassword();
            const localPart = buildLocalPart(count, index, prefix, usedLocalParts);

            setStatus(els.createStatus, `Creating ${index + 1}/${count}...`, "success");

            const result = await createOneWithRetry({
                domain,
                password,
                localPart,
                canChangeLocalPart: !(count === 1 && prefix)
            });

            if (result.ok) {
                okCount += 1;
                createdAccounts.push({
                    email: result.address,
                    password: result.password
                });
                appendOutputLine(`${result.address} ${result.password}`);
                renderApiLinks(createdAccounts);
            } else {
                failCount += 1;
                appendOutputLine(`FAILED ${result.address} ${result.password} ${result.error || "unknown_error"}`);
            }

            setStatus(els.createStatus, `创建成功 ${okCount}/${count}, 失败 ${failCount}.`, failCount ? "error" : "success");
        }
    } finally {
        setBusy(els.createAccounts, false, "创建邮箱");
    }
}

async function createOneWithRetry(options) {
    const maxAddressAttempts = options.canChangeLocalPart ? 8 : 1;
    let localPart = options.localPart;
    let lastError = null;

    for (let attempt = 0; attempt < maxAddressAttempts; attempt += 1) {
        const address = `${localPart}@${options.domain}`;

        try {
            const data = await postMailProxy({
                action: "createAccount",
                address,
                password: options.password
            });

            return {
                ok: true,
                address: data.address || address,
                password: options.password
            };
        } catch (error) {
            lastError = error;

            if (!isConflictError(error) || !options.canChangeLocalPart) {
                break;
            }

            localPart = `${options.localPart}${randomLocalPart(5)}`;
        }
    }

    return {
        ok: false,
        address: `${localPart}@${options.domain}`,
        password: options.password,
        error: lastError ? lastError.message : "create_failed"
    };
}

function appendOutputLine(line) {
    els.createOutput.value = els.createOutput.value
        ? `${els.createOutput.value}\n${line}`
        : line;
    els.createOutput.scrollTop = els.createOutput.scrollHeight;
}

function generateApiLinks() {
    const accounts = createdAccounts.length ? createdAccounts : parseOutputAccounts();
    renderApiLinks(accounts);

    if (!accounts.length) {
        setStatus(els.createStatus, "没有可生成链接的邮箱账号。");
        return;
    }

    setStatus(els.createStatus, `已生成 ${accounts.length} 个API链接。`, "success");
}

function renderApiLinks(accounts) {
    els.apiLinks.innerHTML = "";

    if (!accounts.length) {
        return;
    }

    accounts.forEach((account, index) => {
        const item = document.createElement("button");
        const link = buildMailViewUrl(account.email, account.password);
        item.type = "button";
        item.className = "api-link-item";
        item.dataset.link = link;
        item.textContent = `${index + 1}. ${link}`;
        item.addEventListener("click", () => copyText(link, item));
        els.apiLinks.appendChild(item);
    });
}

function parseOutputAccounts() {
    return els.createOutput.value
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith("FAILED "))
        .map(line => {
            const parts = line.split(/\s+/).filter(Boolean);
            return {
                email: parts[0] || "",
                password: parts.slice(1).join(" ") || ""
            };
        })
        .filter(item => item.email.includes("@"));
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
        const error = new Error(data.message || data.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return data;
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

function buildLocalPart(count, index, prefix, usedLocalParts) {
    if (count === 1 && prefix) {
        usedLocalParts.add(prefix);
        return prefix;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
        const localPart = prefix
            ? `${prefix}${randomLocalPart(8)}`
            : randomLocalPart(12);

        if (!usedLocalParts.has(localPart)) {
            usedLocalParts.add(localPart);
            return localPart;
        }
    }

    return `${prefix || "mail"}${Date.now().toString(36)}${index}`;
}

function isConflictError(error) {
    const message = String(error && error.message ? error.message : "").toLowerCase();
    return error && (
        error.status === 409 ||
        error.status === 422 ||
        message.includes("exist") ||
        message.includes("already")
    );
}

function readNumber(input, min, max) {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeDomain(domain) {
    return String(domain || "").trim().toLowerCase().replace(/^@/, "");
}

function sanitizePrefix(value) {
    return (value || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
}

function randomLocalPart(length) {
    return randomString("abcdefghijklmnopqrstuvwxyz0123456789", length);
}

function generatePassword() {
    return randomString("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%", 10);
}

function randomString(chars, length) {
    const bytes = new Uint32Array(length);
    if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, value => chars[value % chars.length]).join("");
    }
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
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
    if (!text) return;

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
