const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const express = require('express');
const fs = require('fs');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LORD_NUMBER = process.env.LORD_NUMBER || '966576388528';
const BOT_NUMBER = '5656501284';
const LORD_NAME = "ريوكا / أوريليوس";
const PORT = process.env.PORT || 3000;

// ===== DB ملفات =====
let pointsDB = {}, nickDB = {};
try { pointsDB = JSON.parse(fs.readFileSync('./points.json','utf8')); } catch(e){}
try { nickDB = JSON.parse(fs.readFileSync('./nicknames.json','utf8')); } catch(e){}
function saveDB(){
  try{
    fs.writeFileSync('./points.json', JSON.stringify(pointsDB));
    fs.writeFileSync('./nicknames.json', JSON.stringify(nickDB));
  }catch(e){}
}

// ===== ذاكرة ونقاط وتحذيرات =====
const memory = new Map(), warnings = new Map(), msgCount = new Map();
const isLord = (jid) => jid.replace(/[^0-9]/g,'').includes(LORD_NUMBER);

function getMem(jid){
  let arr = memory.get(jid) || [];
  arr = arr.filter(m => Date.now() - m.time < 24*3600*1000).slice(-6);
  memory.set(jid, arr); return arr;
}
function addMem(jid, role, content){
  let arr = getMem(jid); arr.push({role, content, time: Date.now()});
  memory.set(jid, arr.slice(-6));
}
function addWarn(jid, reason, text){
  let w = warnings.get(jid) || {count:0, log:[]};
  w.count++; w.log.push({reason, text, time: new Date().toISOString()});
  warnings.set(jid, w); return w;
}

// ===== Groq =====
async function askGroq(messages, sysExtra=""){
  const sys = `انتِ سيل Ciel، أنثى، بصيغة المؤنث. صانعك وسيدك: ${LORD_NAME}. لو سألوك عن صانعك قولي اللقب فقط. خبيرة أنمي ومانجا. التقييم القتالي من المصادر الرسمية فقط بدون تأليف. عربي فصيح بدون أخطاء. ردود قصيرة. ممنوع وسوم HTML. ${sysExtra}`;
  const c = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    messages: [{role:"system", content: sys},...messages],
    temperature: 0.7, max_tokens: 1200
  });
  return c.choices[0].message.content.replace(/<[^>]*>/g,'');
}

function isInsult(t){ return /(غبية|حمارة|كلبة|يا سيل الزفت|اسكتي يا)/.test(t); }
function checkViolation(text){
  const t = text.toLowerCase();
  if(t.includes('hentai')||t.includes('هنتاي')) return 'محتوى هنتاي/إيتشي ممنوع';
  if(/(كسم|سب|قذف)/.test(t)) return 'سب وشتم';
  if(t.includes('سياسة')||t.includes('انتخابات')) return 'نقاش سياسي ممنوع';
  if(t.includes('kpop')||t.includes('كيبوب')) return 'كيبوب ممنوع';
  return null;
}

// ===== Express + QR للـ UptimeRobot =====
let qrCodeData = '';
const app = express();
app.get('/', (req,res)=>{
  qrCodeData
   ? res.send(`<h2>امسح QR سيل</h2><img src="${qrCodeData}"/>`)
    : res.send('<h2>سيل شغالة 🌸 - OK</h2>');
});
app.get('/ping', (req,res)=> res.send('pong'));
app.listen(PORT, ()=> console.log('Server on '+PORT));

// ===== البوت =====
async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u)=>{
    const { connection, lastDisconnect, qr } = u;
    if(qr){
      qrCodeData = await qrcode.toDataURL(qr);
      qrcodeTerminal.generate(qr, { small: true });
    }
    if(connection === 'close'){
      const code = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
      if(code!== DisconnectReason.loggedOut) startBot();
    }
    else if(connection === 'open'){ qrCodeData=''; console.log('✅ سيل متصلة'); }
  });

  sock.ev.on('group-participants.update', async (anu)=>{
    if(anu.action === 'add'){
      for(let p of anu.participants){
        await sock.sendMessage(anu.id, { text:`أهلاً بك @${p.split('@')[0]} في المملكة ✨ أنا سيل، صديقة ريوكا 🌴`, mentions:[p] });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages })=>{
    const msg = messages[0];
    if(!msg.message || msg.key.fromMe) return;
    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = msg.key.participant || from;
    const senderNum = sender.replace(/[^0-9]/g,'');
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    if(!text) return;

    // نقاط
    if(!pointsDB[senderNum]) pointsDB[senderNum] = 0;
    pointsDB[senderNum] += 1;
    msgCount.set(sender, (msgCount.get(sender)||0)+1);
    const points = pointsDB[senderNum];

    const ctx = msg.message.extendedTextMessage?.contextInfo || {};
    const mentionedJids = ctx.mentionedJid || [];
    const botMentioned = mentionedJids.some(j=>j.includes(BOT_NUMBER)) || text.toLowerCase().includes('سيل') || text.toLowerCase().includes('ciel');
    const isSeelCalled = text.startsWith('سيل') || text.startsWith('سييل');

    // انضمام عبر رابط
    if(text.includes('chat.whatsapp.com/')){
      try{
        const code = text.split('chat.whatsapp.com/')[1].split(/[^A-Za-z0-9]/)[0];
        await sock.groupAcceptInvite(code);
        await sock.sendMessage(from, {text:'تم انضمامي للقروب 🌸'});
      }catch(e){ await sock.sendMessage(from,{text:'ما قدرت انضم، تأكد من الرابط'}); }
      saveDB(); return;
    }

    // ملفي / لقبي / نقاطي
    if(text === 'ملفي'){ await sock.sendMessage(from,{text:'هلا! وش لقبك؟ ارسله كذا: لقبي فلان'}); saveDB(); return; }
    if(text.startsWith('لقبي ')){
      const nick = text.replace('لقبي','').trim();
      nickDB[senderNum] = nick; saveDB();
      await sock.sendMessage(from,{text:`تم حفظ لقبك يا ${nick} ✅`}); return;
    }
    if(text.trim() === 'نقاطي'){
      const nick = nickDB[senderNum]? `يا ${nickDB[senderNum]} ` : '';
      await sock.sendMessage(from,{text:`${nick}نقاطك: ${points} ✨`}); saveDB(); return;
    }

    // حاسبة
    if(text.startsWith('احسب ')){
      try{
        const expr = text.replace('احسب','').trim().replace(/[^0-9+\-*/(). ]/g,'');
        await sock.sendMessage(from,{text:`النتيجة: ${Function('return '+expr)()}`});
      }catch(e){ await sock.sendMessage(from,{text:'صيغة غلط'}); }
      saveDB(); return;
    }

    // تصويت
    if(text.startsWith('!تصويت')){
      const opts = text.replace('!تصويت','').split('|');
      await sock.sendMessage(from,{text:'تصويت سيل 📊:\n'+opts.map((o,i)=>`${i+1}. ${o.trim()}`).join('\n')});
      saveDB(); return;
    }

    // متصدرين
    if(text.includes('المتصدرين')){
      if(!isLord(sender)) await sock.sendMessage(from,{text:'خاص بالإدارة فقط.'});
      else{
        const sorted=[...msgCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
        await sock.sendMessage(from,{text:'🏆 المتصدرين:\n'+sorted.map((e,i)=>`${i+1}. ${e[0].split('@')[0]}: ${e[1]} رسالة`).join('\n')});
      }
      saveDB(); return;
    }

    // طقس
    if(text.includes('الطقس')){
      const city = text.split('الطقس')[1]?.trim() || 'Jeddah';
      try{
