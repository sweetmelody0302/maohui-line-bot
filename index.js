require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data'); 

const app = express();

const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

const DIFY_API_URL = 'https://api.dify.ai/v1/chat-messages';
const DIFY_API_KEY = process.env.DIFY_API_KEY;

// ==========================================
// 【旗艦功能】：提供 LIFF 報價單網頁 
// ==========================================
app.get('/liff', (req, res) => {
    const liffId = process.env.LIFF_ID || '';
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
        <title>茂暉國際 - 專屬報價單</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
        <style>
            body { background-color: #f1f5f9; font-family: 'PingFang TC', 'Microsoft JhengHei', sans-serif; }
            .btn-orange { background-color: #ea580c; color: white; }
            .btn-orange:hover { background-color: #c2410c; }
        </style>
    </head>
    <body class="p-4">
        <div class="max-w-md mx-auto bg-white rounded-xl shadow-md overflow-hidden p-6 border-t-4 border-[#1e293b]">
            <h2 class="text-2xl font-bold text-[#1e293b] mb-1">大宗採購專屬報價單</h2>
            <p class="text-xs text-gray-500 mb-6">請填寫您的需求，茂暉專員將盡速為您提供最優報價。</p>
            
            <form id="leadForm" class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700">公司名稱 <span class="text-red-500">*</span></label>
                    <input type="text" id="company" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:ring-[#ea580c] focus:border-[#ea580c]">
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700">聯絡人 <span class="text-red-500">*</span></label>
                        <input type="text" id="name" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:ring-[#ea580c] focus:border-[#ea580c]">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700">電話 <span class="text-red-500">*</span></label>
                        <input type="tel" id="phone" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:ring-[#ea580c] focus:border-[#ea580c]">
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">需求品項 <span class="text-red-500">*</span></label>
                    <input type="text" id="items" placeholder="例如：MAPA 401 防溶劑手套" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:ring-[#ea580c] focus:border-[#ea580c]">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700">採購數量 <span class="text-red-500">*</span></label>
                    <input type="number" id="quantity" placeholder="例如：100" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2 border focus:ring-[#ea580c] focus:border-[#ea580c]">
                </div>
                <button type="submit" id="submitBtn" class="w-full btn-orange font-bold py-3 px-4 rounded-md shadow-lg mt-6 transition duration-200">
                    送出需求並取得報價
                </button>
            </form>
        </div>

        <script>
            liff.init({ liffId: '${liffId}' }).catch(err => console.error(err));

            document.getElementById('leadForm').addEventListener('submit', function(e) {
                e.preventDefault();
                const btn = document.getElementById('submitBtn');
                btn.innerText = '傳送中...';
                btn.disabled = true;

                const data = {
                    company: document.getElementById('company').value,
                    name: document.getElementById('name').value,
                    phone: document.getElementById('phone').value,
                    items: document.getElementById('items').value,
                    quantity: document.getElementById('quantity').value
                };

                fetch('/api/submit-lead', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                }).then(res => res.json())
                  .then(() => {
                      if (liff.isInClient()) {
                          liff.sendMessages([{
                              type: 'text',
                              text: \`【報價需求已送出】\\n公司：\${data.company}\\n聯絡人：\${data.name}\\n電話：\${data.phone}\\n品項：\${data.items}\\n數量：\${data.quantity}\\n\\n請專員盡速為我報價！\`
                          }]).then(() => {
                              liff.closeWindow(); 
                          }).catch(err => {
                              // 【防呆】就算 LINE 傳送訊息卡住，也強制關閉網頁！
                              console.error('LIFF 訊息傳送失敗', err);
                              liff.closeWindow(); 
                          });
                      } else {
                          alert('報價需求已送出！業務專員將盡速與您聯絡。');
                          btn.innerText = '已成功送出';
                      }
                  }).catch(err => {
                      console.error(err);
                      alert('網路連線稍微不穩，但我們已收到您的報價單！');
                      if (liff.isInClient()) liff.closeWindow();
                  });
            });
        </script>
    </body>
    </html>
    `;
    res.send(htmlContent);
});

// ==========================================
// 【轉拋 Google Sheets】(已修復：射後不理光速模式)
// ==========================================
app.post('/api/submit-lead', express.json(), (req, res) => {
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    
    // 1. 收到資料後，立刻！馬上！回傳成功給手機，讓表單瞬間關閉 (不讓客人等 Google)
    res.json({ success: true });

    // 2. 偷偷在背景把資料打給 Google Sheets
    if (googleScriptUrl) {
        axios.post(googleScriptUrl, req.body)
            .then(() => console.log('✅ Google Sheets 背景寫入成功'))
            .catch(err => console.error('⚠️ Google Sheets 背景寫入失敗 (但已收到資料):', err.message));
    } else {
        console.error('⚠️ 老闆尚未設定 GOOGLE_SCRIPT_URL 變數！');
    }
});

app.get('/', (req, res) => res.send('茂暉國際中繼站運作正常！(已搭載LIFF光速關閉版)'));

// ==========================================
// 【LINE Webhook 核心處理】
// ==========================================
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
    try {
        const events = req.body.events;
        if (!events || events.length === 0) return res.status(200).send('OK');
        const results = await Promise.all(events.map(handleEvent));
        res.json(results);
    } catch (err) {
        console.error('Webhook 錯誤:', err);
        res.status(500).end();
    }
});

async function handleEvent(event) {
    if (event.type !== 'message') return Promise.resolve(null);
    if (event.message.type !== 'text' && event.message.type !== 'image') return Promise.resolve(null);

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    let userMessage = event.message.text || ''; 
    let difyFiles = []; 

    if (userMessage.includes('【報價需求已送出】')) {
        return client.replyMessage({
            replyToken: replyToken,
            messages: [{ type: 'text', text: '老闆您好！您的專屬報價需求我們已經收到並匯入系統囉！✨\n\n我們的業務專員會用最快的速度為您核算最優惠的批發價格，並盡速與您聯繫，請您稍候！' }]
        });
    }

    try {
        if (event.message.type === 'image') {
            userMessage = '我上傳了一張圖片。如果這是一張商品照，請幫我辨識它是什麼產品，並告訴我你們有沒有賣？如果是瑕疵照片，請幫我處理。';
            const imageRes = await axios.get(`https://api-data.line.me/v2/bot/message/${event.message.id}/content`, {
                headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
                responseType: 'arraybuffer' 
            });
            const buffer = Buffer.from(imageRes.data);
            const form = new FormData();
            form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
            form.append('user', userId);

            const uploadRes = await axios.post('https://api.dify.ai/v1/files/upload', form, {
                headers: { ...form.getHeaders(), 'Authorization': `Bearer ${DIFY_API_KEY}` }
            });
            difyFiles.push({ type: 'image', transfer_method: 'local_file', upload_file_id: uploadRes.data.id });
        }

        const difyResponse = await axios({
            method: 'post',
            url: DIFY_API_URL,
            headers: { 'Authorization': `Bearer ${DIFY_API_KEY}`, 'Content-Type': 'application/json' },
            data: { inputs: {}, query: userMessage, response_mode: 'streaming', user: userId, files: difyFiles },
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
                    } catch (e) {}
                }
            }
        });

        return new Promise((resolve, reject) => {
            difyResponse.data.on('end', async () => {
                let finalMessageText = fullReply.trim();
                let messagesToSend = [];

                const flexRegex = /```flex\n([\s\S]*?)\n```/;
                const match = finalMessageText.match(flexRegex);

                if (match) {
                    try {
                        const products = JSON.parse(match[1]); 
                        finalMessageText = finalMessageText.replace(match[0], '').trim();

                        if (finalMessageText) messagesToSend.push({ type: 'text', text: finalMessageText });

                        const bubbles = products.map(p => {
                            let finalLink = p.link || "https://reurl.cc/pvD0Dx";
                            if (finalLink.includes('reurl.cc/pvD0Dx') || finalLink.includes('shopee.tw')) {
                                const searchKeyword = encodeURIComponent(p.name);
                                finalLink = `https://shopee.tw/shop/67350667/search?keyword=${searchKeyword}`;
                            }

                            return {
                                "type": "bubble",
                                "size": "micro",
                                "hero": {
                                    "type": "image",
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
                                        { "type": "text", "text": "茂暉嚴選", "color": "#ea580c", "size": "xs", "weight": "bold" },
                                        { "type": "text", "text": p.name || "精選商品", "weight": "bold", "size": "md", "wrap": true, "maxLines": 2, "margin": "sm", "color": "#1e293b" },
                                        { "type": "text", "text": p.desc || "高品質專業防護", "size": "xs", "color": "#64748b", "wrap": true, "maxLines": 2, "margin": "sm" },
                                        { "type": "separator", "margin": "lg", "color": "#f1f5f9" },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "margin": "md",
                                            "contents": [
                                                { "type": "text", "text": "NT$", "size": "xs", "color": "#ef4444", "align": "end", "gravity": "bottom", "flex": 1 },
                                                { "type": "text", "text": p.price ? `${p.price}` : "洽客服", "size": "xl", "color": "#ef4444", "weight": "bold", "align": "end", "flex": 4 }
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
                                        { "type": "button", "style": "primary", "color": "#ea580c", "height": "sm", "action": { "type": "uri", "label": "查看詳情", "uri": finalLink } }
                                    ]
                                }
                            };
                        });

                        messagesToSend.push({
                            "type": "flex",
                            "altText": "茂暉國際為您推薦專屬商品",
                            "contents": { "type": "carousel", "contents": bubbles.slice(0, 10) }
                        });

                    } catch (e) {
                        if (finalMessageText) messagesToSend.push({ type: 'text', text: finalMessageText });
                    }
                } else {
                    const fallbackText = finalMessageText || "⚠️ 老闆，Dify 大腦沒有回傳任何文字！";
                    messagesToSend.push({ type: 'text', text: fallbackText });
                }

                try {
                    await client.replyMessage({ replyToken: replyToken, messages: messagesToSend });
                    resolve('Success');
                } catch (error) {
                    reject(error);
                }
            });
        });

    } catch (error) {
        return client.replyMessage({
            replyToken: replyToken,
            messages: [{ type: 'text', text: `系統連線失敗：${error.message}` }]
        });
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`茂暉機器人已啟動，搭載 LIFF 光速關閉版！監聽 Port: ${port}`);
});
