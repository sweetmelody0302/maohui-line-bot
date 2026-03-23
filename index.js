// 引入必要的套件
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data'); 

const app = express();

// LINE 的驗證資訊 (Zeabur 的環境變數)
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// 【除錯修復】新增抓取圖片專用的 BlobClient (LINE SDK v9 規定)
const blobClient = new line.messagingApiBlob.MessagingApiBlobClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// Dify 的 API 設定
const DIFY_API_URL = 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;

app.get('/', (req, res) => {
    res.send('老闆好！茂暉國際中繼站運作正常！(已搭載抓蟲透視眼)');
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
    try {
        const events = req.body.events;
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

async function handleEvent(event) {
    // 【防呆】只處理「文字訊息」與「圖片訊息」
    if (event.type !== 'message') return Promise.resolve(null);
    if (event.message.type !== 'text' && event.message.type !== 'image') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    let userMessage = event.message.text || ''; 
    let difyFiles = []; 

    try {
        // ==========================================
        // 【視覺升級區塊：處理客人的圖片訊息】
        // ==========================================
        if (event.message.type === 'image') {
            // 【優化】讓 AI 知道這是一張圖，並主動詢問是不是要找商品
            userMessage = '我上傳了一張圖片。如果這是一張商品照，請幫我辨識它是什麼產品，並告訴我你們有沒有賣？如果是瑕疵照片，請幫我處理。';

            // 拿提貨單去 LINE 下載圖片二進位檔 (改用 blobClient)
            const stream = await blobClient.getMessageContent(event.message.id);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);

            const form = new FormData();
            form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
            form.append('user', userId);

            // 呼叫 Dify 上傳
            const uploadRes = await axios.post('https://api.dify.ai/v1/files/upload', form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${DIFY_API_KEY}`
                }
            });

            difyFiles.push({
                type: 'image',
                transfer_method: 'local_file',
                upload_file_id: uploadRes.data.id
            });
        }

        // ==========================================
        // 【核心對話區塊：呼叫 Dify Agent 大腦】
        // ==========================================
        const difyResponse = await axios({
            method: 'post',
            url: DIFY_API_URL,
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                inputs: {}, 
                query: userMessage, 
                response_mode: 'streaming', 
                user: userId, 
                files: difyFiles 
            },
            responseType: 'stream' 
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
                        // 正常的回答
                        if (dataObj.event === 'message' || dataObj.event === 'agent_message') {
                            if (dataObj.answer) fullReply += dataObj.answer;
                        } 
                        // 【終極鷹眼】如果 Dify 底層報錯，直接抓出來印在 LINE 上給老闆看！
                        else if (dataObj.event === 'error') {
                            fullReply += `\n⚠️ [系統提示] 大腦處理異常：${dataObj.message || dataObj.code} (可能為並發過快或搜尋工具超時)`;
                        }
                    } catch (e) {
                        // 忽略解析錯誤的碎塊
                    }
                }
            }
        });

        return new Promise((resolve, reject) => {
            difyResponse.data.on('end', async () => {
                const finalMessage = fullReply.trim() || "⚠️ 老闆，Dify 大腦沒有回傳任何文字，可能是模型 API 額度滿了或搜尋工具壞了！";
                
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
        return client.replyMessage({
            replyToken: replyToken,
            messages: [{ type: 'text', text: `系統連線失敗：${error.message}` }]
        });
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`茂暉國際機器人已啟動，搭載抓蟲透視眼！監聽 Port: ${port}`);
});
