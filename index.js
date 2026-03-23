// 引入必要的套件
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

const app = express();

// LINE 的驗證資訊 (稍後要在 Zeabur 設定環境變數)
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// Dify 的 API 設定
const DIFY_API_URL = 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;

// 測試伺服器是否活著的路由
app.get('/', (req, res) => {
    res.send('老闆好！茂暉國際中繼站運作正常！');
});

// LINE Webhook 接收端點 (必須使用 line.middleware 來驗證 LINE 傳來的請求)
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
    try {
        const events = req.body.events;
        // 如果沒有事件，直接回傳 200 OK
        if (!events || events.length === 0) {
            return res.status(200).send('OK');
        }

        // 處理每一個 LINE 傳來的事件
        const results = await Promise.all(events.map(handleEvent));
        res.json(results);
    } catch (err) {
        console.error('Webhook 發生錯誤:', err);
        res.status(500).end();
    }
});

// 處理個別事件的邏輯
async function handleEvent(event) {
    // 防呆：我們目前只處理「文字訊息」，其他貼圖、圖片先忽略
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userMessage = event.message.text;
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    try {
        // 【核心地雷區破解】向 Dify 發送請求，Agent 必須使用 streaming！
        const difyResponse = await axios({
            method: 'post',
            url: DIFY_API_URL,
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                inputs: {}, // 【注意】Dify Agent 規定 inputs 必須是空物件
                query: userMessage, // 使用者在 LINE 打的字
                response_mode: 'streaming', // 【防呆】絕對不可用 blocking，否則 Agent 會報錯 400！
                user: userId // 用 LINE 的 userId 讓 Dify 記住對話上下文
            },
            responseType: 'stream' // 告訴 axios 我們要接收串流資料
        });

        let fullReply = '';

        // 解析 Dify 傳回來的 Streaming 碎塊
        difyResponse.data.on('data', (chunk) => {
            const chunkStr = chunk.toString('utf8');
            const lines = chunkStr.split('\n');
            
            for (const lineStr of lines) {
                if (lineStr.startsWith('data: ')) {
                    const dataStr = lineStr.substring(6);
                    if (dataStr.trim() === '') continue;
                    
                    try {
                        const dataObj = JSON.parse(dataStr);
                        // 抓取 Dify 產生的文字片段 (event 可能是 message 或 agent_message)
                        if (dataObj.event === 'message' || dataObj.event === 'agent_message') {
                            fullReply += dataObj.answer;
                        }
                    } catch (e) {
                        // 忽略解析錯誤的碎塊
                    }
                }
            }
        });

        // 當 Dify 講完話時，把組合好的文字送回給 LINE
        return new Promise((resolve, reject) => {
            difyResponse.data.on('end', async () => {
                // 【防呆預警】LINE 絕對不能發送「空字串」，否則會報錯！
                const finalMessage = fullReply.trim() || "老闆，大腦還在思考中，請稍後再試！";
                
                try {
                    await client.replyMessage({
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: finalMessage }]
                    });
                    resolve('Success');
                } catch (error) {
                    console.error('回傳 LINE 失敗:', error.response?.data || error.message);
                    reject(error);
                }
            });
        });

    } catch (error) {
        console.error('呼叫 Dify API 失敗:', error.response?.data || error.message);
        // 如果 Dify 壞了，至少跟使用者說一聲
        return client.replyMessage({
            replyToken: replyToken,
            messages: [{ type: 'text', text: '系統暫時秀逗啦，請稍後再試！' }]
        });
    }
}

// 啟動伺服器
// 【Zeabur 502 防呆】如果有遇到 502 Bad Gateway，通常是 Port 抓錯。
// 請檢查 Zeabur 環境變數是否為大寫 PORT，或者直接刪除 PORT 變數讓 Zeabur 自動分配！
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`茂暉國際機器人已啟動，監聽 Port: ${port}`);
});
