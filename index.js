require('http').createServer((req,res)=>res.end('bot running')).listen(process.env.PORT||3000);
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state, logger: require('pino')({level:'silent'}) });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if(qr) qrcode.generate(qr, {small:true});
    if(connection === 'close'){
      const code = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
      if(code!== DisconnectReason.loggedOut) start();
    } else if(connection === 'open') console.log('Bot connected!');
  });
  sock.ev.on('messages.upsert', async ({messages}) => {
    const msg = messages[0];
    if(!msg.message || msg.key.fromMe) return;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if(text === '!ping') await sock.sendMessage(msg.key.remoteJid, {text: 'pong!'});
  });
}
start();
