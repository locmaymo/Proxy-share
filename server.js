const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const https = require("https");
const { randomUUID } = require("crypto");
const cors = require("cors");

const port = process.env.PORT;
const baseUrl = "https://chat.openai.com";
const apiUrl = `${baseUrl}/backend-api/conversation`;
const refreshInterval = 60000;
const errorWait = 120000;

let token;
let oaiDeviceId;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function GenerateCompletionId(prefix = "cmpl-") {
    const characters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const length = 28;

    for (let i = 0; i < length; i++) {
        prefix += characters.charAt(Math.floor(Math.random() * characters.length));
    }

    return prefix;
}

async function* chunksToLines(chunksAsync) {
    let previous = "";
    for await (const chunk of chunksAsync) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        previous += bufferChunk;
        let eolIndex;
        while ((eolIndex = previous.indexOf("\n")) >= 0) {
            const line = previous.slice(0, eolIndex + 1).trimEnd();
            if (line === "data: [DONE]") break;
            if (line.startsWith("data: ")) yield line;
            previous = previous.slice(eolIndex + 1);
        }
    }
}

async function* linesToMessages(linesAsync) {
    for await (const line of linesAsync) {
        const message = line.substring("data :".length);

        yield message;
    }
}

async function* StreamCompletion(data) {
    yield* linesToMessages(chunksToLines(data));
}

const axiosInstance = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "oai-language": "en-US",
        origin: baseUrl,
        pragma: "no-cache",
        referer: baseUrl,
        "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
});

async function getNewSessionId() {
    let newDeviceId = randomUUID();
    const response = await axiosInstance.post(
        `${baseUrl}/backend-anon/sentinel/chat-requirements`,
        {},
        {
            headers: { "oai-device-id": newDeviceId },
        }
    );
    console.log(`System: Successfully refreshed session ID and token. ${!token ? "(Now it's ready to process requests)" : ""}`);
    oaiDeviceId = newDeviceId;
    token = response.data.token;
}

function enableCORS(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }
    next();
}

async function handleChatCompletion(req, res) {
    console.log("Request:", `${req.method} ${req.originalUrl}`, `${req.body?.messages?.length ?? 0} messages`, req.body.stream ? "(stream-enabled)" : "(stream-disabled)");
    try {
        const body = {
            action: "next",
            messages: req.body.messages.map((message) => ({
                author: { role: message.role },
                content: { content_type: "text", parts: [message.content] },
            })),
            parent_message_id: randomUUID(),
            model: "text-davinci-002-render-sha",
            timezone_offset_min: -180,
            suggestions: [],
            history_and_training_disabled: true,
            conversation_mode: { kind: "primary_assistant" },
            websocket_request_id: randomUUID(),
        };
        // console.log("Request:", JSON.stringify(body.messages, null, 2));

        const response = await axiosInstance.post(apiUrl, body, {
            responseType: "stream",
            headers: {
                "oai-device-id": oaiDeviceId,
                "openai-sentinel-chat-requirements-token": token,
            },
        });

        if (req.body.stream) {
            res.setHeader("Content-Type", "text/event-stream");
            res.setHeader("Cache-Control", "no-cache");
            res.setHeader("Connection", "keep-alive");
        } else {
            res.setHeader("Content-Type", "application/json");
        }

        let fullContent = "";
        let requestId = GenerateCompletionId("chatcmpl-");
        let created = Date.now();

        for await (const message of StreamCompletion(response.data)) {
            const parsed = JSON.parse(message);

            let content = parsed?.message?.content?.parts[0] ?? "";

            for (let message of req.body.messages) {
                if (message.content === content) {
                    content = "";
                    break;
                }
            }

            if (content === "") continue;

            if (req.body.stream) {
                let response = {
                    id: requestId,
                    created: created,
                    object: "chat.completion.chunk",
                    model: "gpt-3.5-turbo",
                    choices: [
                        {
                            delta: {
                                content: content.replace(fullContent, ""),
                            },
                            index: 0,
                            finish_reason: null,
                        },
                    ],
                };

                res.write(`data: ${JSON.stringify(response)}\n\n`);
            }

            fullContent = content.length > fullContent.length ? content : fullContent;
        }
        console.log("Response:", fullContent);

        if (req.body.stream) {
            res.write(
                `data: ${JSON.stringify({
                    id: requestId,
                    created: created,
                    object: "chat.completion.chunk",
                    model: "gpt-3.5-turbo",
                    choices: [
                        {
                            delta: {
                                content: "",
                            },
                            index: 0,
                            finish_reason: "stop",
                        },
                    ],
                })}\n\n`
            );
        } else {
            res.write(
                JSON.stringify({
                    id: requestId,
                    created: created,
                    model: "gpt-3.5-turbo",
                    object: "chat.completion",
                    choices: [
                        {
                            finish_reason: "stop",
                            index: 0,
                            message: {
                                content: fullContent,
                                role: "assistant",
                            },
                        },
                    ],
                    usage: {
                        prompt_tokens: 0,
                        completion_tokens: 0,
                        total_tokens: 0,
                    },
                })
            );
        }

        res.end();
    } catch (error) {
        if (!res.headersSent) res.setHeader("Content-Type", "application/json");
        res.write(
            JSON.stringify({
                status: false,
                error: {
                    message: "An error happened, please make sure your request is SFW, or use a jailbreak to bypass the filter.",
                    type: "invalid_request_error",
                },
                support: "https://discord.pawan.krd",
            })
        );
        res.end();
    }
}

const app = express();
app.use(bodyParser.json());
app.use(cors());

app.post("/v1/chat/completions", handleChatCompletion);

app.use((req, res) =>
    res.status(404).send({
        status: false,
        error: {
            message: `The requested endpoint was not found. please make sure to use "http://localhost:3040/v1" as the base URL.`,
            type: "invalid_request_error",
        },
        support: "loc",
    })
);

app.get('/v1/models', async (req, res) => {
    res.json({
        "object": "list",
        "data": [
            {
                "id": "gpt-3.5-turbo",
                "object": "model",
                "created": 1677610602,
                "owned_by": "openai"
            }
        ]
    });
});

app.listen(port, () => {
    console.log(`💡 Server is running at http://localhost:${port}`);

    setTimeout(async () => {
        while (true) {
            try {
                await getNewSessionId();
                await wait(refreshInterval);
            } catch (error) {
                console.error("Error refreshing session ID, retrying in 1 minute...");
                console.error("If this error persists, your country may not be supported yet.");
                console.error("If your country was the issue, please consider using a U.S. VPN.");
                await wait(errorWait);
            }
        }
    }, 0);
});