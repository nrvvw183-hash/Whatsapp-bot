const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const qrcode = require('qrcode')
const qrcodeTerminal = require('qrcode-terminal')
const fs = require('fs')
const { GoogleGenAI } = require('@google/genai')

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const LORD_NUMBER = '966576388528'
const LORD_NAME = "ريوكا (أوريليوس - السلايم)"
const PORT = process.env.PORT || 3000
const SIGN = `\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`

// ---------- DB ----------
let DB = { points:{}, nick:{}, muted:{}, warnings:{}, bans:{}, words:[], settings:{}, logs:{} }
for(let k of Object.keys(DB)){ try{ DB[k]=JSON.parse(fs.readFileSync('./'+k+'.json','utf8')) }catch(e){} }
function saveDB(){ for(let k of Object.keys(DB)){ try{ fs.writeFileSync('./'+k+'.json', JSON.stringify(DB[k])) }catch(e){} } }
// backup كل ساعة
setInterval(()=>{ try{ fs.copyFileSync('./points.json','./backup_points.json') }catch(e){} }, 3600000)

const memory = new Map()
const spamDB = new Map()
const isLord = (jid='') => jid.replace(/[^0-9]/g,'').includes(LORD_NUMBER)

function getMem(jid){
  let arr = (memory.get(jid)||[]).filter(m=>Date.now()-m.time<24*3600*1000).slice(-10)
  memory.set(jid,arr); return arr
}
function addMem(jid,role,content){ let a=getMem(jid); a.push({role,content,time:Date.now()}); memory.set(jid,a.slice(-10)) }

async function isAdmin(sock,from,sender){
  if(!from.includes('@g.us')) return false
  if(isLord(sender)) return true
  try{
    const meta=await sock.groupMetadata(from)
    return meta.participants.filter(p=>p.admin).map(p=>p.id).includes(sender)
  }catch(e){ return false }
}
function getSettings(from){
  if(!DB.settings[from]) DB.settings[from]={ antiLink:true, antiSpam:true, allowedMedia:{image:true,sticker:true,audio:true,video:true}, warnLimit:3 }
  return DB.settings[from]
}
function addLog(num,action,by){
  if(!DB.logs[num]) DB.logs[num]=[]
  DB.logs[num].push({action,by,time:new Date().toLocaleString('ar-SA')})
  if(DB.logs[num].length>50) DB.logs[num]=DB.logs[num].slice(-50)
  saveDB()
}
async function punish(sock,from,targetJid,targetNum,reason,msg,type='warn'){
  if(isLord(targetJid)) return
  if(await isAdmin(sock,from,targetJid)) return
  const st=getSettings(from)
  DB.warnings[targetNum]=DB.warnings[targetNum]||[]
  DB.warnings[targetNum].push({reason,type,time:new Date().toLocaleString('ar-SA')})
  addLog(targetNum,`تحذير: ${reason}`,msg?.key?.participant||'system')
  const c=DB.warnings[targetNum].length
  if(c>=st.warnLimit){
    DB.muted[targetNum]=true; saveDB()
    await sock.sendMessage(from,{text:`🚫 ${targetNum} وصل ${c} تحذيرات وتم كتمه.\n📌 ${reason}${SIGN}`})
  }else{
    saveDB()
    await sock.sendMessage(from,{text:`⚠️ تحذير ${c}/${st.warnLimit} لـ ${targetNum}\n📌 السبب: ${reason}`,},{quoted:msg})
  }
}

async function askGemini(messages,isAdminUser){
  const sys=`أنتِ Ciel (سيل)، كيان إداري ذكي. سيدك المطلق ${LORD_NAME}. التوقيع: [N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰].
  الصلاحية: ${isAdminUser?'مشرف':'عضو'}. كوني صارمة ودقيقة. ممنوع مخالفة القوانين.`
  const contents=messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}))
  // retry 3 مرات ضد 503
  for(let i=0;i<3;i++){
    try{
      const r=await ai.models.generateContent({model:'gemini-3.6-flash',contents,config:{systemInstruction:sys,temperature:0.3,maxOutputTokens:800}})
      return r.text
    }catch(e){ if(i===2) throw e; await new Promise(r=>setTimeout(r,2000)) }
  }
}

let qrCodeData=''
const app=express()
app.get('/',(req,res)=>{ qrCodeData?res.send(`<h2>امسح QR سيل</h2><img src="${qrCodeData}"/>`):res.send('<h2>سيل شغالة - OK</h2>') })
app.get('/ping',(req,res)=>res.send('pong'))
app.listen(PORT,()=>console.log('Server on '+PORT))

async function startBot(){
  const {state,saveCreds}=await useMultiFileAuthState('auth_info_v2')
  const sock=makeWASocket({auth:state,connectTimeoutMs:60000,retryRequestDelayMs:5000,defaultQueryTimeoutMs:60000})
  sock.ev.on('creds.update',saveCreds)
  sock.ev.on('connection.update',async(u)=>{
    const {connection,lastDisconnect,qr}=u
    if(qr){ qrCodeData=await qrcode.toDataURL(qr); qrcodeTerminal.generate(qr,{small:true}) }
    if(connection==='close'){
      const code=(lastDisconnect?.error instanceof Boom)?.output?.statusCode
      if(code!==DisconnectReason.loggedOut){ console.log('إعادة اتصال...'); setTimeout(startBot,5000) }
    }else if(connection==='open'){ qrCodeData=''; console.log('سيل متصلة ⚡') }
  })

  sock.ev.on('messages.upsert',async({messages})=>{
    try{
    const msg=messages[0]
    if(!msg.message||msg.key.fromMe) return
    const from=msg.key.remoteJid
    const sender=msg.key.participant||from
    const senderNum=sender.replace(/[^0-9]/g,'')
    if(DB.bans[senderNum]) return
    if(DB.muted[senderNum]) return

    const text=(msg.message.conversation||msg.message.extendedTextMessage?.text||'').trim()
    const hasImage=!!msg.message.imageMessage, hasSticker=!!msg.message.stickerMessage, hasAudio=!!msg.message.audioMessage, hasVideo=!!msg.message.videoMessage
    const mentioned=msg.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
    const botNum=(sock.user?.id||'').replace(/[^0-9]/g,'')
    const isBotMentioned=mentioned.some(j=>j.replace(/[^0-9]/g,'').includes(botNum))||text.includes('سيل')
    const userIsAdmin=await isAdmin(sock,from,sender)
    const st=getSettings(from)

    // --- حماية تلقائية ---
    if(from.includes('@g.us')&&!userIsAdmin){
      if(st.antiLink&&/https?:\/\/|www\./i.test(text)){
        try{ await sock.sendMessage(from,{delete:msg.key}) }catch(e){}
        await punish(sock,from,sender,senderNum,'نشر رابط ممنوع',msg); return
      }
      if(DB.words.some(w=>text.includes(w))){
        try{ await sock.sendMessage(from,{delete:msg.key}) }catch(e){}
        await punish(sock,from,sender,senderNum,'كلمة ممنوعة',msg); return
      }
      if(st.antiSpam){
        const now=Date.now(), arr=(spamDB.get(senderNum)||[]).filter(t=>now-t<10000)
        arr.push(now); spamDB.set(senderNum,arr)
        if(arr.length>=7){ spamDB.set(senderNum,[]); await punish(sock,from,sender,senderNum,'سبام رسائل',msg); return }
      }
      if(hasSticker&&!st.allowedMedia.sticker){ try{await sock.sendMessage(from,{delete:msg.key})}catch(e){}; await punish(sock,from,sender,senderNum,'ملصقات ممنوعة',msg); return }
      if(hasImage&&!st.allowedMedia.image){ try{await sock.sendMessage(from,{delete:msg.key})}catch(e){}; return }
      if(hasAudio&&!st.allowedMedia.audio){ try{await sock.sendMessage(from,{delete:msg.key})}catch(e){}; return }
      if(hasVideo&&!st.allowedMedia.video){ try{await sock.sendMessage(from,{delete:msg.key})}catch(e){}; return }
    }

    // --- أوامر الإدارة ---
    if(userIsAdmin){
      if(text==='سيل الأوامر'){
        await sock.sendMessage(from,{text:`📜 *أوامر سيل:*\n\n👑 إدارة:\n- تحذير @عضو سبب\n- فك تحذير @عضو\n- كتم @عضو / فك كتم @عضو\n- طرد @عضو / بان @عضو / فك بان @عضو\n- ترقية @عضو / تنزيل @عضو\n- قفل القروب / فتح القروب\n- منع روابط / سماح روابط\n- إضافة كلمة [كلمة] / حذف كلمة [كلمة]\n- تغيير الاسم [اسم] / تغيير الوصف [وصف]\n\n⭐ نقاط:\n- إضافة 10 @عضو / خصم 10 @عضو\n- المتصدرين / نقاطي / ملفي\n\n${SIGN}`},{quoted:msg}); return
      }
      if(text.startsWith('تحذير')){ const t=mentioned[0]; const tn=t?.replace(/[^0-9]/g,''); const rs=text.replace('تحذير','').replace(/@[0-9]+/g,'').trim()||'مخالفة'; if(t) await punish(sock,from,t,tn,rs,msg); return }
      if(text.startsWith('فك تحذير')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||text.replace(/[^0-9]/g,''); if(DB.warnings[tn]){DB.warnings[tn].pop(); saveDB()} await sock.sendMessage(from,{text:`✅ تم فك تحذير. المتبقي: ${(DB.warnings[tn]||[]).length}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('بان')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||text.replace(/[^0-9]/g,''); if(tn&&!isLord(mentioned[0]||'')){ DB.bans[tn]={reason:'بان إداري',time:new Date().toLocaleString('ar-SA')}; addLog(tn,'بان',senderNum); await sock.sendMessage(from,{text:`🔨 تم حظر ${tn}${SIGN}`},{quoted:msg}) } return }
      if(text.startsWith('فك بان')){ const tn=text.replace(/[^0-9]/g,''); delete DB.bans[tn]; saveDB(); await sock.sendMessage(from,{text:`✅ تم فك البان عن ${tn}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('ترقية')){ if(mentioned[0]) await sock.groupParticipantsUpdate(from,[mentioned[0]],"promote"); return }
      if(text.startsWith('تنزيل')){ if(mentioned[0]) await sock.groupParticipantsUpdate(from,[mentioned[0]],"demote"); return }
      if(text==='قفل القروب'){ await sock.groupSettingUpdate(from,'announcement'); await sock.sendMessage(from,{text:`🔒 تم قفل القروب${SIGN}`},{quoted:msg}); return }
      if(text==='فتح القروب'){ await sock.groupSettingUpdate(from,'not_announcement'); await sock.sendMessage(from,{text:`🔓 تم فتح القروب${SIGN}`},{quoted:msg}); return }
      if(text==='منع روابط'){ st.antiLink=true; saveDB(); await sock.sendMessage(from,{text:`✅ تم تفعيل منع الروابط${SIGN}`},{quoted:msg}); return }
      if(text==='سماح روابط'){ st.antiLink=false; saveDB(); await sock.sendMessage(from,{text:`✅ تم السماح بالروابط${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('إضافة كلمة')){ const w=text.replace('إضافة كلمة','').trim(); if(w){DB.words.push(w); saveDB()} await sock.sendMessage(from,{text:`✅ تمت إضافة الكلمة: ${w}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('تغيير الاسم')){ const n=text.replace('تغيير الاسم','').trim(); if(n) await sock.groupUpdateSubject(from,n); return }
      if(text.startsWith('تغيير الوصف')){ const d=text.replace('تغيير الوصف','').trim(); if(d) await sock.groupUpdateDescription(from,d); return }
      if(text.startsWith('طرد')){ let t=mentioned[0]||((text.replace(/[^0-9]/g,'').length>8)?text.replace(/[^0-9]/g,'')+'@s.whatsapp.net':null); if(t){ try{await sock.groupParticipantsUpdate(from,[t],"remove")}catch(e){} } return }
      if(text.startsWith('كتم ')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||text.replace(/[^0-9]/g,''); if(tn){DB.muted[tn]=true; saveDB(); await sock.sendMessage(from,{text:`🔇 تم كتم ${tn}${SIGN}`},{quoted:msg})} return }
      if(text.startsWith('فك كتم')){ const tn=text.replace(/[^0-9]/g,''); delete DB.muted[tn]; saveDB(); await sock.sendMessage(from,{text:`🔊 تم فك الكتم عن ${tn}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('إضافة ')){ const p=text.split(' ').filter(Boolean); let tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum, amt=0; for(let x of p){ if(!isNaN(x)&&x!=='إضافة') amt=parseInt(x) } DB.points[tn]=(DB.points[tn]||0)+amt; addLog(tn,`+${amt} نقطة`,senderNum); await sock.sendMessage(from,{text:`✅ تم إضافة ${amt} لـ ${tn}. الحالي: ${DB.points[tn]}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('خصم ')){ const p=text.split(' ').filter(Boolean); let tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum, amt=0; for(let x of p){ if(!isNaN(x)&&x!=='خصم') amt=parseInt(x) } DB.points[tn]=(DB.points[tn]||0)-amt; addLog(tn,`-${amt} نقطة`,senderNum); await sock.sendMessage(from,{text:`⚠️ تم خصم ${amt} من ${tn}. الحالي: ${DB.points[tn]}${SIGN}`},{quoted:msg}); return }
    }

    if(text==='المتصدرين'){ let arr=Object.entries(DB.points).sort((a,b)=>b[1]-a[1]).slice(0,10); let r=`🏆 *المتصدرين:*\n`; arr.forEach(([n,p],i)=>{ r+=`${i+1}. ${DB.nick[n]||n}: ${p} نقطة\n` }); await sock.sendMessage(from,{text:r+SIGN},{quoted:msg}); return }
    if(text==='نقاطي'){ await sock.sendMessage(from,{text:`✨ نقاطك: ${DB.points[senderNum]||0}${SIGN}`},{quoted:msg}); return }
    if(text==='ملفي'){ const logs=(DB.logs[senderNum]||[]).map((l,i)=>`${i+1}. ${l.action} | ${l.time}`).join('\n')||'لا سجلات'; await sock.sendMessage(from,{text:`📜 ملفك:\n🏷️ ${DB.nick[senderNum]||'بدون لقب'}\n📈 ${DB.points[senderNum]||0} نقطة\n⚠️ تحذيرات: ${(DB.warnings[senderNum]||[]).length}\n\n${logs}${SIGN}`},{quoted:msg}); return }
    if(text.startsWith('لقبي ')){ const nn=text.replace('لقبي','').trim(); if(nn){DB.nick[senderNum]=nn; saveDB(); await sock.sendMessage(from,{text:`✨ تم حفظ لقبك: ${nn}${SIGN}`},{quoted:msg})} return }

    if(from.includes('@g.us')&&!isBotMentioned) return
    let prompt=text||'[وسائط]'
    if(hasImage) prompt='[أرسل صورة] '+text
    if(hasSticker) prompt='[أرسل ملصق] '+text
    if(hasAudio) prompt='[أرسل صوت] '+text
    if(!prompt.trim()) return

    addMem(sender,'user',prompt)
    try{
      const reply=await askGemini(getMem(sender),userIsAdmin)
      addMem(sender,'assistant',reply)
      // في الخاص بدون توقيع القروب المزعج، في القروب مع توقيع خفيف
      const footer = from.includes('@g.us')? `\n\n> التزم بالقوانين لتتجنب خسارة نقاطك 🏰` : ``
      await sock.sendMessage(from,{text:reply+footer},{quoted:msg})
    }catch(e){ console.error("GEMINI ERROR:",e.message); await sock.sendMessage(from,{text:'عذراً، جوجل مزحوم حالياً (503). جرب بعد دقيقة.'},{quoted:msg}) }
    saveDB()
    }catch(e){ console.error('Handler Error:',e) }
  })
}
startBot()
