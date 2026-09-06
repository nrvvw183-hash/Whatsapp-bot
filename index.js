const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
let lastQR = '';

app.get('/', async (req, res) => {
    if (!lastQR) {
        return res.send('<h2>البوت متصل بالفعل أو جاري توليد QR... حدث الصفحة بعد 10 ثواني</h2><script>setTimeout(()=>location.reload(),10000)</script>');
    }
    try {
        const qrImage = await QRCode.toDataURL(lastQR);
        res.send(`<h2 style="font-family:sans-serif">امسح QR بالرقم الثاني</h2><img src="${qrImage}" width="300" /><br><p>تتحدث تلقائيا كل 10 ثواني</p><script>setTimeout(()=>location.reload(),10000)</script>`);
    } catch (e) {
        res.send('خطأ في توليد QR');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('السيرفر شغال على البورت ' + PORT));

async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            lastQR = qr;
            console.log('QR جديد جاهز - افتح رابط الموقع لرؤيته');
        }

        if (connection === 'open') {
            lastQR = '';
            console.log('تم الاتصال بواتساب بنجاح');
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log('انقطع الاتصال، الكود:', statusCode);
            if (statusCode!== DisconnectReason.loggedOut) {
                console.log('إعادة الاتصال...');
                start();
            } else {
                console.log('تم تسجيل الخروج، امسح QR من جديد');
                lastQR = '';
                start();
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        // ===== ضع أوامرك هنا =====
        if (text === '!ping') {
            await sock.sendMessage(from, { text: 'pong! البوت شغال تمام' });
        }

        if (text === '!السلام') {
            await sock.sendMessage(from, { text: 'وعليكم السلام ورحمة الله' });
        }
        // ========================
    });
}

start();
