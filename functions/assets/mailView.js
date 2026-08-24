const mailtdDomains = new Set(["nqmo.com", "end.tw", "uuf.me", "6n9.net", "sugtbt.com", "qabq.com"]);
const REFRESH_SECONDS = 15;

const state = {
    messages: [],
    selectedMessageId: "",
    loading: false,
    refreshTimer: null,
    countdownTimer: null,
    nextRefreshAt: 0
};

const els = {
    email: document.getElementById("viewEmail"),
    password: document.getElementById("viewPassword"),
    refresh: document.getElementById("refreshMailbox"),
    status: document.getElementById("viewStatus"),
    messageList: document.getElementById("singleMessageList"),
    messageDetail: document.getElementById("singleMessageDetail"),
    codeButton: document.getElementById("singleMailCode")
};

init();

function init() {
    const params = new URLSearchParams(location.search);
    const shortAccount = parseShortAccount(params.get("a"));
    els.email.value = shortAccount.email || params.get("e") || params.get("email") || "";
    els.password.value = shortAccount.password || params.get("p") || params.get("password") || params.get("pass") || params.get("pwd") || "";

    els.refresh.addEventListener("click", () => loadMailbox(true));
    els.codeButton.addEventListener("click", () => copyText(els.codeButton.textContent, els.codeButton));
    els.email.addEventListener("change", restartAutoRefresh);
    els.password.addEventListener("change", restartAutoRefresh);

    if (els.email.value.trim()) {
        loadMailbox(true);
        startAutoRefresh();
    } else {
        renderMessages([]);
        renderEmptyDetail("请在链接中传入 email 参数，或手动输入邮箱账号。");
        setStatus("等待邮箱账号。");
    }
}

function parseShortAccount(value) {
    if (!value) {
        return { email: "", password: "" };
    }

    const separatorIndex = value.indexOf("~");
    if (separatorIndex === -1) {
        return {
            email: decodeShortParam(value),
            password: ""
        };
    }

    return {
        email: decodeShortParam(value.slice(0, separatorIndex)),
        password: decodeShortParam(value.slice(separatorIndex + 1))
    };
}

function decodeShortParam(value) {
    try {
        return decodeURIComponent(value || "");
    } catch (error) {
        return value || "";
    }
}

async function loadMailbox(manual = false) {
    if (state.loading) return;

    const email = els.email.value.trim().toLowerCase();
    const password = els.password.value.trim();

    if (!email || !email.includes("@")) {
        setStatus("请输入正确的邮箱账号。");
        return;
    }

    state.loading = true;

    if (manual) {
        setBusy(true);
        setStatus("正在刷新邮件...", "success");
    }

    try {
        const data = await postMailProxy({
            action: "mailManagerMessages",
            provider: resolveProvider(email),
            email,
            password
        });

        const nextMessages = sortMessagesNewestFirst(Array.isArray(data.messages) ? data.messages : []);
        const hasChanged = getMessagesSignature(nextMessages) !== getMessagesSignature(state.messages);

        if (!manual && !hasChanged) {
            scheduleNextRefreshText();
            return;
        }

        state.messages = nextMessages;
        const hasSelected = state.messages.some(message => String(message.id) === state.selectedMessageId);
        state.selectedMessageId = hasSelected ? state.selectedMessageId : (state.messages[0] ? String(state.messages[0].id) : "");

        renderMessages(state.messages);

        if (state.selectedMessageId) {
            await selectMessage(state.selectedMessageId, false);
        } else {
            renderEmptyDetail("暂无邮件");
        }

        scheduleNextRefreshText();
    } catch (error) {
        if (manual) {
            renderMessages(state.messages);
            renderEmptyDetail(error.message || "邮件加载失败");
        }
        setStatus(`邮件加载失败：${error.message || "未知错误"}`);
    } finally {
        state.loading = false;

        if (manual) {
            setBusy(false);
        }
    }
}

async function selectMessage(messageId, updateList = true) {
    const message = state.messages.find(item => String(item.id) === String(messageId));
    if (!message) return;

    state.selectedMessageId = String(messageId);

    if (updateList) {
        renderMessages(state.messages);
    }

    renderEmptyDetail("正在加载邮件内容...");

    try {
        const detail = await postMailProxy({
            action: "mailManagerMessageDetail",
            provider: resolveProvider(els.email.value),
            email: els.email.value.trim().toLowerCase(),
            password: els.password.value.trim(),
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
        `To: ${message.address || els.email.value || "-"}`,
        `Time: ${formatMailTime(getMessageDate(message))}`
    ].join(" | ");

    els.messageDetail.appendChild(subject);
    els.messageDetail.appendChild(meta);

    const htmlBody = getMessageHtml(message);
    const textBody = getMessageText(message);
    renderVerificationCode(message);

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
}

function renderEmptyDetail(text) {
    els.messageDetail.className = "manager-detail empty-state";
    els.messageDetail.textContent = text;
    renderVerificationCode(null);
}

function renderVerificationCode(message) {
    const code = extractVerificationCode(message);
    els.codeButton.hidden = !code;
    els.codeButton.disabled = !code;
    els.codeButton.textContent = code || "";
    els.codeButton.classList.remove("copied");
}

function extractVerificationCode(message) {
    if (!message) return "";

    const content = [
        getMessageSubject(message),
        getMessagePreview(message),
        getMessageText(message),
        stripHtml(getMessageHtml(message))
    ].join("\n");

    const preferred = String(content).match(/(^|\D)(\d{6,8})(?!\d)/);
    if (preferred) return preferred[2];

    const fallback = String(content).match(/(^|\D)(\d{4,5})(?!\d)/);
    return fallback ? fallback[2] : "";
}

function startAutoRefresh() {
    clearInterval(state.refreshTimer);
    clearInterval(state.countdownTimer);

    state.nextRefreshAt = Date.now() + REFRESH_SECONDS * 1000;
    state.refreshTimer = setInterval(() => {
        state.nextRefreshAt = Date.now() + REFRESH_SECONDS * 1000;
        loadMailbox(false);
    }, REFRESH_SECONDS * 1000);
    state.countdownTimer = setInterval(scheduleNextRefreshText, 1000);
}

function restartAutoRefresh() {
    state.selectedMessageId = "";
    loadMailbox(true);
    startAutoRefresh();
}

function scheduleNextRefreshText() {
    if (!state.nextRefreshAt) return;
    const seconds = Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
    const count = state.messages.length;
    setStatus(`已加载 ${count} 封邮件，${seconds}s 后自动刷新。`, "success");
}

function getMessagesSignature(messages) {
    return messages
        .map(message => [
            message.id,
            getMessageSubject(message),
            getMessageDate(message)
        ].map(value => String(value || "")).join("|"))
        .join("\n");
}

function sortMessagesNewestFirst(messages) {
    return [...messages].sort((left, right) => getMessageTimeValue(right) - getMessageTimeValue(left));
}

function getMessageTimeValue(message) {
    const value = getMessageDate(message);
    const time = value ? new Date(value).getTime() : 0;
    return Number.isNaN(time) ? 0 : time;
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

function resolveProvider(email) {
    const domain = String(email || "").split("@").pop().toLowerCase();
    return mailtdDomains.has(domain) ? "mailtd" : "firstmail";
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

function setBusy(busy) {
    els.refresh.disabled = busy;
    els.refresh.textContent = busy ? "刷新中..." : "刷新邮件";
}

function setStatus(text, type = "error") {
    els.status.textContent = text;
    els.status.classList.toggle("success", type === "success");
}

async function copyText(text, button) {
    if (!text || button.disabled) return;

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
