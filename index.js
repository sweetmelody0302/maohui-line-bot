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

// Dify 的 API 設定
const DIFY_API_URL = 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;

app.get('/', (req, res) => {
    res.send('老闆好！茂暉國際中繼站運作正常！(已搭載精準商品連結導航)');
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
            userMessage = '我上傳了一張圖片。如果這是一張商品照，請幫我辨識它是什麼產品，並告訴我你們有沒有賣？如果是瑕疵照片，請幫我處理。';

            const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
                headers: {
                    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                },
                responseType: 'arraybuffer' 
            });
            const buffer = Buffer.from(imageRes.data);

            const form = new FormData();
            form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
            form.append('user', userId);

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

        difyResponse.data.on('data', (chunk) => {
            const chunkStr = chunk.toString('utf8');
            const lines = chunkStr.split('\n');
            
            for (const lineStr of lines) {
                if (lineStr.startsWith('data: ')) {
                    const dataStr = lineStr.substring(6);
                    if (dataStr.trim() === '') continue;
                    
                    try {
                        const dataObj = JSON.parse(dataStr);
                        if (dataObj.event === 'message' || dataObj.event === 'agent_message') {
                            if (dataObj.answer) fullReply += dataObj.answer;
                        } 
                        else if (dataObj.event === 'error') {
                            fullReply += `\n⚠️ [系統提示] 大腦處理異常：${dataObj.message || dataObj.code}`;
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
                // 【尊榮級 Flex Message 攔截器】
                // ==========================================
                const flexRegex = /```flex\n([\s\S]*?)\n```/;
                const match = finalMessageText.match(flexRegex);

                if (match) {
                    try {
                        const products = JSON.parse(match[1]); 
                        
                        finalMessageText = finalMessageText.replace(match[0], '').trim();

                        if (finalMessageText) {
                            messagesToSend.push({ type: 'text', text: finalMessageText });
                        }

                        // 【極簡專業風】組裝超精美 LINE 輪播卡片
                        const bubbles = products.map(p => {
                            // 【超級必殺技：動態精準連結替換】
                            let finalLink = p.link || "https://reurl.cc/pvD0Dx";
                            // 如果 AI 給的是首頁，我們自動把它變成「在茂暉蝦皮賣場內搜尋該商品」的精準網址
                            if (finalLink.includes('reurl.cc/pvD0Dx') || finalLink.includes('shopee.tw')) {
                                // 將商品名稱轉換為網址安全格式，並鎖定賣場 ID 67350667
                                const searchKeyword = encodeURIComponent(p.name);
                                finalLink = `https://shopee.tw/shop/67350667/search?keyword=${searchKeyword}`;
                            }

                            return {
                                "type": "bubble",
                                "size": "micro",
                                "hero": {
                                    "type": "image",
                                    // 【顏值升級】換成頂級深藍黑底+橘字的官方 Banner，並把比例改成長方形 20:13
                                    "url": p.image || "https://placehold.co/600x390/1e293b/ea580c/png?text=TWSAFE+Official",
                                    "size": "full",
                                    "aspectRatio": "20:13",
                                    "aspectMode": "cover"
                                },
                                "body": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "paddingAll": "15px",
                                    "contents": [
                                        {
                                            "type": "text",
                                            "text": "茂暉嚴選",
                                            "color": "#ea580c",
                                            "size": "xs",
                                            "weight": "bold"
                                        },
                                        {
                                            "type": "text",
                                            "text": p.name || "精選商品",
                                            "weight": "bold",
                                            "size": "md",
                                            "wrap": true,
                                            "maxLines": 2,
                                            "margin": "sm",
                                            "color": "#1e293b"
                                        },
                                        {
                                            "type": "text",
                                            "text": p.desc || "高品質專業防護首選",
                                            "size": "xs",
                                            "color": "#64748b",
                                            "wrap": true,
                                            "maxLines": 2,
                                            "margin": "sm"
                                        },
                                        {
                                            "type": "separator",
                                            "margin": "lg",
                                            "color": "#f1f5f9"
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "margin": "md",
                                            "contents": [
                                                {
                                                    "type": "text",
                                                    "text": "NT$",
                                                    "size": "xs",
                                                    "color": "#ef4444",
                                                    "align": "end",
                                                    "gravity": "bottom",
                                                    "flex": 1
                                                },
                                                {
                                                    "type": "text",
                                                    "text": p.price ? `${p.price}` : "洽客服",
                                                    "size": "xl",
                                                    "color": "#ef4444",
                                                    "weight": "bold",
                                                    "align": "end",
                                                    "flex": 4
                                                }
                                            ]
                                        }
                                    ]
                                },
                                "footer": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "paddingAll": "15px",
                                    "paddingTop": "0px",
                                    "contents": [
                                        {
                                            "type": "button",
                                            "style": "primary",
                                            "color": "#ea580c",
                                            "height": "sm",
                                            "action": {
                                                "type": "uri",
                                                "label": "查看詳情",
                                                "uri": finalLink // 替換為我們算出來的精準賣場搜尋連結！
                                            }
                                        }
                                    ]
                                }
                            };
                        });

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
                        if (finalMessageText) messagesToSend.push({ type: 'text', text: finalMessageText });
                    }
                } else {
                    const fallbackText = finalMessageText || "⚠️ 老闆，Dify 大腦沒有回傳任何文字！";
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
    console.log(`茂暉國際機器人已啟動，搭載頂級電商卡片UI與精準導航！監聽 Port: ${port}`);
});
