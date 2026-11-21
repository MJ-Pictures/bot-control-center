"use strict";
// Stubenkontrolle-Overlay (seit 8.9.0 vom Control Center ausgeliefert: /stubenkontrolle/overlay#key=SCHLUESSEL).
// Optionen im Fragment oder in der Query: key=…, render=video|svg, demo=registration|control|passed|caught, n=Anzahl, bg=Farbe.
const Q=new URLSearchParams(location.search), H=new URLSearchParams(String(location.hash||"").replace(/^#/,""));
const opt=k=>H.get(k)??Q.get(k);
const OVERLAY_KEY=String(opt("key")||"");
const WS_URL=(location.protocol==="https:"?"wss://":"ws://")+location.host+"/ws/stubenkontrolle";
const DEMO=opt("demo");
const BG=opt("bg");if(BG&&/^#?[0-9a-f]{3,8}$/i.test(BG))document.body.style.background=BG.startsWith("#")?BG:"#"+BG;
// WebM mit Alphakanal spielt Safari/WebKit (iPhone, iPad, Moblin, Safari am Mac) nicht transparent ab.
// Dort wird die Kontrollfigur live als SVG gezeichnet; OBS (Chromium) nutzt das Video.
const UA=navigator.userAgent||"";
const WEBKIT_ONLY=/iPhone|iPad|iPod/.test(UA)||(/AppleWebKit/.test(UA)&&!/Chrome|Chromium|Edg|OBS/.test(UA));
const RENDER=opt("render")==="svg"||opt("render")==="video"?opt("render"):(WEBKIT_ONLY?"svg":"video");

let ws=null,retry=1000,state=null,tick=null;
const $=id=>document.getElementById(id);
function scale(){const s=Math.min(innerWidth/1920,innerHeight/1080);$("stage").style.transform=`scale(${s})`;}
addEventListener("resize",scale);scale();

/* ===== Statusanzeige „WSS: …“ (Einstellung im Control Center: nur bei Problemen | immer | nie) ===== */
let statusMode=(()=>{try{return localStorage.getItem("stubeStatusMode")||"problem"}catch{return "problem"}})();
if(opt("status")==="1")statusMode="always";
function setStatus(text,ok){
  const el=$("conn");el.textContent=text;el.classList.toggle("ok",!!ok);
  el.classList.toggle("hidden",statusMode==="never"||(statusMode==="problem"&&ok));
}
function applyStatusMode(mode){
  if(opt("status")==="1")mode="always";
  if(!["problem","always","never"].includes(mode)||mode===statusMode)return;
  statusMode=mode;try{localStorage.setItem("stubeStatusMode",mode)}catch{}
  const el=$("conn");setStatus(el.textContent,el.classList.contains("ok"));
}
function connect(){
  if(OVERLAY_KEY&&!ws)setStatus("WSS: verbinde …",false);
  if(!OVERLAY_KEY){setStatus("Schlüssel fehlt: Adresse aus dem Control Center verwenden (…/stubenkontrolle/overlay#key=…)",false);return}
  const url=WS_URL+(WS_URL.includes("?")?"&":"?")+"key="+encodeURIComponent(OVERLAY_KEY);
  try{ws=new WebSocket(url)}catch{setTimeout(connect,retry);return}
  ws.onopen=()=>{setStatus("WSS: verbunden",true);retry=1000};
  ws.onmessage=e=>{try{state=JSON.parse(e.data);applyStatusMode(state.config?.statusDisplay);render()}catch{}};
  ws.onclose=()=>{setStatus(`WSS: getrennt – neuer Versuch in ${Math.round(retry/1000)} s (Schlüssel, Reverse-Proxy-WebSocket oder Verbindungslimit prüfen)`,false);setTimeout(connect,retry);retry=Math.min(15000,retry*1.7)};
  ws.onerror=()=>ws.close();
}
/* Bis 24 Personen große Karten, bis 48 kompakt, darüber blättert die Liste alle 5 s weiter. */
const PAGE_SIZE=48,PAGE_MS=5000;
function renderPeople(phase,all){
  if(phase==="result")all=[...all].sort((a,b)=>(b.outcome==="passed")-(a.outcome==="passed")||Math.abs(b.delta||0)-Math.abs(a.delta||0));
  const compact=all.length>24, pages=Math.max(1,Math.ceil(all.length/(compact?PAGE_SIZE:24))), per=Math.ceil(all.length/pages)||1; // 6×4 bzw. 8×6
  const page=Math.floor(Date.now()/PAGE_MS)%pages, list=all.slice(page*per,page*per+per);
  $("people").classList.toggle("compact",compact);
  $("people").innerHTML=list.map(p=>{
    const res=phase==="result"?(p.outcome==="passed"?` · +${p.delta}`:` · -${p.bet}`):"";
    return compact?`<div class="person ${p.outcome||""}"><strong>${escapeHtml(p.name)}</strong> ${p.bet}${res}</div>`
                  :`<div class="person ${p.outcome||""}"><strong>${escapeHtml(p.name)}</strong> · ${p.bet} SP${res}</div>`;
  }).join("");
  $("pageinfo").textContent=pages>1?`Seite ${page+1}/${pages} · ${all.length} Teilnehmende`:"";
}
setInterval(()=>{if(state&&state.phase!=="idle")renderPeople(state.phase,state.round?.participants||[])},PAGE_MS);
function render(){
  if(!state)return;
  const phase=state.phase||"idle",r=state.round;
  $("stage").classList.toggle("control",phase==="control");
  $("stage").classList.toggle("reg",phase==="registration");
  $("stage").classList.toggle("crowd",phase==="registration"&&(r?.participants?.length||0)>24);
  const show=phase!=="idle";
  $("panel").classList.toggle("show",show);
  syncWalkers(phase==="registration"?(r?.participants||[]):[]);
  if(!show){syncVerdict(phase,r);return}
  {const T=state.config?.titles||{};$("title").textContent=phase==="registration"?(T.registration||"ANMELDUNG ZUM SPIEL"):phase==="control"?(T.control||"KONTROLLE LÄUFT!"):(T.result||"ERGEBNIS DER RUNDE");}
  $("count").textContent=`Teilnehmende: ${r?.participants?.length||0}`;
  $("factor").textContent=`Faktor: x${r?.factor||"–"}`;
  $("command").textContent=phase==="registration"?(state.config?.command||""):"";
  $("resultTitle").textContent=phase==="result"?"Bestanden oder erwischt – die Abrechnung ist durch.":"";
  $("stage").classList.toggle("result",phase==="result");
  renderPhrase(phase,r);
  renderPeople(phase,r?.participants||[]);
  updateCountdown();
  syncVerdict(phase,r);
}
function updateCountdown(){
  if(!state)return;let end=null;
  if(state.phase==="registration")end=state.round?.joinEndsAt;else if(state.phase==="control")end=state.round?.controlEndsAt;
  if(!end){$("countdown").textContent="";return}
  const sec=Math.max(0,Math.ceil((new Date(end).getTime()-Date.now())/1000));$("countdown").textContent=`${sec}s`;
}
/* Ergebnistext: Namen samt Punkten der Teilnehmenden grün (bestanden) bzw. rot (erwischt) einfärben.
   Der Text wird vollständig escaped; eingefärbt werden nur exakte Treffer „@Name (+X)“ / „@Name (-X)“. */
function renderPhrase(phase,r){
  const text=String(r?.overlayPhrase||"");
  if(phase!=="result"){$("phrase").textContent=text;return}
  const byName=new Map((r?.participants||[]).map(p=>[String(p.name),p]));
  const out=escapeHtml(text).replace(/@([^\s,(]+) \(([+-])(\d+)\)/g,(m,name,sign)=>{
    const p=byName.get(name.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'"));
    if(!p||!p.outcome)return m;
    return `<span class="who ${p.outcome==="passed"?"win":"lose"}">${m}</span>`;
  });
  $("phrase").innerHTML=out;
}
function escapeHtml(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

/* ===== Kontrollfigur: Kontrolle (Schleife) und Ergebnis (läuft einmal, bleibt dann bis zum Ende der Ergebnisanzeige stehen) ===== */
/* Ergebnis: besteht mindestens eine Person → Daumen hoch; fallen alle durch → wütende Kontrollfigur. */
const verdict=$("verdict"),verdictSvg=$("verdictSvg"),verdictImg=$("verdictImg");
// 9.14.0: Figur kommt aus der Installation: "upload" = hochgeladenes Bild, "legacy" = bisherige Animation, "builtin" = eingebaute neutrale Standardfigur (Lehrer), sonst keine. Bis zur Antwort keine.
let figureMode="pending",figureUrl=null;
fetch("/api/branding",{cache:"no-store"}).then(r=>r.json()).then(b=>{const f=b&&b.images&&b.images.gameFigure;figureMode=f&&f.mode?f.mode:"none";figureUrl=f&&f.url||null}).catch(()=>{figureMode="none"});
const CLIPS={control:{file:"kontrolle",loop:true},passed:{file:"bestanden",loop:false},caught:{file:"durchgefallen",loop:false}};
let spiessKey=null,svgRaf=null;
function verdictKind(r){
  const ps=r?.participants||[];
  if(!ps.length)return null;
  return ps.some(p=>p.outcome==="passed")?"passed":"caught";
}
function placeVerdict(){
  const panelH=$("panel").offsetHeight||300;
  const panelBottom=parseFloat(getComputedStyle($("panel")).bottom)||60;
  const bottom=panelBottom+panelH-40;              // 40 px verschwinden hinter dem Panel
  const h=Math.max(240,Math.min(400,1080-bottom-20));
  const w=Math.round(h*0.75), pn=$("panel"), left=pn.offsetLeft+pn.offsetWidth-Math.round(w*0.45); // steht am rechten Ende des Panels
  for(const el of [verdict,verdictSvg,verdictImg]){el.style.bottom=bottom+"px";el.style.height=h+"px";el.style.width=w+"px";el.style.left=left+"px";el.style.right="auto"}
}
function stopSvg(){if(svgRaf)cancelAnimationFrame(svgRaf);svgRaf=null;verdictSvg.classList.remove("on","hold");verdictSvg.innerHTML=""}
function hideSpiess(){spiessKey=null;verdictImg.classList.remove("on","hold");verdict.classList.remove("on","hold");try{verdict.pause()}catch{}stopSvg()}
function playSvg(mode){
  stopSvg();if(!window.GameVerdict)return;
  const clip=CLIPS[mode],dur=window.GameVerdict.DURATION[mode],t0=performance.now();
  verdictSvg.classList.add("on");
  const style=figureMode==="builtin"?"teacher":"legacy";
  const frame=now=>{
    let t=(now-t0)/1000;
    if(t>=dur){if(clip.loop)t%=dur;else{verdictSvg.innerHTML=window.GameVerdict.frameSvg(mode,dur-0.01,style);verdictSvg.classList.add("hold");svgRaf=null;return}}
    verdictSvg.innerHTML=window.GameVerdict.frameSvg(mode,t,style);svgRaf=requestAnimationFrame(frame);
  };
  svgRaf=requestAnimationFrame(frame);
}
function showSpiess(mode,roundId){
  const key=(roundId||"")+":"+mode;
  if(figureMode==="pending"||figureMode==="none"){if(spiessKey)hideSpiess();return}
  if(key===spiessKey){placeVerdict();return}
  hideSpiess();spiessKey=key;placeVerdict();
  if(figureMode==="upload"&&figureUrl){verdictImg.src=figureUrl;verdictImg.classList.add("on","hold");return}
  if(figureMode==="builtin"||RENDER==="svg"){playSvg(mode);return}
  const clip=CLIPS[mode];
  verdict.loop=clip.loop;
  verdict.src=`/stubenkontrolle/spiess-${clip.file}.webm`;
  verdict.currentTime=0;
  verdict.classList.add("on");
  const p=verdict.play();if(p&&p.catch)p.catch(()=>{verdict.classList.remove("on");playSvg(mode)});
}
function syncVerdict(phase,r){
  if(phase==="control"){showSpiess("control",r?.id);return}
  if(phase!=="result"){hideSpiess();return}
  const kind=verdictKind(r);if(!kind)return;
  showSpiess(kind,r?.id);
}
// Am Ende bleibt das letzte Bild stehen (leichtes Atmen per CSS), bis das Ergebnis ausgeblendet wird.
verdict.addEventListener("ended",()=>{if(spiessKey)verdict.classList.add("hold")});
verdict.addEventListener("error",()=>{if(spiessKey){verdict.classList.remove("on");playSvg(spiessKey.split(":").pop())}});

/* ===== Männchen: pro angemeldeter Person eines, läuft am unteren Bildrand hin und her ===== */
const walkers=new Map(); // userId -> {el,x,v,dir}
let raf=null,lastT=0;
function hashStr(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}h^=h>>>15;h=Math.imul(h,2246822507);h^=h>>>13;h=Math.imul(h,3266489909);h^=h>>>16;return h>>>0}
function syncWalkers(list){
  const MAXW=60, shown=list.slice(0,MAXW), small=list.length>24;
  const ids=new Set(shown.map(p=>String(p.userId)));
  for(const w of walkers.values()){w.small=small;w.el.classList.toggle("small",small)}
  for(const p of shown){
    const id=String(p.userId);if(walkers.has(id))continue;
    const h=hashStr(id),el=document.createElement("div");
    el.className="walker";
    const tag=document.createElement("div");tag.className="tag";tag.textContent=p.name||p.login||"";
    const man=document.createElement("div");man.className="man";
    man.style.backgroundPositionY=`-${(h%6)*128}px`;
    man.style.animationDuration=(0.62+((h>>3)%30)/100).toFixed(2)+"s";
    el.append(man,tag);$("walkers").appendChild(el);
    const v=70+((h>>5)%80);
    walkers.set(id,{el,man,x:40+((h>>9)%1700),v,dir:((h>>2)&1)?1:-1,lane:(h>>11)&1,small});el.classList.toggle("small",small);
  }
  for(const [id,w] of walkers){if(!ids.has(id)&&!w.gone){w.gone=true;w.el.classList.add("leaving");setTimeout(()=>{w.el.remove();walkers.delete(id)},500)}}
  if(walkers.size&&!raf){lastT=performance.now();raf=requestAnimationFrame(step)}
}
function step(t){
  const dt=Math.min(0.1,(t-lastT)/1000);lastT=t;
  for(const w of walkers.values()){
    w.x+=w.dir*w.v*dt;
    if(w.x<20){w.x=20;w.dir=1}else if(w.x>1920-96-20){w.x=1920-96-20;w.dir=-1}
    const sc=w.small?0.58:0.8, y=w.small?(1080-128*sc-(w.lane?52:0)):1080-128*sc;
    w.el.style.transform=`translate(${w.x.toFixed(1)}px,${y}px) scale(${sc})`;
    w.man.style.transform=w.dir<0?"scaleX(-1)":"none";
  }
  raf=walkers.size?requestAnimationFrame(step):null;
}

tick=setInterval(updateCountdown,250);

/* ===== Demo ===== */
function demoState(phase,participants,extra={}){
  return {type:"stubenkontrolle.state",serverTime:Date.now(),phase,round:{id:"DEMO",status:phase,factor:1.8,joinEndsAt:new Date(Date.now()+60000).toISOString(),controlEndsAt:new Date(Date.now()+7000).toISOString(),participants,mode:null,overlayPhrase:extra.phrase||""},config:{minBet:50,maxBet:500,command:"!stube BETRAG"}};
}
if(DEMO){
  setStatus("DEMO",true);
  const N=Math.max(1,Math.min(300,Number(opt("n")||10)));
  const BASE=["Alpha","Bravo","Charlie","Delta","Echo","Foxtrott","Golf","Hotel","India","Julia"];
  const NAMES=Array.from({length:N},(_,i)=>BASE[i%10]+(i>=10?String(Math.floor(i/10)):""));
  const mk=(n,outcome)=>NAMES.slice(0,n).map((name,i)=>{const o=outcome?outcome(i):null,bet=100+i*50;return {userId:String(i+1),login:name.toLowerCase(),name,bet,outcome:o,payout:o==="passed"?Math.round(bet*1.8):0,delta:o==="passed"?Math.round(bet*0.8):o==="caught"?-bet:0}});
  const resultPhrase=ps=>{const f=l=>l.length?[...l].sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8).map(p=>`@${p.name} (${p.delta>=0?"+":"-"}${Math.abs(p.delta)})`).join(", ")+(l.length>8?` und ${l.length-8} weitere`:""):"niemand";
    return `🎖️ Runde beendet. Gewinner: ${f(ps.filter(p=>p.outcome==="passed"))}. Erwischte: ${f(ps.filter(p=>p.outcome==="caught"))}.`};
  if(DEMO==="registration"){let n=0;state=demoState("registration",[],{phrase:"🧹 Anmeldung läuft …"});render();
    const add=setInterval(()=>{n=Math.min(NAMES.length,n+Math.max(1,Math.ceil(NAMES.length/10)));state=demoState("registration",mk(n),{phrase:"🧽 Neue Stube angetreten."});render();if(n>=NAMES.length)clearInterval(add)},N>10?400:1500);}
  else if(DEMO==="control"){state=demoState("control",mk(4),{phrase:"Die Kontrolle läuft …"});render();}
  else if(DEMO==="passed"){const ps=mk(N>10?N:5,i=>i===1||i===3?"caught":"passed");state=demoState("result",ps,{phrase:resultPhrase(ps)});render();}
  else if(DEMO==="caught"){const ps=mk(N>10?N:5,()=>"caught");state=demoState("result",ps,{phrase:resultPhrase(ps)});render();}
}else connect();
addEventListener("hashchange",()=>location.reload());
