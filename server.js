const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Kahoot = require('kahoot.js-latest');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const VERSION = '1.4.0';

io.on('connection', (socket) => {
    console.log(`client: ${socket.id}`);
    const state = { bots: [], running: false };

    socket.on('start', async (data) => {
        if (state.running) return;
        state.running = true;
        state.bots = [];

        const { pin, count, prefix } = data;
        const total = Math.min(count || 10, 250);
        let succ = 0, fail = 0;

        console.log(`\n=== FLOOD ${pin} / ${total} bots ===`);
        socket.emit('log', `flood: ${pin} / ${total} bots`);

        for (let i = 0; i < total && state.running; i++) {
            const name = `${prefix || 'Bot'}${i + 1}`;
            try {
                const client = new Kahoot();
                client.loggingMode = false;

                client.on('Joined', (settings) => {
                    succ++;
                    state.bots.push({ client, name, answered: false });
                    socket.emit('botJoin', { name, ok: true });
                    console.log(`[${name}] joined`);
                });

                client.on('QuestionStart', (question) => {
                    socket.emit('question', {
                        questionIndex: question.index,
                        numChoices: question.choices ? question.choices.length : 4
                    });
                });

                client.on('QuizStart', () => socket.emit('quizstart', {}));
                client.on('QuizEnd', () => socket.emit('gameover', {}));
                client.on('GameStart', () => socket.emit('quizstart', {}));
                client.on('GameEnd', () => socket.emit('gameover', {}));
                client.on('Disconnect', () => {
                    socket.emit('botDisconnect', { name });
                });

                client.join(pin, name).catch((e) => {
                    fail++;
                    console.log(`[${name}] FAILED: ${e.message || e}`);
                    socket.emit('botJoin', { name, ok: false, error: String(e.message || e) });
                });
            } catch (e) {
                fail++;
                console.log(`[${name}] ERROR: ${e.message}`);
                socket.emit('botJoin', { name, ok: false, error: e.message });
            }
            await new Promise(r => setTimeout(r, 200));
        }

        setTimeout(() => {
            console.log(`=== DONE: ${succ} ok, ${fail} failed ===`);
            socket.emit('ready', { succ, fail });
            state.running = false;
        }, 8000);
    });

    socket.on('answer', (data) => {
        state.bots.forEach(b => {
            if (b.answered) return;
            b.answered = true;
            try {
                b.client.answer(data.choice, Math.floor(Math.random() * 2000) + 500);
            } catch (e) {}
        });
    });

    socket.on('resetAnswers', () => {
        state.bots.forEach(b => b.answered = false);
    });

    socket.on('stop', () => {
        state.running = false;
        state.bots.forEach(b => { try { b.client.leave(); } catch (e) {} });
        state.bots = [];
    });

    socket.on('disconnect', () => {
        state.running = false;
        state.bots.forEach(b => { try { b.client.leave(); } catch (e) {} });
        state.bots = [];
    });
});

app.get('/health', (req, res) => res.json({ ok: true, version: VERSION, uptime: process.uptime(), node: process.version }));
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
.app{width:100%;max-width:400px;position:relative}
.ver{position:fixed;top:10px;left:12px;font-size:10px;color:#3f3f46;font-family:monospace;letter-spacing:.03em}
.logo{text-align:center;margin-bottom:28px}
.logo h1{font-size:26px;font-weight:800;letter-spacing:-.5px}
.logo h1 span{color:#a855f7}
.field{margin-bottom:10px}
.field label{display:block;font-size:11px;font-weight:600;color:#52525b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
.field input{width:100%;padding:11px 13px;background:#18181b;border:1px solid #27272a;border-radius:8px;color:#fafafa;font-size:15px}
.field input:focus{outline:none;border-color:#a855f7}
.field input::placeholder{color:#3f3f46}
.row{display:flex;gap:10px}
.row .field{flex:1}
.btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px}
.btn-go{background:#a855f7;color:#fff}
.btn-go:active{transform:scale(.98)}
.btn-stop{background:#dc2626;color:#fff;display:none}
.panel{margin-top:16px;background:#18181b;border:1px solid #27272a;border-radius:10px;overflow:hidden;display:none}
.panel-head{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #27272a}
.panel-head span{font-size:11px;font-weight:600;color:#52525b;text-transform:uppercase}
.count{color:#a855f7;font-size:13px;font-weight:700}
.bar{height:2px;background:#27272a}
.bar-fill{height:100%;background:#a855f7;width:0%;transition:width .3s}
.logbox{padding:8px 14px;max-height:120px;overflow-y:auto;font-family:monospace;font-size:11px;line-height:1.7}
.logbox p{color:#3f3f46}.logbox p.g{color:#4ade80}.logbox p.r{color:#f87171}.logbox p.b{color:#60a5fa}.logbox p.y{color:#fbbf24}
.botbox{display:flex;flex-wrap:wrap;gap:4px;padding:8px 14px;border-top:1px solid #27272a}
.botbox span{padding:2px 8px;background:#09090b;border:1px solid #27272a;border-radius:4px;font-size:10px;color:#52525b;font-family:monospace}
.botbox span.g{border-color:#166534;color:#4ade80}.botbox span.r{border-color:#7f1d1d;color:#f87171}
#answerBar{position:fixed;bottom:0;left:0;right:0;background:#18181b;border-top:1px solid #27272a;padding:10px 12px 20px;z-index:100}
.abar-info{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding:0 4px}
.abar-info .status{font-size:11px;color:#52525b}.abar-info .status.connected{color:#4ade80}
.abar-info .last{font-size:11px;color:#a855f7;font-weight:600}
.answer-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.abtn{padding:0;height:64px;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .1s,box-shadow .1s;position:relative;overflow:hidden}
.abtn:active{transform:scale(.95)}.abtn.sent{box-shadow:0 0 0 3px #fff}
.abtn .shape{position:absolute}
.abtn.r{background:#e11d48}.abtn.b{background:#2563eb}.abtn.y{background:#eab308}.abtn.g{background:#16a34a}
.tri{width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-bottom:28px solid rgba(255,255,255,.95)}
.dia{width:20px;height:20px;background:rgba(255,255,255,.95);transform:rotate(45deg)}
.cir{width:26px;height:26px;background:rgba(255,255,255,.95);border-radius:50%}
.sqr{width:22px;height:22px;background:rgba(255,255,255,.95);border-radius:3px}
.abar-hint{text-align:center;margin-top:6px;font-size:10px;color:#3f3f46}
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
<button class="btn btn-go" id="goBtn">flood</button>
<button class="btn btn-stop" id="stopBtn">stop</button>
<div class="panel" id="panel">
<div class="panel-head"><span>log</span><span class="count" id="countLabel">0 / 0</span></div>
<div class="bar"><div class="bar-fill" id="barFill"></div></div>
<div class="logbox" id="log"></div>
<div class="botbox" id="bots"></div>
</div>
</div>
<div id="answerBar">
<div class="abar-info"><span class="status" id="abStatus">not connected</span><span class="last" id="abLast"></span></div>
<div class="answer-grid">
<button class="abtn r" onclick="sendAns(0)"><span class="shape tri"></span></button>
<button class="abtn b" onclick="sendAns(1)"><span class="shape dia"></span></button>
<button class="abtn y" onclick="sendAns(2)"><span class="shape cir"></span></button>
<button class="abtn g" onclick="sendAns(3)"><span class="shape sqr"></span></button>
</div>
<div class="abar-hint">tap to answer | keys 1 2 3 4</div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
var socket=io();var succ=0,fail=0,total=0,connectedCount=0;
var pinEl=document.getElementById('pin'),countEl=document.getElementById('count'),prefixEl=document.getElementById('prefix'),goBtn=document.getElementById('goBtn'),stopBtn=document.getElementById('stopBtn'),panel=document.getElementById('panel'),logEl=document.getElementById('log'),botsEl=document.getElementById('bots'),countLabel=document.getElementById('countLabel'),barFill=document.getElementById('barFill'),abStatus=document.getElementById('abStatus'),abLast=document.getElementById('abLast');
function addLog(t,c){var p=document.createElement('p');if(c)p.className=c;p.textContent=t;logEl.appendChild(p);logEl.scrollTop=logEl.scrollHeight}
function updateUI(){var done=succ+fail;countLabel.textContent=done+' / '+total;barFill.style.width=Math.min(100,done/total*100)+'%'}
function addTag(n,c){var s=document.createElement('span');if(c)s.className=c;s.textContent=n;botsEl.appendChild(s)}
function updateStatus(){if(connectedCount>0){abStatus.textContent=connectedCount+' bot'+(connectedCount>1?'s':'')+' ready';abStatus.className='status connected'}else{abStatus.textContent='not connected';abStatus.className='status'}}
goBtn.addEventListener('click',function(){var pin=pinEl.value.trim().replace(/\\s/g,'');var count=parseInt(countEl.value)||10;var prefix=prefixEl.value.trim()||'Bot';if(!pin)return alert('enter a pin');succ=0;fail=0;total=count;connectedCount=0;goBtn.style.display='none';stopBtn.style.display='block';panel.style.display='block';logEl.innerHTML='';botsEl.innerHTML='';addLog('flood: '+pin+' / '+count+' bots','b');socket.emit('start',{pin:pin,count:count,prefix:prefix})});
stopBtn.addEventListener('click',function(){socket.emit('stop');goBtn.style.display='block';stopBtn.style.display='none';connectedCount=0;updateStatus();addLog('stopped','r')});
function sendAns(choice){socket.emit('answer',{choice:choice});socket.emit('resetAnswers');var n=['RED','BLUE','YELLOW','GREEN'];abLast.textContent=n[choice]+' sent';addLog('sent: '+n[choice],'b');var btns=document.querySelectorAll('.abtn');btns.forEach(function(b,i){b.classList.toggle('sent',i===choice)});setTimeout(function(){btns.forEach(function(b){b.classList.remove('sent')})},400)}
socket.on('log',function(t){addLog(t,'b')});
socket.on('botJoin',function(d){if(d.ok){succ++;connectedCount++;addLog('+ '+d.name,'g');addTag(d.name,'g');updateStatus()}else{fail++;addLog('x '+d.name+': '+d.error,'r');addTag(d.name,'r')}updateUI()});
socket.on('ready',function(d){addLog('done: '+d.succ+' connected, '+d.fail+' failed',d.succ>0?'g':'r')});
socket.on('question',function(d){addLog('question ('+d.numChoices+' choices)','y')});
socket.on('quizstart',function(){addLog('quiz started','b')});
socket.on('gameover',function(){addLog('game over','b')});
socket.on('botDisconnect',function(d){connectedCount--;updateStatus();addLog('- '+d.name+' disconnected','r')});
socket.on('connect_error',function(e){addLog('error: '+e.message,'r')});
document.addEventListener('keydown',function(e){if(e.key==='Enter'&&goBtn.style.display!=='none')goBtn.click();if(e.key==='1')sendAns(0);if(e.key==='2')sendAns(1);if(e.key==='3')sendAns(2);if(e.key==='4')sendAns(3)});
</script>
</body>
</html>`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`kahoot-gefickt ${VERSION} on port ${PORT}`));
