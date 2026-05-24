import { sqlite } from "https://esm.town/v/std/sqlite/main.ts";
import { parseVal } from "https://esm.town/v/std/utils/index.ts";

// ── DB Setup ──────────────────────────────────────────────
await sqlite.batch([
  {
    sql: `CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
]);

// ── HTTP Handler ──────────────────────────────────────────
export default async function(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // --- API: POST /api/requests ---
  if (req.method === "POST" && url.pathname === "/api/requests") {
    try {
      const body = await req.json();
      const text = (body.text ?? "").trim();
      if (!text) {
        return Response.json({ error: "Request cannot be empty." }, { status: 400 });
      }
      if (text.length > 2000) {
        return Response.json({ error: "Request is too long (max 2000 chars)." }, { status: 400 });
      }
      await sqlite.execute({ sql: "INSERT INTO requests (text) VALUES (?)", args: [text] });
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }
  }

  // --- API: GET /api/requests ---
  if (req.method === "GET" && url.pathname === "/api/requests") {
    const result = await sqlite.execute("SELECT * FROM requests ORDER BY id DESC LIMIT 100");
    return Response.json(result.rows);
  }

  // --- API: POST /api/chat ---
  if (req.method === "POST" && url.pathname === "/api/chat") {
    try {
      const body = await req.json();
      const username = (body.username ?? "").trim();
      const message = (body.message ?? "").trim();
      if (!username || !message) {
        return Response.json({ error: "Username and message are required." }, { status: 400 });
      }
      if (message.length > 1000) {
        return Response.json({ error: "Message too long (max 1000 chars)." }, { status: 400 });
      }
      await sqlite.execute({
        sql: "INSERT INTO chat_messages (username, message) VALUES (?, ?)",
        args: [username, message],
      });
      return Response.json({ ok: true });
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }
  }

  // --- API: GET /api/chat ---
  if (req.method === "GET" && url.pathname === "/api/chat") {
    const after = url.searchParams.get("after") || "0";
    const result = await sqlite.execute({
      sql: "SELECT * FROM chat_messages WHERE id > ? ORDER BY id ASC LIMIT 500",
      args: [Number(after)],
    });
    return Response.json(result.rows);
  }

  // --- API: GET /api/chat/stream (SSE) ---
  if (req.method === "GET" && url.pathname === "/api/chat/stream") {
    const after = url.searchParams.get("after") || "0";
    let lastId = Number(after);
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (data: string) => {
          try {
            controller.enqueue(enc.encode(`data: ${data}\n\n`));
          } catch {
            closed = true;
          }
        };

        // Send a keepalive comment immediately so the connection is established
        try {
          controller.enqueue(enc.encode(": keepalive\n\n"));
        } catch {
          closed = true;
        }

        while (!closed) {
          try {
            const result = await sqlite.execute({
              sql: "SELECT * FROM chat_messages WHERE id > ? ORDER BY id ASC",
              args: [lastId],
            });
            for (const row of result.rows) {
              send(JSON.stringify(row));
              lastId = Number((row as any).id);
            }
          } catch { /* db hiccup, retry next cycle */ }
          await new Promise((r) => setTimeout(r, 400));
        }
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // --- Source redirect ---
  if (url.pathname === "/source") {
    return new Response(null, {
      status: 302,
      headers: { Location: parseVal().links.self.val },
    });
  }

  // --- Serve HTML UI ---
  return new Response(HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ── Frontend HTML ─────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Holbie</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>
<script src="https://esm.town/v/std/catch"></script>
<style>
  *{font-family:'Inter',system-ui,sans-serif;box-sizing:border-box}
  .fade-in{animation:fadeIn .3s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  @keyframes slideDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
  @keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}
  .toast{animation:slideDown .35s ease}
  .pulse-dot{animation:pulse-dot 1.5s ease-in-out infinite}
  textarea:focus,input:focus{outline:none;box-shadow:0 0 0 3px rgba(99,102,241,.25)}
  .chat-scroll::-webkit-scrollbar{width:6px}
  .chat-scroll::-webkit-scrollbar-track{background:transparent}
  .chat-scroll::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}
  .chat-scroll::-webkit-scrollbar-thumb:hover{background:#9ca3af}
  .bubble-mine{border-radius:18px 18px 4px 18px}
  .bubble-other{border-radius:18px 18px 18px 4px}
  .btn-primary{transition:all .15s ease}
  .btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(99,102,241,.35)}
  .btn-primary:active{transform:translateY(0)}
  .tab-pill{transition:all .2s ease}
</style>
</head>
<body class="bg-gray-50 min-h-screen">

<!-- Toast container -->
<div id="toast-container" class="fixed top-4 right-4 z-50 flex flex-col gap-2" style="pointer-events:none"></div>

<div class="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">

  <!-- Header -->
  <header class="mb-8">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-lg shadow-lg">H</div>
        <div>
          <h1 class="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">Holbie</h1>
          <p class="text-xs text-gray-400">Requests &amp; Live Chat</p>
        </div>
      </div>
      <a href="/source" class="text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors">&lt;/&gt; source</a>
    </div>
  </header>

  <!-- Tab Bar -->
  <nav class="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl">
    <button onclick="switchTab('requests')" id="tab-requests"
      class="tab-pill flex-1 py-2.5 text-sm font-semibold rounded-lg bg-white text-indigo-600 shadow-sm cursor-pointer">
      📋 Requests
    </button>
    <button onclick="switchTab('chat')" id="tab-chat"
      class="tab-pill flex-1 py-2.5 text-sm font-medium rounded-lg text-gray-500 cursor-pointer hover:text-gray-700">
      💬 Live Chat
    </button>
  </nav>

  <!-- ============ REQUESTS PANEL ============ -->
  <section id="panel-requests">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 mb-5">
      <label class="block text-sm font-semibold text-gray-700 mb-2">What do you need?</label>
      <textarea id="req-input" rows="3" maxlength="2000"
        placeholder="Describe your request in detail…"
        class="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none bg-gray-50 focus:bg-white transition-colors"></textarea>
      <div class="flex items-center justify-between mt-3">
        <span id="req-charcount" class="text-xs text-gray-300">0 / 2000</span>
        <button onclick="submitRequest()" id="req-submit-btn"
          class="btn-primary bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5m-7 7l7-7 7 7"/></svg>
          Submit
        </button>
      </div>
      <p id="req-error" class="text-red-500 text-xs mt-2 hidden font-medium"></p>
    </div>

    <div class="flex items-center justify-between mb-3">
      <h2 class="text-sm font-semibold text-gray-500 uppercase tracking-wider">Recent Requests</h2>
      <span id="req-count" class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium"></span>
    </div>
    <div id="req-list" class="space-y-3"></div>
    <div id="req-empty" class="hidden text-center py-12">
      <div class="text-4xl mb-2">📭</div>
      <p class="text-gray-400 text-sm">No requests yet. Be the first!</p>
    </div>
  </section>

  <!-- ============ LIVE CHAT PANEL ============ -->
  <section id="panel-chat" class="hidden">

    <!-- Username Login Gate -->
    <div id="chat-gate" class="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
      <div class="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-3xl mx-auto mb-4">💬</div>
      <h2 class="text-lg font-bold text-gray-900 mb-1">Join the Conversation</h2>
      <p class="text-sm text-gray-500 mb-5">Pick a username to start chatting in real-time</p>
      <div class="flex gap-2 max-w-xs mx-auto">
        <input id="username-input" type="text" placeholder="Your name…" maxlength="24"
          class="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:bg-white transition-colors"
          onkeydown="if(event.key==='Enter')joinChat()"/>
        <button onclick="joinChat()"
          class="btn-primary bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer">Join</button>
      </div>
      <p id="chat-gate-error" class="text-red-500 text-xs mt-3 hidden font-medium"></p>
    </div>

    <!-- Chat Room (hidden until joined) -->
    <div id="chat-room" class="hidden">
      <!-- Chat Header -->
      <div class="flex items-center justify-between bg-white rounded-t-2xl border border-b-0 border-gray-200 px-4 py-3">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-bold text-gray-800">Live Chat</h2>
          <div id="sse-status" class="flex items-center gap-1 text-xs text-emerald-600">
            <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full pulse-dot inline-block"></span>
            connected
          </div>
        </div>
        <span id="chat-user-badge" class="text-xs bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-full font-semibold"></span>
      </div>

      <!-- Messages -->
      <div id="chat-messages"
        class="chat-scroll bg-gray-50 border-l border-r border-gray-200 px-4 py-4 overflow-y-auto flex flex-col gap-2.5"
        style="height:360px">
      </div>

      <!-- Input Bar -->
      <div class="bg-white rounded-b-2xl border border-t-0 border-gray-200 px-3 py-3 flex gap-2">
        <input id="chat-input" type="text" maxlength="1000"
          placeholder="Type a message…"
          class="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:bg-white transition-colors"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMessage()}"/>
        <button onclick="sendMessage()" id="chat-send-btn"
          class="btn-primary bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
          Send
        </button>
      </div>
    </div>
  </section>
</div>

<script>
// ── Helpers ──
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}

function showToast(msg, type){
  var c=document.getElementById('toast-container');
  var t=document.createElement('div');
  var colors=type==='success'?'bg-emerald-600':'bg-red-500';
  var icon=type==='success'?'✓':'✕';
  t.className='toast '+colors+' text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2';
  t.style.pointerEvents='auto';
  t.innerHTML='<span class="text-base">'+icon+'</span> '+esc(msg);
  c.appendChild(t);
  setTimeout(function(){t.style.transition='opacity .3s';t.style.opacity='0';setTimeout(function(){t.remove()},300)},3000);
}

function relativeTime(iso){
  var d=new Date(iso+'Z');
  var now=new Date();
  var diff=Math.floor((now-d)/1000);
  if(diff<60)return 'just now';
  if(diff<3600)return Math.floor(diff/60)+'m ago';
  if(diff<86400)return Math.floor(diff/3600)+'h ago';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// ── Tab Switching ──
var currentTab='requests';
function switchTab(tab){
  currentTab=tab;
  document.getElementById('panel-requests').classList.toggle('hidden',tab!=='requests');
  document.getElementById('panel-chat').classList.toggle('hidden',tab!=='chat');
  var rBtn=document.getElementById('tab-requests');
  var cBtn=document.getElementById('tab-chat');
  if(tab==='requests'){
    rBtn.className='tab-pill flex-1 py-2.5 text-sm font-semibold rounded-lg bg-white text-indigo-600 shadow-sm cursor-pointer';
    cBtn.className='tab-pill flex-1 py-2.5 text-sm font-medium rounded-lg text-gray-500 cursor-pointer hover:text-gray-700';
  }else{
    cBtn.className='tab-pill flex-1 py-2.5 text-sm font-semibold rounded-lg bg-white text-indigo-600 shadow-sm cursor-pointer';
    rBtn.className='tab-pill flex-1 py-2.5 text-sm font-medium rounded-lg text-gray-500 cursor-pointer hover:text-gray-700';
  }
}

// ── Requests ──
var reqInput=document.getElementById('req-input');
reqInput.addEventListener('input',function(){
  document.getElementById('req-charcount').textContent=reqInput.value.length+' / 2000';
});

async function loadRequests(){
  try{
    var res=await fetch('/api/requests');
    var rows=await res.json();
    var list=document.getElementById('req-list');
    var empty=document.getElementById('req-empty');
    var countEl=document.getElementById('req-count');
    list.innerHTML='';
    countEl.textContent=rows.length;
    if(rows.length===0){empty.classList.remove('hidden');return}
    empty.classList.add('hidden');
    for(var i=0;i<rows.length;i++){
      var r=rows[i];
      var card=document.createElement('div');
      card.className='bg-white rounded-xl border border-gray-200 px-4 py-3.5 sm:px-5 sm:py-4 fade-in hover:shadow-sm transition-shadow';
      card.innerHTML='<p class="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">'+esc(r.text)+'</p>'
        +'<div class="flex items-center gap-2 mt-2"><span class="text-xs text-gray-400">'+relativeTime(r.created_at)+'</span>'
        +'<span class="text-gray-200">·</span><span class="text-xs text-gray-300">#'+r.id+'</span></div>';
      list.appendChild(card);
    }
  }catch(e){console.error('loadRequests failed',e)}
}

async function submitRequest(){
  var errEl=document.getElementById('req-error');
  var btn=document.getElementById('req-submit-btn');
  errEl.classList.add('hidden');
  var text=reqInput.value.trim();
  if(!text){
    errEl.textContent='⚠ Request cannot be empty.';
    errEl.classList.remove('hidden');
    reqInput.focus();
    return;
  }
  btn.disabled=true;btn.style.opacity='0.6';
  try{
    var res=await fetch('/api/requests',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text})
    });
    if(!res.ok){
      var d=await res.json();
      errEl.textContent='⚠ '+(d.error||'Submission failed.');
      errEl.classList.remove('hidden');
      return;
    }
    reqInput.value='';
    document.getElementById('req-charcount').textContent='0 / 2000';
    showToast('Request submitted successfully!','success');
    loadRequests();
  }catch(e){
    errEl.textContent='⚠ Network error. Please try again.';
    errEl.classList.remove('hidden');
  }finally{btn.disabled=false;btn.style.opacity='1'}
}

// ── Chat ──
var chatUsername='';
var lastMsgId=0;
var evtSource=null;

function joinChat(){
  var input=document.getElementById('username-input');
  var errEl=document.getElementById('chat-gate-error');
  errEl.classList.add('hidden');
  var name=input.value.trim();
  if(!name){errEl.textContent='⚠ Please enter a username.';errEl.classList.remove('hidden');input.focus();return}
  if(name.length<2){errEl.textContent='⚠ Username must be at least 2 characters.';errEl.classList.remove('hidden');return}
  chatUsername=name;
  document.getElementById('chat-gate').classList.add('hidden');
  document.getElementById('chat-room').classList.remove('hidden');
  document.getElementById('chat-user-badge').textContent='👤 '+esc(name);
  loadChatHistory().then(startSSE);
  document.getElementById('chat-input').focus();
}

async function loadChatHistory(){
  try{
    var res=await fetch('/api/chat?after=0');
    var rows=await res.json();
    var container=document.getElementById('chat-messages');
    container.innerHTML='';
    if(rows.length===0){
      container.innerHTML='<div class="flex-1 flex items-center justify-center"><div class="text-center"><div class="text-3xl mb-2">🎉</div><p class="text-sm text-gray-400">Chat is empty. Say hello!</p></div></div>';
    }
    for(var i=0;i<rows.length;i++){
      appendBubble(rows[i]);
      if(Number(rows[i].id)>lastMsgId)lastMsgId=Number(rows[i].id);
    }
    container.scrollTop=container.scrollHeight;
  }catch(e){console.error('loadChat failed',e)}
}

function startSSE(){
  if(evtSource)evtSource.close();
  var statusEl=document.getElementById('sse-status');
  evtSource=new EventSource('/api/chat/stream?after='+lastMsgId);
  evtSource.onopen=function(){
    statusEl.innerHTML='<span class="w-1.5 h-1.5 bg-emerald-500 rounded-full pulse-dot inline-block"></span> connected';
    statusEl.className='flex items-center gap-1 text-xs text-emerald-600';
  };
  evtSource.onmessage=function(e){
    var m=JSON.parse(e.data);
    if(Number(m.id)<=lastMsgId)return;
    lastMsgId=Number(m.id);
    // Remove empty placeholder if present
    var container=document.getElementById('chat-messages');
    var placeholder=container.querySelector('.text-3xl');
    if(placeholder)placeholder.parentElement.parentElement.remove();
    appendBubble(m);
    container.scrollTop=container.scrollHeight;
  };
  evtSource.onerror=function(){
    statusEl.innerHTML='<span class="w-1.5 h-1.5 bg-amber-500 rounded-full pulse-dot inline-block"></span> reconnecting…';
    statusEl.className='flex items-center gap-1 text-xs text-amber-600';
  };
}

// Colour palette for usernames
var userColours={};
var palette=['#6366f1','#ec4899','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#f97316'];
function colourFor(name){
  if(!userColours[name]){
    var hash=0;for(var i=0;i<name.length;i++)hash=name.charCodeAt(i)+((hash<<5)-hash);
    userColours[name]=palette[Math.abs(hash)%palette.length];
  }
  return userColours[name];
}

function appendBubble(m){
  var container=document.getElementById('chat-messages');
  var isMe=m.username===chatUsername;
  var time=new Date(m.created_at+'Z').toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});

  var wrapper=document.createElement('div');
  wrapper.className='flex '+(isMe?'justify-end':'justify-start')+' fade-in';

  var bubble=document.createElement('div');
  bubble.style.maxWidth='78%';

  if(isMe){
    bubble.className='bubble-mine bg-indigo-600 text-white px-4 py-2.5 text-sm';
    bubble.innerHTML='<p class="leading-relaxed whitespace-pre-wrap">'+esc(m.message)+'</p>'
      +'<p class="text-indigo-200 text-right mt-1" style="font-size:10px">'+time+'</p>';
  }else{
    bubble.className='bubble-other bg-white border border-gray-200 text-gray-800 px-4 py-2.5 text-sm shadow-sm';
    bubble.innerHTML='<p class="font-semibold mb-0.5" style="font-size:11px;color:'+colourFor(m.username)+'">'+esc(m.username)+'</p>'
      +'<p class="leading-relaxed whitespace-pre-wrap">'+esc(m.message)+'</p>'
      +'<p class="text-gray-400 mt-1" style="font-size:10px">'+time+'</p>';
  }

  wrapper.appendChild(bubble);
  container.appendChild(wrapper);
}

async function sendMessage(){
  var input=document.getElementById('chat-input');
  var btn=document.getElementById('chat-send-btn');
  var msg=input.value.trim();
  if(!msg)return;
  input.value='';
  btn.disabled=true;btn.style.opacity='0.6';
  try{
    var res=await fetch('/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username:chatUsername,message:msg})
    });
    if(!res.ok){
      var d=await res.json();
      showToast(d.error||'Failed to send.','error');
    }
  }catch(e){showToast('Network error. Message not sent.','error')}
  finally{btn.disabled=false;btn.style.opacity='1';input.focus()}
}

// ── Init ──
loadRequests();
</script>
</body>
</html>`;
