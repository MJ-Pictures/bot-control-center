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

/* ===== Lage und Größe des Panels (9.28.1) =====
   Einstellung im Control Center (state.config.layout); zum Ausprobieren überschreibbar per Adresse:
   &scale=40..100 &anchor=bottom-center &margin=0..300 &detail=full|compact (Fragment oder Query).
   9.28.2: &points=cards|chips &box=on|off &boxopacity=10..100 */
const ANCHORS=["top-left","top-center","top-right","middle-left","middle-center","middle-right","bottom-left","bottom-center","bottom-right"];
function clampNum(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,Math.round(n))):fallback}
function layoutSettings(){
  const c=state?.config?.layout||{};
  const a=opt("anchor"),d=opt("detail"),pt=opt("points"),bx=opt("box");
  return {
    scale:clampNum(opt("scale")??c.scale,40,100,80)/100,
    anchor:ANCHORS.includes(a)?a:(ANCHORS.includes(c.anchor)?c.anchor:"bottom-center"),
    margin:clampNum(opt("margin")??c.margin,0,300,60),
    detail:d==="full"||d==="compact"?d:(c.detail==="compact"?"compact":"full"),
    points:pt==="cards"||pt==="chips"?pt:(c.points==="chips"?"chips":"cards"),
    box:bx==="on"||bx==="off"?bx:(c.box==="off"?"off":"on"),
    boxOpacity:clampNum(opt("boxopacity")??c.boxOpacity,10,100,100)/100
  };
}
/* Platz für die Männchen: Sie laufen unten am Bildrand (Anmeldung). Bei Anker unten steht das Panel in JEDER Phase um diesen Streifen höher,
   damit es nie springt und die Männchen frei bleiben (ab 25 Personen zwei Bahnen, dann reicht der Streifen ebenfalls). */
const WALKER_SPACE=120;
/* Geometrie des Panels im 1920×1080-Raster (ohne Animation), damit die Kontrollfigur es treffen kann. */
function panelGeometry(){
  const L=layoutSettings(),pn=$("dock"),[v,h]=L.anchor.split("-");
  const lift=v==="bottom"?WALKER_SPACE:0;
  const sw=pn.offsetWidth*L.scale,sh=pn.offsetHeight*L.scale;
  const x0=h==="left"?L.margin:h==="right"?1920-L.margin-sw:(1920-sw)/2;
  const y0=v==="top"?L.margin:v==="bottom"?1080-L.margin-lift-sh:(1080-sh)/2;
  return {L,v,h,lift,x0,y0,sw,sh};
}
function layoutPanel(){
  const L=layoutSettings(),pn=$("dock"),[v,h]=L.anchor.split("-"),st=$("stage");
  const lift=v==="bottom"?WALKER_SPACE:0;
  pn.style.left=h==="left"?L.margin+"px":h==="center"?"50%":"auto";
  pn.style.right=h==="right"?L.margin+"px":"auto";
  pn.style.top=v==="top"?L.margin+"px":v==="middle"?"50%":"auto";
  pn.style.bottom=v==="bottom"?(L.margin+lift)+"px":"auto";
  pn.style.transformOrigin=`${h==="left"?"0%":h==="right"?"100%":"50%"} ${v==="top"?"0%":v==="bottom"?"100%":"50%"}`;
  pn.style.transform=`translate(${h==="center"?"-50%":"0"},${v==="middle"?"-50%":"0"}) scale(${L.scale})`;
  st.classList.toggle("compact",L.detail==="compact");
  st.classList.toggle("pts-chips",L.points==="chips");st.classList.toggle("pts-cards",L.points!=="chips");
  st.classList.toggle("box-off",L.box==="off");
  pn.style.setProperty("--ba",String(L.boxOpacity));
}

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
const MAX_CHIPS=12,MIN_CAUGHT_CHIPS=4;
/* 9.28.2: Auswahl und Reihenfolge der Chips. Ergebnis: Gewinner zuerst nach Betrag, dann Erwischte nach Einsatz; damit Erwischte nicht hinter vielen Gewinnern
   verschwinden, bekommen sie mindestens 4 der 12 Plätze (sofern es so viele gibt). Sonst nach Einsatz sortiert. Der Rest wird als „und N weitere“ gezählt. */
/*PICKCHIPS-START*/
function pickChips(phase,all,max,minCaught){
  if(phase!=="result"){const sorted=[...all].sort((a,b)=>(b.bet||0)-(a.bet||0));return {list:sorted.slice(0,max),rest:Math.max(0,sorted.length-max)}}
  const win=all.filter(p=>p.outcome==="passed").sort((a,b)=>Math.abs(b.delta||0)-Math.abs(a.delta||0));
  const lose=all.filter(p=>p.outcome!=="passed").sort((a,b)=>(b.bet||0)-(a.bet||0));
  const takeLose=Math.min(lose.length,Math.max(minCaught,max-win.length)),takeWin=Math.min(win.length,max-takeLose);
  const list=[...win.slice(0,takeWin),...lose.slice(0,takeLose)];
  return {list,rest:all.length-list.length};
}
/*PICKCHIPS-END*/
function renderChips(phase,all){
  const {list,rest}=pickChips(phase,all,MAX_CHIPS,MIN_CAUGHT_CHIPS);
  let html=list.map(p=>{
    if(phase==="result"){
      const amt=p.outcome==="passed"?`+${p.delta}`:`-${p.bet}`;
      return `<div class="chip ${escapeHtml(p.outcome||"")}"><span class="amt">${escapeHtml(amt)}</span> ${escapeHtml(p.name)}</div>`;
    }
    return `<div class="chip"><strong>${escapeHtml(p.name)}</strong> · ${escapeHtml(p.bet)}</div>`;
  }).join("");
  if(rest>0)html+=`<div class="chip more">und ${rest} weitere</div>`;
  $("chips").innerHTML=html;
}
function renderPeople(phase,all){
  if(layoutSettings().points==="chips"){renderChips(phase,all);$("people").innerHTML="";$("pageinfo").textContent="";return}
  $("chips").innerHTML="";
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
  layoutPanel();
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
fetch("/api/branding",{cache:"no-store"}).then(r=>r.json()).then(b=>{const f=b&&b.images&&b.images.gameFigure;figureMode=f&&f.mode?f.mode:"none";figureUrl=f&&f.url||null;if(state)render()}).catch(()=>{figureMode="none"});
const CLIPS={control:{file:"kontrolle",loop:true},passed:{file:"bestanden",loop:false},caught:{file:"durchgefallen",loop:false}};
let spiessKey=null,svgRaf=null;
function verdictKind(r){
  const ps=r?.participants||[];
  if(!ps.length)return null;
  return ps.some(p=>p.outcome==="passed")?"passed":"caught";
}
function placeVerdict(){
  // 9.28.1: Figur steht am Panel (kleiner als zuvor, wächst mit der Panelgröße). Oben auf dem Panel; bei Anker oben darunter.
  // Am rechten Rand des Bildes steht sie am linken Panelende, sonst am rechten. 40 px verschwinden hinter dem Panel.
  const g=panelGeometry(),over=40*g.L.scale,figH=Math.max(200,Math.min(400,Math.round(340*g.L.scale)));
  let h,top=null,bottom=null;
  if(g.v==="top"){top=g.y0+g.sh-over;h=Math.max(160,Math.min(figH,1080-top-20))}
  else{bottom=1080-g.y0-over;h=Math.max(160,Math.min(figH,1080-bottom-20))}
  const w=Math.round(h*0.75);
  let left=g.h==="right"?g.x0-Math.round(w*0.55):g.x0+g.sw-Math.round(w*0.45);
  left=Math.max(0,Math.min(1920-w,left));
  for(const el of [verdict,verdictSvg,verdictImg]){
    el.style.height=h+"px";el.style.width=w+"px";el.style.left=Math.round(left)+"px";el.style.right="auto";
    el.style.bottom=bottom===null?"auto":Math.round(bottom)+"px";el.style.top=top===null?"auto":Math.round(top)+"px";
  }
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
