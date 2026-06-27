document.getElementById("generate").addEventListener("click", async function() {
    const input = document.getElementById("input").value.trim();
    const errorDiv = document.getElementById("error");
    const mailCodeDiv = document.getElementById("mailCode");
    const format = document.getElementById("format");
    const sel = format.options[format.selectedIndex].value;

    errorDiv.textContent = "";
    mailCodeDiv.innerHTML = "";

    const lines = input.split(/\r?\n/);

    for (const line of lines) {
        const text = line.trim();
        if (!text) continue;

        const parts = text.replace(/\s+/g, " ").split(/[:|/\t ]/).filter(Boolean);
        if (parts.length < 2) {
            errorDiv.textContent = "Invalid format: email password, one per line";
            continue;
        }

        const [account, password] = parts;

        const result = appendMailResult(mailCodeDiv, account, password, "获取中...");
        result.codeBtn.classList.add("loading");

        if (sel === "firstmail") {
            getFirstMailLatestMessage(account, password).then(function(code) {
                result.codeBtn.textContent = code;
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

        if (!response.ok) {
            return `HTTP ${response.status}`;
        }

        return extractEightDigitCode(text) || "No code";
    } catch (error) {
        return `Request failed`;
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

function extractEightDigitCode(responseText) {
    let content = responseText;

    try {
        const data = JSON.parse(responseText);
        content = collectText(data).join("\n");
    } catch (e) {
        content = responseText;
    }

    const match = String(content).match(/(^|\D)(\d{8})(?!\d)/);
    return match ? match[2] : "";
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

function appendMailResult(container, account, password, code) {
    const row = document.createElement("div");
    row.className = "mail-result";

    const accountEl = document.createElement("div");
    accountEl.className = "mail-account";
    accountEl.textContent = account;

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

        const newCode = await getFirstMailLatestMessage(account, password);
        codeBtn.textContent = newCode;
        codeBtn.classList.remove("loading");

        refreshBtn.disabled = false;
        refreshBtn.textContent = "刷新";
    });

    row.appendChild(accountEl);
    row.appendChild(codeBtn);
    row.appendChild(refreshBtn);
    container.appendChild(row);

    return {
        row,
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
