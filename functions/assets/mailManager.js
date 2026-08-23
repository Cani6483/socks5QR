const mailtdDomains = new Set(["nqmo.com", "end.tw", "uuf.me", "6n9.net", "sugtbt.com", "qabq.com"]);

const state = {
    accounts: [],
    selectedAccountIndex: -1,
    selectedMessageId: ""
};

const els = {
    accountInput: document.getElementById("accountInput"),
    loadAccounts: document.getElementById("loadAccounts"),
    generateApiLinks: document.getElementById("generateManagerApiLinks"),
    copyApiLinks: document.getElementById("copyManagerApiLinks"),
    apiLinks: document.getElementById("managerApiLinks"),
    managerStatus: document.getElementById("managerStatus"),
    accountList: document.getElementById("accountList"),
    messageList: document.getElementById("messageList"),
    messageDetail: document.getElementById("messageDetail")
};

els.loadAccounts.addEventListener("click", loadAccounts);
els.generateApiLinks.addEventListener("click", generateApiLinks);
els.copyApiLinks.addEventListener("click", copyApiLinks);

async function loadAccounts() {
    const accounts = parseMailboxLines(els.accountInput.value).map((account, index) => ({
        ...account,
        index,
        provider: resolveProvider(account.email),
        status: "ready",
        messages: [],
        error: ""
    }));

    state.accounts = accounts;
    state.selectedAccountIndex = -1;
    state.selectedMessageId = "";

    renderAccounts();
    renderMessages([]);
    renderEmptyDetail("请选择左侧账号");
    renderApiLinks(accounts);

    if (!accounts.length) {
        setStatus("请输入邮箱账号和密码，一行一个。");
        return;
    }

    setStatus(`已加载 ${accounts.length} 个账号。`, "success");
}

async function selectAccount(index) {
    const account = state.accounts[index];
    if (!account) return;

    state.selectedAccountIndex = index;
    state.selectedMessageId = "";
    account.status = "loading";
    account.error = "";
    renderAccounts();
    renderMessages([]);
    renderEmptyDetail("正在加载邮件...");

    try {
        const data = await postMailProxy({
            action: "mailManagerMessages",
            provider: account.provider,
            email: account.email,
            password: account.password
        });

        account.messages = Array.isArray(data.messages) ? data.messages : [];
        account.status = "loaded";
        setStatus(`${account.email} 加载完成：${account.messages.length} 封邮件。`, "success");
        renderAccounts();
        renderMessages(account.messages);
        renderEmptyDetail(account.messages.length ? "请选择中间邮件" : "暂无邮件");
    } catch (error) {
        account.status = "failed";
        account.error = error.message || "加载失败";
        renderAccounts();
        renderMessages([]);
        renderEmptyDetail(account.error);
        setStatus(`${account.email} 加载失败：${account.error}`);
    }
}

async function selectMessage(messageId) {
    const account = state.accounts[state.selectedAccountIndex];
    if (!account) return;

    const message = account.messages.find(item => String(item.id) === String(messageId));
    if (!message) return;

    state.selectedMessageId = String(messageId);
    renderMessages(account.messages);
    renderEmptyDetail("正在加载邮件详情...");

    try {
        const detail = await postMailProxy({
            action: "mailManagerMessageDetail",
            provider: account.provider,
            email: account.email,
            password: account.password,
            messageId: message.id,
            message
        });
        renderDetail(detail);
    } catch (error) {
        renderDetail({
            ...message,
            text_body: error.message || "邮件详情加载失败"
        });
    }
}

function renderAccounts() {
    els.accountList.innerHTML = "";

    state.accounts.forEach((account, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `manager-list-item account-list-item ${index === state.selectedAccountIndex ? "active" : ""}`;
        button.addEventListener("click", () => selectAccount(index));

        const number = document.createElement("span");
        number.className = "manager-index-badge";
        number.textContent = String(index + 1);

        const content = document.createElement("div");
        content.className = "manager-list-content";

        const title = document.createElement("strong");
        title.textContent = account.email;

        const meta = document.createElement("span");
        meta.textContent = `${account.provider === "mailtd" ? "Mail.td" : "firstmail"} · ${getAccountStatusText(account)}`;

        content.appendChild(title);
        content.appendChild(meta);
        button.appendChild(number);
        button.appendChild(content);
        els.accountList.appendChild(button);
    });
}

function renderMessages(messages) {
    els.messageList.innerHTML = "";

    if (!messages.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "暂无邮件";
        els.messageList.appendChild(empty);
        return;
    }

    messages.forEach(message => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `manager-list-item ${String(message.id) === state.selectedMessageId ? "active" : ""}`;
        button.addEventListener("click", () => selectMessage(message.id));

        const title = document.createElement("strong");
        title.textContent = getMessageSubject(message);

        const meta = document.createElement("span");
        meta.textContent = `${formatMailTime(getMessageDate(message))} · ${getMessageFrom(message)}`;

        const preview = document.createElement("small");
        preview.textContent = getMessagePreview(message);

        button.appendChild(title);
        button.appendChild(meta);
        button.appendChild(preview);
        els.messageList.appendChild(button);
    });
}

function renderDetail(message) {
    els.messageDetail.classList.remove("empty-state");
    els.messageDetail.innerHTML = "";

    const subject = document.createElement("h2");
    subject.textContent = getMessageSubject(message);

    const meta = document.createElement("div");
    meta.className = "manager-detail-meta";
    meta.textContent = [
        `From: ${getMessageFrom(message)}`,
        `To: ${message.address || "-"}`,
        `Time: ${formatMailTime(getMessageDate(message))}`
    ].join(" | ");

    els.messageDetail.appendChild(subject);
    els.messageDetail.appendChild(meta);

    const htmlBody = getMessageHtml(message);
    const textBody = getMessageText(message);

    if (htmlBody) {
        const frame = document.createElement("iframe");
        frame.className = "manager-detail-frame";
        frame.setAttribute("sandbox", "");
        frame.srcdoc = htmlBody;
        els.messageDetail.appendChild(frame);
    } else {
        const body = document.createElement("pre");
        body.className = "manager-detail-body";
        body.textContent = textBody || getMessagePreview(message);
        els.messageDetail.appendChild(body);
    }

    if (message.attachments && message.attachments.length) {
        const attachments = document.createElement("div");
        attachments.className = "manager-attachments";
        attachments.textContent = `附件：${message.attachments.map(item => item.filename || item.name || `#${item.index}`).join(", ")}`;
        els.messageDetail.appendChild(attachments);
    }
}

function renderEmptyDetail(text) {
    els.messageDetail.className = "manager-detail empty-state";
    els.messageDetail.textContent = text;
}

function generateApiLinks() {
    const accounts = getApiLinkAccounts();
    renderApiLinks(accounts);

    if (!accounts.length) {
        setStatus("请输入邮箱账号和密码，一行一个。");
        return;
    }

    setStatus(`已生成 ${accounts.length} 个API链接。`, "success");
}

async function copyApiLinks() {
    let links = getRenderedApiLinks();

    if (!links.length) {
        const accounts = getApiLinkAccounts();
        renderApiLinks(accounts);
        links = getRenderedApiLinks();
    }

    if (!links.length) {
        setStatus("没有可复制的API链接。");
        return;
    }

    await copyText(links.join("\n"), els.copyApiLinks);
    setStatus(`已复制 ${links.length} 个API链接。`, "success");
}

function getApiLinkAccounts() {
    return state.accounts.length ? state.accounts : parseMailboxLines(els.accountInput.value);
}

function getRenderedApiLinks() {
    return Array.from(els.apiLinks.querySelectorAll(".api-link-item"))
        .map(item => item.dataset.link || "")
        .filter(Boolean);
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

function getAccountStatusText(account) {
    if (account.status === "loading") return "加载中";
    if (account.status === "loaded") return `${account.messages.length} 封`;
    if (account.status === "failed") return "失败";
    return "待加载";
}

function getMessageData(message) {
    if (!message || typeof message !== "object") return {};

    if (message.raw && typeof message.raw === "object") {
        if (message.raw.success === true && message.raw.data && typeof message.raw.data === "object") {
            return message.raw.data;
        }

        if (message.raw.subject || message.raw.from || message.raw.body_html || message.raw.body_text) {
            return message.raw;
        }
    }

    if (message.success === true && message.data && typeof message.data === "object") {
        return message.data;
    }

    return message;
}

function getMessageSubject(message) {
    const data = getMessageData(message);
    return data.subject || message.subject || "(无主题)";
}

function getMessageFrom(message) {
    const data = getMessageData(message);
    return data.from || data.sender || message.from || message.sender || "-";
}

function getMessageDate(message) {
    const data = getMessageData(message);
    return data.created_at || data.createdAt || data.date || data.time || message.created_at || message.createdAt || message.date || message.time || "";
}

function getMessageHtml(message) {
    const data = getMessageData(message);
    return data.html_body || data.htmlBody || data.body_html || data.html || message.html_body || message.htmlBody || message.body_html || message.html || "";
}

function getMessageText(message) {
    const data = getMessageData(message);
    return data.text_body || data.textBody || data.body_text || data.text || data.body || data.content || message.text_body || message.textBody || message.body_text || message.text || message.body || message.content || "";
}

function getMessagePreview(message) {
    const data = getMessageData(message);
    return data.preview || data.preview_text || message.preview || message.preview_text || stripHtml(getMessageHtml(message)) || getMessageText(message) || "";
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

function parseMailboxLines(text) {
    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const parts = line.split(/\s*(?:----|\||,|\t|\s)\s*/).filter(Boolean);
            return {
                email: parts[0] || "",
                password: parts.slice(1).join(" ") || ""
            };
        })
        .filter(item => item.email.includes("@"));
}

function resolveProvider(email) {
    const domain = String(email || "").split("@").pop().toLowerCase();
    return mailtdDomains.has(domain) ? "mailtd" : "firstmail";
}

function formatMailTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stripHtml(html) {
    const node = document.createElement("div");
    node.innerHTML = html;
    return node.textContent || node.innerText || "";
}

function setStatus(text, type = "error") {
    els.managerStatus.textContent = text;
    els.managerStatus.classList.toggle("success", type === "success");
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
