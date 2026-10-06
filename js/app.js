/* PhishGuard — application logic. */
/* =========================================================================
   State + helpers
   ========================================================================= */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const shuffle = a => a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(v=>v[1]);
const esc = s => String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const S = {
  category:"mixed", difficulty:"any", list:[], i:0, score:0, answered:0,
  lives:3, useLives:false, useTimer:false, longRound:false,
  results:[], flagsFound:0, symposium:false, timerId:null, timeLeft:60, locked:false
};

function toast(msg,kind){
  const t=$("#toast"); t.textContent=msg; t.className="toast show "+(kind||"");
  clearTimeout(t._t); t._t=setTimeout(()=>t.className="toast",2200);
}
function go(id){
  if(id==="admin" && (!window.PGAuthService || !PGAuthService.isAuthenticated())) id="admin-login";
  if(id==="participant-details" && window.PGPortalResume && PGPortalResume()) return;
  $$("section.view").forEach(v=>v.classList.remove("active"));
  const el=$("#view-"+id); if(el){el.classList.add("active");}
  $$("nav.main button").forEach(b=>b.removeAttribute("aria-current"));
  const nav=$('nav.main button[data-go="'+id+'"]'); if(nav)nav.setAttribute("aria-current","page");
  $("#mainnav").classList.remove("open"); $("#menuBtn").setAttribute("aria-expanded","false");
  window.scrollTo({top:0,behavior:"instant"});
  observeReveals();
}
document.addEventListener("click",e=>{
  const g=e.target.closest("[data-go]"); if(g){go(g.dataset.go);}
  const sc=e.target.closest("[data-scroll]");
  if(sc){go("home");setTimeout(()=>{const t=$("#"+sc.dataset.scroll);if(t)t.scrollIntoView({behavior:"smooth"});},60);}
});
$("#menuBtn").addEventListener("click",()=>{
  const n=$("#mainnav"), open=n.classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded",String(open));
});

/* motes */
(function motes(){
  const box=$("#motes"), colors=["#38d2ff","#31e39a","#9d7bff"];
  for(let i=0;i<16;i++){
    const m=document.createElement("i"); m.className="mote";
    m.style.left=Math.random()*100+"%";
    m.style.color=m.style.background=colors[i%3];
    m.style.animationDuration=(16+Math.random()*20)+"s";
    m.style.animationDelay=(-Math.random()*30)+"s";
    box.appendChild(m);
  }
})();

/* reveal on scroll */
let io;
function observeReveals(){
  if(!("IntersectionObserver" in window)){$$(".reveal").forEach(r=>r.classList.add("in"));return;}
  if(!io) io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){en.target.classList.add("in");io.unobserve(en.target);}}),{threshold:.14});
  $$(".reveal:not(.in)").forEach(r=>io.observe(r));
}

/* =========================================================================
   Build static lists
   ========================================================================= */
$("#catGrid").innerHTML = CATS.map(([id,ico,name,desc])=>`
  <button class="pick" data-cat="${id}">
    <div class="ico">${ico}</div><strong>${name}</strong><p>${desc}</p>
    <span class="go">START →</span>
  </button>`).join("");
$$("#catGrid .pick").forEach(b=>b.addEventListener("click",()=>{
  S.category=b.dataset.cat;
  $("#diffTitle").textContent = "Pick your difficulty — " + CATS.find(c=>c[0]===S.category)[2];
  go("difficulty");
}));
$$("[data-diff]").forEach(b=>b.addEventListener("click",()=>{
  S.difficulty=b.dataset.diff;
  S.useLives=$("#optLives").checked; S.useTimer=$("#optTimer").checked; S.longRound=$("#optLong").checked;
  S.symposium=false; document.body.classList.remove("sympo"); $("#sympoExit").hidden=true;
  startRound();
}));

$("#learnList").innerHTML = LEARN.map(([q,a])=>`
  <details class="faq"><summary>${q}</summary><div class="inner">${a}</div></details>`).join("");
$("#checklist").innerHTML = CHECKS.map(([t,d])=>`
  <div class="check"><span class="tick">☑</span><div><b>${t}</b><div style="color:var(--muted);font-size:.92rem">${d}</div></div></div>`).join("");
$("#flagCards").innerHTML = FLAGCARDS.map(([t,d])=>`
  <div class="flagcard"><b>🚩 ${t}</b><p>${d}</p></div>`).join("");
$("#huntGrid").innerHTML = HUNTS.map(h=>`
  <button class="pick" data-hunt="${h.id}"><div class="ico">${h.icon}</div><strong>${h.title}</strong>
  <p>${h.subtitle}</p><span class="go">HUNT →</span></button>`).join("");
$$("#huntGrid .pick").forEach(b=>b.addEventListener("click",()=>startHunt(b.dataset.hunt)));
$("#cmpGrid").innerHTML = COMPARES.map(c=>`
  <button class="pick" data-cmp="${c.id}"><div class="ico">🌐</div><strong>${c.label}</strong>
  <p>${c.context}</p><span class="go">COMPARE →</span></button>`).join("");
$$("#cmpGrid .pick").forEach(b=>b.addEventListener("click",()=>startCompare(b.dataset.cmp)));

/* =========================================================================
   Scenario renderers
   ========================================================================= */
function qrSVG(seed){
  let s=0; for(const ch of seed) s=(s*31+ch.charCodeAt(0))>>>0;
  const rnd=()=> (s=(s*1103515245+12345)>>>0, (s>>>16)/65535);
  const N=21, cells=[];
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const finder=(x<7&&y<7)||(x>N-8&&y<7)||(x<7&&y>N-8);
    if(finder) continue;
    if(rnd()>.52) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  }
  const eye=(x,y)=>`<rect x="${x}" y="${y}" width="7" height="7" fill="#000"/><rect x="${x+1}" y="${y+1}" width="5" height="5" fill="#fff"/><rect x="${x+2}" y="${y+2}" width="3" height="3" fill="#000"/>`;
  return `<svg viewBox="0 0 ${N} ${N}" role="img" aria-label="Illustrative QR code graphic"><rect width="${N}" height="${N}" fill="#fff"/><g fill="#000">${cells.join("")}</g>${eye(0,0)}${eye(N-7,0)}${eye(0,N-7)}</svg>`;
}

function renderScenario(q){
  if(q.type==="email"){
    const s=q.sender;
    return `<div class="mock mail">
      <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="label">Inbox — Mail</span></div>
      <div class="mail-top">
        <div class="mail-subject">${esc(q.subject)}</div>
        <div class="mail-from">
          <div class="avatar" style="background:${s.color}">${esc(s.initials)}</div>
          <div class="who"><div class="nm">${esc(s.name)}</div><div class="ad">&lt;${esc(s.email)}&gt;</div></div>
          <div class="mail-date">${esc(q.date)}</div>
        </div>
      </div>
      <div class="mail-body">${q.body}</div>
    </div>
    <p class="qmeta" style="margin-top:10px">Buttons and links in this mockup are disabled and lead nowhere.</p>`;
  }
  if(q.type==="sms"){
    return `<div class="phone">
      <div class="phone-top">Messages<b>${esc(q.from)}</b></div>
      ${q.messages.map(m=>`<div class="bubble">${m.text}</div>`).join("")}
      <div class="stamp">${esc(q.stamp)}</div>
    </div>`;
  }
  if(q.type==="website"){
    const st=q.site;
    return `<div class="mock">
      <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="label">Browser</span></div>
      <div class="urlbar"><div class="urlbox">${q.secure?'<span class="sec-ok">🔒 https</span>':'<span class="sec-bad">⚠ Not secure</span>'}<span>${esc(q.url)}</span></div></div>
      <div class="sitebody">
        <div class="brandlogo" style="justify-content:center"><span class="sq" style="background:${st.color}">${esc(st.brand[0])}</span> ${esc(st.brand)}</div>
        <h3 style="font-size:1.05rem;margin:6px 0 2px">${esc(st.heading)}</h3>
        <p style="color:var(--muted);font-size:.88rem">${esc(st.note)}</p>
        ${st.popup?`<div class="popup">${esc(st.popup)}</div>`:""}
        ${st.fields.map(f=>`<span class="field">${esc(f)}</span>`).join("")}
        <p style="color:var(--dim);font-size:.78rem;margin-top:14px">Visual mockup only — these fields are not real inputs and submit nothing.</p>
      </div>
    </div>`;
  }
  if(q.type==="qr"){
    const p=q.poster;
    return `<div class="mock"><div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="label">Scanned with your phone camera</span></div>
      <div class="qr-wrap">
        <div class="qr">${qrSVG(q.id)}</div>
        <div class="poster">
          <span class="chip">${esc(p.badge)}</span>
          <h3 style="margin:10px 0 4px;font-size:1.1rem">${esc(p.heading)}</h3>
          <p style="color:var(--muted);font-size:.92rem;margin-bottom:8px">${esc(p.sub)}</p>
          <p style="color:var(--dim);font-size:.83rem">${esc(p.foot)}</p>
        </div>
      </div>
      <div class="urlbar"><div class="urlbox"><span style="color:var(--muted)">Camera preview →</span><span>${esc(q.scanned)}</span></div></div>
    </div>
    <p class="qmeta" style="margin-top:10px">The code above is a decorative graphic, not a working QR code.</p>`;
  }
  return "";
}

/* =========================================================================
   Quiz flow
   ========================================================================= */
function pickQuestions(){
  let pool = QUESTIONS.filter(q=>
    (S.category==="mixed" || q.category===S.category) &&
    (S.difficulty==="any" || q.difficulty===S.difficulty));
  if(pool.length<4){
    pool = QUESTIONS.filter(q=> S.category==="mixed" || q.category===S.category);
  }
  const want = S.symposium?10:(S.longRound?15:10);
  return shuffle(pool).slice(0,Math.min(want,pool.length));
}
function startRound(){
  S.list=pickQuestions(); S.i=0; S.score=0; S.answered=0; S.results=[]; S.lives=3;
  if(!S.list.length){toast("No scenarios matched that combination.");return;}
  go("quiz"); renderQuestion();
}
function renderQuestion(){
  clearInterval(S.timerId); S.locked=false;
  const q=S.list[S.i];
  $("#qNow").textContent=S.i+1; $("#qTotal").textContent=S.list.length;
  $("#qBar").style.width=((S.i)/S.list.length*100)+"%";
  $("#qScore").textContent=S.score; $("#qAnswered").textContent=S.answered;
  $("#qCat").textContent=({email:"EMAIL",sms:"SMISHING",website:"FAKE WEBSITE",qr:"QUISHING",ai:"AI PHISHING"})[q.category];
  $("#qDiff").textContent=q.difficulty.toUpperCase();
  const lv=$("#qLives"); lv.hidden=!S.useLives;
  if(S.useLives) lv.innerHTML=[0,1,2].map(i=>`<span class="${i<S.lives?"":"gone"}">❤️</span>`).join("");
  $("#stage").innerHTML=renderScenario(q);
  $("#feedback").innerHTML="";
  [$("#btnLegit"),$("#btnPhish")].forEach(b=>{b.disabled=false;b.classList.remove("chosen","faded");});
  const t=$("#qTimer"); t.hidden=!S.useTimer;
  if(S.useTimer){
    S.timeLeft=60; t.textContent="60s"; t.classList.remove("low");
    S.timerId=setInterval(()=>{
      S.timeLeft--; t.textContent=S.timeLeft+"s";
      if(S.timeLeft<=10)t.classList.add("low");
      if(S.timeLeft<=0){clearInterval(S.timerId); answer(null);}
    },1000);
  }
}
function answer(choice){
  if(S.locked) return; S.locked=true; clearInterval(S.timerId);
  const q=S.list[S.i];
  const correct = choice===q.answer;
  S.answered++;
  if(correct){S.score++; S.flagsFound += q.flags.length;}
  else if(S.useLives){S.lives--;}
  S.results.push({q,choice,correct});

  const bl=$("#btnLegit"), bp=$("#btnPhish");
  [bl,bp].forEach(b=>b.disabled=true);
  if(choice==="legitimate"){bl.classList.add("chosen");bp.classList.add("faded");}
  else if(choice==="phishing"){bp.classList.add("chosen");bl.classList.add("faded");}
  else {bl.classList.add("faded");bp.classList.add("faded");}

  const truthLabel = q.answer==="phishing" ? "This is a phishing attempt." : "This message is legitimate.";
  const head = choice===null ? "⏱️ TIME'S UP" : (correct ? "🎉 CORRECT!" : "⚠️ NOT QUITE!");
  const sub  = choice===null ? "No answer recorded — here's what it was. " + truthLabel
             : (correct ? truthLabel : "You answered "+choice+". "+truthLabel);

  const flagsHTML = q.flags.length ? `
    <h4 style="margin:18px 0 0;font-size:.95rem">🚩 RED FLAGS ${correct?"FOUND":"YOU CAN USE NEXT TIME"}</h4>
    <ul class="flags">${q.flags.map((f,i)=>`<li style="animation-delay:${i*70}ms"><span>🚩</span><span>${f}</span></li>`).join("")}</ul>`
  : `<h4 style="margin:18px 0 0;font-size:.95rem">✅ WHY THIS ONE IS SAFE</h4>
     <ul class="flags"><li><span>✅</span><span>No red flags: the sender, the domain and the request all match, and the message asks nothing of you that it shouldn't.</span></li></ul>`;

  $("#feedback").innerHTML = `
    <div class="feedback ${correct?"good":"bad"}">
      <div class="fb-head"><span>${head}</span></div>
      <p style="color:var(--muted);margin:0">${esc(sub)}</p>
      ${flagsHTML}
      <p style="margin-top:16px">${q.explanation}</p>
      <div class="tip"><b>SECURITY TIP</b>${q.tip}</div>
      <div class="next-row">
        ${S.useLives&&S.lives<=0?`<span class="qmeta" style="align-self:center">Out of lives — but the round continues. Learning beats losing.</span>`:""}
        <button class="btn btn-primary" id="nextBtn">${S.i+1>=S.list.length?"See my result":"Next question →"}</button>
      </div>
    </div>`;
  $("#qScore").textContent=S.score; $("#qAnswered").textContent=S.answered;
  $("#qBar").style.width=((S.i+1)/S.list.length*100)+"%";
  if(S.useLives) $("#qLives").innerHTML=[0,1,2].map(i=>`<span class="${i<S.lives?"":"gone"}">❤️</span>`).join("");
  $("#nextBtn").focus();
  $("#nextBtn").addEventListener("click",()=>{
    if(S.i+1>=S.list.length){showResults();} else {S.i++;renderQuestion();}
  });
}
$("#btnLegit").addEventListener("click",()=>answer("legitimate"));
$("#btnPhish").addEventListener("click",()=>answer("phishing"));
document.addEventListener("keydown",e=>{
  if(!$("#view-quiz").classList.contains("active")) return;
  if(e.target.matches("input,textarea")) return;
  if(e.key==="1"||e.key.toLowerCase()==="l"){if(!S.locked)answer("legitimate");}
  if(e.key==="2"||e.key.toLowerCase()==="p"){if(!S.locked)answer("phishing");}
  if(e.key==="Enter"&&S.locked){const n=$("#nextBtn");if(n)n.click();}
});

/* ---------------- Results ---------------- */
function showResults(){
  clearInterval(S.timerId);
  const total=S.list.length, correct=S.score, wrong=total-correct;
  const pct=Math.round(correct/total*100);
  const cats=[...new Set(S.results.map(r=>r.q.category))]
    .map(c=>({email:"Email",sms:"Smishing",website:"Websites",qr:"Quishing",ai:"AI"})[c]).join(" · ");

  go("results");
  $("#resScore").textContent = "0 / "+total;
  let n=0; const step=()=>{ if(n<correct){n++; $("#resScore").textContent=n+" / "+total; setTimeout(step,Math.max(60,420/Math.max(correct,1)));} };
  setTimeout(step,180);
  $("#resPct").textContent=pct+"%";
  $("#tAtt").textContent=total; $("#tCorr").textContent=correct; $("#tWrong").textContent=wrong;
  $("#tAcc").textContent=pct+"%"; $("#tFlags").textContent=S.flagsFound; $("#tCats").textContent=cats||"—";
  const ring=$("#ringVal"), C=327;
  ring.style.strokeDashoffset=C; setTimeout(()=>{ring.style.strokeDashoffset=C-(C*pct/100);},120);

  let badge,msg;
  if(pct>=90){badge="Sharp Eye";msg="You caught nearly everything, including the clues that only show up when you read a domain properly. Keep that habit outside the quiz — the real thing arrives when you're busy, not when you're looking for it.";}
  else if(pct>=70){badge="Strong Awareness";msg="You successfully identified most of the suspicious clues. Continue checking URLs, sender addresses and unexpected requests before interacting with messages.";}
  else if(pct>=50){badge="Building Awareness";msg="You're catching the obvious attempts and missing the quieter ones. The highest-value habit to add: read the domain right to left from the first slash, every single time.";}
  else {badge="Worth Another Round";msg="Most of these fooled you, which is exactly why this practice exists — they're built to. Read the Red Flags section, then play again. The pattern gets easy surprisingly fast.";}
  $("#resBadge").textContent=badge; $("#resMsg").textContent=msg;
  S.lastBadge=badge;
  $("#saveMsg").textContent=""; $("#nickInput").value="";
  renderReview();
}
function renderReview(){
  $("#reviewList").innerHTML = S.results.map((r,i)=>{
    const q=r.q;
    return `<details class="rev"><summary>
      <span class="mark ${r.correct?"ok":"no"}">${r.correct?"✓":"✕"}</span>
      <span><b>Question ${i+1}</b> — ${esc(q.title)}</span>
      <span class="chip" style="margin-left:auto">${q.difficulty.toUpperCase()}</span></summary>
      <div class="inner">
        <div class="kv">
          <span>Your answer: <b>${r.choice?esc(r.choice):"no answer"}</b></span>
          <span>Correct answer: <b>${esc(q.answer)}</b></span>
          <span>Result: <b>${r.correct?"Correct":"Incorrect"}</b></span>
        </div>
        ${q.flags.length?`<b style="font-size:.9rem">Important red flags</b><ul class="flags">${q.flags.map(f=>`<li><span>🚩</span><span>${f}</span></li>`).join("")}</ul>`:`<b style="font-size:.9rem">Why it was safe</b><p style="color:var(--muted);font-size:.92rem">Nothing in this message asked you to act, and the sender, domain and request all matched.</p>`}
        <p style="margin-top:14px">${q.explanation}</p>
        <div class="tip"><b>SECURITY TIP</b>${q.tip}</div>
      </div></details>`;
  }).join("");
}
$("#reviewBtn").addEventListener("click",()=>go("review"));
$("#againBtn").addEventListener("click",()=>{ S.symposium?startSymposium():startRound(); });
$("#againBtn2").addEventListener("click",()=>{ S.symposium?startSymposium():startRound(); });

/* ---------------- Leaderboard (localStorage) ---------------- */
const LB_KEY="phishguard.leaderboard.v1";
function loadBoard(){
  try{ return JSON.parse(localStorage.getItem(LB_KEY)||"[]"); }catch(e){ return []; }
}
function saveBoard(rows){
  try{ localStorage.setItem(LB_KEY,JSON.stringify(rows.slice(0,20))); return true; }
  catch(e){ return false; }
}
function renderBoard(){
  const rows=loadBoard().sort((a,b)=> b.pct-a.pct || b.score-a.score);
  $("#lbBody").innerHTML = rows.length
    ? rows.slice(0,10).map((r,i)=>`<tr><td class="rk">${i+1}</td><td>${esc(r.name)}</td><td>${r.score}/${r.total}</td><td class="qmeta">${esc(r.mode)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="empty">No scores yet. Finish a round and add a nickname.</td></tr>`;
}
$("#saveScore").addEventListener("click",()=>{
  const raw=$("#nickInput").value.trim();
  if(!raw){ $("#saveMsg").textContent="Enter a nickname first."; return; }
  if(/[@0-9]{6,}|@/.test(raw)){ $("#saveMsg").textContent="Nicknames only — no emails or phone numbers."; return; }
  const name=raw.replace(/[<>]/g,"").slice(0,14);
  const total=S.list.length, score=S.score;
  const rows=loadBoard();
  rows.push({name,score,total,pct:Math.round(score/total*100),
    mode:S.symposium?"Symposium":(CATS.find(c=>c[0]===S.category)||[,,"Mixed"])[2]});
  const ok=saveBoard(rows);
  $("#saveMsg").textContent = ok ? "Saved to this browser." : "Couldn't save — storage is unavailable here.";
  renderBoard();
});
$("#clearBoard").addEventListener("click",()=>{
  try{ localStorage.removeItem(LB_KEY); }catch(e){}
  renderBoard(); toast("Leaderboard cleared.");
});
renderBoard();

/* =========================================================================
   Red flag hunt
   ========================================================================= */
let hunt={data:null,found:0};
function startHunt(id){
  const h=HUNTS.find(x=>x.id===id); if(!h)return;
  hunt={data:h,found:0};
  go("hunt");
  $("#huntTitle").textContent="🔎 "+h.title;
  $("#huntSub").textContent=h.subtitle;
  $("#huntFound").textContent="0"; $("#huntTotal").textContent=h.total;
  $("#huntBar").style.width="0%";
  $("#huntStage").innerHTML=h.html;
  $("#huntResult").innerHTML="";
  $$("#huntStage .hot").forEach(el=>{
    el.setAttribute("role","button"); el.setAttribute("tabindex","0");
    el.setAttribute("aria-label","Suspicious element candidate: "+el.textContent.trim().slice(0,60));
    const hit=()=>{
      if(el.classList.contains("found"))return;
      el.classList.add("found"); el.setAttribute("aria-pressed","true");
      hunt.found++;
      $("#huntFound").textContent=hunt.found;
      $("#huntBar").style.width=(hunt.found/hunt.data.total*100)+"%";
      toast("RED FLAG DETECTED 🚩 — "+el.dataset.name,"flag");
      if(hunt.found>=hunt.data.total) setTimeout(finishHunt,700);
    };
    el.addEventListener("click",e=>{e.stopPropagation();hit();});
    el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();hit();}});
  });
  $("#huntStage").addEventListener("click",onMiss);
}
function onMiss(e){
  if(e.target.closest(".hot"))return;
  toast("Nothing suspicious there — that part is normal for this kind of message.","miss");
}
function finishHunt(){
  const h=hunt.data;
  const list=$$("#huntStage .hot").map(el=>({name:el.dataset.name,note:el.dataset.note,got:el.classList.contains("found")}));
  $$("#huntStage .hot").forEach(el=>{if(!el.classList.contains("found"))el.classList.add("found");});
  const msg = hunt.found>=h.total ? "Every clue found. That's the level of reading that keeps accounts safe."
    : hunt.found>=Math.ceil(h.total/2) ? "A solid pass. The ones you missed are the quiet, structural clues — those are the ones attackers count on."
    : "Most stayed hidden. Read the explanations below, then try another hunt — the same patterns repeat everywhere.";
  $("#huntResult").innerHTML=`<div class="feedback ${hunt.found>=h.total?"good":""}" style="margin-top:20px">
    <div class="fb-head">You found ${hunt.found}/${h.total} red flags</div>
    <p style="color:var(--muted);margin:0">${msg}</p>
    <div class="found-list">${list.map(x=>`<div>${x.got?"🚩":"➖"} <b>${esc(x.name)}</b> — ${esc(x.note)}</div>`).join("")}</div>
    <div class="next-row"><button class="btn" data-go="hunt-pick">Another hunt</button><button class="btn btn-primary" data-go="participant-details">Back to the quiz</button></div>
  </div>`;
  $("#huntResult").scrollIntoView({behavior:"smooth",block:"nearest"});
}
$("#huntDone").addEventListener("click",()=>{ if(hunt.data) finishHunt(); });

/* =========================================================================
   Compare mode
   ========================================================================= */
function siteHTML(s){
  return `<div class="mock">
    <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="label">Browser</span></div>
    <div class="urlbar"><div class="urlbox">${s.secure?'<span class="sec-ok">🔒 https</span>':'<span class="sec-bad">⚠ Not secure</span>'}<span>${esc(s.url)}</span></div></div>
    <div class="sitebody">
      <div class="brandlogo" style="justify-content:center"><span class="sq" style="background:${s.color}">${esc(s.brand[0])}</span> ${esc(s.brand)}</div>
      <h3 style="font-size:1rem;margin:6px 0 2px">${esc(s.heading)}</h3>
      <p style="color:var(--muted);font-size:.86rem">${esc(s.note)}</p>
      ${s.popup?`<div class="popup">${esc(s.popup)}</div>`:""}
      ${s.fields.map(f=>`<span class="field">${esc(f)}</span>`).join("")}
      <p style="color:var(--dim);font-size:.76rem;margin-top:12px">Visual mockup only — nothing here accepts input.</p>
    </div>
  </div>`;
}
let cmp=null;
function startCompare(id){
  cmp=COMPARES.find(c=>c.id===id); if(!cmp)return;
  go("compare");
  $("#cmpEyebrow").textContent=cmp.label.toUpperCase();
  $("#cmpContext").textContent=cmp.context;
  $("#cmpResult").innerHTML="";
  $("#cmpStage").innerHTML=["a","b"].map(k=>`
    <div>
      <div class="site-label"><span>Website ${k.toUpperCase()}</span>
        <button class="btn btn-sm" data-choose="${k}">Trust ${k.toUpperCase()}</button></div>
      <div class="site-pick" id="site-${k}">${siteHTML(cmp[k])}</div>
    </div>`).join("");
  $$("[data-choose]").forEach(b=>b.addEventListener("click",()=>decideCompare(b.dataset.choose)));
}
function decideCompare(choice){
  const right = choice===cmp.correct;
  $$("[data-choose]").forEach(b=>b.disabled=true);
  $("#site-"+cmp.correct).classList.add("win");
  $("#site-"+(cmp.correct==="a"?"b":"a")).classList.add("lose");
  $("#cmpResult").innerHTML=`<div class="feedback ${right?"good":"bad"}" style="margin-top:20px">
    <div class="fb-head">${right?"🎉 Correct":"⚠️ Not quite"}</div>
    <p style="color:var(--muted);margin:0">Website ${cmp.correct.toUpperCase()} is the trustworthy one. Here's what separates them.</p>
    <ul class="flags">${cmp.points.map((p,i)=>`<li style="animation-delay:${i*70}ms"><span>🔍</span><span>${p}</span></li>`).join("")}</ul>
    <div class="tip"><b>SECURITY TIP</b>Reach any login or payment page through your own bookmark or the official app. Then the address bar is confirming what you already expect, instead of being your only defence.</div>
    <div class="next-row"><button class="btn" data-go="compare-pick">Another pair</button><button class="btn btn-primary" data-go="participant-details">Back to the quiz</button></div>
  </div>`;
  $("#cmpResult").scrollIntoView({behavior:"smooth",block:"nearest"});
}

/* =========================================================================
   Symposium mode
   ========================================================================= */
function startSymposium(){
  S.symposium=true; S.category="mixed"; S.difficulty="any";
  S.useLives=false; S.useTimer=true; S.longRound=false;
  document.body.classList.add("sympo");
  $("#sympoExit").hidden=false;
  if(document.documentElement.requestFullscreen){
    document.documentElement.requestFullscreen().catch(()=>{});
  }
  startRound();
}
$("#symposiumBtn").addEventListener("click",()=>go("participant-details"));
$("#symposiumBtn2").addEventListener("click",()=>go("participant-details"));
$("#sympoExit").addEventListener("click",()=>{
  S.symposium=false; document.body.classList.remove("sympo"); $("#sympoExit").hidden=true;
  if(document.fullscreenElement&&document.exitFullscreen) document.exitFullscreen().catch(()=>{});
  clearInterval(S.timerId); go("home");
});
document.addEventListener("fullscreenchange",()=>{
  if(!document.fullscreenElement&&S.symposium){/* keep the large layout; exit is manual */}
});

observeReveals();
