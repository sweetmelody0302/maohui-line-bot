require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');
const FormData = require('form-data'); 
const Parser = require('rss-parser'); // [CTO 新增] Google 新聞雷達套件

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
// 【旗艦功能 1】：提供 LIFF 報價單網頁 
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
            .btn-success { background-color: #10b981 !important; color: white !important; }
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
                btn.innerText = '光速傳送中...';
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
                              text: \`【報價需求已送出】\\n公司：\${data.company}\\n聯絡人：\${data.name}\\n電話：\${data.phone}\\n品項：\${data.items}\\n數量：\${data.quantity}\`
                          }]).then(() => {
                              liff.closeWindow(); 
                          }).catch(err => {
                              console.error('LIFF 訊息傳送失敗', err);
                              liff.closeWindow(); 
                          });
                      } else {
                          btn.classList.add('btn-success');
                          btn.innerText = '已成功送出！請關閉此網頁回到 LINE';
                          alert('您的報價單已成功送出！請關閉此視窗回到 LINE。');
                          window.close(); 
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
// 【旗艦功能 2】：轉拋 Google Sheets (射後不理光速模式)
// ==========================================
app.post('/api/submit-lead', express.json(), (req, res) => {
    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    res.json({ success: true }); // 光速回傳給手機，讓表單瞬間關閉
    if (googleScriptUrl) {
        axios.post(googleScriptUrl, req.body)
            .then(() => console.log('✅ Google Sheets 背景寫入成功'))
            .catch(err => console.error('⚠️ Google Sheets 背景寫入失敗:', err.message));
    }
});

// ==========================================
// 【旗艦功能 3】：自動抓取工安新聞並廣播 (內容行銷必殺技)
// ==========================================
app.get('/api/broadcast-news', async (req, res) => {
    // 🛡️ CTO 專屬安全鎖：防止網路爬蟲或閒雜人等觸發廣播
    // 必須在網址後面加上 ?key=boss123 才能發射核彈！
    const secretKey = req.query.key;
    if (secretKey !== 'boss123') {
        return res.status(403).send('<h1>🚫 警告：老闆金鑰錯誤，無法發射廣播！</h1>');
    }

    try {
        const parser = new Parser();
        // 抓取 Google 新聞 (精準鎖定關鍵字：台灣 工安意外，7天內)
        const feed = await parser.parseURL('https://news.google.com/rss/search?q=%E5%8F%B0%E7%81%A3+%E5%B7%A5%E5%AE%89%E6%84%8F%E5%A4%96+when:7d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant');
        
        if (!feed.items || feed.items.length === 0) {
            return res.send('<h1>✅ 目前天下太平，最近 7 天沒有相關工安新聞喔！</h1>');
        }

        // 取前 3 則最新且最具震撼力的新聞
        const topNews = feed.items.slice(0, 3);
        
        // 組裝高質感 LINE Flex Message 輪播卡片
        const bubbles = topNews.map(news => {
            // 格式化日期 (轉成 YYYY/MM/DD)
            const pubDate = new Date(news.pubDate);
            const dateStr = pubDate.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
            
            // 處理摘要 (過濾 HTML 標籤，截斷字數防跑版)
            let snippet = news.contentSnippet || news.content || '點擊查看詳細新聞內容';
            snippet = snippet.replace(/<[^>]*>?/gm, '').trim();
            if (snippet.length > 55) snippet = snippet.substring(0, 55) + '...';

            return {
                "type": "bubble",
                "size": "micro",
                "header": {
                    "type": "box",
                    "layout": "vertical",
                    "backgroundColor": "#dc2626", // 警告紅底，吸引眼球
                    "paddingAll": "12px",
                    "contents": [
                        { "type": "text", "text": "⚠️ 最新工安快訊", "color": "#ffffff", "weight": "bold", "size": "xs" }
                    ]
                },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "paddingAll": "15px",
                    "contents": [
                        { "type": "text", "text": dateStr, "color": "#ea580c", "size": "xxs", "weight": "bold", "margin": "none" },
                        { "type": "text", "text": news.title, "weight": "bold", "size": "sm", "wrap": true, "maxLines": 3, "margin": "sm", "color": "#1e293b" },
                        { "type": "text", "text": snippet, "size": "xs", "color": "#64748b", "wrap": true, "maxLines": 3, "margin": "md" }
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
                            "color": "#ea580c", // 茂暉橘
                            "height": "sm",
                            "action": { "type": "uri", "label": "閱讀全文", "uri": news.link }
                        }
                    ]
                }
            };
        });

        // 👑 業務小心機：在新聞最後硬塞一張「關心＋引導下單」的卡片！
        bubbles.push({
            "type": "bubble",
            "size": "micro",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#1e293b", // 企業深藍底
                "paddingAll": "12px",
                "contents": [
                    { "type": "text", "text": "🛡️ 茂暉工安防護", "color": "#ffffff", "weight": "bold", "size": "xs" }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "paddingAll": "15px",
                "contents": [
                    { "type": "text", "text": "防患未然，安全無價", "weight": "bold", "size": "sm", "wrap": true, "color": "#ea580c" },
                    { "type": "text", "text": "工安意外頻傳，您的防護裝備升級了嗎？立刻聯繫茂暉專員，為您的企業安全把關！", "size": "xs", "color": "#64748b", "wrap": true, "maxLines": 4, "margin": "md" }
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
                            "label": "大宗採購報價",
                            // 動態抓取 LIFF 網址
                            "uri": "https://liff.line.me/" + (process.env.LIFF_ID || "2009580591-79qXbnPt")
                        }
                    }
                ]
            }
        });

        // 呼叫 LINE API 廣播給所有好友
        await client.broadcast({
            "type": "flex",
            "altText": "⚠️ 本週最新工安快訊與防護建議",
            "contents": { "type": "carousel", "contents": bubbles }
        });

        res.send('<h1>🚀 報告老闆！成功抓取最新新聞，並已光速廣播給所有 LINE 粉絲！</h1>');
        console.log('✅ 新聞廣播成功！');

    } catch (error) {
        console.error('新聞廣播失敗:', error);
        res.status(500).send('<h1>❌ 廣播失敗，請查看伺服器 Log：</h1><p>' + error.message + '</p>');
    }
});

app.get('/', (req, res) => res.send('茂暉國際中繼站運作正常！(已搭載新聞廣播核彈版)'));

// ==========================================
// 【旗艦功能 4】：LINE Webhook 核心處理 (AI 對話與客服)
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

    // 【完美閉環】攔截客人的表單確認文字，發送尊榮回覆！
    if (userMessage.includes('【報價需求已送出】')) {
        return client.replyMessage({
            replyToken: replyToken,
            messages: [{ 
                type: 'text', 
                text: '🎉 老闆您好！您的專屬採購需求我們已經收到囉！\n\n茂暉業務團隊正在為您精算【最優惠的專屬批發價】💰，我們將用最快的速度親自為您報價，請稍候片刻！非常感謝您的支持😊' 
            }]
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
    console.log(`茂暉機器人已啟動，搭載新聞廣播核彈版！監聽 Port: ${port}`);
});
