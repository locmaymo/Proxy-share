const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const https = require("https");
const { randomUUID } = require("crypto");
const cors = require("cors");

const port = process.env.PORT;
const baseUrl = "https://chat.openai.com";
const apiUrl = `https://ios.chat.openai.com/backend-api/conversation`;
const refreshInterval = 60000 * 5; // 5 minutes
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
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik1UaEVOVUpHTkVNMVFURTRNMEZCTWpkQ05UZzVNRFUxUlRVd1FVSkRNRU13UmtGRVFrRXpSZyJ9.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL3Byb2ZpbGUiOnsiZW1haWwiOiJxdWFuaHV5MTk5MDA5QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7InBvaWQiOiJvcmctR3F1SlNremJpbHUxYjhyTkh3bmlLRWtkIiwidXNlcl9pZCI6InVzZXItaTlOSU1pMHY5SnRkV0FZWlExQVEzcko1In0sImlzcyI6Imh0dHBzOi8vYXV0aDAub3BlbmFpLmNvbS8iLCJzdWIiOiJnb29nbGUtb2F1dGgyfDEwOTE5NTA0NjAzODk1ODA4NjQwNCIsImF1ZCI6WyJodHRwczovL2FwaS5vcGVuYWkuY29tL3YxIiwiaHR0cHM6Ly9vcGVuYWkub3BlbmFpLmF1dGgwYXBwLmNvbS91c2VyaW5mbyJdLCJpYXQiOjE3MTM2Nzg2MjIsImV4cCI6MTcxNDU0MjYyMiwic2NvcGUiOiJvcGVuaWQgcHJvZmlsZSBlbWFpbCBtb2RlbC5yZWFkIG1vZGVsLnJlcXVlc3Qgb3JnYW5pemF0aW9uLnJlYWQgb3JnYW5pemF0aW9uLndyaXRlIG9mZmxpbmVfYWNjZXNzIiwiYXpwIjoicGRsTElYMlk3Mk1JbDJyaExoVEU5VlY5Yk45MDVrQmgifQ.LZ5wShevYutyuRgVAZ3A2IwcVFfbBD9l3S8ZLmL1xFywRFOsqsiXLP5-T-VymvV9ebFb64QtfhcHtqRH2OwD1Weu55D-h-sA5ndeTLQMzUMH92zchOsxuJcha3mbDhN8S28Xgeb4rbwdPNN0Veu-1f8bsPyh6zVogTc-khUc45Ki4HEfsP7dWKrptf5QD0t5pBgAV3a1Pa9OSU8gCVAU2Sjp91JrB7yY8vsgqcTYUspHHjx9VoP0xoDnlJGh_q90FbHCALH4fhcSiUrKHPt6PmjUSeJfCjn_yRTd-PsCWPPpWFkAeOuu5frElJBMzPqo6jIApUYkHJxipxplTWp_dA',
        'Accept-Language': 'vi-VN,vi;q=0.9',
        'oai-device-id': '9688CD4A-DED7-4A24-9E0B-55F10CD24B86',
        'baggage': 'sentry-environment=production,sentry-public_key=1a01a4d155f3487186fbf103278eb9ed,sentry-release=com.openai.chat%401.2024.101%2B24862,sentry-trace_id=541240aa416144c9b2a0c9e9633717fe',
        'Cache-Control': 'no-cache',
        'sentry-trace': '541240aa416144c9b2a0c9e9633717fe-04bcd90656874ddc-0',
        'content-length': '489',
        'user-agent': 'ChatGPT/1.2024.101 (iOS 17.4.1; iPhone15,3; build 24862)',
        'oai-client-type': 'ios',
        'accept-encoding': 'gzip, deflate, br',
        'cookie': '_uasid="Z0FBQUFBQm1KS2tqZnkzVmpJS1h3R0xYLUNmcFZmR1JVQ1lFUF9ET1dsT1BvaWVfcHZKdUxteHVMWm1GcWJUMWNmQjIzUWJLR0RIbVRyWkIzcXFyZTBPWGZGNTZ3TThiYWt1ai03OWVPTzkxN1ZfcW1zMHN4RlNSdUlVbEQ2NjI3Z2wtemt5Y3RTRjRCVmMyQjBYZjBvN3Zmb0lSS21QZWt3TEtrZUJJa3pWaDhkSHFHOG5TNjF4WTFYSHZUTTgwNGtqbDFlX25iWmo5Y2NWQXBfd1JNaHQwTURHWlQtZ3g4RXpNbXRXR2pKMGtsNy02dlhkT0xTdHp4QWpKVUxDd3ZJcm5LUDZoOGwxam5WM0RPZXg1bjM5LV8za0d1SGs3anFoYW1OcnN5MEdSaU1iZTRIRmRGTm9GbEstVkpwMm5HR0J5NUdYTHhXWTRReW5tY18tWkNYU3V6NWJrRkJ2NlBnPT0="; _umsid="Z0FBQUFBQm1KS2tqdVZpcHdlRWhLSjZERlZCSVgteTQ2TkNxdjhreTlKVjhhZVZlcldsWmlWMHhELWpfSWJJS2xYMm54X3VaM0dxcVFtMVFDRnhjZjRLOHJMUm5MU3RWTTdSMTctLUQ1enB6ZXlua2ZURHZxNkZya29PR2w1OGF5N2UzREllMl8zbFMwdG1wWGtDR0MxRWEtekVpZXBYRlhKNlZyQnNzaUE1ck0tTmpSUE9yNWEyQnFPNEd0amE0TXVQV0RiYUY4MFc0WVk3MVZFYS0tLXJRZlB4QkR3SEVHbDBNN3lFMVRGd1hqVWxZSzcxTUNrMD0="; _devicecheck=user-i9NIMi0v9JtdWAYZQ1AQ3rJ5:1713678623-fJOV67jqRlne1KZN16QQiWC5TnR051NX2dv%2FDYhI%2BdQ%3D; __cf_bm=aILQ8w3aYiQWO4InvbJc7dHIgY9ksvMWsqTEO27Zk.I-1713678563-1.0.1.1-BssvF4KU86c_JHgNGQ_xC5PNt6KPYRYeHL1yoKmXxAEp8D6lLNxTngMDCGDQJlC76XL10VbtP8trlELT.3z6CA; _cfuvid=BJk0W5nzk97q9PCEGG6QvEtebssqOFgNZabFV16ZANs-1713678563991-0.0.1.1-604800000; _preauth_devicecheck=9688CD4A-DED7-4A24-9E0B-55F10CD24B86:1713678563-8NDsubAzDXnKfPAIU%2FVpzAsJJ9uMZjSSpL7BM3A6Hxo%3D'
    },
});

function handleError(res, isStream, errMsg = "\n**Có lỗi vui lòng liên hệ admin tại** <a href='https://www.messenger.com/t/103965857842703/'>👉Messenger👈</a>") {
  // If the request hasn't finished, notify the user that there was an error and finish
  // the request properly, so that ST isn't left hanging.
  let jsonResp = {
    id: "chatcmpl-92gShiDhcnQ6lkeJeIByrb0yr9vJy",
    object: "chat.completion",
    created: Date.now(),
    model: "gpt-3.5-turbo",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: errMsg,
        },
        logprobs: null,
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
  if (!res.writableEnded) {
    if (isStream) {
      res.write(`data: ${JSON.stringify(jsonResp)}\r\n\r\n`);
    } else {
      res.json(jsonResp);
    }
    res.end();
  }
}

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
        // nếu code 413
        if (error.response && error.response.status === 413) {
            handleError(res, req.body.stream, "Sorry, the message is too long for me to process. Please set context size Token to 7000 and try again.");
            return;
        }
        // trả về lỗi bằng lời ngẫu nhiên bằng tiếng anh từ 1 trong 3 lỗi "Xin lỗi, Tôi không thể làm theo yêu cầu đó", "Xin lỗi, hãy thảo luận theo một hướng tích cực hơn", "Là một AI tôi không được phép thực hiện hành động đó"
        let errorMessages = ["Sorry, I can't comply with that request.", "Sorry, please discuss in a more positive direction.", "As an AI, I am not allowed to perform that action."];
        let randomError = errorMessages[Math.floor(Math.random() * errorMessages.length)];
        handleError(res, req.body.stream, error.message);
    }
}

const app = express();
app.use(bodyParser.json());
app.use(cors());

app.post("/v1/chat/completions", handleChatCompletion);


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