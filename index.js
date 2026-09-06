const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const qrcode = require('qrcode')
const qrcodeTerminal = require('qrcode-terminal')
const fs = require('fs')
const Groq = require('groq-sdk')

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const LORD_NUMBER = '966576388528'
const BOT_NUMBER = '5656501284'
const LORD_NAME = "ريوكا"
const PORT = process.env.PORT || 3000

let pointsDB = {}, nickDB = {}
try { pointsDB = JSON.parse(fs.readFileSync('./points.json','utf8')) } catch(e){}
try { nickDB = JSON.parse(fs.readFileSync('./nicknames.json','utf8')) } catch(e){}
function saveDB(){
  try{
    fs.writeFileSync('./points.json', JSON.stringify(pointsDB))
    fs.writeFileSync('./nicknames.json', JSON.stringify(nickDB))
  }catch(e){}
}

const memory = new Map(), warnings = new Map(), msgCount = new Map()
const isLord = (jid) => jid.replace(/[^0-9]/g,'').includes(LORD_NUMBER)

function getMem(jid){
  let arr = memory.get(jid) || []
  arr = arr.filter(m => Date.now() - m.time < 24*3600*1000).slice(-6)
  memory.set(jid, arr); return arr
}
function addMem(jid, role, content){
  let arr = getMem(jid); arr.push({role, content, time: Date.now()})
  memory.set(jid, arr.slice(-6))
}
function addWarn(jid, reason, text){
  let w = warnings.get(jid) || {count:0, log:[]}
  w.count++; w.log.push({reason, text, time: new Date().toISOString()})
  warnings.set(jid, w); return w
}

async function askGroq(messages, extra=""){
  const sys = `انتِ سيل، بنت أوتاكو مصرية دمها خفيف. بتتكلمي مصري بس. صانعك وسيدك هو ${LORD_NAME}. خبيرة أنمي. ردودك قصيرة ومضحكة. لما حد يشتمك ردي بطقطقة خفيفة من غير شتايم قذرة. ${extra}`
  const c = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{role:"system", content: sys},...messages],
    temperature: 0.7, max_tokens: 1000
  })
  return c.choices[0].message.content.replace(/<[^>]*>/g,'')
}

function isInsult(t){ return /(غبية|حمارة|كلبة|يا سيل الزفت|اسكتي)/.test(t) }
function checkViolation(text){
  const t = text.toLowerCase()
  if(t.includes('هنتاي')||t.includes('hentai')) return 'محتوى هنتاي ممنوع'
  if(/(كسم|سب|قذف)/.test(t)) return 'سب وشتم'
  if(t.includes('سياسة')) return 'نقاش سياسي ممنوع'
  if(t.includes('كيبوب')||t.includes('kpop')) return 'كيبوب ممنوع'
  return null
}

let qrCodeData = ''
const app = express()
app.get('/', (req,res)=>{ qrCodeData? res.send(`<h2>امسح QR سيل</h2><img src="${qrCodeData}"/>`) : res.send('<h2>سيل شغالة 🌸 - OK</h2>') })
app.get('/ping', (req,res)=> res.send('pong'))
app.listen(PORT, ()=> console.log('Server on '+PORT))

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const sock = makeWASocket({ auth: state })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (u)=>{
    const { connection, lastDisconnect, qr } = u
    if(qr){ qrCodeData = await qrcode.toDataURL(qr); qrcodeTerminal.generate(qr, {small:true}) }
    if(connection === 'close'){
      const code = (lastDisconnect?.error instanceof Boom)?.output?.statusCode
      if(code!== DisconnectReason.loggedOut) startBot()
    } else if(connection === 'open'){ qrCodeData=''; console.log('✅ سيل متصلة') }
  })

  sock.ev.on('group-participants.update', async (anu)=>{
    if(anu.action === 'add'){
      for(let p of anu.participants){
        await sock.sendMessage(anu.id, { text:`🎌 ━ [ ${p.split('@')[0]} ] ━ 🎌\n\nأهلاً بيك يا أوتاكو ✨ أنا سيل 🌸\nمنشن: @${p.split('@')[0]}`, mentions:[p] })
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages })=>{
    const msg = messages[0]
    if(!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')
    const sender = msg.key.participant || from
    const senderNum = sender.replace(/[^0-9]/g,'')
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim()
    if(!text) return

    if(!pointsDB[senderNum]) pointsDB[senderNum] = 0
    pointsDB[senderNum]++
    msgCount.set(sender, (msgCount.get(sender)||0)+1)

    const ctx = msg.message.extendedTextMessage?.contextInfo || {}
    const mentionedJids = ctx.mentionedJid || []
    const botMentioned = mentionedJids.some(j=>j.includes(BOT_NUMBER)) || text.toLowerCase().includes('سيل')

    if(text.includes('chat.whatsapp.com/')){
      try{
        const code = text.split('chat.whatsapp.com/')[1].split(/[^A-Za-z0-9]/)[0]
        await sock.groupAcceptInvite(code)
        await sock.sendMessage(from, {text:'تم انضمامي للقروب 🌸'})
      }catch(e){ await sock.sendMessage(from,{text:'ما قدرت انضم'}) }
      saveDB(); return
    }

    if(text === 'ملفي'){ await sock.sendMessage(from,{text:'هلا! وش لقبك؟ ارسله كذا: لقبي فلان'}); saveDB(); return }
    if(text.startsWith('لقبي ')){
      nickDB[senderNum] = text.replace('لقبي','').trim(); saveDB()
      await sock.sendMessage(from,{text:`تم حفظ لقبك يا ${nickDB[senderNum]} ✅`}); return
    }
    if(text === 'نقاطي'){
      const nick = nickDB[senderNum]? `يا ${nickDB[senderNum]} ` : ''
      await sock.sendMessage(from,{text:`${nick}نقاطك: ${pointsDB[senderNum]} ✨`}); saveDB(); return
    }

    if(text.startsWith('احسب ')){
      try{
        const expr = text.replace('احسب','').trim().replace(/[^0-9+\-*/(). ]/g,'')
        await sock.sendMessage(from,{text:`النتيجة: ${Function('return '+expr)()}`})
      }catch(e){ await sock.sendMessage(from,{text:'صيغة غلط'}) }
      saveDB(); return
    }

    if(text.startsWith('!تصويت')){
      const opts = text.replace('!تصويت','').split('|')
      await sock.sendMessage(from,{text:'تصويت سيل 📊:\n'+opts.map((o,i)=>`${i+1}. ${o.trim()}`).join('\n')})
      saveDB(); return
    }

    if(text.includes('المتصدرين')){
      if(!isLord(sender)) await sock.sendMessage(from,{text:'خاص بالإدارة فقط.'})
      else{
        const sorted=[...msgCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)
        await sock.sendMessage(from,{text:'🏆 المتصدرين:\n'+sorted.map((e,i)=>`${i+1}. ${e[0].split('@')[0]}: ${e[1]}`).join('\n')})
      }
      saveDB(); return
    }

    if(text.includes('الطقس')){
      const city = text.split('الطقس')[1]?.trim() || 'Jeddah'
      try{ const r=await fetch(`https://wttr.in/${city}?format=3`); await sock.sendMessage(from,{text:await r.text()}) }
      catch(e){ await sock.sendMessage(from,{text:'لم أستطع جلب الطقس.'}) }
      saveDB(); return
    }

    if(text.includes('ملخص')){
      const reply = await askGroq(getMem(sender).map(x=>({role:x.role, content:x.content})), "لخص المحادثة باختصار.")
      await sock.sendMessage(from,{text:reply},{quoted:msg}); saveDB(); return
    }

    if(text.includes('اعرضي القائمة 001')){
      if(!isLord(sender)) await sock.sendMessage(from,{text:'هذا الأمر خاص بسيدي ريوكا فقط.'})
      else{
        let out='— قائمة سيل السرية 001 —\n'
        for(let [k,v] of warnings) out+=`${k}: ${v.count}\n`
        out+=`\nالنقاط:\n`; for(let k in pointsDB) out+=`${k}: ${pointsDB[k]}\n`
        await sock.sendMessage(from,{text:out})
      }
      saveDB(); return
    }

    if(text.includes('
