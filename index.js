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

async function askGroq(messages, extra=""){
  const sys = `انت سيل، تتكلم مع رجال باحترام وبدون دلع زايد. صانعك ${LORD_NAME}. تعرف كل شي: كورة، انمي، طبخ، ثقافة عامة. ردك طبيعي ومباشر بدون زخرفة زايدة. ${extra}`
  const c = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{role:"system", content: sys},...messages],
    temperature: 0.7, max_tokens: 1000
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
    } else if(connection === 'open'){ qrCodeData=''; console.log('سيل متصلة') }
  })

  sock.ev.on('messages.upsert', async ({ messages })=>{
    const msg = messages[0]
    if(!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const sender = msg.key.participant || from
    const senderNum = sender.replace(/[^0-9]/g,'')
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim()
    if(!text) return

    if(!pointsDB[senderNum]) pointsDB[senderNum] = 0
    pointsDB[senderNum]++
    msgCount.set(sender, (msgCount.get(sender)||0)+1)

    if(text === 'ملفي'){ await sock.sendMessage(from,{text:'هلا! وش لقبك؟ ارسله كذا: لقبي فلان'}); return }
    if(text.startsWith('لقبي ')){
      nickDB[senderNum] = text.replace('لقبي','').trim(); saveDB()
      await sock.sendMessage(from,{text:`تم حفظ لقبك يا ${nickDB[senderNum]}`}); return
    }
    if(text === 'نقاطي'){
      await sock.sendMessage(from,{text:`نقاطك: ${pointsDB[senderNum]}`}); return
    }
    if(text.startsWith('احسب ')){
      try{
        const expr = text.replace('احسب','').trim().replace(/[^0-9+\-*/(). ]/g,'')
        await sock.sendMessage(from,{text:`النتيجة: ${Function('return '+expr)()}`})
      }catch(e){ await sock.sendMessage(from,{text:'صيغة غلط'}) }
      return
    }

    // الرد الذكي على كل شي
    addMem(sender, 'user', text)
    try{
      const reply = await askGroq(getMem(sender).map(x=>({role:x.role, content:x.content})))
      addMem(sender, 'assistant', reply)
      await sock.sendMessage(from, {text: reply}, {quoted: msg})
    }catch(e){
      await sock.sendMessage(from, {text:'ما قدرت ارد الحين'}, {quoted: msg})
    }
    saveDB()
  })
}
startBot()
