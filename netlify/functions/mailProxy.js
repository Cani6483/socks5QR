const http = require("http");

const apiKey = process.env.FIRSTMAIL_API_KEY || "gItjn0iQ3zHIEqWapS9AIksprmgj1NGwjz40WI2xQGwOHymUh-qCE-X20WH4IYB0";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-KEY"
};

async function fetchLatestMail(requestData) {
    const response = await fetch("https://firstmail.ltd/api/v1/email/messages/latest", {
        method: "POST",
        headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            email: requestData.email,
            password: requestData.password,
            folder: "INBOX"
        })
    });

    const text = await response.text();

    return {
        statusCode: response.status,
        contentType: response.headers.get("content-type") || "text/plain",
        body: text
    };
}

exports.handler = async function(event) {
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ""
        };
    }

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ error: "Method not allowed" })
        };
    }

    try {
        const result = await fetchLatestMail(JSON.parse(event.body || "{}"));

        return {
            statusCode: result.statusCode,
            headers: {
                ...corsHeaders,
                "Content-Type": result.contentType
            },
            body: result.body
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ error: error.message })
        };
    }
};

if (require.main === module) {
    const server = http.createServer((req, res) => {
        Object.entries(corsHeaders).forEach(([key, value]) => {
            res.setHeader(key, value);
        });

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method !== "POST" || req.url !== "/mail/latest") {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
            return;
        }

        let body = "";

        req.on("data", chunk => {
            body += chunk;
        });

        req.on("end", async () => {
            try {
                const result = await fetchLatestMail(JSON.parse(body || "{}"));

                res.writeHead(result.statusCode, {
                    "Content-Type": result.contentType
                });
                res.end(result.body);
            } catch (error) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: error.message }));
            }
        });
    });

    server.listen(3000, () => {
        console.log("Mail proxy running: http://127.0.0.1:3000/mail/latest");
    });
}
