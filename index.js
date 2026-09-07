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

let pointsDB = {}, nickDB = {}, mutedDB = {}, logsDB = {}
try { pointsDB = JSON.parse(fs.readFileSync('./points.json','utf8')) } catch(e){}
try { nickDB = JSON.parse(fs.readFileSync('./nicknames.json','utf8')) } catch(e){}
try { mutedDB = JSON.parse(fs.readFileSync('./muted.json','utf8')) } catch(e){}
try { logsDB = JSON.parse(fs.readFileSync('./logs.json','utf8')) } catch(e){}

function saveDB(){
  try{
    fs.writeFileSync('./points.json', JSON.stringify(pointsDB))
    fs.writeFileSync('./nicknames.json', JSON.stringify(nickDB))
    fs.writeFileSync('./muted.json', JSON.stringify(mutedDB))
    fs.writeFileSync('./logs.json', JSON.stringify(logsDB))
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

async function isAdmin(sock, from, sender) {
  if (!from.includes('@g.us')) return false
  try {
    const metadata = await sock.groupMetadata(from)
    const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id)
    return admins.includes(sender) || isLord(sender)
  } catch (e) {
    return false
  }
}

async function askGemini(messages){
  const sysInstruction = `أنتِ Ciel (سيل)، كيان إداري ذكي ومساعد خبير في الأنمي وعوالم القوة (Power Scaling).
صانعك والمالك المطلق لك هو ${LORD_NAME}. التوقيع الرسمي لإدارة القروب: [N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰].

قوانين القروب الصارمة التي تحرسينها:
- المخالفات والإنذارات: إرسال GIF خارج الأنمي، ملصقات كيبوب أو مخلة، سبام الملصقات (3 ورا بعض)، سبام الرسائل (9 رسائل منها 3 بدون فائدة)، التشفير، الهنتاي والايتشي، العنصرية، السياسة، اللهجة أو اللغة غير العربية، التحدث عن حلقات لم يمض عليها 7 ساعات، التنمر، صوتيات البنات، الصعقات الصوتية، مقاطع خارج الأنمي في غير الأيام المفتوحة، الحذف المتكرر، طلب الرتب، واستخدام الذكاء الاصطناعي.
- الطرد المؤقت: الاحتكاك غير اللائق، الاعتراض على المشرفين، الاتصال بالقروب (3 طرد مؤقت تحول لمؤبد).
- الطرد المؤبد: الحرق، نشر قروبات أخرى، هنتاي (+18)، التخريب، التهديد بالباند، السب والشتم، إرسال ملصقات دفعة واحدة، إرسال صور الوجه، افتعال المشاكل، الابتزاز، إرسال مقاطع غير لائقة، والخروج والدخول المتكرر.

قواعد الردود:
1. إذا سأل أي شخص عن سيدك أو صانعك، أجيبي بدقة تامة: "سيدي ومالكي هو ريوكا (أوريليوس - السلايم)".
2. في مقارنات القوة، التزمي حصراً بروايات Web Novel / Light Novel (ريمورو تيمبيست يتجاوز مستويات Outerversal).
3. كوني دقيقة، منطقية، وصارمة تماماً في إدارة النقاط والعقوبات.`

  const contents = messages.map(m => ({
    role: m.role === 'assistant'? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: contents,
    config: {
      systemInstruction: sysInstruction,
      temperature: 0.3,
      maxOutputTokens: 1000,
    }
  })

  return result.text
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
    } else if(connection === 'open'){ qrCodeData=''; console.log('سيل متصلة بنجاح مع Gemini ⚡ [N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰]') }
  })

  sock.ev.on('messages.upsert', async ({ messages })=>{
    const msg = messages[0]
    if(!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const sender = msg.key.participant || from
    const senderNum = sender.replace(/[^0-9]/g,'')

    if(mutedDB[senderNum]) return

    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim()
    const hasImage =!!msg.message.imageMessage
    const hasSticker =!!msg.message.stickerMessage
    const hasAudio =!!msg.message.audioMessage

    const botJid = sock.user?.id || ''
    const botNum = botJid.replace(/[^0-9]/g,'')
    const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || []
    const isBotMentioned = mentioned.some(j => j.replace(/[^0-9]/g,'').includes(botNum)) || text.includes('سيل') || text.includes('Ciel')

    const userIsAdmin = await isAdmin(sock, from, sender)

    if(userIsAdmin){
      if(text.includes('القائمة 001')){
        let report = `📋 *قائمة اللورد والمدراء السرية (001):*\n\n`
        for(let [num, pts] of Object.entries(pointsDB)){
          let nick = nickDB[num] || 'بدون لقب'
          let status = mutedDB[num]? '🔴 [مكتوم]' : '🟢 [نشط]'
          report += `- الرقم: ${num} | اللقب: ${nick} | النقاط: ${pts} | الحالة: ${status}\n`
        }
        await sock.sendMessage(from, {text: report + `\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
        return
      }

      if(text.startsWith('طرد') || text.includes('kick')){
        if(!from.includes('@g.us')) return
        let target = mentioned[0]
        if(!target){
          let cleanNum = text.replace(/[^0-9]/g,'')
          if(cleanNum.length > 8) target = cleanNum + '@s.whatsapp.net'
        }
        if(target){
          try {
            await sock.groupParticipantsUpdate(from, [target], "remove")
            await sock.sendMessage(from, {text: `✅ تم تنفيذ أمر الطرد بنجاح من المجموعة.\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
          } catch(err) {
            await sock.sendMessage(from, {text: `⚠️ عذراً، تأكد أن البوت مشرف بالقروب لكي يتمكن من الطرد.`}, {quoted: msg})
          }
        } else {
          await sock.sendMessage(from, {text: '⚠️ منشن الشخص أو اكتب رقمه لطرده.'}, {quoted: msg})
        }
        return
      }

      if(text.startsWith('كتم ')){
        let targetNum = mentioned[0]?.replace(/[^0-9]/g,'') || text.replace('كتم','').trim().replace(/[^0-9]/g,'')
        if(targetNum){
          mutedDB[targetNum] = true
          saveDB()
          await sock.sendMessage(from, {text: `🔇 تم كتم العضو ${targetNum} برمجياً بنجاح بواسطة الإدارة.`}, {quoted: msg})
        }
        return
      }

      if(text.startsWith('فك كتم ')){
        let targetNum = mentioned[0]?.replace(/[^0-9]/g,'') || text.replace('فك كتم','').trim().replace(/[^0-9]/g,'')
        if(targetNum){
          delete mutedDB[targetNum]
          saveDB()
          await sock.sendMessage(from, {text: `🔊 تم رفع الكتم عن العضو ${targetNum}.`}, {quoted: msg})
        }
        return
      }

      if(text.startsWith('إضافة ')){
        let parts = text.split(' ').filter(Boolean)
        let targetNum = mentioned[0]?.replace(/[^0-9]/g,'') || senderNum
        let amount = 0
        for(let p of parts) {
          let clean = p.replace(/[^0-9]/g,'')
          if(clean.length > 8 &&!mentioned[0]) targetNum = clean
          else if(!isNaN(p) && p!== 'إضافة') amount = parseInt(p)
        }
        let reason = text.replace(/إضافة/g, '').replace(targetNum, '').replace(/@/g, '').trim() || 'إضافة إدارية'
        pointsDB[targetNum] = (pointsDB[targetNum] || 0) + amount
        if(!logsDB[targetNum]) logsDB[targetNum] = []
        logsDB[targetNum].push({ type: 'إضافة 🟢', amount: `+${amount}`, reason: reason, time: new Date().toLocaleString('ar-SA') })
        saveDB()
        await sock.sendMessage(from, {text: `✅ تم إضافة ${amount} نقطة للرقم ${targetNum}.\n📌 السبب: ${reason}\n✨ النقاط الحالية: ${pointsDB[targetNum]}\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
        return
      }

      if(text.startsWith('خصم ')){
        let parts = text.split(' ').filter(Boolean)
        let targetNum = mentioned[0]?.replace(/[^0-9]/g,'') || senderNum
        let amount = 0
        for(let p of parts) {
          let clean = p.replace(/[^0-9]/g,'')
          if(clean.length > 8 &&!mentioned[0]) targetNum = clean
          else if(!isNaN(p) && p!== 'خصم') amount = parseInt(p)
        }
        let reason = text.replace(/خصم/g, '').replace(targetNum, '').replace(/@/g, '').trim() || 'عقوبة إدارية'
        pointsDB[targetNum] = (pointsDB[targetNum] || 0) - amount
        if(!logsDB[targetNum]) logsDB[targetNum] = []
        logsDB[targetNum].push({ type: 'خصم 🔴', amount: `-${amount}`, reason: reason, time: new Date().toLocaleString('ar-SA') })
        saveDB()
        await sock.sendMessage(from, {text: `⚠️ تم خصم ${amount} نقطة من الرقم ${targetNum}.\n📌 السبب: ${reason}\n✨ النقاط الحالية: ${pointsDB[targetNum]}\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
        return
      }
    } else {
      if(text.startsWith('طرد') || text.startsWith('كتم ') || text.startsWith('إضافة ') || text.startsWith('خصم ')){
        await sock.sendMessage(from, {text: `🚫 عذراً، هذا الأمر مخصص للمشرفين (الأدمن) فقط!\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
        return
      }
    }

    if(text === 'سيل التقارير 007' || text === 'سييل التقارير 007'){
      let report = `📊 *تقرير المشرفين العام (007 - عرض فقط):*\n\n`
      for(let [num, pts] of Object.entries(pointsDB)){
        let nick = nickDB[num] || 'عضو'
        let status = mutedDB[num]? '🔴 مكتوم' : '🟢 نشط'
        report += `• ${nick} (${num}): ${pts} نقطة | ${status}\n`
      }
      await sock.sendMessage(from, {text: report + `\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
      return
    }

    if(text === 'ملفي'){
      let currentNick = nickDB[senderNum] || 'غير محدد'
      let currentPoints = pointsDB[senderNum] || 0
      let userLogs = logsDB[senderNum] || []
      let report = `📜 *استبيان الملف الشخصي الإداري:*\n──────────────────\n- 🏷️ اللقب: ${currentNick}\n- 📈 النقاط الحالية: ${currentPoints}\n──────────────────\n📋 *سجل التغييرات والخصومات:*\n`
      if(userLogs.length === 0){
        report += `• لا توجد سجلات خصم أو إضافة مسجلة حتى الآن.\n`
      } else {
        userLogs.forEach((log, index) => {
          report += `${index + 1}. [${log.type}] القيمة: ${log.amount} | السبب: ${log.reason} | الوقت: ${log.time}\n`
        })
      }
      report += `\n*لتعيين لقبك، أرسل:* \`لقبي [لقبك]\`\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`
      await sock.sendMessage(from, {text: report}, {quoted: msg})
      return
    }

    if(text.startsWith('لقبي ') || text.includes('اللقب الخاص بي')){
      let newNick = text.replace('لقبي','').replace('اللقب الخاص بي','').replace('سيل','').trim()
      if(newNick){
        nickDB[senderNum] = newNick
        saveDB()
        await sock.sendMessage(from,{text:`✨ تم حفظ لقبك بنجاح إلى: "${newNick}"\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰`}, {quoted: msg})
      }
      return
    }

    if(text === 'نقاطي'){
      if(pointsDB[senderNum] === undefined) pointsDB[senderNum] = 0
      await sock.sendMessage(from,{text:`✨ نقاطك الحالية: ${pointsDB[senderNum]}\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
      return
    }

    if(from.includes('@g.us') &&!isBotMentioned) return

    let promptContext = text
    if(hasImage) promptContext = "[أرسل صورة ويجب تقييمها أو الرد عليها بمنطق وخبرة]"
    if(hasSticker) promptContext = "[أرسل ملصقاً ويجب التعليق عليه بذكاء أو تفاعل]"
    if(hasAudio) promptContext = "[أرسل رسالة صوتية ويجب التفاعل معها]"

    if(!promptContext) return

    addMem(sender, 'user', promptContext)
    try{
      const reply = await askGemini(getMem(sender))
      addMem(sender, 'assistant', reply)
      await sock.sendMessage(from, {text: reply + `\n\n> ⋰ ⟯ أَبْرَقَتْ ٱلْنُجُومُ وَشَرَقَتِ ٱلْأَنْوَارُ.. ٱلْتَزِمْ بِٱلْقَوَانِينِ لِتَتَجَنَبَ خَسَارَةَ نِقَاطِكَ 🏰 ⋰ ⟯\n✺ تـــــــ✍🏻ـوقــيـع إداࢪه ☇ \n「N•R•D ┋ 𝓝𝓲𝓰𝓱𝓽 𝓡𝓮𝓭 🏰」`}, {quoted: msg})
    }catch(e){
      console.error("GEMINI ERROR:", e)
      await sock.sendMessage(from, {text:'عذراً يا ريوكا، حدث خطأ في معالجة الطلب عبر Gemini.'}, {quoted: msg})
    }
    saveDB()
  })
}
startBot()
