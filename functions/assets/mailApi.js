const MAIL_CODE_VALID_MS = 30 * 60 * 1000;

document.getElementById("generate").addEventListener("click", async function() {
    const input = document.getElementById("input").value.trim();
    const errorDiv = document.getElementById("error");
    const mailCodeDiv = document.getElementById("mailCode");
    const format = document.getElementById("format");
    const sel = format.options[format.selectedIndex].value;

    errorDiv.textContent = "";
    mailCodeDiv.innerHTML = "";

    const lines = input.split(/\r?\n/);

    let resultIndex = 0;

    for (const line of lines) {
        const text = line.trim();
        if (!text) continue;

        const parts = text.replace(/\s+/g, " ").split(/[:|/\t ]/).filter(Boolean);
        if (parts.length < 2) {
            errorDiv.textContent = "Invalid format: email password, one per line";
            continue;
        }

        const [account, password] = parts;
        resultIndex += 1;

        const result = appendMailResult(mailCodeDiv, resultIndex, account, password, "获取中...");
        result.codeBtn.classList.add("loading");

        if (sel === "firstmail") {
            getFirstMailLatestMessage(account, password).then(function(message) {
                setMailMessage(result.timeEl, result.codeBtn, message);
                result.codeBtn.classList.remove("loading");
            }).catch(function() {
                result.codeBtn.textContent = "获取失败";
                result.codeBtn.classList.remove("loading");
            });
        }
    }
});

async function getFirstMailLatestMessage(account, password) {
    const data = {
        email: account,
        password: password,
        folder: "INBOX"
    };

    try {
        const response = await fetch(getMailProxyUrl(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const text = await response.text();

        if (response.status === 404) {
            return {
                code: "未收到邮件",
                receivedAt: null
            };
        }

        if (!response.ok) {
            return {
                code: `HTTP ${response.status}`,
                receivedAt: null
            };
        }

        return extractMailMessage(text);
    } catch (error) {
        return {
            code: "Request failed",
            receivedAt: null
        };
    }
}

function getMailProxyUrl() {
    const isNetlifyDev = location.hostname === "localhost" && location.port === "8888";
    const isLocalPage = location.protocol === "file:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";

    if (isNetlifyDev || !isLocalPage) {
        return "/.netlify/functions/mailProxy";
    }

    return "http://127.0.0.1:3000/mail/latest";
}

function extractMailMessage(responseText) {
    let content = responseText;
    let receivedAt = null;

    try {
        const data = JSON.parse(responseText);
        if (data && data.empty) {
            return {
                code: "未收到邮件",
                receivedAt: null
            };
        }

        content = collectText(data).join("\n");
        receivedAt = findMailTime(data) || extractMailHeaderTime(content);
    } catch (e) {
        content = responseText;
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
    if (typeof value === "string") {
        return [value];
    }

    if (Array.isArray(value)) {
        return value.flatMap(collectText);
    }

    if (value && typeof value === "object") {
        return Object.values(value).flatMap(collectText);
    }

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
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    if (typeof value === "number") {
        const time = value < 10000000000 ? value * 1000 : value;
        const date = new Date(time);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "string" && value.trim()) {
        const text = value.trim();
        if (/^\d+$/.test(text)) {
            return parseMailTime(Number(text));
        }

        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
}

function extractMailHeaderTime(text) {
    const dateHeader = String(text).match(/(?:^|\n)Date:\s*([^\n\r]+)/i);
    if (dateHeader) {
        return parseMailTime(dateHeader[1]);
    }

    const receivedHeader = String(text).match(/(?:^|\n)Received:[\s\S]*?;\s*([^\n\r]+)/i);
    return receivedHeader ? parseMailTime(receivedHeader[1]) : null;
}

function getValidMailCode(code, receivedAt) {
    if (!code) {
        return "No code";
    }

    if (!receivedAt) {
        return "时间无效";
    }

    return isMailCodeValid(receivedAt) ? code : "验证码已过期";
}

function isMailCodeValid(receivedAt) {
    const date = parseMailTime(receivedAt);
    if (!date) return false;

    const age = Date.now() - date.getTime();
    return age >= 0 && age <= MAIL_CODE_VALID_MS;
}

function formatMailTime(value) {
    const date = parseMailTime(value);
    if (!date) return "-";

    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function setMailMessage(timeElement, button, message) {
    const code = typeof message === "string" ? message : message.code;
    const receivedAt = typeof message === "string" ? null : message.receivedAt;
    timeElement.textContent = formatMailTime(receivedAt);
    button.textContent = code || "No code";
}

function appendMailResult(container, index, account, password, code) {
    const row = document.createElement("div");
    row.className = "mail-result";

    const accountEl = document.createElement("div");
    accountEl.className = "mail-account";
    accountEl.textContent = `${index}. ${account}`;

    const timeEl = document.createElement("div");
    timeEl.className = "mail-time";
    timeEl.textContent = "-";

    const codeBtn = document.createElement("button");
    codeBtn.type = "button";
    codeBtn.className = "mail-code";
    codeBtn.textContent = code;
    codeBtn.title = "Click to copy";

    codeBtn.addEventListener("click", function() {
        copyText(codeBtn.textContent, codeBtn);
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "mail-refresh";
    refreshBtn.textContent = "刷新";
    refreshBtn.title = "只刷新这个邮箱";

    refreshBtn.addEventListener("click", async function() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = "获取中";
        codeBtn.textContent = "...";
        codeBtn.classList.add("loading");

        const newMessage = await getFirstMailLatestMessage(account, password);
        setMailMessage(timeEl, codeBtn, newMessage);
        codeBtn.classList.remove("loading");

        refreshBtn.disabled = false;
        refreshBtn.textContent = "刷新";
    });

    row.appendChild(accountEl);
    row.appendChild(timeEl);
    row.appendChild(codeBtn);
    row.appendChild(refreshBtn);
    container.appendChild(row);

    return {
        row,
        timeEl,
        codeBtn,
        refreshBtn
    };
}

async function copyText(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        showCopied(button);
    } catch (error) {
        const input = document.createElement("textarea");
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
        showCopied(button);
    }
}

function showCopied(button) {
    const oldText = button.textContent;
    button.textContent = "已复制";
    button.classList.add("copied");

    setTimeout(function() {
        button.textContent = oldText;
        button.classList.remove("copied");
    }, 1200);
}
