const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Kahoot = require('kahoot.js-latest');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const VERSION = '2';

/* ===== Name Bypass ===== */
const usedNames = new Set();
const VISIBLE_MAP = {
    a: ['a','а','ᴀ','𝑎','𝒂','ⓐ','ₐ'],
    b: ['b','Ь','𝐛','𝑏','ⓑ'],
    c: ['c','с','ⅽ','ｃ','ⓒ'],
    d: ['d','ԁ','ⅾ','ｄ','ⓓ'],
    e: ['e','е','ⅇ','ｅ','ⓔ','ε'],
    g: ['g','ǥ','�ɡ','ｇ','ⓖ','ɡ'],
    h: ['h','һ','ｈ','ⓗ','Ꮒ'],
    i: ['i','і','ⅰ','ｉ','ⓘ','і','Ꭵ'],
    k: ['k','κ','ｋ','ⓚ','κ'],
    l: ['l','ӏ','ⅼ','ｌ','ⓛ','ӏ'],
    n: ['n','ո','ｎ','ⓝ','п'],
    o: ['o','о','ｏ','ⓞ','ο','ὀ'],
    p: ['p','р','ｐ','ⓟ','ρ'],
    r: ['r','ｒ','ⓡ','ῤ'],
    s: ['s','ѕ','ｓ','ⓢ','ꜱ'],
    t: ['t','ｔ','ⓣ','τ'],
    u: ['u','ս','ｕ','ⓤ','υ','µ'],
    v: ['v','ѵ','ｖ','ⓥ','ν'],
    x: ['x','х','ｘ','ⓧ','χ'],
    y: ['y','у','ｙ','ⓨ','γ'],
    z: ['z','ᴢ','ｚ','ⓩ','ᴢ'],
};
const ZW_CHARS = ['\u200B','\u200C','\u200D','\u2060','\uFEFF'];
const DOT_CHARS = ['\u0307','\u0323','\u2022','\u00B7'];

function makeName(base, bypass) {
    if (!bypass) return base;
    for (let attempt = 0; attempt < 50; attempt++) {
        let name = '';
        const mode = Math.floor(Math.random() * 7);
        for (const ch of base.toLowerCase()) {
            const mapped = VISIBLE_MAP[ch];
            if (mapped) {
                switch (mode) {
                    case 0: name += mapped[Math.floor(Math.random() * mapped.length)]; break;
                    case 1: name += mapped[0] + ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]; break;
                    case 2: name += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)] + mapped[0]; break;
                    case 3: name += mapped[0] + DOT_CHARS[Math.floor(Math.random() * DOT_CHARS.length)]; break;
                    case 4: name += mapped[Math.floor(Math.random() * mapped.length)] + ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]; break;
                    case 5: name += mapped[0] + ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)] + ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]; break;
                    case 6: name += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)] + mapped[0] + ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]; break;
                    default: name += mapped[0];
                }
            } else {
                name += ch;
            }
        }
        if (mode >= 4) name = '\u200E' + name;
        if (!usedNames.has(name)) { usedNames.add(name); return name; }
    }
    return base + Math.random().toString(36).slice(2, 5);
}

/* ===== Server ===== */
io.on('connection', (socket) => {
    console.log(`client: ${socket.id}`);

    let autoAnswer = true;
    const state = { bots: [], flooding: false, active: false, correctChoice: null };

    socket.on('toggleAuto', (val) => { autoAnswer = !!val; console.log(`auto-answer: ${autoAnswer}`); });

    socket.on('start', async (data) => {
        if (state.flooding) return;
        state.flooding = true;
        state.active = true;
        state.bots = [];
        state.correctChoice = null;
        usedNames.clear();

        const { pin, count, prefix, bypassNames } = data;
        const total = Math.min(count || 10, 250);
        let succ = 0, fail = 0;

        console.log(`\n=== FLOOD ${pin} / ${total} bots (auto=${autoAnswer}, bypass=${bypassNames}) ===`);
        socket.emit('log', `flood: ${pin} / ${total} bots`);

        for (let i = 0; i < total && state.flooding; i++) {
            const baseName = `${prefix || 'Bot'}${i + 1}`;
            const finalName = makeName(baseName, bypassNames);

            try {
                const client = new Kahoot();
                client.loggingMode = false;
                const bot = { name: finalName, answered: false, score: 0, correct: 0, total: 0, client };
                client._bot = bot;

                client.on('Joined', () => {
                    succ++;
                    state.bots.push(bot);
                    socket.emit('botJoin', { name: finalName, ok: true });
                    console.log(`[${finalName}] joined`);
                });

                client.on('QuizStart', () => { state.correctChoice = null; socket.emit('quizstart', {}); });

                client.on('QuestionReady', () => {
                    const b = client._bot;
                    if (b) b.answered = false;
                });

                client.on('QuestionStart', (event) => {
                    try {
                        const qIdx = event.questionIndex || 0;
                        const nc = (event.quizQuestionAnswers && event.quizQuestionAnswers[qIdx]) || 4;
                        const qType = event.gameBlockType || 'quiz';
                        const isTF = qType === 'true_false' || qType === 'True or false' || qType === 'True or False';

                        socket.emit('question', { questionIndex: qIdx, numChoices: nc, type: qType, isTrueFalse: isTF });

                        const b = client._bot;
                        if (!b) return;
                        b.answered = false;

                        if (!autoAnswer || !state.active) return;

                        const choice = isTF ? (Math.random() < 0.5 ? 0 : 1) : Math.floor(Math.random() * nc);
                        const delay = 150 + Math.floor(Math.random() * 1500);

                        setTimeout(() => {
                            try {
                                if (b.answered) return;
                                b.answered = true;
                                client.answer(choice)
                                    .then(() => {})
                                    .catch(() => {});
                            } catch (e) {}
                        }, delay);
                    } catch (e) { console.log(`QS ERR: ${e.message}`); }
                });

                client.on('QuestionEnd', (event) => {
                    try {
                        const b = client._bot;
                        if (b) { b.total++; if (event.isCorrect) b.correct++; b.score = event.totalScore || 0; }

                        if (event.correctChoices && !event.isCorrect && state.correctChoice === null) {
                            const correct = event.correctChoices[0];
                            if (correct !== undefined) {
                                state.correctChoice = correct;
                                console.log(`\n>>> LEARNED: correct = ${correct} <<<\n`);
                                socket.emit('learnedAnswer', { choice: correct });
                            }
                        }
                        socket.emit('questionEnd', { name: finalName, correct: event.isCorrect, score: event.totalScore, rank: event.rank });
                    } catch (e) {}
                });

                client.on('QuizEnd', () => {
                    const b = client._bot;
                    socket.emit('gameover', { name: finalName, score: b ? b.score : 0, correct: b ? b.correct : 0, total: b ? b.total : 0 });
                });

                client.on('Podium', (e) => socket.emit('podium', { name: finalName, medal: e.podiumMedalType }));
                client.on('GameReset', () => { state.correctChoice = null; });
                client.on('Feedback', () => { try { client.sendFeedback(5, 1, 1, 1).catch(() => {}); } catch (e) {} });
                client.on('TwoFactorReset', () => { try { client.answerTwoFactorAuth([0, 1, 2, 3]).catch(() => {}); } catch (e) {} });
                client.on('Disconnect', (reason) => {
                    console.log(`[${finalName}] disconnected: ${reason}`);
                    socket.emit('botDisconnect', { name: finalName });
                });
                client.on('HandshakeFailed', () => console.log(`[${finalName}] handshake failed`));

                client.join(pin, finalName).catch(e => {
                    fail++;
                    console.log(`[${finalName}] JOIN ERR: ${JSON.stringify(e)}`);
                    socket.emit('botJoin', { name: finalName, ok: false, error: JSON.stringify(e) });
                });
            } catch (e) {
                fail++;
                console.log(`[${finalName}] BOT ERR: ${e.message}`);
            }
            await new Promise(r => setTimeout(r, 200));
        }

        console.log(`=== FLOOD DONE: ${succ} ok, ${fail} failed ===`);
        socket.emit('ready', { succ, fail });
        state.flooding = false;
    });

    socket.on('answer', (data) => {
        state.bots.forEach(b => {
            if (b.answered || !b.client) return;
            b.answered = true;
            try { b.client.answer(data.choice).catch(() => {}); } catch (e) {}
        });
    });

    socket.on('stop', () => {
        state.flooding = false;
        state.active = false;
        state.bots.forEach(b => { try { if (b.client) b.client.leave(); } catch (e) {} });
        state.bots = [];
    });

    socket.on('disconnect', () => {
        state.flooding = false;
        state.active = false;
        state.bots.forEach(b => { try { if (b.client) b.client.leave(); } catch (e) {} });
        state.bots = [];
    });
});

/* ===== UI ===== */
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<title>gefickt ${VERSION}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💀</text></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#09090b;color:#fafafa;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px;padding-bottom:180px;-webkit-tap-highlight-color:transparent}
.app{width:100%;max-width:400px}
.ver{position:fixed;top:10px;left:12px;font-size:10px;color:#3f3f46;font-family:monospace}
.logo{text-align:center;margin-bottom:24px}
.logo h1{font-size:26px;font-weight:800;letter-spacing:-.5px}
.logo h1 span{color:#a855f7}
.field{margin-bottom:10px}
.field label{display:block;font-size:11px;font-weight:600;color:#52525b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
.field input{width:100%;padding:11px 13px;background:#18181b;border:1px solid #27272a;border-radius:8px;color:#fafafa;font-size:15px}
.field input:focus{outline:none;border-color:#a855f7}
.row{display:flex;gap:10px}.row .field{flex:1}
.btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px}
.btn-go{background:#a855f7;color:#fff}.btn-go:active{transform:scale(.98)}
.btn-stop{background:#dc2626;color:#fff;display:none}
.trow{display:flex;align-items:center;gap:10px;margin:5px 0}
.tog{position:relative;width:40px;height:22px;cursor:pointer}
.tog input{opacity:0;width:0;height:0}
.tog .s{position:absolute;inset:0;background:#27272a;border-radius:11px;transition:.2s}
.tog .s:before{content:'';position:absolute;width:16px;height:16px;left:3px;bottom:3px;background:#71717a;border-radius:50%;transition:.2s}
.tog input:checked+.s{background:#a855f7}
.tog input:checked+.s:before{transform:translateX(18px);background:#fff}
.tl{font-size:12px;color:#a1a1aa}
.panel{margin-top:14px;background:#18181b;border:1px solid #27272a;border-radius:10px;overflow:hidden;display:none}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid #27272a}
.panel-head span{font-size:11px;font-weight:600;color:#52525b;text-transform:uppercase}
.count{color:#a855f7;font-size:13px;font-weight:700}
.bar{height:2px;background:#27272a}
.bar-fill{height:100%;background:#a855f7;width:0%;transition:width .3s}
.logbox{padding:6px 14px;max-height:120px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.6}
.logbox p{color:#3f3f46}.logbox p.g{color:#4ade80}.logbox p.r{color:#f87171}.logbox p.b{color:#60a5fa}.logbox p.y{color:#fbbf24}.logbox p.p{color:#c084fc}
#aBar{position:fixed;bottom:0;left:0;right:0;background:#18181b;border-top:1px solid #27272a;padding:10px 12px 20px;z-index:100}
.ai{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:0 4px}
.ai .st{font-size:11px;color:#52525b}.ai .st.on{color:#4ade80}
.ai .lt{font-size:11px;color:#a855f7;font-weight:600}
.ag{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ab{padding:0;height:64px;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .1s,box-shadow .1s;position:relative;overflow:hidden}
.ab:active{transform:scale(.95)}.ab.sent{box-shadow:0 0 0 3px #fff}
.ab .sh{position:absolute}
.ab.r{background:#e11d48}.ab.b{background:#2563eb}.ab.y{background:#eab308}.ab.g{background:#16a34a}
.tri{width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-bottom:28px solid rgba(255,255,255,.95)}
.dia{width:20px;height:20px;background:rgba(255,255,255,.95);transform:rotate(45deg)}
.cir{width:26px;height:26px;background:rgba(255,255,255,.95);border-radius:50%}
.sqr{width:22px;height:22px;background:rgba(255,255,255,.95);border-radius:3px}
.ah{text-align:center;margin-top:6px;font-size:10px;color:#3f3f46}
.tf{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ab.tf{height:52px;font-size:16px;font-weight:800;color:#fff;letter-spacing:1px}
.ab.tf.t{background:#16a34a}.ab.tf.f{background:#e11d48}
</style>
</head>
<body>
<div class="ver">v${VERSION}</div>
<div class="app">
<div class="logo"><h1>kahoot<span>.</span>gefickt</h1></div>
<div class="field"><label>Game PIN</label><input type="text" id="pin" placeholder="4-10 digits" inputmode="numeric" maxlength="10"></div>
<div class="row">
<div class="field"><label>Bots</label><input type="number" id="count" value="15" min="1" max="250" inputmode="numeric"></div>
<div class="field"><label>Name</label><input type="text" id="prefix" value="Bot" maxlength="12"></div>
</div>
<div class="trow"><label class="tog"><input type="checkbox" id="autoT" checked><span class="s"></span></label><span class="tl">auto-answer</span></div>
<div class="trow"><label class="tog"><input type="checkbox" id="bypassT"><span class="s"></span></label><span class="tl">bypass name filter</span></div>
<button class="btn btn-go" id="goBtn">flood</button>
<button class="btn btn-stop" id="stopBtn">stop</button>
<div class="panel" id="panel">
<div class="panel-head"><span>log</span><span class="count" id="cLabel">0 / 0</span></div>
<div class="bar"><div class="bar-fill" id="bFill"></div></div>
<div class="logbox" id="log"></div>
</div>
</div>
<div id="aBar">
<div class="ai"><span class="st" id="aSt">waiting for question</span><span class="lt" id="aLt"></span></div>
<div id="aGrid"><div class="ag">
<button class="ab r" onclick="sa(0)"><span class="sh tri"></span></button>
<button class="ab b" onclick="sa(1)"><span class="sh dia"></span></button>
<button class="ab y" onclick="sa(2)"><span class="sh cir"></span></button>
<button class="ab g" onclick="sa(3)"><span class="sh sqr"></span></button>
</div></div>
<div class="ah">tap to answer | keys 1 2 3 4</div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
var s=io(),ok=0,no=0,tot=0;
var pin=document.getElementById('pin'),cnt=document.getElementById('count'),pfx=document.getElementById('prefix'),at=document.getElementById('autoT'),bt=document.getElementById('bypassT'),gb=document.getElementById('goBtn'),sb=document.getElementById('stopBtn'),pn=document.getElementById('panel'),lg=document.getElementById('log'),cl=document.getElementById('cLabel'),bf=document.getElementById('bFill'),as=document.getElementById('aSt'),al=document.getElementById('aLt'),ag=document.getElementById('aGrid');
function L(t,c){var p=document.createElement('p');if(c)p.className=c;p.textContent=t;lg.appendChild(p);lg.scrollTop=lg.scrollHeight}
function U(){var d=ok+no;cl.textContent=d+' / '+tot;bf.style.width=Math.min(100,d/tot*100)+'%'}
at.addEventListener('change',function(){s.emit('toggleAuto',at.checked)});
gb.addEventListener('click',function(){var p=pin.value.trim().replace(/\\s/g,'');var c=parseInt(cnt.value)||10;var n=pfx.value.trim()||'Bot';if(!p)return alert('enter a pin');ok=0;no=0;tot=c;gb.style.display='none';sb.style.display='block';pn.style.display='block';lg.innerHTML='';L('flood: '+p+' / '+c+' bots','b');s.emit('start',{pin:p,count:c,prefix:n,bypassNames:bt.checked})});
sb.addEventListener('click',function(){s.emit('stop');gb.style.display='block';sb.style.display='none'});
function sa(c){s.emit('answer',{choice:c});var n=['RED','BLUE','YELLOW','GREEN'];al.textContent=n[c];var bs=document.querySelectorAll('.ab');bs.forEach(function(b,i){b.classList.toggle('sent',i===c)});setTimeout(function(){bs.forEach(function(b){b.classList.remove('sent')})},400)}
s.on('log',function(t){L(t,'b')});
s.on('botJoin',function(d){if(d.ok){ok++;L('+ '+d.name,'g')}else{no++;L('x '+d.name+': '+(d.error||''),'r')}U()});
s.on('ready',function(d){L('done: '+(d.succ||0)+' ok, '+(d.fail||0)+' failed',(d.succ||0)>0?'g':'r')});
s.on('question',function(d){L('Q'+d.questionIndex+' ('+d.numChoices+', '+d.type+')','y');as.textContent='Q'+d.questionIndex+' live';as.className='st on';
if(d.isTrueFalse||d.numChoices===2){ag.innerHTML='<div class="tf"><button class="ab tf t" onclick="sa(0)">TRUE</button><button class="ab tf f" onclick="sa(1)">FALSE</button></div>'}else if(d.numChoices===3){ag.innerHTML='<div class="ag" style="grid-template-columns:1fr 1fr 1fr"><button class="ab r" onclick="sa(0)"><span class="sh tri"></span></button><button class="ab b" onclick="sa(1)"><span class="sh dia"></span></button><button class="ab y" onclick="sa(2)"><span class="sh cir"></span></button></div>'}else{ag.innerHTML='<div class="ag"><button class="ab r" onclick="sa(0)"><span class="sh tri"></span></button><button class="ab b" onclick="sa(1)"><span class="sh dia"></span></button><button class="ab y" onclick="sa(2)"><span class="sh cir"></span></button><button class="ab g" onclick="sa(3)"><span class="sh sqr"></span></button></div>'}});
s.on('questionEnd',function(d){L(d.name+': '+(d.correct?'CORRECT':'wrong'),'p');as.textContent='waiting';as.className='st'});
s.on('learnedAnswer',function(d){L('LEARNED: choice '+d.choice+' is correct','g')});
s.on('quizstart',function(){L('quiz started','b')});
s.on('gameover',function(d){if(d) L(d.name+': score='+d.score+' ('+d.correct+'/'+d.total+')','b')});
s.on('podium',function(d){L(d.name+': '+d.medal,'y')});
s.on('botDisconnect',function(d){L('- '+d.name,'r')});
s.on('connect_error',function(e){L('error: '+e.message,'r')});
document.addEventListener('keydown',function(e){if(e.key==='Enter'&&gb.style.display!=='none')gb.click();if(e.key==='1')sa(0);if(e.key==='2')sa(1);if(e.key==='3')sa(2);if(e.key==='4')sa(3)});
</script>
</body>
</html>`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (e) => console.error('uncaught:', e.message));
process.on('unhandledRejection', (e) => console.error('unhandled:', e));

server.listen(process.env.PORT || 3000, () => console.log(`kahoot-gefickt ${VERSION} on :${process.env.PORT || 3000}`));
