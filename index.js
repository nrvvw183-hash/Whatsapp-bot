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

let DB = { points:{}, nick:{}, muted:{}, warnings:{}, bans:{}, words:[], settings:{}, logs:{} }
for(let k of Object.keys(DB)){ try{ DB[k]=JSON.parse(fs.readFileSync('./'+k+'.json','utf8')) }catch(e){} }
function saveDB(){ for(let k of Object.keys(DB)){ try{ fs.writeFileSync('./'+k+'.json', JSON.stringify(DB[k])) }catch(e){} } }
setInterval(()=>{ try{ fs.copyFileSync('./points.json','./backup_points.json') }catch(e){} }, 3600000)

const memory = new Map()
const spamDB = new Map()
const isLord = (jid='') => (jid||'').replace(/[^0-9]/g,'').includes(LORD_NUMBER)

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
function getWarns(from){ if(!DB.warnings[from]) DB.warnings[from]={}; return DB.warnings[from] }
function addLog(num,action,by){
  if(!DB.logs[num]) DB.logs[num]=[]
  DB.logs[num].push({action,by,time:new Date().toLocaleString('ar-SA')})
  if(DB.logs[num].length>50) DB.logs[num]=DB.logs[num].slice(-50)
  saveDB()
}
async function punish(sock,from,targetJid,targetNum,reason,msg){
  if(!targetJid) return
  if(isLord(targetJid)) return
  if(targetJid===sock.user?.id) return
  if(await isAdmin(sock,from,targetJid)){
    await sock.sendMessage(from,{text:`🚫 لا يمكن معاقبة مشرف`},{quoted:msg}); return
  }
  const warns=getWarns(from)
  warns[targetNum]=warns[targetNum]||[]
  warns[targetNum].push({reason,time:new Date().toLocaleString('ar-SA')})
  addLog(targetNum,`تحذير: ${reason}`,msg?.key?.participant||'system')
  const c=warns[targetNum].length, limit=getSettings(from).warnLimit
  saveDB()
  if(c>=limit){ DB.muted[targetNum]=true; saveDB(); await sock.sendMessage(from,{text:`🚫 ${targetNum} وصل ${c} تحذيرات وتم كتمه${SIGN}`}) }
  else await sock.sendMessage(from,{text:`⚠️ تحذير ${c}/${limit} لـ ${targetNum}\n📌 ${reason}`},{quoted:msg})
}

async function askGemini(messages,isAdminUser){
  const sys=`أنتِ Ciel (سيل)، سيدك المطلق ${LORD_NAME}. الصلاحية: ${isAdminUser?'مشرف':'عضو'}. كوني صارمة ودقيقة.`
  const contents=messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}))
     let r; const models=['gemini-2.0-flash-lite','gemini-1.5-flash-8b','gemini-2.0-flash'];
    for(const m of models){ try{ r=await ai.models.generateContent({model:m,contents,config:{systemInstruction:sys,temperature:0.7,maxOutputTokens:1024}}); break; }catch(e){ if(!String(e).includes('503')) throw e; } }
    if(!r) throw new Error('503')
    return r.text
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
      if(code!==DisconnectReason.loggedOut) setTimeout(startBot,5000)
    }else if(connection==='open'){ qrCodeData=''; console.log('سيل متصلة ⚡') }
  })

  sock.ev.on('group-participants.update', async (u)=>{
    try{
      if(u.action==='add'){
        for(let p of u.participants){
          const num=p.replace(/[^0-9]/g,'')
          if(DB.bans[num]){ await sock.groupParticipantsUpdate(u.id,[p],"remove") }
          else { await sock.sendMessage(u.id,{text:`👋 أهلاً ${num} نورت Night Red 🏰`}) }
        }
      }
    }catch(e){}
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
    const hasSticker=!!msg.message.stickerMessage
    const mentioned=msg.message.extendedTextMessage?.contextInfo?.mentionedJid||[]
    const botNum=(sock.user?.id||'').replace(/[^0-9]/g,'')
    const isBotMentioned=mentioned.some(j=>j.replace(/[^0-9]/g,'').includes(botNum))||text.includes('سيل')
    const userIsAdmin=await isAdmin(sock,from,sender)
    const st=getSettings(from)

    if(from.includes('@g.us')&&!userIsAdmin){
      if(st.antiLink&&/https?:\/\/|www\./i.test(text)){
        try{ await sock.sendMessage(from,{delete:msg.key}) }catch(e){}
        await punish(sock,from,sender,senderNum,'رابط ممنوع',msg); return
      }
      if(DB.words.some(w=>text.includes(w))){
        try{ await sock.sendMessage(from,{delete:msg.key}) }catch(e){}
        await punish(sock,from,sender,senderNum,'كلمة ممنوعة',msg); return
      }
      if(st.antiSpam){
        const now=Date.now(), arr=(spamDB.get(senderNum)||[]).filter(t=>now-t<10000)
        arr.push(now); spamDB.set(senderNum,arr)
        if(arr.length>=7){ spamDB.set(senderNum,[]); await punish(sock,from,sender,senderNum,'سبام',msg); return }
      }
    }

    if(userIsAdmin){
      if(text==='سيل الأوامر'){
        await sock.sendMessage(from,{text:`📜 أوامر سيل:\n- تحذير @عضو / فك تحذير @عضو / تحذيرات @عضو\n- كتم @عضو / فك كتم @عضو\n- بان @عضو / فك بان @عضو\n- طرد @عضو / طرد مؤقت @عضو\n- ترقية @عضو / تنزيل @عضو\n- قفل القروب / فتح القروب\n- إضافة كلمة X / حذف كلمة X / قائمة الكلمات\n- إضافة 10 @عضو / خصم 10 @عضو / تصفير نقاط @عضو\n- سجل @عضو / المتصدرين${SIGN}`},{quoted:msg}); return
      }
      if(text.startsWith('فك بان')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||text.replace(/[^0-9]/g,'').slice(-12); delete DB.bans[tn]; saveDB(); await sock.sendMessage(from,{text:`✅ فك بان ${tn}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('بان')){ const tj=mentioned[0]; const tn=tj?.replace(/[^0-9]/g,'')||text.replace(/[^0-9]/g,'').slice(-12); if(tn){ DB.bans[tn]={time:new Date().toLocaleString('ar-SA')}; saveDB(); if(tj&&from.includes('@g.us')){ try{await sock.groupParticipantsUpdate(from,[tj],"remove")}catch(e){} } await sock.sendMessage(from,{text:`🔨 تم بان وطرد ${tn}${SIGN}`},{quoted:msg}) } return }
      if(text.startsWith('فك تحذير')){ const tn=mentioned[0]?.replace(/[^0-9]/g,''); if(tn&&getWarns(from)[tn]){ getWarns(from)[tn].pop(); saveDB() } await sock.sendMessage(from,{text:`✅ تم فك تحذير${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('تحذير')&&!text.startsWith('تحذيرات')){ const tj=mentioned[0]; const tn=tj?.replace(/[^0-9]/g,''); const rs=text.replace('تحذير','').replace(/@[0-9]+/g,'').trim()||'مخالفة'; if(tj) await punish(sock,from,tj,tn,rs,msg); return }
      if(text.startsWith('تحذيرات')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum; const c=(getWarns(from)[tn]||[]).length; await sock.sendMessage(from,{text:`⚠️ تحذيرات ${tn}: ${c}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('حذف كلمة')){ const w=text.replace('حذف كلمة','').trim(); DB.words=DB.words.filter(x=>x!==w); saveDB(); await sock.sendMessage(from,{text:`✅ حذفت ${w}${SIGN}`},{quoted:msg}); return }
      if(text==='قائمة الكلمات'){ await sock.sendMessage(from,{text:`📝 ${DB.words.join(', ')||'لا يوجد'}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('إضافة كلمة')){ const w=text.replace('إضافة كلمة','').trim(); if(w){DB.words.push(w); saveDB()} await sock.sendMessage(from,{text:`✅ أضفت ${w}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('سجل')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum; const l=(DB.logs[tn]||[]).map((x,i)=>`${i+1}. ${x.action}`).join('\n')||'لا سجلات'; await sock.sendMessage(from,{text:`📋 سجل ${tn}:\n${l}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('تصفير نقاط')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum; DB.points[tn]=0; saveDB(); await sock.sendMessage(from,{text:`✅ صفرت نقاط ${tn}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('طرد مؤقت')){ const tj=mentioned[0]; if(tj&&from.includes('@g.us')){ try{await sock.groupParticipantsUpdate(from,[tj],"remove"); await sock.sendMessage(from,{text:`⏳ طرد مؤقت${SIGN}`},{quoted:msg})}catch(e){} } return }
      if(text.startsWith('طرد')){ const tj=mentioned[0]; if(tj&&from.includes('@g.us')){ try{await sock.groupParticipantsUpdate(from,[tj],"remove")}catch(e){} } return }
      if(text.startsWith('ترقية')){ if(mentioned[0]) await sock.groupParticipantsUpdate(from,[mentioned[0]],"promote"); return }
      if(text.startsWith('تنزيل')){ if(mentioned[0]) await sock.groupParticipantsUpdate(from,[mentioned[0]],"demote"); return }
      if(text==='قفل القروب'){ await sock.groupSettingUpdate(from,'announcement'); await sock.sendMessage(from,{text:`🔒 قفل${SIGN}`},{quoted:msg}); return }
      if(text==='فتح القروب'){ await sock.groupSettingUpdate(from,'not_announcement'); await sock.sendMessage(from,{text:`🔓 فتح${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('كتم ')){ const tn=mentioned[0]?.replace(/[^0-9]/g,'')||text.replace(/[^0-9]/g,''); if(tn){DB.muted[tn]=true; saveDB(); await sock.sendMessage(from,{text:`🔇 كتم ${tn}${SIGN}`},{quoted:msg})} return }
      if(text.startsWith('فك كتم')){ const tn=text.replace(/[^0-9]/g,''); delete DB.muted[tn]; saveDB(); await sock.sendMessage(from,{text:`🔊 فك كتم ${tn}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('إضافة ')){ let amt=parseInt(text.replace(/[^0-9]/g,'').slice(-4))||0; const tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum; DB.points[tn]=(DB.points[tn]||0)+amt; addLog(tn,`+${amt}`,senderNum); await sock.sendMessage(from,{text:`✅ +${amt} لـ ${tn}${SIGN}`},{quoted:msg}); return }
      if(text.startsWith('خصم ')){ let amt=parseInt(text.replace(/[^0-9]/g,'').slice(-4))||0; const tn=mentioned[0]?.replace(/[^0-9]/g,'')||senderNum; DB.points[tn]=(DB.points[tn]||0)-amt; addLog(tn,`-${amt}`,senderNum); await sock.sendMessage(from,{text:`⚠️ -${amt} من ${tn}${SIGN}`},{quoted:msg}); return }
    }

    if(text==='المتصدرين'){ let arr=Object.entries(DB.points).sort((a,b)=>b[1]-a[1]).slice(0,10); let r=`🏆 المتصدرين:\n`; arr.forEach(([n,p],i)=>{ r+=`${i+1}. ${DB.nick[n]||n}: ${p}\n` }); await sock.sendMessage(from,{text:r+SIGN},{quoted:msg}); return }
    if(text==='نقاطي'){ await sock.sendMessage(from,{text:`✨ نقاطك: ${DB.points[senderNum]||0}${SIGN}`},{quoted:msg}); return }
    if(text==='ملفي'){ await sock.sendMessage(from,{text:`📜 ملفك:\n🏷️ ${DB.nick[senderNum]||'بدون'}\n📈 ${DB.points[senderNum]||0}\n⚠️ ${(getWarns(from)[senderNum]||[]).length} تحذيرات${SIGN}`},{quoted:msg}); return }
    if(text.startsWith('لقبي ')){ const nn=text.replace('لقبي','').trim(); if(nn){DB.nick[senderNum]=nn; saveDB(); await sock.sendMessage(from,{text:`✨ لقبك: ${nn}${SIGN}`},{quoted:msg})} return }

    if(from.includes('@g.us')&&!isBotMentioned) return
    addMem(sender,'user',text||'[وسائط]')
    try{
      const reply=await askGemini(getMem(sender),userIsAdmin)
      addMem(sender,'assistant',reply)
      const footer = from.includes('@g.us')? `\n\n> التزم بالقوانين 🏰` : ``
      await sock.sendMessage(from,{text:reply+footer},{quoted:msg})
    }catch(e){ await sock.sendMessage(from,{text:'جوجل مزحوم 503، جرب بعد دقيقة'},{quoted:msg}) }
    saveDB()
    }catch(e){ console.error(e) }
  })
}
startBot()
