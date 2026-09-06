const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
let qrCodeData = null;
let isConnected = false;

async function askGroq(text) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'أنت بوت واتساب ذكي اسمك سيل، رد بالعربية باختصار وود.' },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'ما قدرت أرد الحين.';
  } catch (e) {
    console.error(e);
    return 'صار خطأ في الاتصال بـ Groq.';
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: true });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrCodeData = await QRCode.toDataURL(qr);
      isConnected = false;
      console.log('QR جديد جاهز');
    }
    if (connection === 'open') {
      qrCodeData = null; isConnected = true;
      console.log('تم الاتصال بواتساب بنجاح');
    }
    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!text) return;
    const from = msg.key.remoteJid;

    if (text.trim() === '!ping') {
      await sock.sendMessage(from, { text: 'pong! البوت شغال تمام' });
      return;
    }

    // أي رسالة ثانية -> Groq يرد
    if (text.startsWith('!')) return; // تجاهل أوامر غير معروفة
    await sock.sendPresenceUpdate('composing', from);
    const reply = await askGroq(text);
    await sock.sendMessage(from, { text: reply }, { quoted: msg });
  });
}

app.get('/', (req, res) => {
  if (isConnected) return res.send('<h1 style="text-align:center;font-family:sans-serif">✅ البوت متصل</h1>');
  if (qrCodeData) return res.send(`<div style="text-align:center;font-family:sans-serif"><h2>امسح QR للربط</h2><img src="${qrCodeData}" style="width:300px"><script>setTimeout(()=>location.reload(),20000)</script></div>`);
  res.send('<h2 style="text-align:center">جاري التشغيل...</h2><script>setTimeout(()=>location.reload(),3000)</script>');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('السيرفر شغال');
  startBot();
});
