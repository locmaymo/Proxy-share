const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const https = require("https");
const { randomUUID } = require("crypto");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();
const port = process.env.PORT || 3000;
const baseUrl = "https://chat.openai.com";
const apiUrl = `https://chat.openai.com/backend-api/conversation`;

app.set('trust proxy', 1); // trust first proxy
// Định nghĩa rate limiter
const limiter = rateLimit({
    windowMs: 20 * 1000, // 20s
    max: 1, // số lần request tối đa trong 20s 
    handler: function(req, res, /*next*/) {
        res.status(429).json({
            error: {
                message: "You are sending too fast, please try wait 10 seconds",
                code: 429
            }
        });
    }
    
});

app.use(cors());
app.use(limiter)
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

const options = {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: true,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  };

let gptRequests = 1;


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

let chatRequirementsToken;
let authorization = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ik1UaEVOVUpHTkVNMVFURTRNMEZCTWpkQ05UZzVNRFUxUlRVd1FVSkRNRU13UmtGRVFrRXpSZyJ9.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL3Byb2ZpbGUiOnsiZW1haWwiOiJxbDRldmVyeXRoaW5nQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlfSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7InBvaWQiOiJvcmctdDZ2cDZISWZZZk1oTVEwa2ZpWWJnSDFCIiwidXNlcl9pZCI6InVzZXItVHJVbkpmTElEMW9zWDBMRjY5RW9Eb240In0sImlzcyI6Imh0dHBzOi8vYXV0aDAub3BlbmFpLmNvbS8iLCJzdWIiOiJnb29nbGUtb2F1dGgyfDExNzY2MzIzNzg4MzU2OTY3NDQwOCIsImF1ZCI6WyJodHRwczovL2FwaS5vcGVuYWkuY29tL3YxIiwiaHR0cHM6Ly9vcGVuYWkub3BlbmFpLmF1dGgwYXBwLmNvbS91c2VyaW5mbyJdLCJpYXQiOjE3MTM3OTU0NDAsImV4cCI6MTcxNDY1OTQ0MCwic2NvcGUiOiJvcGVuaWQgcHJvZmlsZSBlbWFpbCBtb2RlbC5yZWFkIG1vZGVsLnJlcXVlc3Qgb3JnYW5pemF0aW9uLnJlYWQgb3JnYW5pemF0aW9uLndyaXRlIG9mZmxpbmVfYWNjZXNzIiwiYXpwIjoiVGRKSWNiZTE2V29USHROOTVueXl3aDVFNHlPbzZJdEcifQ.Z0xaYPskWQDF58LBevHMp_jtgyE8BowCx4ZGphQ1rV8rXwuRZEze9yvQB77Z2yZLulhEQl5qEg5oyKr9ynmqNUxs2QoZScOoODWeHQvH67qpM7_NpgLOx6MgrX3Y0hNFPoytxQ-Tu4xzWsaygzSs6YcM4It0PdCXuNYmno-RCNCPyQ01YLEYMML-H_Ff7AkJtil75rHROEpzLiNdeDrxS-Y-9PnUNiopocF9R30GJyZnUm9eo9weAD48uTmZFB8He5X80dC2PK3nuBW8q9DIEr9WBeDXGNnXMUzHRJylX22-nSSdOvQSTxun2M0cTHfjqmMYMwtvMXR8TGfVTw0HRw'
let openaiSentinelProofToken = 'gAAAAABWzEzNjYsIk1vbiBBcHIgMjIgMjAyNCAyMToxNzoyNCBHTVQrMDcwMCAoR2nhu50gxJDDtG5nIETGsMahbmcpIixudWxsLDUsIk1vemlsbGEvNS4wIChpUGhvbmU7IENQVSBpUGhvbmUgT1MgMTdfNCBsaWtlIE1hYyBPUyBYKSBBcHBsZVdlYktpdC82MDUuMS4xNSAoS0hUTUwsIGxpa2UgR2Vja28pIENyaU9TLzEyMy4wLjYzMTIuNTIgTW9iaWxlLzE1RTE0OCBTYWZhcmkvNjA0LjEiXQ=='
let oaiDeviceId = 'ba88fa19-ee8a-4b1f-ad93-b84fecec0743'
let userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1'
let cookie = '_dd_s=rum=0&expire=1713796351291; intercom-device-id-dgkjq2bp=ce2772dc-f109-4bd7-8d9c-2c51ca2a0a72; intercom-session-dgkjq2bp=NkJzUHNHbzI5azc1ajNzcVJidVNtSnJyV0VjVGVzTFNWQ1pWUlI3UVVMWU1SdTlnUWxxWGJLSmZqR3N0Q1NaYS0tWUJwbmNiZXhmU2crRTNrV0FnNWZKQT09--1512e82e90dc7b60c533d3eda88b5a57abf087e3; __Secure-next-auth.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..SteXvR82x2PIkL_R.fnKehzRpR7gDFGYRvDrUtT_6gNZz1WszU9WZy3HFqjeUewb52QCfRa05wRjSa3cAcOMMP6TAIh3E1ByF_ViAoqm6rFw2riBFnwhnOZKNaVtIH74bYFMdarNZ9LN7ZbWr4lYoh2QxU_bCELC90-mjEhP_3ZUeWA1bCunOiLArqzjaU9I1VTL-E_6F2peXYGj8GmOsALZ9e9x4p2fDPaMiP46M7gG88NTxX5GwJxW8Te4efP_A4Rq56x5m6caGOmflV117IXuyHf5xpfSDa8j22uWFqlWysFP6FZwc9Jf-4sFN8ePHKplQNJxqn-qjpjQT02qfB37o2knrqXFj-V5H1lSaWWd_hYYVjBh2KcVSJwuqfECVMPIep3qhJpuuwzPK4IGbsmhiXXCFZcag4HliRjRfAHcvOJII-a_WtTzhwUEkJukXPZm6II3L_egqfgEZ7vlKG-QQghwkXwLtnnaxZC_x1SlwDYLrIzl2Q6yuocPAmxYXI4HkBoplX57RE0BP1vP1oRKtpKzM3tv_814AOPcQzCjmqXEMNaBZOoavylklPHjo2XEKmEW2WctlYpZoJzhUaQxP08M-IBTxDUQWI26C8a96SiNzge1oglIvgElahFuRkoIfbNz1KUA5ZAEiGZAdBNGwK0-uXyOUyNcyQG7PGr5uYG238ULVCJMMxHp0sycqK01Xcpdm42knmZG8lWtXvPWN3C0H2KWmG4h2B_UusvRCqks4WoCoFSGGWAg--mAs2qn6LRPSpa65ZxZ17M4fwie39dXXqQAYyx_qifW7O10rWNSyy56V7o6cqqkTcR8870J5SGYas5w-fWxubRZ6Wyvff9f4HDHtrguaI9yJ3htxIZR-V2DJ9ux0bKOhU2TLGeqbShA6I008gMlsSrD_GZj4ibiqiIv-HvODv2CoE2wMgVvLmlpZ85sVWp-lSJtHEZyA2bfc6uxspUk9LDilVL9MDLZ5ZSUpnZ_nB4Er546JCjVDXNSmX5y0c2LPi05qbMoniFUpkF3fWwX7M09I4TRF6EcKEow8Znw6kSX3UfJKZ0vfXJH2GJlKRhTqKaITu4C6TT-yBsBs69ZieizaKcLyJy4uQrv7KkenlWO2ilMAH9wv1aevgNoG0QFOI2DUaiOC35V8oBWC8Xjm7JobHy-wvCx3e6vmXe2XsX6Fkew0T9ODEod2dgTouDcsXG9JsyHBsw74_kBxcc-LuquUunSOc5Ve2vC3kWg9VgueYKDo9APHXQcfV2AcwK0Or9a2NOuBlod8_MfgiC1KOesbDaRsLoGaVsD3bROKeS3byknrdnd6N8M68j5CVyVTRzSAN4s64WkNVcwCRrYJTPYkeRR2g50njOsZYS_EA6YGaP2BgEXpK5-RcoH8XVwGfu4vPWBRWArhdezr15gKkTvdRg17F5PxioSBwWqY5j7tA1Y_VAHbIZknGOU85dASQcb0EZFvE-QDRZ9i26lVPWbC9-yvXiCbqkiofiRJ28lWrxAVm5O2GW-hS-aY3kBRgIn-JPHNKNY81SdkBwVHopXsGU2DThbZItk5DF0dTGjcEXYuk9GV4Y5l0N91B2lUvv9WF-8-ydiHWaMGCR-0FPgaQUWHCPSbSPJvSRyl0KURj0uC8mK3CS185JyM1e3l9Cp8NVd1IdpJmVRStTw5W9ACuMM3yK-4HHUGgXhC0gief3PZpY1ExagXOhLw3tt7GoxyrU11T4YCvzf1UnyOgmZ5P_54yIjqsSy_yAS0O3zny-YFGyV4ye0_cEJmO8Rjf4stsmRmGE70TlS0mH_RMnqg4ZliUbMJgnTdK73LJkDgKPr0Z2vI-DfKgAzPpTs0McmZdu89xX8-5rGxq-naI1ISffwAntxGmEYbtpfxPrPMepXBzR33yqerzFE-8e5eB1f8oOwQeWIQ6sI8rR8-dq4ZSW8aJTL5TbDOLCTjHxf58L5f6ozmtCRN_UKmP2uCm2y2XyqPK2qix5hocX7keJunet1Em4HUZlXY2c3UujKpyoOgO17TdSDwmMe8kYiJgH7QJ0AgK-mBBjpHwCj7fjy83CRQzEL1DhLCwu_gmP_dDHT21LJoKhXZTZq04uCAkr2Y8GjQyJkhhQYU8vkNGe1wnviXNPZSPg8YH8vxIF0wWd9opBmXGtC6RPEmrjeRLsFDuePQgufMDPU3L6frYmix6tE7ZpR-C6qM4wI4hN8avUpPGwPdxewYSMPgcklvms7S0KlMGvL6DFeRnn622rn6zhCd-OJ5TV1WzoUWnhBBoB921qNIHpOX7dzG0f9Ot9X5yihCkCsuSllbZIRlBL623tsK4SNJyLmYBo9pTsRev8-ec7ZthdW48YWa-dU8ZXqrTJWE4eXTtQt96T_A9ATTsckZ9lplczY4dzYVSzG49n312zXaw8x6NmqPdU1HT2FAJKvJoD4MAUNFqG4LfiybHidZ6-PjgKNoytiVJLHQQWGFzzgRqQxD6JySgRt89Btksj4Hi5_VUl0oBuEIx6n6x_nvB2BwHqApszX1W9aiBdURyPEId2lN8eH9RmSmaaliB0g-CvUHikh1LYgLJo3QVfTBnfRGaIamy4c7sHrXufEi-xCWCGfWckA5j3KDoq5HZVeHbgUXRdLtIOG0hH0uBUjvAcBybwWB-27RBBF-qf71QlZdFHjZfGsY2Ts5puZ8UNAozo-dqccnGAyZ9PAm2e3MPeoyZFom4HXcrXPuZILAgWwu-v7qPje6QR09JiGFfh0-JVqEdynUY6NmXHfCEaZSkNc0rymDoJwM9iwXFbTf7ocQYrdDopElwbGUpYdSMOmxOZmm8hAZ0qx9ufA.A3nJu8eqMazgH9ZsR1MJhQ; oai-hlib=true; __Secure-next-auth.callback-url=https%3A%2F%2Fchat.openai.com; __cf_bm=afQU47zhowQunB6iN0I33DjS3igi6HMIgStPg6uGV6c-1713795436-1.0.1.1-EifT5v5v5Iwh1tfurtQbZ7l_wH8wwSDqo.MXDF.FxA6cHdttxMY34xyzWds1KyDQ8sqn15U_8L6bIaRfKDqx8g; _cfuvid=qzjxkxG3Efr4.345HQwYg2Pp7KoANak3pFNbA7orRKk-1713795436962-0.0.1.1-604800000; cf_clearance=LrOOqS8FyNPp992x8C33lRMIi00BtGh3tI2Be.v6Kr0-1713795425-1.0.1.1-RXKOML6kOD5v0Mf0pfkAjm6v1v1ZDxv8G617.GNbkLy1kFM7H8Y7.ChqoFyiKo8kJ0NCTewqujfwktGhenrWIw; __cf_bm=Uy4tsrzlbSSsjEAkoOAHg8Pw_KVTZf2S9DPB_a2M2PE-1713795423-1.0.1.1-j.Ezjrz3eWI1B5TfpwWE8HqCcRQcUC.M2rSNVto6v56ZNtsXwsasl1ZboQXFMpbA_m0opud5feCRR19O8f9UTQ; _cfuvid=2ygAY4__Z2EU7XYrCVO7LGs70NQVCajDO2Otcxx.9K4-1713795423747-0.0.1.1-604800000; cf_clearance=lkm.b3mG38pvimzkpmaUhibua.OT4pA.MCIWy4iW5kM-1713795373-1.0.1.1-jgPNkPT9qXP_1Tm1edEwVXJdYf3I2FYj8DLGMEt2_neWPN0M3qWq5pxQE__bQZx0agI4T6V_KCbn6lnpirH4eQ; cf_chl_3=; cf_chl_3=cf3c7b18aa36a09; __cflb=0H28vVfF4aAyg2hkHFTZ1MVfKmWgNcKErooQC6ctg1B; __Host-next-auth.csrf-token=dc09c91498c7ad24364505f42ba517fec588d0dd0539f652598f679f2144c430%7C492f93138edea8dc16b89583ef70935009217333b6b52165729260053659d3c7; oai-did=ba88fa19-ee8a-4b1f-ad93-b84fecec0743'



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

async function getRequirementsToken() {
    const response = await requireToken.post(
        `${baseUrl}/backend-api/sentinel/chat-requirements`,
        {},
    );
    chatRequirementsToken = response.data.token;
}

const requireToken = axios.create({
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: {
        'content-type': 'application/json',
        'accept': '*/*',
        'authorization': authorization,
        'sec-fetch-site': 'same-origin',
        'oai-language': 'en-US',
        'oai-device-id': oaiDeviceId,
        'accept-language': 'vi-VN,vi;q=0.9',
        'sec-fetch-mode': 'cors',
        'origin': 'https://chat.openai.com',
        'user-agent': userAgent,
        'referer': 'https://chat.openai.com/',
        'sec-fetch-dest': 'empty',
        'cookie': cookie
    }
});

app.post("/v1/chat/completions", async (req, res) => {  

    // test message nếu req.body có messages[0].content === 'Hi'
    if (req.body.messages[0].content === 'Hi' || req.body.messages[0].content === 'Just say TEST' || req.body.messages[0].content === '你好' ) {
        handleError(res, req.body.stream || false, " TEST");
        return;
    }

    console.log(`Request ${gptRequests} gpt35 at ${new Date().toLocaleTimeString('vi-VN', options)}`);
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
        
        // get new token each request
        await getRequirementsToken();

        const chatCompletion = axios.create({
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            headers: {
                'content-type': 'application/json',
                'accept': 'text/event-stream',
                'openai-sentinel-chat-requirements-token': chatRequirementsToken,
                'authorization': authorization,
                'openai-sentinel-proof-token': openaiSentinelProofToken,
                'sec-fetch-site': 'same-origin',
                'oai-language': 'en-US',
                'oai-device-id': oaiDeviceId,
                'accept-language': 'vi-VN,vi;q=0.9',
                'sec-fetch-mode': 'cors',
                'origin': 'https://chat.openai.com',
                'user-agent': userAgent,
                'referer': 'https://chat.openai.com/',
                'sec-fetch-dest': 'empty',
                'cookie': cookie
              },
        });

        const response = await chatCompletion.post(apiUrl, body, {
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
            // Skip heartbeat detection
			if (message.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}.\d{6}$/)) continue;
            
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
        console.log(`✅ Request ${gptRequests} gpt35 done.`)
        gptRequests++;
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
        console.error("Error:", error);
    }

});

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
});