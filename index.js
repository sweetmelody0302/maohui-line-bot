// 引入必要的套件
require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data'); // 【升級視覺】打包圖片上傳給 Dify 的神兵利器

const app = express();

// LINE 的驗證資訊 (Zeabur 的環境變數)
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
    res.send('老闆好！茂暉國際中繼站運作正常！(已支援圖片視覺功能)');
});

// LINE Webhook 接收端點
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
    // 【防呆】我們目前只處理「文字訊息」與「圖片訊息」，其他貼圖影片先忽略
    if (event.type !== 'message') return Promise.resolve(null);
    if (event.message.type !== 'text' && event.message.type !== 'image') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    let userMessage = event.message.text || ''; 
    let difyFiles = []; // 準備裝圖片 ID 給 Dify 看的百寶袋

    try {
        // ==========================================
        // 【視覺升級區塊：處理客人的圖片訊息】
        // ==========================================
        if (event.message.type === 'image') {
            // Dify 的 query 規定不能為空字串，所以我們幫客人塞一句預設台詞
            userMessage = '這是我上傳的圖片，請幫我確認商品狀況或協助處理。';

            // 1. 拿提貨單去 LINE 下載圖片二進位檔
            const stream = await client.getMessageContent(event.message.id);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);

            // 2. 把圖片打包，準備寄給 Dify
            const form = new FormData();
            form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
            form.append('user', userId);

            // 3. 呼叫 Dify 的「上傳檔案 API」取得檔案 ID
            const uploadRes = await axios.post('https://api.dify.ai/v1/files/upload', form, {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${DIFY_API_KEY}`
                }
            });

            // 4. 拿到 Dify 發給我們的檔案 ID，存進百寶袋
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
                inputs: {}, // 【注意】Dify Agent 規定 inputs 必須是空物件
                query: userMessage, // 使用者打的字，或是圖片的預設台詞
                response_mode: 'streaming', // 【防呆】絕對不可用 blocking！
                user: userId, 
                files: difyFiles // 【圖片功能】把剛剛上傳的圖片交給 Dify
            },
            responseType: 'stream' // 接收串流資料
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
                        // 抓取 Dify 產生的文字片段
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
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`茂暉國際機器人已啟動，支援看圖功能！監聽 Port: ${port}`);
});
