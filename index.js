const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = '';

app.get('/', (req, res) => {
  if (qrCodeData) {
    res.send(`<h2>امسح رمز QR</h2><img src="${qrCodeData}" />`);
  } else {
    res.send('<h2>البوت متصل ✅</h2>');
  }
});
app.listen(PORT, () => console.log('Server running on port ' + PORT));

async function askGroq(text) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'انت بوت واتساب ذكي، رد بالعربية باختصار وود.' },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });
    const data = await res.json();
    if (data.error) {
      console.log('Groq Error:', data.error);
      return 'صار خطأ من Groq: ' + data.error.message;
    }
    return data.choices?.[0]?.message?.content || 'ما قدرت ارد الحين';
  } catch (e) {
    console.log('خطأ في الاتصال بـ Groq:', e);
    return 'ما قدرت ارد الحين، حاول بعد شوي';
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrCodeData = await qrcode.toDataURL(qr);
      console.log('QR جديد');
    }
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode!== DisconnectReason.loggedOut;
      console.log('سبب قطع الاتصال', lastDisconnect?.error);
      if (shouldReconnect) start();
    } else if (connection === 'open') {
      console.log('تم الاتصال بواتساب بنجاح');
      qrCodeData = '';
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!text) return;
    const from = msg.key.remoteJid;

    if (text === '!ping') {
      await sock.sendMessage(from, { text: 'pong! البوت شغال تمام ✅' });
      return;
    }

    // اي رسالة ثانية -> Groq
    await sock.sendMessage(from, { text: 'لحظة...' });
    const reply = await askGroq(text);
    await sock.sendMessage(from, { text: reply });
  });
}

start();
