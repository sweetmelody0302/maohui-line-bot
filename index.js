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

// 【除錯公告】我們正式開除會讓 Zeabur 崩潰的 blobClient！
// 改用下方 100% 穩定的 axios 直接跟 LINE 要圖片！

// Dify 的 API 設定
const DIFY_API_URL = 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;

app.get('/', (req, res) => {
    res.send('老闆好！茂暉國際中繼站運作正常！(已搭載永不崩潰看圖模式)');
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

            // 【終極防當機修復】改用 axios 直接呼叫 LINE API 拿圖片，避開官方雷包 SDK
            const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
                headers: {
                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                },
                responseType: 'arraybuffer' // 告訴 axios 我們要收二進位檔案
            });
            const buffer = Buffer.from(imageRes.data);

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
                let finalMessageText = fullReply.trim();
                let messagesToSend = [];

                // ==========================================
                // 【終極殺招：Flex Message 攔截器】
                // 尋找 Dify 傳來的 ```flex ... ``` 神秘代碼
                // ==========================================
                const flexRegex = /```flex\n([\s\S]*?)\n```/;
                const match = finalMessageText.match(flexRegex);

                if (match) {
                    try {
                        const products = JSON.parse(match[1]); // 把神秘代碼轉成 JSON 陣列
                        
                        // 把神秘代碼從一般文字中拔除，只留給客人看一般安撫對話
                        finalMessageText = finalMessageText.replace(match[0], '').trim();

                        if (finalMessageText) {
                            messagesToSend.push({ type: 'text', text: finalMessageText });
                        }

                        // 組裝超精美 LINE 輪播卡片 (Carousel)
                        const bubbles = products.map(p => ({
                            "type": "bubble",
                            "hero": {
                                "type": "image",
                                // 預設圖片防呆：AI如果不懂圖片連結，用茂暉專屬配色佔位圖防當機
                                "url": p.image || "https://placehold.co/600x400/F97316/FFFFFF/png?text=TWSAFE+Product",
                                "size": "full",
                                "aspectRatio": "20:13",
                                "aspectMode": "cover"
                            },
                            "body": {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    { "type": "text", "text": p.name || "精選商品", "weight": "bold", "size": "xl", "wrap": true },
                                    { "type": "text", "text": p.desc || "茂暉國際高品質推薦", "size": "sm", "color": "#666666", "wrap": true },
                                    { "type": "text", "text": p.price ? `NT$ ${p.price}` : "請洽客服", "size": "lg", "color": "#ff0000", "weight": "bold", "margin": "md" }
                                ]
                            },
                            "footer": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#f97316", // 茂暉專屬活力橘
                                        "action": {
                                            "type": "uri",
                                            "label": "前往蝦皮看看",
                                            "uri": p.link || "https://reurl.cc/pvD0Dx"
                                        }
                                    }
                                ]
                            }
                        }));

                        // 將卡片塞進發送名單 (LINE 最多 12 張，我們保險抓前 10 張)
                        messagesToSend.push({
                            "type": "flex",
                            "altText": "茂暉國際為您推薦專屬商品",
                            "contents": {
                                "type": "carousel",
                                "contents": bubbles.slice(0, 10)
                            }
                        });

                    } catch (e) {
                        console.error('Flex JSON 解析失敗:', e);
                        // 如果 AI 格式寫錯了，就乖乖傳純文字，不讓系統崩潰
                        if (finalMessageText) messagesToSend.push({ type: 'text', text: finalMessageText });
                    }
                } else {
                    // 如果沒有觸發推薦，就一般文字回覆
                    const fallbackText = finalMessageText || "⚠️ 老闆，Dify 大腦沒有回傳任何文字，可能是模型 API 額度滿了或搜尋工具壞了！";
                    messagesToSend.push({ type: 'text', text: fallbackText });
                }

                try {
                    await client.replyMessage({
                        replyToken: replyToken,
                        messages: messagesToSend
                    });
                    resolve('Success');
                } catch (error) {
                    console.error('回傳 LINE 失敗:', error.response?.data || error.message);
                    reject(error);
                }
            });
        });

    } catch (error) {
        console.error('系統錯誤:', error.response?.data || error.message);
        return client.replyMessage({
            replyToken: replyToken,
            messages: [{ type: 'text', text: `系統連線失敗：${error.message}` }]
        });
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`茂暉國際機器人已啟動，搭載永不崩潰看圖模式！監聽 Port: ${port}`);
});
