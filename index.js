const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
let qrCodeData = '';
app.get('/', (req,res)=>{ qrCodeData? res.send(`<h2>امسح QR سيل</h2><img src="${qrCodeData}"/>`) : res.send('<h2>سيل متصلة ✅</h2>'); });
app.listen(PORT,()=>console.log('Ciel running'));

// ===== ذاكرة ونقاط وتحذيرات =====
const memory = new Map(); // jid -> [{role,content,time}]
const xp = new Map(); const warnings = new Map(); const msgCount = new Map();
const LORD_NAME = "ريوكا / أوريليوس";
const isLord = (jid)=> jid.includes(process.env.LORD_NUMBER || ''); // حط رقمك في Render Env باسم LORD_NUMBER

function getMem(jid){
  let arr = memory.get(jid)||[];
  const now = Date.now();
  arr = arr.filter(m=> now - m.time < 24*3600*1000).slice(-6);
  memory.set(jid,arr); return arr;
}
function addMem(jid,role,content){
  let arr = getMem(jid); arr.push({role,content,time:Date.now()});
  memory.set(jid,arr.slice(-6));
}
function addXP(jid,n=1){ xp.set(jid,(xp.get(jid)||0)+n); }
function addWarn(jid,reason,text){
  let w = warnings.get(jid)||{count:0,log:[]};
  w.count++; w.log.push({reason,text,time:new Date().toISOString()});
  warnings.set(jid,w); return w;
}

async function askGroq(messages, sysExtra=""){
  const sys = `انتِ سيل Ciel، أنثى، تتحدثين بصيغة المؤنث بالعربية العامية الخليجية الخفيفة. صانعك وسيدك: ${LORD_NAME} (محمد يحيى). لو سألوك عن صانعك قولي اللقب فقط. لو طلبوا تفاصيل أكثر قولي: "لا، عذراً لا أستطيع الإفصاح عن تفاصيل أخرى." خبيرة أنمي ومانجا ومانهوا وروايات خفيفة، والتقييم القتالي يكون من المصادر الرسمية فقط بدون تأليف. ${sysExtra}`;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',
    headers:{'Authorization':`Bearer ${process.env.GROQ_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({model:'openai/gpt-oss-120b', messages:[{role:'system',content:sys},...messages], temperature:0.7, max_tokens:1200})
  });
  const d=await res.json(); return d.choices?.[0]?.message?.content || 'عذراً، لم أستطع الرد.';
}

// فحص إهانة لسيل
function isInsult(t){ return /(غبية|حمارة|كلبة|يا سيل الزفت|اسكتي يا)/.test(t); }
// فحص مخالفات مبسط
function checkViolation(text){
  const t=text.toLowerCase();
  if(t.includes('hentai')||t.includes('هنتاي')) return 'محتوى هنتاي/إيتشي ممنوع';
  if(/(كسم|سب|قذف)/.test(t)) return 'سب وشتم';
  if(t.includes('سياسة')||t.includes('انتخابات')) return 'نقاش سياسي ممنوع';
  if(t.includes('kpop')||t.includes('كيبوب')) return 'كيبوب ممنوع';
  return null;
}

async function start(){
  const {state,saveCreds}=await useMultiFileAuthState('auth_info');
  const sock=makeWASocket({auth:state,printQRInTerminal:true});
  sock.ev.on('creds.update',saveCreds);
  sock.ev.on('connection.update',async(u)=>{
    const {connection,lastDisconnect,qr}=u;
    if(qr) qrCodeData=await qrcode.toDataURL(qr);
    if(connection==='close'){ if((lastDisconnect?.error instanceof Boom)?.output?.statusCode!==DisconnectReason.loggedOut) start(); }
    else if(connection==='open'){ qrCodeData=''; console.log('Ciel connected'); }
  });

  // ترحيب تلقائي
  sock.ev.on('group-participants.update',async(u)=>{
    if(u.action==='add'){
      for(let p of u.participants){
        await sock.sendMessage(u.id,{text:`أهلاً بك @${p.split('@')[0]} في المملكة ✨ أنا سيل، صديقة ريوكا 🌴`,mentions:[p]});
      }
    }
  });

  sock.ev.on('messages.upsert',async(m)=>{
    const msg=m.messages[0]; if(!msg.message||msg.key.fromMe) return;
    const from=msg.key.remoteJid; const isGroup=from.endsWith('@g.us');
    const text=msg.message.conversation||msg.message.extendedTextMessage?.text||'';
    const sender=msg.key.participant||from;
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid||[];
    const botMentioned = text.toLowerCase().includes('سيل')||text.toLowerCase().includes('ciel')||mentioned.length>0;

    // XP صامت + عد رسائل
    addXP(sender,1); msgCount.set(sender,(msgCount.get(sender)||0)+1);

    // وضع التخفي في القروبات
    if(isGroup &&!botMentioned &&!text.startsWith('!') && text!=='نقاطي'){
      // فحص مخالفات بصمت وتسجيل
      const v=checkViolation(text);
      if(v){ const w=addWarn(sender,v,text); console.log(`Violation ${sender}: ${v}`); }
      return;
    }

    addMem(sender,'user',text);
    let reply=null;

    // MODULE 11: ACL
    if(text.includes('اعرضي القائمة 001')){
      if(!isLord(sender)){ reply='هذا الأمر خاص بسيدي ريوكا فقط.'; }
      else{
        let out='— قائمة سيل السرية 001 —\n';
        for(let [k,v] of warnings){ out+=`${k}: ${v.count} تحذيرات | ${JSON.stringify(v.log.slice(-2))}\n`; }
        out+=`\nالنقاط:\n`; for(let [k,v] of xp) out+=`${k}: ${v}\n`;
        reply=out||'لا بيانات.';
      }
    }
    else if(text.includes('التقارير 007')){
      reply=`تقارير (قراءة فقط):\nتحذيرات: ${warnings.size}\nنقاط مسجلة: ${xp.size}`;
    }
    // MODULE 13 نقاطي
    else if(text.trim()==='نقاطي'){ reply=`نقاطك: ${xp.get(sender)||0} ✨`; }
    // MODULE 6 حاسبة
    else if(/^احسب /.test(text)){
      try{ const expr=text.replace('احسب ','').replace(/[^0-9+\-*/(). ]/g,''); reply=`النتيجة: ${Function('return '+expr)()}`; }catch{ reply='صيغة غير صحيحة.'; }
    }
    // MODULE 4 تصويت
    else if(text.startsWith('!تصويت')){
      const opts=text.replace('!تصويت','').split('|'); reply=`تصويت سيل 📊:\n`+opts.map((o,i)=>`${i+1}. ${o.trim()}`).join('\n');
    }
    // MODULE 7 ليدربورد (أدمن فقط - تبسيط: اللورد)
    else if(text.includes('المتصدرين')){
      if(!isLord(sender)) reply='خاص بالإدارة فقط.';
      else{ const sorted=[...msgCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5); reply='🏆 المتصدرين:\n'+sorted.map((e,i)=>`${i+1}. ${e[0].split('@')[0]}: ${e[1]} رسالة`).join('\n'); }
    }
    // MODULE 8 طقس
    else if(text.includes('الطقس')){
      const city=text.split('الطقس')[1]?.trim()||'Jeddah';
      try{ const r=await fetch(`https://wttr.in/${city}?format=3`); reply=await r.text(); }catch{ reply='لم أستطع جلب الطقس.'; }
    }
    // MODULE 2 ملخص
    else if(text.includes('ملخص')){
      const mem=getMem(sender); reply=await askGroq(mem.map(x=>({role:x.role,content:x.content})),"لخص المحادثة الأخيرة باختصار.");
      return;
    }
    // بروتوكول ضد الإهانة
    else if(isInsult(text)){
      const w=addWarn(sender,'إهانة سيل',text);
      reply=`⚠️ تحذير رسمي: يمنع إهانة سيل. لديك الآن ${w.count} تحذير. عند 4 تحذيرات = حظر مؤقت يومين، وعند 6 = حظر دائم.`;
    }
    // فحص مخالفات عام
    else {
      const v=checkViolation(text);
      if(v){
        const w=addWarn(sender,v,text);
        if(w.count>=6) reply=`🚫 حظر دائم (مؤبد) بسبب: ${v}`;
        else if(w.count>=4) reply=`⛔ حظر مؤقت يومين بسبب: ${v} (تحذير رقم ${w.count})`;
        else reply=`⚠️ تحذير ${w.count}: ${v}. مسجل بتاريخ ${new Date().toLocaleString('ar')}`;
      } else {
        // MODULE 10 + 9 + رد عام ذكي
        const mem=getMem(sender);
        reply=await askGroq([...mem.map(x=>({role:x.role,content:x.content}))]);
      }
    }

    // MODULE 5 ستيكر بعلامة مائية
    if(msg.message.imageMessage && botMentioned){
      await sock.sendMessage(from,{sticker:{url:msg.message.imageMessage.url},packname:'—SIEL 🌴 STICKERS • ★ صديقة ريمورو ★'},{quoted:msg});
      return;
    }

    if(reply){ addMem(sender,'assistant',reply); await sock.sendMessage(from,{text:reply},{quoted:msg}); }
  });
}
start();
