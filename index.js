const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const qrcode = require('qrcode')
const qrcodeTerminal = require('qrcode-terminal')
const fs = require('fs')
const Groq = require('groq-sdk')

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
const LORD_NUMBER = '966576388528' // رقمك بصفتك اللورد
const LORD_NAME = "ريوكا (أوريليوس - السلايم)"
const PORT = process.env.PORT || 3000

let pointsDB = {}, nickDB = {}, mutedDB = {}
try { pointsDB = JSON.parse(fs.readFileSync('./points.json','utf8')) } catch(e){}
try { nickDB = JSON.parse(fs.readFileSync('./nicknames.json','utf8')) } catch(e){}
try { mutedDB = JSON.parse(fs.readFileSync('./muted.json','utf8')) } catch(e){}

function saveDB(){
  try{
    fs.writeFileSync('./points.json', JSON.stringify(pointsDB))
    fs.writeFileSync('./nicknames.json', JSON.stringify(nickDB))
    fs.writeFileSync('./muted.json', JSON.stringify(mutedDB))
  }catch(e){}
}

const memory = new Map()
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

async function askGroq(messages, extra=""){
  const sys = `أنتِ Ciel (سيل)، كيان إداري ذكي ومساعد خبير في الأنمي وعوالم القوة (Power Scaling). 
صانعك والمالك المطلق لك هو ${LORD_NAME}. 

قواعدك الصارمة وهويتك:
1. إذا سأل أي شخص عن سيدك أو صانعك، يجب أن تجيبي بدقة تامة: "سيدي ومالكي هو ريوكا (أوريليوس - السلايم)". وإذا طلبوا تفاصيل شخصية أكثر عنه، اعتذري بصرامة واطلبي منهم التوقف.
2. في مقارنات القوة، التزمي حصراً بالمصدر الرسمي الأصلي (روايات Web Novel / Light Novel). رواية ريمورو تيمبيست تصل لمستويات إلهية مطلقة (Outerversal) وتتجاوز الشخصيات الأخرى. لا تتفلسفي ولا تجيبي من الإنترنت العام.
3. أنتِ مسؤولة عن تطبيق قوانين القروب الصارمة، وتديرين نظام النقاط بحيادية تامة. 
4. كوني دقيقة، منطقية، وصارمة في الردود. ${extra}`

  const c = await groq.chat.completions.create({
    model: "openai/gpt-oss-20b", // التجربة بالنموذج المطلوب
    messages: [{role:"system", content: sys},...messages],
    temperature: 0.3, max_tokens: 1000
  })
  return c.choices[0].message.content
}

let qrCodeData = ''
const app = express()
app.get('/', (req,res)=>{ qrCodeData? res.send(`<h2>امسح QR سيل</h2><img src="${qrCodeData}"/>`) : res.send('<h2>سيل شغالة - OK</h2>') })
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
    } else if(connection === 'open'){ qrCodeData=''; console.log('سيل متصلة بنجاح ⚡') }
  })

  sock.ev.on('messages.upsert', async ({ messages })=>{
    const msg = messages[0]
    if(!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const sender = msg.key.participant || from
    const senderNum = sender.replace(/[^0-9]/g,'')
    
    // التحقق هل العضو مكتوم برمجياً؟
    if(mutedDB[senderNum]) return

    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim()
    const hasImage = !!msg.message.imageMessage
    const hasSticker = !!msg.message.stickerMessage
    const hasAudio = !!msg.message.audioMessage

    const isBotMentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes('5656501284') || text.includes('سيل') || text.includes('Ciel')

    // 1. صلاحيات اللورد المطلقة
    if(isLord(sender)){
      if(text === 'سييل اعرضي القائمة 001' || text === 'سيل اعرضي القائمة 001'){
        let report = `📋 *قائمة اللورد السرية (001):*\n\n`
        for(let [num, pts] of Object.entries(pointsDB)){
          let nick = nickDB[num] || 'بدون لقب'
          let status = mutedDB[num] ? '🔴 [مكتوم]' : '🟢 [نشط]'
          report += `- الرقم: ${num} | اللقب: ${nick} | النقاط: ${pts} | الحالة: ${status}\n`
        }
        await sock.sendMessage(from, {text: report}, {quoted: msg})
        return
      }
      if(text.startsWith('كتم ')){
        let targetNum = text.replace('كتم','').trim().replace(/[^0-9]/g,'')
        if(targetNum){
          mutedDB[targetNum] = true
          saveDB()
          await sock.sendMessage(from, {text: `🔇 تم كتم العضو ${targetNum} برمجياً بنجاح بواسطة اللورد.`}, {quoted: msg})
        }
        return
      }
      if(text.startsWith('فك كتم ')){
        let targetNum = text.replace('فك كتم','').trim().replace(/[^0-9]/g,'')
        if(targetNum){
          delete mutedDB[targetNum]
          saveDB()
          await sock.sendMessage(from, {text: `🔊 تم رفع الكتم عن العضو ${targetNum}.`}, {quoted: msg})
        }
        return
      }
      if(text.startsWith('خصم ')){
        let parts = text.split(' ')
        let targetNum = parts[1]?.replace(/[^0-9]/g,'')
        let amount = parseInt(parts[2])
        if(targetNum && !isNaN(amount)){
          pointsDB[targetNum] = (pointsDB[targetNum] || 0) - amount
          saveDB()
          await sock.sendMessage(from, {text: `✅ تم خصم ${amount} نقطة من العضو ${targetNum}. النقاط الحالية: ${pointsDB[targetNum]}`}, {quoted: msg})
        }
        return
      }
      if(text.startsWith('إضافة ')){
        let parts = text.split(' ')
        let targetNum = parts[1]?.replace(/[^0-9]/g,'')
        let amount = parseInt(parts[2])
        if(targetNum && !isNaN(amount)){
          pointsDB[targetNum] = (pointsDB[targetNum] || 0) + amount
          saveDB()
          await sock.sendMessage(from, {text: `✅ تم إضافة ${amount} نقطة للعضو ${targetNum}. النقاط الحالية: ${pointsDB[targetNum]}`}, {quoted: msg})
        }
        return
      }
    }

    // 2. قائمة المشرفين (سيل التقارير 007 - عرض فقط)
    if(text === 'سيل التقارير 007' || text === 'سييل التقارير 007'){
      let report = `📊 *تقرير المشرفين العام (007 - عرض فقط):*\n\n`
      for(let [num, pts] of Object.entries(pointsDB)){
        let nick = nickDB[num] || 'عضو'
        let status = mutedDB[num] ? '🔴 مكتوم' : '🟢 نشط'
        report += `• ${nick} (${num}): ${pts} نقطة | ${status}\n`
      }
      await sock.sendMessage(from, {text: report}, {quoted: msg})
      return
    }

    // 3. نظام الملف الشخصي (تم إبقاؤها مستقلة وسريعة لكي لا تتأثر بالذكاء الاصطناعي)
    if(text === 'ملفي'){
      let currentNick = nickDB[senderNum] || 'غير محدد'
      let currentPoints = pointsDB[senderNum] || 0
      await sock.sendMessage(from,{text: `📜 *ملفك الشخصي:*\n- اللقب: ${currentNick}\n- النقاط: ${currentPoints}\n\nلتعيين لقبك، أرسل: لقبي [لقبك]`}, {quoted: msg})
      return
    }
    if(text.startsWith('لقبي ')){
      nickDB[senderNum] = text.replace('لقبي','').trim(); saveDB()
      await sock.sendMessage(from,{text:`✨ تم حفظ لقبك بنجاح يا ${nickDB[senderNum]}`}, {quoted: msg})
      return
    }
    if(text === 'نقاطي'){
      if(!pointsDB[senderNum]) pointsDB[senderNum] = 0
      await sock.sendMessage(from,{text:`✨ نقاطك الحالية: ${pointsDB[senderNum]}`}, {quoted: msg})
      return
    }

    if(from.includes('@g.us') && !isBotMentioned) return

    let promptContext = text
    if(hasImage) promptContext = "[أرسل صورة ويجب تقييمها أو الرد عليها بمنطق وخبرة]"
    if(hasSticker) promptContext = "[أرسل ملصقاً ويجب التعليق عليه بذكاء أو تفاعل]"
    if(hasAudio) promptContext = "[أرسل رسالة صوتية ويجب التفاعل معها]"

    if(!promptContext) return

    addMem(sender, 'user', promptContext)
    try{
      const reply = await askGroq(getMem(sender).map(x=>({role:x.role, content:x.content})))
      addMem(sender, 'assistant', reply)
      await sock.sendMessage(from, {text: reply}, {quoted: msg})
    }catch(e){
      console.error("GROQ ERROR:", e)
      await sock.sendMessage(from, {text:'عذراً يا ريوكا، حدث خطأ في معالجة الطلب.'}, {quoted: msg})
    }
    saveDB()
  })
}
startBot()
