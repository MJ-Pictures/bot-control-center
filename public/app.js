window.addEventListener("message",e=>{if(e.data?.type==="bwk-auth-linked") location.reload();});
let settings = null, dirty = false;

const $ = (id) => document.getElementById(id);

const roleLevel={viewer:1,editor:2,admin:3,owner:4};
let currentUser=null;
function isGlobalOwner(){return currentUser?.globalOwner===true||currentUser?.role==="owner";}
function isGlobalAdmin(){return isGlobalOwner()||currentUser?.globalAdmin===true||currentUser?.role==="admin"||currentUser?.localAdmin===true;}
function hasCapability(cap){return isGlobalAdmin()||Array.isArray(currentUser?.capabilities)&&currentUser.capabilities.includes(cap);}
function hasRole(role){return isGlobalAdmin()||(role==="viewer"&&Array.isArray(currentUser?.capabilities)&&currentUser.capabilities.some(x=>x.startsWith("twitch.")));}
function hasDiscordRole(role){return isGlobalAdmin()||(role==="viewer"&&Array.isArray(currentUser?.capabilities)&&currentUser.capabilities.some(x=>x.startsWith("discord.")));}


function applyPermissions(){
  if(!currentUser) return;
  refreshNavigationPermissions();

  // Seit der aktuellen Version werden Rechte pro Bereich über Capabilities gesteuert.
  // Ein globales "Editor"-Disable würde individuell freigegebene Bereiche
  // fälschlich wieder sperren. Die Navigation blendet nicht erlaubte Bereiche aus,
  // die API prüft die Capability zusätzlich serverseitig.
  const settingsCaps=[
    "twitch.commands.edit","twitch.timers.edit","twitch.autoreplies.edit","twitch.community.edit",
    "twitch.team.edit","twitch.clips.edit","twitch.moderation.edit","twitch.blocked.edit"
  ];
  const maySaveSettings=isGlobalAdmin()||settingsCaps.some(hasCapability);
  $("saveBtn")?.classList.toggle("hidden",!maySaveSettings);
  $("testMessageCard")?.classList.toggle("hidden",!hasCapability("twitch.commands.edit"));
}


// 9.15.0: Bot-Liste der Installation (kommt mit /api/me). Auswahllisten und Vorbelegungen richten sich danach.
let botList=[];
const botDefault=role=>{const b=botList.find(x=>(x.roles||[]).includes(role))||botList.find(x=>x.main)||botList[0];return b?b.key:"";};
const botNameFor=role=>{const key=botDefault(role);const b=botList.find(x=>x.key===key);return b?(b.displayName||b.key):"Haupt-Bot";};
const botOptionsHtml=()=>botList.map(b=>`<option value="${esc(b.key)}">${esc(b.displayName||b.key)}</option>`).join("");
const uid = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  // Fallback für lokalen HTTP-Zugriff auf die NAS.
  // crypto.randomUUID() ist in vielen Browsern nur in sicheren HTTPS-Kontexten verfügbar.
  const bytes = new Uint8Array(16);

  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
};

let dashboardSummaryData=null;

function renderDashboardSummary(){
  if(!settings && !dashboardSummaryData) return;

  // V8.0.13: Dashboard-Zahlen kommen bevorzugt aus einer eigenen, nur aggregierten
  // Server-Zusammenfassung. Dadurch hängen sie nicht von den Detail-Capabilities
  // des angemeldeten Benutzers ab und der zentrale PostgreSQL-Wortfilter wird gezählt.
  if(dashboardSummaryData){
    const d=dashboardSummaryData;
    const wf=d.wordFilter||{};
    const wordFilterMain=Number(wf.active||0);
    const wordFilterSub=[Number(wf.test||0)>0?`${Number(wf.test)} Test`:null,Number(wf.twitch||0)>0?`T ${Number(wf.twitch)}`:null,Number(wf.discord||0)>0?`D ${Number(wf.discord)}`:null].filter(Boolean).join(" · ");
    $("dashboardSummary").innerHTML = `
      <div class="summary-item"><strong>${Number(d.commands||0)}</strong><span>Commands</span></div>
      <div class="summary-item"><strong>${Number(d.autoReplies||0)}</strong><span>Auto-Replies</span></div>
      <div class="summary-item"><strong>${Number(d.timers||0)}</strong><span>Timer</span></div>
      <div class="summary-item"><strong>${wordFilterMain}</strong><span>Wortfilter${wordFilterSub?`<small>${esc(wordFilterSub)}</small>`:""}</span></div>
      <div class="summary-item"><strong>${Number(d.greetings||0)}</strong><span>Begrüßungen</span></div>
      <div class="summary-item"><strong>${d.follow?"AN":"AUS"}</strong><span>Follow</span></div>
      <div class="summary-item"><strong>${d.raid?"AN":"AUS"}</strong><span>Raid</span></div>
      <div class="summary-item"><strong>${d.clipSharing?"AN":"AUS"}</strong><span>Clip-Sharing</span></div>
      <div class="summary-item"><strong>${Number(d.communityCommands||0)}</strong><span>Community-Commands</span></div>
    `;
    return;
  }

  // Fallback nur für den Fall, dass die Zusammenfassungs-API vorübergehend nicht
  // erreichbar ist. Der Legacy-Wortfilter wird dabei bewusst nicht als V8-Wortfilter gezählt.
  settings.commands ||= [];
  settings.timers ||= [];
  settings.autoReplies ||= [];
  settings.greetings ||= [];
  settings.events ||= {};
  const activeCommands=settings.commands.filter(x=>x.enabled);
  const activeTimers=settings.timers.filter(x=>x.enabled);
  const activeReplies=settings.autoReplies.filter(x=>x.enabled);
  const greetings=settings.greetings.filter(x=>x.enabled);
  const followOn=!!settings.events?.follow?.enabled;
  const raidOn=!!settings.events?.raid?.enabled;
  const clipsOn=!!settings.clipSharing?.enabled;
  const communityCommandsOn=[settings.communityCommands?.followage?.enabled,settings.communityCommands?.watchtime?.enabled].filter(Boolean).length;
  $("dashboardSummary").innerHTML = `
    <div class="summary-item"><strong>${activeCommands.length}</strong><span>Commands</span></div>
    <div class="summary-item"><strong>${activeReplies.length}</strong><span>Auto-Replies</span></div>
    <div class="summary-item"><strong>${activeTimers.length}</strong><span>Timer</span></div>
    <div class="summary-item"><strong>–</strong><span>Wortfilter<small>Serverstatus nicht geladen</small></span></div>
    <div class="summary-item"><strong>${greetings.length}</strong><span>Begrüßungen</span></div>
    <div class="summary-item"><strong>${followOn?"AN":"AUS"}</strong><span>Follow</span></div>
    <div class="summary-item"><strong>${raidOn?"AN":"AUS"}</strong><span>Raid</span></div>
    <div class="summary-item"><strong>${clipsOn?"AN":"AUS"}</strong><span>Clip-Sharing</span></div>
    <div class="summary-item"><strong>${communityCommandsOn}</strong><span>Community-Commands</span></div>
  `;
}

async function loadDashboardSummary(){
  try{
    const r=await fetch("/api/dashboard-summary",{cache:"no-store"});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||`Dashboard HTTP ${r.status}`);
    dashboardSummaryData=j.summary||null;
  }catch(e){
    console.warn("Dashboard-Zusammenfassung konnte nicht geladen werden:",e);
    dashboardSummaryData=null;
  }
  renderDashboardSummary();
}


function editAutoReply(id){
  const tab=document.querySelector('#tabs button[data-tab="autoreplies"]');
  if(tab) tab.click();

  setTimeout(()=>{
    const row=document.querySelector(`#autoreplies [data-id="${CSS.escape(id)}"]`);
    if(row){
      row.scrollIntoView({behavior:"smooth",block:"center"});
      row.classList.add("flash");
      setTimeout(()=>row.classList.remove("flash"),1800);
      row.querySelector(".edit-auto")?.click();
      row.querySelector('[data-k="name"]')?.focus();
    }
  },50);
}

async function loadStatus(){
  const ids=["st-app-token","st-eventsub"];
  try{
    const r=await fetch("/api/status",{cache:"no-store"});
    const st=await r.json();
    if(!r.ok) throw new Error(st.error||`HTTP ${r.status}`);

    if($("testBot")&&!$("testBot").options.length)$("testBot").innerHTML=botOptionsHtml();
    const cards=$("botStatusCards");
    if(cards){
      cards.innerHTML=botList.map(b=>`<div class="status-card"><span>${esc(b.displayName||b.key)}</span><strong>${st.tokens?.[b.key]?"✅ Token vorhanden":"❌ Token fehlt"}</strong></div>`).join("");
    }
    $("st-app-token").textContent = st.appToken?.valid ? "✅ aktiv" : "⚠️ nicht aktiv";
    const es=st.eventsubStatus||{};
    if(st.eventsub){
      $("st-eventsub").textContent=`✅ verbunden · ${Number(es.ok||0)}/${Number(es.expected||4)} Abos`;
    }else if(es.state==="connecting"){
      $("st-eventsub").textContent="🔄 verbindet …";
    }else if(es.state==="reconnecting"){
      $("st-eventsub").textContent="🔄 Twitch-Reconnect …";
    }else if(es.state==="waiting"){
      $("st-eventsub").textContent=`⏳ neuer Versuch${es.reconnectAttempts?` #${es.reconnectAttempts}`:""}`;
    }else{
      $("st-eventsub").textContent="❌ getrennt";
    }
  }catch(e){
    ids.forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.textContent="⚠️ Statusfehler";
    });
    console.error("Dashboard-Status konnte nicht geladen werden:",e);
  }
}



async function loadAppVersion(){
  const el=$("appVersion");
  if(!el) return;

  try{
    const r=await fetch("/version.json",{cache:"no-store"});
    const j=await r.json();
    el.textContent=j.version || "unbekannt";
  }catch(e){
    el.textContent="unbekannt";
    console.error("Version konnte nicht geladen werden:",e);
  }
}

let themeMediaQuery=null;
function effectiveTheme(theme){
  if(theme==="system"){
    return window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
  }
  return theme==="dark"?"dark":"light";
}
function applyTheme(theme){
  const pref=["light","dark","system"].includes(theme)?theme:"system";
  document.documentElement.dataset.theme=effectiveTheme(pref);
  document.documentElement.dataset.themePreference=pref;
  document.querySelectorAll("[data-theme-choice]").forEach(btn=>{
    const active=btn.dataset.themeChoice===pref;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",active?"true":"false");
  });
}
function setThemePreference(theme){
  const pref=["light","dark","system"].includes(theme)?theme:"system";
  localStorage.setItem("bwk-theme",pref);
  applyTheme(pref);
}
function initTheme(){
  const saved=localStorage.getItem("bwk-theme");
  const pref=["light","dark","system"].includes(saved)?saved:"system";
  applyTheme(pref);
  themeMediaQuery=window.matchMedia?.("(prefers-color-scheme: dark)")||null;
  themeMediaQuery?.addEventListener?.("change",()=>{
    if((localStorage.getItem("bwk-theme")||"system")==="system")applyTheme("system");
  });
}

let commandAutoRefreshTimer=null;

function stopCommandAutoRefresh(){
  if(commandAutoRefreshTimer){
    clearInterval(commandAutoRefreshTimer);
    commandAutoRefreshTimer=null;
  }
}

async function refreshCommandsFromServer({force=false}={}){
  // Niemals lokale, noch nicht gespeicherte Änderungen überschreiben.
  if(dirty && !force) return false;

  try{
    const r=await fetch("/api/settings",{cache:"no-store"});
    const fresh=await r.json();
    if(!r.ok) throw new Error(fresh.error||`Settings HTTP ${r.status}`);

    const oldCommands=JSON.stringify(settings?.commands||[]);
    const newCommands=JSON.stringify(fresh?.commands||[]);

    // Auch andere Einstellungen im Hintergrund aktuell halten, solange lokal nichts offen ist.
    // Ist der Serverstand identisch, bleiben die vorhandenen Objekte bestehen: Die Zeilen-Handler
    // (zum Beispiel Löschen) zeigen auf genau diese Objekte und würden sonst ins Leere laufen.
    const unchanged=JSON.stringify(settings||{})===JSON.stringify(fresh||{});
    if(!dirty && !unchanged) settings=fresh;

    if(oldCommands===newCommands) return false;

    // UI-Zustand soweit möglich erhalten.
    const openId=document.querySelector("#commands .command-details:not(.hidden)")?.closest("[data-id]")?.dataset.id || null;
    const searchValue=$("commandSearch")?.value || "";
    const sortValue=$("commandSort")?.value || "az";

    renderCommands();

    if($("commandSearch")){
      $("commandSearch").value=searchValue;
      $("commandSearch").dispatchEvent(new Event("input"));
    }
    if($("commandSort")){
      $("commandSort").value=sortValue;
      $("commandSort").dispatchEvent(new Event("change"));
    }

    if(openId){
      const row=document.querySelector(`#commands [data-id="${CSS.escape(openId)}"]`);
      row?.querySelector(".command-details")?.classList.remove("hidden");
    }

    renderDashboardSummary();
    applyPermissions();
    return true;
  }catch(e){
    console.warn("Command-Auto-Aktualisierung fehlgeschlagen:",e);
    return false;
  }
}

function startCommandAutoRefresh(){
  stopCommandAutoRefresh();

  // Beim Öffnen sofort den aktuellen Serverstand laden.
  refreshCommandsFromServer();

  // Solange die Command-Seite offen ist, alle 5 Sekunden prüfen.
  commandAutoRefreshTimer=setInterval(()=>{
    const commandsPane=$("commands");
    if(!commandsPane || commandsPane.classList.contains("hidden")) return;
    if(dirty) return;
    refreshCommandsFromServer();
  },5000);
}

// 9.11.0: Name der Oberfläche und Spielbezeichnungen (Installationsprofil).
let branding={texts:{},footer:{},productName:"Bot Control Center",game:{name:"Punktespiel",pointsName:"Punkte",commands:{start:"!spiel",balance:"!punkte",top:"!top",help:"!spielhilfe"},fixedCommands:["!daily","!give","!gift"]}};
// 9.13.0: Fußzeile. Autor- und Quellcode-Hinweis sind fest (kommen vom Server, nicht überschreibbar); das Betreiber-Impressum ist optional.
function renderFooterLinks(){
  const root=$("footerLinks");if(!root)return;
  const f=branding?.footer||{};
  const link=(item,fallbackLabel)=>{
    if(!item||!/^https:\/\//.test(String(item.url||"")))return "";
    return `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.label||fallbackLabel)}</a>`;
  };
  const parts=[];
  if(f.author?.name)parts.push(`<span>Erstellt von ${/^https:\/\//.test(String(f.author.url||""))?`<a href="${esc(f.author.url)}" target="_blank" rel="noopener noreferrer"><strong>${esc(f.author.name)}</strong></a>`:`<strong>${esc(f.author.name)}</strong>`}</span>`);
  const src=link(f.source,"Quellcode & Lizenz");if(src)parts.push(src);
  const legal=link(f.operatorLegal,"Impressum");if(legal)parts.push(legal);
  root.innerHTML=parts.join('<span class="footer-separator">•</span>');
}
const NEUTRAL_ROLE_LABELS={member:"Member",moderator:"Moderator",administrator:"Administrator",memberPlural:"Mitglieder"};
const NEUTRAL_LEVEL={branches:false,rankPlural:"Ränge",rankNameWord:"Rangbezeichnungen",rank:"Rang",noRank:"Ohne Rang",missionSingular:"Mission",missionPlural:"Missionen",missionTitle:"Missionen & Übungen",dailyNoun:"Meldung",dailyPlural:"Meldungen",missionRecord:"Missionsakte",branchLabel:"Zweig",promotionsPlural:"Aufstiege",missionCmd:"mission",dailyTitle:"Tägliche Meldung"};
function lv(key){const v=branding?.texts?.level?.[key];return v===undefined?(NEUTRAL_LEVEL[key]??key):v;}
function rl(key){return branding?.texts?.roleLabels?.[key]||NEUTRAL_ROLE_LABELS[key]||key;}
function bt(key,fallback=""){const v=branding?.texts?.[key];return v===undefined||v===null?fallback:v;}
function gameName(){return branding?.game?.name||"Punktespiel";}
function pointsName(){return branding?.game?.pointsName||"Punkte";}
function gameCommands(){return branding?.game?.commands||{start:"!spiel",balance:"!punkte",top:"!top",help:"!spielhilfe"};}
function applyBranding(b){
  if(!b||typeof b!=="object")return;
  branding={...branding,...b,game:{...branding.game,...(b.game||{})}};
  document.title=branding.productName||document.title;
  const hp=branding.header||{strong:branding.productName,rest:""};
  if($("brandStrong"))$("brandStrong").textContent=hp.strong||"";
  if($("brandRest"))$("brandRest").textContent=hp.rest||"";
  if($("brandFooter"))$("brandFooter").textContent=branding.productName||"";
  renderFooterLinks();
  const logo=$("brandLogo");if(logo){const u=branding?.images?.logo?.url;if(u){logo.src=u;logo.hidden=false;}else{logo.removeAttribute("src");logo.hidden=true;}}
  const navItem=(NAV_GROUPS.live?.items||[]).find(x=>x.tab==="stubenkontrolle");
  if(navItem)navItem.label=gameName();
  for(const it of NAV_GROUPS.discordMinigame?.items||[]){
    if(it.tab==="discordLevelRanks")it.label=lv("rankPlural");
    if(it.tab==="discordLevelMissions")it.label=`${lv("dailyPlural")} & ${lv("missionPlural")}`;
  }
}
async function loadBranding(){
  try{const r=await fetch("/api/branding",{cache:"no-store"});if(r.ok)applyBranding(await r.json());}catch{}
}

async function init(){
  try{
    await loadBranding();
    const me = await fetch("/api/me",{cache:"no-store"}).then(r=>r.json());
    if(!me.user){
      // 9.11.0: Solange die Ersteinrichtung offen ist, erscheint statt der Anmeldung der Einrichtungsassistent.
      if(branding.setupPending&&await renderSetupWizard())return;
      $("login").classList.remove("hidden");
      try{
        const local = await fetch("/api/local-login-available",{cache:"no-store"}).then(r=>r.json());
        if(local.enabled) $("localLoginBox").classList.remove("hidden");
      }catch{}
      return;
    }

    currentUser=me.user;
    botList=Array.isArray(me.bots)?me.bots:[];
    $("app").classList.remove("hidden");
    const provider=me.user.authProvider==="discord"?"Discord":"Twitch";
    const linked=me.user.linkedAccounts||{};
    const twitchLabel=linked.twitch?.displayName||linked.twitch?.login||null;
    const discordLabel=linked.discord?.displayName||linked.discord?.username||null;
    $("user").innerHTML=`
      <div class="account-menu" id="accountMenu">
        <button type="button" class="account-menu-trigger" id="accountMenuTrigger" aria-expanded="false">
          <span class="account-menu-name">${esc(me.user.name||me.user.login||me.user.discordUsername||"User")}</span>
          <span class="role-badge">${provider}</span>
          ${linked.discord?'<span class="linked-ok">Discord ✓</span>':""}
          <span class="account-menu-chevron">⌄</span>
        </button>
        <div class="account-menu-panel hidden" id="accountMenuPanel">
          <div class="account-menu-title">Verknüpfte Konten</div>
          <div class="account-identity"><span>🟣 Twitch</span><strong>${twitchLabel?esc(twitchLabel):"nicht verknüpft"}</strong></div>
          <div class="account-identity"><span>🔵 Discord</span><strong>${discordLabel?esc(discordLabel):"nicht verknüpft"}</strong></div>
          <div class="account-menu-section">
            <div class="account-menu-title compact">Darstellung</div>
            <div class="appearance-choice" role="group" aria-label="Darstellung">
              <button type="button" data-theme-choice="light" aria-pressed="false"><span>☀</span> Hell</button>
              <button type="button" data-theme-choice="dark" aria-pressed="false"><span>☾</span> Dunkel</button>
              <button type="button" data-theme-choice="system" aria-pressed="false"><span>◐</span> System</button>
            </div>
          </div>
          <div class="account-menu-actions">
            ${linked.discord
              ? '<button type="button" class="account-menu-action danger-text" id="unlinkDiscordSelf">Discord-Verknüpfung aufheben</button>'
              : (me.user.authProvider!=="discord"?'<a class="account-menu-action" href="/auth/discord/link">Discord verknüpfen</a>':"")}
            <button type="button" class="account-menu-action" id="logoutBtn">Abmelden</button>
            <button type="button" class="account-menu-action danger-text" id="logoutAllBtn">Alle Sitzungen abmelden</button>
          </div>
        </div>
      </div>`;
    initAccountMenu();

    if(me.user.localAdmin){
      $("localResetCard")?.classList.remove("hidden");
    }else{
      $("localResetCard")?.classList.add("hidden");
    }

    if((currentUser.capabilities||[]).some(x=>x.startsWith("twitch.")) || isGlobalAdmin()){
      const sr=await fetch("/api/settings",{cache:"no-store"});
      settings=await sr.json();
      if(!sr.ok) throw new Error(settings.error||`Settings HTTP ${sr.status}`);
      renderAll();
      await loadDashboardSummary();
      await loadStatus();
    }

    applyPermissions();
    initNavigation();
  }catch(e){
    console.error("Initialisierung fehlgeschlagen:",e);
    const box=$("dashboardSummary");
    if(box) box.innerHTML=`<div class="error">Dashboard konnte nicht vollständig geladen werden: ${esc(e.message)}</div>`;
    await loadStatus();
  }
}


function initAccountMenu(){
  const trigger=$("accountMenuTrigger"),panel=$("accountMenuPanel");
  if(!trigger||!panel)return;
  trigger.addEventListener("click",e=>{
    e.stopPropagation();
    panel.classList.toggle("hidden");
    trigger.setAttribute("aria-expanded",panel.classList.contains("hidden")?"false":"true");
  });
  document.addEventListener("click",e=>{
    if(!$("accountMenu")?.contains(e.target)){
      panel.classList.add("hidden");
      trigger.setAttribute("aria-expanded","false");
    }
  },{once:false});
  document.querySelectorAll("[data-theme-choice]").forEach(btn=>btn.addEventListener("click",()=>{
    setThemePreference(btn.dataset.themeChoice);
  }));
  $("logoutBtn")?.addEventListener("click",async()=>{
    try{
      const r=await fetch("/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
    }catch(e){console.warn("Logout:",e.message);}
    location.replace("/");
  });
  $("logoutAllBtn")?.addEventListener("click",async()=>{
    const ok=await askConfirm({title:"Alle Sitzungen abmelden",text:"Alle aktuell gültigen Sitzungen dieses Kontos beenden?",confirmLabel:"ALLE ABMELDEN",cancelLabel:"ABBRECHEN",danger:true});
    if(!ok)return;
    try{
      const r=await fetch("/auth/logout-all",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
    }catch(e){console.warn("Logout-All:",e.message);}
    location.replace("/");
  });
  applyTheme(localStorage.getItem("bwk-theme")||"system");
  $("unlinkDiscordSelf")?.addEventListener("click",async()=>{
    if(!(await askAs("unlink","Discord-Verknüpfung wirklich aufheben? Discord-Rollen auf dem Server werden dadurch nicht verändert.")))return;
    const r=await fetch("/api/account/discord/unlink",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return showToast(d.error||"Discord-Verknüpfung konnte nicht aufgehoben werden.","error");
    showToast("Discord-Verknüpfung aufgehoben.","success");
    if(d.loggedOut)location.replace("/");
    else location.reload();
  });
}

const NAV_GROUPS={
  dashboard:{label:"Übersicht",icon:"⌂",items:[{tab:"dashboard",label:"Dashboard",capability:"twitch.dashboard.view"}]},
  automation:{label:"Automatisierung",icon:"⚙",items:[{tab:"commands",label:"Commands",capability:"twitch.commands.view"},{tab:"timers",label:"Timer-Nachrichten",capability:"twitch.timers.view"},{tab:"autoreplies",label:"Auto-Replies",capability:"twitch.autoreplies.view"}]},
  community:{label:"Community",icon:"♟",items:[{tab:"events",label:"Community",capability:"twitch.community.view"},{tab:"watchtime",label:"Watchtime",capability:"twitch.watchtime.view"},{tab:"followage",label:"Followage",capability:"twitch.followage.view"},{tab:"chatters",label:"Top-Chatters",capability:"twitch.followage.view"},{tab:"team",label:"Team",capability:"twitch.team.view"},{tab:"lurk",label:"Lurk-Rückkehr",capability:"twitch.community.view",module:"lurkReturn"}]},
  live:{label:"Live-Zentrale",icon:"●",items:[{tab:"eventprofiles",label:"Event-Profile",capability:"twitch.eventprofiles.view",module:"eventProfiles"},{tab:"stubenkontrolle",label:"Stubenkontrolle",capability:"twitch.stubenkontrolle.view",module:"stubenkontrolle"},{tab:"followathon",label:"Followathon",capability:"twitch.followathon.view",module:"followathon"},{tab:"subathon",label:"Subathon",capability:"twitch.subathon.view",module:"subathon"},{tab:"followerAlert",label:"Follower-Alert",capability:"twitch.followathon.view",module:"followerAlert"},{tab:"chatOverlay",label:"Chat-Overlay",capability:"twitch.followathon.view",module:"chatOverlay"},{tab:"clips",label:"Clips",capability:"twitch.clips.view",module:"clips"},{tab:"giveaway",label:"Gewinnspiel",capability:"twitch.giveaway.view",module:"giveaway"}]},
  moderation:{label:"Moderation",icon:"◆",items:[{tab:"moderation",label:"Chat-Filter",capability:"twitch.moderation.view",module:"twitchChatFilter"},{tab:"wordFilter",label:"Wortfilter",anyCapabilities:["twitch.moderation.view","twitch.blocked.view","discord.moderation.view"],module:"wordFilter"},{tab:"blocked",label:"Legacy-Wortliste",capability:"twitch.blocked.view",module:"wordFilter"}]},
  giveaway:{label:"Gewinnspiel",icon:"★",items:[{tab:"giveaway",label:"Gewinnspiel",capability:"twitch.giveaway.view",module:"giveaway"}]},
  analytics:{label:"Auswertung",icon:"▥",items:[{tab:"statistics",label:"Statistiken",capability:"twitch.statistics.view"},{tab:"activity",label:"Activity Board",capability:"twitch.activity.view"}]},

  discordDashboard:{label:"Übersicht",icon:"⌂",items:[{tab:"discordOverview",label:"Dashboard",capability:"discord.dashboard.view"}]},
  discordServer:{label:"Server",icon:"▦",items:[{tab:"discordChannels",label:"Kanäle",capability:"discord.channels.view"},{tab:"discordRoles",label:"Rollen",capability:"discord.roles.view"},{tab:"discordChannelTimes",label:"Kanalzeiten",capability:"discord.channel-times.view",module:"discordChannelTimes"},{tab:"discordWelcome",label:"Freischaltung",capability:"discord.onboarding.view"},{tab:"discordInvite",label:"Einladungslink",capability:"discord.channels.view",module:"discordInvite"}]},
  discordMembersGroup:{label:"Mitglieder",icon:"♟",items:[{tab:"discordMembers",label:"Mitglieder",capability:"discord.members.view"}]},
  discordCommunication:{label:"Kommunikation",icon:"✉",items:[{tab:"discordAnnouncements",label:"Ankündigungen",capability:"discord.announcements.view",module:"discordAnnouncements"}]},
  discordMinigame:{label:"Minigame",icon:"★",items:[{tab:"discordLevelsystem",label:"Konfiguration",capability:"discord.moderation.view",module:"levelsystem"},{tab:"discordLevelXpRules",label:"XP-Regeln",capability:"discord.moderation.view",module:"levelsystem"},{tab:"discordLevelPlayers",label:"Spieler",capability:"discord.moderation.view",requiresMinigame:true,module:"levelsystem"},{tab:"discordLevelRanks",label:"Ränge",capability:"discord.moderation.view",module:"levelsystem"},{tab:"discordLevelMissions",label:"Meldungen & Missionen",capability:"discord.moderation.view",module:"levelsystem"},{tab:"discordLevelStatistics",label:"Statistiken",capability:"discord.moderation.view",module:"levelsystem"}]},
  discordSecurity:{label:"Moderation & Sicherheit",icon:"◆",items:[{tab:"discordModeration",label:"Moderation",capability:"discord.moderation.view",module:"discordModeration"},{tab:"wordFilter",label:"Wortfilter",anyCapabilities:["discord.moderation.view","twitch.moderation.view","twitch.blocked.view"],module:"wordFilter"},{tab:"discordModerationLog",label:"Protokoll & Test",capability:"discord.moderation.view"},{tab:"discordSanctions",label:"Sanktionsübersicht",capability:"discord.moderation.view"},{tab:"discordUserHistory",label:"Userhistorie",capability:"discord.moderation.view"},{tab:"discordAccess",label:"Zugriffsrechte",capability:"discord.access.view"},{tab:"discordReports",label:"Meldungen",capability:"discord.reports.view",module:"discordReports"}]},
  discordReports:{label:"Meldungen",icon:"⚑",items:[{tab:"discordReports",label:"Meldungen",capability:"discord.reports.view",module:"discordReports"}]},
  discordEmergency:{label:"Notfallmodus",icon:"!",items:[{tab:"discordEmergency",label:"Notfallmodus",adminOnly:true}]},
  discordAnalytics:{label:"Auswertung",icon:"▥",items:[{tab:"statistics",label:"Statistiken",capability:"discord.statistics.view"},{tab:"activity",label:"Activity Board",capability:"discord.activity.view"}]},

  socialMedia:{label:"Social Media",icon:"◎",items:[
    {tab:"socialOverview",label:"Übersicht",ownerOnly:true,module:"socialMedia"},
    {tab:"socialInstagram",label:"Instagram",ownerOnly:true,module:"socialMedia"},
    {tab:"socialTikTok",label:"TikTok",ownerOnly:true,module:"socialMedia"},
    {tab:"socialPublications",label:"Veröffentlichungen",ownerOnly:true,module:"socialMedia"},
    {tab:"socialSettings",label:"Einstellungen",ownerOnly:true,module:"socialMedia"}
  ]},

  admin:{label:"Administration",icon:"⌘",items:[{tab:"users",label:"Benutzer & Zugriffe",adminOnly:true,adminSection:"Benutzer & Sicherheit"},{tab:"loginlogs",label:"Login-Protokoll",adminOnly:true,adminSection:"Benutzer & Sicherheit"},{tab:"discordLogsAdmin",label:"Logs & Benachrichtigungen",adminOnly:true,platform:"discord",adminSection:"Integrationen"},{tab:"connections",label:"Twitch-Verbindungen",adminOnly:true,adminSection:"Integrationen"},{tab:"modules",label:"Module",adminOnly:true,adminSection:"Integrationen"},{tab:"addressLogin",label:"Adresse",adminOnly:true,adminSection:"Integrationen"},{tab:"profileBranding",label:"Profil & Branding",adminOnly:true,adminSection:"Integrationen"},{tab:"publicWebsites",label:"Öffentliche Webseiten",ownerOnly:true,adminSection:"Integrationen"},{tab:"system",label:"Systemstatus",adminOnly:true,adminSection:"System"},{tab:"database",label:"Datenbank",ownerOnly:true,adminSection:"System"},{tab:"backup",label:"Backup / Restore",ownerOnly:true,adminSection:"System"},{tab:"updates",label:"Updates",ownerOnly:true,adminSection:"System"}]},
  help:{label:"Hilfe",icon:"?",items:[{tab:"help",label:"Hilfe",any:true}]}
};
const PLATFORM_NAV={
  twitch:["dashboard","live","automation","community","moderation","analytics","socialMedia","admin","help"],
  discord:["discordDashboard","discordMembersGroup","discordServer","discordCommunication","discordMinigame","discordSecurity","discordAnalytics","discordEmergency","socialMedia","admin","help"]
};

let currentPlatform="twitch";
let activeNavGroup="dashboard";
let activeNavTab="dashboard";
let minigameReady=false;
let navFavorites=[];
function favoriteTarget(tab){
  for(const platform of ["twitch","discord"]){
    for(const group of PLATFORM_NAV[platform]||[]){
      const item=(NAV_GROUPS[group]?.items||[]).find(x=>x.tab===tab);
      if(item)return {platform,group,item};
    }
  }
  return null;
}
function availableFavorites(){return navFavorites.filter(tab=>{const x=favoriteTarget(tab);return x&&(!x.item.platform||x.item.platform===x.platform)&&(!x.item.requiresMinigame||minigameReady)&&navFavoriteAllowed(x.item,x.platform);});}
// 9.1.2: Modul eines Reiters (aus NAV_GROUPS). Ausgeschaltete Module sind auch über Suche, Favoriten und Direktaufruf nicht erreichbar.
function tabModuleOf(tab){for(const g of Object.values(NAV_GROUPS))for(const it of g.items||[])if(it.tab===tab&&it.module)return it.module;return null;}
// 9.19.0: Rechteverwaltung blendet Bereiche aus, deren Module (alle Menüpunkte mit diesem Recht) ausgeschaltet sind.
// Die Zeilen bleiben im Dokument (hidden), damit gespeicherte Rechte beim Speichern erhalten bleiben.
function capabilityModuleOff(cap){
  if(!cap||!settings?.modules||typeof settings.modules!=="object")return false;
  const items=[];for(const g of Object.values(NAV_GROUPS))for(const it of g.items||[])if(it.capability===cap)items.push(it);
  return items.length>0&&items.every(it=>it.module&&!moduleEnabledUi(it.module));
}
function permissionRowHidden(row){return !!row?.view&&capabilityModuleOff(row.view);}
function tabModuleOff(tab){const m=tabModuleOf(tab);return !!m&&!moduleEnabledUi(m);}
function navFavoriteAllowed(item,platform){
  if(item?.module&&!moduleEnabledUi(item.module))return false;
  if(item?.any)return !!currentUser;
  if(item?.ownerOnly)return isGlobalOwner();
  if(item?.adminOnly)return isGlobalAdmin();
  if(item?.anyCapabilities)return item.anyCapabilities.some(hasCapability);
  return !!item?.capability&&hasCapability(item.capability);
}
async function loadNavFavorites(){
  try{const r=await fetch("/api/user-favorites",{cache:"no-store"});if(!r.ok)throw Error("Favoriten konnten nicht geladen werden");const x=await r.json();navFavorites=Array.isArray(x.items)?x.items:[];}
  catch(e){console.warn(e);navFavorites=[];}
  renderFavoriteLinks();renderFavoriteStar();
}
async function saveNavFavorites(next){
  const r=await fetch("/api/user-favorites",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:next})});
  const x=await r.json();if(!r.ok)throw Error(x.error||"Favoriten konnten nicht gespeichert werden");
  navFavorites=x.items||[];renderFavoriteLinks();renderFavoriteStar();
}
function renderFavoriteStar(){
  const b=$("favoriteToggle");if(!b)return;
  const target=favoriteTarget(activeNavTab);b.hidden=!target||!navFavoriteAllowed(target.item,target.platform);
  b.textContent=navFavorites.includes(activeNavTab)?"★":"☆";
  b.setAttribute("aria-label",navFavorites.includes(activeNavTab)?"Favorit entfernen":"Als Favorit markieren");
  b.title=b.getAttribute("aria-label");
}
function renderFavoriteLinks(){
  const root=$("favoriteLinks");if(!root)return;
  const items=availableFavorites();root.hidden=!items.length;
  root.innerHTML=items.map((tab,i)=>{const x=favoriteTarget(tab);return `<div class="favorite-row"><button type="button" class="favorite-link" data-favorite-open="${esc(tab)}">${x.platform==="discord"?"D":"T"} · ${esc(x.item.label)}</button><button type="button" data-favorite-move="${esc(tab)}" title="Nach oben" aria-label="Favorit nach oben" ${i===0?"disabled":""}>↑</button></div>`;}).join("");
  root.querySelectorAll('[data-favorite-open]').forEach(btn=>btn.onclick=()=>openFavoriteTab(btn.dataset.favoriteOpen));
  root.querySelectorAll('[data-favorite-move]').forEach(btn=>btn.onclick=async()=>{const t=btn.dataset.favoriteMove;const pos=navFavorites.indexOf(t);if(pos<1)return;const next=[...navFavorites];[next[pos-1],next[pos]]=[next[pos],next[pos-1]];try{await saveNavFavorites(next);}catch(e){showToast(e.message,"error");}});
}
async function openFavoriteTab(tab){
  const x=favoriteTarget(tab);if(!x||!navFavoriteAllowed(x.item,x.platform)||!platformAvailable(x.platform)||!availableFavorites().includes(tab))return;
  if(currentPlatform!==x.platform){currentPlatform=x.platform;localStorage.setItem("bwk-platform",currentPlatform);}
  await openNavTab(tab,{persist:true});
}


function navRoleAllowed(item){
  if(item?.module&&!moduleEnabledUi(item.module))return false; // 9.1.1: ausgeschaltete Module sind nirgends sichtbar
  if(item?.requiresMinigame&&!minigameReady)return false;
  if(item?.platform&&item.platform!==currentPlatform)return false;
  if(item?.any)return!!currentUser;
  if(item?.ownerOnly)return isGlobalOwner();
  if(item?.adminOnly)return isGlobalAdmin();
  if(Array.isArray(item?.anyCapabilities))return item.anyCapabilities.some(cap=>hasCapability(cap));
  if(item?.capability)return hasCapability(item.capability);
  return false;
}
function availableNavItems(groupKey){return(NAV_GROUPS[groupKey]?.items||[]).filter(item=>navRoleAllowed(item));}
function platformAvailable(platform){
  if(!["twitch","discord"].includes(platform))return false;
  if(isGlobalAdmin())return true;
  const prefix=platform==="discord"?"discord.":"twitch.";
  return(currentUser?.capabilities||[]).some(x=>String(x).startsWith(prefix));
}
function groupsForPlatform(platform=currentPlatform){return(PLATFORM_NAV[platform]||[]).filter(k=>availableNavItems(k).length>0);}
function groupForTab(tab,platform=currentPlatform){
  return groupsForPlatform(platform).find(k=>(NAV_GROUPS[k]?.items||[]).some(item=>item.tab===tab))||groupsForPlatform(platform)[0]||"help";
}
function isMobileNavigation(){return window.matchMedia("(max-width: 760px)").matches;}
function openMobileSidebar(){document.body.classList.add("sidebar-mobile-open");$("mobileMenuBtn")?.setAttribute("aria-expanded","true");}
function closeMobileSidebar(){document.body.classList.remove("sidebar-mobile-open");$("mobileMenuBtn")?.setAttribute("aria-expanded","false");}
function updateSidebarCollapseControl(){
  const collapsed=$("sidebar")?.classList.contains("collapsed"),icon=document.querySelector(".sidebar-collapse-icon"),label=document.querySelector(".sidebar-collapse-label");
  if(icon)icon.textContent=collapsed?"›":"‹";if(label)label.textContent=collapsed?"Navigation ausklappen":"Navigation einklappen";
  $("sidebarCollapseBtn")?.setAttribute("aria-label",collapsed?"Navigation ausklappen":"Navigation einklappen");
}
function applySidebarPreference(){
  const sidebar=$("sidebar");if(!sidebar)return;
  if(isMobileNavigation()){sidebar.classList.remove("collapsed");return;}
  const saved=localStorage.getItem("bwk-sidebar-collapsed"),collapse=saved===null?window.matchMedia("(max-width: 1050px)").matches:saved==="1";
  sidebar.classList.toggle("collapsed",collapse);updateSidebarCollapseControl();
}
function toggleSidebarCollapsed(){
  if(isMobileNavigation()){closeMobileSidebar();return;}
  const sidebar=$("sidebar");if(!sidebar)return;
  const collapsed=sidebar.classList.toggle("collapsed");localStorage.setItem("bwk-sidebar-collapsed",collapsed?"1":"0");updateSidebarCollapseControl();
}
function renderPlatformSwitch(){
  document.querySelectorAll("#platformSwitch [data-platform]").forEach(btn=>{
    const p=btn.dataset.platform,allowed=platformAvailable(p);
    btn.classList.toggle("active",p===currentPlatform);btn.classList.toggle("unavailable",!allowed);btn.disabled=!allowed;
    btn.setAttribute("aria-selected",p===currentPlatform?"true":"false");
  });
}
function renderMainNav(){
  const nav=$("mainNav");if(!nav)return;
  nav.innerHTML=groupsForPlatform().map(groupKey=>{
    const g=NAV_GROUPS[groupKey];
    return `<button class="sidebar-link ${groupKey===activeNavGroup?"active":""}" data-group="${esc(groupKey)}" data-tooltip="${esc(g.label)}" type="button"><span class="sidebar-icon">${esc(g.icon||"•")}</span><span class="sidebar-label">${esc(g.label)}</span></button>`;
  }).join("");
  nav.querySelectorAll("[data-group]").forEach(btn=>btn.addEventListener("click",()=>openNavGroup(btn.dataset.group)));
}
function refreshNavigationPermissions(){
  if(!platformAvailable(currentPlatform))currentPlatform=platformAvailable("twitch")?"twitch":"discord";
  const groups=groupsForPlatform();
  if(!groups.includes(activeNavGroup)||!availableNavItems(activeNavGroup).length){
    activeNavGroup=groups[0]||"help";activeNavTab=availableNavItems(activeNavGroup)[0]?.tab||"help";
  }
  renderPlatformSwitch();renderMainNav();renderSubTabs();updateNavigationActiveState();renderFavoriteLinks();renderFavoriteStar();
}
function renderSubTabs(){
  const group=NAV_GROUPS[activeNavGroup]||NAV_GROUPS.help,items=availableNavItems(activeNavGroup),sub=$("subTabs"),header=$("sectionNavHeader");
  if($("sectionGroupTitle"))$("sectionGroupTitle").textContent=group.label;
  if($("mobileNavTitle"))$("mobileNavTitle").textContent=`${currentPlatform==="discord"?"Discord":"Twitch"} · ${group.label}`;
  const activeItem=items.find(x=>x.tab===activeNavTab)||items[0];
  if($("mobileNavSubtitle"))$("mobileNavSubtitle").textContent=items.length>1&&activeItem?activeItem.label:"";
  if(!sub||!header)return;
  if(items.length<=1){sub.innerHTML="";sub.classList.remove("admin-section-tabs");header.classList.add("single-section");return;}
  header.classList.remove("single-section");
  header.classList.toggle("admin-header",activeNavGroup==="admin");
  const tabButton=item=>`<button type="button" class="sub-tab ${item.tab===activeNavTab?"active":""}" data-tab="${esc(item.tab)}">${esc(item.label)}</button>`;
  if(activeNavGroup==="admin"){
    const sections=["Benutzer & Sicherheit","Integrationen","System"];
    sub.classList.add("admin-section-tabs");
    sub.innerHTML=sections.map(section=>{
      const matches=items.filter(item=>item.adminSection===section);
      return matches.length?`<div class="admin-tab-section"><span class="admin-tab-section-label">${esc(section)}</span><div class="admin-tab-section-links">${matches.map(tabButton).join("")}</div></div>`:"";
    }).join("");
  }else{
    sub.classList.remove("admin-section-tabs");
    sub.innerHTML=items.map(tabButton).join("");
  }
  sub.querySelectorAll("[data-tab]").forEach(btn=>btn.addEventListener("click",()=>openNavTab(btn.dataset.tab,{persist:true})));
}
function updateNavigationActiveState(){
  document.querySelectorAll("#mainNav [data-group]").forEach(btn=>btn.classList.toggle("active",btn.dataset.group===activeNavGroup));
  document.querySelectorAll("#subTabs [data-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.tab===activeNavTab));
  renderPlatformSwitch();
}
async function openNavTab(tab,{persist=true}={}){
  if(tabModuleOff(tab)){const first=(PLATFORM_NAV[currentPlatform]||[]).map(g=>availableNavItems(g)[0]).find(Boolean);tab=first?.tab||"help";} // 9.1.2: Modul aus → nicht öffnen
  stopCommandAutoRefresh();stopFollowathonRefresh();document.querySelectorAll(".pane").forEach(p=>p.classList.add("hidden"));
  activeNavGroup=groupForTab(tab,currentPlatform);activeNavTab=tab;document.getElementById(tab)?.classList.remove("hidden");
  renderMainNav();renderSubTabs();updateNavigationActiveState();renderFavoriteLinks();renderFavoriteStar();

  if(tab==="commands")startCommandAutoRefresh();
  if(tab==="activity")renderActivity();
  if(tab==="watchtime")renderWatchtime();
  if(tab==="followage")renderFollowageList();
  if(tab==="chatters")renderChatLeaderboard();
  if(tab==="team")renderTeam();
  if(tab==="lurk")renderLurk();
  if(tab==="statistics")renderStatistics();
  if(tab==="eventprofiles")renderEventProfiles();
  if(tab==="stubenkontrolle")renderStubenkontrolle();
  if(tab==="followathon")renderFollowathon();
  if(tab==="subathon")renderSubathon();
  if(tab==="followerAlert")renderFollowerAlert();
  if(tab==="chatOverlay")renderChatOverlay();
  if(tab==="users")renderUsers();
  if(tab==="loginlogs")renderLoginLogs();
  if(tab==="connections")renderConnections();
  if(tab==="modules")renderModules();
  if(tab==="profileBranding")renderProfileBranding();
  if(tab==="addressLogin")renderAddressLogin();
  if(tab==="discordOverview")renderDiscordOverview();
  if(tab==="discordChannels")renderDiscordChannels();
  if(tab==="discordChannelTimes")renderDiscordChannelTimes();
  if(tab==="discordRoles")renderDiscordRoles();
  if(tab==="discordMembers")renderDiscordMembers();
  if(tab==="discordAnnouncements")renderDiscordAnnouncements();
  if(tab==="discordModeration")renderDiscordModeration();
  if(["discordLevelsystem","discordLevelXpRules","discordLevelPlayers","discordLevelRanks","discordLevelMissions","discordLevelStatistics"].includes(tab))renderDiscordLevelsystem(tab);
  if(tab==="wordFilter")renderWordFilter();
  if(tab==="discordModerationLog")renderDiscordModerationLog();
  if(tab==="discordSanctions")renderDiscordSanctions();
  if(tab==="discordUserHistory")renderDiscordUserHistory();
  if(tab==="discordReports")renderDiscordReports();
  if(tab==="discordEmergency")renderDiscordEmergency();
  if(tab==="socialOverview")renderSocialOverview();
  if(tab==="socialInstagram")renderSocialPlatform("instagram");
  if(tab==="socialTikTok")renderSocialPlatform("tiktok");
  if(tab==="socialPublications")renderSocialPublications();
  if(tab==="socialSettings")renderSocialSettings();
  if(tab==="discordWelcome")renderDiscordWelcome();
  if(tab==="discordInvite")renderDiscordInvite();
  if(tab==="discordAccess")renderDiscordAccess();
  if(tab==="system")renderSystemStatus();
  if(tab==="database")renderDatabase();
  if(tab==="backup")renderBackupRestore();
  if(tab==="updates")renderUpdates();
  if(tab==="discordLogsAdmin")renderDiscordLogsAdmin();
  if(tab==="publicWebsites")renderPublicWebsites();
  if(tab==="giveaway")renderGiveaway();
  if(tab==="clips")renderClips();

  if(persist)localStorage.setItem(`bwk-last-tab-${currentPlatform}`,tab);
  if(isMobileNavigation())closeMobileSidebar();
  window.scrollTo({top:0,behavior:"smooth"});
}
function openNavGroup(groupKey){
  const items=availableNavItems(groupKey);if(!items.length)return;
  const current=items.find(item=>item.tab===activeNavTab);openNavTab((current||items[0]).tab,{persist:true});
}
function switchPlatform(platform){
  if(platform===currentPlatform||!platformAvailable(platform))return;
  localStorage.setItem(`bwk-last-tab-${currentPlatform}`,activeNavTab);
  currentPlatform=platform;localStorage.setItem("bwk-platform",currentPlatform);
  const saved=localStorage.getItem(`bwk-last-tab-${currentPlatform}`),group=saved?groupForTab(saved,currentPlatform):null;
  const allowed=saved&&group&&availableNavItems(group).some(item=>item.tab===saved),fallbackGroup=groupsForPlatform(currentPlatform)[0]||"help";
  renderPlatformSwitch();renderMainNav();openNavTab(allowed?saved:(availableNavItems(fallbackGroup)[0]?.tab||"help"),{persist:false});
}
// v8.2.6 – Berechtigungsgebundene globale Funktions- und Mitgliedersuche.
let globalSearchRequest=0,globalSearchTimer=null,globalSearchController=null;
function globalSearchVisible(){return !$('globalSearchOverlay')?.classList.contains('hidden');}
function closeGlobalSearch(){
  $('globalSearchOverlay')?.classList.add('hidden');globalSearchRequest++;
  if(globalSearchTimer)clearTimeout(globalSearchTimer);
  globalSearchController?.abort();globalSearchController=null;
}
function openGlobalSearch(){
  if(!currentUser)return;
  $('globalSearchOverlay')?.classList.remove('hidden');
  $('globalSearchInput').value='';updateGlobalSearch('');$('globalSearchInput').focus();
}
function globalSearchIndex(){
  const found=new Map();
  for(const platform of ['twitch','discord']){
    if(!platformAvailable(platform))continue;
    for(const group of PLATFORM_NAV[platform]||[]){
      const category=NAV_GROUPS[group];if(!category)continue;
      for(const item of category.items||[]){
        if(!navFavoriteAllowed(item,platform)||(item.platform&&item.platform!==platform)||(item.requiresMinigame&&!minigameReady))continue;
        const key=platform+':'+item.tab;
        if(!found.has(key))found.set(key,{tab:item.tab,platform,group:category.label,label:item.label,haystack:[item.label,category.label,item.tab,platform].join(' ').toLocaleLowerCase('de')});
      }
    }
  }
  return [...found.values()];
}
function globalSearchSection(title,rows){return `<div class="global-search-section"><h4>${esc(title)}</h4>${rows.join('')||'<p class="hint">Keine Treffer.</p>'}</div>`;}
async function updateGlobalSearch(value){
  const request=++globalSearchRequest;
  if(globalSearchTimer)clearTimeout(globalSearchTimer);
  globalSearchController?.abort();globalSearchController=null;
  const root=$('globalSearchResults');if(!root)return;
  const query=String(value||'').trim().toLocaleLowerCase('de');
  const matches=globalSearchIndex().filter(it=>!query||it.haystack.includes(query)).slice(0,12);
  const functions=matches.map(it=>`<button type="button" class="global-search-result" data-global-tab="${esc(it.tab)}" data-global-platform="${esc(it.platform)}"><span>${esc(it.label)}</span><small>${esc(it.platform==='discord'?'Discord':'Twitch')} · ${esc(it.group)}</small></button>`);
  const showMembers=query.length>=2&&hasCapability('discord.members.view')&&platformAvailable('discord');
  root.innerHTML=globalSearchSection('Funktionen',functions)+(showMembers?globalSearchSection('Discord-Mitglieder',['<p class="hint">Mitglieder werden gesucht …</p>']):'');
  root.querySelectorAll('[data-global-tab]').forEach(btn=>btn.onclick=async()=>{
    const platform=btn.dataset.globalPlatform,tab=btn.dataset.globalTab;
    const allowed=globalSearchIndex().some(it=>it.tab===tab&&it.platform===platform);if(!allowed)return;
    closeGlobalSearch();if(currentPlatform!==platform){currentPlatform=platform;localStorage.setItem('bwk-platform',platform);}await openNavTab(tab,{persist:true});
  });
  if(!showMembers)return;
  globalSearchTimer=setTimeout(async()=>{
    const controller=new AbortController();globalSearchController=controller;
    try{
      const r=await fetch(`/api/discord/members?query=${encodeURIComponent(query)}&limit=10`,{signal:controller.signal,cache:'no-store'});
      if(!r.ok)throw Error('Mitgliedersuche fehlgeschlagen');
      const d=await r.json();if(request!==globalSearchRequest||!globalSearchVisible())return;
      const records=(d.members||[]).slice(0,10);
      const rows=records.map(m=>`<button type="button" class="global-search-result" data-global-member="${esc(m.id)}"><span>${esc(m.displayName||m.username||m.id)}</span><small>@${esc(m.username||'–')} · ${esc(m.id)}</small></button>`);
      root.querySelector('.global-search-section:last-child').outerHTML=globalSearchSection('Discord-Mitglieder',rows);
      root.querySelectorAll('[data-global-member]').forEach(btn=>btn.onclick=async()=>{
        if(!hasCapability('discord.members.view'))return;
        const id=btn.dataset.globalMember;const chosen=records.find(m=>String(m.id)===id);if(!chosen)return;
        closeGlobalSearch();if(currentPlatform!=='discord'){currentPlatform='discord';localStorage.setItem('bwk-platform','discord');}
        await openNavTab('discordMembers',{persist:true});
        discordSelectedMemberId=id;
        await renderDiscordMembers(id);
      });
    }catch(e){if(e.name==='AbortError'||request!==globalSearchRequest)return;const last=root.querySelector('.global-search-section:last-child');if(last)last.outerHTML=globalSearchSection('Discord-Mitglieder',['<p class="hint">Suche derzeit nicht verfügbar.</p>']);}
  },300);
}
function initGlobalSearch(){
  $('globalSearchOpen')?.addEventListener('click',openGlobalSearch);
  $('globalSearchClose')?.addEventListener('click',closeGlobalSearch);
  $('globalSearchOverlay')?.addEventListener('click',e=>{if(e.target.id==='globalSearchOverlay')closeGlobalSearch();});
  $('globalSearchInput')?.addEventListener('input',e=>updateGlobalSearch(e.currentTarget.value));
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.altKey){e.preventDefault();globalSearchVisible()?closeGlobalSearch():openGlobalSearch();return;}
    if(e.key==='Escape'&&globalSearchVisible()){e.preventDefault();e.stopImmediatePropagation();closeGlobalSearch();}
  },true);
}
function initNavigation(){
  initGlobalSearch();
  document.querySelectorAll("#platformSwitch [data-platform]").forEach(btn=>btn.addEventListener("click",()=>switchPlatform(btn.dataset.platform)));
  $("sidebarCollapseBtn")?.addEventListener("click",toggleSidebarCollapsed);
  $("mobileMenuBtn")?.addEventListener("click",()=>document.body.classList.contains("sidebar-mobile-open")?closeMobileSidebar():openMobileSidebar());
  $("sidebarBackdrop")?.addEventListener("click",closeMobileSidebar);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMobileSidebar();});
  document.addEventListener("click",e=>{
    const btn=e.target.closest?.("[data-open-log-category]");
    if(btn&&isGlobalAdmin()){e.preventDefault();openDiscordLogsCategory(btn.dataset.openLogCategory);}
  });
  window.addEventListener("resize",()=>{if(!isMobileNavigation())closeMobileSidebar();applySidebarPreference();});
  applySidebarPreference();
  const preferred=localStorage.getItem("bwk-platform");
  currentPlatform=preferred&&platformAvailable(preferred)?preferred:(platformAvailable("twitch")?"twitch":"discord");
  const saved=localStorage.getItem(`bwk-last-tab-${currentPlatform}`),group=saved?groupForTab(saved,currentPlatform):null;
  const allowed=saved&&group&&availableNavItems(group).some(item=>item.tab===saved),fallbackGroup=groupsForPlatform(currentPlatform)[0]||"help";
  activeNavGroup=allowed?group:fallbackGroup;activeNavTab=allowed?saved:(availableNavItems(fallbackGroup)[0]?.tab||"help");
  refreshNavigationPermissions();openNavTab(activeNavTab,{persist:false});
  $("favoriteToggle")?.addEventListener("click",async()=>{
    try{const next=navFavorites.includes(activeNavTab)?navFavorites.filter(x=>x!==activeNavTab):[...navFavorites,activeNavTab];await saveNavFavorites(next);}
    catch(e){showToast(e.message,"error");}
  });
  loadNavFavorites();
}
function mark(){dirty=true; $("saveState").textContent="Ungespeicherte Änderungen";}
let confirmResolver = null;
function askConfirm({title="Bestätigen",text="Aktion wirklich ausführen?",confirmLabel="BESTÄTIGEN",cancelLabel="ABBRECHEN",danger=false,typeToConfirm=""}={}){
  const modal=$("confirmModal"),yes=$("confirmYes"),no=$("confirmNo");
  $("confirmTitle").textContent=title;
  $("confirmText").textContent=text;
  yes.textContent=confirmLabel;
  no.textContent=cancelLabel;
  yes.classList.toggle("danger-strong",!!danger);
  // 9.6.0: verschärfte Bestätigung – erst nach Eintippen des genauen Textes freigegeben.
  $("confirmTypeWrap")?.remove();yes.disabled=false;
  if(typeToConfirm){
    const wrap=document.createElement("div");wrap.id="confirmTypeWrap";wrap.className="confirm-type";
    wrap.innerHTML=`<label for="confirmTypeInput">Zur Bestätigung „${esc(typeToConfirm)}“ eintippen:</label><input id="confirmTypeInput" autocomplete="off" spellcheck="false">`;
    $("confirmText").after(wrap);
    const input=$("confirmTypeInput");yes.disabled=true;
    input.addEventListener("input",()=>{yes.disabled=input.value.trim()!==typeToConfirm;});
    modal.classList.remove("hidden");input.focus();
    return new Promise(resolve=>{confirmResolver=resolve;});
  }
  modal.classList.remove("hidden");
  yes.focus();
  return new Promise(resolve=>{confirmResolver=resolve;});
}
// 8.9.7: askDelete zeigte bei jeder Bestätigung "Löschen bestätigen" und einen roten LÖSCHEN-Knopf,
// auch bei Aktionen wie Aktivieren, Beenden oder Veröffentlichen. askAs setzt Titel und Knopf passend.
const CONFIRM_PRESETS={
  activate:{title:"Profil aktivieren",confirmLabel:"AKTIVIEREN",danger:false},
  apply:{title:"Profil aktualisieren",confirmLabel:"AKTUALISIEREN",danger:true},
  unlink:{title:"Aufheben bestätigen",confirmLabel:"AUFHEBEN",danger:true},
  draw:{title:"Ziehung bestätigen",confirmLabel:"ZIEHEN",danger:false},
  end:{title:"Beenden bestätigen",confirmLabel:"BEENDEN",danger:true},
  disconnect:{title:"Trennen bestätigen",confirmLabel:"TRENNEN",danger:true},
  ban:{title:"Bannen bestätigen",confirmLabel:"BANNEN",danger:true},
  publish:{title:"Veröffentlichen bestätigen",confirmLabel:"VERÖFFENTLICHEN",danger:true},
  unpublish:{title:"Zurücknehmen bestätigen",confirmLabel:"ZURÜCKNEHMEN",danger:false},
  revert:{title:"Zurücknehmen bestätigen",confirmLabel:"ZURÜCKNEHMEN",danger:true},
  reset:{title:"Zurücksetzen bestätigen",confirmLabel:"ZURÜCKSETZEN",danger:true},
  refund:{title:"Erstatten bestätigen",confirmLabel:"ERSTATTEN",danger:false},
  regenerate:{title:"Neu erzeugen bestätigen",confirmLabel:"ERZEUGEN",danger:true}
};
function askAs(kind,text){
  return askConfirm({text:text||"Aktion wirklich ausführen?",...(CONFIRM_PRESETS[kind]||{})});
}
function askDelete(text){
  return askConfirm({
    title:"Löschen bestätigen",
    text:text||"Eintrag wirklich löschen?",
    confirmLabel:"LÖSCHEN",
    cancelLabel:"ABBRECHEN",
    danger:true
  });
}
function finishDeleteConfirm(value){
  if(value&&$("confirmYes")?.disabled)return; // 9.6.0: verschärfte Bestätigung noch nicht erfüllt
  $("confirmModal").classList.add("hidden");
  $("confirmTypeWrap")?.remove();if($("confirmYes"))$("confirmYes").disabled=false;
  if(confirmResolver){confirmResolver(value);confirmResolver=null;}
}
$("confirmYes")?.addEventListener("click",()=>finishDeleteConfirm(true));
$("confirmNo")?.addEventListener("click",()=>finishDeleteConfirm(false));
$("confirmModal")?.addEventListener("click",e=>{if(e.target===$("confirmModal"))finishDeleteConfirm(false);});


function botSel(v){ const cur=botList.some(b=>b.key===v)?v:botDefault("main"); return `<select data-k="bot">${botOptionsHtml()}</select>`.replace(`value="${cur}"`,`value="${cur}" selected`); }

function botLabel(v){
  const b=botList.find(x=>x.key===v);
  return b?(b.displayName||b.key):(botList.length?botNameFor("main"):String(v||""));
}

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function showToast(message,type="success",duration=3200){
  let host=document.getElementById("toastHost");
  if(!host){
    host=document.createElement("div");
    host.id="toastHost";
    host.className="toast-host";
    host.setAttribute("aria-live","polite");
    host.setAttribute("aria-atomic","false");
    document.body.appendChild(host);
  }

  const toast=document.createElement("div");
  toast.className=`app-toast ${type==="error"?"error":type==="warning"?"warning":"success"}`;
  toast.setAttribute("role",type==="error"?"alert":"status");

  const icon=type==="error"?"⚠":type==="warning"?"!":"✓";
  toast.innerHTML=`<span class="app-toast-icon">${icon}</span><span class="app-toast-text">${esc(message)}</span>`;
  host.appendChild(toast);

  requestAnimationFrame(()=>toast.classList.add("visible"));
  setTimeout(()=>{
    toast.classList.remove("visible");
    setTimeout(()=>toast.remove(),220);
  },Math.max(1200,Number(duration)||3200));
}

function bind(section, arr){
  section.querySelectorAll("[data-id]").forEach(row=>{
    const obj=arr.find(x=>String(x.id)===String(row.dataset.id)); if(!obj)return;

    row.querySelectorAll("[data-k]").forEach(el=>{
      const syncValue=()=>{
        obj[el.dataset.k]=el.type==="checkbox"
          ? el.checked
          : (el.type==="number" ? Number(el.value) : el.value);
        mark();
      };

      // Textfelder reagieren direkt; Selects/Checkboxen zuverlässig über change.
      el.addEventListener("input",syncValue);
      el.addEventListener("change",syncValue);
    });

    row.querySelector(".del")?.addEventListener("click",async ()=>{
      const label = obj.command || obj.description || obj.login || obj.word || obj.trigger || "diesen Eintrag";
      if(!(await askDelete(`„${label}“ wirklich löschen?`))) return;
      arr.splice(arr.indexOf(obj),1);
      mark();
      renderAll();
    });
  });
}
function syncCommandsFromDom(){
  if(!settings?.commands) return;

  document.querySelectorAll("#commands .command-row[data-id]").forEach(row=>{
    const obj=settings.commands.find(x=>String(x.id)===String(row.dataset.id));
    if(!obj) return;

    const get=(key)=>row.querySelector(`[data-k="${key}"]`);

    const enabled=get("enabled");
    const command=get("command");
    const aliases=get("aliases");
    const bot=get("bot");
    const cooldown=get("cooldownSeconds");
    const modsOnly=get("modsOnly");
    const response=get("response");

    if(enabled) obj.enabled=!!enabled.checked;
    if(command) obj.command=command.value;
    if(aliases) obj.aliases=aliases.value;
    if(bot) obj.bot=bot.value;
    if(cooldown) obj.cooldownSeconds=Math.max(0,Number(cooldown.value||0));
    if(modsOnly) obj.modsOnly=!!modsOnly.checked;
    if(response) obj.response=response.value;
  });
}

function renderCommands(){
  settings.commands ||= [];

  const sortedCommands = settings.commands.filter(x=>x?.managedBy!=="team").sort((a,b)=>{
    const av=String(a.command||"").toLowerCase();
    const bv=String(b.command||"").toLowerCase();
    return av.localeCompare(bv,"de",{sensitivity:"base"});
  });

  $("commands").innerHTML = `
    <div class="commands-toolbar">
      <div class="toolbar-left">
        <h2>Commands</h2>
        <input id="commandSearch" class="command-search" type="search" placeholder="Commands durchsuchen …">
        <select id="commandSort" class="command-sort" title="Sortierung">
          <option value="az" selected>A → Z</option>
          <option value="za">Z → A</option>
          <option value="newest">Neueste zuerst</option>
          <option value="oldest">Älteste zuerst</option>
        </select>
      </div>
      <button data-click="addCommand">+ Command</button>
    </div>

    <p class="hint">In der Übersicht siehst du nur Command, Alias(e) und den antwortenden Bot. Weitere Optionen öffnest du über den Stift. Änderungen anderer Nutzer werden auf dieser Seite automatisch alle 5 Sekunden übernommen, solange du selbst keine ungespeicherten Änderungen hast.</p>

    <div class="commands-table compact-commands">
      <div class="commands-head compact-head">
        <div>Command</div>
        <div>Alias(e)</div>
        <div>Bot</div>
        <div>Aktionen</div>
      </div>

      <div id="commandsRows">
        ${sortedCommands.map((x,idx)=>`
          <div class="command-row compact-command-row" data-id="${x.id}" data-search="${esc((x.command||"")+" "+(x.aliases||"")+" "+(x.response||""))}" data-order="${idx}">
            <div class="compact-command-name ${x.enabled ? "" : "is-disabled"}">${esc(x.command||"(ohne Command)")}</div>
            <div class="compact-aliases">${x.aliases ? esc(x.aliases) : '<span class="muted">–</span>'}</div>
            <div class="compact-bot">${esc(botLabel(x.bot))}</div>
            <div class="command-actions">
              <button type="button" class="icon-btn edit-command" title="Bearbeiten">✎</button>
              <button type="button" class="icon-btn del danger" title="Löschen">🗑</button>
            </div>

            <div class="command-details hidden">
              <div class="detail-grid">
                <label class="compact detail-toggle">
                  <input type="checkbox" data-k="enabled" ${x.enabled?"checked":""}>
                  Aktiv
                </label>

                <div>
                  <span class="fieldlabel">Command</span>
                  <input data-k="command" value="${esc(x.command||"")}" placeholder="!command">
                </div>

                <div>
                  <span class="fieldlabel">Alias(e)</span>
                  <input data-k="aliases" value="${esc(x.aliases||"")}" placeholder="!alias1, !alias2">
                </div>

                <div>
                  <span class="fieldlabel">Antwortender Bot</span>
                  ${botSel(x.bot)}
                </div>

                <div>
                  <span class="fieldlabel">Cooldown (Sek.)</span>
                  <input type="number" data-k="cooldownSeconds" value="${x.cooldownSeconds||0}" min="0">
                </div>

                <label class="compact detail-toggle">
                  <input type="checkbox" data-k="modsOnly" ${x.modsOnly?"checked":""}>
                  Nur Mods
                </label>

                <div class="details-wide">
                  <span class="fieldlabel">Antwort</span>
                  <textarea data-k="response">${esc(x.response||"")}</textarea>
                </div>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>`;

  bind($("commands"), settings.commands);

  $("commands").querySelectorAll(".edit-command").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const row=btn.closest(".command-row");
      const details=row.querySelector(".command-details");
      const willOpen=details?.classList.contains("hidden");
      $("commands").querySelectorAll(".command-details").forEach(d=>d.classList.add("hidden"));
      if(willOpen) details?.classList.remove("hidden");
    });
  });

  function applyCommandView(){
    const q=($("commandSearch")?.value||"").trim().toLowerCase();
    const sort=$("commandSort")?.value||"az";
    const rows=[...$("commandsRows").querySelectorAll(".command-row")];

    rows.forEach(row=>{
      const hay=(row.dataset.search||"").toLowerCase();
      row.classList.toggle("hidden", q && !hay.includes(q));
    });

    const visibleRows=rows.filter(r=>!r.classList.contains("hidden"));

    visibleRows.sort((ra,rb)=>{
      const a=settings.commands.find(x=>String(x.id)===String(ra.dataset.id)) || {};
      const b=settings.commands.find(x=>String(x.id)===String(rb.dataset.id)) || {};

      if(sort==="az"){
        return String(a.command||"").localeCompare(String(b.command||""),"de",{sensitivity:"base"});
      }
      if(sort==="za"){
        return String(b.command||"").localeCompare(String(a.command||""),"de",{sensitivity:"base"});
      }
      if(sort==="newest"){
        return settings.commands.indexOf(b)-settings.commands.indexOf(a);
      }
      if(sort==="oldest"){
        return settings.commands.indexOf(a)-settings.commands.indexOf(b);
      }
      return 0;
    });

    visibleRows.forEach(row=>$("commandsRows").appendChild(row));
  }

  $("commandSearch")?.addEventListener("input",applyCommandView);
  $("commandSort")?.addEventListener("change",applyCommandView);

  applyCommandView();
}
function addCommand(){
  settings.commands ||= [];

  const item={
    id:uid(),
    enabled:true,
    command:"!",
    aliases:"",
    response:"",
    bot:botDefault("main"),
    cooldownSeconds:30,
    modsOnly:false
  };

  settings.commands.push(item);
  mark();
  renderCommands();

  // Neuen Command sofort zum Bearbeiten öffnen und das Command-Feld fokussieren.
  setTimeout(()=>{
    const row=document.querySelector(`#commands [data-id="${CSS.escape(item.id)}"]`);
    if(!row) return;

    const details=row.querySelector(".command-details");
    details?.classList.remove("hidden");

    const commandInput=details?.querySelector('[data-k="command"]');
    commandInput?.focus();

    // Das vorausgefüllte "!" markieren, damit direkt weitergetippt werden kann.
    if(commandInput){
      commandInput.setSelectionRange(commandInput.value.length,commandInput.value.length);
    }

    row.scrollIntoView({behavior:"smooth",block:"center"});
  },30);
}

function renderTimers(){
  settings.timers ||= [];

  const sortedTimers=[...settings.timers].sort((a,b)=>{
    return String(a.description||"").localeCompare(String(b.description||""),"de",{sensitivity:"base"});
  });

  $("timers").innerHTML=`
    <div class="timers-toolbar">
      <div class="toolbar-left">
        <h2>Timer-Nachrichten</h2>
        <input id="timerSearch" class="command-search" type="search" placeholder="Timer durchsuchen …">
      </div>
      <button data-click="addTimer">+ Timer</button>
    </div>

    <p class="hint">
      Timer laufen nur während eines Live-Streams. Mit <strong>UND</strong> müssen Zeit und Mindest-Zeilen erfüllt sein.
      Mit <strong>ODER</strong> reicht eine der beiden Bedingungen aus.
    </p>

    <div class="timers-table">
      <div class="timers-head">
        <div>Aktiv</div>
        <div>Timer</div>
        <div>Bot</div>
        <div>Modus</div>
        <div>Zeit</div>
        <div>Zeilen</div>
        <div>Aktionen</div>
      </div>

      <div id="timerRows">
        ${sortedTimers.map(x=>`
          <div class="timer-row" data-id="${x.id}" data-search="${esc((x.description||"")+" "+(x.text||""))}">
            <div><input type="checkbox" data-k="enabled" ${x.enabled?"checked":""}></div>

            <div class="timer-summary">
              <strong>${esc(x.description||"(ohne Beschreibung)")}</strong>
              <span>${esc(x.text||"")}</span>
            </div>

            <div>${esc(botLabel(x.bot))}</div>
            <div><span class="mode-badge ${String(x.conditionMode||"and").toLowerCase()==="or" ? "mode-or" : "mode-and"}">${String(x.conditionMode||"and").toLowerCase()==="or" ? "ODER" : "UND"}</span></div>
            <div>${Number(x.everyMinutes||30)} Min.</div>
            <div>${Number(x.minLines||0)} Zeilen</div>

            <div class="command-actions">
              <button type="button" class="icon-btn edit-timer" title="Bearbeiten">✎</button>
              <button type="button" class="icon-btn del danger" title="Löschen">🗑</button>
            </div>

            <div class="timer-details hidden">
              <div class="timer-detail-grid timer-detail-layout">
                <div class="timer-detail-description">
                  <span class="fieldlabel">Beschreibung</span>
                  <input data-k="description" value="${esc(x.description||"")}" placeholder="z. B. Commands">
                </div>

                <div class="timer-detail-bot">
                  <span class="fieldlabel">Antwortender Bot</span>
                  ${botSel(x.bot)}
                </div>

                <label class="compact timer-detail-enabled">
                  <span class="fieldlabel">Status</span>
                  <span class="checkline"><input type="checkbox" data-k="enabled" ${x.enabled?"checked":""}> Aktiv</span>
                </label>

                <div class="timer-condition-row">
                  <div>
                    <span class="fieldlabel">Bedingung</span>
                    <select data-k="conditionMode">
                      <option value="and" ${String(x.conditionMode||"and").toLowerCase()==="and" ? "selected" : ""}>UND</option>
                      <option value="or" ${String(x.conditionMode||"and").toLowerCase()==="or" ? "selected" : ""}>ODER</option>
                    </select>
                  </div>

                  <div>
                    <span class="fieldlabel">Zeit</span>
                    <div class="input-suffix">
                      <input type="number" data-k="everyMinutes" value="${Number(x.everyMinutes||30)}" min="1">
                      <span>Min.</span>
                    </div>
                  </div>

                  <div>
                    <span class="fieldlabel">Mindest-Zeilen</span>
                    <div class="input-suffix">
                      <input type="number" data-k="minLines" value="${Number(x.minLines||0)}" min="0">
                      <span>Zeilen</span>
                    </div>
                  </div>
                </div>

                <div class="timer-message-row">
                  <span class="fieldlabel">Nachricht</span>
                  <textarea data-k="text" placeholder="Text, der im Chat gesendet wird">${esc(x.text||"")}</textarea>
                </div>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>`;

  bind($("timers"),settings.timers);

  $("timers").querySelectorAll(".edit-timer").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const row=btn.closest(".timer-row");
      const details=row.querySelector(".timer-details");
      const willOpen=details?.classList.contains("hidden");

      $("timers").querySelectorAll(".timer-details").forEach(d=>d.classList.add("hidden"));
      if(willOpen) details?.classList.remove("hidden");
    });
  });

  $("timerSearch")?.addEventListener("input",e=>{
    const q=e.target.value.trim().toLowerCase();
    $("timerRows").querySelectorAll(".timer-row").forEach(row=>{
      const hay=(row.dataset.search||"").toLowerCase();
      row.classList.toggle("hidden",q && !hay.includes(q));
    });
  });
}
function addTimer(){
  settings.timers ||= [];
  const item={id:uid(),enabled:true,description:"",bot:botDefault("main"),conditionMode:"and",everyMinutes:15,minLines:20,text:""};
  settings.timers.push(item);
  mark();
  renderTimers();
  setTimeout(()=>{
    const row=document.querySelector(`#timers [data-id="${CSS.escape(item.id)}"]`);
    row?.querySelector(".edit-timer")?.click();
    row?.querySelector('[data-k="description"]')?.focus();
  },30);
}




function renderEvents(){
  settings.greetings ||= [];
  settings.events ||= {};
  settings.communityCommands ||= {};

  settings.events.follow ||= {
    enabled:false,bot:botDefault("helper"),text:bt("followText","Willkommen im Chat, {user}! 👋"),
    messages:[bt("followText","Willkommen im Chat, {user}! 👋")]
  };
  if(!Array.isArray(settings.events.follow.messages) || !settings.events.follow.messages.length){
    settings.events.follow.messages=[String(settings.events.follow.text||bt("followText","Willkommen im Chat, {user}! 👋"))];
  }
  settings.events.raid ||= {
    enabled:false,bot:botDefault("main"),text:"Willkommen an den Raid von {user} mit {viewers} Zuschauenden! 👋"
  };
  settings.communityCommands.followage ||= {
    enabled:true,bot:botDefault("main"),cooldownSeconds:30,
    text:bt("followageText","{user} folgt dem Kanal seit {date} – also seit {followage}."),
    notFollowingText:"{user} folgt dem Kanal aktuell nicht."
  };
  settings.communityCommands.watchtime ||= {
    enabled:true,bot:botDefault("main"),cooldownSeconds:30,
    text:"{user}, deine erfasste Watchtime beträgt {watchtime}.",
    noDataText:"{user}, für dich wurde bisher noch keine Watchtime erfasst."
  };

  const f=settings.events.follow, r=settings.events.raid;
  const fa=settings.communityCommands.followage, wt=settings.communityCommands.watchtime;

  $("events").innerHTML=`
    <div class="title"><h2>Community</h2></div>
    <p class="hint">Community-Funktionen für Follow, Raid, Begrüßungen sowie die festen Befehle <code>!followage</code> und <code>!watchtime</code>.</p>

    <div class="community-grid">
      <div class="card community-card follow-message-card">
        <div class="title">
          <div>
            <h3>Follow</h3>
            <p class="hint follow-hint">Die Nachrichten werden der Reihe nach abwechselnd verwendet.</p>
          </div>
          <label class="compact"><input id="community-follow-enabled" type="checkbox" ${f.enabled?"checked":""}> Aktiv</label>
        </div>
        <div><span class="fieldlabel">Bot</span>${botSel(f.bot).replace('data-k="bot"','id="community-follow-bot"')}</div>

        <div class="follow-message-toolbar">
          <span class="fieldlabel">Follow-Nachrichten (${f.messages.length})</span>
          <button id="addFollowMessageBtn" type="button">+ Nachricht</button>
        </div>

        <div id="followMessageList" class="follow-message-list">
          ${f.messages.map((msg,index)=>`
            <div class="follow-message-row" data-follow-message-index="${index}">
              <div class="follow-message-number">${index+1}</div>
              <textarea class="follow-message-input" placeholder="Follow-Nachricht …">${esc(msg)}</textarea>
              <button class="follow-message-delete danger" type="button" title="Nachricht löschen" ${f.messages.length<=1?"disabled":""}>🗑</button>
            </div>
          `).join("")}
        </div>
        <p class="hint">Platzhalter: <code>{user}</code>. Mindestens eine Nachricht bleibt immer erhalten.</p>
      </div>

      <div class="card community-card">
        <div class="title"><h3>Raid</h3><label class="compact"><input id="community-raid-enabled" type="checkbox" ${r.enabled?"checked":""}> Aktiv</label></div>
        <div><span class="fieldlabel">Bot</span>${botSel(r.bot).replace('data-k="bot"','id="community-raid-bot"')}</div>
        <div><span class="fieldlabel">Nachricht</span><textarea id="community-raid-text">${esc(r.text||"")}</textarea></div>
      </div>

      <div class="card community-card">
        <div class="title"><h3>!followage</h3><label class="compact"><input id="community-followage-enabled" type="checkbox" ${fa.enabled?"checked":""}> Aktiv</label></div>
        <div class="community-command-row">
          <div><span class="fieldlabel">Bot</span>${botSel(fa.bot).replace('data-k="bot"','id="community-followage-bot"')}</div>
          <div><span class="fieldlabel">Cooldown</span><div class="input-suffix"><input id="community-followage-cooldown" type="number" min="0" value="${Number(fa.cooldownSeconds||0)}"><span>Sek.</span></div></div>
        </div>
        <div><span class="fieldlabel">Antwort</span><textarea id="community-followage-text">${esc(fa.text||"")}</textarea></div>
        <div><span class="fieldlabel">Wenn kein Follow</span><textarea id="community-followage-no">${esc(fa.notFollowingText||"")}</textarea></div>
        <p class="hint">Platzhalter: <code>{user}</code>, <code>{date}</code>, <code>{followage}</code></p>
      </div>

      <div class="card community-card">
        <div class="title"><h3>!watchtime</h3><label class="compact"><input id="community-watchtime-enabled" type="checkbox" ${wt.enabled?"checked":""}> Aktiv</label></div>
        <div class="community-command-row">
          <div><span class="fieldlabel">Bot</span>${botSel(wt.bot).replace('data-k="bot"','id="community-watchtime-bot"')}</div>
          <div><span class="fieldlabel">Cooldown</span><div class="input-suffix"><input id="community-watchtime-cooldown" type="number" min="0" value="${Number(wt.cooldownSeconds||0)}"><span>Sek.</span></div></div>
        </div>
        <div><span class="fieldlabel">Antwort</span><textarea id="community-watchtime-text">${esc(wt.text||"")}</textarea></div>
        <div><span class="fieldlabel">Noch keine Daten</span><textarea id="community-watchtime-no">${esc(wt.noDataText||"")}</textarea></div>
        <p class="hint">Die Watchtime wird lokal ab früheren Versionen erfasst, solange der Stream live ist und Twitch den Nutzer als Chatter führt. Sie ist keine rückwirkende Twitch-Statistik.</p>
      </div>
    </div>

    <div class="title subhead"><h3>Begrüßungen im Chat</h3><button data-click="addGreeting">+ Begrüßung</button></div>
    <p class="hint">Eine Begrüßung wird beim ersten Chatbeitrag des eingetragenen Twitch-Nutzers ausgelöst und danach frühestens nach 12 Stunden erneut.</p>
    ${settings.greetings.map(x=>`<div class="card item greeting-item" data-id="${x.id}">
      <label class="compact"><input type="checkbox" data-k="enabled" ${x.enabled?"checked":""}> Aktiv</label>
      <div><span class="fieldlabel">Twitch-Login</span><input data-k="login" value="${esc(x.login||"")}" placeholder="twitchlogin"></div>
      <div><span class="fieldlabel">Bot</span>${botSel(x.bot)}</div>
      <div class="wide"><span class="fieldlabel">Begrüßung</span><textarea data-k="text">${esc(x.text||"")}</textarea></div>
      <button class="del danger">Löschen</button>
    </div>`).join("")}
  `;

  const wire=(id,fn,type="input")=>{
    const el=$(id); if(!el) return;
    el.addEventListener(type,()=>{fn(el);mark();renderDashboardSummary();});
  };

  wire("community-follow-enabled",el=>f.enabled=el.checked,"change");
  wire("community-follow-bot",el=>f.bot=el.value,"change");

  $("events")?.querySelectorAll(".follow-message-row").forEach(row=>{
    const index=Number(row.dataset.followMessageIndex);
    const input=row.querySelector(".follow-message-input");
    const del=row.querySelector(".follow-message-delete");

    input?.addEventListener("input",()=>{
      f.messages[index]=input.value;
      f.text=f.messages[0]||"";
      mark();
    });

    del?.addEventListener("click",async()=>{
      if(f.messages.length<=1) return;
      if(!(await askDelete("Diese Follow-Nachricht wirklich löschen?"))) return;
      f.messages.splice(index,1);
      f.text=f.messages[0]||"";
      mark();
      renderEvents();
      applyPermissions();
    });
  });

  $("addFollowMessageBtn")?.addEventListener("click",()=>{
    f.messages.push(bt("followText","Willkommen im Chat, {user}! 👋"));
    f.text=f.messages[0]||"";
    mark();
    renderEvents();
    applyPermissions();
    setTimeout(()=>{
      const rows=[...document.querySelectorAll("#followMessageList .follow-message-row")];
      rows.at(-1)?.querySelector(".follow-message-input")?.focus();
    },20);
  });

  wire("community-raid-enabled",el=>r.enabled=el.checked,"change");
  wire("community-raid-bot",el=>r.bot=el.value,"change");
  wire("community-raid-text",el=>r.text=el.value);

  wire("community-followage-enabled",el=>fa.enabled=el.checked,"change");
  wire("community-followage-bot",el=>fa.bot=el.value,"change");
  wire("community-followage-cooldown",el=>fa.cooldownSeconds=Math.max(0,Number(el.value||0)));
  wire("community-followage-text",el=>fa.text=el.value);
  wire("community-followage-no",el=>fa.notFollowingText=el.value);

  wire("community-watchtime-enabled",el=>wt.enabled=el.checked,"change");
  wire("community-watchtime-bot",el=>wt.bot=el.value,"change");
  wire("community-watchtime-cooldown",el=>wt.cooldownSeconds=Math.max(0,Number(el.value||0)));
  wire("community-watchtime-text",el=>wt.text=el.value);
  wire("community-watchtime-no",el=>wt.noDataText=el.value);

  bind($("events"),settings.greetings);
}

function addGreeting(){
  settings.greetings ||= [];
  const item={id:uid(),enabled:true,login:"",bot:botDefault("helper"),text:bt("greeting","Willkommen {user}! 👋")};
  settings.greetings.push(item);
  mark();
  renderEvents();
  renderDashboardSummary();
  setTimeout(()=>{
    const row=document.querySelector(`#events [data-id="${CSS.escape(item.id)}"]`);
    row?.querySelector('[data-k="login"]')?.focus();
  },30);
}


function renderModeration(){
  settings.moderation ||= {};

  const defaults={
    global:{
      whitelistUsers:[],
      exemptModerators:true,
      exemptBroadcaster:true
    },
    links:{
      enabled:false,
      whitelistDomains:[...bt("linkWhitelist",[])],
      reactionBot:botDefault("main"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:"Freut uns, dass du etwas mit uns teilen möchtest, aber Links sind hier nicht erlaubt."
    },
    emotes:{
      enabled:false,
      limit:5,
      reactionBot:botDefault("helper"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:bt("emotesMessage","Bitte nicht so viele Emotes auf einmal. 🙂")
    },
    symbols:{
      enabled:false,
      limit:8,
      reactionBot:botDefault("helper"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:bt("symbolsMessage","Bitte nicht so viele Satzzeichen auf einmal. 🙂")
    },
    caps:{
      enabled:false,
      limit:12,
      reactionBot:botDefault("helper"),
      timeoutEnabled:true,
      timeoutSeconds:600,
      warningSeconds:5,
      timeoutMessageEnabled:true,
      timeoutMessage:bt("capsMessage","Bitte schreibe nicht nur in Großbuchstaben. 🙂")
    }
  };

  for(const [k,v] of Object.entries(defaults)){
    settings.moderation[k] ||= structuredClone(v);
  }

  const g=settings.moderation.global;
  g.whitelistUsers ||= [];

  const filterCards = [
    ["links","Links","Nicht freigegebene Links erkennen."],
    ["emotes","Zu viele Emotes","Übermäßige Nutzung von Twitch-Emotes erkennen."],
    ["symbols","Zu viele Sonderzeichen","Spam mit Satz- und Sonderzeichen erkennen."],
    ["caps","Zu viele Großbuchstaben","Nachrichten mit übermäßig vielen Großbuchstaben erkennen."]
  ];

  function botDropdown(value,id){
    const cur=botList.some(b=>b.key===value)?value:botDefault("main");
    return `<select id="${id}">${botList.map(b=>`<option value="${esc(b.key)}" ${cur===b.key?"selected":""}>${esc(b.displayName||b.key)}</option>`).join("")}</select>`;
  }

  function filterCard(key,title,desc){
    const x=settings.moderation[key];
    const isLinks=key==="links";

    return `
      <div class="card moderation-filter-card" data-filter="${key}">
        <div class="moderation-filter-summary">
          <div>
            <h3>${title}</h3>
            <p class="hint">${desc}</p>
          </div>

          <div class="moderation-summary-meta">
            <span class="mode-badge ${x.enabled?"mode-and":"mode-or"}">${x.enabled?"AN":"AUS"}</span>
            ${!isLinks ? `<span class="moderation-limit-badge">Limit: ${Number(x.limit||0)}</span>` : ""}
            <span>${esc(botLabel(x.reactionBot))}</span>
            <button type="button" class="icon-btn edit-mod-filter" title="Bearbeiten">✎</button>
          </div>
        </div>

        <div class="moderation-filter-details hidden">
          <div class="moderation-detail-grid">
            <label class="moderation-check">
              <input id="mod-${key}-enabled" type="checkbox" ${x.enabled?"checked":""}>
              Filter aktiv
            </label>

            ${!isLinks ? `
              <div>
                <span class="fieldlabel">Limit</span>
                <input id="mod-${key}-limit" type="number" min="1" value="${Number(x.limit||1)}">
              </div>` : ""}

            <div>
              <span class="fieldlabel">Reagierender Bot</span>
              ${botDropdown(x.reactionBot||botDefault("main"),`mod-${key}-bot`)}
            </div>

            <label class="moderation-check">
              <input id="mod-${key}-timeout-enabled" type="checkbox" ${x.timeoutEnabled!==false?"checked":""}>
              Timeout setzen
            </label>

            <div id="mod-${key}-warning-wrap" class="${x.timeoutEnabled===false?"timeout-option-disabled":""}">
              <span class="fieldlabel">Verzögerung vor Timeout</span>
              <div class="input-suffix">
                <input id="mod-${key}-warning" type="number" min="0" value="${Number(x.warningSeconds||5)}" ${x.timeoutEnabled===false?"disabled":""}>
                <span>Sek.</span>
              </div>
            </div>

            <div id="mod-${key}-timeout-wrap" class="${x.timeoutEnabled===false?"timeout-option-disabled":""}">
              <span class="fieldlabel">Timeout-Dauer</span>
              <div class="input-suffix">
                <input id="mod-${key}-timeout" type="number" min="1" value="${Number(x.timeoutSeconds||600)}" ${x.timeoutEnabled===false?"disabled":""}>
                <span>Sek.</span>
              </div>
            </div>

            ${isLinks ? `
              <div class="moderation-detail-wide">
                <span class="fieldlabel">Freigegebene Domains</span>
                <textarea id="mod-links-domains" placeholder="Eine Domain pro Zeile">${esc((x.whitelistDomains||[]).join("\n"))}</textarea>
                <p class="hint">Subdomains werden automatisch mit freigegeben.</p>
              </div>` : ""}

            <label class="moderation-check">
              <input id="mod-${key}-msg-enabled" type="checkbox" ${x.timeoutMessageEnabled?"checked":""}>
              Hinweis-Nachricht senden
            </label>

            <div class="moderation-detail-wide">
              <span class="fieldlabel">Hinweis-Nachricht</span>
              <textarea id="mod-${key}-message">${esc(x.timeoutMessage||"")}</textarea>
            </div>
          </div>

          <div class="future-badge">Löschen aktiv · Timeout optional über ${esc(botNameFor("main"))}</div>
        </div>
      </div>`;
  }

  $("moderation").innerHTML=`
    <div class="title">
      <div>
        <h2>Moderation</h2>
        <p class="hint">Aktive Filter werden durch ${esc(botNameFor("main"))} technisch durchgesetzt. Nachrichten werden gelöscht; ein Timeout kann pro Filter optional zugeschaltet werden.</p>
      </div>
    </div>

    <div class="card moderation-global-card">
      <h3>Globale Ausnahmen</h3>
      <p class="hint">Diese Regeln gelten für alle Moderationsfilter.</p>

      <div class="moderation-global-grid">
        <label class="moderation-check">
          <input id="mod-global-exempt-mods" type="checkbox" ${g.exemptModerators?"checked":""}>
          Moderatoren immer ausnehmen
        </label>

        <label class="moderation-check">
          <input id="mod-global-exempt-broadcaster" type="checkbox" ${g.exemptBroadcaster?"checked":""}>
          Kanalinhaber immer ausnehmen
        </label>

        <div class="moderation-detail-wide">
          <span class="fieldlabel">User-Whitelist</span>
          <textarea id="mod-global-users" placeholder="Ein Twitch-Login pro Zeile">${esc((g.whitelistUsers||[]).join("\n"))}</textarea>
          <p class="hint">Diese Nutzer werden von allen Filtern ausgenommen.</p>
        </div>
      </div>
    </div>

    <div class="moderation-filter-list">
      ${filterCards.map(([k,t,d])=>filterCard(k,t,d)).join("")}
    </div>
  `;

  const bindValue=(id,fn)=>{
    const el=$(id);
    if(!el) return;
    const ev=el.type==="checkbox"?"change":"input";
    el.addEventListener(ev,()=>{
      fn(el);
      mark();
    });
  };

  bindValue("mod-global-exempt-mods",el=>g.exemptModerators=el.checked);
  bindValue("mod-global-exempt-broadcaster",el=>g.exemptBroadcaster=el.checked);
  bindValue("mod-global-users",el=>g.whitelistUsers=el.value.split(/\n+/).map(v=>v.trim().toLowerCase()).filter(Boolean));

  for(const [key] of filterCards){
    const x=settings.moderation[key];

    bindValue(`mod-${key}-enabled`,el=>x.enabled=el.checked);
    bindValue(`mod-${key}-bot`,el=>x.reactionBot=el.value);
    const syncTimeoutControls=()=>{
      const enabled=$(`mod-${key}-timeout-enabled`)?.checked ?? true;
      x.timeoutEnabled=enabled;
      const warning=$(`mod-${key}-warning`);
      const timeout=$(`mod-${key}-timeout`);
      const warningWrap=$(`mod-${key}-warning-wrap`);
      const timeoutWrap=$(`mod-${key}-timeout-wrap`);
      if(warning) warning.disabled=!enabled;
      if(timeout) timeout.disabled=!enabled;
      warningWrap?.classList.toggle("timeout-option-disabled",!enabled);
      timeoutWrap?.classList.toggle("timeout-option-disabled",!enabled);
    };

    bindValue(`mod-${key}-timeout-enabled`,el=>{
      x.timeoutEnabled=el.checked;
      syncTimeoutControls();
    });
    syncTimeoutControls();
    bindValue(`mod-${key}-warning`,el=>x.warningSeconds=Math.max(0,Number(el.value||0)));
    bindValue(`mod-${key}-timeout`,el=>x.timeoutSeconds=Math.max(1,Number(el.value||1)));
    bindValue(`mod-${key}-msg-enabled`,el=>x.timeoutMessageEnabled=el.checked);
    bindValue(`mod-${key}-message`,el=>x.timeoutMessage=el.value);

    if(key!=="links"){
      bindValue(`mod-${key}-limit`,el=>x.limit=Math.max(1,Number(el.value||1)));
    }
  }

  bindValue("mod-links-domains",el=>{
    settings.moderation.links.whitelistDomains=el.value.split(/\n+/).map(v=>v.trim()).filter(Boolean);
  });

  $("moderation").querySelectorAll(".edit-mod-filter").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const card=btn.closest(".moderation-filter-card");
      const details=card.querySelector(".moderation-filter-details");
      const willOpen=details?.classList.contains("hidden");

      $("moderation").querySelectorAll(".moderation-filter-details").forEach(d=>d.classList.add("hidden"));
      if(willOpen) details?.classList.remove("hidden");
    });
  });
}

function renderBlocked(){
  settings.blockedWords ||= [];

  $("blocked").innerHTML=`
    <div class="title">
      <div>
        <h2>Verbotene Wörter</h2>
        <p class="hint">Begriffe können nur erkannt, direkt gelöscht oder mit Twitch Blocked Terms synchronisiert werden.</p>
      </div>
      <button data-click="addBlocked">+ Wort/Phrase</button>
    </div>

    <div class="blocked-help card">
      <strong>Aktionen</strong>
      <p><b>Nur erkennen:</b> keine Löschung; optional Bot-Antwort.</p>
      <p><b>Nachricht löschen:</b> ${esc(botNameFor("main"))} entfernt die Chatnachricht unmittelbar.</p>
      <p><b>Bei Twitch blockieren:</b> der Begriff wird in Twitch Blocked Terms angelegt. Twitch fängt passende Nachrichten ab; falls eine Nachricht dennoch beim Bot ankommt, wird sie zusätzlich gelöscht.</p>
    </div>

    ${settings.blockedWords.map(raw=>{
      const x={action:"detect",...raw};
      const syncBadge=x.action==="twitch_block"
        ? (x.twitchSyncStatus==="error"
            ? `<span class="blocked-sync error">Sync-Fehler</span>`
            : x.twitchTermId
              ? `<span class="blocked-sync ok">Twitch synchronisiert</span>`
              : `<span class="blocked-sync pending">wird beim Speichern synchronisiert</span>`)
        : "";

      return `<div class="card blocked-item" data-id="${x.id}">
        <label class="compact"><input type="checkbox" data-k="enabled" ${x.enabled?"checked":""}> Aktiv</label>

        <div>
          <span class="fieldlabel">Wort / Phrase</span>
          <input data-k="word" value="${esc(x.word||"")}" placeholder="Wort oder Phrase">
        </div>

        <div>
          <span class="fieldlabel">Aktion</span>
          <select data-k="action">
            <option value="detect" ${x.action==="detect"?"selected":""}>Nur erkennen</option>
            <option value="delete" ${x.action==="delete"?"selected":""}>Nachricht löschen</option>
            <option value="twitch_block" ${x.action==="twitch_block"?"selected":""}>Bei Twitch blockieren</option>
          </select>
          ${syncBadge}
        </div>

        <div>
          <span class="fieldlabel">Antwortender Bot</span>
          ${botSel(x.bot||botDefault("main"))}
        </div>

        <div class="blocked-response">
          <span class="fieldlabel">Optionale Antwort</span>
          <textarea data-k="response" placeholder="Leer lassen, wenn keine Antwort gesendet werden soll">${esc(x.response||"")}</textarea>
        </div>

        <button class="del danger">Löschen</button>
        ${x.twitchSyncError?`<div class="blocked-error">${esc(x.twitchSyncError)}</div>`:""}
      </div>`;
    }).join("")}`;

  bind($("blocked"),settings.blockedWords);
}

function addBlocked(){
  settings.blockedWords ||= [];
  settings.blockedWords.push({
    id:uid(),
    enabled:true,
    word:"",
    action:"delete",
    bot:botDefault("main"),
    response:"",
    twitchTermId:null,
    twitchSyncStatus:null
  });
  mark();
  renderBlocked();
}


async function renderEventProfiles(){
  if(!hasCapability("twitch.eventprofiles.view")){
    $("eventprofiles").innerHTML=`<div class="card error">Für Event-Profile fehlt die entsprechende Berechtigung.</div>`;
    return;
  }

  $("eventprofiles").innerHTML=`
    <div class="title">
      <div>
        <h2>Event-Profile</h2>
        <p class="hint">Speichert für jede Funktion, ob sie an oder aus ist und welcher Bot zuständig ist. Texte, Cooldowns und andere Inhalte bleiben unangetastet.</p>
      </div>
      <button id="eventProfileNewBtn" type="button" title="Den aktuell gespeicherten Stand als neues Profil sichern">+ Neues Profil</button>
    </div>

    <details class="card event-profile-howto">
      <summary>So funktionieren Event-Profile</summary>
      <ol>
        <li>Stelle Commands, Timer, Auto-Replies und Community-Funktionen so ein, wie du sie für einen Einsatz brauchst, und speichere die Änderungen.</li>
        <li>Klicke oben auf <strong>+ Neues Profil</strong> und speichere diesen Zustand z. B. als <strong>Normalbetrieb</strong> oder <strong>Gamescom</strong>.</li>
        <li>Erstelle weitere Profile auf dieselbe Weise. Mit <strong>Aktivieren</strong> wechselst du später mit einem Klick zwischen den gespeicherten Zuständen. Aktivieren legt kein neues Profil an, es lädt ein vorhandenes.</li>
        <li>Mit <strong>⚙ Einstellungen</strong> siehst du bei jedem Profil alle Funktionen und kannst sie dort direkt ein- oder ausschalten, ohne das Profil zu aktivieren.</li>
        <li>Was du speicherst, während ein Profil aktiv ist, merkt sich dieses Profil automatisch. Neu angelegte Commands, Timer oder Auto-Replies sind in den anderen Profilen zunächst aus.</li>
      </ol>
      <p class="hint"><strong>Enthalten:</strong> Commands, Timer, Auto-Replies, Begrüßungen, Follow/Raid, !followage, !watchtime, Team-Timer, Team-Mitglieder, ${esc(gameName())}, Clip-Sharing, Follower-Alert und Moderationsfilter (jeweils an/aus und, wo vorhanden, der zuständige Bot). Texte, Cooldowns und Spielstände bleiben unverändert. Nach jedem Wechsel prüft das Control Center, ob alles korrekt übernommen wurde.</p>
    </details>

    <div id="eventProfileActive" class="card event-profile-active"></div>

    <div id="eventProfileCreate" class="card hidden">
      <h3>Neues Profil aus aktuellem Stand</h3>
      <div class="event-profile-create-grid">
        <div>
          <span class="fieldlabel">Profilname</span>
          <input id="eventProfileName" maxlength="80" placeholder="z. B. Gamescom">
        </div>
        <div>
          <span class="fieldlabel">Beschreibung</span>
          <input id="eventProfileDescription" placeholder="optional">
        </div>
        <div class="event-profile-create-actions">
          <button id="eventProfileCreateSave" type="button">Profil speichern</button>
          <button id="eventProfileCreateCancel" type="button">Abbrechen</button>
        </div>
      </div>
      <p class="hint">Beim Anlegen wird der aktuell gespeicherte Stand übernommen. Ungespeicherte Änderungen im Browser gehören nicht zum Profil.</p>
    </div>

    <div id="eventProfilesList"><div class="card">Lade Event-Profile …</div></div>`;

  $("eventProfileNewBtn")?.addEventListener("click",()=>{
    $("eventProfileCreate")?.classList.remove("hidden");
    $("eventProfileName")?.focus();
  });
  $("eventProfileCreateCancel")?.addEventListener("click",()=>{
    $("eventProfileCreate")?.classList.add("hidden");
    if($("eventProfileName")) $("eventProfileName").value="";
    if($("eventProfileDescription")) $("eventProfileDescription").value="";
  });
  $("eventProfileCreateSave")?.addEventListener("click",createEventProfile);

  await loadEventProfiles();
}

function eventProfileSummary(counts={}){
  const community=[
    counts.follow?"Follow":null,
    counts.raid?"Raid":null,
    counts.followage?"!followage":null,
    counts.watchtime?"!watchtime":null
  ].filter(Boolean);

  return `
    <span>${Number(counts.commands||0)} Commands</span>
    <span>${Number(counts.timers||0)} Timer</span>
    <span>${Number(counts.autoReplies||0)} Auto-Replies</span>
    <span>${Number(counts.greetings||0)} Begrüßungen</span>
    <span>${community.length?esc(community.join(", ")):"Community aus"}</span>
    ${counts.teamTimer!==undefined?`<span>Team-Timer ${counts.teamTimer?"an":"aus"}</span><span>${esc(gameName())} ${counts.stubenkontrolle?"an":"aus"}</span><span>${Number(counts.moderation||0)}/4 Filter</span>`:""}`;
}

// 8.9.8: Ergebnis der Soll/Ist-Prüfung nach Aktivieren oder Speichern anzeigen.
function reportEventProfileMismatches(name,mismatches,verb){
  const list=Array.isArray(mismatches)?mismatches:[];
  if(!list.length){
    showToast(`Profil „${name}“ ${verb}. Alle Einstellungen wurden geprüft und korrekt übernommen.`);
    $("saveState").textContent=`✅ Profil „${name}“ ${verb}`;
    setTimeout(()=>$("saveState").textContent="Keine ungespeicherten Änderungen",2600);
    return;
  }
  const lines=list.slice(0,12).map(m=>`• ${m.group}: ${m.label} (${m.field==="bot"?`Bot soll ${m.expected}, ist ${m.actual}`:`soll ${m.expected?"an":"aus"}, ist ${m.actual?"an":"aus"}`})`).join("\n");
  alert(`Profil „${name}“ ${verb}, aber ${list.length} Einstellung(en) stimmen nicht mit dem Profil überein:\n\n${lines}${list.length>12?`\n… und ${list.length-12} weitere`:""}\n\nBitte prüfe diese Einträge.`);
}

// 8.9.8: Aufklappbare Schalterliste eines Profils.
async function toggleEventProfileSwitches(card,profile){
  const panel=card.querySelector(".event-profile-switches");
  if(!panel) return;
  if(!panel.classList.contains("hidden")){panel.classList.add("hidden");return;}
  panel.classList.remove("hidden");
  panel.innerHTML=`<p class="hint">Lade Einstellungen …</p>`;
  try{
    const r=await fetch(`/api/event-profiles/${encodeURIComponent(profile.id)}/switches`,{cache:"no-store"});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);
    renderEventProfileSwitches(panel,profile,j);
  }catch(e){
    panel.innerHTML=`<p class="error">Einstellungen konnten nicht geladen werden: ${esc(e.message)}</p>`;
  }
}

function renderEventProfileSwitches(panel,profile,data){
  const canEdit=hasCapability("twitch.eventprofiles.edit");
  const bots=data.bots||[];
  const botOptions=v=>bots.map(b=>`<option value="${esc(b)}"${b===v?" selected":""}>${esc(botLabel(b))}</option>`).join("");
  const groupHtml=g=>{
    const on=g.items.filter(x=>x.enabled).length;
    return `<details class="profile-switch-group">
      <summary><strong>${esc(g.group)}</strong> <span class="hint">${on} von ${g.items.length} an</span></summary>
      ${canEdit?`<div class="profile-switch-bulk"><button type="button" class="ghost" data-bulk="on">Alle an</button><button type="button" class="ghost" data-bulk="off">Alle aus</button></div>`:""}
      ${g.items.map(x=>`<div class="profile-switch-row" data-kind="${esc(x.kind)}" data-key="${esc(x.key)}" data-id="${esc(x.id||"")}">
        <label><input type="checkbox" class="profile-switch-enabled"${x.enabled?" checked":""}${canEdit?"":" disabled"}> ${esc(x.label)}</label>
        ${x.hasBot?`<select class="profile-switch-bot"${canEdit?"":" disabled"}>${botOptions(x.bot)}</select>`:"<span></span>"}
      </div>`).join("")}
    </details>`;
  };
  panel.innerHTML=`
    <p class="hint">${data.active?"<strong>Dieses Profil ist aktiv.</strong> Änderungen hier gelten nach dem Speichern sofort.":"Hier legst du fest, was beim Aktivieren dieses Profils an oder aus ist. Das Profil wird dabei nicht aktiviert."}</p>
    ${(data.groups||[]).map(groupHtml).join("")}
    ${canEdit?`<div class="event-profile-edit-actions"><button type="button" class="profile-switch-save">Schalter für „${esc(profile.name)}“ speichern</button></div>`:""}`;
  panel.querySelectorAll(".profile-switch-bulk button").forEach(b=>b.addEventListener("click",()=>{
    b.closest("details").querySelectorAll(".profile-switch-enabled").forEach(c=>c.checked=b.dataset.bulk==="on");
  }));
  panel.querySelector(".profile-switch-save")?.addEventListener("click",()=>saveEventProfileSwitches(panel,profile,data.active));
}

async function saveEventProfileSwitches(panel,profile,active){
  if(active&&dirty){
    alert("Es gibt ungespeicherte Änderungen. Bitte zuerst speichern oder verwerfen, weil dieses Profil aktiv ist.");
    return;
  }
  const changes=[...panel.querySelectorAll(".profile-switch-row")].map(row=>({
    kind:row.dataset.kind,key:row.dataset.key,id:row.dataset.id||undefined,
    enabled:row.querySelector(".profile-switch-enabled")?.checked===true,
    bot:row.querySelector(".profile-switch-bot")?.value||undefined
  }));
  try{
    const r=await fetch(`/api/event-profiles/${encodeURIComponent(profile.id)}/switches`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({changes})});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);
    if(j.active&&j.settings){settings=j.settings;dirty=false;renderAll();renderDashboardSummary();applyPermissions();}
    await loadEventProfiles();
    reportEventProfileMismatches(profile.name,j.mismatches,j.active?"gespeichert und sofort angewendet":"gespeichert");
  }catch(e){
    alert(`Schalter konnten nicht gespeichert werden: ${e.message}`);
  }
}

async function loadEventProfiles(){
  const list=$("eventProfilesList");
  if(!list) return;

  try{
    const r=await fetch("/api/event-profiles",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);

    const active=(data.profiles||[]).find(p=>p.active);
    $("eventProfileActive").innerHTML=active
      ? `<div>
          <span class="fieldlabel">Aktives Profil</span>
          <strong>${esc(active.name)}</strong>
          ${active.description?`<span class="event-profile-description">${esc(active.description)}</span>`:""}
        </div>
        <span class="profile-active-badge">AKTIV</span>`
      : `<div><span class="fieldlabel">Aktives Profil</span><strong>Kein Profil aktiviert</strong><span class="event-profile-description">Die aktuelle Konfiguration wird direkt verwendet.</span></div>`;

    const profiles=data.profiles||[];
    if(!profiles.length){
      list.innerHTML=`<div class="card">Noch keine Event-Profile vorhanden. Speichere zum Beispiel deinen normalen Twitch-Betrieb zuerst als Profil.</div>`;
      return;
    }

    list.innerHTML=profiles.map(p=>`
      <div class="card event-profile-card ${p.active?"event-profile-is-active":""}" data-profile-id="${esc(p.id)}">
        <div class="event-profile-main">
          <div>
            <div class="event-profile-name-row">
              <strong>${esc(p.name)}</strong>
              ${p.active?'<span class="profile-active-badge">AKTIV</span>':""}
            </div>
            ${p.description?`<p>${esc(p.description)}</p>`:""}
            <div class="event-profile-summary">${eventProfileSummary(p.counts)}</div>
            <div class="event-profile-meta">Zuletzt aktualisiert: ${fmtDiagDate(p.updatedAt)}${p.updatedBy?` · ${esc(p.updatedBy)}`:""}</div>
          </div>

          <div class="event-profile-actions">
            <button class="profile-apply" type="button" ${p.active?"disabled":""} title="${p.active?"Dieses Profil ist bereits aktiv":"Gespeicherte Einstellungen dieses Profils übernehmen (legt kein neues Profil an)"}">${p.active?"Aktiv":"Aktivieren"}</button>
            <button class="profile-switches-toggle" type="button" title="Alle Funktionen dieses Profils ein- oder ausschalten">⚙ Einstellungen</button>
            <button class="profile-edit" type="button" title="Name und Beschreibung bearbeiten">✎</button>
            <button class="profile-delete danger" type="button" title="Löschen">🗑</button>
          </div>
        </div>

        <div class="event-profile-switches hidden"></div>

        <div class="event-profile-edit-panel hidden">
          <div class="event-profile-edit-grid">
            <div>
              <span class="fieldlabel">Profilname</span>
              <input class="profile-name-input" maxlength="80" value="${esc(p.name)}">
            </div>
            <div>
              <span class="fieldlabel">Beschreibung</span>
              <input class="profile-description-input" value="${esc(p.description||"")}">
            </div>
          </div>

          <div class="event-profile-edit-actions">
            <button class="profile-meta-save" type="button">Name / Beschreibung speichern</button>
            <button class="profile-capture" type="button">Profil mit aktuellem Stand aktualisieren</button>
          </div>
          <p class="hint">„Profil mit aktuellem Stand aktualisieren“ ersetzt den gespeicherten Aktiv-/Bot-Zustand dieses Profils durch die derzeit gespeicherte Konfiguration.</p>
        </div>
      </div>`).join("");

    list.querySelectorAll(".event-profile-card").forEach(card=>{
      const id=card.dataset.profileId;
      const profile=profiles.find(p=>String(p.id)===String(id));
      if(!profile) return;

      card.querySelector(".profile-edit")?.addEventListener("click",()=>{
        const panel=card.querySelector(".event-profile-edit-panel");
        const opening=panel.classList.contains("hidden");
        list.querySelectorAll(".event-profile-edit-panel").forEach(x=>x.classList.add("hidden"));
        if(opening) panel.classList.remove("hidden");
      });

      card.querySelector(".profile-apply")?.addEventListener("click",()=>applyEventProfile(profile));
      card.querySelector(".profile-switches-toggle")?.addEventListener("click",()=>toggleEventProfileSwitches(card,profile));
      card.querySelector(".profile-delete")?.addEventListener("click",()=>deleteEventProfile(profile));
      card.querySelector(".profile-meta-save")?.addEventListener("click",()=>updateEventProfile(card,profile,false));
      card.querySelector(".profile-capture")?.addEventListener("click",()=>updateEventProfile(card,profile,true));
    });
  }catch(e){
    list.innerHTML=`<div class="card error">Event-Profile konnten nicht geladen werden: ${esc(e.message)}</div>`;
  }
}

async function createEventProfile(){
  if(dirty){
    alert("Bitte speichere zuerst deine aktuellen Änderungen. Event-Profile übernehmen nur den auf dem Server gespeicherten Stand.");
    return;
  }

  const name=$("eventProfileName")?.value.trim()||"";
  const description=$("eventProfileDescription")?.value.trim()||"";
  if(!name){
    alert("Bitte einen Profilnamen eingeben.");
    return;
  }

  try{
    const r=await fetch("/api/event-profiles",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name,description})
    });
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);

    $("eventProfileCreate")?.classList.add("hidden");
    if($("eventProfileName")) $("eventProfileName").value="";
    if($("eventProfileDescription")) $("eventProfileDescription").value="";
    await loadEventProfiles();
  }catch(e){
    alert(`Profil konnte nicht erstellt werden: ${e.message}`);
  }
}

async function applyEventProfile(profile){
  if(dirty){
    alert("Es gibt ungespeicherte Änderungen. Bitte zuerst speichern oder verwerfen, bevor du ein Profil aktivierst.");
    return;
  }

  const ok=await askAs("activate",`Profil „${profile.name}“ jetzt aktivieren? Alle Schalter dieses Profils werden übernommen: Commands, Timer, Auto-Replies, Begrüßungen, Follow/Raid, !followage, !watchtime, Team-Timer und Team-Mitglieder, ${gameName()}, Clip-Sharing, Follower-Alert und Moderationsfilter. Texte und Cooldowns bleiben gleich. Ein neues Profil legst du mit „+ Neues Profil“ an.`);
  if(!ok) return;

  try{
    const r=await fetch(`/api/event-profiles/${encodeURIComponent(profile.id)}/apply`,{
      method:"POST",
      headers:{"Content-Type":"application/json"}
    });
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);

    settings=j.settings;
    dirty=false;
    renderAll();
    renderDashboardSummary();
    applyPermissions();
    await loadEventProfiles();
    reportEventProfileMismatches(profile.name,j.mismatches,"aktiviert");
  }catch(e){
    alert(`Profil konnte nicht aktiviert werden: ${e.message}`);
  }
}

async function updateEventProfile(card,profile,captureCurrent){
  if(captureCurrent && dirty){
    alert("Bitte speichere zuerst deine aktuellen Änderungen. Es kann nur der gespeicherte Stand ins Profil übernommen werden.");
    return;
  }

  const name=card.querySelector(".profile-name-input")?.value.trim()||profile.name;
  const description=card.querySelector(".profile-description-input")?.value.trim()||"";

  if(captureCurrent){
    const ok=await askAs("apply",`Profil „${profile.name}“ mit dem aktuell gespeicherten Stand aktualisieren? Der bisherige Inhalt dieses Profils (welche Funktionen an sind und welcher Bot zuständig ist) wird überschrieben. Änderungen, die du noch nicht gespeichert hast, sind nicht enthalten.`);
    if(!ok) return;
  }

  try{
    const r=await fetch(`/api/event-profiles/${encodeURIComponent(profile.id)}`,{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name,description,captureCurrent})
    });
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);
    await loadEventProfiles();
  }catch(e){
    alert(`Profil konnte nicht aktualisiert werden: ${e.message}`);
  }
}

async function deleteEventProfile(profile){
  const ok=await askDelete(`Event-Profil „${profile.name}“ wirklich löschen?`);
  if(!ok) return;

  try{
    const r=await fetch(`/api/event-profiles/${encodeURIComponent(profile.id)}`,{method:"DELETE"});
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);
    await loadEventProfiles();
  }catch(e){
    alert(`Profil konnte nicht gelöscht werden: ${e.message}`);
  }
}

function formatStatDate(value){
  if(!value) return "–";
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleString("de-DE");
}

function statNumber(value){
  return Number(value||0).toLocaleString("de-DE");
}

async function renderStatistics(){
  const platform=currentPlatform;
  $("statistics").innerHTML=`<div class="title"><div><h2>${platform==="discord"?"Discord":"Twitch"} · Statistiken</h2><p class="hint">${platform==="discord"?"Serverentwicklung, Moderation und geteilte Inhalte.":"Auslösungen von Commands und Auto-Replies."}</p></div><button id="statsRefreshBtn" type="button">Aktualisieren</button></div><div id="statsPlatformContent"></div>`;
  let twitchMode="commands";
  const loadTwitch=async()=>{
    try{
      const r=await fetch("/api/usage-stats",{cache:"no-store"}),data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
      const draw=()=>{
        const items=[...(twitchMode==="commands"?data.commands:data.autoReplies)].sort((a,b)=>Number(b.stats?.total||0)-Number(a.stats?.total||0)),label=twitchMode==="commands"?"Command":"Auto-Reply";
        $("statsPlatformContent").innerHTML=`<div class="stats-summary-grid"><div class="card stats-summary"><span>Heute</span><strong>${statNumber(data.summary?.today)}</strong><small>Auslösungen</small></div><div class="card stats-summary"><span>Aktueller Stream</span><strong>${statNumber(data.summary?.currentStream)}</strong><small>${data.currentStream?.live?"Stream läuft":"derzeit offline"}</small></div><div class="card stats-summary"><span>Gesamt</span><strong>${statNumber(data.summary?.total)}</strong><small>seit früheren Versionen</small></div></div><div class="activity-tabs sub-tabs"><button id="statsCommandsTab" class="activity-tab ${twitchMode==="commands"?"active":""}">Commands</button><button id="statsAutoTab" class="activity-tab ${twitchMode==="autoReplies"?"active":""}">Auto-Replies</button></div><div class="stats-table"><div class="stats-head"><div>#</div><div>${label}</div><div>Heute</div><div>Aktueller Stream</div><div>Gesamt</div><div>Letzte Auslösung</div></div>${items.length?items.map((x,i)=>`<div class="stats-row ${x.enabled?"":"is-disabled"}"><div class="stats-rank">${i+1}</div><div><strong>${esc(x.name||label)}</strong><span class="stats-sub">${esc(botLabel(x.bot))}</span></div><div><strong>${statNumber(x.stats?.today)}</strong></div><div><strong>${statNumber(x.stats?.currentStream)}</strong></div><div><strong>${statNumber(x.stats?.total)}</strong></div><div>${formatStatDate(x.stats?.lastTriggeredAt)}${x.stats?.lastUser?`<span class="stats-sub">von @${esc(x.stats.lastUser)}</span>`:""}</div></div>`).join(""):`<div class="card">Noch keine Einträge.</div>`}</div>`;
        $("statsCommandsTab").onclick=()=>{twitchMode="commands";draw();};$("statsAutoTab").onclick=()=>{twitchMode="autoReplies";draw();};
      };draw();
    }catch(e){$("statsPlatformContent").innerHTML=`<div class="card error">Twitch-Statistiken konnten nicht geladen werden: ${esc(e.message)}</div>`;}
  };
  const loadDiscord=async()=>{
    try{
      const r=await fetch("/api/discord-analytics",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
      const period=(title,x)=>`<div class="card stats-summary discord-period"><span>${title}</span><strong>${x.members===null||x.members===undefined?"—":Number(x.members).toLocaleString("de-DE")} Mitglieder</strong><small>${x.memberDelta===null||x.memberDelta===undefined?"":`Δ ${x.memberDelta>=0?"+":""}${x.memberDelta} · `}${Number(x.violations||0)} Verstöße · ${Number(x.shared||0)} geteilt</small></div>`;
      $("statsPlatformContent").innerHTML=`<div class="stats-summary-grid">${period("Letzte 7 Tage",d.summary?.days7||{})}${period("Letzte 30 Tage",d.summary?.days30||{})}${period("Insgesamt",d.summary?.all||{})}</div><p class="hint">${esc(d.note||"")}</p><div class="discord-stats-table"><div class="discord-stats-row head"><div>Datum</div><div>Mitglieder</div><div>Verstöße</div><div>Geteilt</div></div>${(d.rows||[]).length?(d.rows||[]).map(x=>{const raw=String(x.date||"");const parsed=/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(raw+"T12:00:00"):new Date(raw);const label=Number.isFinite(parsed.getTime())?parsed.toLocaleDateString("de-DE"):"–";return `<div class="discord-stats-row"><div>${esc(label)}</div><div>${x.memberCount===null?"—":Number(x.memberCount).toLocaleString("de-DE")}</div><div>${Number(x.violations||0)}</div><div>${Number(x.shared||0)}</div></div>`;}).join(""):`<div class="card">Noch keine Discord-Statistikdaten vorhanden.</div>`}</div>`;
    }catch(e){$("statsPlatformContent").innerHTML=`<div class="card error">Discord-Statistiken konnten nicht geladen werden: ${esc(e.message)}</div>`;}
  };
  $("statsRefreshBtn").onclick=()=>platform==="discord"?loadDiscord():loadTwitch();
  await(platform==="discord"?loadDiscord():loadTwitch());
}

function autoReplyTriggers(x){
  if(Array.isArray(x.triggers)) return x.triggers.filter(Boolean);
  return String(x.trigger||"").split(/[\n,]+/).map(v=>v.trim()).filter(Boolean);
}

function renderAuto(){
  settings.autoReplies ||= [];

  $("autoreplies").innerHTML=`
    <div class="title">
      <div>
        <h2>Auto-Replies</h2>
        <p class="hint">Schlanke Übersicht. Details und Auslöser öffnest du über den Stift.</p>
      </div>
      <button data-click="addAuto">+ Auto-Reply</button>
    </div>

    <div class="compact-table">
      <div class="compact-head auto-head">
        <div>Name</div><div>Auslöser</div><div>Bot</div><div>Cooldown</div><div>Aktionen</div>
      </div>
      <div id="autoRows">
        ${settings.autoReplies.map(x=>{
          const triggers=autoReplyTriggers(x);
          const name=x.name||triggers[0]||"Auto-Reply";
          return `<div class="auto-row" data-id="${x.id}">
            <div class="auto-summary">
              <div><strong>${esc(name)}</strong>${x.enabled?"":'<span class="status-off">AUS</span>'}</div>
              <div>${esc(triggers.slice(0,3).join(", ") || "–")}${triggers.length>3?` +${triggers.length-3}`:""}</div>
              <div>${esc(botLabel(x.bot))}</div>
              <div>${Number(x.cooldownSeconds||0)} Sek.</div>
              <div class="actions"><button class="edit-auto" title="Bearbeiten">✎</button><button class="del danger" title="Löschen">🗑</button></div>
            </div>
            <div class="auto-details hidden">
              <div class="auto-detail-grid">
                <label class="compact"><input type="checkbox" data-k="enabled" ${x.enabled?"checked":""}> Aktiv</label>
                <div><span class="fieldlabel">Name</span><input data-k="name" value="${esc(x.name||"")}" placeholder="z. B. Onkel P"></div>
                <div><span class="fieldlabel">Abgleich</span><select data-k="match"><option value="contains" ${x.match==="contains"?"selected":""}>enthält</option><option value="exact" ${x.match==="exact"?"selected":""}>exakt</option></select></div>
                <div><span class="fieldlabel">Antwortender Bot</span>${botSel(x.bot)}</div>
                <div><span class="fieldlabel">Cooldown</span><div class="input-suffix"><input data-k="cooldownSeconds" type="number" min="0" value="${Number(x.cooldownSeconds||0)}"><span>Sek.</span></div></div>
                <div class="wide"><span class="fieldlabel">Auslöser / Werte</span><textarea data-k="triggersText" placeholder="Ein Wert pro Zeile oder mit Komma trennen">${esc(triggers.join("\n"))}</textarea><p class="hint">Mehrere Werte möglich. Jeder davon löst dieselbe Antwort aus.</p></div>
                <div class="wide"><span class="fieldlabel">Antwort</span><textarea data-k="response">${esc(x.response||"")}</textarea></div>
              </div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;

  $("autoreplies").querySelectorAll(".auto-row").forEach(row=>{
    const x=settings.autoReplies.find(a=>String(a.id)===String(row.dataset.id));
    if(!x) return;

    row.querySelector(".edit-auto")?.addEventListener("click",()=>{
      const details=row.querySelector(".auto-details");
      const opening=details?.classList.contains("hidden");
      $("autoreplies").querySelectorAll(".auto-details").forEach(d=>d.classList.add("hidden"));
      if(opening) details?.classList.remove("hidden");
    });

    row.querySelectorAll("[data-k]").forEach(el=>{
      const sync=()=>{
        const k=el.dataset.k;
        if(k==="triggersText"){
          x.triggers=el.value.split(/[\n,]+/).map(v=>v.trim()).filter(Boolean);
          x.trigger=x.triggers[0]||"";
        }else{
          x[k]=el.type==="checkbox"?el.checked:(el.type==="number"?Number(el.value):el.value);
        }
        mark();
      };
      el.addEventListener("input",sync);
      el.addEventListener("change",sync);
    });

    row.querySelector(".del")?.addEventListener("click",async()=>{
      if(!(await askDelete("Auto-Reply wirklich löschen?"))) return;
      settings.autoReplies=settings.autoReplies.filter(a=>String(a.id)!==String(x.id));
      mark(); renderAuto(); renderDashboardSummary();
    });
  });
}

function addAuto(){
  settings.autoReplies ||= [];
  const item={
    id:uid(),enabled:true,name:"",trigger:"",triggers:[],match:"contains",
    bot:botDefault("main"),cooldownSeconds:30,response:""
  };
  settings.autoReplies.push(item);
  mark();
  renderAuto();
  setTimeout(()=>{
    const row=document.querySelector(`#autoreplies [data-id="${CSS.escape(item.id)}"]`);
    row?.querySelector(".edit-auto")?.click();
    row?.querySelector('[data-k="name"]')?.focus();
  },30);
}




function formatFollowDate(value){
  if(!value) return "–";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"});
}


async function renderChatLeaderboard(){
  const root=$("chatters");
  if(!hasCapability("twitch.followage.view")){root.innerHTML='<div class="card error">Berechtigung fehlt.</div>';return;}
  root.innerHTML=`<div class="title"><div><h2>Top-Chatters</h2><p class="hint">Alle erfassten Twitch-Chatnutzer – auch Nicht-Follower. Die Zählung umfasst ausschließlich Nachrichten, die der Bot empfangen hat.</p></div></div>
    <div class="followage-toolbar"><label>Zeitraum <select id="chattersWindow"><option value="30">Letzte 30 Tage</option><option value="0">Gesamt</option></select></label><button id="chattersRefresh" type="button">Aktualisieren</button></div>
    <p id="chattersSummary" class="hint"></p><div class="followage-table chatters-table"><div class="followage-head"><div>#</div><div>Nutzer</div><div>Nachrichten</div><div>Follower</div></div><div id="chattersRows">Lade …</div></div>`;
  const load=async()=>{
    $("chattersRows").textContent="Lade …";
    try{
      const response=await fetch(`/api/twitch/chat-leaderboard?days=${$("chattersWindow").value}`,{cache:"no-store"});
      const r=await response.json();if(!response.ok)throw Error(r.error||`HTTP ${response.status}`);
      $("chattersSummary").textContent=`${Number(r.messages||0).toLocaleString("de-DE")} Nachrichten von ${Number(r.users||0).toLocaleString("de-DE")} Nutzern${r.trackingStartedAt?` · Erfassung seit ${new Date(r.trackingStartedAt).toLocaleDateString("de-DE")}`:""}. Tageswerte werden erst ab Version 8.5.0 erfasst.`;
      $("chattersRows").innerHTML=(r.rows||[]).map((x,i)=>`<div class="followage-row"><div class="followage-rank">${i+1}</div><div><strong>${esc(x.name||x.login||x.userId)}</strong><small class="followage-login">@${esc(x.login||"")}</small></div><div><strong>${Number(x.messages||0).toLocaleString("de-DE")}</strong></div><div>${x.follower?"Ja":"Nein"}</div></div>`).join("")||'<div class="card">Noch keine Nachrichten für diesen Zeitraum erfasst.</div>';
    }catch(e){$("chattersRows").textContent=`Fehler: ${e.message}`;}
  };
  $("chattersWindow").addEventListener("change",load);
  $("chattersRefresh").addEventListener("click",load);
  await load();
}

async function renderFollowageList(){
  if(!hasCapability("twitch.followage.view")){
    $("followage").innerHTML=`<div class="card error">Für die Followage-Liste fehlt die Berechtigung Followage.</div>`;
    return;
  }

  $("followage").innerHTML=`
    <div class="title">
      <div>
        <h2>Followage</h2>
        <p class="hint">Follower-Liste direkt aus Twitch. Für die Sortierung wird die komplette Follower-Liste lokal zwischengespeichert und anschließend serverseitig sortiert.</p>
      </div>
      <button id="followageRefreshBtn" type="button">Twitch-Daten aktualisieren</button>
    </div>

    <div id="followageSummary" class="followage-summary-grid"></div>

    <div class="followage-toolbar followage-toolbar-sort">
      <input id="followageSearch" type="search" placeholder="Twitch-Login exakt suchen …">
      <button id="followageSearchBtn" type="button">Suchen</button>
      <select id="followageSort" title="Sortierung">
        <option value="newest">Followage ↑ · neu → alt</option>
        <option value="oldest">Followage ↓ · alt → neu</option>
        <option value="az">Name A → Z</option>
        <option value="za">Name Z → A</option>
        <option value="messages_desc">Chatnachrichten ↓ · viele → wenige</option>
        <option value="messages_asc">Chatnachrichten ↑ · wenige → viele</option>
      </select>
      <button id="followageClearBtn" type="button" class="hidden">Suche löschen</button>
    </div>

    <p class="hint">Vorhandene Follower werden sofort aus PostgreSQL angezeigt. Ist der Stand älter als 15 Minuten, aktualisiert der Bot die Twitch-Daten automatisch im Hintergrund. Nur „Twitch-Daten aktualisieren“ wartet bewusst auf einen vollständigen Abruf.</p>
    <p id="messageCountHint" class="hint"></p>

    <div class="followage-table">
      <div class="followage-head">
        <div>#</div><div>Nutzer</div><div>Folgt seit</div><div>Followage</div><div>Chatnachrichten</div>
      </div>
      <div id="followageRows"><div class="card">Lade Follower …</div></div>
    </div>

    <div id="followagePager" class="activity-pager"></div>`;

  let page=1;
  let search="";
  let sort="newest";

  const load=async({reset=false,refresh=false}={})=>{
    if(reset) page=1;

    const rows=$("followageRows");
    rows.innerHTML=`<div class="card">${refresh?"Aktualisiere Follower direkt von Twitch …":"Lade Follower …"}</div>`;

    const q=new URLSearchParams();
    if(search){
      q.set("login",search);
    }else{
      q.set("page",String(page));
      q.set("sort",sort);
      if(refresh) q.set("refresh","1");
    }

    try{
      const r=await fetch(`/api/followers?${q.toString()}`,{cache:"no-store"});
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);

      if(!search) page=Number(data.page||page||1);

      const total=data.total;
      const items=data.data||[];

      const latestFollow = !search && Array.isArray(data.latestFollow)
        ? data.latestFollow[0]
        : (!search && data.latestFollow ? data.latestFollow : null);

      $("followageSummary").innerHTML=`
        <div class="card followage-summary">
          <span>Follower gesamt</span>
          <strong>${total===null?"–":Number(total).toLocaleString("de-DE")}</strong>
        </div>
        <div class="card followage-summary followage-latest-card">
          <span>${search?"Gesucht":"Letzter Follow"}</span>
          <strong>${search
            ? (items[0]?esc(items[0].name||items[0].login):"–")
            : (latestFollow?esc(latestFollow.name||latestFollow.login||latestFollow.userId):"–")}</strong>
          <small>${search
            ? (items[0]?`${formatFollowDate(items[0].followedAt)} · ${esc(items[0].followage||"")}`:"")
            : (latestFollow?`${formatFollowDate(latestFollow.followedAt)} · ${esc(latestFollow.followage||"")}`:"")}</small>
        </div>
        <div class="card followage-summary">
          <span>Sortierung</span>
          <strong>${esc(({
            newest:"Followage ↑",
            oldest:"Followage ↓",
            az:"A → Z",
            za:"Z → A",
            messages_desc:"Chatnachrichten ↓",
            messages_asc:"Chatnachrichten ↑"
          })[sort]||sort)}</strong>
          <small>${!search && data.cacheUpdatedAt ? `Stand: ${fmtDiagDate(data.cacheUpdatedAt)}${data.cacheRefreshing ? " · Twitch-Aktualisierung läuft im Hintergrund" : (data.cacheStale ? " · Aktualisierung ausstehend" : "")}` : ""}</small>
        </div>`;

      const tracking=data.messageTrackingStartedAt;
      $("messageCountHint").textContent=tracking?`Erfasst seit ${new Date(tracking).toLocaleDateString("de-DE")}. Gezählt werden Nachrichten, die der Bot empfängt; bei Verbindungsunterbrechungen können Nachrichten fehlen.`:"Nachrichtenzähler wird ab Aktivierung aufgebaut.";

      if(!items.length){
        rows.innerHTML=search
          ? `<div class="card">Der Nutzer folgt dem Kanal aktuell nicht oder der Twitch-Login wurde nicht gefunden.</div>`
          : `<div class="card">Keine Follower gefunden.</div>`;
      }else{
        const rankOffset=(page-1)*100;
        rows.innerHTML=items.map((x,index)=>`
          <div class="followage-row">
            <div class="followage-rank">${search?"–":rankOffset+index+1}</div>
            <div>
              <strong>${esc(x.name||x.login||x.userId)}</strong>
              <span class="followage-login">@${esc(x.login||"")} · ${esc(x.userId||"")}</span>
            </div>
            <div>${formatFollowDate(x.followedAt)}</div>
            <div><strong>${esc(x.followage||"–")}</strong></div>
            <div><strong>${Number(x.messageCount||0).toLocaleString("de-DE")}</strong></div>
          </div>`).join("");
      }

      const pager=$("followagePager");
      if(search){
        pager.innerHTML="";
      }else{
        const totalPages=Number(data.totalPages||1);
        const from=total?((page-1)*100+1):0;
        const to=Math.min(Number(total||0),page*100);

        pager.innerHTML=`
          <button id="followagePrev" type="button" ${page<=1?"disabled":""}>← Zurück</button>
          <span>Seite <strong>${page}</strong> von <strong>${totalPages}</strong>${total!==null?` · ${from}–${to} von ${Number(total).toLocaleString("de-DE")}`:""}</span>
          <button id="followageNext" type="button" ${page>=totalPages?"disabled":""}>Weiter →</button>`;

        $("followagePrev")?.addEventListener("click",()=>{page=Math.max(1,page-1);load();});
        $("followageNext")?.addEventListener("click",()=>{page=Math.min(totalPages,page+1);load();});
      }
    }catch(e){
      rows.innerHTML=`<div class="card error">Followage-Liste konnte nicht geladen werden: ${esc(e.message)}</div>`;
    }
  };

  const runSearch=()=>{
    search=$("followageSearch")?.value.trim().toLowerCase()||"";
    $("followageClearBtn")?.classList.toggle("hidden",!search);
    $("followageSort").disabled=!!search;
    load({reset:true});
  };

  $("followageSearchBtn")?.addEventListener("click",runSearch);
  $("followageSearch")?.addEventListener("keydown",e=>{
    if(e.key==="Enter") runSearch();
  });
  $("followageClearBtn")?.addEventListener("click",()=>{
    search="";
    if($("followageSearch")) $("followageSearch").value="";
    $("followageClearBtn")?.classList.add("hidden");
    $("followageSort").disabled=false;
    load({reset:true});
  });
  $("followageSort")?.addEventListener("change",e=>{
    sort=e.target.value;
    page=1;
    load({reset:true});
  });
  $("followageRefreshBtn")?.addEventListener("click",()=>{
    if(search){
      runSearch();
      return;
    }
    load({reset:true,refresh:true});
  });

  await load({reset:true});
}


function formatWatchtimeLong(totalSeconds){
  let s=Math.max(0,Math.floor(Number(totalSeconds||0)));
  const days=Math.floor(s/86400); s%=86400;
  const hours=Math.floor(s/3600); s%=3600;
  const minutes=Math.floor(s/60);
  const parts=[];
  if(days) parts.push(`${days} T`);
  if(hours || days) parts.push(`${hours} Std`);
  parts.push(`${minutes} Min`);
  return parts.join(" ");
}

function watchtimeHoursMinutes(seconds){
  const total=Math.max(0,Math.floor(Number(seconds||0)));
  return {
    hours:Math.floor(total/3600),
    minutes:Math.floor((total%3600)/60)
  };
}

async function renderWatchtime(){
  if(!hasCapability("twitch.watchtime.view")){
    $("watchtime").innerHTML=`<div class="card error">Für die Watchtime-Verwaltung fehlt die entsprechende Berechtigung.</div>`;
    return;
  }

  $("watchtime").innerHTML=`
    <div class="title">
      <div>
        <h2>Watchtime</h2>
        <p class="hint">Lokale Watchtime-Verwaltung. Standardmäßig nach höchster Watchtime sortiert, maximal 100 Einträge pro Seite.</p>
      </div>
      <button id="watchtimeRefreshBtn" type="button">Aktualisieren</button>
    </div>

    <div id="watchtimeSummary" class="watch-summary-grid"></div>

    <div class="watch-toolbar">
      <input id="watchtimeSearch" type="search" placeholder="Twitch-Name, Login oder User-ID suchen …">
      <select id="watchtimeSort">
        <option value="desc">Watchtime ↓</option>
        <option value="asc">Watchtime ↑</option>
        <option value="name">Name A → Z</option>
        <option value="recent">Zuletzt gesehen</option>
      </select>
    </div>

    <div class="watch-table">
      <div class="watch-head">
        <div>#</div><div>Nutzer</div><div>Watchtime</div><div>Zuletzt gesehen</div><div>Aktion</div>
      </div>
      <div id="watchtimeRows"><div class="card">Lade Watchtime …</div></div>
    </div>

    <div id="watchtimePager" class="activity-pager"></div>`;

  let page=1;
  let search="";
  let sort="desc";
  let searchTimer=null;

  const load=async()=>{
    const rows=$("watchtimeRows");
    if(rows) rows.innerHTML=`<div class="card">Lade Watchtime …</div>`;

    const q=new URLSearchParams({
      page:String(page),
      pageSize:"100",
      search,
      sort
    });

    try{
      const r=await fetch(`/api/watchtime?${q.toString()}`,{cache:"no-store"});
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);
      page=data.page||1;

      $("watchtimeSummary").innerHTML=`
        <div class="card watch-summary"><span>Erfasste Nutzer</span><strong>${Number(data.summary?.users||0).toLocaleString("de-DE")}</strong></div>
        <div class="card watch-summary"><span>Gesamte Watchtime</span><strong>${esc(formatWatchtimeLong(data.summary?.totalSeconds||0))}</strong></div>
        <div class="card watch-summary"><span>Letzte Aktualisierung</span><strong>${fmtDiagDate(data.summary?.updatedAt)}</strong></div>`;

      if(!(data.items||[]).length){
        rows.innerHTML=`<div class="card">Keine passenden Watchtime-Daten gefunden.</div>`;
      }else{
        const offset=(data.page-1)*data.pageSize;
        rows.innerHTML=data.items.map((x,index)=>{
          const hm=watchtimeHoursMinutes(x.seconds);
          return `<div class="watch-row" data-user-id="${esc(x.userId)}">
            <div class="watch-rank">${offset+index+1}</div>
            <div>
              <strong>${esc(x.name||x.login||x.userId)}</strong>
              <span class="watch-login">${x.login?`@${esc(x.login)}`:""}${x.userId?` · ${esc(x.userId)}`:""}</span>
            </div>
            <div><strong>${esc(formatWatchtimeLong(x.seconds))}</strong></div>
            <div>${fmtDiagDate(x.lastSeenAt)}</div>
            <div class="watch-actions"><button class="watch-edit" type="button" title="Watchtime korrigieren">✎</button></div>
            <div class="watch-edit-panel hidden">
              <div class="watch-edit-grid">
                <div>
                  <span class="fieldlabel">Gesamtstunden</span>
                  <input class="watch-hours" type="number" min="0" step="1" value="${hm.hours}">
                </div>
                <div>
                  <span class="fieldlabel">Minuten</span>
                  <input class="watch-minutes" type="number" min="0" max="59" step="1" value="${hm.minutes}">
                </div>
                <div class="watch-edit-buttons">
                  <button class="watch-save" type="button">Korrektur speichern</button>
                  <button class="watch-reset danger" type="button">Auf 0 setzen</button>
                </div>
              </div>
              <p class="hint">Die Korrektur wird im Activity Board protokolliert. Der Watchtime-Tracker zählt danach ab diesem Wert normal weiter.</p>
            </div>
          </div>`;
        }).join("");

        rows.querySelectorAll(".watch-row").forEach(row=>{
          const userId=row.dataset.userId;
          row.querySelector(".watch-edit")?.addEventListener("click",()=>{
            const panel=row.querySelector(".watch-edit-panel");
            const opening=panel?.classList.contains("hidden");
            rows.querySelectorAll(".watch-edit-panel").forEach(x=>x.classList.add("hidden"));
            if(opening) panel?.classList.remove("hidden");
          });

          row.querySelector(".watch-save")?.addEventListener("click",async()=>{
            const hours=Math.max(0,Number(row.querySelector(".watch-hours")?.value||0));
            const minutes=Math.min(59,Math.max(0,Number(row.querySelector(".watch-minutes")?.value||0)));
            const seconds=Math.floor(hours*3600+minutes*60);

            const r=await fetch(`/api/watchtime/${encodeURIComponent(userId)}`,{
              method:"PUT",
              headers:{"Content-Type":"application/json"},
              body:JSON.stringify({seconds})
            });
            const j=await r.json();
            if(!r.ok){ alert(j.error||"Watchtime konnte nicht gespeichert werden."); return; }
            await load();
          });

          row.querySelector(".watch-reset")?.addEventListener("click",async()=>{
            const name=row.querySelector("strong")?.textContent||"diesen Nutzer";
            if(!(await askAs("reset",`Watchtime von „${name}“ wirklich auf 0 setzen?`))) return;
            const r=await fetch(`/api/watchtime/${encodeURIComponent(userId)}`,{method:"DELETE"});
            const j=await r.json();
            if(!r.ok){ alert(j.error||"Watchtime konnte nicht zurückgesetzt werden."); return; }
            await load();
          });
        });
      }

      const pager=$("watchtimePager");
      const from=data.total?((data.page-1)*data.pageSize+1):0;
      const to=Math.min(data.total,data.page*data.pageSize);
      pager.innerHTML=`
        <button id="watchPrev" type="button" ${data.page<=1?"disabled":""}>← Zurück</button>
        <span>Seite <strong>${data.page}</strong> von <strong>${data.totalPages}</strong> · ${from}–${to} von ${data.total} Einträgen</span>
        <button id="watchNext" type="button" ${data.page>=data.totalPages?"disabled":""}>Weiter →</button>`;

      $("watchPrev")?.addEventListener("click",()=>{page=Math.max(1,page-1);load();});
      $("watchNext")?.addEventListener("click",()=>{page=Math.min(data.totalPages,page+1);load();});
    }catch(e){
      rows.innerHTML=`<div class="card error">Watchtime konnte nicht geladen werden: ${esc(e.message)}</div>`;
    }
  };

  $("watchtimeRefreshBtn")?.addEventListener("click",()=>load());
  $("watchtimeSort")?.addEventListener("change",e=>{sort=e.target.value;page=1;load();});
  $("watchtimeSearch")?.addEventListener("input",e=>{
    search=e.target.value.trim();
    page=1;
    clearTimeout(searchTimer);
    searchTimer=setTimeout(load,300);
  });

  await load();
}

async function renderActivity(){
  const platform=currentPlatform;
  $("activity").innerHTML=`<div class="title"><div><h2>${platform==="discord"?"Discord":"Twitch"} · Activity Board</h2><p class="hint">Änderungen und Aktionen der gewählten Plattform. Login-Ereignisse bleiben unter Administration → Login-Protokoll.</p></div><button id="activityRefreshBtn" type="button">Aktualisieren</button></div><div class="activity-filters"><select id="activityUserFilter"><option value="">Alle Benutzer</option></select><select id="activitySectionFilter"><option value="">Alle Bereiche</option></select><select id="activityActionFilter"><option value="">Alle Aktionen</option></select></div><p class="hint">Maximal 100 Änderungen pro Seite.</p><div id="activityList">Lade …</div><div id="activityPager" class="activity-pager"></div>`;
  let page=1;
  const sectionNames={commands:"Commands",timers:"Timer",greetings:"Begrüßungen",blockedWords:"Verbotene Wörter",autoReplies:"Auto-Replies",events:"Community",modules:"Module",moderation:"Moderation",giveaway:"Gewinnspiel",clips:"Clips",team:"Team",stubenkontrolle:gameName(),users:"Benutzerverwaltung",backup:"Backup / Restore",eventProfiles:"Event-Profile","discord.statistics":"Discord Statistik","discord.moderation":"Discord Moderation"};
  const actionNames={"item.created":"angelegt","item.updated":"geändert","item.deleted":"gelöscht","event.updated":"geändert","module.enabled":"Modul eingeschaltet","module.disabled":"Modul ausgeschaltet","word-filter.platform.enabled":"Wortfilter für Plattform eingeschaltet","word-filter.platform.disabled":"Wortfilter für Plattform ausgeschaltet","moderation.field.updated":"Moderation geändert","watchtime.corrected":"Watchtime korrigiert","watchtime.reset":"Watchtime zurückgesetzt","giveaway.created":"Gewinnspiel erstellt","giveaway.started":"Gewinnspiel gestartet","giveaway.drawn":"Gewinner gezogen","giveaway.ended":"Gewinnspiel beendet","clip.shared":"Clip geteilt","clip.share.failed":"Clip-Teilen fehlgeschlagen","user.capabilities.updated":"Benutzerrechte geändert","account.discord.linked":"Discord verknüpft","account.discord.unlinked.self":"Discord-Verknüpfung gelöst","account.discord.unlinked.admin":"Discord-Verknüpfung administrativ gelöst","discord.announcement.delivered":"Ankündigung geteilt","discord.announcements.config":"Ankündigungen geändert","discord.announcements.test":"Ankündigung getestet","discord.member.role":"Discord-Rolle geändert","discord.access.apply":"Discord-Zugriffsrechte angewendet","discord.moderation.config":"Moderation geändert","discord.moderation.unban":"Ban aufgehoben","discord.moderation.untimeout":"Timeout aufgehoben","discord.moderation.user-reset":"Eskalation zurückgesetzt","access.denied":"Zugriff verweigert","backup.exported":"Backup exportiert","backup.restored":"Backup wiederhergestellt","system.restart.requested":"Bot-Neustart angefordert"};
  const refill=(id,values,empty,fn=x=>x)=>{const el=$(id),cur=el.value;el.innerHTML=`<option value="">${empty}</option>${(values||[]).map(x=>`<option value="${esc(x)}">${esc(fn(x))}</option>`).join("")}`;if((values||[]).includes(cur))el.value=cur;};
  const load=async()=>{
    const q=new URLSearchParams({type:"changes",platform,page:String(page),pageSize:"100"}),user=$("activityUserFilter").value,section=$("activitySectionFilter").value,action=$("activityActionFilter").value;
    if(user)q.set("user",user);if(section)q.set("section",section);if(action)q.set("action",action);
    const r=await fetch(`/api/activity?${q}`,{cache:"no-store"}),d=await r.json();
    if(!r.ok){$("activityList").innerHTML=`<div class="card error">${esc(d.error||"Activity Board konnte nicht geladen werden.")}</div>`;return;}
    page=d.page||1;refill("activityUserFilter",d.facets?.users||[],"Alle Benutzer");refill("activitySectionFilter",d.facets?.sections||[],"Alle Bereiche",x=>sectionNames[x]||x);refill("activityActionFilter",d.facets?.actions||[],"Alle Aktionen",x=>actionNames[x]||x);
    $("activityList").innerHTML=(d.items||[]).length?(d.items||[]).map(x=>{const when=new Date(x.ts).toLocaleString("de-DE"),detail=x.detail||{},label=actionNames[x.action]||x.action,extra=detail.label||detail.type||detail.target||detail.error||detail.reason||"";return`<div class="activity-row"><div><strong>${esc(x.user||"System")}</strong> ${esc(label)}</div><div>${esc(extra)}</div><time>${esc(when)}</time></div>`;}).join(""):`<div class="card">Keine ${platform==="discord"?"Discord-":"Twitch-"}Änderungen vorhanden.</div>`;
    const from=d.total?((d.page-1)*d.pageSize+1):0,to=Math.min(d.total,d.page*d.pageSize);
    $("activityPager").innerHTML=`<button id="activityPrev" ${d.page<=1?"disabled":""}>← Zurück</button><span>Seite <strong>${d.page}</strong> von <strong>${d.totalPages}</strong> · ${from}–${to} von ${d.total}</span><button id="activityNext" ${d.page>=d.totalPages?"disabled":""}>Weiter →</button>`;
    $("activityPrev")?.addEventListener("click",()=>{page--;load();});$("activityNext")?.addEventListener("click",()=>{page++;load();});
  };
  $("activityRefreshBtn").onclick=load;["activityUserFilter","activitySectionFilter","activityActionFilter"].forEach(id=>$(id).onchange=()=>{page=1;load();});
  await load();
}
async function renderUsers(){
  if(!isGlobalAdmin()){$("users").innerHTML=`<div class="card">Keine Berechtigung für Benutzer & Zugriffe.</div>`;return;}
  $("users").innerHTML=`
    <div class="title"><div><h2>Benutzer & Zugriffe</h2><p class="hint">Ansehen und Bearbeiten werden getrennt vergeben. Bearbeiten setzt Ansehen automatisch voraus. Nicht ausdrücklich freigegebene Bereiche bleiben serverseitig gesperrt.</p></div></div>
    <div class="card user-add-card"><h3>Twitch-Benutzer hinzufügen</h3><div class="user-add-row"><input id="newUserLogin" placeholder="Twitch-Login"><button id="addUserBtn" type="button">Hinzufügen</button></div><p class="hint">Der Eintrag selbst vergibt noch keine zusätzlichen Bereiche. Twitch-Mods sehen standardmäßig nur das Dashboard.</p></div>
    <div id="accessProfilesPanel"></div>
    <div id="usersList">Lade …</div>`;

  const capInput=(cap,checked,type)=>cap?`<input type="checkbox" data-cap="${esc(cap)}" data-cap-type="${type}" ${checked?"checked":""}>`:`<span class="cap-na">—</span>`;

  const matrixHtml=(caps,catalog,groups)=>groups.map(g=>{
        const rows=catalog.filter(x=>x.group===g),visibleRows=rows.filter(x=>!permissionRowHidden(x)),hiddenCount=rows.length-visibleRows.length;
        return `<details class="permission-group" data-permission-group="${esc(g)}" ${visibleRows.length?"":"hidden"}>
          <summary class="permission-group-summary"><strong>${esc(g)}</strong><span class="permission-summary-count">${visibleRows.filter(x=>x.view&&caps.has(x.view)).length} Ansicht · ${visibleRows.filter(x=>x.edit&&caps.has(x.edit)).length} Bearbeiten</span><span class="access-user-chevron">⌄</span></summary>
          <div class="permission-table">
            <div class="permission-row permission-head"><span>Bereich</span><span>Ansehen</span><span>Bearbeiten</span></div>
            ${hiddenCount?`<p class="hint permission-hidden-note">${hiddenCount} Bereich${hiddenCount===1?"":"e"} ausgeblendet, weil das Modul ausgeschaltet ist (gespeicherte Rechte bleiben erhalten).</p>`:""}
            ${rows.map(x=>`<div class="permission-row" data-permission-key="${esc(x.key)}" ${permissionRowHidden(x)?"hidden":""}>
              <span class="permission-name">${esc(x.label)}</span>
              <span>${capInput(x.view,caps.has(x.view),"view")}</span>
              <span>${capInput(x.edit,caps.has(x.edit),"edit")}</span>
              ${(x.actions||[]).length?`<div class="permission-actions">${(x.actions||[]).map(ac=>`<label><input type="checkbox" data-cap="${esc(ac.id)}" data-cap-type="action" ${caps.has(ac.id)?"checked":""}> ${esc(ac.label)}</label>`).join("")}</div>`:""}
            </div>`).join("")}
          </div>
        </details>`;
      }).join("");

  // 9.29.0: Zugriffsprofile
  const profileRow=(u,ap)=>{
    const mine=new Set((ap.assignments||{})[u.id]||[]);
    const auto=new Set();
    for(const r of ap.rules||[])if((r.type==="twitch-moderator"&&u.twitchUserId)||(r.type==="discord-role"&&u.discordUserId))auto.add(r.profileId);
    if(!(ap.profiles||[]).length)return `<h4 class="access-sub">Zugriffsprofile</h4><p class="hint">Noch keine Profile angelegt. Profile legst du oben im Bereich „Zugriffsprofile“ an.</p>`;
    return `<h4 class="access-sub">Zugriffsprofile</h4><div class="profile-pick">${(ap.profiles||[]).map(p=>`<label class="checkline"><input type="checkbox" data-profile-id="${esc(p.id)}" ${mine.has(p.id)?"checked":""}> ${esc(p.name)}${p.description?` <span class="hint">${esc(p.description)}</span>`:""}${auto.has(p.id)?' <span class="diag-badge">auch automatisch über eine Regel</span>':""}</label>`).join("")}</div><div class="user-actions"><button class="save-user-profiles" type="button">Profile speichern</button></div>`;
  };
  const wireMatrix=root=>{
    root.querySelectorAll('[data-cap-type="edit"]').forEach(edit=>edit.addEventListener("change",()=>{if(edit.checked){const view=edit.closest(".permission-row")?.querySelector('[data-cap-type="view"]');if(view)view.checked=true;}}));
    root.querySelectorAll('[data-cap-type="view"]').forEach(view=>view.addEventListener("change",()=>{if(!view.checked){const edit=view.closest(".permission-row")?.querySelector('[data-cap-type="edit"]');if(edit)edit.checked=false;}}));
  };
  const profileCard=(p,ap,catalog,groups)=>{
    const users=Object.values(ap.assignments||{}).filter(ids=>ids.includes(p.id)).length;
    const rules=(ap.rules||[]).filter(r=>r.profileId===p.id).length;
    return `<details class="card access-profile-card" data-profile-id="${esc(p.id)}">
      <summary class="access-user-summary"><div class="access-user-summary-main"><strong>${esc(p.name)}</strong><span class="hint">${esc(p.description||"")}</span></div><span class="hint">${(p.capabilities||[]).length} Rechte · ${users} Benutzer · ${rules} Regel${rules===1?"":"n"}</span></summary>
      <div class="access-user-body">
        <div class="co-grid"><label>Name<input class="pf-name" maxlength="60" value="${esc(p.name)}"></label><label>Beschreibung (optional)<input class="pf-desc" maxlength="200" value="${esc(p.description||"")}"></label></div>
        <div class="permission-groups">${matrixHtml(new Set(p.capabilities||[]),catalog,groups)}</div>
        <p class="hint">Änderungen gelten sofort für alle Benutzer mit diesem Profil.</p>
        <div class="user-actions"><button class="pf-save" type="button">Profil speichern</button><button class="pf-copy" type="button">Duplizieren</button><button class="pf-delete danger" type="button">Löschen</button></div>
      </div></details>`;
  };
  function renderProfilesPanel(ap,catalog,groups){
    const box=$("accessProfilesPanel");if(!box)return;
    const profiles=ap.profiles||[];
    const profileOpts=sel=>profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===sel?"selected":""}>${esc(p.name)}</option>`).join("");
    const ruleRow=r=>`<div class="rule-row" data-rule-id="${esc(r.id||"")}">
      <select class="rl-type"><option value="twitch-moderator" ${r.type==="twitch-moderator"?"selected":""}>Twitch-Moderator</option><option value="discord-role" ${r.type==="discord-role"?"selected":""}>Discord-Rolle</option></select>
      <input class="rl-role" placeholder="Rollen-ID (nur Discord)" inputmode="numeric" value="${esc(r.roleId||"")}" ${r.type==="discord-role"?"":"disabled"}>
      <span>erhält</span><select class="rl-profile">${profileOpts(r.profileId)}</select><button class="rl-del" type="button" title="Regel entfernen">✕</button></div>`;
    box.innerHTML=`<details class="card" id="profilesDetails"><summary class="access-user-summary"><div class="access-user-summary-main"><strong>Zugriffsprofile</strong><span class="hint">Benannte Rechtesätze, die du mehreren Benutzern geben oder automatisch zuordnen kannst.</span></div><span class="hint">${profiles.length} Profil${profiles.length===1?"":"e"}</span></summary>
      <div class="access-user-body">
        <p class="hint">Ein Profil enthält Ansehen- und Bearbeiten-Rechte wie bei einem Benutzer. Ein Benutzer kann mehrere Profile haben; die Rechte werden zusammengerechnet und um die Einzelrechte des Benutzers ergänzt. Profiländerungen wirken sofort auf alle Zugewiesenen. Owner und Administratoren haben immer Vollzugriff.</p>
        <div class="user-add-row"><input id="newProfileName" maxlength="60" placeholder="Name des neuen Profils"><button id="addProfileBtn" type="button">Profil anlegen</button></div>
        <div id="profileList">${profiles.map(p=>profileCard(p,ap,catalog,groups)).join("")||'<p class="hint">Noch keine Profile.</p>'}</div>
        <h4 class="access-sub">Automatische Zuordnung</h4>
        <p class="hint">Wer sich anmeldet und die Bedingung erfüllt, erhält das Profil zusätzlich. Twitch-Moderator-Status bzw. Discord-Rollen werden beim Anmelden von Twitch bzw. Discord übernommen. Die Rollen-ID findest du in Discord (Entwicklermodus → Rechtsklick auf die Rolle → ID kopieren).</p>
        <div id="ruleList">${(ap.rules||[]).map(ruleRow).join("")}</div>
        <div class="user-actions"><button id="addRuleBtn" type="button" ${profiles.length?"":"disabled"}>Regel hinzufügen</button><button id="saveRulesBtn" type="button">Regeln speichern</button></div>
      </div></details>`;
    const det=$("profilesDetails");det.open=localStorage.getItem("bwk-profiles-open")==="1";
    det.addEventListener("toggle",e=>{if(e.target===det)localStorage.setItem("bwk-profiles-open",det.open?"1":"0");});
    wireMatrix(box);
    const api=async(url,method,body)=>{const rr=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});const j=await rr.json().catch(()=>({}));if(!rr.ok)throw Error(j.error||"Aktion fehlgeschlagen.");return j;};
    $("addProfileBtn").addEventListener("click",async()=>{try{await api("/api/access-profiles","POST",{name:$("newProfileName").value,capabilities:[]});showToast("Profil angelegt. Rechte unten auswählen und speichern.","success");await loadUsers();}catch(e){showToast(e.message,"error");}});
    box.querySelectorAll(".access-profile-card").forEach(card=>{
      const id=card.dataset.profileId,collect=()=>({name:card.querySelector(".pf-name").value,description:card.querySelector(".pf-desc").value,capabilities:[...card.querySelectorAll("[data-cap]:checked")].map(x=>x.dataset.cap)});
      card.querySelector(".pf-save").addEventListener("click",async()=>{try{await api(`/api/access-profiles/${encodeURIComponent(id)}`,"PUT",collect());showToast("Profil gespeichert. Gilt sofort für alle Zugewiesenen.","success");await loadUsers();}catch(e){showToast(e.message,"error");}});
      card.querySelector(".pf-copy").addEventListener("click",async()=>{try{const c=collect();await api("/api/access-profiles","POST",{...c,name:`${c.name} (Kopie)`.slice(0,60)});showToast("Profil dupliziert.","success");await loadUsers();}catch(e){showToast(e.message,"error");}});
      card.querySelector(".pf-delete").addEventListener("click",async()=>{
        const n=Object.values(ap.assignments||{}).filter(ids=>ids.includes(id)).length;
        if(!(await askDelete(`Profil wirklich löschen?${n?` ${n} Benutzer verlieren die Rechte dieses Profils.`:""} Regeln mit diesem Profil werden entfernt.`)))return;
        try{await api(`/api/access-profiles/${encodeURIComponent(id)}`,"DELETE");showToast("Profil gelöscht.","success");await loadUsers();}catch(e){showToast(e.message,"error");}});
    });
    const bindRule=row=>{
      const type=row.querySelector(".rl-type"),role=row.querySelector(".rl-role");
      type.addEventListener("change",()=>{role.disabled=type.value!=="discord-role";if(role.disabled)role.value="";});
      row.querySelector(".rl-del").addEventListener("click",()=>row.remove());
    };
    box.querySelectorAll(".rule-row").forEach(bindRule);
    $("addRuleBtn").addEventListener("click",()=>{const tmp=document.createElement("div");tmp.innerHTML=ruleRow({type:"twitch-moderator",profileId:profiles[0]?.id||""});const row=tmp.firstElementChild;$("ruleList").appendChild(row);bindRule(row);});
    $("saveRulesBtn").addEventListener("click",async()=>{
      const rules=[...box.querySelectorAll(".rule-row")].map(r=>({id:r.dataset.ruleId||undefined,type:r.querySelector(".rl-type").value,roleId:r.querySelector(".rl-role").value.trim(),profileId:r.querySelector(".rl-profile").value}));
      try{await api("/api/access-profiles/rules","PUT",{rules});showToast("Regeln gespeichert.","success");await loadUsers();}catch(e){showToast(e.message,"error");}
    });
  }

  async function loadUsers(){
    const r=await fetch("/api/users",{cache:"no-store"});const data=await r.json();
    if(!r.ok){$("usersList").innerHTML=`<div class="card error">${esc(data.error||"Benutzer konnten nicht geladen werden.")}</div>`;return;}
    const users=data.users||[],catalog=data.accessCatalog||[],groups=[...new Set(catalog.map(x=>x.group))];
    const ap=data.accessProfiles||{profiles:[],assignments:{},rules:[]};
    renderProfilesPanel(ap,catalog,groups);

    $("usersList").innerHTML=users.length?users.map(u=>{
      const caps=new Set(u.capabilities||[]),full=u.globalOwner||u.globalAdmin;
      const tw=u.twitchUserId?`<div><strong>🟣 Twitch</strong> ${esc(u.displayName||u.login||"")} <span class="hint">@${esc(u.login||"")} · ${esc(u.twitchUserId)}</span></div>`:`<div class="hint">🟣 Twitch: nicht verknüpft</div>`;
      const dc=u.discordUserId?`<div class="identity-row"><div><strong>🔵 Discord</strong> ${esc(u.discordDisplayName||u.discordUsername||"")} <span class="hint">@${esc(u.discordUsername||"")} · ${esc(u.discordUserId)}</span></div><button type="button" class="secondary danger-outline unlink-user-discord">Verknüpfung aufheben</button></div>`:`<div class="hint">🔵 Discord: nicht verknüpft</div>`;
      const displayName=esc(u.displayName||u.discordDisplayName||u.login||u.discordUsername||"Benutzer");
      const status=u.globalOwner?'<span class="diag-badge ok">Owner</span>':u.globalAdmin?'<span class="diag-badge ok">Administrator</span>':'<span class="diag-badge">individuell</span>';
      const viewCount=catalog.filter(x=>x.view&&caps.has(x.view)).length,editCount=catalog.filter(x=>x.edit&&caps.has(x.edit)).length;

      const matrix=matrixHtml(caps,catalog,groups);

      return `<details class="card access-user-card" data-user-id="${esc(u.id)}">
        <summary class="access-user-summary"><div class="access-user-summary-main"><strong>${displayName}</strong><span class="hint">${u.twitchUserId?`🟣 @${esc(u.login||"")}`:""}${u.twitchUserId&&u.discordUserId?" · ":""}${u.discordUserId?`🔵 @${esc(u.discordUsername||"")}`:""}</span></div><div class="access-user-summary-meta">${status}${!full?`<span class="hint">${viewCount} Ansicht · ${editCount} Bearbeiten</span>`:""}<span class="access-user-chevron">⌄</span></div></summary>
        <div class="access-user-body">
          <div class="access-user-head"><div>${tw}${dc}</div></div>
          ${full?'<p class="hint">Owner/Administratoren haben immer Vollzugriff.</p>':`${profileRow(u,ap)}<h4 class="access-sub">Zusätzliche Einzelrechte</h4><p class="hint">Gelten zusätzlich zu den Rechten der Profile.</p><div class="permission-groups">${matrix}</div>`}
          <div class="user-actions">${full?"":'<button class="save-capabilities" type="button">Berechtigungen speichern</button>'}${isGlobalOwner()&&u.twitchUserId?`<select class="user-role"><option value="viewer" ${u.role==="viewer"||u.role==="editor"?"selected":""}>Standardbenutzer</option><option value="admin" ${u.role==="admin"?"selected":""}>Globaler Administrator</option><option value="owner" ${u.role==="owner"?"selected":""}>Globaler Owner</option></select><button class="save-user-role" type="button">Globalstatus speichern</button>`:""}<button class="delete-user danger" type="button">Datensatz entfernen</button></div>
        </div>
      </details>`;
    }).join(""):`<div class="card">Noch keine verknüpften oder freigegebenen Benutzer vorhanden.</div>`;

    const expandedUsers=new Set(JSON.parse(localStorage.getItem("bwk-expanded-users")||"[]"));
    const expandedGroups=new Set(JSON.parse(localStorage.getItem("bwk-expanded-permission-groups")||"[]"));

    $("usersList").querySelectorAll(".access-user-card").forEach(card=>{
      const id=card.dataset.userId;card.open=expandedUsers.has(id);
      card.addEventListener("toggle",()=>{const cur=new Set(JSON.parse(localStorage.getItem("bwk-expanded-users")||"[]"));card.open?cur.add(id):cur.delete(id);localStorage.setItem("bwk-expanded-users",JSON.stringify([...cur]));});

      card.querySelectorAll(".permission-group").forEach(group=>{
        const key=`${id}:${group.dataset.permissionGroup}`;group.open=expandedGroups.has(key);
        group.addEventListener("toggle",()=>{const cur=new Set(JSON.parse(localStorage.getItem("bwk-expanded-permission-groups")||"[]"));group.open?cur.add(key):cur.delete(key);localStorage.setItem("bwk-expanded-permission-groups",JSON.stringify([...cur]));});
      });

      card.querySelectorAll('[data-cap-type="edit"]').forEach(edit=>edit.addEventListener("change",()=>{if(edit.checked){const view=edit.closest(".permission-row")?.querySelector('[data-cap-type="view"]');if(view)view.checked=true;}}));
      card.querySelectorAll('[data-cap-type="view"]').forEach(view=>view.addEventListener("change",()=>{if(!view.checked){const edit=view.closest(".permission-row")?.querySelector('[data-cap-type="edit"]');if(edit)edit.checked=false;}}));

      card.querySelector(".unlink-user-discord")?.addEventListener("click",async()=>{
        if(!(await askAs("unlink","Discord-Verknüpfung dieses Benutzers wirklich aufheben? Discord-Rollen auf dem Server werden nicht verändert.")))return;
        const rr=await fetch(`/api/users/${encodeURIComponent(id)}/discord/unlink`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
        const j=await rr.json().catch(()=>({}));
        if(!rr.ok)return showToast(j.error||"Discord-Verknüpfung konnte nicht aufgehoben werden.","error");
        showToast("Discord-Verknüpfung aufgehoben.","success");
        await loadUsers();
      });
      card.querySelector(".save-user-profiles")?.addEventListener("click",async()=>{
        const profileIds=[...card.querySelectorAll("[data-profile-id]:checked")].map(x=>x.dataset.profileId);
        const rr=await fetch(`/api/users/${encodeURIComponent(id)}/profiles`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({profileIds})});const j=await rr.json().catch(()=>({}));
        if(!rr.ok)return showToast(j.error||"Profile konnten nicht gespeichert werden.","error");showToast("Profile gespeichert.","success");await loadUsers();
      });
      card.querySelector(".save-capabilities")?.addEventListener("click",async()=>{
        const capabilities=[...card.querySelectorAll("[data-cap]:checked")].map(x=>x.dataset.cap);
        const rr=await fetch(`/api/users/${encodeURIComponent(id)}/capabilities`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({capabilities})});const j=await rr.json().catch(()=>({}));
        if(!rr.ok)return showToast(j.error||"Berechtigungen konnten nicht gespeichert werden.","error");showToast("Berechtigungen gespeichert.","success");await loadUsers();
      });
      card.querySelector(".save-user-role")?.addEventListener("click",async()=>{
        const role=card.querySelector(".user-role").value;const rr=await fetch(`/api/users/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({role,enabled:true})});const j=await rr.json().catch(()=>({}));
        if(!rr.ok)return showToast(j.error||"Status konnte nicht gespeichert werden.","error");showToast("Globalstatus gespeichert.","success");await loadUsers();
      });
      card.querySelector(".delete-user")?.addEventListener("click",async()=>{if(!(await askDelete("Diesen internen Benutzer-Datensatz wirklich entfernen?")))return;const rr=await fetch(`/api/users/${encodeURIComponent(id)}`,{method:"DELETE"});const j=await rr.json().catch(()=>({}));if(!rr.ok)return showToast(j.error||"Entfernen fehlgeschlagen.","error");await loadUsers();});
    });
  }

  $("addUserBtn")?.addEventListener("click",async()=>{const login=$("newUserLogin").value.trim(),role="viewer";if(!login)return;const r=await fetch("/api/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({login,role})});const j=await r.json().catch(()=>({}));if(!r.ok)return showToast(j.error||"Hinzufügen fehlgeschlagen.","error");$("newUserLogin").value="";await loadUsers();});
  await loadUsers();
}

async function renderLoginLogs(){
  if(!isGlobalAdmin()){$("loginlogs").innerHTML=`<div class="card">Keine Berechtigung für das Login-Protokoll.</div>`;return;}
  $("loginlogs").innerHTML=`<div class="title"><div><h2>Login-Protokoll</h2><p class="hint">Nur Owner und Administratoren. OAuth-Codes, Tokens und Cookies werden nicht protokolliert.</p></div><button id="loginLogsRefresh" type="button">Aktualisieren</button></div><div id="loginLogSummary" class="stats-summary-grid"></div><div class="activity-filters"><input id="loginLogSearch" type="search" placeholder="Username oder User-ID suchen …"><select id="loginLogPlatform"><option value="">Alle Plattformen</option></select><select id="loginLogResult"><option value="">Alle Ergebnisse</option><option value="success">Erfolgreich</option><option value="denied">Abgelehnt</option><option value="failed">Fehlgeschlagen</option><option value="logout">Abgemeldet</option></select></div><div class="card login-log-maintenance"><div><strong>Manuelle Bereinigung</strong><div class="hint">Keine automatische Löschung.</div></div><button id="loginLogsCleanup" type="button" class="danger">Einträge älter als 30 Tage löschen</button></div><div class="login-log-head"><div>Uhrzeit</div><div>Plattform</div><div>Username / ID</div><div>Ergebnis</div><div>Grund</div></div><div id="loginLogList"></div><div id="loginLogPager" class="activity-pager"></div>`;
  let page=1,search="",timer=null;
  const reason=r=>({"backend-disabled":"Backend nicht freigegeben","not-authorized":"Nicht autorisiert","not-guild-member":"Nicht auf Discord-Server","oauth-state-invalid":"OAuth ungültig/abgelaufen","identity":"Identität nicht prüfbar","rate-limited":"Zu viele Fehlversuche","nonlocal":"Nicht aus lokalem Netz","Falsches Passwort":"Falsches Passwort"}[r]||r||"—"),result=r=>({success:"Erfolgreich",denied:"Abgelehnt",failed:"Fehlgeschlagen",logout:"Abgemeldet"}[r]||r);
  const load=async()=>{const q=new URLSearchParams({page:String(page),pageSize:"100"}),platform=$("loginLogPlatform").value,res=$("loginLogResult").value;if(platform)q.set("platform",platform);if(res)q.set("result",res);if(search)q.set("search",search);const r=await fetch(`/api/admin/login-logs?${q}`,{cache:"no-store"}),d=await r.json();if(!r.ok){$("loginLogList").innerHTML=`<div class="card error">${esc(d.error||"Fehler")}</div>`;return;}page=d.page||1;$("loginLogSummary").innerHTML=`<div class="card stats-summary"><span>Einträge gesamt</span><strong>${Number(d.allEntries||0).toLocaleString("de-DE")}</strong><small>${Number(d.total||0).toLocaleString("de-DE")} im Filter</small></div>${d.storage==="postgres"?`<div class="card stats-summary"><span>Speicherort</span><strong>Datenbank</strong><small>Einträge liegen in PostgreSQL</small></div>`:`<div class="card stats-summary"><span>Speicherort</span><strong>Datei · ${esc(d.file?.size||"0 B")}</strong><small>${d.file?.modifiedAt?formatStatDate(d.file.modifiedAt):"noch leer"}</small></div>`}`;const ps=$("loginLogPlatform"),cur=ps.value;ps.innerHTML=`<option value="">Alle Plattformen</option>${(d.facets?.platforms||[]).map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("")}`;ps.value=cur;$("loginLogList").innerHTML=(d.items||[]).length?(d.items||[]).map(x=>`<div class="login-log-row"><div>${esc(new Date(x.ts).toLocaleString("de-DE"))}</div><div><strong>${esc(x.platform||"—")}</strong></div><div><strong>${esc(x.username||"unbekannt")}</strong>${x.userId?`<span class="stats-sub">${esc(x.userId)}</span>`:""}</div><div><span class="diag-badge ${x.result==="success"?"ok":x.result==="failed"||x.result==="denied"?"bad":""}">${esc(result(x.result))}</span></div><div>${esc(reason(x.reason))}</div></div>`).join(""):`<div class="card">Keine passenden Einträge.</div>`;const from=d.total?((d.page-1)*d.pageSize+1):0,to=Math.min(d.total,d.page*d.pageSize);$("loginLogPager").innerHTML=`<button id="loginPrev" ${d.page<=1?"disabled":""}>← Zurück</button><span>Seite <strong>${d.page}</strong> von <strong>${d.totalPages}</strong> · ${from}–${to} von ${d.total}</span><button id="loginNext" ${d.page>=d.totalPages?"disabled":""}>Weiter →</button>`;$("loginPrev")?.addEventListener("click",()=>{page--;load();});$("loginNext")?.addEventListener("click",()=>{page++;load();});};
  $("loginLogsRefresh").onclick=load;$("loginLogPlatform").onchange=()=>{page=1;load();};$("loginLogResult").onchange=()=>{page=1;load();};$("loginLogSearch").oninput=e=>{search=e.target.value.trim();page=1;clearTimeout(timer);timer=setTimeout(load,300);};$("loginLogsCleanup").onclick=async()=>{if(!(await askDelete("Alle Login-Einträge löschen, die älter als 30 Tage sind?")))return;const r=await fetch("/api/admin/login-logs/cleanup",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),d=await r.json().catch(()=>({}));if(!r.ok)return showToast(d.error||"Bereinigung fehlgeschlagen.","error");showToast(`${Number(d.removed||0)} Einträge gelöscht.`,"success");page=1;load();};await load();
}

// 9.1.1: Modulschalter. settings.modules kommt vom Server (true/false je Modul); fehlt der Eintrag, gilt das Modul als aus.
function moduleEnabledUi(id){return settings?.modules?.[id]===true;}
async function renderModules(){
  const root=$("modules");if(!root)return;
  if(!isGlobalAdmin()){root.innerHTML=`<div class="card">Keine Berechtigung für Module.</div>`;return;}
  root.innerHTML=`<div class="title"><div><h2>Administration · Module</h2><p class="hint">Hier werden Module ein- und ausgeschaltet. Ein ausgeschaltetes Modul ist in der Oberfläche nirgends sichtbar und läuft nicht. Die zusätzlichen Schalter auf den Einstellungsseiten der Module bleiben bestehen.</p></div></div><div id="moduleList" class="module-list">Lade …</div>`;
  const draw=modules=>{
    const list=$("moduleList");if(!list)return;
    // 9.2.0: nach Plattform gegliedert, mit Hinweis, in welchem Dienst das Modul läuft.
    const card=m=>`
      <div class="card module-card" data-module="${esc(m.id)}">
        <div class="module-info"><h3>${esc(m.label)}</h3><p class="hint">${esc(m.description)}</p>
          <p class="hint module-state">${m.enabled?"Eingeschaltet":"Ausgeschaltet"}${m.runsIn?` · läuft in: ${esc(m.runsIn)}`:""}${m.critical?` · <strong class="module-critical">Schutzfunktion</strong>`:""}</p></div>
        <label class="module-switch"><input type="checkbox" role="switch" data-module-toggle="${esc(m.id)}" ${m.enabled?"checked":""} aria-label="Modul ${esc(m.label)} ein- oder ausschalten"><span class="module-slider" aria-hidden="true"></span></label>
      </div>`;
    const sections=[["twitch","Twitch"],["discord","Discord"],["both","Twitch und Discord"]].map(([key,title])=>{
      const rows=modules.filter(m=>(m.platform||"twitch")===key);
      return rows.length?`<h3 class="module-group-title">${esc(title)}</h3>${rows.map(card).join("")}`:"";
    }).join("");
    list.innerHTML=sections||`<div class="card">Keine abschaltbaren Module vorhanden.</div>`;
    list.querySelectorAll("[data-module-toggle]").forEach(box=>box.addEventListener("change",async()=>{
      const mod=modules.find(x=>x.id===box.dataset.moduleToggle),want=box.checked;
      if(!mod)return;
      if(!want){
        const ok=mod.critical
          // 9.6.0: Schutzfunktionen – verschärfte Warnung, Name muss eingetippt werden.
          ?await askConfirm({title:`Schutzfunktion „${mod.label}“ ausschalten`,text:`${mod.offNote||""} Das Ausschalten kann unter Umständen zu Datenverlusten führen. Das Modul verschwindet aus der Oberfläche und läuft nicht mehr.`.trim(),confirmLabel:"SCHUTZ AUSSCHALTEN",cancelLabel:"ABBRECHEN",danger:true,typeToConfirm:mod.label})
          :await askConfirm({title:`Modul „${mod.label}“ ausschalten`,text:`Das Ausschalten kann unter Umständen zu Datenverlusten führen. ${mod.offNote||""} Das Modul verschwindet aus der Oberfläche und läuft nicht mehr.`.trim(),confirmLabel:"AUSSCHALTEN",cancelLabel:"ABBRECHEN",danger:true});
        if(!ok){box.checked=true;return;}
      }
      box.disabled=true;
      try{
        const r=await fetch("/api/admin/modules",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:mod.id,enabled:want})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.error||"Modul konnte nicht geändert werden.");
        // Einstellungen neu laden, damit Navigation und Seiten den neuen Stand kennen (Daten bleiben unverändert).
        if((currentUser?.capabilities||[]).some(x=>String(x).startsWith("twitch."))||isGlobalAdmin()){
          const sr=await fetch("/api/settings",{cache:"no-store"});
          if(sr.ok)settings=await sr.json();
        }
        refreshNavigationPermissions();
        showToast(want?`Modul „${mod.label}“ eingeschaltet.`:`Modul „${mod.label}“ ausgeschaltet.`);
        draw(d.modules||modules);
      }catch(e){box.checked=!want;box.disabled=false;showToast(e.message,"error");}
    }));
  };
  try{
    const r=await fetch("/api/admin/modules",{cache:"no-store"}),d=await r.json();
    if(!r.ok)throw new Error(d.error||"Module konnten nicht geladen werden.");
    draw(d.modules||[]);
  }catch(e){const list=$("moduleList");if(list)list.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
// ===== 9.11.0 · D1: Ersteinrichtung und Profil & Branding =====
// Kopieren funktioniert auch ohne HTTPS (z. B. http://NAS-IP:3000 bei der Ersteinrichtung).
function copyPlain(value){
  const v=String(value||"");
  const fallback=()=>{const t=document.createElement("textarea");t.value=v;t.setAttribute("readonly","");t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();let ok=false;try{ok=document.execCommand("copy");}catch{}t.remove();return ok;};
  if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(v).then(()=>true).catch(()=>fallback());
  return Promise.resolve(fallback());
}
function bindCopyButtons(root){
  root?.querySelectorAll("[data-copy-plain]").forEach(btn=>btn.addEventListener("click",async()=>{
    const ok=await copyPlain(btn.dataset.copyPlain||"");showToast(ok?"Kopiert.":"Kopieren nicht möglich – bitte markieren und manuell kopieren.",ok?"success":"error");
  }));
}
function redirectRowsHtml(redirects){
  if(!redirects)return `<p class="hint">Noch keine öffentliche Adresse – die Weiterleitungsadressen erscheinen, sobald eine Adresse eingerichtet ist.</p>`;
  const rows=[["Twitch – Anmeldung",redirects.twitchLogin],["Twitch – Bot-Verbindungen",redirects.twitchConnect],["Discord – Anmeldung",redirects.discord],["TikTok (optional)",redirects.tiktok]];
  return `<div class="profile-redirects">${rows.map(([label,v])=>`<div class="copy-row"><span>${esc(label)}</span><code>${esc(v)}</code><button type="button" class="secondary" data-copy-plain="${esc(v)}">Kopieren</button></div>`).join("")}</div>`;
}
function gameFieldsHtml(prefix,game,labels,fixed,disabled){
  const c=game?.commands||{},dis=disabled?"disabled":"";
  const cmd=key=>`<label class="profile-field"><span class="fieldlabel">${esc(labels?.[key]||key)}</span><input id="${prefix}Cmd_${key}" value="${esc(c[key]||"")}" maxlength="25" ${dis} autocomplete="off" spellcheck="false"></label>`;
  return `<div class="profile-grid">
      <label class="profile-field"><span class="fieldlabel">Name des Spiels</span><input id="${prefix}GameName" value="${esc(game?.name||"")}" maxlength="40" ${dis}></label>
      <label class="profile-field"><span class="fieldlabel">Name der Punkte</span><input id="${prefix}PointsName" value="${esc(game?.pointsName||"")}" maxlength="30" ${dis}></label>
    </div>
    <div class="profile-grid">${["start","balance","top","help"].map(cmd).join("")}</div>
    <p class="hint">Feste Befehle (gleich für jedes Spiel): ${(fixed||[]).map(x=>`<code>${esc(x)}</code>`).join(" ")}. Befehle beginnen mit <code>!</code>; doppelte oder anderweitig belegte Befehle werden beim Speichern abgelehnt.</p>`;
}
function readGameFields(prefix){
  const v=id=>($(id)?.value||"").trim();
  return {name:v(`${prefix}GameName`),pointsName:v(`${prefix}PointsName`),commands:{start:v(`${prefix}Cmd_start`),balance:v(`${prefix}Cmd_balance`),top:v(`${prefix}Cmd_top`),help:v(`${prefix}Cmd_help`)}};
}

// 9.22.0: Lizenz der Installation (Version, Annahme, Prüfsumme des Textes).
function licenseCardHtml(d){
  const l=d.license||{},a=d.installation?.license;
  const how={wizard:"Einrichtungsassistent",bestandsinstallation:"bestehende Installation (automatisch)",bestaetigung:"Bestätigung"}[a?.source]||"";
  const state=a?`Angenommen am ${esc(new Date(a.acceptedAt).toLocaleString("de-DE"))}${how?` · ${esc(how)}`:""} · Version ${esc(a.version)}${d.licenseCurrent?"":" (nicht die aktuelle Version)"}`:"Noch nicht angenommen.";
  return `<p><strong>${esc(l.name||"")}</strong> (${esc(l.id||"")} ${esc(l.version||"")}) · ${esc(l.type||"")}</p>
    <p class="hint">${state}</p>
    <p class="hint">${esc(l.copyright||"")} · Kennung ${esc(l.spdx||"")}</p>
    <p class="hint">Prüfsumme des Lizenztextes (SHA-256): <code>${esc(l.sha256||"nicht verfügbar")}</code><br>Die Dokumentation bleibt in dieser Installation; es wird nichts an den Lizenzgeber übermittelt.</p>
    <p><a href="/api/license/text" target="_blank" rel="noopener">Vollständigen Lizenztext anzeigen</a></p>`;
}

async function renderSetupWizard(){
  let st;
  try{const r=await fetch("/api/setup/status",{cache:"no-store"});st=await r.json();if(!r.ok||!st.pending)return false;}catch{return false;}
  const box=$("setup");if(!box)return false;
  box.classList.remove("hidden");
  const pb=st.publicBase||{};
  const lic=st.license||{};
  $("setupForm").innerHTML=`
    <div class="setup-step" id="setupLicenseStep"><h3>Lizenzvereinbarung</h3>
      <p class="hint"><strong>${esc(lic.name||"Bot Control Center Community License")}</strong> · Version ${esc(lic.version||"")}</p>
      <p><strong class="ok-text">Erlaubt:</strong> ${esc(lic.summary?.allowed||"")}</p>
      <p><strong class="error-text">Nicht erlaubt:</strong> ${esc(lic.summary?.forbidden||"")}</p>
      <p class="hint">${esc(lic.copyright||"")}. Diese Übersicht dient der Information; maßgeblich sind die vollständigen Lizenzbedingungen.</p>
      <details id="setupLicenseDetails"><summary>Vollständigen Lizenztext lesen</summary>
        <pre id="setupLicenseText" class="license-text">Wird geladen …</pre></details>
      <label class="check"><input type="checkbox" id="setupLicenseAccept"> Ich akzeptiere die vollständigen Lizenzbedingungen.</label>
      ${lic.available===false?`<p class="error-text">Der Lizenztext fehlt in dieser Installation. Die Einrichtung ist erst nach einer vollständigen Installation möglich.</p>`:""}
    </div>
    <div class="setup-step"><h3>1 · Einrichtungscode</h3>
      <p class="hint">Der Code steht im Protokoll des Containers <strong>bcc-web</strong> (Zeile „ERSTEINRICHTUNG – Einrichtungscode“):<br>Synology: Container Manager → Container → bcc-web → Protokoll · VPS: <code>docker logs bcc-web</code> · Windows/Mac: Docker Desktop → Containers → bcc-web → Logs.</p>
      <input id="setupCode" placeholder="XXXX-XXXX-XXXX" autocomplete="one-time-code" spellcheck="false" maxlength="20"></div>
    <div class="setup-step"><h3>2 · Name der Oberfläche</h3>
      <input id="setupProductName" value="${esc(st.productName||"Bot Control Center")}" maxlength="80">
      <p class="hint">Erscheint in Kopfzeile, Browser-Tab und auf den öffentlichen Informationsseiten.</p></div>
    <div class="setup-step"><h3>3 · Öffentliche Adresse</h3>
      ${pb.locked
        ?`<input value="${esc(pb.url||"")}" disabled><p class="hint">Durch die Installation vorgegeben (PUBLIC_BASE_URL) und hier nicht änderbar.</p>`
        :`<input id="setupBaseUrl" value="${esc(pb.suggestion||"")}" placeholder="https://bot.example.org" spellcheck="false">
          <p class="hint">Adresse, unter der das Control Center von außen erreichbar ist, z. B. <code>https://bot.example.org</code> (ohne Pfad). Reine Docker-Desktop-Nutzung auf einem PC/Mac: <code>http://localhost:3000</code>. Daraus werden Anmelde- und Overlay-Adressen abgeleitet.</p>`}</div>
    <div class="setup-step"><h3>4 · Kanal und Haupt-Bot</h3>
      <label>Twitch-Login des Kanals<input id="setupChannelLogin" value="${esc(st.bots?.channelLogin||"")}" placeholder="kanalname" maxlength="25" spellcheck="false" ${st.bots?.channelLocked?"disabled":""}></label>
      ${st.bots?.channelLocked?`<p class="hint">Durch die Installation vorgegeben (TWITCH_CHANNEL_LOGIN) und hier nicht änderbar.</p>`:`<p class="hint">Der Kanal, in dem die Bots arbeiten. Das Twitch-Konto dieses Kanals erhält bei der ersten Anmeldung automatisch Owner-Rechte.</p>`}
      <label>Twitch-Login des Haupt-Bots<input id="setupMainBotLogin" value="${esc(st.bots?.mainLogin||"")}" placeholder="botname" maxlength="25" spellcheck="false"></label>
      <label>Anzeigename des Haupt-Bots (optional)<input id="setupMainBotName" value="${esc(st.bots?.mainName||"")}" maxlength="40"></label>
      <p class="hint">Der Haupt-Bot braucht Moderationsrechte im Kanal. Weitere Bots und die Twitch-Anmeldung der Bots folgen später unter Administration → Twitch-Verbindungen.</p></div>
    <div class="setup-step"><h3>5 · Discord (optional)</h3>
      <label>Discord-Server-ID<input id="setupDiscordGuild" value="${esc(st.discord?.guildId||"")}" inputmode="numeric" placeholder="z. B. 123456789012345678" spellcheck="false"></label>
      <p class="hint">Nur nötig, wenn du Discord nutzt: Discord → Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick auf den Server → „Server-ID kopieren“. Leer lassen, wenn du Discord nicht nutzt. Die Rollen (Administrator, Moderator, Member, Bot) legst du später unter Discord → Rollen fest, sobald der Bot auf dem Server ist.</p></div>
    <div class="setup-step"><h3>6 · Punktespiel</h3>${gameFieldsHtml("setup",st.game,st.commandLabels,st.fixedCommands,false)}</div>
    <div class="row"><button id="setupSubmit" type="button" disabled>Zustimmung erforderlich</button></div>`;
  $("setupLicenseDetails").addEventListener("toggle",async e=>{
    const pre=$("setupLicenseText");if(!e.target.open||pre.dataset.loaded)return;
    try{const r=await fetch("/api/license/text",{cache:"no-store"});if(!r.ok)throw new Error("Lizenztext nicht verfügbar.");pre.textContent=await r.text();pre.dataset.loaded="1";}
    catch(err){pre.textContent=err.message;}
  });
  const syncLicense=()=>{const ok=$("setupLicenseAccept").checked&&lic.available!==false;const b=$("setupSubmit");b.disabled=!ok;b.textContent=ok?"Einrichtung abschließen":"Zustimmung erforderlich";};
  $("setupLicenseAccept").addEventListener("change",syncLicense);syncLicense();
  $("setupSubmit").addEventListener("click",async()=>{
    const btn=$("setupSubmit");btn.disabled=true;$("setupError").textContent="";
    try{
      const body={licenseAccepted:$("setupLicenseAccept").checked,licenseVersion:lic.version,code:$("setupCode").value,productName:$("setupProductName").value,game:readGameFields("setup"),mainBotLogin:$("setupMainBotLogin").value,mainBotName:$("setupMainBotName").value,discordGuildId:$("setupDiscordGuild").value};
      if($("setupChannelLogin")&&!$("setupChannelLogin").disabled)body.channelLogin=$("setupChannelLogin").value;
      if($("setupBaseUrl"))body.publicBaseUrl=$("setupBaseUrl").value;
      const r=await fetch("/api/setup/complete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||"Einrichtung fehlgeschlagen.");
      $("setupForm").classList.add("hidden");
      const done=$("setupDone");done.classList.remove("hidden");
      done.innerHTML=`<h3>✅ Einrichtung abgeschlossen</h3>
        <p>Jetzt noch diese Weiterleitungsadressen in den Entwicklerkonsolen eintragen (später jederzeit unter Administration → Adresse):</p>
        <ul class="hint"><li><strong>Twitch:</strong> dev.twitch.tv → Console → deine Anwendung → „OAuth Redirect URLs“ (beide Twitch-Adressen).</li><li><strong>Discord:</strong> discord.com/developers → deine Anwendung → OAuth2 → „Redirects“.</li></ul>
        ${redirectRowsHtml(d.redirects)}
        <p>Danach mit dem Twitch-Konto des Kanals${d.channelLogin?` <strong>${esc(d.channelLogin)}</strong>`:""} anmelden – es erhält automatisch Owner-Rechte.${d.localAdminEnabled?" Alternativ ist der lokale Admin-Login aus dem lokalen Netz möglich.":""}</p>
        <div class="row"><button type="button" id="setupToLogin">Zur Anmeldung</button></div>`;
      bindCopyButtons(done);
      $("setupToLogin").addEventListener("click",()=>location.replace("/"));
      await loadBranding();
    }catch(e){$("setupError").textContent=e.message;btn.disabled=false;syncLicense();}
  });
  return true;
}

// 9.12.0: Rollenauswahl für Discord (Profil & Branding). Gespeichert wird die Rollen-ID.
function discordRoleOptionHtml(selectedId,roles){
  const sel=String(selectedId||"");
  const list=Array.isArray(roles)?roles:[];
  const known=list.some(r=>String(r.id)===sel);
  return `<option value="">— nicht festgelegt —</option>`
    +(sel&&!known?`<option value="${esc(sel)}" selected>${list.length?"Unbekannte Rolle":"Rolle"} (${esc(sel)})</option>`:"")
    +list.map(r=>`<option value="${esc(r.id)}" ${String(r.id)===sel?"selected":""}>${esc(r.name)}</option>`).join("");
}
function readProfileDiscord(scope){
  const roles={};
  (scope||document).querySelectorAll("select[data-role]").forEach(el=>{roles[el.dataset.role]=el.value;});
  return {guildId:$("profileDiscordGuild")?.value||"",roles};
}
async function loadProfileDiscordRoles(saved,scope){
  const hint=(scope||document).querySelector("#profileDiscordHint");
  if(!saved?.guildId){return;}
  try{
    const r=await fetch("/api/admin/profile/discord-roles",{cache:"no-store"});const j=await r.json();
    if(!r.ok||j.ok===false)throw new Error(j.error||"Rollen konnten nicht geladen werden.");
    if(!j.roles?.length){if(hint)hint.textContent=j.guild?.found===false?"Der Bot sieht diesen Server nicht. Bitte Server-ID prüfen und den Bot einladen.":"Es wurden keine Rollen gefunden.";return;}
    (scope||document).querySelectorAll("select[data-role]").forEach(el=>{const cur=el.value||saved.roles?.[el.dataset.role]||"";el.innerHTML=discordRoleOptionHtml(cur,j.roles);});
    const envKeys=Object.entries(j.sources?.roles||{}).filter(([,v])=>v==="env").map(([k])=>k);
    if(hint)hint.textContent=(j.sources?.guild==="env"||envKeys.length)?"Hinweis: Einzelne Werte sind durch die Installation (Umgebungsvariablen) vorgegeben und gehen den hier gespeicherten Werten vor.":(j.guild?.name?`Server: ${j.guild.name}`:"Rollen geladen.");
  }catch(e){if(hint)hint.textContent=e.message;}
}

// 9.14.0: Bilder der Installation. Hochladen und Zurücksetzen wirken sofort (unabhängig von „Speichern“).
function renderProfileImages(d){
  const box=$("profileImages");if(!box)return;
  const can=d.canEdit===true,slots=d.imageSlots||[],state=d.imageState||{},saved=d.installation?.images||{};
  const modeText={upload:"Eigenes Bild",default:"Standardbild dieser Installation",legacy:"Standard-Animation dieser Installation",none:"Kein Bild"};
  box.innerHTML=`<h3>Bilder</h3><p class="hint">Erlaubt sind PNG, WebP, JPG und GIF bis 5 MB (kein SVG); für das Browser-Symbol zusätzlich ICO. Das Bild wird nach dem Hochladen sofort verwendet; Overlays im Stream übernehmen es beim nächsten Laden.</p>
    <div class="image-slots">${slots.map(sl=>{
      const st=state[sl.key]||{mode:"none"},meta=saved[sl.key];
      const preview=st.url?`<img class="image-preview" src="${esc(st.url)}" alt="">`:`<div class="image-preview empty">${st.mode==="legacy"?"Animation":st.mode==="builtin"?"Standardfigur (Lehrer)":"kein Bild"}</div>`;
      return `<div class="image-slot" data-slot="${esc(sl.key)}">${preview}
        <div class="image-slot-body"><strong>${esc(sl.label)}</strong><div class="hint">${esc(sl.hint)}</div>
        <div class="hint">Empfohlen ${sl.recommended.width} × ${sl.recommended.height} Pixel (mindestens ${sl.min.width} × ${sl.min.height}).</div>
        <div class="hint">${esc(modeText[st.mode]||"")}${meta?` · ${meta.width} × ${meta.height}, ${(meta.bytes/1024).toFixed(0)} KB`:""}</div>
        ${can?`<div class="row"><label class="file-button">Bild wählen<input type="file" accept="image/png,image/jpeg,image/gif,image/webp${sl.key==="favicon"?",image/x-icon,.ico":""}" data-upload="${esc(sl.key)}" hidden></label>${meta?`<button type="button" class="secondary" data-reset="${esc(sl.key)}">Auf Standard zurücksetzen</button>`:""}</div>`:""}
        </div></div>`;}).join("")}</div>`;
  const reload=async j=>{
    await loadBranding();
    const r=await fetch("/api/admin/profile",{cache:"no-store"});const nd=await r.json().catch(()=>j);renderProfileImages(nd&&nd.installation?nd:j);
  };
  box.querySelectorAll("input[data-upload]").forEach(inp=>inp.addEventListener("change",async()=>{
    const f=inp.files&&inp.files[0];if(!f)return;
    if(f.size>5*1024*1024){showToast("Die Datei ist größer als 5 MB.","error",6000);inp.value="";return;}
    try{
      const r=await fetch(`/api/admin/profile/image/${encodeURIComponent(inp.dataset.upload)}`,{method:"PUT",headers:{"Content-Type":f.type||"application/octet-stream"},body:f});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||"Hochladen fehlgeschlagen.");
      showToast("Bild gespeichert.");await reload(j);
    }catch(e){showToast(e.message,"error",8000);inp.value="";}
  }));
  box.querySelectorAll("button[data-reset]").forEach(b=>b.addEventListener("click",async()=>{
    if(!confirm("Das eigene Bild entfernen und auf das Standardbild zurücksetzen?"))return;
    try{
      const r=await fetch(`/api/admin/profile/image/${encodeURIComponent(b.dataset.reset)}`,{method:"DELETE"});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||"Zurücksetzen fehlgeschlagen.");
      showToast("Auf Standard zurückgesetzt.");await reload(j);
    }catch(e){showToast(e.message,"error",6000);}
  }));
}

// 9.15.0: Bot-Liste. Ein Kanal-Konto, ein Haupt-Bot (Moderationsrechte, Pflicht) und beliebig viele weitere Bots.
function renderProfileBots(d,can){
  const root=$("profileBots");
  const src=d.installation?.bots||{bots:[],channel:{}};
  let draft=src.bots.map(b=>({...b}));
  const channel={...(src.channel||{})};
  const dis=can?"":"disabled";
  const envLocked=d.env?.channelLogin===true;
  function draw(){
    root.innerHTML=`
      <p class="hint">Der <strong>Haupt-Bot</strong> braucht Moderationsrechte im Kanal und ist Pflicht. Weitere Bots senden nur Nachrichten; jede Funktion wählt selbst, welcher Bot sendet. Die Twitch-Anmeldung der Bots erfolgt anschließend weiter unten bei den Konten.</p>
      <label>Kanal-Login (Twitch-Kanal, in dem die Bots arbeiten)
        <input id="profileChannelLogin" value="${esc(envLocked?(d.effective?.channelLogin||""):(channel.login||""))}" placeholder="kanalname" spellcheck="false" maxlength="25" ${envLocked?"disabled":dis}></label>
      ${envLocked?`<p class="hint">Durch die Installation vorgegeben (TWITCH_CHANNEL_LOGIN in der Compose-Datei) – hier nicht änderbar.</p>`:""}
      <div class="profile-bots">${draft.map((b,i)=>`
        <div class="row profile-bot-row">
          <label>Twitch-Login<input data-bot-login="${i}" value="${esc(b.login||"")}" placeholder="botname" maxlength="25" spellcheck="false" ${dis}></label>
          <label>Anzeigename<input data-bot-name="${i}" value="${esc(b.displayName||"")}" maxlength="40" ${dis}></label>
          <label class="moderation-check"><input type="radio" name="profileMainBot" data-bot-main="${i}" ${b.main?"checked":""} ${dis}> Haupt-Bot</label>
          ${can&&!b.main?`<button type="button" data-bot-remove="${i}">Bot entfernen</button>`:""}
        </div>`).join("")}</div>
      ${can&&draft.length<10?`<button type="button" id="profileBotAdd">+ Bot hinzufügen</button>`:""}`;
    root.querySelectorAll("[data-bot-login]").forEach(el=>el.addEventListener("input",()=>{draft[Number(el.dataset.botLogin)].login=el.value.trim().toLowerCase();}));
    root.querySelectorAll("[data-bot-name]").forEach(el=>el.addEventListener("input",()=>{draft[Number(el.dataset.botName)].displayName=el.value;}));
    root.querySelectorAll("[data-bot-main]").forEach(el=>el.addEventListener("change",()=>{draft.forEach((b,i)=>{b.main=i===Number(el.dataset.botMain);});}));
    root.querySelectorAll("[data-bot-remove]").forEach(el=>el.addEventListener("click",()=>{
      const i=Number(el.dataset.botRemove),b=draft[i];
      if(!confirm(`Bot „${b.displayName||b.login}“ entfernen?\n\nFunktionen, die diesen Bot zum Senden gewählt haben, senden danach über den Haupt-Bot. Die Änderung gilt erst nach „Speichern“.`))return;
      draft.splice(i,1);draw();
    }));
    $("profileBotAdd")?.addEventListener("click",()=>{draft.push({key:"",login:"",displayName:"",main:false});draw();});
    $("profileChannelLogin")?.addEventListener("input",e=>{channel.login=e.target.value.trim().toLowerCase();});
  }
  draw();
  return {read:()=>(draft.every(b=>!b.login)&&!channel.login)?undefined:({bots:draft.map(b=>({key:b.key||undefined,login:b.login,displayName:b.displayName,main:b.main===true})),channel:{login:envLocked?"":(channel.login||"")}})};
}

// 9.15.0: Die Karten der Grunddaten stehen dort, wo sie im Betrieb gebraucht werden (Adresse & Anmeldung, Twitch-Verbindungen,
// Stubenkontrolle, Discord → Rollen); jede speichert für sich. Profil & Branding behält Name, Bilder und Impressum.
async function fetchProfileData(){
  const r=await fetch("/api/admin/profile",{cache:"no-store"});const d=await r.json();
  if(!r.ok)throw new Error(d.error||"Profil konnte nicht geladen werden.");
  return d;
}
async function saveProfilePart(body,okText){
  const r=await fetch("/api/admin/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||"Speichern fehlgeschlagen.");
  const warn=j.discordPush&&!j.discordPush.ok;
  showToast(warn?`${okText} Der Discord-Dienst konnte nicht benachrichtigt werden: ${j.discordPush.error}`:okText,warn?"error":"success",warn?7000:undefined);
  await loadBranding();
  if(typeof refreshNavigationPermissions==="function")refreshNavigationPermissions();
  return j;
}
function profileCardHtml(kind,d){
  const p=d.installation||{},pb=d.publicBase||{},can=d.canEdit===true,dis=can?"":"disabled";
  const sourceText={env:"aus der Installation (PUBLIC_BASE_URL)",profile:"hier eingerichtet",none:"nicht eingerichtet"}[pb.source]||"";
  if(kind==="address")return `<div class="card" id="profileCard_address"><h3>Öffentliche Adresse</h3>
      ${pb.locked
        ?`<input value="${esc(pb.url||"")}" disabled><p class="hint">Durch die Installation vorgegeben (PUBLIC_BASE_URL in der Compose-Datei) – hier nicht änderbar.</p>`
        :`<input id="profileBaseUrl" value="${esc(p.publicBaseUrl||"")}" placeholder="https://bot.example.org" spellcheck="false" ${dis}><p class="hint">https:// ist Pflicht; http:// nur für localhost (Docker Desktop).</p>`}
      <p class="hint">Quelle: ${esc(sourceText)}${pb.warning?` · <strong>${esc(pb.warning)}</strong>`:""}</p>
      <h4>Weiterleitungsadressen (Twitch- und Discord-Entwicklerkonsole)</h4>
      ${redirectRowsHtml(d.redirects)}
      ${d.env?.twitchRedirectUri?`<p class="hint">Hinweis: Die Twitch-Anmeldung nutzt die fest eingestellte TWITCH_REDIRECT_URI: <code>${esc(d.effective?.twitchLogin||"")}</code>.</p>`:""}
      <p class="hint">Wird die Adresse geändert, müssen die Weiterleitungsadressen in den Entwicklerkonsolen ebenfalls angepasst werden.</p>${can?`<div class="row"><button type="button" data-profile-save="address">Speichern</button></div>`:""}</div>`;
  if(kind==="game")return `<div class="card" id="profileCard_game"><h3>Punktespiel</h3>${gameFieldsHtml("profile",p.game,d.commandLabels,d.fixedCommands,!can)}
      <p class="hint">Neue Befehlsnamen gelten im Chat spätestens nach 30 Sekunden. Spielstände bleiben unverändert.</p>${can?`<div class="row"><button type="button" data-profile-save="game">Speichern</button></div>`:""}</div>`;
  if(kind==="discord")return `<div class="card" id="profileCard_discord"><h3>Discord-Server und Rollen</h3>
      <label>Discord-Server-ID<input id="profileDiscordGuild" value="${esc(p.discord?.guildId||"")}" inputmode="numeric" placeholder="z. B. 123456789012345678" spellcheck="false" ${dis}></label>
      <p class="hint">Discord → Einstellungen → Erweitert → Entwicklermodus, dann Rechtsklick auf den Server → „Server-ID kopieren“. Der Bot muss auf dem Server sein.</p>
      <div class="profile-discord-roles">${Object.entries(d.discordRoleLabels||{}).map(([key,label])=>`<label>${esc(label)}<select id="profileDiscordRole_${esc(key)}" data-role="${esc(key)}" ${dis}>${discordRoleOptionHtml(p.discord?.roles?.[key]||"",[])}</select></label>`).join("")}</div>
      <p class="hint" id="profileDiscordHint">Die Rollen erscheinen zur Auswahl, sobald die Server-ID gespeichert ist und der Bot den Server sieht.</p>
      <p class="hint"><strong>Administrator</strong>: volles Team · <strong>Moderator</strong>: vertrauenswürdig, Moderation · <strong>Member</strong>: Rolle, die nach den Regeln vergeben wird · <strong>Rolle des Bots</strong>: die eigene Rolle des Bots (muss in der Rollenliste über Member und unter Moderator stehen).</p>${can?`<div class="row"><button type="button" data-profile-save="discord">Speichern</button></div>`:""}</div>`;
  if(kind==="bots")return `<div class="card" id="profileCard_bots"><h3>Bots und Kanal</h3><div id="profileBots"></div>${can?`<div class="row"><button type="button" data-profile-save="bots">Speichern</button></div>`:""}</div>`;
  return "";
}
// Karte in einen Container setzen und ihren Speichern-Knopf anbinden. reload: nach dem Speichern neu zeichnen.
function mountProfileCards(root,d,reload){
  const can=d.canEdit===true;
  let botsApi=null;
  if(root.querySelector("#profileBots"))botsApi=renderProfileBots(d,can);
  if(root.querySelector("#profileCard_discord"))loadProfileDiscordRoles(d.installation?.discord,root);
  bindCopyButtons(root);
  root.querySelectorAll("[data-profile-save]").forEach(btn=>btn.addEventListener("click",async()=>{
    const kind=btn.dataset.profileSave;btn.disabled=true;
    try{
      let body={},text="Gespeichert.";
      if(kind==="address"){if(!$("profileBaseUrl")){btn.disabled=false;return;}body={publicBaseUrl:$("profileBaseUrl").value};text="Adresse gespeichert.";}
      else if(kind==="game"){body={game:readGameFields("profile")};text="Spielname und Befehle gespeichert.";}
      else if(kind==="discord"){body={discord:readProfileDiscord(root)};text="Discord-Server und Rollen gespeichert.";}
      else if(kind==="bots"){const b=botsApi?.read();if(!b){showToast("Bitte zuerst mindestens den Twitch-Login des Haupt-Bots eintragen.","error",5000);btn.disabled=false;return;}body={bots:b};text="Bots und Kanal gespeichert.";}
      await saveProfilePart(body,text);
      if(reload)reload();else btn.disabled=false;
    }catch(e){showToast(e.message,"error",6000);btn.disabled=false;}
  }));
}
// Eine Karte (address | game | discord | bots) in einem Fachbereich anzeigen; nur für Administratoren.
async function mountProfileCard(container,kind){
  if(!container)return;
  if(!isGlobalAdmin()){container.innerHTML="";return;}
  try{
    const d=await fetchProfileData();
    container.innerHTML=profileCardHtml(kind,d);
    mountProfileCards(container,d,()=>mountProfileCard(container,kind));
  }catch(e){container.innerHTML="";}
}

async function renderAddressLogin(){
  const root=$("addressLogin");if(!root)return;
  if(!isGlobalAdmin()){root.innerHTML=`<div class="card">Keine Berechtigung für Adresse & Anmeldung.</div>`;return;}
  root.innerHTML=`<div class="title"><div><h2>Administration · Adresse & Anmeldung</h2><p class="hint">Öffentliche Adresse dieser Installation und die Weiterleitungsadressen für die Anmeldung bei Twitch, Discord und TikTok.</p></div></div><div id="addressLoginCard"></div>`;
  await mountProfileCard($("addressLoginCard"),"address");
}

async function renderProfileBranding(){
  const root=$("profileBranding");if(!root)return;
  if(!isGlobalAdmin()){root.innerHTML=`<div class="card">Keine Berechtigung für Profil & Branding.</div>`;return;}
  root.innerHTML=`<div class="card">Lade Profil & Branding …</div>`;
  let d;
  try{const r=await fetch("/api/admin/profile",{cache:"no-store"});d=await r.json();if(!r.ok)throw new Error(d.error||"Profil konnte nicht geladen werden.");}
  catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;return;}
  const p=d.installation||{},pb=d.publicBase||{},can=d.canEdit===true,dis=can?"":"disabled";
  const sourceText={env:"aus der Installation (PUBLIC_BASE_URL)",profile:"hier eingerichtet",none:"nicht eingerichtet"}[pb.source]||"";
  root.innerHTML=`
    <div class="title"><div><h2>Administration · Profil & Branding</h2><p class="hint">Name, Bilder und Impressum dieser Installation. Adresse, Bots, Punktespiel und Discord-Server stehen in ihren Fachbereichen. ${can?"":"Ändern dürfen nur Owner."}</p></div></div>
    <div class="card"><h3>Name der Oberfläche</h3>
      <input id="profileProductName" value="${esc(p.productName||"")}" maxlength="80" ${dis}>
      <p class="hint">Erscheint in Kopfzeile, Browser-Tab, Fußzeile, auf den öffentlichen Informationsseiten (Platzhalter <code>{{PRODUKTNAME}}</code>) und in Sicherungsdateien.</p></div>
    <div class="card"><h3>Impressum des Betreibers</h3>
      <label>Bezeichnung<input id="profileLegalLabel" value="${esc(p.operatorLegal?.label||"")}" maxlength="40" placeholder="Impressum" ${dis}></label>
      <label>Adresse (https://)<input id="profileLegalUrl" value="${esc(p.operatorLegal?.url||"")}" placeholder="https://beispiel.de/impressum" spellcheck="false" ${dis}></label>
      <p class="hint">Optional. Erscheint in der Fußzeile als zusätzlicher Link. Leer lassen, wenn keiner angezeigt werden soll. Der Hinweis auf den Ersteller (${esc(d.authorNotice?.name||"")}) und der Link zu Quellcode &amp; Lizenz sind fest und nicht änderbar.</p></div>
    ${can?`<div class="row"><button id="profileSave" type="button">Speichern</button></div>`:""}
    <div id="profileImages" class="card"></div>
    <div class="card"><h3>Lizenz</h3>${licenseCardHtml(d)}</div>
    <div class="card"><h3>Ersteinrichtung</h3><p class="hint">${p.setupCompletedAt?`Abgeschlossen am ${esc(new Date(p.setupCompletedAt).toLocaleString("de-DE"))}${p.setupCompletedBy?` · ${esc(p.setupCompletedBy)}`:""}.`:"Noch offen."}</p></div>`;
  bindCopyButtons(root);
  renderProfileImages(d);
  $("profileSave")?.addEventListener("click",async()=>{
    const btn=$("profileSave");btn.disabled=true;
    try{
      const body={productName:$("profileProductName").value,operatorLegal:{label:$("profileLegalLabel").value,url:$("profileLegalUrl").value}};
      const r=await fetch("/api/admin/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(j.error||"Speichern fehlgeschlagen.");
      showToast(j.discordPush&&!j.discordPush.ok?`Profil gespeichert. Der Discord-Dienst konnte nicht benachrichtigt werden: ${j.discordPush.error}`:"Profil & Branding gespeichert.",j.discordPush&&!j.discordPush.ok?"error":"success",j.discordPush&&!j.discordPush.ok?7000:undefined);
      await loadBranding();
      if(typeof refreshNavigationPermissions==="function")refreshNavigationPermissions();
      renderProfileBranding();
    }catch(e){showToast(e.message,"error",6000);btn.disabled=false;}
  });
}

async function renderConnections(){
  if(!hasRole("admin")){
    $("connections").innerHTML=`<div class="card">Keine Berechtigung für Twitch-Verbindungen.</div>`;
    return;
  }

  $("connections").innerHTML=`
    <div class="title"><h2>Twitch-Verbindungen</h2><button id="refreshConnections" type="button">Aktualisieren</button></div>
    <p class="hint">Hier werden die Twitch-Accounts mit der App verbunden. Die eigentliche Autorisierung darf nur ein Owner starten. Twitch öffnet dafür die Account-Auswahl.</p>
    <div id="connectionBotsCard"></div>
    <div id="connectionRedirectInfo" class="card compact-card"></div>
    <div id="connectionsList">Lade …</div>`;
  mountProfileCard($("connectionBotsCard"),"bots");

  async function load(){
    const r=await fetch("/api/connections",{cache:"no-store"});
    const data=await r.json();

    if(!r.ok){
      $("connectionsList").innerHTML=`<div class="card error">${esc(data.error||"Verbindungen konnten nicht geladen werden.")}</div>`;
      return;
    }

    $("connectionRedirectInfo").innerHTML=`
      <strong>OAuth Redirect URL</strong>
      <div class="connection-uri">${esc(data.redirectUri||"Nicht konfiguriert")}</div>
      <p class="hint">Diese URL muss exakt in der Twitch Developer Console bei der Anwendung dieser Installation eingetragen sein.</p>`;

    $("connectionsList").innerHTML=(data.items||[]).map(x=>{
      const state=x.valid
        ? `<span class="connection-state ok">Verbunden</span>`
        : x.connected
          ? `<span class="connection-state warn">Prüfen</span>`
          : `<span class="connection-state off">Nicht verbunden</span>`;

      const missing=(x.missingScopes||[]);
      const scopeInfo=missing.length
        ? `<div class="connection-warning">Fehlende Scopes: ${missing.map(esc).join(", ")}</div>`
        : `<div class="connection-scopes">Scopes vollständig</div>`;

      const accountInfo=x.authorizedLogin
        ? `<div class="hint">Autorisiert als @${esc(x.authorizedLogin)}${x.wrongAccount?" – falscher Account!":""}</div>`
        : `<div class="hint">Erwarteter Twitch-Login: @${esc(x.login)}</div>`;

      return `<div class="card connection-card">
        <div class="connection-main">
          <div>
            <div class="connection-title">${esc(x.displayName)} ${state}</div>
            <div>${esc(x.purpose||"")}</div>
            ${accountInfo}
            ${scopeInfo}
          </div>
          <div class="connection-actions">
            ${hasRole("owner")?`<button type="button" class="authorize-connection" data-account="${esc(x.key)}">${x.connected?"Neu autorisieren":"Autorisieren"}</button>`:""}
          </div>
        </div>
      </div>`;
    }).join("");

    $("connectionsList").querySelectorAll(".authorize-connection").forEach(btn=>{
      btn.addEventListener("click",async()=>{
        const account=btn.dataset.account;
        const r=await fetch(`/api/connections/${encodeURIComponent(account)}/authorize`,{method:"POST"});
        const j=await r.json().catch(()=>({}));
        if(!r.ok) return alert(j.error||"Autorisierung konnte nicht gestartet werden.");
        location.href=j.url;
      });
    });
  }

  $("refreshConnections").addEventListener("click",load);
  await load();
}



let giveawayPollTimer=null;

function stopGiveawayPolling(){
  if(giveawayPollTimer){
    clearInterval(giveawayPollTimer);
    giveawayPollTimer=null;
  }
}

function showGiveawayWinnerModal(winner, number, remaining){
  document.getElementById("giveawayWinnerModal")?.remove();
  const modal=document.createElement("div");
  modal.id="giveawayWinnerModal";
  modal.className="custom-modal";
  modal.innerHTML=`
    <div class="custom-modal-card giveaway-winner-modal">
      <div class="giveaway-winner-icon">🏆</div>
      <h3>Gewinner #${Number(number||1)}</h3>
      <div class="giveaway-winner-name">@${esc(winner?.name||winner?.login||"unbekannt")}</div>
      <p class="hint">${Number(remaining||0)} weitere mögliche Gewinner im Lostopf.</p>
      <button type="button" id="giveawayWinnerClose">Schließen</button>
    </div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector("#giveawayWinnerClose")?.addEventListener("click",close);
  modal.addEventListener("click",e=>{if(e.target===modal) close();});
}

function giveawayWinnersHtml(winners=[]){
  if(!winners.length) return `<p class="hint">Noch kein Gewinner gezogen.</p>`;
  return `<div class="giveaway-winner-list">${winners.map((w,i)=>`
    <div><span>#${i+1}</span><strong>@${esc(w.name||w.login)}</strong></div>`).join("")}</div>`;
}


// 9.1.0: Lurk-Rückkehr. Meldet im Chat, wie lange jemand nach einem Lurk-Command weg war.
function renderLurk(){
  const root=$("lurk");if(!root)return;
  settings.lurkReturn ||= {};
  const c=settings.lurkReturn;
  if(typeof c.enabled!=="boolean")c.enabled=false;
  if(!c.bot)c.bot=botDefault("main");
  if(typeof c.commands!=="string"||!c.commands.trim())c.commands="!lurk";
  c.maxHours=Number(c.maxHours)||12;
  c.minGapSeconds=Number.isFinite(Number(c.minGapSeconds))?Number(c.minGapSeconds):3;
  if(!Array.isArray(c.tiers))c.tiers=[];
  if(typeof c.fallbackText!=="string"||!c.fallbackText.trim())c.fallbackText="{user} ist nach {dauer} wieder aufgetaucht.";
  const canEdit=hasCapability("twitch.community.edit");
  const dis=canEdit?"":"disabled";
  const draw=()=>{
    root.innerHTML=`
      <div class="title"><div><h2>Lurk-Rückkehr</h2>
        <p class="hint">Wer einen Lurk-Command schreibt, wird gemerkt. Bei der nächsten Chatnachricht meldet der Bot, wie lange die Person weg war. Der Antworttext des Commands selbst bleibt auf der Seite <strong>Commands</strong>.</p></div></div>
      <div class="card">
        <label class="moderation-check"><input id="lurkEnabled" type="checkbox" ${c.enabled?"checked":""} ${dis}> Rückkehr-Meldungen aktiv</label>
        <div class="clips-grid">
          <div><span class="fieldlabel">Lurk-Commands (Komma getrennt)</span><input id="lurkCommands" value="${esc(c.commands)}" maxlength="120" ${dis}></div>
          <div><span class="fieldlabel">Bot</span><select id="lurkBot" ${dis}>${botOptionsHtml()}</select></div>
          <div><span class="fieldlabel">Lurk verfällt nach</span><div class="input-suffix"><input id="lurkMaxHours" type="number" min="1" max="48" value="${c.maxHours}" ${dis}><span>Std.</span></div></div>
          <div><span class="fieldlabel">Mindestabstand zwischen Meldungen</span><div class="input-suffix"><input id="lurkGap" type="number" min="0" max="60" value="${c.minGapSeconds}" ${dis}><span>Sek.</span></div></div>
        </div>
        <p class="hint">Der Mindestabstand schützt den Chat, wenn viele gleichzeitig zurückkommen: Meldungen innerhalb dieser Zeit entfallen. Meldungen werden zusätzlich mit niedrigem Vorrang gesendet und fallen bei Stau zuerst weg.</p>
      </div>
      <div class="card">
        <div class="title"><h3>Stufen nach Dauer</h3>${canEdit?'<button id="lurkAddTier" type="button">+ Stufe</button>':""}</div>
        <p class="hint">Es gilt die erste Stufe, deren Grenze noch nicht erreicht ist. Platzhalter: <code>{user}</code> <code>{dauer}</code> (z. B. „7 Minuten“, „1 Std. 20 Min.“) <code>{minuten}</code></p>
        <div id="lurkTiers">${c.tiers.map((t,i)=>`
          <div class="lurk-tier" data-i="${i}" style="display:grid;grid-template-columns:190px 1fr auto;gap:8px;align-items:start;margin:8px 0">
            <div class="input-suffix"><span>bis</span><input class="lurk-until" type="number" min="1" max="2880" value="${Number(t.untilMinutes)||1}" ${dis}><span>Min.</span></div>
            <textarea class="lurk-text" rows="2" maxlength="300" ${dis}>${esc(t.text||"")}</textarea>
            ${canEdit?'<button class="lurk-del" type="button">Löschen</button>':"<span></span>"}
          </div>`).join("")||'<p class="hint">Keine Stufen: es gilt nur der Text unten.</p>'}
        </div>
        <span class="fieldlabel">Darüber hinaus</span>
        <textarea id="lurkFallback" rows="2" maxlength="300" ${dis}>${esc(c.fallbackText)}</textarea>
      </div>`;
    const bot=$("lurkBot");if(bot)bot.value=c.bot;
    const sync=()=>{
      c.enabled=$("lurkEnabled").checked;
      c.commands=$("lurkCommands").value;
      c.bot=$("lurkBot").value;
      c.maxHours=Math.min(48,Math.max(1,Number($("lurkMaxHours").value)||12));
      c.minGapSeconds=Math.min(60,Math.max(0,Number($("lurkGap").value)||0));
      c.fallbackText=$("lurkFallback").value;
      root.querySelectorAll(".lurk-tier").forEach(row=>{
        const t=c.tiers[Number(row.dataset.i)];if(!t)return;
        t.untilMinutes=Math.min(2880,Math.max(1,Number(row.querySelector(".lurk-until").value)||1));
        t.text=row.querySelector(".lurk-text").value;
      });
      mark();
    };
    root.querySelectorAll("input,textarea,select").forEach(el=>el.addEventListener(el.type==="checkbox"||el.tagName==="SELECT"?"change":"input",sync));
    root.querySelectorAll(".lurk-until").forEach(el=>el.addEventListener("change",()=>{sync();c.tiers.sort((a,b)=>a.untilMinutes-b.untilMinutes);draw();}));
    root.querySelectorAll(".lurk-del").forEach(btn=>btn.addEventListener("click",()=>{sync();c.tiers.splice(Number(btn.closest(".lurk-tier").dataset.i),1);mark();draw();}));
    $("lurkAddTier")?.addEventListener("click",()=>{
      sync();
      const last=c.tiers.length?Math.max(...c.tiers.map(t=>Number(t.untilMinutes)||0)):0;
      c.tiers.push({id:uid(),untilMinutes:Math.min(2880,last+30),text:"{user} ist nach {dauer} zurück."});
      mark();draw();
    });
  };
  draw();
}

async function renderClips(){
  settings.clipSharing ||= {
    enabled:false,
    intervalSeconds:10,
    onlyLive:true,
    showCreator:true,
    message:"🎬 Neuer Clip: „{title}“ – erstellt von @{creator} {url}"
  };

  const c=settings.clipSharing;
  const root=$("clips");
  if(!root) return;

  // 9.28.0: Chat-Befehl „!clip“ (Standardwerte wie auf dem Server, falls die Einstellungen noch keine kennen)
  const CLIP_CMD_ALLOWED=[["everyone","Alle Zuschauer"],["subscribers","Abonnenten, VIPs, Moderatoren"],["vips","VIPs und Moderatoren"],["moderators","Moderatoren"],["broadcaster","Nur Kanalinhaber"]];
  const CLIP_CMD_DEFAULTS={cmdEnabled:false,cmdName:"!clip",cmdAllowed:"everyone",cmdCooldownUser:60,cmdCooldownGlobal:15,cmdDuration:30,cmdBot:"",cmdDiscord:true,cmdMessage:"🎬 @{user} hat einen Clip erstellt: {url}",cmdOfflineMessage:"@{user} Clips gehen nur im Livestream – der Kanal ist gerade nicht live.",cmdFailMessage:"@{user} Der Clip konnte leider nicht erstellt werden. Bitte später noch einmal versuchen."};
  const cmdVal=k=>c[k]===undefined||c[k]===null?CLIP_CMD_DEFAULTS[k]:c[k];
  const cmdBotSel=botList.some(b=>b.key===c.cmdBot)?c.cmdBot:(botList.some(b=>b.key===c.bot)?c.bot:botDefault("clips"));

  root.innerHTML=`
    <div class="title">
      <div>
        <h2>Clips</h2>
        <p class="hint">Neue Clips des Kanals automatisch erkennen und durch den hier gewählten Bot im Chat teilen.</p>
      </div>
      <button id="clipCheckNow" type="button">Jetzt prüfen</button>
    </div>

    <div class="card">
      <div class="clips-grid">
        <label class="moderation-check">
          <input id="clipEnabled" type="checkbox" ${c.enabled?"checked":""}>
          Automatisches Clip-Sharing aktiv
        </label>

        <div>
          <span class="fieldlabel">Bot</span>
          <select id="clipBot">${botOptionsHtml().replace(`value="${botList.some(b=>b.key===c.bot)?c.bot:botDefault("clips")}"`,m=>m+" selected")}</select>
        </div>

        <div>
          <span class="fieldlabel">Prüfintervall</span>
          <div class="input-suffix">
            <input id="clipInterval" type="number" min="5" max="120" value="${Number(c.intervalSeconds||10)}">
            <span>Sek.</span>
          </div>
        </div>

        <label class="moderation-check">
          <input id="clipOnlyLive" type="checkbox" ${c.onlyLive!==false?"checked":""}>
          Nur während Stream LIVE
        </label>

        <label class="moderation-check">
          <input id="clipShowCreator" type="checkbox" ${c.showCreator!==false?"checked":""}>
          Clip-Ersteller in Nachricht anzeigen
        </label>

        <div class="clips-message">
          <span class="fieldlabel">Chat-Nachricht</span>
          <textarea id="clipMessage">${esc(c.message||"")}</textarea>
          <p class="hint">Platzhalter: <code>{title}</code> <code>{url}</code> <code>{creator}</code> <code>{clip_id}</code></p>
        </div>
      </div>
    </div>

    <div class="card" id="clipCmdCard">
      <div class="title">
        <div>
          <h3>Clip-Befehl im Chat</h3>
          <p class="hint">Zuschauer erstellen mit einem Befehl einen Twitch-Clip. Der gewählte Bot schreibt den Link in den Chat, auf Wunsch wird der Clip auch in Discord gemeldet. Twitch erlaubt Clips nur, solange der Kanal live ist.</p>
        </div>
      </div>
      <div id="clipCmdScope" class="hint"></div>
      <div class="clips-grid">
        <label class="moderation-check">
          <input id="clipCmdEnabled" type="checkbox" ${cmdVal("cmdEnabled")?"checked":""}>
          Clip-Befehl aktiv
        </label>

        <div>
          <span class="fieldlabel">Befehl</span>
          <input id="clipCmdName" type="text" maxlength="30" value="${esc(cmdVal("cmdName"))}">
          <p class="hint">Ein gleichnamiger eigener Command wird vom Clip-Befehl überdeckt.</p>
        </div>

        <div>
          <span class="fieldlabel">Wer darf den Befehl nutzen?</span>
          <select id="clipCmdAllowed">${CLIP_CMD_ALLOWED.map(([k,l])=>`<option value="${k}" ${cmdVal("cmdAllowed")===k?"selected":""}>${esc(l)}</option>`).join("")}</select>
        </div>

        <div>
          <span class="fieldlabel">Antwort schreibt Bot</span>
          <select id="clipCmdBot">${botOptionsHtml().replace(`value="${cmdBotSel}"`,m=>m+" selected")}</select>
        </div>

        <div>
          <span class="fieldlabel">Clip-Länge</span>
          <div class="input-suffix"><input id="clipCmdDuration" type="number" min="5" max="60" value="${Number(cmdVal("cmdDuration"))}"><span>Sek.</span></div>
        </div>

        <div>
          <span class="fieldlabel">Pause pro Person</span>
          <div class="input-suffix"><input id="clipCmdCdUser" type="number" min="0" max="3600" value="${Number(cmdVal("cmdCooldownUser"))}"><span>Sek.</span></div>
          <p class="hint">Moderatoren und Kanalinhaber sind davon ausgenommen.</p>
        </div>

        <div>
          <span class="fieldlabel">Pause für alle</span>
          <div class="input-suffix"><input id="clipCmdCdGlobal" type="number" min="0" max="600" value="${Number(cmdVal("cmdCooldownGlobal"))}"><span>Sek.</span></div>
        </div>

        <label class="moderation-check">
          <input id="clipCmdDiscord" type="checkbox" ${cmdVal("cmdDiscord")?"checked":""}>
          Clip auch in Discord melden
        </label>

        <div class="clips-message">
          <span class="fieldlabel">Chat-Nachricht bei Erfolg</span>
          <textarea id="clipCmdMessage">${esc(cmdVal("cmdMessage"))}</textarea>
          <p class="hint">Platzhalter: <code>{user}</code> <code>{url}</code> <code>{title}</code> <code>{clip_id}</code> <code>{duration}</code></p>
        </div>

        <div class="clips-message">
          <span class="fieldlabel">Nachricht, wenn der Kanal nicht live ist</span>
          <textarea id="clipCmdOffline">${esc(cmdVal("cmdOfflineMessage"))}</textarea>
        </div>

        <div class="clips-message">
          <span class="fieldlabel">Nachricht, wenn der Clip nicht erstellt werden konnte</span>
          <textarea id="clipCmdFail">${esc(cmdVal("cmdFailMessage"))}</textarea>
          <p class="hint">Bei beiden: <code>{user}</code> nennt die Person, die den Befehl genutzt hat.</p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="title"><h3>Status</h3><span id="clipMonitorState" class="hint">Lade …</span></div>
      <div id="clipStatusBody" class="clips-status"></div>
    </div>
  `;

  const sync=()=>{
    c.enabled=$("clipEnabled").checked;
    c.bot=$("clipBot")?.value||c.bot||botDefault("clips");
    c.intervalSeconds=Math.min(120,Math.max(5,Number($("clipInterval").value||10)));
    c.onlyLive=$("clipOnlyLive").checked;
    c.showCreator=$("clipShowCreator").checked;
    c.message=$("clipMessage").value;
    c.cmdEnabled=$("clipCmdEnabled").checked;
    c.cmdName=$("clipCmdName").value.trim()||CLIP_CMD_DEFAULTS.cmdName;
    c.cmdAllowed=$("clipCmdAllowed").value;
    c.cmdBot=$("clipCmdBot")?.value||cmdBotSel;
    c.cmdDuration=Math.min(60,Math.max(5,Math.round(Number($("clipCmdDuration").value||30))));
    c.cmdCooldownUser=Math.min(3600,Math.max(0,Math.round(Number($("clipCmdCdUser").value||0))));
    c.cmdCooldownGlobal=Math.min(600,Math.max(0,Math.round(Number($("clipCmdCdGlobal").value||0))));
    c.cmdDiscord=$("clipCmdDiscord").checked;
    c.cmdMessage=$("clipCmdMessage").value;
    c.cmdOfflineMessage=$("clipCmdOffline").value;
    c.cmdFailMessage=$("clipCmdFail").value;
    mark();
  };

  ["clipEnabled","clipBot","clipInterval","clipOnlyLive","clipShowCreator","clipMessage","clipCmdEnabled","clipCmdName","clipCmdAllowed","clipCmdBot","clipCmdDuration","clipCmdCdUser","clipCmdCdGlobal","clipCmdDiscord","clipCmdMessage","clipCmdOffline","clipCmdFail"].forEach(id=>{
    const el=$(id);
    if(!el) return;
    el.addEventListener(el.type==="checkbox"||el.tagName==="SELECT"?"change":"input",sync);
  });

  async function loadClipStatus(){
    try{
      const r=await fetch("/api/clips/status",{cache:"no-store"});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);

      $("clipMonitorState").textContent=j.config?.enabled ? "Automatik AN" : "Automatik AUS";

      // 9.28.0: Hat das Kanal-Konto das Recht clips:edit? (nur relevant, wenn der Chat-Befehl eingeschaltet ist)
      const cs=$("clipCmdScope");
      if(cs){
        const ca=j.command?.channelAccount;
        if(!j.command?.enabled) cs.textContent="";
        else if(!ca) cs.innerHTML=`<div class="clip-error">⚠️ Verbindung des Kanal-Kontos konnte nicht geprüft werden.</div>`;
        else if(!ca.connected) cs.innerHTML=`<div class="clip-error">⚠️ Das Kanal-Konto „${esc(ca.displayName)}“ ist nicht mit Twitch verbunden. Bitte unter Administration → Twitch-Verbindungen verbinden (Recht <code>clips:edit</code>).</div>`;
        else if(!ca.hasScope) cs.innerHTML=`<div class="clip-error">⚠️ Dem Kanal-Konto „${esc(ca.displayName)}“ fehlt das Twitch-Recht <code>clips:edit</code>. Bitte unter Administration → Twitch-Verbindungen einmal neu verbinden.</div>`;
        else cs.innerHTML=`<span class="hint">✅ Kanal-Konto „${esc(ca.displayName)}“ ist verbunden und darf Clips erstellen.</span>`;
      }

      const last=j.state?.lastShared;
      $("clipStatusBody").innerHTML=`
        <div class="clip-status-item"><strong>${j.state?.initialized?"Ja":"Nein"}</strong><span>Initialisiert</span></div>
        <div class="clip-status-item"><strong>${Number(j.state?.knownCount||0)}</strong><span>bekannte Clips</span></div>
        <div class="clip-status-item"><strong>${j.state?.lastCheckedAt?esc(new Date(j.state.lastCheckedAt).toLocaleString("de-DE")):"–"}</strong><span>letzte Prüfung</span></div>
        <div class="clip-status-wide">
          <span class="fieldlabel">Zuletzt geteilt</span>
          ${last
            ? `<div><strong>${esc(last.title||"Clip")}</strong> · @${esc(last.creator||"unbekannt")}${last.source==="command"?` <span class="hint">(per Chat-Befehl)</span>`:""}<br><span class="hint">${esc(last.url||"")}</span>${Number.isFinite(Number(last.detectedAfterSeconds))&&last.detectedAfterSeconds!==null?`<br><span class="hint">Twitch lieferte den Clip ${Number(last.detectedAfterSeconds)>=90?Math.round(Number(last.detectedAfterSeconds)/60)+" Min.":Number(last.detectedAfterSeconds)+" Sek."} nach dem Erstellen.</span>`:""}</div>`
            : `<span class="hint">Noch kein Clip durch den Clip-Bot geteilt.</span>`}
        </div>
        ${j.state?.lastError?`<div class="clip-error">⚠️ ${esc(j.state.lastError)}</div>`:""}
      `;
    }catch(e){
      $("clipMonitorState").textContent="Statusfehler";
      $("clipStatusBody").innerHTML=`<div class="error">${esc(e.message)}</div>`;
    }
  }

  $("clipCheckNow")?.addEventListener("click",async()=>{
    const btn=$("clipCheckNow");
    btn.disabled=true;
    btn.textContent="Prüfe …";
    try{
      const r=await fetch("/api/clips/check",{method:"POST",cache:"no-store"});
      const j=await r.json();
      if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);

      if(j.initialized){
        $("clipMonitorState").textContent="Initialisiert – vorhandene Clips wurden nur vorgemerkt";
      }else if(j.skipped==="offline"){
        $("clipMonitorState").textContent="Kanal offline – nichts geteilt";
      }else{
        $("clipMonitorState").textContent=`Prüfung fertig · ${Number(j.found||0)} neue Clips`;
      }
      await loadClipStatus();
    }catch(e){
      $("clipMonitorState").textContent=`Fehler: ${e.message}`;
    }finally{
      btn.disabled=false;
      btn.textContent="Jetzt prüfen";
    }
  });

  await loadClipStatus();
}

async function renderGiveaway(){
  stopGiveawayPolling();

  const root=$("giveaway");
  if(!root) return;

  root.innerHTML=`<div class="title"><h2>Gewinnspiel</h2><button id="giveawayRefresh" type="button">Aktualisieren</button></div><div class="card">Lade …</div>`;

  const loadData=async()=>{
    const r=await fetch("/api/giveaway",{cache:"no-store"});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||"Gewinnspiel konnte nicht geladen werden.");
    return data;
  };

  let data;
  try{
    data=await loadData();
  }catch(e){
    root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;
    return;
  }

  const g=data.current;
  const canEdit=hasCapability("twitch.giveaway.edit");

  if(!g || (g.endedAt && !g.active)){
    root.innerHTML=`
      <div class="title">
        <div>
          <h2>Gewinnspiel</h2>
          <p class="hint">${esc(botNameFor("giveaway"))} übernimmt Start- und Gewinnernachrichten.</p>
        </div>
        <button id="giveawayRefresh" type="button">Aktualisieren</button>
      </div>

      ${g?`
        <div class="card giveaway-last">
          <h3>Letztes Gewinnspiel</h3>
          <p><strong>${esc(g.title||"Ohne Bezeichnung")}</strong> · ${g.type==="keyword"?"Keyword":"Random"} · ${g.entries?.length||0} Teilnehmende</p>
          <div class="giveaway-previous-winners">
            <span class="fieldlabel">Gewinner</span>
            ${giveawayWinnersHtml(g.winners || (g.winner?[g.winner]:[]))}
          </div>
        </div>`:""}

      <div class="card">
        <h3>Neues Gewinnspiel erstellen</h3>
        <div class="giveaway-create-grid">
          <div>
            <span class="fieldlabel">Typ</span>
            <select id="giveawayType">
              <option value="keyword">Keyword</option>
              <option value="random">Random</option>
            </select>
          </div>
          <div>
            <span class="fieldlabel">Bezeichnung / Preis (optional)</span>
            <input id="giveawayTitle" placeholder="z. B. Goodie-Paket">
          </div>
          <div id="giveawayKeywordWrap">
            <span class="fieldlabel">Code-Wort</span>
            <input id="giveawayKeyword" placeholder="z. B. KARRIERE">
          </div>
        </div>

        <div class="giveaway-options">
          <label class="moderation-check">
            <input id="giveawayExcludeMods" type="checkbox" checked>
            Moderatoren vom Gewinnspiel ausschließen
          </label>
          <label class="moderation-check">
            <input id="giveawayExcludeBroadcaster" type="checkbox" checked>
            Owner / Kanalkonto ausschließen
          </label>
          <label class="moderation-check">
            <input id="giveawayExcludeVIPs" type="checkbox">
            VIPs ausschließen
          </label>
        </div>

        <p id="giveawayTypeHint" class="hint">Keyword: Nur User, die exakt das Code-Wort schreiben, landen einmalig im Lostopf.</p>
        <button id="giveawayCreateBtn" type="button" ${canEdit?"":"disabled"}>Gewinnspiel vorbereiten</button>
      </div>

      ${renderGiveawayHistory(data.history||[])}
    `;

    const type=$("giveawayType");
    const syncType=()=>{
      const keyword=type.value==="keyword";
      $("giveawayKeywordWrap").classList.toggle("hidden",!keyword);
      $("giveawayTypeHint").textContent=keyword
        ?"Keyword: Nur User, die exakt das Code-Wort schreiben, landen einmalig im Lostopf."
        :"Random: Jeder User, der während des laufenden Gewinnspiels etwas schreibt, landet einmalig im Lostopf.";
    };
    type?.addEventListener("change",syncType);
    syncType();

    $("giveawayCreateBtn")?.addEventListener("click",async()=>{
      const payload={
        type:$("giveawayType").value,
        title:$("giveawayTitle").value.trim(),
        keyword:$("giveawayKeyword")?.value.trim()||"",
        excludeModerators:$("giveawayExcludeMods").checked,
        excludeBroadcaster:$("giveawayExcludeBroadcaster").checked,
        excludeVIPs:$("giveawayExcludeVIPs").checked
      };
      const rr=await fetch("/api/giveaway/create",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      const jj=await rr.json().catch(()=>({}));
      if(!rr.ok) return alert(jj.error||"Gewinnspiel konnte nicht erstellt werden.");
      await renderGiveaway();
    });

    $("giveawayRefresh")?.addEventListener("click",renderGiveaway);
    return;
  }

  const entries=g.entries||[];
  const winners=g.winners || (g.winner?[g.winner]:[]);
  const winnerIds=new Set(winners.map(w=>String(w.userId||"")));
  const remaining=entries.filter(x=>!winnerIds.has(String(x.userId||""))).length;
  const status=g.active?"LÄUFT":"VORBEREITET";

  root.innerHTML=`
    <div class="title">
      <div>
        <h2>Gewinnspiel</h2>
        <p class="hint">Reagierender Bot: <strong>${esc(botNameFor("giveaway"))}</strong></p>
      </div>
      <button id="giveawayRefresh" type="button">Aktualisieren</button>
    </div>

    <div class="card giveaway-live-card">
      <div class="giveaway-heading">
        <div>
          <span class="mode-badge ${g.active?"mode-and":"mode-or"}">${status}</span>
          <h3>${esc(g.title||"Gewinnspiel")}</h3>
          <p class="hint">${g.type==="keyword"?`Keyword: ${esc(g.keyword)}`:"Random unter aktiven Chattern"}</p>
          <div class="giveaway-eligibility ${g.active?"locked":""}">
            <span class="fieldlabel">Teilnahmeberechtigung</span>
            <label class="moderation-check">
              <input id="giveawayCurrentExcludeMods" type="checkbox" ${g.excludeModerators?"checked":""} ${g.active?"disabled":""}>
              Moderatoren ausschließen
            </label>
            <label class="moderation-check">
              <input id="giveawayCurrentExcludeBroadcaster" type="checkbox" ${g.excludeBroadcaster?"checked":""} ${g.active?"disabled":""}>
              Owner / Kanalkonto ausschließen
            </label>
            <label class="moderation-check">
              <input id="giveawayCurrentExcludeVIPs" type="checkbox" ${g.excludeVIPs?"checked":""} ${g.active?"disabled":""}>
              VIPs ausschließen
            </label>
            ${!g.active?`<button id="giveawaySaveOptionsBtn" type="button" ${canEdit?"":"disabled"}>Teilnahmeoptionen speichern</button>`:""}
            ${g.active?`<p class="hint">Während des laufenden Gewinnspiels gesperrt. VIPs werden nur ausgeschlossen, wenn die VIP-Option ausdrücklich aktiviert wurde.</p>`:""}
          </div>
        </div>
        <div class="giveaway-count"><strong id="giveawayEntryCount">${entries.length}</strong><span>im Lostopf</span></div>
      </div>

      <div class="giveaway-actions">
        ${!g.active?`<button id="giveawayStartBtn" type="button" ${canEdit?"":"disabled"}>Starten</button>`:""}
        ${g.active?`<button id="giveawayDrawBtn" type="button" ${canEdit&&remaining>0?"":"disabled"}>🎲 Gewinner ziehen</button>`:""}
        ${g.active?`<button id="giveawayEndBtn" class="danger" type="button" ${canEdit?"":"disabled"}>Gewinnspiel beenden</button>`:""}
      </div>

      <div class="giveaway-live-grid">
        <div class="giveaway-entries">
          <span class="fieldlabel">Teilnehmende</span>
          <div id="giveawayEntriesBox">
            ${entries.length
              ? `<div class="giveaway-entry-list">${entries.map(x=>`<span>${x.isVip?"💎 ":""}@${esc(x.name||x.login)}</span>`).join("")}</div>`
              : `<p class="hint">Noch niemand im Lostopf.</p>`}
          </div>
        </div>

        <div class="giveaway-winners">
          <span class="fieldlabel">Bereits gezogene Gewinner</span>
          <div id="giveawayWinnersBox">${giveawayWinnersHtml(winners)}</div>
          <p id="giveawayRemaining" class="hint">${remaining} weitere mögliche Gewinner.</p>
        </div>
      </div>
    </div>

    ${renderGiveawayHistory(data.history||[])}
  `;

  $("giveawayRefresh")?.addEventListener("click",renderGiveaway);

  $("giveawaySaveOptionsBtn")?.addEventListener("click",async()=>{
    const rr=await fetch("/api/giveaway/options",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        excludeModerators:$("giveawayCurrentExcludeMods")?.checked ?? true,
        excludeBroadcaster:$("giveawayCurrentExcludeBroadcaster")?.checked ?? true,
        excludeVIPs:$("giveawayCurrentExcludeVIPs")?.checked ?? false
      })
    });
    const jj=await rr.json().catch(()=>({}));
    if(!rr.ok) return alert(jj.error||"Teilnahmeoptionen konnten nicht gespeichert werden.");
    await renderGiveaway();
  });

  $("giveawayStartBtn")?.addEventListener("click",async()=>{
    const rr=await fetch("/api/giveaway/start",{method:"POST"});
    const jj=await rr.json().catch(()=>({}));
    if(!rr.ok) return alert(jj.error||"Start fehlgeschlagen.");
    await renderGiveaway();
  });

  $("giveawayDrawBtn")?.addEventListener("click",async()=>{
    if(!(await askAs("draw","Jetzt zufällig einen weiteren Gewinner aus dem aktuellen Lostopf ziehen?"))) return;

    const btn=$("giveawayDrawBtn");
    if(btn) btn.disabled=true;

    const rr=await fetch("/api/giveaway/draw",{method:"POST"});
    const jj=await rr.json().catch(()=>({}));
    if(!rr.ok){
      if(btn) btn.disabled=false;
      return alert(jj.error||"Auslosung fehlgeschlagen.");
    }

    showGiveawayWinnerModal(jj.winner,jj.winnerNumber,jj.remaining);
    await refreshLiveGiveawayStatus();
  });

  $("giveawayEndBtn")?.addEventListener("click",async()=>{
    if(!(await askAs("end","Gewinnspiel jetzt beenden? Bereits gezogene Gewinner bleiben gespeichert."))) return;
    const rr=await fetch("/api/giveaway/end",{method:"POST"});
    const jj=await rr.json().catch(()=>({}));
    if(!rr.ok) return alert(jj.error||"Beenden fehlgeschlagen.");
    await renderGiveaway();
  });

  async function refreshLiveGiveawayStatus(){
    if(!g.active) return;
    try{
      const fresh=await loadData();
      const fg=fresh.current;
      if(!fg || !fg.active){
        await renderGiveaway();
        return;
      }

      const freshEntries=fg.entries||[];
      const freshWinners=fg.winners || (fg.winner?[fg.winner]:[]);
      const winIds=new Set(freshWinners.map(w=>String(w.userId||"")));
      const freshRemaining=freshEntries.filter(x=>!winIds.has(String(x.userId||""))).length;

      const countEl=$("giveawayEntryCount");
      const entriesBox=$("giveawayEntriesBox");
      const winnersBox=$("giveawayWinnersBox");
      const remainingEl=$("giveawayRemaining");
      const drawBtn=$("giveawayDrawBtn");

      if(countEl) countEl.textContent=String(freshEntries.length);
      if(entriesBox) entriesBox.innerHTML=freshEntries.length
        ? `<div class="giveaway-entry-list">${freshEntries.map(x=>`<span>${x.isVip?"💎 ":""}@${esc(x.name||x.login)}</span>`).join("")}</div>`
        : `<p class="hint">Noch niemand im Lostopf.</p>`;
      if(winnersBox) winnersBox.innerHTML=giveawayWinnersHtml(freshWinners);
      if(remainingEl) remainingEl.textContent=`${freshRemaining} weitere mögliche Gewinner.`;
      if(drawBtn) drawBtn.disabled=!canEdit || freshRemaining<1;
    }catch(e){
      console.warn("Gewinnspiel-Aktualisierung fehlgeschlagen:",e);
    }
  }

  if(g.active){
    giveawayPollTimer=setInterval(()=>{
      if(!$("giveaway")?.classList.contains("hidden")) refreshLiveGiveawayStatus();
    },5000);
  }
}

function renderGiveawayHistory(history){
  if(!history?.length) return "";
  return `
    <div class="card">
      <h3>Letzte Gewinnspiele</h3>
      <div class="giveaway-history">
        ${history.slice(0,8).map(g=>{
          const winners=g.winners || (g.winner?[g.winner]:[]);
          return `
          <div class="giveaway-history-row">
            <div><strong>${esc(g.title||"Gewinnspiel")}</strong><small>${g.type==="keyword"?`Keyword: ${esc(g.keyword||"")}`:"Random"}</small></div>
            <div>${g.entries?.length||0} Teilnehmende</div>
            <div>${winners.length?`🏆 ${winners.map(w=>`@${esc(w.name||w.login)}`).join(", ")}`:"ohne Gewinner"}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}



let pendingBackupFile=null;
let pendingBackupSummary=null;

function backupSectionLabel(key){
  return ({
    settings:"Einstellungen",
    users:"Benutzer & Rollen",
    giveaways:"Gewinnspiele",
    watchtime:"Watchtime",
    usageStats:"Command- / Auto-Reply-Statistiken",
    clipState:"Clip-Status",
    eventProfiles:"Event-Profile",
    stubenkontrolle:`${gameName()} / ${pointsName()}`,
    publicPages:"Öffentliche Webseiten",
    discordCommunity:"Discord · Community & Ankündigungen",
    wordFilter:"Zentraler Wortfilter",
    discordModeration:"Discord · Moderation & Userhistorie",
    discordReports:"Discord · Meldesystem",
    discordChannelTimes:"Discord · Kanalzeiten",
    discordEmergency:"Discord · Notfallmodus-Konfiguration",
    discordLogs:"Discord · Logs & Benachrichtigungen",
    discordSocial:"Discord · Social Media"
  })[key] || key;
}

function renderBackupRestore(){
  if(!hasRole("owner")){
    $("backup").innerHTML=`<div class="card error">Backup / Restore ist nur für Owner und den lokalen Admin verfügbar.</div>`;
    return;
  }

  $("backup").innerHTML=`
    <div class="title">
      <div>
        <h2>Backup / Restore</h2>
        <p class="hint">Konfiguration und ausgewählte persistente Daten sichern oder wiederherstellen. OAuth-Tokens, App-Tokens und Sessions sind grundsätzlich ausgeschlossen.</p>
      </div>
    </div>

    <div class="backup-grid">
      <div class="card">
        <h3>Backup erstellen</h3>
        <p class="hint">Wähle aus, welche Bereiche in die JSON-Datei aufgenommen werden sollen.</p>

        <h4 class="backup-group-title">Twitch & Control Center</h4>
        <div class="backup-options">
          <label><input type="checkbox" class="backup-export-section" value="settings" checked> <span><strong>Einstellungen</strong><small>Commands, Timer, Community, Twitch-Moderation, Auto-Replies, Clips</small></span></label>\n          <label><input type="checkbox" class="backup-export-section" value="wordFilter" checked> <span><strong>Zentraler Wortfilter</strong><small>Begriffe, Kategorien, Plattformregeln und Allowlist</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="users" checked> <span><strong>Benutzer & Rollen</strong><small>Freigaben und Rollen im Control Center</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="giveaways" checked> <span><strong>Gewinnspiele</strong><small>Aktuelles Gewinnspiel und Historie</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="watchtime" checked> <span><strong>Watchtime</strong><small>Lokale Watchtime aller erfassten Nutzer</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="usageStats" checked> <span><strong>Statistiken</strong><small>Command- und Auto-Reply-Nutzung</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="clipState" checked> <span><strong>Clip-Status</strong><small>Bekannte Clips und letzter Prüfstand</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="eventProfiles" checked> <span><strong>Event-Profile</strong><small>Gespeicherte Profile und aktives Profil</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="stubenkontrolle" checked> <span><strong>${esc(gameName())} / ${esc(pointsName())}</strong><small>Konten, Runden, Buchungen und Spieleinstellungen – ohne Overlay-Schlüssel</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="images" checked> <span><strong>Bilder</strong><small>Hochgeladenes Logo, Banner, Emblem und Figur (bis 20 MB)</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="publicPages" checked> <span><strong>Öffentliche Webseiten</strong><small>Entwürfe, veröffentlichte Snapshots, Stammdaten und Verifizierungsdatei</small></span></label>
        </div>

        <h4 class="backup-group-title">Discord</h4>
        <div class="backup-options">
          <label><input type="checkbox" class="backup-export-section" value="discordCommunity" checked> <span><strong>Community & Ankündigungen</strong><small>Freischaltung, Regeln, Member-Zustände und Discord-Ankündigungen</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="discordModeration" checked> <span><strong>Moderation & Userhistorie</strong><small>Regeln, Eskalationsstände und bis zu 2.000 Moderationsereignisse</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="discordReports" checked> <span><strong>Meldesystem</strong><small>Konfiguration, Tickets und Ticketstatus – ohne Attachment-Binärdateien</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="discordChannelTimes" checked> <span><strong>Kanalzeiten</strong><small>Zeitprofile und Verlauf – keine aktiven Rechte-Snapshots</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="discordEmergency" checked> <span><strong>Notfallmodus</strong><small>Stufen, Kanäle, Nachrichten und Verlauf – kein aktiver Lockdown-Snapshot</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="discordLogs" checked> <span><strong>Logs & Benachrichtigungen</strong><small>Zielkanäle, Aktivierung und Nachrichtentemplates</small></span></label>
          <label><input type="checkbox" class="backup-export-section" value="discordSocial" checked> <span><strong>Social Media</strong><small>Discord-Ziele, Polling-Status und Veröffentlichungsverlauf – ohne Tokens</small></span></label>
        </div>

        <div class="backup-note">
          <strong>Geheimnisse ausgeschlossen:</strong> Twitch OAuth-/Refresh-Tokens, Discord Bot Token und Client Secret, Instagram-/TikTok-Tokens, OAuth-Zustände, Login-Sessions und lokales Admin-Passwort. Aktive Rechte-Snapshots von Kanalzeiten und Notfallmodus werden ebenfalls nicht exportiert.
        </div>

        <button id="backupExportBtn" type="button">Backup herunterladen</button>
      </div>

      <div class="card">
        <h3>Backup wiederherstellen</h3>
        <p class="hint">Eine zuvor exportierte JSON-Datei auswählen. Vor dem Restore wird der Inhalt geprüft und angezeigt.</p>

        <input id="backupFileInput" type="file" accept=".json,application/json">

        <div id="backupInspectArea" class="backup-inspect hidden"></div>
      </div>
    </div>`;

  $("backupExportBtn")?.addEventListener("click",exportBackup);
  $("backupFileInput")?.addEventListener("change",inspectBackupFile);
}

async function exportBackup(){
  const selected=[...document.querySelectorAll(".backup-export-section:checked")].map(x=>x.value);
  if(!selected.length){
    alert("Bitte mindestens einen Bereich auswählen.");
    return;
  }

  const btn=$("backupExportBtn");
  if(btn) btn.disabled=true;

  try{
    const r=await fetch("/api/backup/export",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({include:selected})
    });

    const data=await r.json();
    if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);

    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    const day=new Date().toISOString().slice(0,10);
    a.href=url;
    a.download=`bwk-control-center-backup-${day}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }catch(e){
    alert(`Backup konnte nicht erstellt werden: ${e.message}`);
  }finally{
    if(btn) btn.disabled=false;
  }
}

async function inspectBackupFile(event){
  const file=event.target.files?.[0];
  pendingBackupFile=null;
  pendingBackupSummary=null;

  const area=$("backupInspectArea");
  if(!area) return;

  if(!file){
    area.classList.add("hidden");
    area.innerHTML="";
    return;
  }

  try{
    const text=await file.text();
    const backup=JSON.parse(text);

    const r=await fetch("/api/backup/inspect",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({backup})
    });
    const summary=await r.json();
    if(!r.ok) throw new Error(summary.error||`HTTP ${r.status}`);

    pendingBackupFile=backup;
    pendingBackupSummary=summary;

    area.classList.remove("hidden");
    area.innerHTML=`
      <div class="backup-file-meta">
        <strong>${esc(file.name)}</strong>
        <span>Backup-Version: ${esc(summary.meta?.appVersion||"unbekannt")}</span>
        <span>Erstellt: ${fmtDiagDate(summary.meta?.createdAt)}</span>
        <span>Kanal: ${esc(summary.meta?.channelLogin||"–")}</span>
      </div>

      <h4>Wiederherzustellende Bereiche</h4>
      <div class="backup-options">
        ${(summary.sections||[]).map(s=>`
          <label>
            <input type="checkbox" class="backup-restore-section" value="${esc(s.key)}" checked>
            <span><strong>${esc(s.label)}</strong><small>${esc(s.detail||"")}</small></span>
          </label>`).join("")}
      </div>

      <div class="backup-warning">
        <strong>Achtung:</strong> Ausgewählte Bereiche werden durch die Daten aus dem Backup ersetzt. Tokens und Sessions bleiben unverändert.
      </div>

      <button id="backupRestoreBtn" class="danger-strong" type="button">Ausgewählte Bereiche wiederherstellen</button>`;

    $("backupRestoreBtn")?.addEventListener("click",restoreBackupNow);
  }catch(e){
    area.classList.remove("hidden");
    area.innerHTML=`<div class="error">Backup konnte nicht geprüft werden: ${esc(e.message)}</div>`;
  }
}

async function restoreBackupNow(){
  if(!pendingBackupFile) return;

  const selected=[...document.querySelectorAll(".backup-restore-section:checked")].map(x=>x.value);
  if(!selected.length){
    alert("Bitte mindestens einen Bereich auswählen.");
    return;
  }

  const labels=selected.map(backupSectionLabel).join(", ");
  const ok=await askConfirm({
    title:"Backup wiederherstellen",
    text:`Backup wirklich wiederherstellen? Überschrieben werden: ${labels}`,
    confirmLabel:"WIEDERHERSTELLEN",
    cancelLabel:"ABBRECHEN",
    danger:true
  });
  if(!ok) return;

  const btn=$("backupRestoreBtn");
  if(btn) btn.disabled=true;

  try{
    const r=await fetch("/api/backup/restore",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({backup:pendingBackupFile,include:selected})
    });
    const j=await r.json();
    if(!r.ok) throw new Error(j.error||`HTTP ${r.status}`);

    alert(`Backup wiederhergestellt: ${(j.restored||[]).map(backupSectionLabel).join(", ")}`);

    // Settings im Browser neu laden, damit der sichtbare Zustand direkt passt.
    const settingsResponse=await fetch("/api/settings",{cache:"no-store"});
    const fresh=await settingsResponse.json();
    if(settingsResponse.ok){
      settings=fresh;
      dirty=false;
      $("saveState").textContent="Keine ungespeicherten Änderungen";
      renderAll();
      applyPermissions();
    }

    pendingBackupFile=null;
    pendingBackupSummary=null;
    if($("backupFileInput")) $("backupFileInput").value="";
    renderBackupRestore();
  }catch(e){
    alert(`Restore fehlgeschlagen: ${e.message}`);
  }finally{
    if(btn) btn.disabled=false;
  }
}

function fmtDiagDate(value){
  if(!value) return "–";
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleString("de-DE");
}
function formatBytes(value){
  const n=Number(value||0);
  if(!Number.isFinite(n)||n<0)return "–";
  if(n<1024)return `${n} B`;
  if(n<1024*1024)return `${(n/1024).toFixed(1)} KB`;
  if(n<1024*1024*1024)return `${(n/1024/1024).toFixed(1)} MB`;
  return `${(n/1024/1024/1024).toFixed(2)} GB`;
}


function fmtUptime(total){
  let s=Math.max(0,Number(total||0));
  const d=Math.floor(s/86400); s%=86400;
  const h=Math.floor(s/3600); s%=3600;
  const m=Math.floor(s/60);
  return [d?`${d} T`:"",h?`${h} Std`:"",`${m} Min`].filter(Boolean).join(" ");
}

function diagState(ok, okText="OK", badText="Fehler"){
  return `<span class="diag-badge ${ok?"ok":"bad"}">${ok?"✓":"!"} ${esc(ok?okText:badText)}</span>`;
}


let discordStatusCache=null;

function discordStatusBadge(ok, yes="OK", no="FEHLER"){
  return `<span class="diag-badge ${ok?"ok":"bad"}">${ok?yes:no}</span>`;
}
function discordToneBadge(text,tone="neutral"){
  const safeTone=["ok","bad","warn","neutral"].includes(tone)?tone:"neutral";
  return `<span class="diag-badge ${safeTone}">${esc(text)}</span>`;
}

function discordFormatTime(value){
  if(!value) return "–";
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? esc(String(value)) : d.toLocaleString("de-DE");
}

async function loadDiscordStatus(force=false){
  if(discordStatusCache && !force) return discordStatusCache;
  const r=await fetch("/api/discord/status",{cache:"no-store"});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||"Discord-Status konnte nicht geladen werden.");
  discordStatusCache=data;
  return data;
}

function discordConnectionCard(data){
  const gatewayReady=!!data?.gateway?.ready;
  const guildFound=!!data?.guild?.found;
  const reachable=data?.serviceReachable!==false;
  return `
    <div class="status-grid discord-status-grid">
      <div class="status-card"><span>Discord-Dienst</span><strong>${reachable?"✅ erreichbar":"❌ nicht erreichbar"}</strong></div>
      <div class="status-card"><span>Gateway</span><strong>${gatewayReady?"✅ verbunden":"❌ getrennt"}</strong></div>
      <div class="status-card"><span>Server</span><strong>${guildFound?`✅ ${esc(data.guild.name||"gefunden")}`:"❌ nicht gefunden"}</strong></div>
      <div class="status-card"><span>Bot</span><strong>${data?.bot?.username?`✅ ${esc(data.bot.username)}`:"–"}</strong></div>
    </div>`;
}

async function renderDiscordOverview(){
  const root=$("discordOverview");
  if(!root)return;
  if(!hasCapability("discord.dashboard.view")){
    root.innerHTML=`<div class="card error">Kein Discord-Dashboard-Zugang.</div>`;
    return;
  }
  root.innerHTML=`<div class="card">Discord-Lagebild wird geladen …</div>`;
  try{
    const [statusRes,dashRes]=await Promise.all([
      fetch("/api/discord/status",{cache:"no-store"}),
      fetch("/api/discord/dashboard",{cache:"no-store"})
    ]);
    const data=await statusRes.json(),d=await dashRes.json();
    if(!dashRes.ok)throw new Error(d.error||"Lagebild konnte nicht geladen werden.");

    const roleValues=Object.values(data?.checks?.roles||{}),categoryValues=Object.values(data?.checks?.categories||{}),channelValues=Object.values(data?.checks?.channels||{});
    const roleOk=roleValues.filter(x=>x?.ok).length,categoryOk=categoryValues.filter(x=>x?.ok).length,channelOk=channelValues.filter(x=>x?.ok).length;
    const hierarchy=!!data?.checks?.botRoleHierarchy?.ok,service=d.service||{},reports=d.reports||{},mod=d.moderation||{},onb=d.onboarding||{},ct=d.channelTimes||{},em=d.emergency||{};
    const warnings=d.warnings||[],critical=warnings.filter(x=>x.level==="critical"||x.level==="error");
    const openReports=Number(reports.open||0),closedChannels=ct.closed||[];
    const quick=[];
    if(hasCapability("discord.reports.view")&&moduleEnabledUi("discordReports"))quick.push({tab:"discordReports",label:`Meldungen${openReports?` (${openReports})`:""}`});
    if(hasCapability("discord.moderation.view"))quick.push({tab:"discordModeration",label:"Moderation"});
    if(hasCapability("discord.channel-times.view")&&moduleEnabledUi("discordChannelTimes"))quick.push({tab:"discordChannelTimes",label:"Kanalzeiten"}); // 9.9.0
    if(isGlobalAdmin())quick.push({tab:"discordEmergency",label:em.active?"Notfallmodus öffnen":"Notfallmodus"});
    if(isGlobalAdmin())quick.push({tab:"discordLogsAdmin",label:"Logs"});
    if(isGlobalOwner()&&d.social&&moduleEnabledUi("socialMedia"))quick.push({tab:"socialOverview",label:"Social Media"}); // 9.4.0

    const systemHealthy=!!service.gatewayReady&&!!service.guildFound&&!service.lastError;
    root.innerHTML=`
      <div class="title discord-page-title">
        <div>
          <h2>Discord · Lagebild</h2>
          <p class="hint">Zentraler Überblick über Betrieb, Community, Moderation und aktuelle Schutzmechanismen.</p>
        </div>
        <button id="discordVerifyBtn" type="button">Jetzt prüfen</button>
      </div>

      ${em.active?`<div class="card emergency-status emergency-active dashboard-alert">
        <div><strong>🚨 ${esc(em.levelLabel||"Notfallmodus")} aktiv</strong><p>${esc(em.reason||"Kein Grund angegeben")} · aktiviert durch ${esc(em.actor||"unbekannt")}${em.endsAt?` · bis ${esc(discordFormatTime(em.endsAt))}`:" · bis manuell beendet"}</p></div>
        ${isGlobalAdmin()?'<button type="button" class="secondary" data-dashboard-tab="discordEmergency">Öffnen</button>':""}
      </div>`:""}

      ${critical.length?`<div class="card error dashboard-alert-list"><strong>${critical.length} Hinweis${critical.length===1?"":"e"} benötigen Aufmerksamkeit</strong>${critical.slice(0,5).map(x=>`<div><span class="diag-badge bad">${esc(x.area)}</span> ${esc(x.text)}</div>`).join("")}</div>`:""}

      <div class="dashboard-kpis">
        <button class="dashboard-kpi" data-dashboard-tab="discordReports" ${hasCapability("discord.reports.view")&&moduleEnabledUi("discordReports")?"":"disabled"}><strong>${openReports}</strong><span>offene Meldungen</span><small>${reports.lastCreatedAt?`letzte ${esc(discordFormatTime(reports.lastCreatedAt))}`:"keine neue Meldung"}</small></button>
        <button class="dashboard-kpi" data-dashboard-tab="discordSanctions" ${hasCapability("discord.moderation.view")?"":"disabled"}><strong>${Number(mod.activeEscalations||0)}</strong><span>aktive Eskalationen</span><small>${Number(mod.days7||0)} Moderationsereignisse / 7 Tage</small></button>
        <button class="dashboard-kpi" data-dashboard-tab="discordChannelTimes" ${hasCapability("discord.channel-times.view")?"":"disabled"}><strong>${closedChannels.length}</strong><span>Kanäle in Nachtruhe</span><small>${ct.enabled?(ct.suspended?"durch Notfallmodus pausiert":"Zeitsteuerung aktiv"):"Zeitsteuerung aus"}</small></button>
        <button class="dashboard-kpi" data-dashboard-tab="discordWelcome" ${hasCapability("discord.onboarding.view")?"":"disabled"}><strong>${Number(onb.totalVerified||0)}</strong><span>Freischaltungen gesamt</span><small>${onb.enabled?"Freischaltung aktiv":"Freischaltung deaktiviert"}</small></button>
      </div>

      <div class="dashboard-two-col">
        <div class="card">
          <div class="title compact-title"><div><h3>System & Discord</h3><p class="hint">Live-Zustand des Discord-Dienstes.</p></div>${discordStatusBadge(systemHealthy,"BEREIT","PRÜFEN")}</div>
          ${discordConnectionCard(data)}
          <div class="discord-meta-grid dashboard-system-meta">
            <div><span>Uptime</span><strong>${esc(fmtUptime(service.uptimeSeconds||0))}</strong></div>
            <div><span>Letztes Gateway-Event</span><strong>${esc(discordFormatTime(service.lastEventAt))}</strong></div>
          </div>
          <div class="summary-grid compact-summary">
            <div class="summary-item"><strong>${roleOk}/${roleValues.length}</strong><span>Rollen</span></div>
            <div class="summary-item"><strong>${categoryOk}/${categoryValues.length}</strong><span>Kategorien</span></div>
            <div class="summary-item"><strong>${channelOk}/${channelValues.length}</strong><span>Kanäle</span></div>
            <div class="summary-item"><strong>${hierarchy?"OK":"PRÜFEN"}</strong><span>Hierarchie</span></div>
          </div>
        </div>

        <div class="card">
          <div class="title compact-title"><div><h3>Community</h3><p class="hint">Freischaltung und Meldesystem.</p></div></div>
          <div class="dashboard-status-list">
            <div><span>Regel-Freischaltung</span>${discordToneBadge(onb.enabled?"AKTIV":"AUS",onb.enabled?"ok":"neutral")}</div>
            <div><span>Freigeschaltete ${esc(rl("memberPlural"))}</span><strong>${Number(onb.totalVerified||0)}</strong></div>
            <div><span>Vorzeitige Freischaltungen verhindert</span><strong>${Number(onb.bypassPrevented||0)}</strong></div>
            <div><span>Offene Meldungen</span><strong>${openReports}</strong></div>
            <div><span>Erledigte Meldungen</span><strong>${Number(reports.resolved||0)}</strong></div>
            <div><span>Abgewiesene Meldungen</span><strong>${Number(reports.rejected||0)}</strong></div>
          </div>
        </div>
      </div>

      <div class="dashboard-two-col">
        <div class="card">
          <div class="title compact-title"><div><h3>Moderation</h3><p class="hint">Aktueller Eskalationsstand.</p></div>${discordToneBadge(mod.enabled?"AKTIV":"AUS",mod.enabled?"ok":"neutral")}</div>
          <div class="dashboard-status-list">
            <div><span>Ereignisse letzte 7 Tage</span><strong>${Number(mod.days7||0)}</strong></div>
            <div><span>Ereignisse letzte 30 Tage</span><strong>${Number(mod.days30||0)}</strong></div>
            <div><span>Aktive Eskalationen</span><strong>${Number(mod.activeEscalations||0)}</strong></div>
            <div><span>Zuletzt moderiert</span><strong>${esc(discordFormatTime(mod.lastActionAt))}</strong></div>
          </div>
        </div>

        <div class="card">
          <div class="title compact-title"><div><h3>Kanalzeiten & Schutz</h3><p class="hint">Nachtruhe und Notfallmodus auf einen Blick.</p></div></div>
          <div class="dashboard-status-list">
            <div><span>Kanal-Zeitsteuerung</span>${discordToneBadge(ct.enabled?(ct.suspended?"PAUSIERT":"AKTIV"):"AUS",ct.enabled?(ct.suspended?"warn":"ok"):"neutral")}</div>
            <div><span>Profile</span><strong>${Number(ct.totalProfiles||0)}</strong></div>
            <div><span>Aktuell geschlossen</span><strong>${closedChannels.length}</strong></div>
            <div><span>Notfallmodus</span>${discordToneBadge(em.active?(em.levelLabel||"AKTIV"):"NORMAL",em.active?"bad":"ok")}</div>
          </div>
          ${closedChannels.length?`<div class="dashboard-chip-row">${closedChannels.map(x=>`<span class="pill">#${esc(x.channelName||x.channelId)} bis ${esc(x.openTime||"–")}</span>`).join("")}</div>`:""}
        </div>
      </div>

      ${isGlobalOwner()&&d.social&&moduleEnabledUi("socialMedia")?`<div class="card">
        <div class="title compact-title"><div><h3>Social Media</h3><p class="hint">Nur für Owner sichtbar.</p></div><button class="secondary" data-dashboard-tab="socialOverview">Öffnen</button></div>
        <div class="dashboard-status-list dashboard-social">
          <div><span>Instagram</span>${discordStatusBadge(!!d.social.instagram?.configured&&!d.social.instagram?.reauthorizationRequired,"VERBUNDEN","PRÜFEN")}</div>
          <div><span>Instagram letzter Erfolg</span><strong>${esc(discordFormatTime(d.social.instagram?.lastSuccessAt))}</strong></div>
          <div><span>TikTok</span>${discordStatusBadge(!!d.social.tiktok?.configured,"VERBUNDEN","NICHT VERBUNDEN")}</div>
          <div><span>TikTok Umgebung</span><strong>${esc(d.social.tiktok?.environment||"–")}</strong></div>
          <div><span>Fehlgeschlagene Veröffentlichungen</span><strong>${Number(d.social.failedPublications||0)}</strong></div>
        </div>
      </div>`:""}

      <div class="card">
        <div class="title compact-title"><div><h3>Schnellzugriff</h3><p class="hint">Direkt zu den wichtigsten Bereichen.</p></div></div>
        <div class="dashboard-quick-actions">${quick.map(x=>`<button type="button" class="secondary" data-dashboard-tab="${esc(x.tab)}">${esc(x.label)}</button>`).join("")}</div>
      </div>`;

    root.querySelectorAll("[data-dashboard-tab]").forEach(btn=>btn.addEventListener("click",()=>openNavTab(btn.dataset.dashboardTab,{persist:true})));
    $("discordVerifyBtn")?.addEventListener("click",verifyDiscordNow);
  }catch(e){
    root.innerHTML=`<div class="card error"><strong>Discord-Lagebild nicht erreichbar.</strong><br>${esc(e.message)}</div>`;
  }
}
async function verifyDiscordNow(){
  const btn=$("discordVerifyBtn");
  if(btn) btn.disabled=true;
  try{
    const r=await fetch("/api/discord/verify",{method:"POST"});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Prüfung fehlgeschlagen.");
    discordStatusCache=data;
    await renderDiscordOverview();
  }catch(e){
    showToast?.(`Discord-Prüfung fehlgeschlagen: ${e.message}`,"error");
  }finally{
    if(btn) btn.disabled=false;
  }
}


async function renderDiscordAccess(){
  const root=$("discordAccess"); if(!root)return;
  root.innerHTML=`<div class="card">Discord-Zugriffsrechte werden geprüft …</div>`;
  try{
    const r=await fetch("/api/discord/access/preview",{cache:"no-store"});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"Prüfung fehlgeschlagen.");
    const changes=d.changes||[];
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Zugriffsrechte</h2><p class="hint">Vorschau für den Regel-Gate-Zugriff. Änderungen erfolgen erst nach ausdrücklicher Bestätigung.</p></div></div>
      <div class="card ${d.ok?'':'error'}">
        <div class="title"><h3>Technische Prüfung</h3><span class="diag-badge ${d.ok?'ok':'bad'}">${d.ok?'bereit':'prüfen'}</span></div>
        <p><strong>Kanäle verwalten:</strong> ${d.canManageChannels?'✅':'❌'} · <strong>Ziele:</strong> ${d.missingTargets?.length?`❌ ${esc(d.missingTargets.join(", "))}`:'✅ vollständig'}</p>
        <p class="hint">${esc(d.note||"")}</p>
      </div>
      <div class="card">
        <div class="title"><h3>Geplante Änderungen</h3><span class="pill">${d.changedCount||0} Änderung(en)</span></div>
        <div class="discord-table">
          <div class="discord-table-head discord-access-head"><span>Ziel</span><span>Rolle</span><span>Grund</span><span>Status</span></div>
          ${changes.map(x=>`<div class="discord-table-row discord-access-row"><strong>${esc(x.channelName||x.channelId)}</strong><span>${esc(x.roleName||x.roleId)}</span><span>${esc(x.reason||"")}</span><span>${x.changed?'<span class="diag-badge warn">Änderung</span>':'<span class="diag-badge ok">passt</span>'}</span></div>`).join("")}
        </div>
      </div>
      <div class="card">
        <h3>Vorlage anwenden</h3>
        <p>Die Vorlage schützt INFORMATIONEN, COMMUNITY, SOCIAL MEDIA, FUNKRAUM und INTERN und setzt gezielte Ausnahmen für Meldekopf, Regeln, Warteraum und BwTalk.</p>
        <p class="hint"><strong>Nicht verändert:</strong> ${esc(rl("administrator"))}/${esc(rl("moderator"))}-Rechte, andere Rollen, Mitglieds-Overwrites und nicht von der Vorlage berührte Permission-Bits.</p>
        <label>Bestätigung <input id="discordAccessConfirm" placeholder="BERECHTIGUNGEN" autocomplete="off"></label>
        <div class="actions"><button id="discordAccessApply" type="button" ${d.ok&&isGlobalAdmin()?'':'disabled'}>Zugriffsvorlage anwenden</button><button id="discordAccessRefresh" type="button" class="secondary">Neu prüfen</button></div>
        ${isGlobalOwner()?"":'<p class="hint">Das Anwenden von Kanalrechten bleibt Ownern und Administratoren vorbehalten.</p>'}
      </div>`;
    $("discordAccessRefresh")?.addEventListener("click",renderDiscordAccess);
    $("discordAccessApply")?.addEventListener("click",applyDiscordAccess);
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
async function applyDiscordAccess(){
  const confirmation=$("discordAccessConfirm")?.value||"";
  const btn=$("discordAccessApply"); if(btn)btn.disabled=true;
  try{
    const r=await fetch("/api/discord/access/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmation})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"Zugriffsvorlage konnte nicht angewendet werden.");
    showToast(`Discord-Zugriffsvorlage angewendet: ${d.applied?.length||0} Änderung(en).`,"success");
    discordStatusCache=null; await renderDiscordAccess();
  }catch(e){showToast(`Zugriffsrechte: ${e.message}`,"error"); if(btn)btn.disabled=false;}
}

async function renderDiscordWelcome(){
  const root=$("discordWelcome");
  if(!root) return;
  root.innerHTML=`<div class="card">Discord-Freischaltung wird geladen …</div>`;
  try{
    const r=await fetch("/api/discord/onboarding",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Freischaltung konnte nicht geladen werden.");
    const o=data.onboarding||{};
    const catalog=data.catalog||{};
    const checks=data.checks||{};
    const channels=(catalog.channels||[]);
    const roles=(catalog.roles||[]);
    const channelOptions=(selected)=>channels.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc((c.parentName?c.parentName+' / ':'')+'#'+c.name)}</option>`).join('');
    const roleOptions=(selected)=>roles.filter(x=>x.id!==data?.guildId).map(role=>`<option value="${esc(role.id)}" ${role.id===selected?'selected':''} ${role.assignable?'':'disabled'}>${esc(role.name)}${role.assignable?'':' · nicht zuweisbar'}</option>`).join('');
    const errors=checks.errors||[];
    const warnings=checks.warnings||[];
    const details=checks.details||{};
    const ruleLinked=!!o.rulesMessageId && o.rulesMessageChannelId===o.rulesChannelId;
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Freischaltung</h2><p class="hint">Meldekopf → Regeln lesen → 👍 auf die zentrale Regelnachricht → Freischaltrolle.</p></div></div>
      ${errors.length?`<div class="card error"><strong>Vor Aktivierung beheben:</strong><ul>${errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
      ${warnings.length?`<div class="card warning"><strong>Hinweise:</strong><ul>${warnings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
      <div class="card">
        <div class="title"><h3>Regelbasierte Freischaltung</h3><span class="diag-badge ${o.enabled?'ok':'warn'}">${o.enabled?'AKTIV':'DEAKTIVIERT'}</span></div>
        <div class="discord-activation-row">
          <div>
            <strong>${o.enabled?'Freischaltung ist aktiv':'Freischaltung ist deaktiviert'}</strong>
            <p class="hint">${o.enabled?'Neue Mitglieder können nach 👍 auf der verknüpften Regelnachricht freigeschaltet werden.':'Konfiguration und Regelnachricht können vorbereitet werden, ohne dass Rollen vergeben werden.'}</p>
          </div>
          <button id="discordOnboardingToggle" type="button" class="${o.enabled?'danger-strong':''}">${o.enabled?'Freischaltung deaktivieren':'Freischaltung aktivieren'}</button>
        </div>
        <input id="discordOnboardingLog" type="checkbox" class="hidden" ${o.logEnabled!==false?'checked':''}>
        <input id="discordLogChannel" type="hidden" value="${esc(o.logChannelId||"")}">
        <div class="discord-config-grid">
          <label><span class="field-label">Meldekopf</span><select id="discordWelcomeChannel">${channelOptions(o.welcomeChannelId)}</select></label>
          <label><span class="field-label">Regelkanal</span><select id="discordRulesChannel" ${o.rulesMessageId?'disabled':''}>${channelOptions(o.rulesChannelId)}</select></label>
          <label><span class="field-label">Freischaltrolle</span><select id="discordUnlockRole">${roleOptions(o.unlockRoleId)}</select></label>
        </div>
        ${isGlobalAdmin()?'<div class="card compact-card central-log-link"><strong>Discord-Lognachrichten</strong><p class="hint">Aktivierung, Zielkanal und Texte für Freischaltungen werden zentral verwaltet.</p><button type="button" class="secondary" data-open-log-category="onboarding">Log-Einstellungen öffnen</button></div>':""}
        <label><span class="field-label">Schreibsperre nach der Regelannahme (Minuten, 0 = aus)</span><input id="discordNewMemberTimeout" type="number" min="0" max="1440" step="1" value="${Number(o.newMemberTimeoutMinutes||0)}"></label>
        <p class="hint">Discords eigene Wartezeit von 10 Minuten („Verifizierungsstufe Hoch“) gilt nicht für Mitglieder mit einer Rolle, also nicht für die Freischaltrolle. Mit dieser Einstellung setzt der Bot beim Vergeben der Rolle zusätzlich einen Timeout: Das Mitglied sieht die Kanäle, kann aber erst nach Ablauf schreiben. Der Bot braucht dafür die Serverberechtigung <em>Mitglieder moderieren</em>. Gilt nur für künftige Freischaltungen.</p>
        ${o.rulesMessageId?`<p class="hint">Der Regelkanal ist gesperrt, solange die Regelnachricht verknüpft ist. So wird verhindert, dass unbeabsichtigt eine zweite Regelnachricht entsteht.</p>`:''}
        <label class="field-label" for="discordWelcomeMessage">Willkommensnachricht im Meldekopf</label>
        <textarea id="discordWelcomeMessage" rows="5" maxlength="1800">${esc(o.welcomeMessage||'')}</textarea>
        <p class="hint">Platzhalter: <code>{mention}</code>, <code>{user}</code>, <code>{rules}</code>. <code>{rules}</code> wird als direkter Discord-Kanallink eingesetzt.</p>
        <label class="field-label" for="discordRulesText">Zentrale Regelnachricht</label>
        <textarea id="discordRulesText" rows="9" maxlength="2000">${esc(o.rulesText||'')}</textarea>
        <div class="field-meta-row"><span id="discordRulesPublishState" class="hint ${o.rulesNeedsPublish?'warning-text':''}">${o.rulesMessageId?(o.rulesNeedsPublish?'Gespeichert, aber noch nicht auf Discord veröffentlicht.':'Gespeicherter Text und veröffentlichte Regelnachricht sind synchron.'):'Noch keine Regelnachricht auf Discord veröffentlicht.'}</span><span id="discordRulesCharCount" class="hint">${String(o.rulesText||'').length} / 2000</span></div>
        <p class="hint">Nur eine 👍-Reaktion auf genau die gespeicherte Nachrichten-ID löst die Freischaltung aus. Entfernen der Reaktion nimmt eine bereits erfolgte Freischaltung nicht zurück.</p>
        <div class="button-row">
          <button id="discordOnboardingSave" type="button">Konfiguration speichern</button>
          ${o.rulesMessageId?'<button id="discordOnboardingSavePublish" type="button">Speichern & Regelnachricht aktualisieren</button>':''}
          <button id="discordOnboardingTest" type="button" class="secondary">Test in Meldekopf senden</button>
        </div>
      </div>
      <div class="card">
        <div class="title"><h3>Regelnachricht</h3><span class="diag-badge ${ruleLinked?'ok':'warn'}">${ruleLinked?'VERKNÜPFT':'NICHT VERÖFFENTLICHT'}</span></div>
        <p><strong>Nachrichten-ID:</strong> <code>${esc(o.rulesMessageId||'–')}</code></p>
        <p><strong>Veröffentlicht:</strong> ${o.rulesPublishedAt?discordFormatTime(o.rulesPublishedAt):'–'} · <strong>zuletzt aktualisiert:</strong> ${o.rulesUpdatedAt?discordFormatTime(o.rulesUpdatedAt):'–'}</p>
        <div class="button-row">
          <button id="discordPublishRules" type="button" ${o.rulesMessageId?'disabled':''}>Regeln erstmals veröffentlichen</button>
          <button id="discordUpdateRules" type="button" class="secondary" ${o.rulesMessageId?'':'disabled'}>Bestehende Regelnachricht aktualisieren</button>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><strong>${Number(o.totalWelcomed||0)}</strong><span>Meldekopf-Begrüßungen</span></div>
        <div class="summary-item"><strong>${Number(o.totalVerified||0)}</strong><span>Freischaltungen</span></div>
        <div class="summary-item"><strong>${Number(o.bypassPrevented||0)}</strong><span>vorzeitige Rollen entfernt</span></div>
        <div class="summary-item"><strong>${o.lastActionAt?discordFormatTime(o.lastActionAt):'–'}</strong><span>letzte Aktion</span></div>
      </div>
      ${o.lastError?`<div class="card error"><strong>Letzter Fehler:</strong><br>${esc(o.lastError)}</div>`:''}
      <div class="card compact-card">
        <h3>Technische Prüfung</h3>
        <p>${discordStatusBadge(!!checks.ok,'bereit','prüfen')} Botrechte, Rollenposition und ausgewählte Ziele werden live gegen Discord geprüft.</p>
        <p><strong>Rollenposition:</strong> ${details.unlockRoleAssignable?'✅ geeignet':'❌ prüfen'} · <strong>Rollen verwalten:</strong> ${details.manageRoles?'✅':'❌'} · <strong>Regelnachricht:</strong> ${details.rulesMessageLinked?'✅ verknüpft':'⚠️ fehlt'} · <strong>Native Rules Screening:</strong> ${details.nativeRulesScreeningDetected?'⚠️ aktiv':'✅ nicht erkannt'}</p>
        <p><strong>Meldekopf:</strong> ${(details.Meldekopf?.missing||[]).length?`❌ ${esc(details.Meldekopf.missing.join(", "))}`:'✅'} · <strong>Regelkanal:</strong> ${(details.Regelkanal?.missing||[]).length?`❌ ${esc(details.Regelkanal.missing.join(", "))}`:'✅'} · <strong>Logkanal:</strong> ${(details.Logkanal?.missing||[]).length?`❌ ${esc(details.Logkanal.missing.join(", "))}`:'✅'}</p>
        <p class="hint">Bestehende Mitglieder und Kanalrechte werden durch diese Einrichtung nicht automatisch verändert. Der Zugriffsschutz der Kanäle muss einmalig manuell in Discord gesetzt werden.</p>
      </div>`;
    wireCentralLogLinks(root);
    $("discordOnboardingSave")?.addEventListener("click",()=>saveDiscordOnboarding(false));
    $("discordOnboardingSavePublish")?.addEventListener("click",()=>saveDiscordOnboarding(true));
    const rulesField=$("discordRulesText"),rulesCount=$("discordRulesCharCount"),rulesPublishState=$("discordRulesPublishState"),loadedRules=String(o.rulesText||"");
    rulesField?.addEventListener("input",()=>{const n=rulesField.value.length;if(rulesCount){rulesCount.textContent=`${n} / 2000`;rulesCount.classList.toggle("error-text",n>2000);}if(rulesPublishState&&o.rulesMessageId){rulesPublishState.textContent=rulesField.value===loadedRules?"Keine ungespeicherten Änderungen.":"Änderung noch nicht gespeichert oder auf Discord veröffentlicht.";rulesPublishState.classList.toggle("warning-text",rulesField.value!==loadedRules);}});
    $("discordOnboardingToggle")?.addEventListener("click",()=>toggleDiscordOnboarding(!!o.enabled));
    $("discordOnboardingTest")?.addEventListener("click",testDiscordOnboarding);
    $("discordPublishRules")?.addEventListener("click",publishDiscordRules);
    $("discordUpdateRules")?.addEventListener("click",updateDiscordRules);
  }catch(e){
    root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;
  }
}

function discordOnboardingPayload(){
  return {
    logEnabled:!!$("discordOnboardingLog")?.checked,
    newMemberTimeoutMinutes:Math.max(0,Math.trunc(Number($("discordNewMemberTimeout")?.value||0))||0),
    welcomeChannelId:$("discordWelcomeChannel")?.value||"",
    rulesChannelId:$("discordRulesChannel")?.value||"",
    unlockRoleId:$("discordUnlockRole")?.value||"",
    logChannelId:$("discordLogChannel")?.value||"",
    welcomeMessage:$("discordWelcomeMessage")?.value||"",
    rulesText:$("discordRulesText")?.value||""
  };
}

async function saveDiscordOnboarding(updatePublishedRules=false){
  const btn=$(updatePublishedRules?"discordOnboardingSavePublish":"discordOnboardingSave"); if(btn) btn.disabled=true;
  try{
    const payload=discordOnboardingPayload();
    if(payload.rulesText.length>2000)throw new Error(`Regeltext ist ${payload.rulesText.length} Zeichen lang. Discord erlaubt maximal 2000 Zeichen.`);
    const r=await fetch("/api/discord/onboarding",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Speichern fehlgeschlagen.");
    if(updatePublishedRules){
      const ur=await fetch("/api/discord/onboarding/rules/update",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const ud=await ur.json().catch(()=>({}));
      if(!ur.ok)throw new Error(`Konfiguration wurde gespeichert, aber die Discord-Regelnachricht konnte nicht aktualisiert werden: ${ud.error||`HTTP ${ur.status}`}`);
      showToast("Freischaltung gespeichert und Regelnachricht auf Discord aktualisiert.","success");
    }else{
      showToast(data.onboarding?.rulesMessageId&&data.onboarding?.rulesNeedsPublish?"Konfiguration gespeichert. Die veröffentlichte Regelnachricht wurde noch nicht geändert.":"Discord-Freischaltung gespeichert.",data.onboarding?.rulesMessageId&&data.onboarding?.rulesNeedsPublish?"warning":"success",6000);
    }
    discordStatusCache=null;
    await renderDiscordWelcome();
  }catch(e){ showToast(`Speichern fehlgeschlagen: ${e.message}`,"error",7000); }
  finally{ if(btn) btn.disabled=false; }
}


async function toggleDiscordOnboarding(currentlyEnabled){
  const btn=$("discordOnboardingToggle");
  if(btn) btn.disabled=true;
  try{
    // Always persist the currently visible configuration first, but without changing
    // activation state. Activation itself is a separate transaction in V5.6.1.
    const save=await fetch("/api/discord/onboarding",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(discordOnboardingPayload())
    });
    const saved=await save.json();
    if(!save.ok) throw new Error(saved.error||"Konfiguration konnte nicht gespeichert werden.");

    const endpoint=currentlyEnabled
      ? "/api/discord/onboarding/deactivate"
      : "/api/discord/onboarding/activate";

    const r=await fetch(endpoint,{method:"POST"});
    const data=await r.json();
    if(!r.ok){
      const details=(data?.checks?.errors||[]).filter(Boolean);
      const suffix=details.length ? ` · ${details.join(" · ")}` : "";
      throw new Error((data.error||"Status konnte nicht geändert werden.")+suffix);
    }

    showToast(currentlyEnabled
      ? "Discord-Freischaltung wurde deaktiviert."
      : "Discord-Freischaltung wurde aktiviert.","success");
    discordStatusCache=null;
    await renderDiscordWelcome();
  }catch(e){
    showToast(`${currentlyEnabled?"Deaktivieren":"Aktivieren"} fehlgeschlagen: ${e.message}`,"error");
    await renderDiscordWelcome();
  }finally{
    if(btn) btn.disabled=false;
  }
}

async function testDiscordOnboarding(){
  const btn=$("discordOnboardingTest"); if(btn) btn.disabled=true;
  try{
    const payload=discordOnboardingPayload();
    const save=await fetch("/api/discord/onboarding",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const saveData=await save.json();
    if(!save.ok) throw new Error(saveData.error||"Konfiguration konnte vor dem Test nicht gespeichert werden.");
    const r=await fetch("/api/discord/onboarding/test",{method:"POST"});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||"Test fehlgeschlagen.");
    showToast("Testmeldung wurde in den Meldekopf gesendet.","success");
    await renderDiscordWelcome();
  }catch(e){ showToast(`Test fehlgeschlagen: ${e.message}`,"error"); }
  finally{ if(btn) btn.disabled=false; }
}

async function publishDiscordRules(){
  const btn=$("discordPublishRules"); if(btn) btn.disabled=true;
  try{
    const payload=discordOnboardingPayload();
    let r=await fetch("/api/discord/onboarding",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    let data=await r.json(); if(!r.ok) throw new Error(data.error||"Konfiguration konnte nicht gespeichert werden.");
    r=await fetch("/api/discord/onboarding/rules/publish",{method:"POST"}); data=await r.json();
    if(!r.ok) throw new Error(data.error||"Regelnachricht konnte nicht veröffentlicht werden.");
    showToast("Regelnachricht wurde veröffentlicht und mit 👍 vorbereitet.","success");
    await renderDiscordWelcome();
  }catch(e){ showToast(`Veröffentlichen fehlgeschlagen: ${e.message}`,"error"); }
  finally{ if(btn) btn.disabled=false; }
}

async function updateDiscordRules(){
  const btn=$("discordUpdateRules"); if(btn) btn.disabled=true;
  try{
    const payload=discordOnboardingPayload();
    let r=await fetch("/api/discord/onboarding",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    let data=await r.json(); if(!r.ok) throw new Error(data.error||"Konfiguration konnte nicht gespeichert werden.");
    r=await fetch("/api/discord/onboarding/rules/update",{method:"POST"}); data=await r.json();
    if(!r.ok) throw new Error(data.error||"Regelnachricht konnte nicht aktualisiert werden.");
    showToast("Bestehende Regelnachricht wurde aktualisiert.","success");
    await renderDiscordWelcome();
  }catch(e){ showToast(`Aktualisieren fehlgeschlagen: ${e.message}`,"error"); }
  finally{ if(btn) btn.disabled=false; }
}


let channelTimesUi={data:null};

function channelTimeStatusLabel(p){
  if(p.effectiveClosed)return {text:"Nachtruhe",cls:"bad"};
  return {text:"Offen",cls:"ok"};
}
function channelTimeEventLabel(type){
  return ({warning:"Vorwarnung gesendet",closed:"geschlossen",opened:"geöffnet"})[type]||type;
}
function channelTimeProfileCard(p,channels,canEdit,roleNames={}){
  const status=channelTimeStatusLabel(p),channelOptions=channels.map(c=>`<option value="${esc(c.id)}" ${c.id===p.channelId?"selected":""}>${c.parentName?`${esc(c.parentName)} · `:""}#${esc(c.name)}</option>`).join("");
  return `<div class="card channel-time-profile" data-ct-profile="${esc(p.id)}">
    <div class="title compact-title"><div><h3>#${esc(p.channelName||"Kanal")}</h3><p class="hint">Zeitprofil <code>${esc(p.id)}</code></p></div><span class="diag-badge ${status.cls}">${status.text}</span></div>
    <div class="grid three">
      <label>Kanal<select data-ct="channelId" ${canEdit?"":"disabled"}>${channelOptions}</select></label>
      <label>Nachtruhe ab<input data-ct="closeTime" type="time" value="${esc(p.closeTime)}" ${canEdit?"":"disabled"}></label>
      <label>Wieder öffnen<input data-ct="openTime" type="time" value="${esc(p.openTime)}" ${canEdit?"":"disabled"}></label>
    </div>
    <div class="grid four">
      <label class="toggle-row"><input data-ct="enabled" type="checkbox" ${p.enabled?"checked":""} ${canEdit?"":"disabled"}><span>Profil aktiv</span></label>
      <label class="toggle-row"><input data-ct="member" type="checkbox" ${(p.roles?.member??p.roles?.rekrut)?"checked":""} ${canEdit?"":"disabled"}><span>${esc(roleNames.member||rl("member"))} sperren</span></label>
      <label class="toggle-row"><input data-ct="administrator" type="checkbox" ${(p.roles?.administrator??p.roles?.s1)?"checked":""} ${canEdit?"":"disabled"}><span>${esc(roleNames.administrator||rl("administrator"))} ebenfalls sperren</span></label>
      <label class="toggle-row"><input data-ct="lockThreads" type="checkbox" ${p.lockThreads?"checked":""} ${canEdit?"":"disabled"}><span>Threads ebenfalls sperren</span></label>
    </div>
    <div class="card channel-time-warning-box">
      <div class="grid two">
        <label class="toggle-row"><input data-ct="announceWarning" type="checkbox" ${p.announceWarning?"checked":""} ${canEdit?"":"disabled"}><span>Vor Beginn der Nachtruhe warnen</span></label>
        <label>Vorwarnung in Minuten<input data-ct="warningMinutes" type="number" min="5" max="180" step="5" value="${esc(String(p.warningMinutes||30))}" ${canEdit?"":"disabled"}></label>
      </div>
      <textarea data-ct="warningMessage" rows="3" ${canEdit?"":"disabled"}>${esc(p.warningMessage||"")}</textarea>
    </div>
    <div class="grid two">
      <div><label class="toggle-row"><input data-ct="announceClose" type="checkbox" ${p.announceClose?"checked":""} ${canEdit?"":"disabled"}><span>Nachtruhe im Kanal ankündigen</span></label><textarea data-ct="closeMessage" rows="4" ${canEdit?"":"disabled"}>${esc(p.closeMessage||"")}</textarea></div>
      <div><label class="toggle-row"><input data-ct="announceOpen" type="checkbox" ${p.announceOpen?"checked":""} ${canEdit?"":"disabled"}><span>Öffnung im Kanal ankündigen</span></label><textarea data-ct="openMessage" rows="4" ${canEdit?"":"disabled"}>${esc(p.openMessage||"")}</textarea></div>
    </div>
    <p class="hint">Variablen: <code>{channel}</code>, <code>{closeTime}</code>, <code>{openTime}</code>, <code>{warningMinutes}</code>. Reaktionen bleiben während der Nachtruhe erlaubt.</p>
    <div class="channel-time-state">
      <span><strong>Aktuell:</strong> ${status.text}${p.activeSince?` seit ${esc(discordFormatTime(p.activeSince))}`:""}</span>
      <span><strong>Nächster planmäßiger Wechsel:</strong> ${esc(discordFormatTime(p.nextTransitionAt))}</span>
      ${p.override?`<span><strong>Manuelle Übersteuerung:</strong> ${p.override.state==="closed"?"geschlossen":"offen"} bis ${esc(discordFormatTime(p.override.until))}</span>`:""}
    </div>
    ${canEdit?`<div class="actions">
      ${p.effectiveClosed?`<button type="button" class="secondary" data-ct-action="open" data-profile-id="${esc(p.id)}">Jetzt öffnen</button>`:`<button type="button" class="secondary" data-ct-action="close" data-profile-id="${esc(p.id)}">Jetzt schließen</button>`}
      ${p.override?`<button type="button" class="secondary" data-ct-action="clear_override" data-profile-id="${esc(p.id)}">Automatik fortsetzen</button>`:""}
      <button type="button" class="danger" data-ct-remove="${esc(p.id)}">Profil entfernen</button>
    </div>`:""}
  </div>`;
}
function collectChannelTimesConfig(root,data){
  const profiles=[...root.querySelectorAll("[data-ct-profile]")].map(card=>({
    id:card.dataset.ctProfile,
    channelId:card.querySelector('[data-ct="channelId"]')?.value||"",
    enabled:!!card.querySelector('[data-ct="enabled"]')?.checked,
    closeTime:card.querySelector('[data-ct="closeTime"]')?.value||"22:00",
    openTime:card.querySelector('[data-ct="openTime"]')?.value||"06:00",
    roles:{member:!!card.querySelector('[data-ct="member"]')?.checked,administrator:!!card.querySelector('[data-ct="administrator"]')?.checked},
    lockThreads:!!card.querySelector('[data-ct="lockThreads"]')?.checked,
    announceWarning:!!card.querySelector('[data-ct="announceWarning"]')?.checked,
    warningMinutes:Number(card.querySelector('[data-ct="warningMinutes"]')?.value||30),
    warningMessage:card.querySelector('[data-ct="warningMessage"]')?.value||"",
    announceClose:!!card.querySelector('[data-ct="announceClose"]')?.checked,
    closeMessage:card.querySelector('[data-ct="closeMessage"]')?.value||"",
    announceOpen:!!card.querySelector('[data-ct="announceOpen"]')?.checked,
    openMessage:card.querySelector('[data-ct="openMessage"]')?.value||""
  }));
  return {
    enabled:!!$("channelTimesEnabled")?.checked,
    timezone:$("channelTimesTimezone")?.value.trim()||"Europe/Berlin",
    logEnabled:!!$("channelTimesLogEnabled")?.checked,
    logChannelId:$("channelTimesLogChannel")?.value||"",
    profiles
  };
}
async function renderDiscordChannelTimes(){
  const root=$("discordChannelTimes");if(!root)return;
  root.innerHTML=`<div class="card">Kanal-Zeitsteuerung wird geladen …</div>`;
  try{
    const r=await fetch("/api/discord/channel-times",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Kanalzeiten konnten nicht geladen werden.");
    channelTimesUi.data=d;
    const canEdit=hasCapability("discord.channel-times.edit"),c=d.config||{},channels=d.catalog?.channels||[],roleNames={member:d.catalog?.roles?.member?.name||rl("member"),administrator:d.catalog?.roles?.administrator?.name||rl("administrator")};
    const logOpts=channels.map(x=>`<option value="${esc(x.id)}" ${x.id===c.logChannelId?"selected":""}>#${esc(x.name)}</option>`).join("");
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Kanalzeiten</h2><p class="hint">Automatische Nachtruhe pro Textkanal. Regelbestätigung und Beitritt bleiben jederzeit möglich.</p></div><button id="channelTimesRefresh" type="button" class="secondary">Aktualisieren</button></div>
      <div class="card" style="border:1px solid var(--border)">
        <div class="title compact-title"><div><h3>🛠️ Wartungsmodus</h3><p class="hint">Sperrt die gewählten Kanäle für die gewählten Rollen auch bei NAS-Neustart. Discord-Rechte bleiben während des Bot-Ausfalls gesperrt.</p></div><span class="diag-badge ${d.maintenance?.active?"bad":"ok"}">${d.maintenance?.active?"WARTUNG AKTIV":"Inaktiv"}</span></div>
        ${(()=>{
          const mt=d.maintenance||{},scope=mt.scope==="custom"?"custom":"profiles",sel=new Set(mt.channelIds||[]),roles0=mt.roles||{member:true,administrator:false},roles={member:roles0.member??roles0.rekrut,administrator:roles0.administrator??roles0.s1},lock=!canEdit||mt.active?"disabled":"";
          const chOpts=channels.map(x=>`<option value="${esc(x.id)}" ${sel.has(x.id)?"selected":""}>${x.parentName?esc(x.parentName)+" › ":""}#${esc(x.name)}</option>`).join("");
          return `<div class="maintenance-scope">
            <label>Betroffene Kanäle<select id="maintenanceScope" ${lock}><option value="profiles" ${scope==="profiles"?"selected":""}>Kanäle der aktiven Zeitprofile</option><option value="custom" ${scope==="custom"?"selected":""}>Eigene Kanalliste</option></select></label>
            <label id="maintenanceChannelsWrap" class="${scope==="custom"?"":"hidden"}">Eigene Kanäle (Mehrfachauswahl mit Strg/Cmd bzw. Antippen)<select id="maintenanceChannels" multiple size="8" ${lock}>${chOpts}</select></label>
            <div class="checks"><span class="hint">Gesperrte Rollen:</span>
              <label class="check"><input type="checkbox" id="maintenanceRoleMember" ${roles.member?"checked":""} ${lock}> ${esc(roleNames.member)}</label>
              <label class="check"><input type="checkbox" id="maintenanceRoleAdministrator" ${roles.administrator?"checked":""} ${lock}> ${esc(roleNames.administrator)}</label></div>
            <p class="hint">${mt.active?"Kanäle und Rollen lassen sich erst ändern, wenn der Wartungsmodus beendet ist.":"Das Schreiben (auch in Threads) wird für die gewählten Rollen in den gewählten Kanälen gesperrt. Alle anderen Kanäle bleiben unverändert. Das automatische Update nutzt dieselbe Auswahl."}</p>
          </div>`;})()}
        <label>Sperrtext (öffentlich, frei editierbar)<textarea id="maintenanceLockText" rows="3" ${canEdit?"":"disabled"}>${esc(d.maintenance?.lockMessage||"")}</textarea></label>
        <label>Entsperrtext (öffentlich, frei editierbar)<textarea id="maintenanceUnlockText" rows="3" ${canEdit?"":"disabled"}>${esc(d.maintenance?.unlockMessage||"")}</textarea></label>
        ${d.maintenance?.lastError?`<div class="error">Wartungsfehler: ${esc(d.maintenance.lastError)}</div>`:""}
        ${canEdit?`<div class="actions"><button id="maintenanceSave" class="secondary" type="button">Texte speichern</button><button id="maintenanceToggle" type="button" class="${d.maintenance?.active?"secondary":"danger"}">${d.maintenance?.active?"Wartung beenden und entsperren":"Wartungsmodus aktivieren"}</button></div>`:""}
      </div>
      <div class="card channel-times-master">
        <div class="grid two">
          <label class="toggle-row"><input id="channelTimesEnabled" type="checkbox" ${c.enabled?"checked":""} ${canEdit?"":"disabled"}><span>Kanal-Zeitsteuerung aktiv</span></label>
          <label>Zeitzone<input id="channelTimesTimezone" value="${esc(c.timezone||"Europe/Berlin")}" ${canEdit?"":"disabled"}></label>
        </div>
        <input id="channelTimesLogEnabled" type="checkbox" class="hidden" ${c.logEnabled?"checked":""}>
        <input id="channelTimesLogChannel" type="hidden" value="${esc(c.logChannelId||"")}">
        ${isGlobalAdmin()?'<div class="central-log-link"><strong>Discord-Lognachrichten:</strong> zentral unter Administration → Logs & Benachrichtigungen.<br><button type="button" class="secondary" data-open-log-category="channel-times">Log-Einstellungen öffnen</button></div>':""}
        <div class="channel-time-info"><strong>Prinzip:</strong> Vor dem Schließen wird der vorhandene Rollen-Overwrite exakt gespeichert. Beim Öffnen wird genau dieser Zustand wiederhergestellt. Es werden nur Schreib-/Thread-Rechte verändert; Lesen, Reagieren und die bestehende Freischaltlogik bleiben unberührt.</div>
        ${!c.enabled?'<div class="card warning"><strong>Derzeit deaktiviert.</strong> Nach dem Speichern mit aktivierter Zeitsteuerung greifen die einzelnen Kanalprofile.</div>':""}
      </div>
      <div id="channelTimeProfiles">${(c.profiles||[]).map(p=>channelTimeProfileCard(p,channels,canEdit,roleNames)).join("")}</div>
      ${canEdit?`<div class="actions channel-time-main-actions"><button id="channelTimeAdd" type="button" class="secondary">+ Kanalprofil hinzufügen</button><button id="channelTimesSave" type="button">Kanalzeiten speichern</button></div>`:""}
      <div class="card"><div class="title compact-title"><div><h3>Ereignisprotokoll</h3><p class="hint">Letzte automatische und manuelle Kanalwechsel.</p></div></div>
        <div class="channel-time-events">${(d.state?.events||[]).length?(d.state.events||[]).slice(0,30).map(e=>`<div class="channel-time-event"><time>${esc(discordFormatTime(e.at))}</time><strong>#${esc(e.channelName||e.channelId)}</strong><span>${esc(channelTimeEventLabel(e.type))}</span><small>${esc(e.source||"")}</small></div>`).join(""):'<span class="hint">Noch keine Kanalwechsel protokolliert.</span>'}</div>
        ${d.state?.lastError?`<div class="error">Letzter Fehler: ${esc(d.state.lastError)}</div>`:""}
      </div>`;

    async function applyMaintenance(active){
      const body={active,lockMessage:$("maintenanceLockText")?.value||"",unlockMessage:$("maintenanceUnlockText")?.value||""};
      if($("maintenanceScope")){
        body.scope=$("maintenanceScope").value;
        body.channelIds=[...($("maintenanceChannels")?.selectedOptions||[])].map(o=>o.value);
        body.roles={member:!!$("maintenanceRoleMember")?.checked,administrator:!!$("maintenanceRoleAdministrator")?.checked};
      }
      if(active!==!!d.maintenance?.active){const yes=await askConfirm({title:active?"Wartungssperre aktivieren":"Wartungssperre aufheben",text:active?"Die gewählten Kanäle werden für die gewählten Rollen sofort gesperrt. Die Sperre bleibt nach einem Neustart bestehen.":"Gespeicherte Kanalrechte werden wiederhergestellt und die aktuellen Kanalzeiten erneut angewendet.",confirmLabel:active?"WARTUNG AKTIVIEREN":"WARTUNG BEENDEN",cancelLabel:"ABBRECHEN",danger:active});if(!yes)return;}
      const r=await fetch("/api/discord/channel-times/maintenance",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
      if(!r.ok){showToast(j.error||"Wartungsmodus konnte nicht geändert werden.","error",8000);return;}
      showToast(active?"Wartungsmodus aktiv.":"Wartungseinstellungen gespeichert.","success");renderDiscordChannelTimes();
    }
    $("maintenanceScope")?.addEventListener("change",()=>$("maintenanceChannelsWrap")?.classList.toggle("hidden",$("maintenanceScope").value!=="custom"));
    $("maintenanceSave")?.addEventListener("click",()=>applyMaintenance(!!d.maintenance?.active));
    $("maintenanceToggle")?.addEventListener("click",()=>applyMaintenance(!d.maintenance?.active));
    wireCentralLogLinks(root);
    $("channelTimesRefresh")?.addEventListener("click",()=>renderDiscordChannelTimes());
    $("channelTimeAdd")?.addEventListener("click",()=>{
      const first=channels[0];if(!first)return showToast("Kein Textkanal verfügbar.","warning");
      const id=`ct-${Date.now()}`;
      const shell=document.createElement("div");
      shell.innerHTML=channelTimeProfileCard({id,channelId:first.id,channelName:first.name,enabled:true,closeTime:"22:00",openTime:"06:00",roles:{member:true,administrator:false},lockThreads:true,announceWarning:true,warningMinutes:30,warningMessage:"⏰ Hinweis: In {warningMinutes} Minuten beginnt die Nachtruhe. Sie gilt von {closeTime} bis {openTime} Uhr. Bitte schließt eure Gespräche rechtzeitig ab.",announceClose:true,closeMessage:"🌙 Nachtruhe! Dieser Kanal ist bis {openTime} Uhr für neue Nachrichten geschlossen. Lesen und Reagieren bleibt möglich. Morgen geht's weiter.",announceOpen:true,openMessage:"☀️ Guten Morgen! Die Nachtruhe ist beendet – dieser Kanal ist wieder geöffnet.",effectiveClosed:false,nextTransitionAt:null},channels,true,roleNames);
      $("channelTimeProfiles").appendChild(shell.firstElementChild);
      wireChannelTimeButtons(root);
    });
    $("channelTimesSave")?.addEventListener("click",async()=>{
      const body=collectChannelTimesConfig(root,d);
      const rr=await fetch("/api/discord/channel-times/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Kanalzeiten konnten nicht gespeichert werden.","error",6000);
      showToast("Kanalzeiten gespeichert und aktuellen Zeiten entsprechend abgeglichen.","success");renderDiscordChannelTimes();
    });
    wireChannelTimeButtons(root);
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
function wireChannelTimeButtons(root){
  root.querySelectorAll("[data-ct-remove]").forEach(btn=>btn.onclick=async()=>{
    const card=btn.closest("[data-ct-profile]"),name=card?.querySelector('[data-ct="channelId"] option:checked')?.textContent||"Kanalprofil";
    const ok=await askConfirm({title:"Kanalprofil entfernen",text:`${name} aus der Zeitsteuerung entfernen? Falls die Nachtruhe gerade aktiv ist, werden beim Speichern die zuvor gesicherten Rechte wiederhergestellt.`,confirmLabel:"ENTFERNEN",cancelLabel:"ABBRECHEN",danger:true});
    if(ok)card?.remove();
  });
  root.querySelectorAll("[data-ct-action]").forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.ctAction,profileId=btn.dataset.profileId;
    const labels={close:"Kanal jetzt schließen",open:"Kanal jetzt öffnen",clear_override:"Automatik fortsetzen"};
    const ok=await askConfirm({title:labels[action]||"Kanalzeit ändern",text:action==="close"?"Der konfigurierte Kanal wird sofort für die ausgewählten Rollen schreibgeschützt.":action==="open"?"Die zuvor gesicherten Schreibrechte werden sofort wiederhergestellt.":"Die manuelle Übersteuerung wird beendet und der aktuelle Zeitplan gilt wieder.",confirmLabel:action==="close"?"SCHLIESSEN":action==="open"?"ÖFFNEN":"AUTOMATIK",cancelLabel:"ABBRECHEN",danger:false});
    if(!ok)return;
    const r=await fetch("/api/discord/channel-times/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({profileId,action})}),j=await r.json().catch(()=>({}));
    if(!r.ok)return showToast(j.error||"Kanalaktion fehlgeschlagen.","error",6000);
    showToast("Kanalzeit aktualisiert.","success");renderDiscordChannelTimes();
  });
}

async function renderDiscordChannels(){
  const root=$("discordChannels");
  if(!root) return;
  root.innerHTML=`<div class="card">Discord-Kanäle werden geladen …</div>`;
  try{
    const data=await loadDiscordStatus(true);
    const categories=Object.entries(data?.checks?.categories||{});
    const channels=Object.entries(data?.checks?.channels||{});
    const categoryName=new Map(categories.map(([,v])=>[v?.id,v?.name||v?.id]));
    const typeLabel=(type)=>({0:"Text",2:"Voice",4:"Kategorie",5:"Ankündigung",13:"Stage",15:"Forum"}[type]||`Typ ${type}`);
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Kanäle</h2><p class="hint">Abgleich der fest konfigurierten Kategorien und Kanäle mit Discord.</p></div></div>
      <div class="card">
        <h3>Kategorien</h3>
        <div class="discord-table">
          <div class="discord-table-head"><span>Zuordnung</span><span>Name</span><span>ID</span><span>Status</span></div>
          ${categories.map(([key,v])=>`<div class="discord-table-row"><span>${esc(key)}</span><strong>${esc(v?.name||"–")}</strong><code>${esc(v?.id||"–")}</code><span>${discordStatusBadge(!!v?.ok)}</span></div>`).join("")}
        </div>
      </div>
      <div class="card">
        <h3>Kanäle</h3>
        <div class="discord-table">
          <div class="discord-table-head discord-channel-head"><span>Zuordnung</span><span>Name</span><span>Typ</span><span>Kategorie</span><span>Status</span></div>
          ${channels.map(([key,v])=>`<div class="discord-table-row discord-channel-row"><span>${esc(key)}</span><strong>${esc(v?.name||"–")}</strong><span>${esc(typeLabel(v?.type))}</span><span>${esc(categoryName.get(v?.parentId)||v?.parentId||"–")}</span><span>${discordStatusBadge(!!v?.ok)}</span></div>`).join("")}
        </div>
      </div>`;
  }catch(e){
    root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;
  }
}


let discordMemberState={query:"",members:[],roles:[]};
let discordSelectedMemberId=null;
let discordMemberProfileTab="overview";
let discordMemberLevels=new Map();

let discordGuildId="",discordMemberRoleId="";
function discordAvatarUrl(member){
  if(member?.guildAvatar&&member?.id&&discordGuildId) return `https://cdn.discordapp.com/guilds/${encodeURIComponent(discordGuildId)}/users/${encodeURIComponent(member.id)}/avatars/${encodeURIComponent(member.guildAvatar)}.png?size=64`;
  if(member?.userAvatar&&member?.id) return `https://cdn.discordapp.com/avatars/${encodeURIComponent(member.id)}/${encodeURIComponent(member.userAvatar)}.png?size=64`;
  return "";
}
function discordMemberRoleBadge(role){
  const state=role.manageable?"manageable":"locked";
  const title=role.manageable?"Im Control Center verwaltbar":(role.reason||"Nicht verwaltbar");
  return `<span class="discord-member-role ${state}" title="${esc(title)}">${esc(role.name)}${role.manageable?"":" 🔒"}</span>`;
}
async function loadDiscordMembers(query=""){
  const r=await fetch(`/api/discord/members?query=${encodeURIComponent(query)}&limit=50`,{cache:"no-store"});
  const d=await r.json(); if(!r.ok) throw new Error(d.error||"Mitglieder konnten nicht geladen werden.");
  if(d.guildId)discordGuildId=String(d.guildId);
  discordMemberRoleId=String(d.memberRoleId||"");
  discordMemberState={query:d.query||query,members:d.members||[],roles:d.roles||[]}; return discordMemberState;
}

async function renderDiscordAnnouncements(){
  const root=$("discordAnnouncements"); if(!root)return;
  root.innerHTML=`<div class="card">Discord-Ankündigungen werden geladen …</div>`;
  try{
    const r=await fetch("/api/discord/announcements",{cache:"no-store"});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"Ankündigungen konnten nicht geladen werden.");
    const c=d.config||{}, cat=d.catalog||{}, channels=cat.channels||[], roles=cat.mentionRoles||[];
    const opts=(selected)=>channels.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>#${esc(x.name)}</option>`).join("");
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Ankündigungen</h2>
      <p class="hint">Twitch-Live und neue Clips automatisch in Discord veröffentlichen. Initial vorhandene Clips werden nicht nachträglich ausgespielt.</p></div></div>
      <div class="card">
        <h3>Twitch LIVE</h3>
        <label class="toggle-row"><input id="discordLiveEnabled" type="checkbox" ${c.liveEnabled?'checked':''}><span>Livemeldungen aktivieren</span></label>
        <label>Zielkanal <select id="discordLiveChannel">${opts(c.liveChannelId)}</select></label>
        <label>Text <textarea id="discordLiveText" rows="4">${esc(c.liveText||"")}</textarea></label>
        <p class="hint">Variablen: {broadcaster}, {title}, {game}, {url}</p>
        <button id="discordLiveTest" type="button" class="secondary">Testmeldung senden</button>
      </div>
      <div class="card">
        <h3>Twitch Clips</h3>
        <label class="toggle-row"><input id="discordClipsEnabled" type="checkbox" ${c.clipsEnabled?'checked':''}><span>Neue Clips automatisch veröffentlichen</span></label>
        <label>Zielkanal <select id="discordClipsChannel">${opts(c.clipsChannelId)}</select></label>
        <label>Text <textarea id="discordClipText" rows="4">${esc(c.clipText||"")}</textarea></label>
        <p class="hint">Variablen: {title}, {creator}, {url}, {clip_id}</p>
        <button id="discordClipTest" type="button" class="secondary">Testmeldung senden</button>
      </div>
      <div class="card">
        <h3>Darstellung</h3>
        <label class="toggle-row"><input id="discordAnnouncementEmbeds" type="checkbox" ${c.useEmbeds!==false?'checked':''}><span>Discord-Embed ergänzen</span></label>
        <label>Optionale Rollen-Erwähnung
          <select id="discordAnnouncementRole"><option value="">Keine</option>${roles.map(x=>`<option value="${esc(x.id)}" ${x.id===c.mentionRoleId?'selected':''}>${esc(x.name)}</option>`).join("")}</select>
        </label>
        <p class="hint">Nur Rollen, die in Discord als erwähnbar markiert sind, werden angeboten. @everyone/@here werden nicht verwendet.</p>
        <div class="actions"><button id="discordAnnouncementsSave" type="button">Speichern</button></div>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><strong>${d.state?.liveCount||0}</strong><span>Live-Dedup</span></div>
        <div class="summary-item"><strong>${d.state?.clipCount||0}</strong><span>Clip-Dedup</span></div>
        <div class="summary-item"><strong>${d.state?.lastLiveAt?discordFormatTime(d.state.lastLiveAt):"–"}</strong><span>Letzte Livemeldung</span></div>
        <div class="summary-item"><strong>${d.state?.lastClipAt?discordFormatTime(d.state.lastClipAt):"–"}</strong><span>Letzter Clip</span></div>
      </div>
      ${["lastLiveMessage","lastClipMessage"].map(k=>{const m=d.state?.[k];const label=k==="lastClipMessage"?"Letzte Clip-Nachricht":"Letzte Live-Nachricht";return `<p class="hint">${label}: ${m?`<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.title||"Nachricht öffnen")}</a> · ${esc(discordFormatTime(m.sentAt))}${k==="lastClipMessage"?(m.withImage?" · mit Vorschaubild":" · ohne Vorschaubild"):""}. Ist sie dort nicht mehr zu sehen, wurde sie nach dem Senden in Discord gelöscht.`:"noch keine seit 9.26.2 gesendet."}</p>`;}).join("")}
      ${d.state?.lastError?`<div class="card error">${esc(d.state.lastError)}</div>`:""}`;
    $("discordAnnouncementsSave")?.addEventListener("click",saveDiscordAnnouncements);
    $("discordLiveTest")?.addEventListener("click",()=>testDiscordAnnouncement("live"));
    $("discordClipTest")?.addEventListener("click",()=>testDiscordAnnouncement("clip"));
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
async function saveDiscordAnnouncements(){
  const body={
    liveEnabled:!!$("discordLiveEnabled")?.checked,
    clipsEnabled:!!$("discordClipsEnabled")?.checked,
    liveChannelId:$("discordLiveChannel")?.value||"",
    clipsChannelId:$("discordClipsChannel")?.value||"",
    liveText:$("discordLiveText")?.value||"",
    clipText:$("discordClipText")?.value||"",
    useEmbeds:!!$("discordAnnouncementEmbeds")?.checked,
    mentionRoleId:$("discordAnnouncementRole")?.value||null
  };
  const r=await fetch("/api/discord/announcements",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const d=await r.json(); if(!r.ok){showToast(`Ankündigungen: ${d.error||"Speichern fehlgeschlagen."}`,"error");return;}
  showToast("Discord-Ankündigungen gespeichert.","success"); await renderDiscordAnnouncements();
}
async function testDiscordAnnouncement(type){
  const r=await fetch("/api/discord/announcements/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type})});
  const d=await r.json(); if(!r.ok){showToast(`Test fehlgeschlagen: ${d.error||"Fehler"}`,"error");return;}
  showToast(`${type==="live"?"Live":"Clip"}-Testmeldung gesendet.`,"success");
}




const socialUi={data:null,historyPage:1,historyPlatform:"",historyStatus:"",historySearch:""};
function socialConnectionBadge(platform,data){
  const c=data?.connections?.[platform]||{},s=data?.state?.platforms?.[platform]||{};
  if(!c.configured)return `<span class="diag-badge warn">nicht konfiguriert</span>`;
  if(s.lastError)return `<span class="diag-badge bad">Fehler</span>`;
  if(s.lastSuccessAt)return `<span class="diag-badge ok">verbunden</span>`;
  return `<span class="diag-badge">konfiguriert</span>`;
}
function socialPlatformName(p){return p==="instagram"?"Instagram":"TikTok";}
function socialFmt(v){return v?discordFormatTime(v):"–";}
async function loadSocialData(extra={}){
  const q=new URLSearchParams({page:String(extra.page||1),pageSize:String(extra.pageSize||50)});
  if(extra.platform)q.set("platform",extra.platform);if(extra.status)q.set("status",extra.status);if(extra.search)q.set("search",extra.search);
  const r=await fetch(`/api/social?${q}`,{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Social-Media-Daten konnten nicht geladen werden.");
  socialUi.data=d;return d;
}
async function runSocialPoll(){
  const r=await fetch("/api/social/poll",{method:"POST"}),d=await r.json().catch(()=>({}));
  if(!r.ok)return showToast(d.error||"Social-Media-Prüfung fehlgeschlagen.","error");
  const sent=(d.results||[]).reduce((n,x)=>n+Number(x.newCount||0),0);
  showToast(sent?`${sent} neue Veröffentlichung(en) an Discord gesendet.`:"Prüfung abgeschlossen. Keine neue Veröffentlichung.","success");
  return d;
}
async function renderSocialOverview(){
  const root=$("socialOverview");if(!root)return;root.innerHTML=`<div class="card">Social Media wird geladen …</div>`;
  try{
    const d=await loadSocialData({page:1,pageSize:8}),ig=d.state?.platforms?.instagram||{},tt=d.state?.platforms?.tiktok||{},items=d.history?.items||[];
    root.innerHTML=`
      <div class="title"><div><h2>Social Media · Übersicht</h2><p class="hint">Instagram und TikTok erkennen → automatisch nach Discord. Kein Posting-Zentrum.</p></div>${isGlobalOwner()?'<button id="socialPollNow" type="button">Jetzt prüfen</button>':""}</div>
      <div class="summary-grid social-summary-grid">
        <div class="card social-platform-card"><div class="title compact-title"><h3>Instagram</h3>${socialConnectionBadge("instagram",d)}</div><div class="social-kpi"><span>Letzte Prüfung</span><strong>${esc(socialFmt(ig.lastCheckAt))}</strong></div><div class="social-kpi"><span>Letzter Erfolg</span><strong>${esc(socialFmt(ig.lastSuccessAt))}</strong></div><div class="social-kpi"><span>Letzter Discord-Post</span><strong>${esc(socialFmt(ig.lastDiscordAt))}</strong></div>${ig.lastError?`<div class="error">${esc(ig.lastError)}</div>`:""}</div>
        <div class="card social-platform-card"><div class="title compact-title"><h3>TikTok</h3>${socialConnectionBadge("tiktok",d)}</div><div class="social-kpi"><span>Letzte Prüfung</span><strong>${esc(socialFmt(tt.lastCheckAt))}</strong></div><div class="social-kpi"><span>Letzter Erfolg</span><strong>${esc(socialFmt(tt.lastSuccessAt))}</strong></div><div class="social-kpi"><span>Letzter Discord-Post</span><strong>${esc(socialFmt(tt.lastDiscordAt))}</strong></div>${tt.lastError?`<div class="error">${esc(tt.lastError)}</div>`:""}</div>
      </div>
      <div class="card"><div class="title compact-title"><div><h3>Letzte Veröffentlichungen</h3><p class="hint">Beim ersten erfolgreichen Abruf wird nur eine Baseline gesetzt – alte Beiträge werden nicht nachträglich an Discord geschickt.</p></div></div>${renderSocialHistoryRows(items,false)}</div>
      <div class="card"><div class="social-kpi"><span>Letzter Gesamt-Abruf</span><strong>${esc(socialFmt(d.state?.lastPollAt))}</strong></div><div class="social-kpi"><span>Nächster automatischer Abruf</span><strong>${esc(socialFmt(d.state?.nextPollAt))}</strong></div></div>`;
    $("socialPollNow")?.addEventListener("click",async()=>{await runSocialPoll();renderSocialOverview();});
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
async function renderSocialPlatform(platform){
  const root=$(platform==="instagram"?"socialInstagram":"socialTikTok");if(!root)return;root.innerHTML=`<div class="card">${socialPlatformName(platform)} wird geladen …</div>`;
  try{
    const d=await loadSocialData({platform,page:1,pageSize:20}),cfg=d.config?.[platform]||{},ps=d.state?.platforms?.[platform]||{},conn=d.connections?.[platform]||{},items=d.history?.items||[];
    const profile=ps.profile||{};
    const canEdit=isGlobalOwner();
    root.innerHTML=`
      <div class="title"><div><h2>Social Media · ${socialPlatformName(platform)}</h2><p class="hint">Erkennung neuer Veröffentlichungen und automatische Weiterleitung an Discord.</p></div>${canEdit?`<button id="socialPlatformTest" type="button" class="secondary">Testmeldung</button>`:""}</div>
      <div class="card"><div class="title compact-title"><h3>Verbindung</h3>${socialConnectionBadge(platform,d)}</div>
        <div class="social-meta-grid">
          <div><span>API-Zugang</span><strong>${conn.configured?"konfiguriert":"fehlt"}</strong></div>
          <div><span>Profil</span><strong>${esc(profile.username||profile.display_name||profile.id||"–")}</strong></div>
          <div><span>Letzter Erfolg</span><strong>${esc(socialFmt(ps.lastSuccessAt))}</strong></div>
          <div><span>Discord-Ziel</span><strong>${esc((d.catalog?.channels||[]).find(x=>x.id===cfg.channelId)?.name?`#${(d.catalog.channels||[]).find(x=>x.id===cfg.channelId).name}`:"–")}</strong></div>
        </div>${ps.lastError?`<div class="error">${esc(ps.lastError)}</div>`:""}
        ${platform==="instagram"?`<div id="instagramTokenOwnerBox" class="social-oauth-box"><span class="hint">Instagram Token-Status wird geladen …</span></div>`:""}
        ${platform==="tiktok"?`<div id="tiktokOauthOwnerBox" class="social-oauth-box"><span class="hint">TikTok OAuth-Status wird geladen …</span></div>`:""}
      </div>
      <div class="card"><div class="title compact-title"><div><h3>Letzte ${socialPlatformName(platform)}-Veröffentlichungen</h3><p class="hint">Neueste Beiträge stehen oben. Bereits erkannte Beiträge können nachträglich veröffentlicht oder mit <strong>Demo senden</strong> erneut an Discord geschickt werden. Demo senden verändert den Dedup-/Baseline-Status nicht.</p></div></div>${renderSocialHistoryRows(items,canEdit)}</div>`;
    $("socialPlatformTest")?.addEventListener("click",()=>testSocialPlatform(platform));
    wireSocialHistoryActions(root,()=>renderSocialPlatform(platform));
    if(platform==="instagram"&&isGlobalOwner())await renderInstagramTokenOwnerBox(d);
    if(platform==="tiktok"&&isGlobalOwner())await renderTikTokOauthOwnerBox();
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
function socialRemainingTime(seconds){
  if(seconds===null||seconds===undefined)return "unbekannt bis erste Erneuerung";
  const s=Math.max(0,Number(seconds)||0),days=Math.floor(s/86400),hours=Math.floor((s%86400)/3600);
  return days>0?`${days} Tage ${hours} Std.`:`${hours} Std.`;
}
async function renderInstagramTokenOwnerBox(data){
  const box=$("instagramTokenOwnerBox");if(!box)return;
  const c=data?.connections?.instagram||{};
  const status=c.reauthorizationRequired?"Erneute Autorisierung erforderlich":c.configured?(c.lastError?"Fehler":"verbunden"):"Token fehlt";
  const badgeClass=c.reauthorizationRequired||c.lastError?"bad":c.configured?"ok":"warn";
  box.innerHTML=`<div class="title compact-title"><div><h3>Instagram Access Token</h3><p class="hint">Instagram API mit Instagram Login · Berechtigung: instagram_business_basic</p></div><span class="diag-badge ${badgeClass}">${esc(status)}</span></div>
    <div class="social-meta-grid">
      <div><span>Account</span><strong>${esc(c.username||"")}</strong></div>
      <div><span>Token-Ablauf</span><strong>${esc(socialFmt(c.expiresAt))}</strong><small>${esc(socialRemainingTime(c.remainingSeconds))}</small></div>
      <div><span>Letzte Erneuerung</span><strong>${esc(socialFmt(c.lastSuccessfulRefreshAt))}</strong></div>
      <div><span>Nächster Versuch</span><strong>${esc(socialFmt(c.nextRefreshAt))}</strong></div>
    </div>
    ${c.lastError?`<div class="error"><strong>${c.reauthorizationRequired?"Erneute Autorisierung erforderlich":"Letzter Fehler"}</strong><div>${esc(c.lastError)}</div></div>`:""}
    <div class="actions"><button id="instagramRefreshNow" type="button" ${!c.configured||c.reauthorizationRequired||c.refreshInProgress?"disabled":""}>Token jetzt erneuern</button></div>
    <details class="social-token-replace"><summary><strong>${c.configured?"Ersatz-Token eintragen":"Instagram-Token eintragen"}</strong><span class="hint">Token wird ausschließlich serverseitig verarbeitet und nicht wieder angezeigt.</span></summary>
      <div class="social-token-replace-body"><label>Long-Lived Instagram Access Token<input id="instagramReplacementToken" type="password" autocomplete="new-password" spellcheck="false" placeholder="Token hier einfügen"></label><button id="instagramSaveToken" type="button">Token prüfen und speichern</button></div>
    </details>
    <p class="hint">Automatische Erneuerung: alle 30 Tage. Der Bot prüft täglich und beim Start. Meta erlaubt die Erneuerung erst, wenn der noch gültige Long-Lived Token mindestens 24 Stunden alt ist. Ein abgelaufener oder widerrufener Token kann nicht durch Refresh wiederbelebt werden.</p>`;
  $("instagramRefreshNow")?.addEventListener("click",async()=>{
    const r=await fetch("/api/social/instagram/refresh",{method:"POST"}),j=await r.json().catch(()=>({}));
    if(!r.ok)return showToast(j.error||"Instagram-Token konnte nicht erneuert werden.","error",6000);
    showToast("Instagram-Token erfolgreich erneuert.","success");renderSocialPlatform("instagram");
  });
  $("instagramSaveToken")?.addEventListener("click",async()=>{
    const token=$("instagramReplacementToken")?.value.trim()||"";
    if(!token)return showToast("Bitte zuerst einen Instagram Access Token eintragen.","warning");
    const r=await fetch("/api/social/instagram/token",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})}),j=await r.json().catch(()=>({}));
    if($("instagramReplacementToken"))$("instagramReplacementToken").value="";
    if(!r.ok)return showToast(j.error||"Instagram-Token konnte nicht gespeichert werden.","error",6000);
    showToast("Instagram-Token geprüft und persistent gespeichert.","success");renderSocialPlatform("instagram");
  });
}

async function renderTikTokOauthOwnerBox(){
  const box=$("tiktokOauthOwnerBox");if(!box)return;
  try{
    const r=await fetch("/api/social/tiktok/oauth-info",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"OAuth-Status konnte nicht geladen werden.");
    const scopes=(d.grantedScopes||[]).join(", ")||"–",profile=d.profile||{};
    box.innerHTML=`<div class="title compact-title"><div><h3>TikTok Login Kit</h3><p class="hint">${esc(d.environment||"sandbox")} · angefordert: user.info.basic, video.list</p></div><span class="diag-badge ${d.connected?"ok":d.configured?"warn":"bad"}">${d.connected?"verbunden":d.configured?"bereit":"Client fehlt"}</span></div>
      <div class="social-meta-grid">
        <div><span>Redirect URI</span><strong class="copy-value">${esc(d.redirectUri||"nicht verfügbar")}</strong></div>
        <div><span>Verbundener Account</span><strong>${esc(profile.display_name||profile.open_id||d.openId||"–")}</strong></div>
        <div><span>Gewährte Scopes</span><strong>${esc(scopes)}</strong></div>
        <div><span>Token-Ablauf</span><strong>${esc(socialFmt(d.expiresAt))}</strong></div>
      </div>
      <div class="actions"><button id="tiktokCopyRedirect" type="button" class="secondary">Redirect URI kopieren</button><button id="tiktokConnect" type="button">${d.connected?"TikTok neu autorisieren":"TikTok verbinden"}</button>${d.connected?'<button id="tiktokDisconnect" type="button" class="danger">Verbindung trennen</button>':""}<button id="tiktokClearLocal" type="button" class="secondary">Lokale TikTok-Daten löschen</button></div>
      <p class="hint">Beim Trennen werden gespeicherte Zugangstokens entfernt und der Access Token nach Möglichkeit bei TikTok widerrufen. Bereits an Discord gesendete Nachrichten/Anhänge bleiben bestehen. Lokale Verlaufsdaten werden nur über den separaten Löschbutton entfernt.</p>`;
    $("tiktokCopyRedirect")?.addEventListener("click",()=>navigator.clipboard.writeText(d.redirectUri||"").then(()=>showToast("Redirect URI kopiert.","success")));
    $("tiktokConnect")?.addEventListener("click",async()=>{const rr=await fetch("/api/social/tiktok/connect",{method:"POST"}),j=await rr.json().catch(()=>({}));if(!rr.ok)return showToast(j.error||"TikTok-Verbindung konnte nicht gestartet werden.","error");window.open(j.url,"bwkTikTokOauth","width=760,height=820,noopener");});
    $("tiktokDisconnect")?.addEventListener("click",async()=>{if(!(await askAs("disconnect","TikTok-Verbindung wirklich trennen? Bestehende Discord-Nachrichten werden nicht gelöscht.")))return;const rr=await fetch("/api/social/tiktok/disconnect",{method:"POST"}),j=await rr.json().catch(()=>({}));if(!rr.ok)return showToast(j.error||"Trennen fehlgeschlagen.","error");showToast(j.revokeError?`Lokale Tokens entfernt; TikTok-Widerruf meldete: ${j.revokeError}`:"TikTok-Verbindung getrennt.","success");renderSocialPlatform("tiktok");});
    $("tiktokClearLocal")?.addEventListener("click",async()=>{if(!(await askDelete("Lokale TikTok-Erkennungs- und Verlaufsdaten löschen? Bereits versendete Discord-Nachrichten bleiben erhalten.")))return;const rr=await fetch("/api/social/tiktok/clear-data",{method:"POST"}),j=await rr.json().catch(()=>({}));if(!rr.ok)return showToast(j.error||"Löschen fehlgeschlagen.","error");showToast("Lokale TikTok-Verlaufsdaten gelöscht.","success");renderSocialPlatform("tiktok");});
  }catch(e){box.innerHTML=`<div class="error">${esc(e.message)}</div>`;}
}
function renderSocialHistoryRows(items,canRetry=true){
  if(!items?.length)return `<span class="hint">Noch keine Veröffentlichungen gespeichert.</span>`;
  return `<div class="social-history-list">${items.map(x=>`
    <div class="social-history-row">
      <div class="social-history-platform"><strong>${esc(socialPlatformName(x.platform))}</strong><span>${esc(x.type||"Beitrag")}</span></div>
      <div><strong>${esc((x.caption||x.title||"Ohne Beschreibung").slice(0,120))}</strong><span class="stats-sub">${esc(socialFmt(x.publishedAt||x.detectedAt))}</span><span class="stats-sub">${x.detectedAt?`Erkannt ${esc(socialFmt(x.detectedAt))}`:""}${x.sentAt?` · Gesendet ${esc(socialFmt(x.sentAt))}`:""}</span></div>
      <div><span class="diag-badge ${x.status==="sent"?"ok":x.status==="failed"?"bad":"warn"}">${x.status==="sent"?"Discord ✓":x.status==="failed"?"Fehler":x.status==="waiting"?"Wartet auf Link":x.status==="skipped"?"Übersprungen":"Baseline"}</span>${x.error?`<span class="stats-sub">${esc(x.error)}</span>`:""}${x.note?`<span class="stats-sub">${esc(x.note)}</span>`:""}</div>
      <div class="social-history-actions">
        ${x.url?`<a class="btn secondary" href="${esc(x.url)}" target="_blank" rel="noopener">Original</a>`:""}
        ${canRetry&&x.status==="failed"&&isGlobalOwner()?`<button class="secondary" data-social-retry="${esc(x.key)}">Retry</button>`:""}
        ${isGlobalOwner()&&["instagram","tiktok"].includes(x.platform)&&x.status!=="sent"?`<button class="secondary" data-social-manual-publish="${esc(x.key)}">Nachträglich veröffentlichen</button>`:""}
        ${isGlobalOwner()&&["instagram","tiktok"].includes(x.platform)?`<button class="secondary" data-social-demo-send="${esc(x.key)}">Demo senden</button>`:""}
      </div>
    </div>`).join("")}</div>`;
}
async function testSocialPlatform(platform){
  const r=await fetch("/api/social/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({platform})}),d=await r.json().catch(()=>({}));
  if(!r.ok)return showToast(d.error||"Testmeldung fehlgeschlagen.","error");
  showToast(`${socialPlatformName(platform)}-Testmeldung an Discord gesendet.`,"success");
}
async function sendHistoricalSocial(key,mode){
  const sourceButton=document.querySelector(`[data-social-manual-publish="${CSS.escape(key)}"],[data-social-demo-send="${CSS.escape(key)}"]`);
  const row=sourceButton?.closest(".social-history-row");
  const platform=(row?.querySelector(".social-history-platform strong")?.textContent||"Social-Media-Beitrag").trim();
  if(mode==="publish"){
    const ok=await askConfirm({
      title:"Nachträgliche Veröffentlichung bestätigen",
      text:`Diesen bereits erkannten ${platform}-Beitrag jetzt an Discord veröffentlichen? Der Eintrag wird anschließend als versendet markiert.`,
      confirmLabel:"VERÖFFENTLICHEN",
      cancelLabel:"ABBRECHEN",
      danger:false
    });
    if(!ok)return false;
  }
  const r=await fetch("/api/social/history-send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,mode})}),d=await r.json().catch(()=>({}));
  if(!r.ok){showToast(d.error||"Versand fehlgeschlagen.","error");return false;}
  showToast(mode==="publish"?`${platform}-Beitrag nachträglich an Discord veröffentlicht.`:`${platform}-Beitrag als Demo erneut an Discord gesendet.`,"success");
  return true;
}
function wireSocialHistoryActions(root,after){
  root.querySelectorAll("[data-social-retry]").forEach(btn=>btn.onclick=async()=>{
    const r=await fetch("/api/social/retry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:btn.dataset.socialRetry})}),j=await r.json().catch(()=>({}));
    if(!r.ok)return showToast(j.error||"Retry fehlgeschlagen.","error");
    showToast("Veröffentlichung erneut an Discord gesendet.","success");await after?.();
  });
  root.querySelectorAll("[data-social-manual-publish]").forEach(btn=>btn.onclick=async()=>{
    if(await sendHistoricalSocial(btn.dataset.socialManualPublish,"publish"))await after?.();
  });
  root.querySelectorAll("[data-social-demo-send]").forEach(btn=>btn.onclick=async()=>{
    if(await sendHistoricalSocial(btn.dataset.socialDemoSend,"test"))await after?.();
  });
}
async function renderSocialPublications(){
  const root=$("socialPublications");if(!root)return;root.innerHTML=`<div class="card">Veröffentlichungen werden geladen …</div>`;
  try{
    const d=await loadSocialData({platform:socialUi.historyPlatform,status:socialUi.historyStatus,search:socialUi.historySearch,page:socialUi.historyPage,pageSize:50});
    root.innerHTML=`
      <div class="title"><div><h2>Social Media · Veröffentlichungen</h2><p class="hint">Gemeinsame Historie von Instagram und TikTok inklusive Discord-Status.</p></div></div>
      <div class="activity-filters social-history-filters"><select id="socialHistoryPlatform"><option value="">Alle Plattformen</option><option value="instagram" ${socialUi.historyPlatform==="instagram"?"selected":""}>Instagram</option><option value="tiktok" ${socialUi.historyPlatform==="tiktok"?"selected":""}>TikTok</option></select><select id="socialHistoryStatus"><option value="">Alle Status</option><option value="sent" ${socialUi.historyStatus==="sent"?"selected":""}>Discord ✓</option><option value="failed" ${socialUi.historyStatus==="failed"?"selected":""}>Fehler</option><option value="baseline" ${socialUi.historyStatus==="baseline"?"selected":""}>Baseline</option><option value="waiting" ${socialUi.historyStatus==="waiting"?"selected":""}>Wartet auf Link</option><option value="skipped" ${socialUi.historyStatus==="skipped"?"selected":""}>Übersprungen</option></select><input id="socialHistorySearch" value="${esc(socialUi.historySearch)}" placeholder="Beschreibung oder ID …"><button id="socialHistoryApply" type="button" class="secondary">Filtern</button></div>
      <div class="card">${renderSocialHistoryRows(d.history?.items||[],true)}</div>
      <div class="activity-pager"><button id="socialHistoryPrev" ${d.history.page<=1?"disabled":""}>← Zurück</button><span>Seite <strong>${d.history.page}</strong> von <strong>${d.history.totalPages}</strong> · ${Number(d.history.total||0)} Veröffentlichung(en)</span><button id="socialHistoryNext" ${d.history.page>=d.history.totalPages?"disabled":""}>Weiter →</button></div>`;
    $("socialHistoryApply")?.addEventListener("click",()=>{socialUi.historyPlatform=$("socialHistoryPlatform").value;socialUi.historyStatus=$("socialHistoryStatus").value;socialUi.historySearch=$("socialHistorySearch").value.trim();socialUi.historyPage=1;renderSocialPublications();});
    $("socialHistoryPrev")?.addEventListener("click",()=>{socialUi.historyPage=Math.max(1,socialUi.historyPage-1);renderSocialPublications();});
    $("socialHistoryNext")?.addEventListener("click",()=>{socialUi.historyPage++;renderSocialPublications();});
    wireSocialHistoryActions(root,()=>renderSocialPublications());
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
async function renderSocialSettings(){
  const root=$("socialSettings");if(!root)return;root.innerHTML=`<div class="card">Social-Media-Einstellungen werden geladen …</div>`;
  try{
    const d=await loadSocialData({page:1,pageSize:1}),c=d.config||{},channels=d.catalog?.channels||[],canEdit=hasCapability("social.settings.edit");
    const options=selected=>channels.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?"selected":""}>#${esc(x.name)}</option>`).join("");
    root.innerHTML=`
      <div class="title"><div><h2>Social Media · Einstellungen</h2><p class="hint">Die API-Tokens bleiben ausschließlich serverseitig. Im Browser werden keine Secrets angezeigt.</p></div></div>
      <div class="card">
        <div class="grid two"><label class="toggle-row"><input id="socialEnabled" type="checkbox" ${c.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Social-Media-Syndication aktiv</span></label><label>Abrufintervall (Min.)<input id="socialPollMinutes" type="number" min="5" max="120" value="${Number(c.pollMinutes||10)}" ${canEdit?"":"disabled"}></label></div>
      </div>
      ${["instagram","tiktok"].map(p=>{const x=c[p]||{},conn=d.connections?.[p]||{};return`<div class="card"><div class="title compact-title"><h3>${socialPlatformName(p)}</h3>${socialConnectionBadge(p,d)}</div><label class="toggle-row"><input data-social-enabled="${p}" type="checkbox" ${x.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Automatische Weiterleitung aktiv</span></label><label>Discord-Zielkanal<select data-social-channel="${p}" ${canEdit?"":"disabled"}>${options(x.channelId)}</select></label><label>Discord-Text<textarea data-social-text="${p}" rows="4" ${canEdit?"":"disabled"}>${esc(x.text||"")}</textarea></label><p class="hint">Variablen: {caption}, {title}, {url}, {type}</p><div class="grid two"><label class="toggle-row"><input data-social-embed="${p}" type="checkbox" ${x.useEmbed!==false?"checked":""} ${canEdit?"":"disabled"}><span>Discord-Embed verwenden</span></label><label class="toggle-row"><input data-social-thumb="${p}" type="checkbox" ${x.includeThumbnail!==false?"checked":""} ${canEdit?"":"disabled"}><span>Thumbnail als Discord-Anhang sichern</span></label></div>${p==="tiktok"?`<div class="grid two"><label class="toggle-row"><input data-social-checklink="${p}" type="checkbox" ${x.checkLink!==false?"checked":""} ${canEdit?"":"disabled"}><span>Link vor dem Senden prüfen</span></label><label>Beiträge älter als … Stunden nicht mehr ankündigen<input data-social-maxage="${p}" type="number" min="0" max="720" value="${Number(x.maxAgeHours??48)}" ${canEdit?"":"disabled"}></label></div><p class="hint">Ist der TikTok-Link nicht abrufbar (z. B. gelöscht oder nur für Werbung angelegt), wird der Beitrag nicht an Discord gesendet. 0 Stunden = keine Altersgrenze.</p>`:""}<p class="hint">Serverzugang: ${conn.configured?"konfiguriert":"noch nicht konfiguriert"}${p==="tiktok"&&conn.configured?` · Auto-Refresh ${conn.autoRefresh?"aktiv":"nicht eingerichtet"}`:""}</p></div>`}).join("")}
      ${canEdit?`<div class="actions"><button id="socialSettingsSave" type="button">Einstellungen speichern</button><button id="socialSettingsPoll" type="button" class="secondary">Jetzt prüfen</button></div>`:""}`;
    $("socialSettingsSave")?.addEventListener("click",async()=>{
      const body={enabled:!!$("socialEnabled")?.checked,pollMinutes:Number($("socialPollMinutes")?.value||10)};
      for(const p of["instagram","tiktok"])body[p]={enabled:!!root.querySelector(`[data-social-enabled="${p}"]`)?.checked,channelId:root.querySelector(`[data-social-channel="${p}"]`)?.value||"",text:root.querySelector(`[data-social-text="${p}"]`)?.value||"",useEmbed:!!root.querySelector(`[data-social-embed="${p}"]`)?.checked,includeThumbnail:!!root.querySelector(`[data-social-thumb="${p}"]`)?.checked};
      body.tiktok.checkLink=!!root.querySelector('[data-social-checklink="tiktok"]')?.checked;body.tiktok.maxAgeHours=Math.max(0,Math.min(720,Number(root.querySelector('[data-social-maxage="tiktok"]')?.value||0)));
      const r=await fetch("/api/social/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
      if(!r.ok)return showToast(j.error||"Social-Media-Einstellungen konnten nicht gespeichert werden.","error");
      showToast("Social-Media-Einstellungen gespeichert.","success");renderSocialSettings();
    });
    $("socialSettingsPoll")?.addEventListener("click",async()=>{await runSocialPoll();renderSocialSettings();});
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

let discordReportsUi={status:"open",page:1,search:""};
async function renderDiscordReports(){
  const root=$("discordReports");if(!root)return;
  root.innerHTML=`<div class="card">Ticket Center wird geladen …</div>`;
  try{
    const requestedStatus=discordReportsUi.status==="settings"?"open":discordReportsUi.status;
    const q=new URLSearchParams({status:requestedStatus,page:String(discordReportsUi.page),pageSize:"50"});
    if(discordReportsUi.search&&discordReportsUi.status!=="settings")q.set("search",discordReportsUi.search);
    const r=await fetch(`/api/discord/reports?${q}`,{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Meldungen konnten nicht geladen werden.");
    const canEdit=hasCapability("discord.reports.edit"),c=d.config||{},channels=d.catalog?.channels||[];
    const channelOptions=selected=>channels.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?"selected":""}>#${esc(x.name)}</option>`).join("");
    const statusLabel={open:"Eingang / Offen",resolved:"Erledigt",rejected:"Abgewiesen",settings:"Einstellungen"};
    const countLabel={open:Number(d.counts?.open||0),resolved:Number(d.counts?.resolved||0),rejected:Number(d.counts?.rejected||0)};

    root.innerHTML=`
      <div class="title"><div><h2>Meldesystem · Ticket Center</h2><p class="hint">Zentrale Bearbeitung von Discord-Meldungen mit vollständiger Aktionshistorie.</p></div><button id="reportRefresh" type="button" class="secondary">Aktualisieren</button></div>

      <nav class="moderation-subnav reports-top-tabs" aria-label="Ticketbereiche">
        <button type="button" class="moderation-subtab ${discordReportsUi.status==="open"?"active":""}" data-report-status="open">Eingang / Offen <span class="tab-count">${countLabel.open}</span></button>
        <button type="button" class="moderation-subtab ${discordReportsUi.status==="resolved"?"active":""}" data-report-status="resolved">Erledigt <span class="tab-count">${countLabel.resolved}</span></button>
        <button type="button" class="moderation-subtab ${discordReportsUi.status==="rejected"?"active":""}" data-report-status="rejected">Abgewiesen <span class="tab-count">${countLabel.rejected}</span></button>
        ${canEdit?`<button type="button" class="moderation-subtab ${discordReportsUi.status==="settings"?"active":""}" data-report-status="settings">Einstellungen</button>`:""}
      </nav>

      ${discordReportsUi.status==="settings" && canEdit ? `
      <div class="card report-settings-tab">
        <div class="title compact-title"><div><h3>Meldesystem einrichten</h3><p class="hint">Button, Archivierung und Cooldown. Discord-Logs werden zentral unter Administration verwaltet.</p></div></div>
        <div class="grid two">
          <label class="toggle-row"><input id="reportEnabled" type="checkbox" ${c.enabled!==false?"checked":""}><span>Meldesystem aktiv</span></label>
          <label class="toggle-row"><input id="reportArchive" type="checkbox" ${c.archiveAttachments!==false?"checked":""}><span>Bilder/Attachments lokal archivieren</span></label>
        </div>
        <div class="grid two">
          <label>Button-Kanal<select id="reportButtonChannel">${channelOptions(c.buttonChannelId)}</select></label>
          <label>Cooldown pro User (Min.)<input id="reportCooldown" type="number" min="0" max="1440" value="${Number(c.cooldownMinutes||0)}"></label>
        </div>
        <input id="reportLogChannel" type="hidden" value="${esc(c.logChannelId||"")}">
        <input id="reportLogNew" type="checkbox" class="hidden" ${c.logNewTicket!==false?"checked":""}>
        <input id="reportLogStatus" type="checkbox" class="hidden" ${c.logStatusChanges!==false?"checked":""}>
        <input id="reportLogSanctions" type="checkbox" class="hidden" ${c.logSanctions!==false?"checked":""}>
        <input id="reportLogDelete" type="checkbox" class="hidden" ${c.logContentDeletion!==false?"checked":""}>
        <label>Text über dem Melden-Button<textarea id="reportButtonText" rows="3">${esc(c.buttonText||"")}</textarea></label>
        <label>Button-Beschriftung<input id="reportButtonLabel" value="${esc(c.buttonLabel||"Meldung erstellen")}"></label>
        ${isGlobalAdmin()?'<div class="central-log-link"><strong>Ticket-Logs:</strong> Neue Tickets, Statusänderungen, Sanktionen und gelöschte Inhalte werden zentral konfiguriert.<br><button type="button" class="secondary" data-open-log-category="reports">Log-Einstellungen öffnen</button></div>':""}
        <div class="actions">
          <button id="reportConfigSave" type="button">Einstellungen speichern</button>
          <button id="reportButtonPublish" type="button" class="secondary">${c.buttonMessageId?"Melden-Button aktualisieren":"Melden-Button veröffentlichen"}</button>
        </div>
        <p class="hint">Zusätzlich stehen serverweit Apps → Nachricht melden, Apps → User melden und /melden zur Verfügung. Registriert: ${d.state?.commandsRegisteredAt?esc(discordFormatTime(d.state.commandsRegisteredAt)):"noch nicht bestätigt"}.</p>
      </div>
      ` : `
      <div class="report-toolbar">
        <div class="report-search">
          <input id="reportSearch" value="${esc(discordReportsUi.search)}" placeholder="Ticket, User, Grund oder Inhalt suchen …">
          <button id="reportSearchBtn" type="button" class="secondary">Suchen</button>
        </div>
      </div>
      <div id="reportTicketList">${(d.items||[]).length?(d.items||[]).map(t=>renderReportTicket(t,canEdit)).join(""):`<div class="card"><span class="hint">Keine Tickets in ${statusLabel[discordReportsUi.status]}.</span></div>`}</div>
      <div class="activity-pager"><button id="reportPrev" ${d.page<=1?"disabled":""}>← Zurück</button><span>Seite <strong>${d.page}</strong> von <strong>${d.totalPages}</strong> · ${Number(d.total||0)} Ticket(s)</span><button id="reportNext" ${d.page>=d.totalPages?"disabled":""}>Weiter →</button></div>
      `}`;

    const reload=()=>renderDiscordReports();
    root.querySelectorAll("[data-report-status]").forEach(btn=>btn.onclick=()=>{
      discordReportsUi.status=btn.dataset.reportStatus;
      discordReportsUi.page=1;
      reload();
    });
    wireCentralLogLinks(root);
    $("reportRefresh")?.addEventListener("click",reload);

    if(discordReportsUi.status!=="settings"){
      $("reportSearchBtn")?.addEventListener("click",()=>{discordReportsUi.search=$("reportSearch")?.value.trim()||"";discordReportsUi.page=1;reload();});
      $("reportSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter")$("reportSearchBtn")?.click();});
      $("reportPrev")?.addEventListener("click",()=>{discordReportsUi.page=Math.max(1,discordReportsUi.page-1);reload();});
      $("reportNext")?.addEventListener("click",()=>{discordReportsUi.page++;reload();});
      root.querySelectorAll("[data-report-action]").forEach(btn=>btn.onclick=()=>handleReportUiAction(btn.dataset.reportAction,btn.dataset.ticketId,btn.closest(".report-ticket"),reload));
    }

    $("reportConfigSave")?.addEventListener("click",async()=>{
      const body={
        enabled:!!$("reportEnabled")?.checked,
        archiveAttachments:!!$("reportArchive")?.checked,
        logChannelId:$("reportLogChannel")?.value||"",
        buttonChannelId:$("reportButtonChannel")?.value||"",
        cooldownMinutes:Number($("reportCooldown")?.value||0),
        buttonText:$("reportButtonText")?.value||"",
        buttonLabel:$("reportButtonLabel")?.value||"",
        logNewTicket:!!$("reportLogNew")?.checked,
        logStatusChanges:!!$("reportLogStatus")?.checked,
        logSanctions:!!$("reportLogSanctions")?.checked,
        logContentDeletion:!!$("reportLogDelete")?.checked
      };
      const rr=await fetch("/api/discord/reports/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Einstellungen konnten nicht gespeichert werden.","error");
      showToast("Meldesystem gespeichert.","success");reload();
    });
    $("reportButtonPublish")?.addEventListener("click",async()=>{
      const rr=await fetch("/api/discord/reports/button/publish",{method:"POST"}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Melden-Button konnte nicht veröffentlicht werden.","error");
      showToast("Melden-Button in Discord veröffentlicht/aktualisiert.","success");reload();
    });
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
function renderReportAttachment(ticketId,a){
  if(a.archived&&a.localFile){
    const src=`/api/discord/reports/attachment?ticketId=${encodeURIComponent(ticketId)}&file=${encodeURIComponent(a.localFile)}`;
    if(String(a.contentType||"").startsWith("image/"))return `<figure class="report-attachment"><img src="${src}" alt="${esc(a.filename||"Bild")}"><figcaption>${esc(a.filename||"Bild")} · lokal archiviert</figcaption></figure>`;
    return `<a class="btn secondary" href="${src}" target="_blank" rel="noopener">${esc(a.filename||"Attachment")} öffnen</a>`;
  }
  if(a.url&&String(a.contentType||"").startsWith("image/"))return `<figure class="report-attachment"><img src="${esc(a.url)}" alt="${esc(a.filename||"Bild")}"><figcaption>${esc(a.filename||"Bild")} · Discord-Quelle${a.archiveError?` · Archivfehler: ${esc(a.archiveError)}`:""}</figcaption></figure>`;
  return a.url?`<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.filename||"Attachment")}</a>`:`<span class="hint">${esc(a.filename||"Attachment")} nicht verfügbar</span>`;
}
function reportActionLabel(type){return({content_deleted:"Inhalt gelöscht",warning:"Individuelle Verwarnung",timeout:"Timeout",ban:"Ban",resolved:"Ticket erledigt",rejected:"Ticket abgewiesen",reopened:"Ticket wieder geöffnet"})[type]||type;}
function renderReportTicket(t,canEdit){
  const reporter=t.reporter||{},target=t.targetUser||{},source=t.source||{},actions=[...(t.actions||[])].reverse();
  return `<details class="card report-ticket" data-ticket="${esc(t.id)}">
    <summary class="report-ticket-summary"><div><strong>${esc(t.id)}</strong><span class="report-status ${esc(t.status)}">${t.status==="open"?"Offen":t.status==="resolved"?"Erledigt":"Abgewiesen"}</span></div><div><strong>${esc(t.reasonLabel||t.reason)}</strong><span class="stats-sub">${target.displayName||target.username?esc(target.displayName||target.username):"kein konkreter User"}</span></div><div><span class="stats-sub">Eingang</span>${esc(discordFormatTime(t.createdAt))}</div><span class="access-user-chevron">⌄</span></summary>
    <div class="report-ticket-body">
      <div class="report-meta-grid"><div><span>Gemeldet von</span><strong>${esc(reporter.displayName||reporter.username||reporter.id||"Unbekannt")}</strong><small>${esc(reporter.id||"")}</small></div><div><span>Gemeldeter User</span><strong>${target.id?esc(target.displayName||target.username||target.id):"—"}</strong><small>${esc(target.id||"")}</small></div><div><span>Grund</span><strong>${esc(t.reasonLabel||t.reason)}</strong></div><div><span>Kanal</span><strong>${source.channelId?`#${esc(source.channelName||source.channelId)}`:"—"}</strong></div></div>
      ${t.description?`<div class="report-description"><span class="fieldlabel">Beschreibung des Meldenden</span>${esc(t.description)}</div>`:""}
      ${source.type==="message"?`<div class="report-content"><div class="title compact-title"><div><h3>Gemeldeter Inhalt</h3><p class="hint">${source.deletedAt?"Nachricht wurde inzwischen über das Ticket gelöscht.":"Gespeicherte Kopie aus Discord."}</p></div>${source.messageUrl?`<a class="btn secondary" href="${esc(source.messageUrl)}" target="_blank" rel="noopener">Original öffnen</a>`:""}</div><div class="report-message-copy">${source.content?esc(source.content):'<span class="hint">Kein Nachrichtentext.</span>'}</div>${(source.attachments||[]).length?`<div class="report-attachments">${source.attachments.map(a=>renderReportAttachment(t.id,a)).join("")}</div>`:""}${(source.embeds||[]).length?`<div class="report-embeds">${source.embeds.map(e=>`<div class="report-embed"><strong>${esc(e.title||"Embed")}</strong>${e.description?`<div>${esc(e.description)}</div>`:""}</div>`).join("")}</div>`:""}${canEdit&&!source.deletedAt?`<button type="button" class="danger report-action-btn" data-report-action="delete_message" data-ticket-id="${esc(t.id)}">Gemeldete Nachricht löschen</button>`:""}</div>`:""}
      ${canEdit&&target.id&&t.status==="open"?`<div class="report-sanctions"><h3>Maßnahmen gegen gemeldeten User</h3><div class="report-sanction-grid">
        <div class="report-action-card"><strong>Individuelle Verwarnung</strong><textarea data-report-warning rows="4" placeholder="Individueller Text an den User …"></textarea><button type="button" class="secondary" data-report-action="warn" data-ticket-id="${esc(t.id)}">Verwarnung per DM senden</button></div>
        <div class="report-action-card"><strong>Timeout</strong><div class="row"><input data-report-timeout-value type="number" min="1" value="10"><select data-report-timeout-unit><option value="1">Minuten</option><option value="60">Stunden</option><option value="1440">Tage</option></select></div><input data-report-timeout-reason placeholder="Grund für den Timeout" value="Ticket ${esc(t.id)}"><button type="button" class="secondary" data-report-action="timeout" data-ticket-id="${esc(t.id)}">Timeout aussprechen</button></div>
        <div class="report-action-card danger-zone"><strong>Ban</strong><input data-report-ban-reason placeholder="Ban-Grund" value="Ticket ${esc(t.id)}"><button type="button" class="danger-strong" data-report-action="ban" data-ticket-id="${esc(t.id)}">User bannen</button></div>
      </div></div>`:""}
      <div class="report-history"><h3>Ticketverlauf</h3>${actions.length?actions.map(x=>`<div class="report-history-row"><time>${esc(discordFormatTime(x.at))}</time><strong>${esc(reportActionLabel(x.type))}</strong><span>${esc(x.actor?.name||"System")}${x.minutes?` · ${Number(x.minutes)} Min.`:""}${x.reason?` · ${esc(x.reason)}`:""}${x.note?` · ${esc(x.note)}`:""}</span></div>`).join(""):`<span class="hint">Noch keine Bearbeitungsschritte.</span>`}</div>
      ${canEdit?`<div class="report-close">${t.status==="open"?`<textarea data-report-close-note rows="2" placeholder="Interne Abschlussnotiz (bei Abweisung verpflichtend)"></textarea><div class="actions"><button type="button" data-report-action="resolve" data-ticket-id="${esc(t.id)}">Als erledigt schließen</button><button type="button" class="secondary" data-report-action="reject" data-ticket-id="${esc(t.id)}">Abweisen</button></div>`:`<div class="report-closed-info"><strong>${t.status==="resolved"?"Erledigt":"Abgewiesen"}</strong> durch ${esc(t.closedBy?.name||"Unbekannt")} · ${esc(discordFormatTime(t.closedAt))}${t.closingNote?`<div>${esc(t.closingNote)}</div>`:""}<button type="button" class="secondary" data-report-action="reopen" data-ticket-id="${esc(t.id)}">Ticket wieder öffnen</button></div>`}</div>`:""}
    </div></details>`;
}
async function handleReportUiAction(action,ticketId,card,reload){
  const body={ticketId,action};
  if(action==="warn"){body.text=card.querySelector("[data-report-warning]")?.value.trim()||"";if(!body.text)return showToast("Bitte zuerst einen individuellen Verwarntext eingeben.","warning");}
  else if(action==="timeout"){const value=Number(card.querySelector("[data-report-timeout-value]")?.value||0),factor=Number(card.querySelector("[data-report-timeout-unit]")?.value||1);body.minutes=Math.round(value*factor);body.reason=card.querySelector("[data-report-timeout-reason]")?.value.trim()||`Ticket ${ticketId}`;if(!body.minutes)return showToast("Bitte eine gültige Timeout-Dauer eingeben.","warning");}
  else if(action==="ban"){body.reason=card.querySelector("[data-report-ban-reason]")?.value.trim()||`Ticket ${ticketId}`;if(!(await askAs("ban",`User wirklich bannen? Diese Maßnahme wird dauerhaft im Ticket ${ticketId} dokumentiert.`)))return;}
  else if(action==="delete_message"){if(!(await askDelete(`Gemeldete Discord-Nachricht aus ${ticketId} wirklich löschen? Die gespeicherte Ticketkopie bleibt erhalten.`)))return;body.reason=`Ticket ${ticketId}`;}
  else if(action==="resolve"||action==="reject"){body.note=card.querySelector("[data-report-close-note]")?.value.trim()||"";if(action==="reject"&&!body.note)return showToast("Für eine Abweisung ist eine Begründung erforderlich.","warning");}
  const rr=await fetch("/api/discord/reports/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await rr.json().catch(()=>({}));
  if(!rr.ok)return showToast(j.error||"Ticket-Aktion fehlgeschlagen.","error");
  const labels={warn:"Verwarnung gesendet.",timeout:"Timeout ausgesprochen.",ban:"User gebannt.",delete_message:"Nachricht gelöscht.",resolve:"Ticket erledigt.",reject:"Ticket abgewiesen.",reopen:"Ticket wieder geöffnet."};
  showToast(labels[action]||"Ticket aktualisiert.","success");reload();
}


let discordUserHistoryState={query:""};

function moderationEventLabel(event){
  const type=String(event?.eventType||"");
  if(type==="timeout")return `${event.timeoutStage||""}. Timeout`.trim();
  if(type==="ban")return "Ban";
  if(type==="unban")return "Ban aufgehoben";
  if(type==="native")return "Discord AutoMod";
  return event.ruleName||"Verstoß";
}
function moderationEventTone(event){
  const type=String(event?.eventType||"");
  if(type==="ban")return"bad";
  if(type==="unban")return"ok";
  if(type==="timeout")return"warn";
  return"neutral";
}
async function renderDiscordUserHistory(query=discordUserHistoryState.query||""){
  const root=$("discordUserHistory");if(!root)return;
  root.innerHTML=`<div class="card">Userhistorie wird geladen …</div>`;
  try{
    const r=await fetch(`/api/discord/moderation/history?query=${encodeURIComponent(query||"")}`,{cache:"no-store"}),d=await r.json();
    if(!r.ok)throw new Error(d.error||"Userhistorie konnte nicht geladen werden.");
    discordUserHistoryState.query=d.query||query||"";
    const rows=d.items||[],canManage=hasCapability("discord.moderation.edit");
    root.innerHTML=`
      <div class="title">
        <div><h2>Discord · Userhistorie</h2><p class="hint">Moderationsverlauf pro Discord-User: Verstöße, Timeouts, Bans und Aufhebungen.</p></div>
        <button id="discordUserHistoryRefresh" type="button" class="secondary">Aktualisieren</button>
      </div>
      <div class="card">
        <div class="discord-member-search">
          <input id="discordUserHistoryQuery" value="${esc(discordUserHistoryState.query)}" placeholder="User-ID, Benutzername, Regel, Treffer oder Aktion">
          <button id="discordUserHistorySearch" type="button">Suchen</button>
          <button id="discordUserHistoryClear" type="button" class="secondary">Zurücksetzen</button>
        </div>
        <p class="hint">${Number(d.total||0)} User in der Moderationshistorie${discordUserHistoryState.query?` · Filter: ${esc(discordUserHistoryState.query)}`:""}.</p>
      </div>

      <div class="user-history-list">
        ${rows.length?rows.map(row=>`
          <details class="card user-history-card">
            <summary>
              <div class="user-history-summary-main">
                <strong>${esc(row.username||row.userId)}</strong>
                <span class="stats-sub">${esc(row.userId)}</span>
              </div>
              <div class="user-history-summary-kpis">
                <span><strong>${Number(row.currentViolations||0)}</strong><small>aktuelle Verstöße</small></span>
                <span><strong>${Number(row.timeoutCount||0)}</strong><small>Timeouts gesamt</small></span>
                <span><strong>${Number(row.eventCount||0)}</strong><small>Ereignisse</small></span>
                ${row.bannedAt?discordToneBadge("GEBANNT","bad"):row.unbannedAt?discordToneBadge("ENTBANNT","ok"):row.timeoutStage?discordToneBadge(`STUFE ${row.timeoutStage}`,"warn"):discordToneBadge("OHNE AKTIVE SANKTION","neutral")}
              </div>
              <span class="access-user-chevron">⌄</span>
            </summary>

            <div class="user-history-body">
              <div class="summary-grid user-history-overview">
                <div class="summary-item"><strong>${row.firstViolationAt?esc(discordFormatTime(row.firstViolationAt)):"–"}</strong><span>erster Verstoß</span></div>
                <div class="summary-item"><strong>${row.lastViolationAt?esc(discordFormatTime(row.lastViolationAt)):"–"}</strong><span>letzter Verstoß</span></div>
                <div class="summary-item"><strong>${row.lastTimeoutAt?esc(discordFormatTime(row.lastTimeoutAt)):"–"}</strong><span>letzter Timeout</span></div>
                <div class="summary-item"><strong>${row.unbannedAt?esc(discordFormatTime(row.unbannedAt)):"–"}</strong><span>letzter Unban</span></div>
              </div>

              <div class="user-history-current">
                <div><span>Letzte Regel</span><strong>${esc(row.lastRuleName||"–")}</strong></div>
                <div><span>Letzter Treffer</span><strong>${esc(row.lastMatchedTerm||"–")}</strong></div>
                <div><span>Ban-Grund</span><strong>${esc(row.banReason||"–")}</strong></div>
                <div><span>Letztes Ereignis</span><strong>${esc(discordFormatTime(row.lastEventAt))}</strong></div>
              </div>

              <div class="title compact-title"><div><h3>Chronik</h3><p class="hint">Neueste Ereignisse zuerst.</p></div></div>
              <div class="user-history-events">
                ${(row.events||[]).length?(row.events||[]).map(e=>`
                  <div class="user-history-event">
                    <time>${esc(discordFormatTime(e.ts))}</time>
                    ${discordToneBadge(moderationEventLabel(e),moderationEventTone(e))}
                    <div>
                      <strong>${esc(e.ruleName||moderationEventLabel(e))}</strong>
                      ${e.matchedTerm?`<div class="stats-sub">Treffer: ${esc(e.matchedTerm)}</div>`:""}
                      ${(e.actions||[]).length?`<div class="stats-sub">${esc((e.actions||[]).join(" · "))}</div>`:""}
                    </div>
                    <span class="stats-sub">${e.channelId?`Kanal-ID ${esc(e.channelId)}`:""}</span>
                  </div>`).join(""):'<span class="hint">Keine einzelnen Logereignisse gespeichert.</span>'}
              </div>

              ${canManage?`<div class="actions">
                <button type="button" class="secondary history-reset-user" data-user-id="${esc(row.userId)}">Eskalation zurücksetzen</button>
                ${row.bannedAt?`<button type="button" class="secondary history-unban-user" data-user-id="${esc(row.userId)}">Ban aufheben</button>`:""}
              </div>`:""}
            </div>
          </details>
        `).join(""):'<div class="card hint">Keine passenden User gefunden.</div>'}
      </div>`;

    const search=()=>{discordUserHistoryState.query=$("discordUserHistoryQuery")?.value.trim()||"";renderDiscordUserHistory(discordUserHistoryState.query);};
    $("discordUserHistorySearch")?.addEventListener("click",search);
    $("discordUserHistoryQuery")?.addEventListener("keydown",e=>{if(e.key==="Enter")search();});
    $("discordUserHistoryClear")?.addEventListener("click",()=>{discordUserHistoryState.query="";renderDiscordUserHistory("");});
    $("discordUserHistoryRefresh")?.addEventListener("click",()=>renderDiscordUserHistory(discordUserHistoryState.query));

    root.querySelectorAll(".history-reset-user").forEach(btn=>btn.onclick=async()=>{
      const ok=await askConfirm({title:"Eskalation zurücksetzen",text:"Aktuelle Eskalationsstufe und Verstoßzähler dieses Users zurücksetzen? Die historische Chronik bleibt erhalten.",confirmLabel:"ZURÜCKSETZEN",cancelLabel:"ABBRECHEN",danger:false});
      if(!ok)return;
      const rr=await fetch("/api/discord/moderation/reset-user",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:btn.dataset.userId})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Zurücksetzen fehlgeschlagen.","error");
      showToast("Eskalationsstufe zurückgesetzt. Historie bleibt erhalten.","success");
      renderDiscordUserHistory(discordUserHistoryState.query);
    });
    root.querySelectorAll(".history-unban-user").forEach(btn=>btn.onclick=async()=>{
      const ok=await askConfirm({title:"Ban aufheben",text:"Ban dieses Users aufheben? Die aktive Eskalation wird zurückgesetzt, die historische Chronik bleibt erhalten.",confirmLabel:"BAN AUFHEBEN",cancelLabel:"ABBRECHEN",danger:false});
      if(!ok)return;
      const rr=await fetch("/api/discord/moderation/unban",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:btn.dataset.userId})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Ban konnte nicht aufgehoben werden.","error");
      showToast("Ban aufgehoben. Historie bleibt erhalten.","success");
      renderDiscordUserHistory(discordUserHistoryState.query);
    });
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}


async function renderDiscordSanctions(){
  const root=$("discordSanctions");if(!root)return;
  root.innerHTML=`<div class="card">Sanktionsübersicht wird geladen …</div>`;

  const render=async()=>{
    try{
      const rr=await fetch("/api/discord/moderation/sanctions",{cache:"no-store"}),sd=await rr.json().catch(()=>({}));
      if(!rr.ok)throw new Error(sd.error||"Sanktionsübersicht konnte nicht geladen werden.");

      const canManage=hasCapability("discord.moderation.edit");
      const warned=sd.warned||[],bans=sd.bans||[];
      const bannedIds=new Set(bans.map(x=>String(x.userId||"")));
      const activeTimeouts=warned.filter(x=>!!x.activeTimeoutUntil);
      const spam=warned.filter(x=>Number(x.spamOffenses||0)>0);
      const escalations=warned.filter(x=>Number(x.currentViolations||0)>0||Number(x.timeoutStage||0)>0||Number(x.timeoutCount||0)>0||Number(x.spamOffenses||0)>0);
      let mode=root.dataset.sanctionsMode||"all";

      const allMap=new Map();
      warned.forEach(x=>allMap.set(String(x.userId),{...x,_kind:"warned"}));
      bans.forEach(x=>allMap.set(String(x.userId),{...allMap.get(String(x.userId)),...x,_kind:"banned",banned:true}));
      const all=[...allMap.values()];

      let rows=all;
      if(mode==="timeout")rows=all.filter(x=>!!x.activeTimeoutUntil);
      if(mode==="banned")rows=all.filter(x=>x.banned||bannedIds.has(String(x.userId)));
      if(mode==="escalation")rows=all.filter(x=>Number(x.currentViolations||0)>0||Number(x.timeoutStage||0)>0||Number(x.timeoutCount||0)>0);
      if(mode==="spam")rows=all.filter(x=>Number(x.spamOffenses||0)>0);

      const rowHtml=x=>{
        const userId=String(x.userId||"");
        const banned=!!x.banned||bannedIds.has(userId);
        const timeoutUntil=x.activeTimeoutUntil||null;
        const status=[];
        if(banned)status.push('<span class="diag-badge bad">Gebannt</span>');
        if(timeoutUntil)status.push('<span class="diag-badge warn">Timeout aktiv</span>');
        if(Number(x.spamOffenses||0)>0)status.push('<span class="diag-badge warn">Spam</span>');
        if(!banned&&!timeoutUntil&&(Number(x.currentViolations||0)>0||Number(x.timeoutStage||0)>0||Number(x.timeoutCount||0)>0))status.push('<span class="diag-badge">Eskalation</span>');
        const tracked=x.tracked||{};
        const reason=x.reason||tracked.banReason||x.lastTimeoutRule||"—";
        return `<div class="card sanction-overview-card">
          <div class="title compact-title">
            <div><h3>${esc(x.username||x.accountUsername||userId||"User")}</h3><p class="hint">${esc(userId)}</p></div>
            <div class="moderation-health">${status.join("")||'<span class="diag-badge ok">Keine aktive Sanktion</span>'}</div>
          </div>
          <div class="diag-kv">
            <span>Aktiver Timeout</span><strong>${timeoutUntil?esc(discordFormatTime(timeoutUntil)):"Nein"}</strong>
            <span>Gebannt</span><strong>${banned?"Ja":"Nein"}</strong>
            <span>Allgemeine Verstöße</span><strong>${Number(x.currentViolations||0)}</strong>
            <span>Timeout-Stufe</span><strong>${Number(x.timeoutStage||0)}/3</strong>
            <span>Timeouts gesamt</span><strong>${Number(x.timeoutCount||tracked.timeoutCount||0)}</strong>
            <span>Spam-Verstöße im Eskalationsfenster</span><strong>${Number(x.spamOffenses||0)}</strong>
            <span>Letzte Ursache</span><strong>${esc(reason)}</strong>
            <span>Letzter Verstoß</span><strong>${x.lastViolationAt?esc(discordFormatTime(x.lastViolationAt)):"—"}</strong>
          </div>
          ${canManage?`<div class="actions" style="flex-wrap:wrap">
            ${timeoutUntil?`<button class="secondary sanctions-untimeout" data-user-id="${esc(userId)}" data-reset="false" type="button">Timeout aufheben</button><button class="secondary sanctions-untimeout" data-user-id="${esc(userId)}" data-reset="true" type="button">Timeout + Eskalation zurücksetzen</button>`:""}
            ${(Number(x.currentViolations||0)>0||Number(x.timeoutStage||0)>0||Number(x.timeoutCount||0)>0||Number(x.spamOffenses||0)>0)?`<button class="secondary sanctions-reset" data-user-id="${esc(userId)}" type="button">Nur Eskalation zurücksetzen</button>`:""}
            ${banned?`<button class="secondary sanctions-unban" data-user-id="${esc(userId)}" type="button">Ban aufheben</button>`:""}
          </div>`:""}
        </div>`;
      };

      root.innerHTML=`
        <div class="title">
          <div><h2>Discord · Sanktionsübersicht</h2><p class="hint">Zentrale Übersicht über aktive Timeouts, Bans und Eskalationsstände aus allen Moderationsbereichen.</p></div>
          <button id="discordSanctionsPageRefresh" type="button" class="secondary">Aktualisieren</button>
        </div>
        <div class="grid four">
          <div class="card stat-card"><strong>${activeTimeouts.length}</strong><span>aktive Timeouts</span></div>
          <div class="card stat-card"><strong>${bans.length}</strong><span>gebannte Nutzer</span></div>
          <div class="card stat-card"><strong>${escalations.length}</strong><span>Eskalationen</span></div>
          <div class="card stat-card"><strong>${spam.length}</strong><span>Spam-Eskalationen</span></div>
        </div>
        <div class="activity-tabs sanctions-page-tabs">
          <button class="activity-tab ${mode==="all"?"active":""}" data-sanctions-filter="all" type="button">Alle</button>
          <button class="activity-tab ${mode==="timeout"?"active":""}" data-sanctions-filter="timeout" type="button">Timeout aktiv</button>
          <button class="activity-tab ${mode==="banned"?"active":""}" data-sanctions-filter="banned" type="button">Gebannt</button>
          <button class="activity-tab ${mode==="escalation"?"active":""}" data-sanctions-filter="escalation" type="button">Eskalation</button>
          <button class="activity-tab ${mode==="spam"?"active":""}" data-sanctions-filter="spam" type="button">Spam</button>
        </div>
        <div id="discordSanctionsPageList">${rows.length?rows.map(rowHtml).join(""):'<div class="card hint">Keine Nutzer für diesen Filter.</div>'}</div>`;

      $("discordSanctionsPageRefresh")?.addEventListener("click",render);
      root.querySelectorAll("[data-sanctions-filter]").forEach(btn=>btn.addEventListener("click",()=>{root.dataset.sanctionsMode=btn.dataset.sanctionsFilter;render();}));
      root.querySelectorAll(".sanctions-untimeout").forEach(btn=>btn.onclick=async()=>{
        const reset=btn.dataset.reset==="true";
        const ok=await askConfirm({title:"Timeout aufheben",text:reset?"Timeout aufheben und die allgemeine sowie Spam-Eskalation dieses Users zurücksetzen?":"Timeout aufheben? Die Eskalationsstände bleiben erhalten.",confirmLabel:"TIMEOUT AUFHEBEN",cancelLabel:"ABBRECHEN",danger:false});
        if(!ok)return;
        const x=await fetch("/api/discord/moderation/untimeout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:btn.dataset.userId,resetEscalation:reset})}),j=await x.json().catch(()=>({}));
        if(!x.ok)return showToast(j.error||j.message||`Timeout konnte nicht aufgehoben werden (HTTP ${x.status}).`,"error");
        showToast(reset?"Timeout aufgehoben und Eskalation zurückgesetzt.":"Timeout aufgehoben. Eskalation bleibt erhalten.","success");render();
      });
      root.querySelectorAll(".sanctions-reset").forEach(btn=>btn.onclick=async()=>{
        try{if(await runDiscordMemberModerationAction('reset',btn.dataset.userId))await render();}
        catch(e){showToast(e.message,'error');}
      });
      root.querySelectorAll(".sanctions-unban").forEach(btn=>btn.onclick=async()=>{
        const ok=await askConfirm({title:"Ban aufheben",text:"Ban dieses Users aufheben? Die aktive Eskalation wird zurückgesetzt, die historische Chronik bleibt erhalten.",confirmLabel:"BAN AUFHEBEN",cancelLabel:"ABBRECHEN",danger:false});
        if(!ok)return;
        const x=await fetch("/api/discord/moderation/unban",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:btn.dataset.userId})}),j=await x.json().catch(()=>({}));
        if(!x.ok)return showToast(j.error||"Ban konnte nicht aufgehoben werden.","error");
        showToast("Ban aufgehoben.","success");render();
      });
    }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
  };
  await render();
}

async function renderDiscordModerationLog(){
  const root=$("discordModerationLog");if(!root)return;
  root.innerHTML=`<div class="card">Moderationsprotokoll wird geladen …</div>`;
  try{
    const rr=await fetch("/api/discord/moderation",{cache:"no-store"}),d=await rr.json().catch(()=>({}));
    if(!rr.ok)throw new Error(d.error||"Moderation konnte nicht geladen werden.");
    const channels=d.catalog?.channels||[];
    const chOpts=selected=>channels.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?"selected":""}>#${esc(x.name)}</option>`).join("");
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Protokoll & Test</h2><p class="hint">Moderationsereignisse zentral prüfen und Filter ohne Discord-Aktion testen.</p></div><button id="discordModerationLogRefresh" type="button" class="secondary">Aktualisieren</button></div>
      <div class="card">
        <h3>Filtertest / Dry-Run</h3>
        <p class="hint">Keine Discord-Aktion. Prüft Link-Whitelist und Wort-/Phrasenregeln.</p>
        <textarea id="discordModerationLogTestText" rows="4" placeholder="Testnachricht eingeben …"></textarea>
        <label>Kanal (optional)<select id="discordModerationLogTestChannel"><option value="">Keiner</option>${chOpts("")}</select></label>
        <button id="discordModerationLogTestBtn" type="button" class="secondary">Filter testen</button>
        <div id="discordModerationLogTestResult"></div>
      </div>
      <div class="card">
        <div class="title compact-title"><div><h3>Letzte Moderationsereignisse</h3><p class="hint">${Number(d.stats?.total||0)} protokolliert · 7 Tage: ${Number(d.stats?.days7||0)} · 30 Tage: ${Number(d.stats?.days30||0)}</p></div></div>
        <div id="discordModerationLogRows">Lade …</div>
      </div>`;
    const loadLogs=async()=>{
      const lr=await fetch("/api/discord/moderation/logs?limit=50",{cache:"no-store"}),ld=await lr.json().catch(()=>({}));
      const target=$("discordModerationLogRows");if(!target)return;
      target.innerHTML=!lr.ok?`<div class="error">${esc(ld.error||"Logs konnten nicht geladen werden.")}</div>`:(ld.items||[]).length?(ld.items||[]).map(x=>`<div class="moderation-log-row"><time>${esc(discordFormatTime(x.ts))}</time><strong>${esc(x.username||x.userId||"User")}</strong><span>${esc(x.eventType==="timeout"?`${x.timeoutStage||""}. Timeout`:x.eventType==="untimeout"?"Timeout aufgehoben":x.eventType==="ban"?"Ban":x.ruleName||"Moderation")}</span><span>${esc((x.actions||[]).join(", "))}</span></div>`).join(""):`<span class="hint">Noch keine Moderationsereignisse.</span>`;
    };
    $("discordModerationLogRefresh")?.addEventListener("click",async()=>{await renderDiscordModerationLog();});
    $("discordModerationLogTestBtn")?.addEventListener("click",async()=>{
      const tr=await fetch("/api/discord/moderation/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content:$("discordModerationLogTestText")?.value||"",channelId:$("discordModerationLogTestChannel")?.value||"",roleIds:[]})}),td=await tr.json().catch(()=>({})),out=$("discordModerationLogTestResult");
      if(!out)return;
      if(!tr.ok){out.innerHTML=`<div class="error">${esc(td.error||"Test fehlgeschlagen.")}</div>`;return;}
      if(!(td.matches||[]).length){out.innerHTML=`<div class="card">Kein Treffer.</div>`;return;}
      out.innerHTML=`<div class="card success"><strong>${td.matches.length} Prüfergebnis(se)</strong>${td.matches.map(x=>x.ruleId==="link-whitelist"?`<div><strong>Link-Whitelist</strong>${(x.linkCheck?.allowed||[]).length?`<div class="hint">Erlaubt: ${esc(x.linkCheck.allowed.join(", "))}</div>`:""}${(x.linkCheck?.blocked||[]).length?`<div class="error">Blockiert: ${esc(x.linkCheck.blocked.join(", "))}</div>`:`<div class="hint">Alle Links erlaubt.</div>`}</div>`:`<div>${esc(x.ruleName)} → ${esc(x.matchedTerm)}</div>`).join("")}</div>`;
    });
    await loadLogs();
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
async function renderDiscordModeration(){
  const root=$("discordModeration");if(!root)return;
  root.innerHTML=`<div class="card">Discord-Moderation wird geladen …</div>`;
  try{
    const r=await fetch("/api/discord/moderation",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Moderation konnte nicht geladen werden.");
    const c=d.config||{},channels=d.catalog?.channels||[],roles=d.catalog?.roles||[],canEdit=hasCapability("discord.moderation.edit");
    const chOpts=selected=>channels.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(selected)?"selected":""}>#${esc(x.name)}</option>`).join("");
    const multi=(items,selected=[])=>{const set=new Set((selected||[]).map(String));return(items||[]).map(x=>`<option value="${esc(x.id)}" ${set.has(String(x.id))?"selected":""}>${esc(x.name)}</option>`).join("");};

    root.innerHTML=`
      <div class="title"><div><h2>Discord · Moderation</h2><p class="hint">Links, Regeln, Spam-Schutz und das Sanktionsmodell sind hier konfigurierbar. Protokoll und operative Sanktionen haben eigene Sicherheitsansichten.</p></div><button id="discordModerationRefresh" type="button" class="secondary">Neu laden</button></div>
      <nav class="moderation-subnav" aria-label="Moderationsbereiche">
        <button class="moderation-subtab active" data-mod-view="overview">Übersicht</button>
        <button class="moderation-subtab" data-mod-view="rules">Regeln</button>
        <button class="moderation-subtab" data-mod-view="links">Link-Whitelist</button>
        <button class="moderation-subtab" data-mod-view="spam">Spam-Schutz</button>
        <button class="moderation-subtab" data-mod-view="sanctions">Sanktionen</button>
      </nav>

      <div data-mod-panel="overview">
        <div class="card">
          <div class="moderation-health">
            <span class="diag-badge ${d.checks?.manageMessages?"ok":"bad"}">Nachrichten verwalten ${d.checks?.manageMessages?"✓":"✕"}</span>
            <span class="diag-badge ${d.checks?.moderateMembers?"ok":"warn"}">Timeout ${d.checks?.moderateMembers?"✓":"✕"}</span>
            <span class="diag-badge ${d.checks?.banMembers?"ok":"bad"}">Bannen ${d.checks?.banMembers?"✓":"✕"}</span>
            <span class="diag-badge ok">Message Content ✓</span>
          </div>
          <p class="hint">${esc(rl("administrator"))} und ${esc(rl("moderator"))} sind von der Link-Whitelist ausgenommen. Wort-/Phrasenregeln gelten weiterhin, sofern die Rolle dort nicht explizit ausgenommen wird.</p>
        </div>
        <div class="card moderation-global-card">
          <h3>Globale Maßnahmen</h3>
          <p class="hint">Diese Einstellungen gelten für unerlaubte Links sowie Wort- und Phrasentreffer.</p>
          <div class="moderation-global-actions">
            <label class="toggle-row"><input id="discordGlobalDelete" type="checkbox" ${c.enforcement?.deleteMessage!==false?"checked":""} ${canEdit?"":"disabled"}><span>Nachricht löschen</span></label>
            <label class="toggle-row"><input id="discordGlobalWarn" type="checkbox" ${c.enforcement?.warnUser!==false?"checked":""} ${canEdit?"":"disabled"}><span>Hinweis senden</span></label>
            <label>Verstöße bis Timeout<input id="discordGlobalThreshold" type="number" min="1" max="20" value="${Number(c.enforcement?.repeatThreshold??3)}" ${canEdit?"":"disabled"}></label>
            <label>Fenster (Min.)<input id="discordGlobalWindow" type="number" min="1" max="1440" value="${Number(c.enforcement?.repeatWindowMinutes??60)}" ${canEdit?"":"disabled"}></label>
            <label>Timeout (Min.)<input id="discordGlobalTimeout" type="number" min="1" max="40320" value="${Number(c.enforcement?.timeoutMinutes??10)}" ${canEdit?"":"disabled"}></label>
          </div>
          <p class="hint">Beispiel 3 / 60 / 10: Nach drei Verstößen innerhalb von 60 Minuten wird ein 10-Minuten-Timeout ausgesprochen. Danach beginnt der Verstoßzähler für die nächste Eskalationsstufe wieder bei 0.</p>
        </div>
        <div class="card">
          <h3>Grundeinstellungen</h3>
          <label class="toggle-row"><input id="discordModerationEnabled" type="checkbox" ${c.enabled?"checked":""} ${canEdit?"":"disabled"}><span>Control-Center-Moderation aktivieren</span></label>
          <input id="discordModerationLogEnabled" type="checkbox" class="hidden" ${c.logEnabled!==false?"checked":""}>
          <input id="discordModerationLogChannel" type="hidden" value="${esc(c.logChannelId||"")}">
          <input id="discordLogViolations" type="checkbox" class="hidden" ${c.moderationLog?.violations!==false?"checked":""}>
          <input id="discordLogTimeouts" type="checkbox" class="hidden" ${c.moderationLog?.timeouts!==false?"checked":""}>
          <input id="discordLogBans" type="checkbox" class="hidden" ${c.moderationLog?.bans!==false?"checked":""}>
          ${isGlobalAdmin()?'<div class="central-log-link"><strong>Moderations-Logs zentralisiert</strong><p class="hint">Verstöße, Timeouts, Bans, Ban aufgehoben und Discord AutoMod werden unter Administration → Logs & Benachrichtigungen gesteuert.</p><button type="button" class="secondary" data-open-log-category="moderation">Log-Einstellungen öffnen</button></div>':""}
        </div>
        ${canEdit?'<div class="actions"><button id="discordModerationSaveOverview" type="button">Einstellungen speichern</button></div>':""}
      </div>

      <div data-mod-panel="rules" class="hidden">
        <div class="card">
          <h3>Hinweis bei Wort-/Phrasentreffer</h3>
          <textarea id="discordModerationWarning" rows="3" ${canEdit?"":"disabled"}>${esc(c.warningText||"")}</textarea>
          <p class="hint">Dieser Hinweis wird bei einem gelöschten Inhalt gesendet. Die Timeout-Stufe wird erst genannt, wenn tatsächlich ein Timeout ausgesprochen wird.</p>
        </div>
        <div class="title compact-title"><div><h3>Wort- & Phrasenregeln</h3></div>${canEdit?'<button id="discordModerationAddRule" type="button">+ Regel</button>':""}</div>
        <div id="discordModerationRules">${(c.rules||[]).length?(c.rules||[]).map((rule,i)=>`
          <details class="card moderation-rule-card" data-rule-index="${i}">
            <summary><strong>${esc(rule.name||"Regel")}</strong><span class="hint">${rule.enabled?"aktiv":"inaktiv"} · ${rule.matchMode==="fullword"?"ganzes Wort/Phrase":"Teiltreffer"}</span><span class="access-user-chevron">⌄</span></summary>
            <div class="moderation-rule-body">
              <div class="grid two">
                <label>Name<input data-k="name" value="${esc(rule.name||"")}" ${canEdit?"":"disabled"}></label>
                <label>Trefferart<select data-k="matchMode" ${canEdit?"":"disabled"}><option value="substring" ${rule.matchMode==="substring"?"selected":""}>Teiltreffer</option><option value="fullword" ${rule.matchMode==="fullword"?"selected":""}>Ganzes Wort / Phrase</option></select></label>
              </div>
              <label class="toggle-row"><input data-k="enabled" type="checkbox" ${rule.enabled?"checked":""} ${canEdit?"":"disabled"}><span>Regel aktiv</span></label>
              <div class="grid two">
                <label>Gesperrte Wörter / Phrasen<textarea data-k="terms" rows="7" ${canEdit?"":"disabled"}>${esc((rule.terms||[]).join("\n"))}</textarea></label>
                <label>Erlaubte Wörter / Phrasen<textarea data-k="allowedTerms" rows="7" ${canEdit?"":"disabled"}>${esc((rule.allowedTerms||[]).join("\n"))}</textarea></label>
              </div>
              <div class="grid two">
                <label>Ausgenommene Rollen<select data-k="exemptRoleIds" multiple size="5" ${canEdit?"":"disabled"}>${multi(roles,rule.exemptRoleIds)}</select></label>
                <label>Ausgenommene Kanäle<select data-k="exemptChannelIds" multiple size="5" ${canEdit?"":"disabled"}>${multi(channels,rule.exemptChannelIds)}</select></label>
              </div>
              <div class="moderation-rule-footer"><span class="hint">Löschen, Hinweis und Sanktionen gelten global.</span>${canEdit?'<button class="secondary danger-outline rule-delete" type="button">Regel löschen</button>':""}</div>
            </div>
          </details>`).join(""):`<div class="card">Noch keine Wort-/Phrasenregeln angelegt.</div>`}</div>
        ${canEdit?'<div class="actions"><button id="discordModerationSaveRules" type="button">Regeln speichern</button></div>':""}
      </div>

      <div data-mod-panel="links" class="hidden">
        <div class="card link-policy-card">
          <h3>Link-Whitelist</h3>
          <p class="hint">Links sind grundsätzlich verboten, sofern sie nicht hier freigegeben wurden. ${esc(rl("administrator"))} und ${esc(rl("moderator"))} sind automatisch ausgenommen.</p>
          <label class="toggle-row"><input id="discordLinkPolicyEnabled" type="checkbox" ${c.linkPolicy?.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Nicht freigegebene Links blockieren</span></label>
          <div class="grid two">
            <label>Erlaubte Domains<textarea id="discordAllowedDomains" rows="8" ${canEdit?"":"disabled"} placeholder="${esc(bt('linkDomains',[]).join('\n')||'beispiel.de')}">${esc((c.linkPolicy?.allowedDomains||[]).join("\n"))}</textarea><span class="hint">Domainfreigabe = alle Pfade und Unterdomains.</span></label>
            <label>Erlaubte spezifische Links<textarea id="discordAllowedLinks" rows="8" ${canEdit?"":"disabled"} placeholder="${esc(bt('linkLinks',[]).join('\n')||'twitch.tv/dein-kanal')}">${esc((c.linkPolicy?.allowedLinks||[]).join("\n"))}</textarea><span class="hint">Nur dieser Host + Pfad. Query-Parameter und Anker werden ignoriert.</span></label>
          </div>
          <label>Hinweis bei unerlaubtem Link<textarea id="discordLinkWarning" rows="3" ${canEdit?"":"disabled"}>${esc(c.linkPolicy?.warningText||"")}</textarea></label>
        </div>
        ${canEdit?'<div class="actions"><button id="discordModerationSaveLinks" type="button">Link-Whitelist speichern</button></div>':""}
      </div>

      <div data-mod-panel="spam" class="hidden">
        <div class="card">
          <div class="title compact-title"><div><h3>Spam-Schutz</h3><p class="hint">Erkennt Nachrichtenfluten, identische Wiederholungen und Mention-Spam. Bots und Webhooks werden immer ignoriert.</p></div>${c.spamProtect?.enabled?'<span class="diag-badge ok">AKTIV</span>':'<span class="diag-badge neutral">AUS</span>'}</div>
          <label class="toggle-row"><input id="discordSpamEnabled" type="checkbox" ${c.spamProtect?.enabled?"checked":""} ${canEdit?"":"disabled"}><span>Spam-Schutz aktivieren</span></label>
          <label class="toggle-row"><input id="discordSpamExemptStaff" type="checkbox" ${c.spamProtect?.exemptStaff!==false?"checked":""} ${canEdit?"":"disabled"}><span>${esc(rl("administrator"))} und ${esc(rl("moderator"))} automatisch ausnehmen</span></label>
          <div class="grid two">
            <label>Weitere ausgenommene Rollen<select id="discordSpamExemptRoles" multiple size="5" ${canEdit?"":"disabled"}>${multi(roles,c.spamProtect?.exemptRoleIds||[])}</select></label>
            <label>Ausgenommene Kanäle<select id="discordSpamExemptChannels" multiple size="5" ${canEdit?"":"disabled"}>${multi(channels,c.spamProtect?.exemptChannelIds||[])}</select></label>
          </div>
        </div>
        <div class="card">
          <h3>Erkennung</h3>
          <div class="grid two">
            <div>
              <label class="toggle-row"><input id="discordSpamFloodEnabled" type="checkbox" ${c.spamProtect?.flood?.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Nachrichtenflut erkennen</span></label>
              <label>Auslösung ab Nachrichten<input id="discordSpamFloodThreshold" type="number" min="3" max="30" value="${Number(c.spamProtect?.flood?.threshold??6)}" ${canEdit?"":"disabled"}></label>
              <label>Zeitfenster (Sek.)<input id="discordSpamFloodWindow" type="number" min="2" max="120" value="${Number(c.spamProtect?.flood?.windowSeconds??8)}" ${canEdit?"":"disabled"}></label>
            </div>
            <div>
              <label class="toggle-row"><input id="discordSpamDuplicateEnabled" type="checkbox" ${c.spamProtect?.duplicate?.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Identische Wiederholungen erkennen</span></label>
              <label>Auslösung ab gleichen Nachrichten<input id="discordSpamDuplicateThreshold" type="number" min="2" max="20" value="${Number(c.spamProtect?.duplicate?.threshold??3)}" ${canEdit?"":"disabled"}></label>
              <label>Zeitfenster (Sek.)<input id="discordSpamDuplicateWindow" type="number" min="3" max="300" value="${Number(c.spamProtect?.duplicate?.windowSeconds??15)}" ${canEdit?"":"disabled"}></label>
            </div>
          </div>
          <div class="grid two">
            <label class="toggle-row"><input id="discordSpamMentionsEnabled" type="checkbox" ${c.spamProtect?.mentions?.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Mention-Spam erkennen</span></label>
            <label>Auslösung ab Erwähnungen pro Nachricht<input id="discordSpamMentionsThreshold" type="number" min="2" max="30" value="${Number(c.spamProtect?.mentions?.threshold??5)}" ${canEdit?"":"disabled"}></label>
          </div>
          <p class="hint">Wiederholungs-Spam vergleicht normalisierten Text exakt. Ähnliche, aber unterschiedliche Nachrichten werden bewusst nicht automatisch sanktioniert, um Fehlalarme zu vermeiden.</p>
        </div>
        <div class="card">
          <h3>Maßnahmen & Eskalation</h3>
          <div class="grid two">
            <label class="toggle-row"><input id="discordSpamDelete" type="checkbox" ${c.spamProtect?.action?.deleteMessage!==false?"checked":""} ${canEdit?"":"disabled"}><span>Auslösende Nachricht löschen</span></label>
            <label class="toggle-row"><input id="discordSpamWarn" type="checkbox" ${c.spamProtect?.action?.warnUser!==false?"checked":""} ${canEdit?"":"disabled"}><span>Hinweis im Kanal senden</span></label>
          </div>
          <label>Hinweistext<textarea id="discordSpamWarning" rows="3" ${canEdit?"":"disabled"}>${esc(c.spamProtect?.action?.warningText||"")}</textarea><span class="hint">Variablen: {mention}, {user}, {reason}, {detail}, {count}, {timeout}</span></label>
          <div class="grid two">
            <label>Wiederholungsfenster (Min.)<input id="discordSpamRepeatWindow" type="number" min="1" max="10080" value="${Number(c.spamProtect?.action?.repeatWindowMinutes??1440)}" ${canEdit?"":"disabled"}></label>
            <label>Aktions-Cooldown (Sek.)<input id="discordSpamCooldown" type="number" min="2" max="300" value="${Number(c.spamProtect?.action?.cooldownSeconds??10)}" ${canEdit?"":"disabled"}></label>
          </div>
          <div class="grid three">
            <label>1. Spam-Verstoß · Timeout (Min.)<input id="discordSpamTimeout1" type="number" min="0" max="40320" value="${Number(c.spamProtect?.action?.timeoutMinutes?.[0]??1)}" ${canEdit?"":"disabled"}></label>
            <label>2. Spam-Verstoß · Timeout (Min.)<input id="discordSpamTimeout2" type="number" min="0" max="40320" value="${Number(c.spamProtect?.action?.timeoutMinutes?.[1]??5)}" ${canEdit?"":"disabled"}></label>
            <label>ab 3. Spam-Verstoß · Timeout (Min.)<input id="discordSpamTimeout3" type="number" min="0" max="40320" value="${Number(c.spamProtect?.action?.timeoutMinutes?.[2]??15)}" ${canEdit?"":"disabled"}></label>
          </div>
          <p class="hint">Spam-Verstöße eskalieren getrennt von der allgemeinen Wort-/Link-Moderation. Es erfolgt kein automatischer Ban durch den Spam-Schutz. Nach Ablauf des Wiederholungsfensters beginnt die Spam-Eskalation wieder bei Stufe 1.</p>
        </div>
        ${canEdit?'<div class="actions"><button id="discordModerationSaveSpam" type="button">Spam-Schutz speichern</button></div>':""}
      </div>

      <div data-mod-panel="sanctions" class="hidden">
        <div class="card moderation-escalation-card">
          <h3>Timeout-Stufen & Ban</h3>
          <p class="hint">1. Timeout → 2. Timeout → 3. Timeout mit Ban-Hinweis → bei der nächsten erreichten Timeout-Schwelle Ban.</p>
          <label class="toggle-row"><input id="discordEscalationEnabled" type="checkbox" ${c.escalation?.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Stufenmodell aktivieren</span></label>
          <label>1. Timeout<textarea id="discordEscalation1" rows="3" ${canEdit?"":"disabled"}>${esc(c.escalation?.timeout1||"")}</textarea></label>
          <label>2. Timeout<textarea id="discordEscalation2" rows="3" ${canEdit?"":"disabled"}>${esc(c.escalation?.timeout2||"")}</textarea></label>
          <label>3. Timeout + Ban-Hinweis<textarea id="discordEscalation3" rows="3" ${canEdit?"":"disabled"}>${esc(c.escalation?.timeout3||"")}</textarea></label>
          <label>Ban-Grund<textarea id="discordEscalationBanReason" rows="2" ${canEdit?"":"disabled"}>${esc(c.escalation?.banReason||"")}</textarea></label>
        </div>
        ${canEdit?'<div class="actions"><button id="discordModerationSaveSanctions" type="button">Sanktionsmodell speichern</button></div>':""}
        <div class="card">
          <p class="hint">Die aktuelle Übersicht über Timeouts, Bans und Eskalationsstände befindet sich jetzt eigenständig unter <strong>Sicherheit → Sanktionsübersicht</strong>.</p>
          <button type="button" class="secondary" data-open-sanctions>Zur Sanktionsübersicht</button>
        </div>
      </div>

      `;

    const getRules=()=>[...root.querySelectorAll(".moderation-rule-card")].map((card,i)=>{
      const q=k=>card.querySelector(`[data-k="${k}"]`);
      return {
        id:String((c.rules||[])[Number(card.dataset.ruleIndex)]?.id||`mod_${Date.now()}_${i}`),
        name:q("name")?.value||"Regel",enabled:!!q("enabled")?.checked,matchMode:q("matchMode")?.value||"substring",
        terms:(q("terms")?.value||"").split(/\n/).map(x=>x.trim()).filter(Boolean),
        allowedTerms:(q("allowedTerms")?.value||"").split(/\n/).map(x=>x.trim()).filter(Boolean),
        exemptRoleIds:[...(q("exemptRoleIds")?.selectedOptions||[])].map(x=>x.value),
        exemptChannelIds:[...(q("exemptChannelIds")?.selectedOptions||[])].map(x=>x.value)
      };
    });
    const fullBody=()=>({
      enabled:!!$("discordModerationEnabled")?.checked,
      logEnabled:!!$("discordModerationLogEnabled")?.checked,
      logChannelId:$("discordModerationLogChannel")?.value||c.logChannelId||"",
      warningText:$("discordModerationWarning")?.value??c.warningText??"",
      enforcement:{
        deleteMessage:!!$("discordGlobalDelete")?.checked,
        warnUser:!!$("discordGlobalWarn")?.checked,
        repeatThreshold:Number($("discordGlobalThreshold")?.value||c.enforcement?.repeatThreshold||3),
        repeatWindowMinutes:Number($("discordGlobalWindow")?.value||c.enforcement?.repeatWindowMinutes||60),
        timeoutMinutes:Number($("discordGlobalTimeout")?.value||c.enforcement?.timeoutMinutes||10)
      },
      escalation:{
        enabled:$("discordEscalationEnabled")?!!$("discordEscalationEnabled").checked:c.escalation?.enabled!==false,
        banAtTimeoutStage:4,
        timeout1:$("discordEscalation1")?.value??c.escalation?.timeout1??"",
        timeout2:$("discordEscalation2")?.value??c.escalation?.timeout2??"",
        timeout3:$("discordEscalation3")?.value??c.escalation?.timeout3??"",
        banReason:$("discordEscalationBanReason")?.value??c.escalation?.banReason??""
      },
      moderationLog:{
        violations:$("discordLogViolations")?!!$("discordLogViolations").checked:c.moderationLog?.violations!==false,
        timeouts:$("discordLogTimeouts")?!!$("discordLogTimeouts").checked:c.moderationLog?.timeouts!==false,
        bans:$("discordLogBans")?!!$("discordLogBans").checked:c.moderationLog?.bans!==false,
        nativeAutoMod:c.moderationLog?.nativeAutoMod!==false
      },
      spamProtect:{
        enabled:$('discordSpamEnabled')?!!$('discordSpamEnabled').checked:c.spamProtect?.enabled===true,
        exemptStaff:$('discordSpamExemptStaff')?!!$('discordSpamExemptStaff').checked:c.spamProtect?.exemptStaff!==false,
        exemptRoleIds:[...($('discordSpamExemptRoles')?.selectedOptions||[])].map(x=>x.value),
        exemptChannelIds:[...($('discordSpamExemptChannels')?.selectedOptions||[])].map(x=>x.value),
        flood:{
          enabled:$('discordSpamFloodEnabled')?!!$('discordSpamFloodEnabled').checked:c.spamProtect?.flood?.enabled!==false,
          threshold:Number($('discordSpamFloodThreshold')?.value||c.spamProtect?.flood?.threshold||6),
          windowSeconds:Number($('discordSpamFloodWindow')?.value||c.spamProtect?.flood?.windowSeconds||8)
        },
        duplicate:{
          enabled:$('discordSpamDuplicateEnabled')?!!$('discordSpamDuplicateEnabled').checked:c.spamProtect?.duplicate?.enabled!==false,
          threshold:Number($('discordSpamDuplicateThreshold')?.value||c.spamProtect?.duplicate?.threshold||3),
          windowSeconds:Number($('discordSpamDuplicateWindow')?.value||c.spamProtect?.duplicate?.windowSeconds||15),
          minLength:Number(c.spamProtect?.duplicate?.minLength||3)
        },
        mentions:{
          enabled:$('discordSpamMentionsEnabled')?!!$('discordSpamMentionsEnabled').checked:c.spamProtect?.mentions?.enabled!==false,
          threshold:Number($('discordSpamMentionsThreshold')?.value||c.spamProtect?.mentions?.threshold||5)
        },
        action:{
          deleteMessage:$('discordSpamDelete')?!!$('discordSpamDelete').checked:c.spamProtect?.action?.deleteMessage!==false,
          warnUser:$('discordSpamWarn')?!!$('discordSpamWarn').checked:c.spamProtect?.action?.warnUser!==false,
          warningText:$('discordSpamWarning')?.value??c.spamProtect?.action?.warningText??'',
          repeatWindowMinutes:Number($('discordSpamRepeatWindow')?.value||c.spamProtect?.action?.repeatWindowMinutes||1440),
          timeoutMinutes:[Number($('discordSpamTimeout1')?.value??1),Number($('discordSpamTimeout2')?.value??5),Number($('discordSpamTimeout3')?.value??15)],
          cooldownSeconds:Number($('discordSpamCooldown')?.value||c.spamProtect?.action?.cooldownSeconds||10)
        }
      },
      linkPolicy:{
        enabled:$("discordLinkPolicyEnabled")?!!$("discordLinkPolicyEnabled").checked:c.linkPolicy?.enabled!==false,
        warningText:$("discordLinkWarning")?.value??c.linkPolicy?.warningText??"",
        allowedDomains:($("discordAllowedDomains")?.value??(c.linkPolicy?.allowedDomains||[]).join("\n")).split(/\n/).map(x=>x.trim()).filter(Boolean),
        allowedLinks:($("discordAllowedLinks")?.value??(c.linkPolicy?.allowedLinks||[]).join("\n")).split(/\n/).map(x=>x.trim()).filter(Boolean)
      },
      rules:getRules().length?getRules():(c.rules||[])
    });
    const save=async()=>{const rr=await fetch("/api/discord/moderation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(fullBody())}),j=await rr.json().catch(()=>({}));if(!rr.ok)return showToast(j.error||"Moderation konnte nicht gespeichert werden.","error");showToast("Discord-Moderation gespeichert.","success");await renderDiscordModeration();};

    root.querySelectorAll("[data-mod-view]").forEach(btn=>btn.onclick=()=>{
      const view=btn.dataset.modView;
      root.querySelectorAll("[data-mod-view]").forEach(x=>x.classList.toggle("active",x===btn));
      root.querySelectorAll("[data-mod-panel]").forEach(x=>x.classList.toggle("hidden",x.dataset.modPanel!==view));
      localStorage.setItem("bwk-discord-moderation-view",view);
    });
    const savedView=localStorage.getItem("bwk-discord-moderation-view");
    if(savedView&&root.querySelector(`[data-mod-view="${savedView}"]`))root.querySelector(`[data-mod-view="${savedView}"]`).click();

    $("discordModerationRefresh")?.addEventListener("click",renderDiscordModeration);
    root.querySelector("[data-open-sanctions]")?.addEventListener("click",()=>openNavTab("discordSanctions",{persist:true}));
    ["discordModerationSaveOverview","discordModerationSaveRules","discordModerationSaveLinks","discordModerationSaveSpam","discordModerationSaveSanctions"].forEach(id=>$(id)?.addEventListener("click",save));
    $("discordModerationAddRule")?.addEventListener("click",async()=>{c.rules||=[];c.rules.push({id:`mod_${Date.now()}`,name:"Neue Regel",enabled:true,matchMode:"substring",terms:[],allowedTerms:[],exemptRoleIds:[],exemptChannelIds:[]});await save();});
    root.querySelectorAll(".rule-delete").forEach(btn=>btn.onclick=async()=>{if(!(await askDelete("Diese Regel wirklich löschen?")))return;const card=btn.closest(".moderation-rule-card"),idx=Number(card.dataset.ruleIndex);c.rules.splice(idx,1);await save();});

  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
async function renderDiscordMembers(query=discordMemberState.query||""){
  const root=$("discordMembers"); if(!root)return;
  root.innerHTML=`<div class="card">Discord-Mitglieder werden geladen …</div>`;
  try{
    const state=await loadDiscordMembers(query); const manageableRoles=(state.roles||[]).filter(r=>r.manageable);
    // XP separat laden: Fehler im Minigame dürfen die Mitgliederverwaltung nicht blockieren.
    let levelPlayers=new Map(),levelAvailable=false,levelEnabled=false;discordMemberLevels=new Map();
    try{const lr=await fetch('/api/discord/members/levels',{cache:'no-store'});
      if(lr.ok){const ld=await lr.json();levelAvailable=true;levelEnabled=ld.enabled===true;levelPlayers=new Map((ld.players||[]).map(p=>[String(p.id),p]));discordMemberLevels=levelPlayers;}
    }catch(_error){}
    const branchName={heer:'Heer',luftwaffe:'Luftwaffe',marine:'Marine'};

    root.innerHTML=`<div class="title"><div><h2>Discord · Mitglieder</h2><p class="hint">Mitglieder suchen und freigegebene Discord-Rollen kontrolliert verwalten. Aktuell sind nur ${esc(rl("administrator"))} und ${esc(rl("member"))} schreibbar.</p></div></div>
      <div class="card"><div class="discord-member-search"><input id="discordMemberQuery" value="${esc(state.query||"")}" placeholder="Discord-ID, Benutzername oder Anzeigename"><button id="discordMemberSearch" type="button">Suchen</button><button id="discordMemberClear" type="button" class="secondary">Zurücksetzen</button></div><p class="hint">Ohne Suchbegriff werden bis zu 50 Mitglieder angezeigt. Änderungen werden live bei Discord verifiziert und protokolliert.</p></div>
      <div class="discord-member-list">${state.members.length?state.members.map(member=>{const roleIds=new Set((member.roles||[]).map(r=>r.id)); const avatar=discordAvatarUrl(member); return `<div class="card discord-member-card"><div class="discord-member-head">${avatar?`<img class="discord-member-avatar" src="${avatar}" alt="">`:`<div class="discord-member-avatar placeholder">👤</div>`}<div class="discord-member-identity"><strong>${esc(member.displayName||member.username||member.id)}</strong><span>@${esc(member.username||"–")}</span><code>${esc(member.id)}</code></div><div class="discord-member-statuses">${member.pending?'<span class="diag-badge warn">ausstehend</span>':'<span class="diag-badge ok">Mitglied</span>'}<span class="diag-badge ${member.backendAccess?'ok':'bad'}" title="${member.backendAccess?`Control-Center-Rolle: ${esc(member.backendRole||'editor')}`:'Kein Zugriff auf das Control Center'}">${'Control-Center'}</span></div></div>${member.onboarding?.gated?`<div class="discord-onboarding-status ${member.onboarding?.verified?"verified":"waiting"}">${member.onboarding?.verified?`<strong>✅ Regeln bestätigt</strong><span>${member.onboarding.verifiedAt?esc(discordFormatTime(member.onboarding.verifiedAt)):"bestätigt"} · ${esc(rl("member"))} ${(discordMemberRoleId&&roleIds.has(discordMemberRoleId))?"✓":"wird geprüft"}</span>`:`<strong>⏳ Regelbestätigung ausstehend</strong><span>Freischaltung erst nach 👍 auf die Regelnachricht.</span>`}</div>`:""}<div class="discord-member-existing-roles">${(member.roles||[]).length?(member.roles||[]).map(discordMemberRoleBadge).join(""):'<span class="hint">Keine zusätzlichen Rollen.</span>'}</div>${levelAvailable?(()=>{const lp=levelPlayers.get(String(member.id));return `<div class="discord-member-level"><div class="discord-member-level-top"><span>🎖️ Minigame</span><strong>${lp?`${Number(lp.xp).toLocaleString('de-DE')} XP`:'Noch keine XP'}</strong></div><small>${lp?`${esc(lp.rank)}${lv('branches')?` · ${esc(branchName[lp.branch]||'Heer')}`:''}`:'Noch nicht am Spiel teilgenommen'}${!levelEnabled?' · Spiel noch nicht aktiviert':''}</small></div>`;})():''}<div class="discord-member-actions">${isGlobalOwner()?manageableRoles.map(role=>{const has=roleIds.has(role.id); return `<button type="button" class="${has?'secondary danger-outline':'secondary'}" data-discord-member-role="1" data-member-id="${esc(member.id)}" data-role-id="${esc(role.id)}" data-action="${has?'remove':'add'}">${has?'−':'+'} ${esc(role.name)}</button>`;}).join(""):""}${isGlobalOwner()?`<button type="button" class="${member.backendAccess?'secondary danger-outline':'secondary'}" data-discord-backend="1" data-member-id="${esc(member.id)}" data-enabled="${member.backendAccess?'0':'1'}">${member.backendAccess?'Control Center entziehen':'Control Center erlauben'}</button>`:""}<button type="button" class="secondary" data-discord-profile="${esc(member.id)}">Profil öffnen</button></div></div>`;}).join(""):`<div class="card"><span class="hint">Keine passenden Mitglieder gefunden.</span></div>`}</div><div id="discordMemberProfile" class="discord-profile-modal-host"></div>`;
    $("discordMemberSearch")?.addEventListener("click",()=>renderDiscordMembers($("discordMemberQuery")?.value||""));
    $("discordMemberClear")?.addEventListener("click",()=>renderDiscordMembers(""));
    $("discordMemberQuery")?.addEventListener("keydown",e=>{if(e.key==="Enter")renderDiscordMembers(e.currentTarget.value||"");});
    root.querySelectorAll("[data-discord-member-role]").forEach(btn=>btn.addEventListener("click",()=>changeDiscordMemberRole(btn)));
    root.querySelectorAll("[data-discord-backend]").forEach(btn=>btn.addEventListener("click",()=>changeDiscordBackendAccess(btn)));
    root.querySelectorAll("[data-discord-profile]").forEach(btn=>btn.addEventListener("click",()=>showDiscordMemberProfile(btn.dataset.discordProfile)));
    if(discordSelectedMemberId)showDiscordMemberProfile(discordSelectedMemberId,discordMemberProfileTab);
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&discordSelectedMemberId&&!document.getElementById('confirmModal')?.classList.contains('hidden')){
    finishDeleteConfirm(false);event.preventDefault();return;
  }
  if(event.key==='Escape'&&discordSelectedMemberId){
    const host=document.getElementById('discordMemberProfile');
    if(host?.querySelector('.discord-profile')){discordSelectedMemberId=null;host.innerHTML='';event.preventDefault();}
  }
});
// Gemeinsame Mitgliederprofil-Oberfläche: alle Änderungen verwenden vorhandene Endpunkte.
// Berechtigungen werden zusätzlich bei jedem API-Aufruf serverseitig geprüft.
// Gemeinsame serverseitig autorisierte Moderationsaktion für unterschiedliche Einstiegswege.
async function runDiscordMemberModerationAction(action,userId,options={}){
  if(!hasCapability("discord.moderation.edit"))throw Error("Keine Berechtigung zur Bearbeitung der Discord-Moderation.");
  if(!/^\d{15,22}$/.test(String(userId||"")))throw Error("Ungültige Discord-ID.");
  const definitions={
    reset:{path:"reset-user",title:"Eskalation zurücksetzen",text:"Aktuelle Eskalationsstufen und Verstoßzähler zurücksetzen? Die Chronik bleibt erhalten.",label:"ZURÜCKSETZEN",success:"Eskalationsstände zurückgesetzt."},
    unban:{path:"unban",title:"Ban aufheben",text:"Ban aufheben? Die historische Chronik bleibt erhalten.",label:"BAN AUFHEBEN",success:"Ban aufgehoben."},
    untimeout:{path:"untimeout",title:"Timeout aufheben",text:"Aktiven Timeout aufheben?",label:"TIMEOUT AUFHEBEN",success:"Timeout aufgehoben."}
  };
  const config=definitions[action];if(!config)throw Error("Unbekannte Moderationsaktion.");
  const confirmed=await askConfirm({title:config.title,text:config.text,confirmLabel:config.label,cancelLabel:"ABBRECHEN",danger:false});
  if(!confirmed)return false;
  const body={userId:String(userId)};
  if(action==="untimeout")body.resetEscalation=options.resetEscalation===true;
  const r=await fetch(`/api/discord/moderation/${config.path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(data.error||data.message||`Moderationsaktion fehlgeschlagen (HTTP ${r.status}).`);
  showToast(config.success,"success");return true;
}

// Gemeinsamer Aktualisierungspfad für alle Einstiege in das Mitgliederprofil.
// Die Mitglieder-API und die Minigame-XP-API bleiben die einzigen Datenquellen.
async function refreshDiscordMemberProfile(memberId,section){
  if(!/^\d{17,22}$/.test(String(memberId||"")))throw Error("Ungültige Discord-ID.");
  const query=discordMemberState.query||String(memberId);
  discordSelectedMemberId=String(memberId);
  discordMemberProfileTab=section;
  await renderDiscordMembers(query);
  if(!discordMemberState.members.some(m=>String(m.id)===String(memberId))){
    // Suche nach ID, wenn das Mitglied auf der aktuellen Ergebnisseite nicht vorhanden ist.
    await renderDiscordMembers(String(memberId));
  }
  if(!discordMemberState.members.some(m=>String(m.id)===String(memberId)))
    throw Error("Mitglied wurde nicht gefunden oder ist nicht mehr verfügbar.");
}

async function showDiscordMemberProfile(memberId,section="overview"){
  const host=$("discordMemberProfile");if(!host)return;
  const member=discordMemberState.members.find(m=>String(m.id)===String(memberId));
  if(!member){discordSelectedMemberId=null;host.innerHTML="";return;}
  discordSelectedMemberId=String(member.id);discordMemberProfileTab=section;
  const canModerate=hasCapability("discord.moderation.view");
  const canXpEdit=hasCapability("discord.moderation.edit");
  const sections=[["overview","Übersicht"],["roles","Rollen"],["minigame","Minigame"],["moderation","Moderation"],["access","Zugriff"]].filter(([id])=>id!=="moderation"||canModerate).filter(([id])=>id!=="access"||isGlobalAdmin());
  if(!sections.some(([id])=>id===section))section="overview";
  discordMemberProfileTab=section;
  const xp=discordMemberLevels.get(String(member.id));
  const roleIds=new Set((member.roles||[]).map(r=>r.id));
  const details=`<dl class="discord-profile-facts"><div><dt>Discord-ID</dt><dd><code>${esc(member.id)}</code></dd></div><div><dt>Benutzername</dt><dd>${esc(member.username||"Nicht verfügbar")}</dd></div><div><dt>Anzeigename</dt><dd>${esc(member.displayName||"Nicht verfügbar")}</dd></div><div><dt>Beitritt</dt><dd>${member.joinedAt?esc(discordFormatTime(member.joinedAt)):"Nicht verfügbar"}</dd></div><div><dt>Regelbestätigung</dt><dd>${member.onboarding?.verified?"Bestätigt":member.onboarding?.gated?"Ausstehend":"Nicht verfügbar"}</dd></div><div><dt>Freischaltung</dt><dd>${(discordMemberRoleId&&roleIds.has(discordMemberRoleId))?`${rl("member")}-Rolle vorhanden`:`Keine ${rl("member")}-Rolle`}</dd></div><div><dt>XP</dt><dd>${xp?Number(xp.xp).toLocaleString("de-DE"):"Nicht erfasst"}</dd></div><div><dt>${esc(lv("rank"))}</dt><dd>${esc(xp?.rank||"Nicht verfügbar")}</dd></div>${lv("branches")?`<div><dt>${esc(lv("branchLabel"))}</dt><dd>${esc(({heer:"Heer",luftwaffe:"Luftwaffe",marine:"Marine"})[xp?.branch]||"Nicht gewählt")}</dd></div>`:""}</dl>`;
  const roles=(member.roles||[]).map(discordMemberRoleBadge).join(" ")||"Keine zusätzlichen Rollen";
  const actions=discordMemberState.roles.filter(r=>r.manageable).map(role=>{const has=roleIds.has(role.id);return `<button class="secondary" data-discord-member-role="1" data-member-id="${esc(member.id)}" data-role-id="${esc(role.id)}" data-action="${has?'remove':'add'}">${has?'−':'+'} ${esc(role.name)}</button>`;}).join(" ");
  let body=section==="overview"?details:section==="roles"?`<p>${roles}</p>${isGlobalOwner()?`<div class="discord-profile-actions">${actions}</div>`:'<p class="hint">Rollenänderungen sind nur mit entsprechenden Verwaltungsrechten möglich.</p>'}`:section==="minigame"?`<p><strong>${xp?`${Number(xp.xp).toLocaleString('de-DE')} XP`:'Noch keine XP'}</strong> · ${esc(xp?.rank||lv('noRank'))}${lv('branches')?` · ${esc(xp?.branch||'Nicht gewählt')}`:''}</p>${canXpEdit?`<div class="discord-profile-xp"><label>Aktion<select id="profileXpMode"><option value="add">XP hinzufügen</option><option value="subtract">XP abziehen</option><option value="set">XP setzen</option></select></label><label>XP-Anzahl<input id="profileXpAmount" type="number" min="0" step="1" value="0"></label><button id="profileXpApply">XP speichern</button></div>`:'<p class="hint">XP-Verwaltung erfordert die Berechtigung Discord-Moderation bearbeiten.</p>'}<div class="discord-profile-history-box"><h4>${esc(lv('missionRecord'))} · Letzte 10 ${esc(lv('missionPlural'))}</h4><div id="discordProfileMissionHistory"><p class="hint">Verlauf wird geladen …</p></div></div><div class="discord-profile-history-box"><h4>Letzte 10 Rangwechsel</h4><div id="discordProfileRankHistory"><p class="hint">Ranghistorie wird geladen …</p></div></div><div class="discord-profile-history-box"><h4>Letzte 10 XP-Buchungen</h4><div id="discordProfileXpHistory"><p class="hint">XP-Verlauf wird geladen …</p></div></div>`:section==="access"?`<p>Control-Center-Zugang: <strong>${member.backendAccess?'Aktiv':'Nicht aktiviert'}</strong>${member.backendRole?' · '+esc(member.backendRole):''}</p><button class="secondary" data-discord-backend="1" data-member-id="${esc(member.id)}" data-enabled="${member.backendAccess?'0':'1'}">${member.backendAccess?'Control Center entziehen':'Control Center erlauben'}</button>`:`<div class="discord-profile-moderation"><div id="discordProfileSanction" class="discord-profile-sanction"><span class="hint">Moderationsstatus wird geprüft …</span></div><div class="discord-profile-history-box"><h4>Moderationsverlauf</h4><div id="discordProfileHistory"><p class="hint">Verlauf wird geladen …</p></div></div>${canXpEdit?`<div class="discord-profile-actions"><button type="button" class="secondary" id="profileResetEscalation">Eskalation zurücksetzen</button></div>`:""}</div>`;
  const profileAvatar=discordAvatarUrl(member);
  const profileHeader=`<div class="discord-profile-person">${profileAvatar?`<img class="discord-profile-avatar" src="${profileAvatar}" alt="">`:'<span class="discord-profile-avatar discord-profile-avatar-fallback" aria-hidden="true">👤</span>'}<div class="discord-profile-person-copy"><span class="discord-profile-eyebrow">DISCORD · MITGLIEDERPROFIL</span><h3>${esc(member.displayName||member.username||member.id)}</h3><div class="discord-profile-meta"><span>@${esc(member.username||'–')}</span><span class="discord-profile-access ${member.backendAccess?'allowed':'denied'}">Control-Center</span></div></div></div>`;
  host.innerHTML=`<div class="discord-profile-backdrop" data-profile-dismiss="1"></div><section class="card discord-profile" role="dialog" aria-modal="true" aria-label="Mitgliederprofil von ${esc(member.displayName||member.username||member.id)}" tabindex="-1"><div class="discord-profile-title">${profileHeader}<div class="discord-profile-toolbar"><button type="button" class="secondary" id="refreshDiscordProfile" title="Mitgliederdaten neu laden">↻ Aktualisieren</button><button type="button" class="secondary" id="closeDiscordProfile" aria-label="Mitgliederprofil schließen">✕ Schließen</button></div></div><nav class="discord-profile-tabs" aria-label="Profilbereiche">${sections.map(([id,name])=>`<button type="button" class="secondary ${section===id?'active':''}" aria-current="${section===id?'page':'false'}" data-profile-section="${id}">${name}</button>`).join('')}</nav><div class="discord-profile-content">${body}</div></section>`;
  const closeProfile=()=>{discordSelectedMemberId=null;host.innerHTML='';};
  host.querySelector('#refreshDiscordProfile').onclick=async(event)=>{
    const button=event.currentTarget;button.disabled=true;
    try{await refreshDiscordMemberProfile(member.id,discordMemberProfileTab);showToast('Mitgliederprofil aktualisiert.','success');}
    catch(error){showToast(`Mitgliederprofil: ${error.message}`,'error');if(button.isConnected)button.disabled=false;}
  };
  host.querySelector('#closeDiscordProfile').onclick=closeProfile;
  host.querySelector('[data-profile-dismiss]').onclick=closeProfile;
  host.querySelector('.discord-profile')?.focus({preventScroll:true});
  host.querySelectorAll('[data-profile-section]').forEach(b=>b.onclick=()=>showDiscordMemberProfile(member.id,b.dataset.profileSection));
  host.querySelectorAll('[data-discord-member-role]').forEach(b=>b.onclick=()=>changeDiscordMemberRole(b));
  host.querySelectorAll('[data-discord-backend]').forEach(b=>b.onclick=()=>changeDiscordBackendAccess(b));
  const xpHistoryHost=host.querySelector('#discordProfileXpHistory');
  if(xpHistoryHost){
    (async()=>{try{
      const response=await fetch(`/api/discord/levelsystem/xp-history?userId=${encodeURIComponent(member.id)}`);
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(data.error||'XP-Verlauf konnte nicht geladen werden');
      if(!xpHistoryHost.isConnected)return;
      const labels={chat:'Chatnachricht',meme:'Meme/Bild',deleted:'Nachricht gelöscht',manual:'Manuelle XP-Korrektur',daily:`${lv('dailyTitle')} (/dailyxp)`,mission:`${lv('missionSingular')}-Belohnung (/${lv('missionCmd')})`};
      const entries=Array.isArray(data.entries)?data.entries:[];
      xpHistoryHost.innerHTML=entries.length?`<div class="discord-xp-history">${entries.map(e=>`<div class="discord-xp-history-row"><time>${esc(discordFormatTime(new Date(e.at).toISOString()))}</time><span>${esc(labels[e.source]||'XP-Änderung')}${e.source==='manual'&&e.mode?` · ${esc(({add:'Hinzufügen',subtract:'Abziehen',set:'Setzen'})[e.mode]||e.mode)}`:''}</span><strong class="${Number(e.delta)>=0?'xp-positive':'xp-negative'}">${Number(e.delta)>0?'+':''}${Number(e.delta).toLocaleString('de-DE')} XP</strong></div>`).join('')}</div>`:'<p class="hint">Noch keine protokollierten XP-Buchungen.</p>';
    }catch(error){if(xpHistoryHost.isConnected)xpHistoryHost.innerHTML=`<p class="hint">${esc(error.message)}</p>`;}})();
  }
  const missionHistoryHost=host.querySelector('#discordProfileMissionHistory');
  if(missionHistoryHost){(async()=>{try{
    const response=await fetch(`/api/discord/levelsystem/mission-history?userId=${encodeURIComponent(member.id)}`);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||`${lv('missionRecord')} konnte nicht geladen werden`);
    if(!missionHistoryHost.isConnected)return;
    const entries=Array.isArray(data.entries)?data.entries:[];
    const status=data.status||{};
    missionHistoryHost.innerHTML=`<p class="hint">${status.current?`Aktuelle ${esc(lv('missionSingular'))}: <strong>${esc(status.current.name)}</strong> · ${status.ready?'Bereit zur Abholung':'Läuft bis '+esc(discordFormatTime(new Date(status.current.endsAt).toISOString()))}`:`Keine aktive ${lv('missionSingular')}`} · Versuche heute: ${Number(status.used||0)}/${Number(status.limit||0)}</p>`+(entries.length?`<div class="discord-xp-history">${entries.map(e=>`<div class="discord-xp-history-row"><time>${esc(discordFormatTime(new Date(e.claimedAt).toISOString()))}</time><span>${esc(e.name)} · ${e.success?'Erfolgreich':'Fehlgeschlagen'}</span><strong class="xp-positive">+${Number(e.reward||0).toLocaleString('de-DE')} XP</strong></div>`).join('')}</div>`:`<p class="hint">Noch keine abgeschlossenen ${esc(lv('missionPlural'))}.</p>`);
  }catch(error){if(missionHistoryHost.isConnected)missionHistoryHost.textContent=error.message;}})();}
  const rankHistoryHost=host.querySelector('#discordProfileRankHistory');
  if(rankHistoryHost){(async()=>{try{
    const response=await fetch(`/api/discord/levelsystem/rank-history?userId=${encodeURIComponent(member.id)}`);
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'Ranghistorie konnte nicht geladen werden');
    if(!rankHistoryHost.isConnected)return;
    const events=Array.isArray(data.entries)?data.entries:[];
    const sources={chat:'Chatnachricht',meme:'Meme',manual:'Manuelle XP-Änderung',deleted:'Gelöschte Nachricht',daily:`${lv('dailyTitle')} (/dailyxp)`,mission:`${lv('missionSingular')}-Belohnung (/${lv('missionCmd')})`};
    rankHistoryHost.innerHTML=events.length?`<div class="discord-xp-history">${events.map(e=>`<div class="discord-xp-history-row"><time>${esc(discordFormatTime(new Date(e.at).toISOString()))}</time><span>${esc(e.fromRank)} → ${esc(e.toRank)} · ${esc(sources[e.source]||e.source||'XP-Änderung')}</span><strong class="${e.direction==='promotion'?'xp-positive':'xp-negative'}">${e.direction==='promotion'?'Aufstieg':'Abstieg'}</strong></div>`).join('')}</div>`:'<p class="hint">Noch keine erfassten Rangwechsel seit Einführung der Historie.</p>';
  }catch(error){if(rankHistoryHost.isConnected)rankHistoryHost.innerHTML=`<p class="hint">${esc(error.message)}</p>`;}})();}
  const xpButton=host.querySelector('#profileXpApply');
  if(xpButton)xpButton.onclick=async()=>{xpButton.disabled=true;try{
    const mode=host.querySelector('#profileXpMode').value,amount=Number(host.querySelector('#profileXpAmount').value);
    await updateDiscordMemberXp(member.id,mode,host.querySelector('#profileXpAmount').value);
    showToast('XP aktualisiert.','success');await refreshDiscordMemberProfile(member.id,'minigame');
  }catch(e){showToast(e.message,'error');xpButton.disabled=false;}};
  if(section==='moderation'){
    const resetButton=host.querySelector('#profileResetEscalation');
    if(resetButton)resetButton.onclick=async()=>{resetButton.disabled=true;try{
      if(await runDiscordMemberModerationAction('reset',member.id))await showDiscordMemberProfile(member.id,'moderation');
    }catch(e){showToast(e.message,'error');}finally{if(resetButton.isConnected)resetButton.disabled=false;}};
    const target=host.querySelector('#discordProfileHistory');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try{
      const r=await fetch(`/api/discord/moderation/member-history?userId=${encodeURIComponent(member.id)}`,{cache:'no-store',signal:controller.signal});
      const d=await r.json();if(!r.ok)throw Error(d.error||'Moderationsdaten nicht verfügbar');
      // Ergebnisse nach einem Tabwechsel nie in eine andere Mitgliedsansicht schreiben.
      if(discordSelectedMemberId!==String(member.id)||discordMemberProfileTab!=='moderation'||!target?.isConnected)return;
      const status=host.querySelector('#discordProfileSanction');
      if(status){
        const active=!!d.activeTimeoutUntil;
        status.innerHTML=`<div class="discord-profile-sanction-row"><div><strong>${active?'Timeout aktiv':d.timeoutStatusAvailable?'Kein aktiver Timeout':'Timeout-Status nicht verfügbar'}</strong><p class="hint">${active?'Bis '+esc(discordFormatTime(d.activeTimeoutUntil)):d.timeoutStatusAvailable?'Discord-Mitglied aktuell nicht zeitlich gesperrt.':'Discord-Status konnte nicht abgefragt werden.'}</p></div>${active&&canXpEdit?'<button type="button" id="profileLiftTimeout" class="secondary">Timeout aufheben</button>':''}</div><div class="discord-profile-sanction-metrics"><span>Timeouts gesamt: <strong>${Number(d.timeoutCount||0)}</strong></span><span>Eskalationsstufe: <strong>${Number(d.timeoutStage||0)}</strong></span><span>Aktuelle Verstöße: <strong>${Number(d.currentViolations||0)}</strong></span></div>`;
        const lift=status.querySelector('#profileLiftTimeout');
        if(lift)lift.onclick=async()=>{lift.disabled=true;try{if(await runDiscordMemberModerationAction('untimeout',member.id))await showDiscordMemberProfile(member.id,'moderation');}catch(e){showToast(e.message,'error');if(lift.isConnected)lift.disabled=false;}};
      }
      const items=Array.isArray(d.events)?d.events:[];
      target.innerHTML=items.length?`<div class="discord-profile-history">${items.map(e=>`<div class="discord-profile-history-entry"><strong>${esc(moderationEventLabel(e))}</strong><span>${esc(e.ts?discordFormatTime(e.ts):'Datum nicht verfügbar')}${e.ruleName?' · '+esc(e.ruleName):''}</span></div>`).join('')}</div>`:'<p class="hint">Für dieses Mitglied liegen keine Moderationsereignisse in den zuletzt erfassten Protokollen vor.</p>';
    }catch(e){if(target?.isConnected&&discordSelectedMemberId===String(member.id)&&discordMemberProfileTab==='moderation'){target.textContent=e.name==='AbortError'?'Moderationshistorie benötigt zu lange. Bitte später erneut öffnen.':'Moderationshistorie nicht verfügbar: '+e.message;const status=host.querySelector('#discordProfileSanction');if(status)status.textContent='Moderationsstatus nicht verfügbar.';}}
    finally{clearTimeout(timeout);}
  }

}

async function changeDiscordBackendAccess(btn){
  const discordUserId=btn.dataset.memberId;
  const enabled=btn.dataset.enabled==="1";
  btn.disabled=true;
  try{
    const r=await fetch("/api/users/discord/backend",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({discordUserId,enabled,discordRole:"editor"})});
    const d=await r.json(); if(!r.ok) throw new Error(d.error||"Backend-Zugang konnte nicht geändert werden.");
    showToast(enabled?"Discord-Backend-Zugang freigegeben.":"Discord-Backend-Zugang entzogen.","success");
    if(discordSelectedMemberId===String(discordUserId))await refreshDiscordMemberProfile(discordUserId,discordMemberProfileTab);
    else await renderDiscordMembers(discordMemberState.query||"");
  }catch(e){showToast(`Backend-Zugang: ${e.message}`,"error");btn.disabled=false;}
}
async function changeDiscordMemberRole(btn){
  const userId=btn.dataset.memberId, roleId=btn.dataset.roleId, action=btn.dataset.action; btn.disabled=true;
  try{const r=await fetch("/api/discord/members/role",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId,roleId,action})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||"Rollenänderung fehlgeschlagen."); showToast(`${d.role?.name||"Rolle"}: ${action==="add"?"vergeben":"entfernt"}.`,"success"); if(discordSelectedMemberId===String(userId))await refreshDiscordMemberProfile(userId,discordMemberProfileTab);else await renderDiscordMembers(discordMemberState.query||"");}catch(e){showToast(`Discord-Rolle: ${e.message}`,"error"); btn.disabled=false;}
}

async function renderDiscordRoles(){
  const root=$("discordRoles");
  if(!root) return;
  root.innerHTML=`<div class="card">Discord-Rollen werden geladen …</div>`;
  try{
    const data=await loadDiscordStatus(true);
    const roles=Object.entries(data?.checks?.roles||{}).sort((a,b)=>(b[1]?.position||0)-(a[1]?.position||0));
    const hierarchy=data?.checks?.botRoleHierarchy||{};
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Rollen</h2><p class="hint">Die Verwaltung bleibt in diesem ersten Schritt bewusst schreibgeschützt.</p></div></div>
      <div id="discordGuildCard"></div>
      <div class="card">
        <div class="title"><h3>Rollenhierarchie</h3>${discordStatusBadge(!!hierarchy.ok,"OK","PRÜFEN")}</div>
        <p class="hint">Ziel: ${esc(rl("moderator"))} → Bot-Rolle → ${esc(rl("administrator"))} → ${esc(rl("member"))}. Der Bot kann nur Rollen unterhalb seiner eigenen Rolle verwalten.</p>
      </div>
      <div class="card">
        <div class="discord-table">
          <div class="discord-table-head"><span>Zuordnung</span><span>Discord-Rolle</span><span>Position</span><span>Status</span></div>
          ${roles.map(([key,v])=>`<div class="discord-table-row"><span>${esc(key)}</span><strong>${esc(v?.name||"–")}${v?.managed?' <span class="pill">verwaltet</span>':""}</strong><span>${esc(String(v?.position??"–"))}</span><span>${discordStatusBadge(!!v?.ok)}</span></div>`).join("")}
        </div>
      </div>`;
    mountProfileCard($("discordGuildCard"),"discord");
  }catch(e){
    root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;
  }
}

async function renderDatabase(){
  const root=$("database");if(!root)return;
  if(!isGlobalOwner()){
    root.innerHTML=`<div class="card error">Die Datenbankverwaltung ist nur für globale Owner und den lokalen Admin verfügbar.</div>`;
    return;
  }
  root.innerHTML=`
    <div class="title"><div><h2>PostgreSQL</h2><p class="hint">Persistenz, Migration und Rollback-Diagnose. Die Datenbank läuft ausschließlich im internen Docker-Netz und wird nicht nach außen veröffentlicht.</p></div><button id="dbRefreshBtn" type="button">Aktualisieren</button></div>
    <div id="dbStatusBody"><div class="card">Prüfe PostgreSQL …</div></div>`;
  $("dbRefreshBtn")?.addEventListener("click",loadDatabaseStatus);
  await loadDatabaseStatus();
}

function dbStateBadge(ok,labelOk="OK",labelBad="FEHLER"){
  return ok?`<span class="status on">${esc(labelOk)}</span>`:`<span class="status off">${esc(labelBad)}</span>`;
}

async function loadDatabaseStatus(){
  const root=$("dbStatusBody");if(!root)return;
  root.innerHTML=`<div class="card">Prüfe PostgreSQL …</div>`;
  try{
    const r=await fetch("/api/database/status",{cache:"no-store"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);
    const t=d.twitch||{},dc=d.discord||{};
    const docs=t.documents||[];
    root.innerHTML=`
      <div class="grid two">
        <div class="card">
          <div class="title compact-title"><div><h3>Twitch / Control Center</h3><p class="hint">Namespace <code>${esc(t.namespace||"twitch")}</code></p></div>${dbStateBadge(!!t.ok)}</div>
          <div class="diag-kv"><span>Datenbank</span><strong>${esc(t.database||"–")}</strong><span>DB-User</span><strong>${esc(t.user||"–")}</strong><span>Schema</span><strong>${esc(String(t.schemaVersion??"–"))}</strong><span>DB-Größe</span><strong>${esc(t.metrics?.databaseBytes!=null?formatBytes(t.metrics.databaseBytes):"–")}</strong><span>Tabellen / Indizes</span><strong>${esc(`${t.metrics?.tables??"–"} / ${t.metrics?.indexes??"–"}`)}</strong><span>Dokumente</span><strong>${esc(String(t.counts?.state_documents??0))}</strong><span>Watchtime-Zeilen</span><strong>${esc(String(t.counts?.twitch_watchtime??0))}</strong><span>Follower-Cache</span><strong>${esc(String(t.counts?.twitch_followers??0))}</strong><span>Follower-Revision</span><strong>${esc(String(t.counts?.twitch_followers_revision??0))}</strong><span>Bekannte Clips</span><strong>${esc(String(t.counts?.twitch_clips??0))}</strong><span>Geteilte Clips</span><strong>${esc(String(t.counts?.twitch_clips_shared??0))}</strong><span>Clip-Fehlerstatus</span><strong>${esc(String(t.counts?.twitch_clips_failed??0))}</strong><span>Clip-Revision</span><strong>${esc(String(t.counts?.twitch_clips_revision??0))}</strong><span>Nutzungsstatistik-Zeilen</span><strong>${esc(String(t.counts?.usage_stats_rows??0))}</strong><span>Command-Statistiken</span><strong>${esc(String(t.counts?.usage_stats_commands??0))}</strong><span>Auto-Reply-Statistiken</span><strong>${esc(String(t.counts?.usage_stats_autoreplies??0))}</strong><span>Auslösungen gesamt</span><strong>${esc(String(t.counts?.usage_stats_total??0))}</strong><span>Discord-Analytics-Snapshots</span><strong>${esc(String(t.counts?.discord_analytics_snapshots??0))}</strong><span>Wortfilter-Begriffe</span><strong>${esc(String(t.counts?.word_filter_terms??0))}</strong><span>Wortfilter aktiv</span><strong>${esc(String(t.counts?.word_filter_active??0))}</strong><span>Wortfilter-Treffer</span><strong>${esc(String(t.counts?.word_filter_hits??0))}</strong><span>Wortfilter-Revision</span><strong>${esc(String(t.counts?.word_filter_revision??0))}</strong><span>Spind-Konten</span><strong>${esc(String(t.counts?.spind_accounts??0))}</strong><span>Spind-Runden</span><strong>${esc(String(t.counts?.spind_rounds??0))}</strong><span>Spind-Buchungen</span><strong>${esc(String(t.counts?.spind_transactions??0))}</strong><span>Spind-Revision</span><strong>${esc(String(t.counts?.spind_revision??0))}</strong><span>Followathon-Events</span><strong>${esc(String(t.counts?.followathon_events??0))}</strong><span>Followathon-Follows</span><strong>${esc(String(t.counts?.followathon_users??0))}</strong><span>Followathon-Protokolle</span><strong>${esc(String(t.counts?.followathon_logs??0))}</strong><span>Followathon-Revision</span><strong>${esc(String(t.counts?.followathon_revision??0))}</strong><span>Gewinnspiele</span><strong>${esc(String(t.counts?.giveaway_events??0))}</strong><span>Gewinnspiel-Teilnahmen</span><strong>${esc(String(t.counts?.giveaway_entries??0))}</strong><span>Gewinnspiel-Ziehungen</span><strong>${esc(String(t.counts?.giveaway_draws??0))}</strong><span>Gewinnspiel-Revision</span><strong>${esc(String(t.counts?.giveaway_revision??0))}</strong><span>Backend-Benutzer</span><strong>${esc(String(t.counts?.control_users??0))}</strong><span>Berechtigungen</span><strong>${esc(String(t.counts?.control_capabilities??0))}</strong><span>Aktive Sessions</span><strong>${esc(String(t.counts?.control_sessions??0))}</strong><span>Benutzer-Revision</span><strong>${esc(String(t.counts?.control_users_revision??0))}</strong><span>EventSub-Deduplizierung</span><strong>${esc(String(t.counts?.eventsub_messages??0))}</strong><span>Discord-Bridge Warteschlange</span><strong>${esc(String(t.counts?.discord_bridge_queue??0))}</strong><span>Bridge-Versuche</span><strong>${esc(String(t.counts?.discord_bridge_attempts??0))}</strong><span>Bridge-Revision</span><strong>${esc(String(t.counts?.discord_bridge_revision??0))}</strong><span>Legacy-Importe protokolliert</span><strong>${esc(String(t.counts?.import_ledger??0))}</strong></div>
          ${t.lastError?`<div class="error">${esc(t.lastError)}</div>`:""}
        </div>
        <div class="card">
          <div class="title compact-title"><div><h3>Discord</h3><p class="hint">Namespace <code>${esc(dc.namespace||"discord")}</code></p></div>${dbStateBadge(dc.ok!==false&&!!dc.enabled)}</div>
          <div class="diag-kv"><span>Backend</span><strong>${esc(dc.backend||"–")}</strong><span>Schema</span><strong>${esc(String(dc.schemaVersion??"–"))}</strong><span>Dokumente gesamt</span><strong>${esc(String(dc.counts?.state_documents??0))}</strong><span>Protokollereignisse gesamt</span><strong>${esc(String(dc.counts?.operation_events??0))}</strong><span>Moderationsnutzer</span><strong>${esc(String(dc.counts?.discord_moderation_users??0))}</strong><span>Moderations-Ereignisse</span><strong>${esc(String(dc.counts?.discord_moderation_events??0))}</strong><span>Aktive Wiederholungsmarker</span><strong>${esc(String(dc.counts?.discord_moderation_recent??0))}</strong><span>Moderations-Revision</span><strong>${esc(String(dc.counts?.discord_moderation_revision??0))}</strong><span>Onboarding-Mitglieder</span><strong>${esc(String(dc.counts?.discord_onboarding_members??0))}</strong><span>Onboarding verifiziert</span><strong>${esc(String(dc.counts?.discord_onboarding_verified??0))}</strong><span>Onboarding-Revision</span><strong>${esc(String(dc.counts?.discord_onboarding_revision??0))}</strong><span>Meldungen</span><strong>${esc(String(dc.counts?.discord_reports??0))}</strong><span>Offene Meldungen</span><strong>${esc(String(dc.counts?.discord_reports_open??0))}</strong><span>Meldungs-Aktionen</span><strong>${esc(String(dc.counts?.discord_report_actions??0))}</strong><span>Meldungs-Revision</span><strong>${esc(String(dc.counts?.discord_reports_revision??0))}</strong><span>Social bekannte Beiträge</span><strong>${esc(String(dc.counts?.discord_social_seen??0))}</strong><span>Social-Historie</span><strong>${esc(String(dc.counts?.discord_social_history??0))}</strong><span>Social fehlgeschlagen</span><strong>${esc(String(dc.counts?.discord_social_failed??0))}</strong><span>Social-Revision</span><strong>${esc(String(dc.counts?.discord_social_revision??0))}</strong><span>Kanalzeiten aktiv geschlossen</span><strong>${esc(String(dc.counts?.discord_channel_times_active??0))}</strong><span>Kanalzeiten Overrides</span><strong>${esc(String(dc.counts?.discord_channel_times_overrides??0))}</strong><span>Kanalzeiten Ereignisse</span><strong>${esc(String(dc.counts?.discord_channel_times_events??0))}</strong><span>Kanalzeiten-Revision</span><strong>${esc(String(dc.counts?.discord_channel_times_revision??0))}</strong><span>Notfallmodus aktiv</span><strong>${dc.counts?.discord_emergency_active?"Ja":"Nein"}</strong><span>Notfall-Snapshots</span><strong>${esc(String(dc.counts?.discord_emergency_snapshots??0))}</strong><span>Notfall-Historie</span><strong>${esc(String(dc.counts?.discord_emergency_history??0))}</strong><span>Notfall-Revision</span><strong>${esc(String(dc.counts?.discord_emergency_revision??0))}</strong><span>Twitch-Live-Ankündigungen</span><strong>${esc(String(dc.counts?.discord_announcements_live??0))}</strong><span>Clip-Ankündigungen</span><strong>${esc(String(dc.counts?.discord_announcements_clips??0))}</strong><span>Ankündigungs-Revision</span><strong>${esc(String(dc.counts?.discord_announcements_revision??0))}</strong><span>Legacy-Importe protokolliert</span><strong>${esc(String(dc.counts?.import_ledger??0))}</strong></div>
          ${dc.error||dc.lastError?`<div class="error">${esc(dc.error||dc.lastError)}</div>`:""}
        </div>
      </div>
      <div class="card">
        <h3>Persistenzmodell V7.2.20 · Abschlussrunde</h3>
        <p class="hint">Bewegungs-, Historien- und Eindeutigkeitsdaten sind relational gespeichert. Dazu gehören Watchtime, Follower, Clips, Nutzungsstatistiken, Discord-Analytics-Snapshots, EventSub-Deduplizierung, ${esc(pointsName())}, Followathon, Gewinnspiele, Benutzer/Rechte/Sessions sowie die zustandsbehafteten Discord-Bereiche. Flexible Konfigurationen bleiben bewusst als versionierte JSONB-Dokumente. OAuth-/Refresh-Tokens, Passwörter, Anhänge und statische Assets bleiben außerhalb der fachlichen Datenbanktabellen.</p>
        <h4>JSONB / Legacy-Dokumente</h4>
        <div class="diag-table">${docs.map(x=>{const legacy=["users","sessions","giveaways","clip-state","usage-stats","follower-cache","discord-bridge","discord-analytics","followathon","stubenkontrolle"].includes(String(x.key));const config=["settings","event-profiles","public-pages"].includes(String(x.key));const label=legacy?"Legacy / Rollback":config?"JSONB-Konfiguration":"JSONB";return `<div class="diag-row"><div><strong>${esc(x.key)}</strong> <span class="diag-muted">· ${label}</span></div><div>Revision ${esc(String(x.revision||0))}</div><div class="diag-muted">${fmtDiagDate(x.updatedAt)}</div></div>`;}).join("")||'<span class="diag-muted">Keine Dokumente gemeldet.</span>'}</div>
        <p class="hint">Legacy-Dokumente werden nicht mehr als produktive Source of Truth verwendet. Sie bleiben vorerst als Migrations-/Rollback-Sicherheitsnetz erhalten und können in einer späteren, separat freigegebenen Bereinigungsrunde entfernt werden.</p>
        <h4>Importnachweis Twitch</h4>
        <div class="diag-table">${(t.imports||[]).map(x=>`<div class="diag-row"><div><strong>${esc(x.sourceKey||"–")}</strong></div><div>${esc(x.details?.kind||"Import")}</div><div class="diag-muted">${fmtDiagDate(x.importedAt)}</div></div>`).join("")||'<span class="diag-muted">Noch keine Legacy-Importe protokolliert.</span>'}</div>
      </div>
      <div class="card warning-card">
        <h3>Rollback-Export</h3>
        <p>Erzeugt aus dem aktuellen PostgreSQL-Stand wieder klassische JSON-/JSONL-Dateien für Twitch und Discord. Die produktiven Legacy-Dateien werden dabei <strong>nicht überschrieben</strong>. Der Export wird in einem eigenen Unterordner der jeweiligen Datenverzeichnisse abgelegt.</p>
        <p class="hint">Der Export ist für einen kontrollierten Rückweg auf V7.1.1 gedacht. Vor dem tatsächlichen Zurückkopieren müssen die Bot-Container gestoppt werden.</p>
        <button id="dbLegacyExportBtn" type="button" class="secondary">Rollback-Export erzeugen</button>
        <div id="dbLegacyResult" class="hint"></div>
      </div>`;
    $("dbLegacyExportBtn")?.addEventListener("click",async()=>{
      const ok=await askConfirm({title:"Rollback-Export erzeugen",text:"Aktuellen PostgreSQL-Stand zusätzlich als Legacy-JSON/JSONL exportieren? Produktivdaten werden nicht verändert.",confirmLabel:"EXPORT ERZEUGEN"});
      if(!ok)return;
      const btn=$("dbLegacyExportBtn");btn.disabled=true;
      try{
        const rr=await fetch("/api/database/export-legacy",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
        const j=await rr.json().catch(()=>({}));if(!rr.ok)throw new Error(j.error||`HTTP ${rr.status}`);
        $("dbLegacyResult").innerHTML=`<strong>Export erstellt.</strong><br>Twitch: <code>${esc(j.twitch?.path||"–")}</code><br>Discord: <code>${esc(j.discord?.path||j.discord?.error||"–")}</code>`;
        showToast("Rollback-Export wurde erstellt.","success");
      }catch(e){showToast(e.message,"error",7000);}finally{btn.disabled=false;}
    });
  }catch(e){root.innerHTML=`<div class="card error">PostgreSQL-Status konnte nicht geladen werden: ${esc(e.message)}</div>`;}
}

async function renderSystemStatus(){
  if(!hasRole("owner")){
    $("system").innerHTML=`<div class="card error">Dieser Bereich ist nur für Owner und den lokalen Admin verfügbar.</div>`;
    return;
  }

  $("system").innerHTML=`
    <div class="title">
      <div>
        <h2>Systemstatus</h2>
        <p class="hint">Diagnoseansicht für Owner und lokalen Admin. Es werden keine Access- oder Refresh-Tokens angezeigt.</p>
      </div>
      <div class="system-title-actions">
        <button id="systemRefreshBtn" type="button">Aktualisieren</button>
      </div>
    </div>
    <div id="systemStatusBody"><div class="card">Prüfe System …</div></div>
    <div class="card" id="performanceDiagnostics"><h3>Nachrichtenverarbeitung & Persistenz</h3><p class="hint">Aggregierte Diagnose; keine Chat-Inhalte.</p><div id="performanceMetrics">Lade Messwerte …</div><button type="button" id="performanceRefresh">Diagnose aktualisieren</button></div>`;

  $("systemRefreshBtn")?.addEventListener("click",()=>loadSystemStatus());
  await loadSystemStatus();
  await loadPerformanceDiagnostics();
  $("performanceRefresh")?.addEventListener("click",loadPerformanceDiagnostics);
}

async function restartService(target){
  const names={discord:"Discord-Bot",all:"alle Dienste",web:"Weboberfläche",twitchbot:"Twitch-Bot"};
  const name=names[target]||"Dienst";
  const ok=await askConfirm({
    title:"Dienst neu starten",
    text:`${name} wirklich neu starten? Laufende Verbindungen werden für einige Sekunden getrennt und anschließend automatisch wieder aufgebaut.`,
    confirmLabel:"NEU STARTEN",
    cancelLabel:"ABBRECHEN",
    danger:false
  });
  if(!ok)return;

  document.querySelectorAll("[data-system-restart]").forEach(btn=>btn.disabled=true);
  const root=$("systemStatusBody");

  try{
    const r=await fetch("/api/system/restart",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({target})
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);

    if(root){
      root.innerHTML=`<div class="card warning"><strong>🔄 ${esc(name)} wird neu gestartet …</strong><p class="hint">Das Control Center prüft automatisch, wann ${target==="all"?"beide Dienste":"der Dienst"} wieder bereit ${target==="all"?"sind":"ist"}.</p></div>`;
    }

    const started=Date.now();
    let seenUnavailable=false;

    const poll=async()=>{
      if(Date.now()-started>90_000){
        if(root)root.innerHTML=`<div class="card error">Neustart dauert länger als erwartet. Bitte Container Manager prüfen.</div>`;
        document.querySelectorAll("[data-system-restart]").forEach(btn=>btn.disabled=false);
        return;
      }

      try{
        if(target==="twitchbot"){
          // Die Oberfläche bleibt erreichbar; warten, bis der Twitch-Bot frisch gestartet und wieder verbunden ist.
          const check=await fetch("/api/system-status",{cache:"no-store"});
          const data=await check.json().catch(()=>({}));
          const bot=(data.services||[]).find(x=>x.key==="twitch");
          if(!check.ok||!bot||!bot.ok){
            seenUnavailable=true;
          }else if(Number(bot.uptimeSeconds??9999)<80&&(seenUnavailable||Date.now()-started>4000)){
            showToast("Twitch-Bot wurde neu gestartet und ist wieder verbunden.","success");
            await loadSystemStatus();
            return;
          }
        }else if(target==="discord"){
          const check=await fetch("/api/discord/status",{cache:"no-store"});
          const data=await check.json().catch(()=>({}));
          if(!check.ok||data.serviceReachable===false||!data.gateway?.ready){
            seenUnavailable=true;
          }else if((seenUnavailable||Date.now()-started>3500)&&data.gateway?.ready){
            showToast("Discord-Dienst wurde neu gestartet und ist wieder bereit.","success");
            await loadSystemStatus();
            return;
          }
        }else{
          const systemCheck=await fetch("/api/system-status",{cache:"no-store"});
          if(!systemCheck.ok){
            seenUnavailable=true;
          }else{
            const systemData=await systemCheck.json().catch(()=>({}));
            const mainReady=Number(systemData.uptimeSeconds||9999)<45;
            if((target==="twitch"||target==="web")&&mainReady&&(seenUnavailable||Date.now()-started>4000)){
              location.reload();return;
            }
            if(target==="all"&&mainReady){
              const discordCheck=await fetch("/api/discord/status",{cache:"no-store"});
              const discordData=await discordCheck.json().catch(()=>({}));
              if(discordCheck.ok&&discordData.serviceReachable!==false&&discordData.gateway?.ready){
                location.reload();return;
              }
            }
          }
        }
      }catch{
        seenUnavailable=true;
      }
      setTimeout(poll,1500);
    };

    setTimeout(poll,target==="discord"||target==="twitchbot"?2500:3200);
  }catch(e){
    showToast(`Neustart konnte nicht ausgelöst werden: ${e.message}`,"error",7000);
    document.querySelectorAll("[data-system-restart]").forEach(btn=>btn.disabled=false);
  }
}

async function loadPerformanceDiagnostics(){
 const root=$("performanceMetrics");if(!root)return;
 try{
  const response=await fetch("/api/admin/performance",{cache:"no-store"});const info=await response.json();if(!response.ok)throw Error(info.error||`HTTP ${response.status}`);
  const t=info.twitch||{},number=v=>typeof v==="number"?String(v):"Nicht verfügbar";
  const fields=[["Twitch Nachrichten/s",number(t.ratePerSecond)],["Twitch Verarbeitungslatenz",t.processingLatencyMs==null?"Nicht verfügbar":`${t.processingLatencyMs} ms`],["Offene Batches",number(t.pendingBatches)],["Queue-Auslastung",t.queueCapacity?`${Math.round(100*(t.spoolBytes||0)/t.queueCapacity)} %`:"Nicht verfügbar"],["Datenbanklatenz (Flush)",t.dbLatencyMs==null?"Nicht verfügbar":`${t.dbLatencyMs} ms`],["Chat-Antworten in Warteschlange",number(t.chatSend?.queued)],["Älteste Antwort wartet",t.chatSend?`${Math.round((t.chatSend.oldestWaitMs||0)/1000)} s`:"Nicht verfügbar"],["Chat-Antworten verworfen",number(t.chatSend?.droppedTotal)],["Rate-Limit von Twitch gemeldet",number(t.chatSend?.rateLimited)],["Fehlgeschlagene Schreibvorgänge",number(t.failedWrites)],["Wiederholungsversuche",number(t.retries)],["Letzter erfolgreicher Flush",t.lastFlush?new Date(t.lastFlush).toLocaleString("de-DE"):"Noch keiner"],["Discord Nachrichten/s",number(info.discord?.ratePerSecond)],["Discord Verarbeitungslatenz",info.discord?.processingLatencyMs==null?"Nicht verfügbar":`${info.discord.processingLatencyMs} ms`],["Discord Verarbeitete Nachrichten",number(info.discord?.processed)],["Discord Fehler",number(info.discord?.failedWrites)],["Discord offene Verarbeitungen",info.discord?.pendingBatches==null?"Nicht verfügbar":number(info.discord.pendingBatches)],["Discord Rückstau-Spitze",info.discord?.peakPendingMessages==null?"Nicht verfügbar":number(info.discord.peakPendingMessages)],["Discord XP-Speicherlatenz",info.discord?.dbLatencyMs==null?"Nicht verfügbar":`${info.discord.dbLatencyMs} ms`],["Discord langsame XP-Speicherungen (>1 s)",info.discord?.dbSlowOperations==null?"Nicht verfügbar":number(info.discord.dbSlowOperations)]];
  root.innerHTML=`<div class="diag-grid">${fields.map(([label,val])=>`<div class="card"><small>${esc(label)}</small><p><strong>${esc(val)}</strong></p></div>`).join("")}</div>${t.lastError?`<p class="hint">Letzter Speicherfehler: ${esc(t.lastError)}</p>`:""}`;
 }catch(error){root.textContent=`Diagnose nicht verfügbar: ${error.message}`;}
}

async function loadSystemStatus(){
  const root=$("systemStatusBody");
  if(!root) return;
  root.innerHTML=`<div class="card">Prüfe System …</div>`;

  try{
    const r=await fetch("/api/system-status",{cache:"no-store"});
    const s=await r.json();
    if(!r.ok) throw new Error(s.error||`HTTP ${r.status}`);

    const tokenRows=(s.tokens?.items||[]).map(t=>`
      <div class="diag-row">
        <div>
          <strong>${esc(t.displayName||t.login||t.key)}</strong>
          <span class="diag-sub">${esc(t.purpose||"")}</span>
        </div>
        <div>${diagState(!!t.valid,t.authorizedLogin||"gültig",t.error||(!t.connected?"Token fehlt":"Berechtigung fehlt"))}</div>
        <div class="diag-scopes">
          ${t.missingScopes?.length
            ? `<span class="diag-missing">Fehlt: ${esc(t.missingScopes.join(", "))}</span>`
            : `<span class="diag-muted">${(t.scopes||[]).length} Scopes</span>`}
        </div>
      </div>`).join("");

    const eventRows=(s.eventSub?.items||[]).map(e=>`
      <div class="diag-row">
        <div><strong>${esc(e.type)}</strong><span class="diag-sub">via ${esc(e.tokenAccount||"–")}</span></div>
        <div>${diagState(!!e.ok,e.status===409?"bereits aktiv":"aktiv",e.error||`HTTP ${e.status??"?"}`)}</div>
        <div class="diag-muted">${fmtDiagDate(e.updatedAt)}</div>
      </div>`).join("");

    const warningHtml=(s.warnings||[]).length
      ? `<div class="card warning-card"><h3>Hinweise</h3><ul class="diag-list">${s.warnings.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`
      : `<div class="card diag-all-ok"><strong>✓ Keine aktuellen Systemwarnungen</strong></div>`;

    const eventLabel=(e,empty="Noch kein Eintrag")=>{
      if(!e) return `<span class="diag-muted">${empty}</span>`;
      const detail=e.detail||{};
      const extra=detail.user?` · @${esc(detail.user)}`:
        detail.title?` · ${esc(detail.title)}`:
        detail.target?` · @${esc(detail.target)}`:"";
      return `<strong>${esc(e.action||"")}</strong>${extra}<span class="diag-sub">${fmtDiagDate(e.ts)}</span>`;
    };

    const errors=(s.recentErrors||[]);
    const errorHtml=errors.length
      ? errors.map(e=>`
          <div class="diag-error-row">
            <div><strong>${esc(e.action||"Fehler")}</strong>${Number(e.occurrences||1)>1?` <span class="diag-muted">×${Number(e.occurrences||1)}</span>`:""} · ${esc(e.user||"System")}</div>
            <div>${esc(e.detail?.error||e.detail?.reason||e.detail?.status||"–")}</div>
            <time>${fmtDiagDate(e.ts)}</time>
          </div>`).join("")
      : `<div class="diag-muted">Keine protokollierten Fehler in den letzten Einträgen.</div>`;

    // Dienste-Übersicht (welche Teile laufen, seit wann).
    const fmtBytes=n=>Number(n)>0?`${Math.round(Number(n)/1048576)} MB`:"–";
    const serviceRows=(s.services||[]).map(v=>`
      <div class="diag-row service-row">
        <div><strong>${esc(v.name)}</strong>${v.label?` <code>${esc(v.label)}</code>`:""}<span class="diag-sub">${esc(v.detail||"")}</span></div>
        <div>${diagState(!!v.ok,v.state||"läuft",v.state||"Fehler")}</div>
        <div class="diag-muted">${v.uptimeSeconds==null?"":`läuft seit ${esc(fmtUptime(v.uptimeSeconds))}`}${v.memoryRss?` · RAM ${esc(fmtBytes(v.memoryRss))}`:""}${Number(v.pendingEvents)>0?` · ${Number(v.pendingEvents)} Ereignis(se) in Zustellung`:""}</div>
      </div>`).join("");
    const servicesHtml=(s.services||[]).length?`
      <div class="card">
        <div class="title"><div><h3>Dienste</h3><p class="hint">Weboberfläche, Twitch-Bot und Discord-Bot laufen als eigene Dienste. Fällt einer aus, laufen die anderen weiter.</p></div></div>
        <div class="diag-table">${serviceRows}</div>
      </div>`:"";
    // 8.11.0: Update-Werkzeug (Fassung auf dem Host, Rückfall nach fehlgeschlagenem Werkzeug-Update).
    const up=s.updater;
    const updaterHtml=up?`
      <div class="card">
        <div class="title"><div><h3>Update-Werkzeug</h3><p class="hint">Läuft auf dem Host und spielt freigegebene Updates ein. Einzelheiten unter „Updates“.</p></div><span class="hint">${up.launcher?"Startdatei aktiv":"ohne Startdatei"}</span></div>
        <div class="diag-table"><div class="diag-row service-row">
          <div><strong>Fassung ${esc(up.toolVersion)}</strong><span class="diag-sub">${up.previous?`Rückfallfassung ${esc(up.previous)}`:"keine Rückfallfassung"}${up.pending?` · bereitgelegt ${esc(up.pending)}`:""}</span></div>
          <div>${diagState(!up.openFallback,"in Ordnung","Werkzeug-Update fehlgeschlagen")}</div>
          <div class="diag-muted">${up.openFallback?esc(`${up.openFallback.version}: ${up.openFallback.reason||"Grund unbekannt"}`):up.updatedAt?`zuletzt gemeldet ${esc(fmtDiagDate(up.updatedAt))}`:""}</div>
        </div></div>
      </div>`:"";
    const restartOptions=`
          <div class="system-restart-option"><strong>Weboberfläche</strong><span>Startet nur die Weboberfläche neu. Der Twitch-Bot läuft weiter.</span><button type="button" class="secondary" data-system-restart="web">Weboberfläche neu starten</button></div>
          <div class="system-restart-option"><strong>Twitch-Bot</strong><span>Startet nur den Twitch-Bot neu. Die Oberfläche bleibt erreichbar.</span><button type="button" class="secondary" data-system-restart="twitchbot">Twitch-Bot neu starten</button></div>
          <div class="system-restart-option"><strong>Discord-Bot</strong><span>Startet nur den Discord-Bot neu.</span><button type="button" class="secondary" data-system-restart="discord">Discord-Bot neu starten</button></div>
          <div class="system-restart-option"><strong>Komplett</strong><span>Startet Weboberfläche, Twitch-Bot und Discord-Bot kontrolliert neu; die Container bleiben online.</span><button type="button" data-system-restart="all">Alle Dienste neu starten</button></div>`;

    root.innerHTML=`
      <div class="diag-summary-grid">
        <div class="card diag-summary"><span>Gesamtzustand</span><strong>${s.healthy?"✓ Bereit":"! Prüfen"}</strong><small>Version ${esc(s.version||"–")}</small></div>
        <div class="card diag-summary"><span>Twitch-Verbindungen</span><strong>${Number(s.tokens?.ok||0)} / ${Number(s.tokens?.total||0)}</strong><small>vollständig gültig</small></div>
        <div class="card diag-summary"><span>EventSub</span><strong>${Number(s.eventSub?.ok||0)} / ${Number(s.eventSub?.expected||0)}</strong><small>${s.websocket?.connected?"WebSocket verbunden":s.websocket?.runtimeState==="reconnecting"?"Twitch-Reconnect läuft":s.websocket?.runtimeState==="connecting"?"Verbindungsaufbau":s.websocket?.runtimeState==="waiting"?"Warte auf neuen Versuch":"WebSocket getrennt"}</small></div>
        <div class="card diag-summary"><span>Server-Uptime</span><strong>${esc(fmtUptime(s.uptimeSeconds))}</strong><small>Node ${esc(s.nodeVersion||"–")}</small></div>
        <div class="card diag-summary"><span>RAM</span><strong>${esc(s.memory?.rss||"–")}</strong><small>Heap ${esc(s.memory?.heapUsed||"–")} / ${esc(s.memory?.heapTotal||"–")}</small></div>
        <div class="card diag-summary"><span>Watchtime</span><strong>${Number(s.watchtime?.users||0)} Nutzer</strong><small>zuletzt ${fmtDiagDate(s.watchtime?.updatedAt)}</small></div>
      </div>

      ${warningHtml}

      ${servicesHtml}
      ${updaterHtml}

      <div class="card">
        <div class="title"><h3>Twitch-Verbindungen</h3><span class="hint">${Number(s.tokens?.ok||0)} von ${Number(s.tokens?.total||0)} bereit</span></div>
        <div class="diag-table">${tokenRows||'<div class="diag-muted">Keine Verbindungen.</div>'}</div>
      </div>

      <div class="card">
        <div class="title"><h3>EventSub</h3><span class="hint">${s.websocket?.connected?"WebSocket verbunden":esc(s.websocket?.runtimeState||"getrennt")}</span></div>
        <div class="diag-kv-grid eventsub-runtime-grid">
          <div class="diag-kv"><span>Status</span><strong>${esc(s.websocket?.runtimeState||"–")}</strong></div>
          <div class="diag-kv"><span>Socket</span><strong>${esc(s.websocket?.socketState||"–")}</strong></div>
          <div class="diag-kv"><span>Letzte Verbindung</span><strong>${fmtDiagDate(s.websocket?.lastConnectedAt)}</strong></div>
          <div class="diag-kv"><span>Letzte Nachricht</span><strong>${fmtDiagDate(s.websocket?.lastMessageAt)}</strong></div>
          <div class="diag-kv"><span>Reconnect-Versuche</span><strong>${Number(s.websocket?.reconnectAttempts||0)}</strong></div>
          <div class="diag-kv"><span>Nächster Versuch</span><strong>${fmtDiagDate(s.websocket?.nextRetryAt)}</strong></div>
          <div class="diag-kv"><span>Letzter Close</span><strong>${s.websocket?.lastCloseCode?`${Number(s.websocket.lastCloseCode)} ${esc(s.websocket?.lastCloseReason||"")}`:"–"}</strong></div>
          <div class="diag-kv"><span>Letzter Fehler</span><strong>${esc(s.websocket?.lastError||"–")}</strong></div>
        </div>
        <div class="diag-table">${eventRows||'<div class="diag-muted">Noch keine Subscription-Daten.</div>'}</div>
      </div>

      <div class="diag-two-col">
        <div class="card">
          <h3>Letzte Ereignisse</h3>
          <div class="diag-event"><span>Follow</span>${eventLabel(s.lastEvents?.follow)}</div>
          <div class="diag-event"><span>Raid</span>${eventLabel(s.lastEvents?.raid)}</div>
          <div class="diag-event"><span>AutoMod Hold</span>${eventLabel(s.lastEvents?.automodHold)}</div>
          <div class="diag-event"><span>Auto-Allow</span>${eventLabel(s.lastEvents?.automodAllow)}</div>
          <div class="diag-event"><span>Clip</span>${eventLabel(s.lastEvents?.clip)}</div>
          <div class="diag-event"><span>Moderation</span>${eventLabel(s.lastEvents?.moderation)}</div>
        </div>

        <div class="card">
          <h3>Clip-Monitor</h3>
          <div class="diag-kv"><span>Aktiv</span><strong>${s.clip?.enabled?"Ja":"Nein"}</strong></div>
          <div class="diag-kv"><span>Initialisiert</span><strong>${s.clip?.initialized?"Ja":"Nein"}</strong></div>
          <div class="diag-kv"><span>Bekannte Clips</span><strong>${Number(s.clip?.knownCount||0)}</strong></div>
          <div class="diag-kv"><span>Letzte Prüfung</span><strong>${fmtDiagDate(s.clip?.lastCheckedAt)}</strong></div>
          <div class="diag-kv"><span>Letzter Share</span><strong>${fmtDiagDate(s.clip?.lastShared?.sharedAt)}</strong></div>
          <div class="diag-kv"><span>Letzter Fehler</span><strong>${esc(s.clip?.lastError||"–")}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="title"><div><h3>Dienste neu starten</h3><p class="hint">Ein interner Supervisor startet den jeweiligen Node-Dienst neu, ohne den Docker-Container zu stoppen.</p></div></div>
        <div class="system-restart-grid">${restartOptions}
        </div>
      </div>

      <div class="card">
        <div class="title"><h3>Persistente Daten</h3><span class="hint">Dateigröße / letzte Änderung</span></div>
        <div class="diag-files">
          ${Object.entries(s.files||{}).map(([key,f])=>`
            <div class="diag-file">
              <strong>${esc(key)}</strong>
              <span>${esc(f.size||"0 B")}</span>
              <small>${fmtDiagDate(f.modifiedAt)}</small>
            </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="title"><h3>Letzte Systemfehler</h3><span class="hint">maximal 20 unterschiedliche Fehler · Wiederholungen zusammengefasst</span></div>
        <div class="diag-errors">${errorHtml}</div>
      </div>

      <p class="hint">Stand: ${fmtDiagDate(s.generatedAt)} · Kanal-ID: ${esc(s.channel?.id||"–")} · Local Admin: ${s.localAdminEnabled?"aktiv":"deaktiviert"}${s.localAdmin?.enabled?` · Modus: ${s.localAdmin?.mode==="direct-lan-only"?"direktes LAN (Proxyheader ignoriert)":"LAN + vertrauenswürdiger Proxy"}`:""}</p>
    `;
    root.querySelectorAll("[data-system-restart]").forEach(btn=>btn.addEventListener("click",()=>restartService(btn.dataset.systemRestart)));
  }catch(e){
    root.innerHTML=`<div class="card error">Systemstatus konnte nicht geladen werden: ${esc(e.message)}</div>`;
  }
}




let discordEmergencyUi={data:null};

function emergencyMultiOptions(channels,selected=[]){
  const set=new Set((selected||[]).map(String));
  return (channels||[]).map(c=>`<option value="${esc(c.id)}" ${set.has(String(c.id))?"selected":""}>${c.parentName?`${esc(c.parentName)} · `:""}#${esc(c.name)}</option>`).join("");
}
function emergencyHistoryLabel(type){
  return ({
    activated:"aktiviert",
    level_changed:"Stufe geändert",
    deactivated:"beendet"
  })[type]||type;
}
function renderEmergencyLevelConfig(level,cfg,catalog,disabled){
  return `<details class="card emergency-level-card" ${level==="1"?"open":""}>
    <summary><strong>${esc(cfg.label||`Stufe ${level}`)}</strong><span class="hint">Kanäle und Einschränkungen</span><span class="access-user-chevron">⌄</span></summary>
    <div class="emergency-level-body">
      <label>Bezeichnung<input data-em-level="${level}" data-em-k="label" value="${esc(cfg.label||"")}" ${disabled?"disabled":""}></label>
      <div class="grid two">
        <label>Textkanäle<select data-em-level="${level}" data-em-k="textChannelIds" multiple size="8" ${disabled?"disabled":""}>${emergencyMultiOptions(catalog.textChannels,cfg.textChannelIds)}</select></label>
        <label>Sprachkanäle<select data-em-level="${level}" data-em-k="voiceChannelIds" multiple size="8" ${disabled?"disabled":""}>${emergencyMultiOptions(catalog.voiceChannels,cfg.voiceChannelIds)}</select></label>
      </div>
      <label class="toggle-row"><input data-em-level="${level}" data-em-k="denyReactions" type="checkbox" ${cfg.denyReactions?"checked":""} ${disabled?"disabled":""}><span>Reaktionen in den betroffenen Textkanälen ebenfalls sperren</span></label>
    </div>
  </details>`;
}
function collectEmergencyConfig(root,d){
  const current=d.config||{},levels={};
  for(const level of["1","2","3"]){
    const q=(key)=>root.querySelector(`[data-em-level="${level}"][data-em-k="${key}"]`);
    levels[level]={
      label:q("label")?.value||current.levels?.[level]?.label||`Stufe ${level}`,
      textChannelIds:[...(q("textChannelIds")?.selectedOptions||[])].map(x=>x.value),
      voiceChannelIds:[...(q("voiceChannelIds")?.selectedOptions||[])].map(x=>x.value),
      denyReactions:!!q("denyReactions")?.checked
    };
  }
  return {
    noticeChannelId:$("emergencyNoticeChannel")?.value||"",
    announceActivation:!!$("emergencyAnnounceActivation")?.checked,
    announceDeactivation:!!$("emergencyAnnounceDeactivation")?.checked,
    activationMessage:$("emergencyActivationMessage")?.value||"",
    deactivationMessage:$("emergencyDeactivationMessage")?.value||"",
    levels
  };
}
async function renderDiscordEmergency(){
  const root=$("discordEmergency");if(!root)return;
  if(!isGlobalAdmin()){root.innerHTML=`<div class="card error">Der Notfallmodus ist ausschließlich für Owner und Admins verfügbar.</div>`;return;}
  root.innerHTML=`<div class="card">Notfallmodus wird geladen …</div>`;
  try{
    const r=await fetch("/api/discord/emergency",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Notfallmodus konnte nicht geladen werden.");
    discordEmergencyUi.data=d;
    const s=d.state||{},c=d.config||{},catalog=d.catalog||{},active=!!s.active;
    const textAll=(catalog.channels||[]).filter(x=>x.kind==="text");
    const noticeOpts=textAll.map(x=>`<option value="${esc(x.id)}" ${String(x.id)===String(c.noticeChannelId||"")?"selected":""}>${x.parentName?`${esc(x.parentName)} · `:""}#${esc(x.name)}</option>`).join("");
    const levels=c.levels||{};
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Notfallmodus</h2><p class="hint">Temporärer Server-Lockdown mit exakter Wiederherstellung der vorherigen Kanalrechte.</p></div><button id="emergencyRefresh" type="button" class="secondary">Aktualisieren</button></div>

      <div class="card emergency-status ${active?"emergency-active":""}">
        <div class="title compact-title">
          <div>
            <h3>${active?"🚨 Notfallmodus AKTIV":"Notfallmodus inaktiv"}</h3>
            <p class="hint">${active?`${esc(s.levelLabel||`Stufe ${s.level}`)} · aktiviert durch ${esc(s.actor||"unbekannt")}`:"Der Server arbeitet im Normalbetrieb."}</p>
          </div>
          <span class="diag-badge ${active?"bad":"ok"}">${active?"AKTIV":"NORMAL"}</span>
        </div>
        ${active?`
          <div class="summary-grid">
            <div class="summary-item"><strong>${esc(s.levelLabel||s.level||"–")}</strong><span>Stufe</span></div>
            <div class="summary-item"><strong>${esc(s.reason||"–")}</strong><span>Grund</span></div>
            <div class="summary-item"><strong>${esc(discordFormatTime(s.startedAt))}</strong><span>Aktiv seit</span></div>
            <div class="summary-item"><strong>${s.endsAt?esc(discordFormatTime(s.endsAt)):"manuell"}</strong><span>Ende</span></div>
          </div>
          <div class="warning"><strong>Kanal-Zeitsteuerung pausiert.</strong> Während des Notfallmodus verändert die Nachtruhe keine Kanalrechte. Nach Beendigung wird der aktuelle Zeitplan automatisch neu angewendet.</div>
          ${s.lastError?`<div class="error"><strong>Letzter Fehler:</strong> ${esc(s.lastError)}</div>`:""}
        `:`<div class="emergency-safe-note">Nur die Rolle <strong>${esc(rl("member"))}</strong> wird eingeschränkt. ${esc(rl("administrator"))}, ${esc(rl("moderator"))} und der Bot bleiben handlungsfähig. Regeln, Meldekopf, #log und Stabsraum sind serverseitig vom Notfallmodus geschützt.</div>`}
      </div>

      ${!active?`
      <div class="card">
        <div class="title compact-title"><div><h3>Notfallmodus aktivieren</h3><p class="hint">Grund ist Pflicht. Optional endet der Modus automatisch nach der gewählten Zeit.</p></div></div>
        <div class="grid three">
          <label>Stufe<select id="emergencyActivateLevel">
            <option value="1">${esc(levels["1"]?.label||"Stufe 1")}</option>
            <option value="2">${esc(levels["2"]?.label||"Stufe 2")}</option>
            <option value="3">${esc(levels["3"]?.label||"Stufe 3")}</option>
          </select></label>
          <label>Dauer<select id="emergencyDuration">
            <option value="15">15 Minuten</option>
            <option value="30" selected>30 Minuten</option>
            <option value="60">60 Minuten</option>
            <option value="120">120 Minuten</option>
            <option value="0">Bis manuell beendet</option>
          </select></label>
          <label>Grund<input id="emergencyReason" maxlength="500" placeholder="z. B. Raid / massiver Spam / akute Lage"></label>
        </div>
        <div class="actions"><button id="emergencyActivate" type="button" class="danger-strong">Notfallmodus aktivieren</button></div>
      </div>`:`
      <div class="card">
        <div class="title compact-title"><div><h3>Aktiven Notfallmodus steuern</h3><p class="hint">Eine Stufenänderung behält die ursprünglichen Rechte-Snapshots bei.</p></div></div>
        <div class="grid two">
          <label>Neue Stufe<select id="emergencyChangeLevel">
            <option value="1" ${s.level==="1"?"selected":""}>${esc(levels["1"]?.label||"Stufe 1")}</option>
            <option value="2" ${s.level==="2"?"selected":""}>${esc(levels["2"]?.label||"Stufe 2")}</option>
            <option value="3" ${s.level==="3"?"selected":""}>${esc(levels["3"]?.label||"Stufe 3")}</option>
          </select></label>
          <label>Grund / Lagefortschreibung<input id="emergencyChangeReason" maxlength="500" value="${esc(s.reason||"")}"></label>
        </div>
        <div class="actions">
          <button id="emergencyApplyLevel" type="button" class="secondary">Stufe übernehmen</button>
          <button id="emergencyDeactivate" type="button">Notfallmodus beenden</button>
        </div>
      </div>`}

      <div class="card">
        <div class="title compact-title"><div><h3>Konfiguration</h3><p class="hint">Änderungen sind nur möglich, wenn der Notfallmodus inaktiv ist.</p></div></div>
        <div class="grid three">
          <label>Öffentlicher Hinweis-Kanal<select id="emergencyNoticeChannel" ${active?"disabled":""}>${noticeOpts}</select></label>
          <label class="toggle-row"><input id="emergencyAnnounceActivation" type="checkbox" ${c.announceActivation!==false?"checked":""} ${active?"disabled":""}><span>Aktivierung öffentlich ankündigen</span></label>
          <label class="toggle-row"><input id="emergencyAnnounceDeactivation" type="checkbox" ${c.announceDeactivation!==false?"checked":""} ${active?"disabled":""}><span>Beendigung öffentlich ankündigen</span></label>
        </div>
        <label>Aktivierungsnachricht<textarea id="emergencyActivationMessage" rows="4" ${active?"disabled":""}>${esc(c.activationMessage||"")}</textarea></label>
        <label>Beendigungsnachricht<textarea id="emergencyDeactivationMessage" rows="3" ${active?"disabled":""}>${esc(c.deactivationMessage||"")}</textarea></label>
        <p class="hint">Variablen: <code>{level}</code>, <code>{levelLabel}</code>, <code>{reason}</code>, <code>{actor}</code>, <code>{duration}</code>.</p>
        ${(levels&&["1","2","3"].map(level=>renderEmergencyLevelConfig(level,levels[level]||{},catalog,active)).join(""))||""}
        ${!active?'<div class="actions"><button id="emergencySaveConfig" type="button">Notfall-Konfiguration speichern</button></div>':""}
        ${isGlobalAdmin()?'<div class="central-log-link"><strong>Discord-Logs</strong><p class="hint">Aktivierung, Stufenwechsel, Beendigung und Fehler werden in der zentralen Log-Zentrale konfiguriert.</p><button type="button" class="secondary" data-open-log-category="emergency">Log-Einstellungen öffnen</button></div>':""}
      </div>

      <div class="card">
        <div class="title compact-title"><div><h3>Schutzmechanismen</h3><p class="hint">Diese Regeln sind bewusst nicht abschaltbar.</p></div></div>
        <div class="emergency-safeguards">
          <span>✓ Nur <strong>${esc(d.safeguards?.affectedRole?.name||rl("member"))}</strong> wird verändert.</span>
          <span>✓ ${esc(rl("administrator"))}, ${esc(rl("moderator"))} und Bot bleiben unbeeinträchtigt.</span>
          <span>✓ Regeln akzeptieren und ${esc(rl("member"))} erhalten funktioniert weiterhin.</span>
          <span>✓ Vor jeder Änderung wird der exakte vorhandene Rollen-Overwrite gespeichert.</span>
          <span>✓ Beim Beenden wird genau dieser Zustand wiederhergestellt.</span>
          <span>✓ Neustarts erkennen einen aktiven Notfallmodus und erzwingen ihn erneut.</span>
        </div>
      </div>

      <div class="card">
        <div class="title compact-title"><div><h3>Verlauf</h3><p class="hint">Letzte Aktivierungen, Stufenwechsel und Beendigungen.</p></div></div>
        <div class="emergency-history">${(s.history||[]).length?(s.history||[]).slice(0,50).map(e=>`<div class="emergency-history-row"><time>${esc(discordFormatTime(e.at))}</time><strong>${esc(emergencyHistoryLabel(e.type))}</strong><span>${e.level?`Stufe ${esc(e.level)}`:""}</span><span>${esc(e.actor||"")}</span><span>${esc(e.reason||"")}</span></div>`).join(""):'<span class="hint">Noch keine Notfallmodus-Ereignisse.</span>'}</div>
      </div>`;

    wireCentralLogLinks(root);
    $("emergencyRefresh")?.addEventListener("click",()=>renderDiscordEmergency());

    $("emergencySaveConfig")?.addEventListener("click",async()=>{
      const body=collectEmergencyConfig(root,d);
      const rr=await fetch("/api/discord/emergency/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Notfall-Konfiguration konnte nicht gespeichert werden.","error",7000);
      showToast("Notfall-Konfiguration gespeichert.","success");renderDiscordEmergency();
    });

    $("emergencyActivate")?.addEventListener("click",async()=>{
      const level=$("emergencyActivateLevel")?.value||"1",reason=$("emergencyReason")?.value.trim()||"",durationMinutes=Number($("emergencyDuration")?.value||0);
      if(!reason)return showToast("Bitte einen Grund für den Notfallmodus angeben.","warning");
      const ok=await askConfirm({
        title:"Notfallmodus aktivieren",
        text:`${levels[level]?.label||`Stufe ${level}`} jetzt aktivieren? Die konfigurierten Schreib-/Sprachrechte der ${esc(rl("memberPlural"))} werden sofort eingeschränkt und vorher exakt gesichert.`,
        confirmLabel:"AKTIVIEREN",cancelLabel:"ABBRECHEN",danger:true
      });
      if(!ok)return;
      const rr=await fetch("/api/discord/emergency/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,reason,durationMinutes})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Notfallmodus konnte nicht aktiviert werden.","error",7000);
      showToast("Notfallmodus aktiviert.","success");renderDiscordEmergency();
    });

    $("emergencyApplyLevel")?.addEventListener("click",async()=>{
      const level=$("emergencyChangeLevel")?.value||s.level,reason=$("emergencyChangeReason")?.value.trim()||s.reason||"";
      const ok=await askConfirm({title:"Notfallstufe ändern",text:`Auf ${levels[level]?.label||`Stufe ${level}`} wechseln?`,confirmLabel:"STUFE ÄNDERN",cancelLabel:"ABBRECHEN",danger:false});
      if(!ok)return;
      const rr=await fetch("/api/discord/emergency/level",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,reason})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Notfallstufe konnte nicht geändert werden.","error",7000);
      showToast("Notfallstufe geändert.","success");renderDiscordEmergency();
    });

    $("emergencyDeactivate")?.addEventListener("click",async()=>{
      const ok=await askConfirm({
        title:"Notfallmodus beenden",
        text:"Notfallmodus jetzt beenden und alle zuvor gesicherten Kanalrechte exakt wiederherstellen?",
        confirmLabel:"BEENDEN & WIEDERHERSTELLEN",cancelLabel:"ABBRECHEN",danger:false
      });
      if(!ok)return;
      const rr=await fetch("/api/discord/emergency/deactivate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reason:"manuell beendet"})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Notfallmodus konnte nicht beendet werden.","error",7000);
      showToast("Notfallmodus beendet und Kanalrechte wiederhergestellt.","success");renderDiscordEmergency();
    });
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

let discordLogsUi={category:"moderation",data:null};
function discordLogChannelOptions(channels,selected,allowDefault=false){
  const head=allowDefault?`<option value="">Standard-Logkanal verwenden</option>`:"";
  return head+(channels||[]).map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(selected||"")?"selected":""}>#${esc(c.name)}</option>`).join("");
}
function renderDiscordLogEventCard(key,event,channels,canEdit){
  const override=event.channelId||"";
  return `<div class="card discord-log-event" data-log-event="${esc(key)}">
    <div class="title compact-title"><div><h3>${esc(event.label||key)}</h3><p class="hint"><code>${esc(key)}</code></p></div><span class="diag-badge ${event.enabled?"ok":"warn"}">${event.enabled?"aktiv":"aus"}</span></div>
    <div class="grid two">
      <label class="toggle-row"><input data-log-k="enabled" type="checkbox" ${event.enabled?"checked":""} ${canEdit?"":"disabled"}><span>Discord-Lognachricht senden</span></label>
      <label>Zielkanal<select data-log-k="channelId" ${canEdit?"":"disabled"}>${discordLogChannelOptions(channels,override,true)}</select></label>
    </div>
    <label>Nachrichtentemplate<textarea data-log-k="template" rows="5" ${canEdit?"":"disabled"}>${esc(event.template||"")}</textarea></label>
    <div class="discord-log-vars"><strong>Variablen:</strong> ${(event.variables||[]).map(v=>`<code>{${esc(v)}}</code>`).join(" ")||"<span class='hint'>keine</span>"}</div>
    ${canEdit?`<div class="actions"><button type="button" class="secondary" data-log-test="${esc(key)}">Test senden</button><button type="button" class="secondary" data-log-reset="${esc(key)}">Standard wiederherstellen</button></div>`:""}
  </div>`;
}
async function renderDiscordLogsAdmin(){
  const root=$("discordLogsAdmin");if(!root)return;
  if(!isGlobalAdmin()){root.innerHTML=`<div class="card error">Dieser Bereich ist ausschließlich für Admins und Owner verfügbar.</div>`;return;}
  root.innerHTML=`<div class="card">Discord-Logs werden geladen …</div>`;
  try{
    const r=await fetch("/api/discord/logs",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Discord-Logs konnten nicht geladen werden.");
    discordLogsUi.data=d;
    const canEdit=hasCapability("discord.logs.edit"),c=d.config||{},channels=d.catalog?.channels||[],categories=d.categories||[];
    if(!categories.some(x=>x.id===discordLogsUi.category))discordLogsUi.category=categories[0]?.id||"moderation";
    const category=discordLogsUi.category;
    const entries=Object.entries(c.events||{}).filter(([,e])=>e.category===category);
    root.innerHTML=`
      <div class="title"><div><h2>Discord · Administration · Logs & Benachrichtigungen</h2><p class="hint">Zentrale Steuerstelle für Discord-Lognachrichten. Das interne Audit-Protokoll bleibt davon unabhängig und kann hier nicht abgeschaltet oder verändert werden.</p></div><button id="discordLogsRefresh" type="button" class="secondary">Aktualisieren</button></div>
      <div class="card discord-log-global">
        <div class="grid two">
          <label class="toggle-row"><input id="discordLogsEnabled" type="checkbox" ${c.enabled!==false?"checked":""} ${canEdit?"":"disabled"}><span>Discord-Lognachrichten global aktiv</span></label>
          <label>Standard-Logkanal<select id="discordLogsDefaultChannel" ${canEdit?"":"disabled"}>${discordLogChannelOptions(channels,c.defaultChannelId,false)}</select></label>
        </div>
        <p class="hint">Einzelne Ereignisse können einen eigenen Zielkanal erhalten. Ohne Auswahl verwenden sie den Standard-Logkanal. Discord-Logs sind abschaltbar; technische Audit-Einträge im Control Center bleiben erhalten.</p>
      </div>
      <nav class="moderation-subnav discord-log-tabs" aria-label="Log-Kategorien">
        ${categories.map(cat=>`<button type="button" class="moderation-subtab ${cat.id===category?"active":""}" data-log-category="${esc(cat.id)}">${esc(cat.label)}</button>`).join("")}
      </nav>
      <div class="discord-log-events">${entries.map(([key,event])=>renderDiscordLogEventCard(key,event,channels,canEdit)).join("")||'<div class="card hint">Keine Log-Ereignisse in dieser Kategorie.</div>'}</div>
      ${canEdit?'<div class="actions discord-log-savebar"><button id="discordLogsSave" type="button">Log-Einstellungen speichern</button></div>':""}
      <div class="card"><h3>Hinweis zur Zentralisierung</h3><p>Die fachlichen Bereiche zeigen nur noch einen Verweis auf diese Log-Zentrale. Aktivierung, Zielkanal und Text der Logmeldungen werden hier gepflegt. Das gilt auch für <strong>Ban aufgehoben</strong>.</p></div>`;
    root.querySelectorAll("[data-log-category]").forEach(btn=>btn.onclick=()=>{discordLogsUi.category=btn.dataset.logCategory;renderDiscordLogsAdmin();});
    $("discordLogsRefresh")?.addEventListener("click",()=>renderDiscordLogsAdmin());
    const saveDiscordLogsForm=async({toast=true,rerender=true}={})=>{
      const next=typeof structuredClone==="function"?structuredClone(c):JSON.parse(JSON.stringify(c));
      next.enabled=!!$("discordLogsEnabled")?.checked;
      next.defaultChannelId=$("discordLogsDefaultChannel")?.value||"";
      root.querySelectorAll("[data-log-event]").forEach(card=>{
        const key=card.dataset.logEvent,event=next.events[key];if(!event)return;
        event.enabled=!!card.querySelector('[data-log-k="enabled"]')?.checked;
        event.channelId=card.querySelector('[data-log-k="channelId"]')?.value||null;
        event.template=card.querySelector('[data-log-k="template"]')?.value||"";
      });
      const rr=await fetch("/api/discord/logs/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(next)}),j=await rr.json().catch(()=>({}));
      if(!rr.ok){showToast(j.error||"Log-Einstellungen konnten nicht gespeichert werden.","error",6000);return false;}
      if(toast)showToast("Discord-Log-Einstellungen gespeichert.","success");
      if(rerender)await renderDiscordLogsAdmin();
      return true;
    };
    $("discordLogsSave")?.addEventListener("click",()=>saveDiscordLogsForm());
    root.querySelectorAll("[data-log-test]").forEach(btn=>btn.onclick=async()=>{
      const eventKey=btn.dataset.logTest;
      if(!(await saveDiscordLogsForm({toast:false,rerender:false})))return;
      const rr=await fetch("/api/discord/logs/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventKey})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Test-Log konnte nicht gesendet werden.","error",6000);
      showToast("Test-Log gesendet.","success");
    });
    root.querySelectorAll("[data-log-reset]").forEach(btn=>btn.onclick=async()=>{
      const eventKey=btn.dataset.logReset;
      const ok=await askConfirm({title:"Log-Standard wiederherstellen",text:"Aktivierung, Zielkanal-Override und Nachrichtentext dieses Log-Ereignisses auf den Standard zurücksetzen?",confirmLabel:"ZURÜCKSETZEN",cancelLabel:"ABBRECHEN"});
      if(!ok)return;
      const rr=await fetch("/api/discord/logs/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventKey})}),j=await rr.json().catch(()=>({}));
      if(!rr.ok)return showToast(j.error||"Standard konnte nicht wiederhergestellt werden.","error");
      showToast("Log-Ereignis zurückgesetzt.","success");renderDiscordLogsAdmin();
    });
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
function openDiscordLogsCategory(category){
  discordLogsUi.category=category||"moderation";
  openNavTab("discordLogsAdmin",{persist:true});
}
function wireCentralLogLinks(root=document){
  root.querySelectorAll("[data-open-log-category]").forEach(btn=>btn.onclick=()=>openDiscordLogsCategory(btn.dataset.openLogCategory));
}

let publicPagesUi={data:null,active:"app"};
async function renderPublicWebsites(){
  const root=$("publicWebsites");if(!root)return;
  if(!isGlobalOwner()){root.innerHTML=`<div class="card error">Dieser Bereich ist ausschließlich für Owner verfügbar.</div>`;return;}
  root.innerHTML=`<div class="card">Öffentliche Webseiten werden geladen …</div>`;
  try{
    const r=await fetch("/api/public-pages",{cache:"no-store"}),d=await r.json();if(!r.ok)throw new Error(d.error||"Öffentliche Webseiten konnten nicht geladen werden.");
    publicPagesUi.data=d;
    const pageActive=d.pages.find(x=>x.slug===publicPagesUi.active)||d.pages[0];
    const content=publicPagesUi.active==="masterData"?renderPublicMasterData(d):publicPagesUi.active==="verification"?renderPublicVerification(d):publicPagesUi.active==="review"?renderTikTokReviewHelp(d):renderPublicPageEditor(pageActive);
    root.innerHTML=`
      <div class="title"><div><h2>Administration · Öffentliche Webseiten</h2><p class="hint">Entwürfe bleiben intern. Nur eine ausdrücklich veröffentlichte Fassung ist ohne Anmeldung erreichbar.</p></div></div>
      <div class="card public-warning"><strong>⚠️ Veröffentlichungshinweis</strong><p>Mit Veröffentlichen wird die jeweilige Fassung ohne Anmeldung unter der öffentlichen HTTPS-Domain erreichbar. Keine vertraulichen Inhalte, Tokens oder internen Diagnosedaten eintragen.</p></div>
      <div class="activity-tabs public-page-tabs"><button type="button" class="activity-tab ${publicPagesUi.active==="masterData"?"active":""}" data-public-page="masterData">Stammdaten</button>${d.pages.map(x=>`<button type="button" class="activity-tab ${x.slug===publicPagesUi.active?"active":""}" data-public-page="${esc(x.slug)}">${esc(x.label)} ${x.published?"✓":""}</button>`).join("")}<button type="button" class="activity-tab ${publicPagesUi.active==="verification"?"active":""}" data-public-page="verification">TikTok-Verifizierung</button><button type="button" class="activity-tab ${publicPagesUi.active==="review"?"active":""}" data-public-page="review">TikTok-Prüfung</button></div>
      <div id="publicPageEditor">${content}</div>`;
    root.querySelectorAll("[data-public-page]").forEach(btn=>btn.onclick=()=>{publicPagesUi.active=btn.dataset.publicPage;renderPublicWebsites();});
    wirePublicPagesActions();
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}
function renderPublicMasterData(d){
  const m=d.masterData||{};
  const fields=[
    ["BETREIBER_NAME","Betreiber / Anbieter","Offizieller Name der verantwortlichen Stelle oder Organisation","text"],
    ["BETREIBER_ANSCHRIFT","Anschrift","Vollständige öffentlich vorgesehene Anbieteranschrift","textarea"],
    ["BETREIBER_KONTAKT","Kontakt","Öffentlich vorgesehene Kontaktangaben, z. B. Funktionspostfach und Telefon","textarea"],
    ["VERTRETUNGSBERECHTIGTE_PERSON","Vertretungsberechtigte Person / Stelle","Nur nach organisatorischer Prüfung eintragen","text"],
    ["DATENSCHUTZ_KONTAKT","Datenschutzkontakt","Öffentlich vorgesehener Datenschutzkontakt","textarea"],
    ["RECHTSGRUNDLAGE_TIKTOK","Rechtsgrundlage TikTok","Nur nach fachlicher/rechtlicher Prüfung eintragen; wird nicht automatisch vorgeschlagen","textarea"],
    ["AUFBEWAHRUNGSREGELN","Aufbewahrungs- und Löschregeln","Tatsächlich festgelegte organisatorische Fristen/Regeln","textarea"],
    ["WEITERE_IMPRESSUMSANGABEN","Weitere Impressumsangaben","Weitere tatsächlich erforderliche Anbieterangaben; falls der Platzhalter genutzt wird, ausfüllen","textarea"]
  ];
  return `<div class="card">
    <div class="title compact-title"><div><h3>Zentrale Stammdaten</h3><p class="hint">Diese Werte werden beim Vorschau- und Veröffentlichungsprozess in die Variablen der Seiten eingesetzt.</p></div></div>
    <div class="card public-master-note"><strong>Wichtig</strong><p>Änderungen hier verändern eine bereits veröffentlichte Seite <strong>nicht automatisch</strong>. Die neue Stammdatenfassung wird erst beim nächsten ausdrücklichen Veröffentlichen in die öffentliche Seite übernommen.</p></div>
    <div class="public-master-grid">${fields.map(([key,label,hint,type])=>`<label><span>${esc(label)}</span>${type==="textarea"?`<textarea rows="4" data-master-key="${esc(key)}" placeholder="${esc(hint)}">${esc(m[key]||"")}</textarea>`:`<input data-master-key="${esc(key)}" value="${esc(m[key]||"")}" placeholder="${esc(hint)}">`}<small><code>[[${esc(key)}]]</code></small></label>`).join("")}</div>
    <div class="actions"><button id="publicMasterSave" type="button">Stammdaten speichern</button></div>
    <p class="hint">Zuletzt geändert: ${esc(socialFmt(d.masterDataUpdatedAt))}${d.masterDataUpdatedBy?` · ${esc(d.masterDataUpdatedBy)}`:""}. Private Profildaten werden nicht automatisch übernommen.</p>
  </div>`;
}
function renderPublicPageEditor(page){
  const placeholders=page.validation?.placeholders||[],unresolved=page.validation?.unresolved||[];
  return `<div class="card">
    <div class="title compact-title"><div><h3>${esc(page.label)}</h3><p class="hint">Öffentliche URL: <code>${esc(page.publicUrl)}</code></p></div><span class="diag-badge ${page.published?"ok":"warn"}">${page.published?"veröffentlicht":"Entwurf"}</span></div>
    <label>Titel<input id="publicDraftTitle" value="${esc(page.draftTitle||"")}"></label>
    <label>Inhalt<textarea id="publicDraftContent" rows="24">${esc(page.draftContent||"")}</textarea></label>
    <p class="hint">Sicherer Editor: <code># Überschrift</code>, <code>## Zwischenüberschrift</code>, <code>- Listenpunkt</code> und <code>[Linktext](https://…)</code> oder interne Links wie <code>[Datenschutz](/privacy)</code>. Stammdaten können als Variablen wie <code>[[BETREIBER_NAME]]</code> im Text bleiben. HTML und Skripte werden nicht ausgeführt.</p>
    ${unresolved.length?`<div class="card error"><strong>Noch nicht veröffentlichbar</strong><p>Fehlende Stammdaten: ${unresolved.map(esc).join(", ")}</p><p class="hint">Bitte unter <strong>Stammdaten</strong> ergänzen. Der Seitentext selbst muss dafür nicht geändert werden.</p></div>`:`<div class="diag-all-ok">${placeholders.length?`${placeholders.length} Variable(n) werden aus den Stammdaten aufgelöst.`:"Keine offenen Variablen im aktuellen Entwurf."}</div>`}
    <div class="actions"><button id="publicSaveDraft" type="button">Entwurf speichern</button><a class="btn secondary" href="${esc(page.previewUrl)}" target="_blank" rel="noopener">Geschützte Vorschau</a><button id="publicPublish" type="button" ${page.validation?.ok?"":"disabled"}>Veröffentlichen</button>${page.published?'<button id="publicUnpublish" class="danger" type="button">Veröffentlichung zurücknehmen</button>':""}</div>
    <div class="public-publish-meta"><span>Entwurf: ${esc(socialFmt(page.updatedAt))}${page.updatedBy?` · ${esc(page.updatedBy)}`:""}</span><span>Öffentlich: ${page.published?`${esc(socialFmt(page.publishedAt))}${page.publishedBy?` · ${esc(page.publishedBy)}`:""}`:"nicht veröffentlicht"}</span></div>
  </div>`;
}
function renderPublicVerification(d){
  const v=d.verification||{},published=v.published||null;
  return `<div class="card"><div class="title compact-title"><div><h3>TikTok Website-Verifizierung</h3><p class="hint">Eng begrenzte Bereitstellung genau einer statischen Textdatei. Kein allgemeines Datei-Hosting.</p></div><span class="diag-badge ${published?"ok":"warn"}">${published?"veröffentlicht":"nicht veröffentlicht"}</span></div>
    <label>Dateiname der von TikTok bereitgestellten Signaturdatei<input id="publicVerifyFilename" value="${esc(v.draftFilename||"")}" placeholder="z. B. tiktok-developers-site-verification.txt"></label>
    <label>Dateiinhalt<textarea id="publicVerifyContent" rows="8" placeholder="Inhalt exakt aus der TikTok-Signaturdatei übernehmen">${esc(v.draftContent||"")}</textarea></label>
    <p class="hint">Zugelassen ist ausschließlich eine einfache <code>.txt</code>-Datei ohne Pfad, maximal 10 KB. Der Inhalt wird als <code>text/plain</code> ausgeliefert und niemals ausgeführt.</p>
    <div class="actions"><button id="publicVerifySave" type="button">Entwurf speichern</button><button id="publicVerifyPublish" type="button">Verifizierungsdatei veröffentlichen</button>${published?'<button id="publicVerifyUnpublish" class="danger" type="button">Zurücknehmen</button>':""}</div>
    ${published?`<p>Aktuell öffentlich: <code>${esc((d.baseUrl||"")+`/${published.filename}`)}</code></p>`:""}
  </div>`;
}
function renderTikTokReviewHelp(d){
  const u=d.urls||{},review=d.review||{};
  const row=(label,value)=>`<div class="copy-row"><span>${esc(label)}</span><code>${esc(value||"nicht konfiguriert")}</code><button type="button" class="secondary" data-copy-value="${esc(value||"")}">Kopieren</button></div>`;
  return `<div class="card"><h3>Einrichtungshilfe TikTok</h3>${row("Website URL",u.website)}${row("Terms of Service URL",u.terms)}${row("Privacy Policy URL",u.privacy)}${row("Impressum URL",u.imprint)}${row("OAuth Redirect URI",u.redirect)}</div>
    <div class="card"><h3>Englische Beschreibung für App Review</h3><textarea id="tiktokReviewDescription" rows="9" readonly>${esc(review.description||"")}</textarea><button type="button" class="secondary" data-copy-value="${esc(review.description||"")}">Beschreibung kopieren</button></div>
    <div class="card"><h3>Demo-Video Ablauf</h3><ol>${(review.demoFlow||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ol></div>
    <div class="card"><h3>Technischer Datenschutz-Check</h3><p>Die vorbereiteten Datenschutzhinweise basieren auf der implementierten TikTok-Integration: Profilfelder <code>open_id</code>, Anzeigename und Avatar-URL; Video-ID, Titel/Beschreibung, Dauer, Cover-URL, Share-Link und Veröffentlichungszeit. Token werden serverseitig persistent gespeichert. Social-Media-Thumbnails werden beim Versand kurzfristig heruntergeladen und als Discord-Anhang übertragen, aber nicht zusätzlich als lokale Bilddatei archiviert. Ein Disconnect entfernt keine bereits versendeten Discord-Nachrichten.</p><p class="hint">Rechtsgrundlagen, organisatorische Aufbewahrungsfristen und Betreiberangaben sind bewusst nicht erfunden und bleiben bis zur manuellen Ergänzung als blockierende Platzhalter gekennzeichnet.</p></div>`;
}
function wirePublicPagesActions(){
  const root=$("publicWebsites"),d=publicPagesUi.data;if(!root||!d)return;
  root.querySelectorAll("[data-copy-value]").forEach(btn=>btn.onclick=()=>navigator.clipboard.writeText(btn.dataset.copyValue||"").then(()=>showToast("Kopiert.","success")));
  const slug=publicPagesUi.active;
  $("publicMasterSave")?.addEventListener("click",async()=>{
    const body={};root.querySelectorAll("[data-master-key]").forEach(el=>body[el.dataset.masterKey]=el.value||"");
    const r=await fetch("/api/public-pages/master-data",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await r.json().catch(()=>({}));
    if(!r.ok)return showToast(j.error||"Stammdaten konnten nicht gespeichert werden.","error");
    showToast("Stammdaten gespeichert. Veröffentlichte Seiten bleiben unverändert, bis du sie erneut veröffentlichst.","success");
    renderPublicWebsites();
  });
  $("publicSaveDraft")?.addEventListener("click",async()=>{const r=await fetch("/api/public-pages/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug,title:$("publicDraftTitle")?.value||"",content:$("publicDraftContent")?.value||""})}),j=await r.json().catch(()=>({}));if(!r.ok)return showToast(j.error||"Entwurf konnte nicht gespeichert werden.","error");showToast("Entwurf gespeichert. Veröffentlichung unverändert.","success");renderPublicWebsites();});
  $("publicPublish")?.addEventListener("click",async()=>{if(!(await askAs("publish","Diese Fassung wird danach ohne Anmeldung öffentlich erreichbar. Wirklich veröffentlichen?")))return;const r=await fetch("/api/public-pages/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug})}),j=await r.json().catch(()=>({}));if(!r.ok)return showToast((j.details||[j.error]).join(" · "),"error");showToast("Seite veröffentlicht.","success");renderPublicWebsites();});
  $("publicUnpublish")?.addEventListener("click",async()=>{if(!(await askAs("unpublish","Veröffentlichung wirklich zurücknehmen? Die öffentliche URL liefert anschließend keinen alten Inhalt mehr.")))return;const r=await fetch("/api/public-pages/unpublish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug})}),j=await r.json().catch(()=>({}));if(!r.ok)return showToast(j.error||"Zurücknehmen fehlgeschlagen.","error");showToast("Veröffentlichung zurückgenommen.","success");renderPublicWebsites();});
  $("publicVerifySave")?.addEventListener("click",async()=>{const r=await fetch("/api/public-pages/verification/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:$("publicVerifyFilename")?.value||"",content:$("publicVerifyContent")?.value||""})}),j=await r.json().catch(()=>({}));if(!r.ok)return showToast(j.error||"Speichern fehlgeschlagen.","error");showToast("Verifizierungsentwurf gespeichert.","success");renderPublicWebsites();});
  $("publicVerifyPublish")?.addEventListener("click",async()=>{if(!(await askAs("publish","Verifizierungsdatei wirklich ohne Anmeldung öffentlich bereitstellen?")))return;const r=await fetch("/api/public-pages/verification/publish",{method:"POST"}),j=await r.json().catch(()=>({}));if(!r.ok)return showToast((j.details||[j.error]).join(" · "),"error");showToast("Verifizierungsdatei veröffentlicht.","success");renderPublicWebsites();});
  $("publicVerifyUnpublish")?.addEventListener("click",async()=>{const r=await fetch("/api/public-pages/verification/unpublish",{method:"POST"}),j=await r.json().catch(()=>({}));if(!r.ok)return showToast(j.error||"Zurücknehmen fehlgeschlagen.","error");showToast("Verifizierungsdatei zurückgenommen.","success");renderPublicWebsites();});
}


let followathonRefreshTimer=null,followathonClockTimer=null;
function fmtFaDuration(total){
  total=Math.max(0,Math.round(Number(total)||0));
  const d=Math.floor(total/86400),h=Math.floor((total%86400)/3600),m=Math.floor((total%3600)/60),s=total%60;
  return `${d?`${d}T `:""}${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function fmtFaDate(v){
  if(!v)return "–";
  try{return new Intl.DateTimeFormat("de-DE",{timeZone:"Europe/Berlin",dateStyle:"medium",timeStyle:"medium"}).format(new Date(v))+" Europe/Berlin";}catch{return String(v);}
}
function stopFollowathonRefresh(){if(followathonRefreshTimer){clearInterval(followathonRefreshTimer);followathonRefreshTimer=null;}if(followathonClockTimer){clearInterval(followathonClockTimer);followathonClockTimer=null;}}
async function faRequest(url,options={}){
  const r=await fetch(url,{cache:"no-store",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}}),j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||`HTTP ${r.status}`);return j;
}
async function faAction(action,extra={}){
  try{await faRequest("/api/followathon/action",{method:"POST",body:JSON.stringify({action,...extra})});await renderFollowathon(true);}
  catch(e){showToast(e.message,"error");}
}
// 9.20.0: Subathon (Live-Zentrale). Zählt Abos, Geschenkabos, Bits und optional Follows; beim Start endet ein laufender Followathon.
let subathonRefreshTimer=null,subathonClockTimer=null;
function stopSubathonRefresh(){if(subathonRefreshTimer){clearInterval(subathonRefreshTimer);subathonRefreshTimer=null;}if(subathonClockTimer){clearInterval(subathonClockTimer);subathonClockTimer=null;}}
async function saAction(action,extra={}){
  try{await faRequest("/api/subathon/action",{method:"POST",body:JSON.stringify({action,...extra})});await renderSubathon(true);}
  catch(e){showToast(e.message,"error");}
}
const SA_KIND_LABEL={sub:"Abo",gift:"Geschenkabos",bits:"Bits",follow:"Follow"};
async function renderSubathon(silent=false){
  const root=$("subathon");if(!root||!hasCapability("twitch.subathon.view"))return;
  let data;try{data=await faRequest("/api/subathon");}catch(e){root.innerHTML=`<div class="card error">Subathon konnte nicht geladen werden: ${esc(e.message)}</div>`;return;}
  const e=data.event,t=data.twitch||{},acct=t.channelAccount||{},con=t.connection||{},subs=t.subscriptions||{},canEdit=hasCapability("twitch.subathon.edit"),owner=isGlobalOwner();
  const missing=acct.missingScopes||[];
  const subsOk=Object.values(subs).length>0&&Object.values(subs).every(x=>x.ok);
  const accName=acct.displayName||"Kanal-Konto";
  const connText=!con.moduleOn?"Modul ist ausgeschaltet":!acct.valid?"Kanal-Konto nicht verbunden":missing.length?"Rechte fehlen":con.connected?(subsOk?"verbunden, alle Abos aktiv":"verbunden, Abos nicht vollständig"):(con.state==="reconnecting"?"verbindet neu …":"wird verbunden …");
  const logs=e?.log||[],tl=e?.tallies||{},rates=e?.rates||{},cnt=e?.counting||{};
  const lim=v=>v==null?"keine":fmtFaDuration(v);
  root.innerHTML=`
    <div class="title"><div><h2>Subathon</h2><p class="hint">Abos, geschenkte Abos, Bits und (optional) Follows verlängern den serverseitigen Countdown. Beim Start wird ein laufender Followathon beendet; solange der Subathon läuft, ist der Followathon gesperrt.</p></div></div>
    <div class="card ${subsOk&&!missing.length?"":"warning-card"}"><h3>Twitch-Verbindung</h3>
      <p class="hint">Zuständig ist das <strong>Kanal-Konto</strong>: <strong>${esc(accName)}</strong>${acct.login?` (@${esc(acct.login)})`:""}. Abos und Bits kann nur der Kanalinhaber freigeben. Unter <em>Administration → Verbindungen</em> bei diesem Konto auf <strong>„Neu autorisieren“</strong> klicken, bei Twitch als Kanalinhaber anmelden und die Rechte <code>channel:read:subscriptions</code> und <code>bits:read</code> bestätigen.</p>
      <p><strong>Stand:</strong> ${esc(connText)}${con.lastError?` <span class="hint">· ${esc(con.lastError)}</span>`:""}</p>
      ${missing.length?`<p class="hint">Fehlende Rechte am Kanal-Konto: <strong>${esc(missing.join(", "))}</strong></p>`:""}
      <div class="status-grid">${Object.entries(subs).map(([k,v])=>`<div class="status-card"><span>${esc(k)}</span><strong>${v.ok?"✅ aktiv":"❌ nicht aktiv"}</strong>${v.ok?"":`<small>${v.status?`Twitch-Antwort ${esc(v.status)}`:"noch nicht abonniert"}</small>`}</div>`).join("")||'<p class="hint">Noch keine Abos angelegt (die Verbindung startet, sobald das Kanal-Konto die Rechte erteilt hat).</p>'}</div>
      ${canEdit?'<div class="row wrap"><button id="saCheck">Verbindung prüfen</button></div>':""}
    </div>
    ${e?`
      <div class="fa-hero card">
        <div><span class="hint">${esc(e.name)}</span><div class="fa-clock" id="saClock">${fmtFaDuration(e.remainingSeconds)}</div><div class="hint">Status: <strong>${esc(e.status)}</strong> · Erwartetes Ende: ${e.status==="paused"?"pausiert":esc(fmtFaDate(e.expectedEndAt))}</div></div>
        <div class="fa-metrics">
          <div><strong>${Number(tl.subs||0)}</strong><span>Abos</span></div>
          <div><strong>${Number(tl.gifts||0)}</strong><span>Geschenkabos</span></div>
          <div><strong>${Number(tl.bits||0)}</strong><span>Bits</span></div>
          <div><strong>${Number(tl.follows||0)}</strong><span>Follows</span></div>
          <div><strong>${fmtFaDuration(e.creditedNetSeconds)}</strong><span>gutgeschriebene Zeit netto</span></div>
        </div>
      </div>
      <div class="card"><h3>Regeln dieses Events</h3><div class="fa-grid">
        <div><span>Startdauer</span><strong>${fmtFaDuration(e.startDurationSeconds)}</strong></div>
        <div><span>Maximale Restzeit</span><strong>${lim(e.maxRemainingSeconds)}</strong></div>
        <div><span>Maximale Gesamtdauer</span><strong>${lim(e.maxTotalSeconds)}</strong></div>
        <div><span>Tageslimit (Zeitgutschrift)</span><strong>${lim(e.dailyLimitSeconds)}</strong></div>
        <div><span>Abo Stufe 1 / 2 / 3</span><strong>${cnt.subs?`+${rates.sub1||0}s / +${rates.sub2||0}s / +${rates.sub3||0}s`:"aus"}</strong></div>
        <div><span>Geschenkabos</span><strong>${cnt.gifts?"je Stufe wie Abos":"aus"}</strong></div>
        <div><span>Bits (je 100)</span><strong>${cnt.bits?`+${rates.bitsPer100||0}s`:"aus"}</strong></div>
        <div><span>Follows</span><strong>${cnt.follows?`+${rates.follow||0}s`:"aus"}</strong></div>
      </div></div>
      ${canEdit?`<div class="card"><h3>Steuerung</h3><div class="row wrap">
        ${e.status==="draft"?'<button id="saStart">Start</button>':''}
        ${e.status==="running"?'<button id="saPause">Countdown pausieren</button>':''}
        ${e.status==="paused"?'<button id="saResume">Fortsetzen</button>':''}
        ${e.status!=="ended"?'<button id="saEnd" class="danger">Beenden</button>':''}
      </div><hr><div class="row wrap"><input id="saAdjustSeconds" type="number" min="1" value="60" placeholder="Sekunden"><input id="saAdjustReason" placeholder="Grund / Protokollnotiz"><button id="saAdd">Zeit hinzufügen</button><button id="saSub">Zeit abziehen</button></div></div>`:""}
      <div class="card"><div class="title"><h3>Ereignisprotokoll</h3><span class="hint">Zeitpunkt · Art · Entscheidung · tatsächlich gutgeschriebene Zeit</span></div><div class="fa-log">${logs.length?logs.map(x=>`<div class="fa-log-row"><div><strong>${esc(x.userName||x.source||"System")}</strong> <span class="hint">${esc(SA_KIND_LABEL[x.kind]||"")}${x.detail?` · ${esc(x.detail)}`:""}</span><br><span class="hint">${esc(fmtFaDate(x.at))} · ${esc(x.decision)} · ${esc(x.reason||"")}</span></div><strong>${Number(x.creditedSeconds||0)>0?"+":""}${Number(x.creditedSeconds||0)}s</strong></div>`).join(""):'<p class="hint">Noch keine Einträge.</p>'}</div></div>
      <div class="card"><h3>OBS-Browserquelle</h3><p><code>${esc(data.overlayUrl||"/subathon/overlay")}</code></p><p class="hint">Als Browserquelle in OBS einfügen; der Countdown läuft dort sekundengenau mit.</p></div>
      ${canEdit?`<div class="card"><h3>Geschützter Testmodus</h3><p class="hint">Simuliert die Zeitgutschrift (inklusive Limits), verändert aber den echten Countdown nicht. Echte Abos und Bits lassen sich nur im Livebetrieb prüfen.</p><div class="row wrap"><select id="saTestKind"><option value="sub">Abo</option><option value="gift">Geschenkabos</option><option value="bits">Bits</option><option value="follow">Follow</option></select><select id="saTestTier"><option value="1000">Stufe 1</option><option value="2000">Stufe 2</option><option value="3000">Stufe 3</option></select><input id="saTestAmount" type="number" min="1" value="5" aria-label="Anzahl Geschenkabos bzw. Bits"><button id="saTest">Simulieren</button></div><div id="saTestResult" class="hint"></div></div>`:""}
    `:`<div class="card"><h3>Noch kein Subathon angelegt</h3><p class="hint">Ein Event wird zuerst konfiguriert und anschließend separat gestartet.</p></div>`}
    ${owner?(()=>{
      const live=e&&(e.status==="running"||e.status==="paused");
      if(live)return `<div class="card"><h3>Einstellungen gesperrt</h3><p class="hint">Regeln und Overlay-Darstellung lassen sich nur ändern, solange der Subathon noch nicht gestartet ist. Zum Ändern den Subathon beenden und ein neues Event anlegen.</p></div>`;
      const d=e&&e.status==="draft"?e:null,o=d?.overlay||{},r=d?.rates||{},c=d?.counting||{subs:true,gifts:true,bits:true,follows:false};
      const num=(v,def)=>v==null?def:v,mins=(v)=>v==null?"":Math.round(v/60),hrs=(v)=>v==null?"":Math.round(v/3600);
      return `<div class="card"><h3>${d?"Einstellungen bearbeiten":(e?"Neues Event anlegen":"Subathon anlegen")}</h3><p class="hint">${d?"Das Event ist noch nicht gestartet: Regeln und Overlay-Darstellung können jetzt geändert werden. Ab dem Start sind sie gesperrt.":"Ein laufendes oder pausiertes Event muss vorher beendet werden."} Sekundenwerte sind Zeit, die ein einzelnes Ereignis gutschreibt. Ein Logo für das Overlay wird unter Administration → Profil & Branding hochgeladen (Bildplatz „Subathon-Logo“).</p>
      <div class="form-grid fa-form">
        <label>Name<input id="saName" value="${esc(d?d.name:(e?.status==='ended'?`${e.name} 2`:'Subathon'))}"></label>
        <label>Startdauer (Minuten)<input id="saStartMinutes" type="number" min="1" value="${d?Math.round(d.startDurationSeconds/60):120}"></label>
        <label>Maximale Restzeit (Minuten, optional)<input id="saMaxRemaining" type="number" min="1" placeholder="keine" value="${mins(d?.maxRemainingSeconds)}"></label>
        <label>Maximale Gesamtdauer (Stunden, optional)<input id="saMaxTotal" type="number" min="1" placeholder="keine" value="${hrs(d?.maxTotalSeconds)}"></label>
        <label>Tageslimit Zeitgutschrift (Minuten, optional)<input id="saDailyLimit" type="number" min="1" placeholder="keins" value="${mins(d?.dailyLimitSeconds)}"></label>
        <label>Sekunden je Abo Stufe 1<input id="saRateSub1" type="number" min="0" value="${num(r.sub1,300)}"></label>
        <label>Sekunden je Abo Stufe 2<input id="saRateSub2" type="number" min="0" value="${num(r.sub2,600)}"></label>
        <label>Sekunden je Abo Stufe 3<input id="saRateSub3" type="number" min="0" value="${num(r.sub3,1500)}"></label>
        <label>Sekunden je 100 Bits<input id="saRateBits" type="number" min="0" value="${num(r.bitsPer100,60)}"></label>
        <label>Sekunden je Follow<input id="saRateFollow" type="number" min="0" value="${num(r.follow,30)}"></label>
        <label class="checkline"><input id="saCountSubs" type="checkbox" ${c.subs?"checked":""}> Abos und Resubs zählen</label>
        <label class="checkline"><input id="saCountGifts" type="checkbox" ${c.gifts?"checked":""}> Geschenkte Abos zählen</label>
        <label class="checkline"><input id="saCountBits" type="checkbox" ${c.bits?"checked":""}> Bits zählen</label>
        <label class="checkline"><input id="saCountFollows" type="checkbox" ${c.follows?"checked":""}> Follows zählen</label>
        <label>Overlay-Beschriftung<input id="saOverlayLabel" value="${esc(o.label||"SUBATHON")}"></label>
        <label>Schriftgröße<input id="saFontSize" type="number" min="24" max="180" value="${num(o.fontSize,72)}"></label>
        <label>Textfarbe<input id="saTextColor" type="color" value="${esc(o.textColor||"#ffffff")}"></label>
        <label>Akzentfarbe<input id="saAccentColor" type="color" value="${esc(o.accentColor||"#9146ff")}"></label>
        <label class="checkline"><input id="saShowNames" type="checkbox" ${o.showNames?"checked":""}> Namen im Overlay anzeigen</label>
      </div><div class="row wrap">${d?'<button id="saUpdate">Einstellungen speichern</button>':'<button id="saCreate">Event anlegen</button>'}${e?'<button id="saReset" class="danger">Subathon zurücksetzen</button>':''}</div></div>`;
    })():""}
  `;
  $("saStart")?.addEventListener("click",async()=>{if(await askConfirm({title:"Subathon starten",text:"Ein laufender oder pausierter Followathon wird dabei beendet. Fortfahren?",confirmLabel:"STARTEN",cancelLabel:"ABBRECHEN"}))saAction("start");});
  $("saCheck")?.addEventListener("click",async()=>{try{await faRequest("/api/subathon/check",{method:"POST",body:"{}"});showToast("Verbindung wird geprüft.","success");setTimeout(()=>renderSubathon(true),2500);}catch(err){showToast(err.message,"error");}});
  $("saPause")?.addEventListener("click",()=>saAction("pause"));
  $("saResume")?.addEventListener("click",()=>saAction("resume"));
  $("saEnd")?.addEventListener("click",async()=>{if(await askAs("end","Subathon wirklich beenden? Spätere Ereignisse starten den Timer nicht erneut."))saAction("end");});
  $("saAdd")?.addEventListener("click",()=>saAction("adjust",{seconds:Number($("saAdjustSeconds")?.value||0),direction:"add",reason:$("saAdjustReason")?.value||"Manuell hinzugefügt"}));
  $("saSub")?.addEventListener("click",()=>saAction("adjust",{seconds:Number($("saAdjustSeconds")?.value||0),direction:"subtract",reason:$("saAdjustReason")?.value||"Manuell abgezogen"}));
  $("saTest")?.addEventListener("click",async()=>{try{const kind=$("saTestKind").value,n=Number($("saTestAmount").value||1);const j=await faRequest("/api/subathon/test",{method:"POST",body:JSON.stringify({kind,tier:$("saTestTier").value,total:n,bits:n})});$("saTestResult").textContent=`${j.decision}${j.creditedSeconds!=null?` · angefragt ${j.requestedSeconds}s, gutgeschrieben ${j.creditedSeconds}s`:""} · ${j.note||""}`;}catch(err){showToast(err.message,"error");}});
  $("saReset")?.addEventListener("click",async()=>{if(await askAs("reset","Subathon zurücksetzen? Das aktuelle Event wird beendet und aus der Anzeige entfernt (Verlauf bleibt gespeichert).")){try{await faRequest("/api/subathon/reset",{method:"POST",body:"{}"});renderSubathon(true);}catch(err){showToast(err.message,"error");}}});
  const saBody=()=>{
    const opt=(id,mul)=>{const v=$(id)?.value;return v?Number(v)*mul:null;};
    return {name:$("saName")?.value,startDurationSeconds:Number($("saStartMinutes")?.value||0)*60,maxRemainingSeconds:opt("saMaxRemaining",60),maxTotalSeconds:opt("saMaxTotal",3600),dailyLimitSeconds:opt("saDailyLimit",60),
      rates:{sub1:Number($("saRateSub1")?.value||0),sub2:Number($("saRateSub2")?.value||0),sub3:Number($("saRateSub3")?.value||0),bitsPer100:Number($("saRateBits")?.value||0),follow:Number($("saRateFollow")?.value||0)},
      counting:{subs:$("saCountSubs")?.checked,gifts:$("saCountGifts")?.checked,bits:$("saCountBits")?.checked,follows:$("saCountFollows")?.checked},
      overlay:{label:$("saOverlayLabel")?.value,fontSize:Number($("saFontSize")?.value||72),textColor:$("saTextColor")?.value,accentColor:$("saAccentColor")?.value,showNames:$("saShowNames")?.checked}};
  };
  $("saCreate")?.addEventListener("click",async()=>{try{await faRequest("/api/subathon/event",{method:"POST",body:JSON.stringify(saBody())});showToast("Subathon angelegt.","success");renderSubathon(true);}catch(err){showToast(err.message,"error");}});
  $("saUpdate")?.addEventListener("click",async()=>{try{await faRequest("/api/subathon/event/update",{method:"POST",body:JSON.stringify(saBody())});showToast("Einstellungen gespeichert.","success");renderSubathon(true);}catch(err){showToast(err.message,"error");}});
  stopSubathonRefresh();
  if(activeNavTab==="subathon"){
    const serverOffset=new Date(data.serverNow||Date.now()).getTime()-Date.now(),expected=e?.expectedEndAt?new Date(e.expectedEndAt).getTime():null,pausedRemaining=Number(e?.remainingSeconds||0);
    subathonClockTimer=setInterval(()=>{const el=$("saClock");if(!el||!e)return;const r=e.status==="running"&&expected?Math.max(0,(expected-(Date.now()+serverOffset))/1000):pausedRemaining;el.textContent=fmtFaDuration(r);},250);
    subathonRefreshTimer=setInterval(()=>{
      if(activeNavTab!=="subathon")return;
      const a=document.activeElement;if(a&&root.contains(a)&&["INPUT","TEXTAREA","SELECT"].includes(a.tagName))return;
      renderSubathon(true);
    },5000);
  }
}
async function renderFollowathon(silent=false){
  const root=$("followathon");if(!root||!hasCapability("twitch.followathon.view"))return;
  let data;try{data=await faRequest("/api/followathon");}catch(e){root.innerHTML=`<div class="card error">Followathon konnte nicht geladen werden: ${esc(e.message)}</div>`;return;}
  const e=data.event,t=data.twitch||{},acct=t.account||{},es=t.eventSub||{},canEdit=hasCapability("twitch.followathon.edit"),owner=isGlobalOwner();
  const gap=es.possibleGap?`<div class="warning-box"><strong>Mögliche Zähllücke:</strong> ${esc(fmtFaDate(es.possibleGap.from))}${es.possibleGap.to?` bis ${esc(fmtFaDate(es.possibleGap.to))}`:" bis zur Wiederverbindung"}. Twitch garantiert bei einer getrennten EventSub-Verbindung keine nachträgliche Zustellung aller verpassten Follows.</div>`:"";
  const twitchOk=acct.valid&&es.connected&&es.subscription?.ok;
  const held=e?.held||[],logs=e?.log||[];
  root.innerHTML=`
    <div class="title"><div><h2>Followathon</h2><p class="hint">Echte Twitch-Follows verlängern den serverseitigen Countdown. Abos, Bits und Spenden werden nicht ausgewertet.</p></div></div>
    <div class="status-grid followathon-status">
      <div class="status-card"><span>Twitch-Account</span><strong>${esc(acct.authorizedLogin||"nicht verbunden")}</strong><small>${acct.valid?"✅ moderator:read:followers vorhanden":"⚠️ Autorisierung prüfen"}</small></div>
      <div class="status-card"><span>EventSub channel.follow v2</span><strong>${es.connected&&es.subscription?.ok?"✅ aktiv":"⚠️ nicht bereit"}</strong><small>${esc(es.state||"unbekannt")}</small></div>
      <div class="status-card"><span>OBS-Overlay</span><strong>HTTPS</strong><small>${esc(data.overlayUrl||"/followathon/overlay")}</small></div>
    </div>
    ${!twitchOk?`<div class="card warning-card"><strong>Twitch-Verbindung prüfen</strong><p>Der Followathon benötigt den Haupt-Bot (${esc(botNameFor("main"))}) als technischen Moderator mit <code>moderator:read:followers</code> und eine aktive <code>channel.follow</code>-v2-Subscription.</p><button id="faConnections">Twitch-Verbindungen öffnen</button></div>`:""}
    ${gap}
    ${e?`
      <div class="fa-hero card">
        <div><span class="hint">${esc(e.name)}</span><div class="fa-clock" id="faClock">${fmtFaDuration(e.remainingSeconds)}</div><div class="hint">Status: <strong>${esc(e.status)}</strong> · Erwartetes Ende: ${e.status==="paused"?"pausiert":esc(fmtFaDate(e.expectedEndAt))}</div></div>
        <div class="fa-metrics">
          <div><strong>${Number(e.followCount||0)}</strong><span>gezählte Follows</span></div>
          <div><strong>${fmtFaDuration(e.creditedNetSeconds)}</strong><span>gutgeschriebene Zeit netto</span></div>
          <div><strong>${e.creditAcceptance?"AN":"AUS"}</strong><span>Follow-Gutschriften</span></div>
        </div>
      </div>
      <div class="card"><h3>Grenzen</h3><div class="fa-grid"><div><span>Startdauer</span><strong>${fmtFaDuration(e.startDurationSeconds)}</strong></div><div><span>Zeit pro Follow</span><strong>+${fmtFaDuration(e.secondsPerFollow)}</strong></div><div><span>Maximale Restzeit</span><strong>${e.maxRemainingSeconds==null?"keine":fmtFaDuration(e.maxRemainingSeconds)}</strong></div><div><span>Feste späteste Endzeit</span><strong>${e.hardEndAt?esc(fmtFaDate(e.hardEndAt)):"keine"}</strong></div></div><p class="hint">Beide Grenzen gelten gleichzeitig. Eine Gutschrift wird an der zuerst wirksamen Grenze gekürzt. Eine Pause verschiebt die feste späteste Endzeit nicht.</p></div>
      ${canEdit?`<div class="card"><h3>Steuerung</h3><div class="row wrap">
        ${e.status==="draft"?'<button id="faStart">Start</button>':''}
        ${e.status==="running"?'<button id="faPause">Countdown pausieren</button>':''}
        ${e.status==="paused"?'<button id="faResume">Fortsetzen</button>':''}
        ${e.status!=="ended"?'<button id="faEnd" class="danger">Beenden</button>':''}
        ${e.status!=="ended"?`<button id="faAccept" class="${e.creditAcceptance?"danger":""}">${e.creditAcceptance?"Follow-Gutschriften stoppen":"Follow-Gutschriften annehmen"}</button>`:''}
      </div><hr><div class="row wrap"><input id="faAdjustSeconds" type="number" min="1" value="60" placeholder="Sekunden"><input id="faAdjustReason" placeholder="Grund / Protokollnotiz"><button id="faAdd">Zeit hinzufügen</button><button id="faSub">Zeit abziehen</button></div></div>`:""}
      ${held.length?`<div class="card"><h3>Zur Prüfung zurückgehalten</h3><p class="hint">Eine Häufung ist nur ein Auffälligkeitssignal; auch echte Raids können viele Follows auslösen.</p><div class="fa-log">${held.map(h=>`<div class="fa-log-row"><div><strong>${esc(h.userName||h.userId)}</strong><span>${esc(fmtFaDate(h.followedAt))}</span><small>${esc(h.reason||"")}</small></div>${canEdit?`<div><button data-fa-approve="${esc(h.id)}">Gutschreiben</button><button class="danger" data-fa-reject="${esc(h.id)}">Ablehnen</button></div>`:""}</div>`).join("")}</div></div>`:""}
      ${canEdit?`<div class="card"><h3>Gutschriften eines Zeitraums zurücknehmen</h3><p class="hint">Für einen verdächtigen Zeitraum können bereits gutgeschriebene Follows gesammelt korrigiert werden. Betroffene Konten bleiben als bereits berücksichtigt markiert.</p><div class="row wrap"><label>Von – Europe/Berlin <input id="faRetractFrom" type="datetime-local"></label><label>Bis – Europe/Berlin <input id="faRetractTo" type="datetime-local"></label><button id="faRetractRange" class="danger">Zeitraum zurücknehmen</button></div></div>`:""}
      <div class="card"><div class="title"><h3>Ereignisprotokoll</h3><span class="hint">Zeitpunkt · Quelle · Entscheidung · tatsächlich gutgeschriebene Zeit</span></div><div class="fa-log">${logs.length?logs.map(x=>`<div class="fa-log-row"><div><strong>${esc(x.userName||x.source||"System")}</strong><span>${esc(fmtFaDate(x.at))} · ${esc(x.source||"")} · ${esc(x.decision||"")}</span><small>${esc(x.reason||"")}</small></div><div><strong>${Number(x.creditedSeconds||0)>=0?"+":""}${fmtFaDuration(Math.abs(Number(x.creditedSeconds||0)))}</strong>${canEdit&&Number(x.creditedSeconds)>0&&!x.retractedAt?`<button class="link danger" data-fa-retract="${esc(x.id)}">zurücknehmen</button>`:""}${x.retractedAt?'<small>zurückgenommen</small>':''}</div></div>`).join(""):'<p class="hint">Noch keine Einträge.</p>'}</div></div>
      ${canEdit?`<div class="card"><h3>Geschützter Testmodus</h3><p class="hint">Simuliert die Entscheidung, verändert aber weder echte Followerstatistiken noch produktive Gutschriften.</p><div class="row"><input id="faTestName" value="TestFollower"><button id="faTest">Follow simulieren</button></div><div id="faTestResult" class="hint"></div></div>`:""}
    `:`<div class="card"><h3>Noch kein Followathon angelegt</h3><p class="hint">Ein Event wird zuerst konfiguriert und anschließend separat gestartet.</p></div>`}
    ${owner?`<div class="card"><h3>${e?"Neues Event anlegen":"Followathon anlegen"}</h3><p class="hint">Ein laufendes oder pausiertes Event muss vorher beendet werden. Die feste Endzeit wird als Europe/Berlin eingegeben und intern in UTC gespeichert.</p>
      <div class="form-grid fa-form">
        <label>Name<input id="faName" value="${esc(e?.status==='ended'?`${e.name} 2`:'Followathon')}"></label>
        <label>Startdauer (Minuten)<input id="faStartMinutes" type="number" min="1" value="120"></label>
        <label>Sekunden pro Follow<input id="faPerFollow" type="number" min="1" value="60"></label>
        <label>Maximale Restzeit (Minuten, optional)<input id="faMaxMinutes" type="number" min="1" placeholder="keine"></label>
        <label>Feste späteste Endzeit – Europe/Berlin (optional)<input id="faHardEnd" type="datetime-local"></label>
        <label>Auffälligkeitsschwelle (Follows)<input id="faThreshold" type="number" min="2" value="15"></label>
        <label>Prüffenster (Sekunden)<input id="faWindow" type="number" min="10" value="60"></label>
        <label>Overlay-Beschriftung<input id="faOverlayLabel" value="FOLLOWATHON"></label>
        <label>Schriftgröße<input id="faFontSize" type="number" min="24" max="180" value="72"></label>
        <label>Textfarbe<input id="faTextColor" type="color" value="#fab70a"></label>
        <label>Akzentfarbe<input id="faAccentColor" type="color" value="#fab70a"></label>
        <label class="checkline"><input id="faShowNames" type="checkbox"> Followernamen im Overlay anzeigen</label>
      </div><div class="row wrap"><button id="faCreate">Event anlegen</button>${e?'<button id="faReset" class="danger">Followathon zurücksetzen</button>':''}</div></div>`:""}
    <div class="card"><h3>OBS-Browserquelle</h3><p><code>${esc(data.overlayUrl||"/followathon/overlay")}</code></p><p class="hint">Als Browserquelle per HTTPS einfügen. Empfohlen: 1920 × 300, benutzerdefiniertes CSS leer lassen. Das Overlay ist rein lesend; OBS schließen oder neu laden verändert den Timer nicht.</p></div>`;

  $("faConnections")?.addEventListener("click",()=>openNavTab("connections"));
  $("faStart")?.addEventListener("click",()=>faAction("start"));
  $("faPause")?.addEventListener("click",()=>faAction("pause"));
  $("faResume")?.addEventListener("click",()=>faAction("resume"));
  $("faEnd")?.addEventListener("click",async()=>{if(await askAs("end","Followathon wirklich beenden? Spätere Follows starten den Timer nicht erneut."))faAction("end");});
  $("faAccept")?.addEventListener("click",()=>faAction("acceptance",{enabled:!e?.creditAcceptance}));
  $("faAdd")?.addEventListener("click",()=>faAction("adjust",{seconds:Number($("faAdjustSeconds")?.value||0),direction:"add",reason:$("faAdjustReason")?.value||"Manuell hinzugefügt"}));
  $("faSub")?.addEventListener("click",()=>faAction("adjust",{seconds:Number($("faAdjustSeconds")?.value||0),direction:"subtract",reason:$("faAdjustReason")?.value||"Manuell abgezogen"}));
  root.querySelectorAll("[data-fa-approve]").forEach(b=>b.addEventListener("click",async()=>{try{await faRequest("/api/followathon/review",{method:"POST",body:JSON.stringify({heldId:b.dataset.faApprove,approve:true})});renderFollowathon(true);}catch(e){showToast(e.message,"error");}}));
  root.querySelectorAll("[data-fa-reject]").forEach(b=>b.addEventListener("click",async()=>{try{await faRequest("/api/followathon/review",{method:"POST",body:JSON.stringify({heldId:b.dataset.faReject,approve:false})});renderFollowathon(true);}catch(e){showToast(e.message,"error");}}));
  root.querySelectorAll("[data-fa-retract]").forEach(b=>b.addEventListener("click",async()=>{if(!(await askAs("revert","Diese Follow-Gutschrift nachvollziehbar zurücknehmen? Das Konto bleibt für dieses Event als bereits berücksichtigt markiert.")))return;try{await faRequest("/api/followathon/retract",{method:"POST",body:JSON.stringify({logId:b.dataset.faRetract})});renderFollowathon(true);}catch(e){showToast(e.message,"error");}}));
  $("faRetractRange")?.addEventListener("click",async()=>{
    const from=$("faRetractFrom")?.value,to=$("faRetractTo")?.value;if(!from||!to)return showToast("Bitte Von und Bis angeben.","error");
    if(!(await askAs("revert","Alle gutgeschriebenen Follows in diesem Zeitraum zurücknehmen?")))return;
    try{const j=await faRequest("/api/followathon/retract",{method:"POST",body:JSON.stringify({fromLocal:from,toLocal:to})});showToast(`${j.result?.count||0} Gutschrift(en) korrigiert.`,"success");renderFollowathon(true);}catch(e){showToast(e.message,"error");}
  });
  $("faReset")?.addEventListener("click",async()=>{if(!(await askAs("reset","Followathon zurücksetzen? Das aktuelle Event wird beendet und aus der aktiven Ansicht entfernt; Protokolldaten bleiben bis zur Löschfrist erhalten.")))return;try{await faRequest("/api/followathon/reset",{method:"POST",body:"{}"});showToast("Followathon zurückgesetzt.","success");renderFollowathon(true);}catch(e){showToast(e.message,"error");}});
  $("faTest")?.addEventListener("click",async()=>{try{const j=await faRequest("/api/followathon/test",{method:"POST",body:JSON.stringify({userName:$("faTestName")?.value||"TestFollower"})});$("faTestResult").textContent=`Ergebnis: ${j.decision}${j.creditedSeconds!=null?` · ${j.creditedSeconds} Sekunden`:""}. ${j.note||""}`;}catch(e){showToast(e.message,"error");}});
  $("faCreate")?.addEventListener("click",async()=>{try{
    const max=$("faMaxMinutes")?.value;const body={name:$("faName")?.value,startDurationSeconds:Number($("faStartMinutes")?.value||0)*60,secondsPerFollow:Number($("faPerFollow")?.value||60),maxRemainingSeconds:max?Number(max)*60:null,hardEndLocal:$("faHardEnd")?.value||null,anomalyThreshold:Number($("faThreshold")?.value||15),anomalyWindowSeconds:Number($("faWindow")?.value||60),overlay:{label:$("faOverlayLabel")?.value,fontSize:Number($("faFontSize")?.value||72),textColor:$("faTextColor")?.value,accentColor:$("faAccentColor")?.value,showFollowerNames:$("faShowNames")?.checked===true}};
    await faRequest("/api/followathon/event",{method:"POST",body:JSON.stringify(body)});showToast("Followathon angelegt.","success");renderFollowathon(true);
  }catch(e){showToast(e.message,"error");}});
  stopFollowathonRefresh();
  if(activeNavTab==="followathon"){
    const serverOffset=new Date(data.serverNow||Date.now()).getTime()-Date.now(),expected=e?.expectedEndAt?new Date(e.expectedEndAt).getTime():null,pausedRemaining=Number(e?.remainingSeconds||0);
    followathonClockTimer=setInterval(()=>{const el=$("faClock");if(!el||!e)return;const r=e.status==="running"&&expected?Math.max(0,(expected-(Date.now()+serverOffset))/1000):pausedRemaining;el.textContent=fmtFaDuration(r);},250);
    followathonRefreshTimer=setInterval(()=>{
      if(activeNavTab!=="followathon")return;
      const a=document.activeElement;if(a&&root.contains(a)&&["INPUT","TEXTAREA","SELECT"].includes(a.tagName))return;
      renderFollowathon(true);
    },5000);
  }
}

async function renderFollowerAlert(){
  const root=$("followerAlert");if(!root||!hasCapability("twitch.followathon.view"))return;
  try{
    const r=await fetch("/api/follower-alert",{cache:"no-store"}),data=await r.json();
    if(!r.ok)throw Error(data.error||"Follower-Alert konnte nicht geladen werden.");
    const enabled=data.config?.enabled===true,canEdit=hasCapability("twitch.followathon.edit");
    root.innerHTML=`<div class="title"><h2>Follower-Alert</h2><p>Eigene, transparente Browserquelle für neue Twitch-Follower. Nur der Nickname wird sanft eingeblendet.</p></div>
      <div class="card"><h3>Live-Overlay</h3>
        <label class="checkline"><input id="followerAlertEnabled" type="checkbox" ${enabled?"checked":""} ${canEdit?"":"disabled"}> Follower-Alert aktivieren</label>
        <p class="hint">Der Schalter wird persistent gespeichert und bleibt nach einem Neustart erhalten. EventSub nutzt die bestehende Follow-Verbindung.</p>
        <label>Anzeigedauer in Sekunden (5–20)<input id="followerAlertDuration" type="number" min="5" max="20" step="1" value="${Number(data.config?.durationSeconds)||7}" ${canEdit?"":"disabled"}></label>
        <div class="row wrap"><button id="followerAlertSave" ${canEdit?"":"disabled"}>Einstellung speichern</button></div></div>
      <div class="card"><h3>OBS-Browserquelle</h3>
        <p><code id="followerAlertUrl">${esc(data.overlayUrl||"/follower-alert/overlay")}</code></p>
        <p class="hint">In OBS als Browserquelle hinzufügen (empfohlen: 1000 × 240). Neues Banner ohne Rangabzeichen: Grafik, Überschrift und Linien sind statisch; nur der Nickname wird sanft ein- und ausgeblendet. Keine Nightbot-Abhängigkeit.</p>
        <div class="row wrap"><button id="followerAlertPreview">Vorschau öffnen</button></div></div>
      <div class="card"><h3>Test auslösen</h3><p class="hint">Löst ausschließlich das Overlay aus und erzeugt keinen echten Follow. Funktioniert auch bei ausgeschaltetem Alert.</p>
        <label>Test-Nickname<input id="followerAlertTestName" maxlength="48" value="${esc(bt("testName","TestUser"))}" ${canEdit?"":"disabled"}></label>
        <div class="row wrap"><button id="followerAlertTest" ${canEdit?"":"disabled"}>Test-Follow senden</button></div></div>`;
    $("followerAlertSave")?.addEventListener("click",async()=>{
      try{const result=await fetch("/api/follower-alert",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:$("followerAlertEnabled").checked,durationSeconds:Number($("followerAlertDuration").value)})}),j=await result.json();if(!result.ok)throw Error(j.error||"Speichern fehlgeschlagen");showToast("Follower-Alert-Einstellung gespeichert.","success");renderFollowerAlert();}catch(e){showToast(e.message,"error");}
    });
    $("followerAlertTest")?.addEventListener("click",async()=>{
      try{const result=await fetch("/api/follower-alert/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userName:$("followerAlertTestName").value})}),j=await result.json();if(!result.ok)throw Error(j.error||"Test fehlgeschlagen");showToast("Test-Follow an alle geöffneten Overlay-Quellen gesendet.","success");}catch(e){showToast(e.message,"error");}
    });
    $("followerAlertPreview")?.addEventListener("click",()=>window.open(data.overlayUrl||"/follower-alert/overlay","_blank","noopener,noreferrer"));
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

// 9.27.0: Chat-Overlay (Live-Zentrale). Einstellungen, OBS-Adresse, Vorschau und Testnachrichten.
async function renderChatOverlay(){
  const root=$("chatOverlay");if(!root||!hasCapability("twitch.followathon.view"))return;
  try{
    const r=await fetch("/api/chat-overlay",{cache:"no-store"}),data=await r.json();
    if(!r.ok)throw Error(data.error||"Chat-Overlay konnte nicht geladen werden.");
    const c=data.config||{},canEdit=hasCapability("twitch.followathon.edit"),dis=canEdit?"":"disabled";
    const opt=(value,label,current)=>`<option value="${value}" ${current===value?"selected":""}>${esc(label)}</option>`;
    const url=data.overlayUrl||"/chat-overlay/overlay";
    root.innerHTML=`<div class="title"><h2>Chat-Overlay</h2><p>Eigene, transparente Browserquelle für den Twitch-Chat. Nachrichten, die der Bot filtert oder löscht, erscheinen nie im Stream.</p></div>
      <div class="card"><h3>OBS-Browserquelle</h3>
        <p><code id="chatOverlayUrl">${esc(url)}</code></p>
        <p class="hint">In OBS (oder Moblin) als Browserquelle hinzufügen, empfohlen 1920 × 1080 mit transparentem Hintergrund; die Nachrichten stehen unten und wachsen nach oben. Die Quelle über den Bildbereich legen, in dem der Chat erscheinen soll, oder die Fläche in OBS zuschneiden.</p>
        <div class="row wrap"><button id="chatOverlayPreview">Vorschau mit Beispielnachrichten</button><button id="chatOverlayTest" ${dis}>Testnachrichten an geöffnete Quellen senden</button></div></div>
      <div class="card"><h3>Aussehen</h3>
        <div class="co-grid">
          <label>Look<select id="coTheme" ${dis}>${opt("dark","Dunkel (Glas, Akzentfarbe am Reiter)",c.theme)}${opt("light","Hell (weiße Blasen)",c.theme)}${opt("angular","Kantig (schräge Blasen mit Streifen)",c.theme)}</select></label>
          <label>Ausrichtung<select id="coAlign" ${dis}>${opt("left","Links",c.align)}${opt("right","Rechts",c.align)}</select></label>
          <label>Akzentfarbe<input id="coAccent" type="color" value="${esc(c.accentColor||"#FAB70A")}" ${dis}></label>
          <label>Schrift<select id="coFont" ${dis}>${opt("system","Systemschrift (läuft überall)",c.font)}${opt("akzidenz","Akzidenz Grotesk Bold, falls auf dem Gerät installiert",c.font)}${opt("custom","Eigene Schrift (Name unten)",c.font)}</select></label>
          <label>Name der eigenen Schrift<input id="coFontFamily" type="text" maxlength="40" placeholder="zum Beispiel Barlow Semi Condensed" value="${esc(c.fontFamily||"")}" ${dis}></label>
          <label>Schriftgröße in Prozent (70–160)<input id="coScale" type="number" min="70" max="160" step="5" value="${Number(c.fontScale)||100}" ${dis}></label>
        </div>
        <div class="co-checks">
          <label class="checkline"><input id="coBadges" type="checkbox" ${c.showBadges?"checked":""} ${dis}> Twitch-Abzeichen anzeigen</label>
          <label class="checkline"><input id="coEmotes" type="checkbox" ${c.showEmotes?"checked":""} ${dis}> Twitch-Emotes als Bilder anzeigen (sonst als Text)</label>
          <label class="checkline"><input id="coDot" type="checkbox" ${c.nameColorDot?"checked":""} ${dis}> Namensfarbe als kleinen Punkt vor dem Namen zeigen</label>
          <label class="checkline"><input id="coFollowCards" type="checkbox" ${c.followCards!==false?"checked":""} ${dis}> Karte „Neuer Follower“ im Chat zeigen</label>
          <label class="checkline"><input id="coRaidCards" type="checkbox" ${c.raidCards!==false?"checked":""} ${dis}> Karte „Raid“ im Chat zeigen (mit Zuschauerzahl)</label>
          <label class="checkline"><input id="coSubCards" type="checkbox" ${c.subCards!==false?"checked":""} ${dis}> Karten für Abos zeigen (neu, verlängert, Geschenkabos)</label>
          <label class="checkline"><input id="coBitsCards" type="checkbox" ${c.bitsCards!==false?"checked":""} ${dis}> Karte „Bits“ im Chat zeigen</label>
          <label class="checkline"><input id="coRedeemCards" type="checkbox" ${c.redeemCards===true?"checked":""} ${dis}> Karte „Kanalpunkte“ zeigen (Kanalpunkte einlösen)</label>
        </div>
        <p class="hint">Kanalpunkte-Karte: Das Kanal-Konto braucht dafür ein zusätzliches Recht und muss unter Administration → Verbindungen einmal neu verbunden werden. Die Schrift unter „Eigene Schrift“ muss auf dem Gerät mit OBS oder Moblin installiert sein, sonst gilt die Systemschrift.</p>
        <p class="hint">Emotes von Drittanbietern: Die Bilder laden die Overlay-Quelle (OBS, Moblin) direkt von den Servern des jeweiligen Dienstes, die Emote-Listen lädt das Control Center. Dabei wird die IP-Adresse des Geräts bzw. des Servers an den Dienst übertragen. Aus, solange du es nicht einschaltest.</p>
        <div class="co-checks">
          <label class="checkline"><input id="coEmotes7tv" type="checkbox" ${c.emotes7tv?"checked":""} ${dis}> 7TV-Emotes anzeigen</label>
          <label class="checkline"><input id="coEmotesBttv" type="checkbox" ${c.emotesBttv?"checked":""} ${dis}> BetterTTV-Emotes anzeigen</label>
          <label class="checkline"><input id="coEmotesFfz" type="checkbox" ${c.emotesFfz?"checked":""} ${dis}> FrankerFaceZ-Emotes anzeigen</label>
        </div></div>
      <div class="card"><h3>Anpassung</h3>
        <div class="co-grid">
          <label>Position<select id="coAnchor" ${dis}>${opt("bottom","Unten (neue Nachrichten unten)",c.anchor)}${opt("top","Oben",c.anchor)}</select></label>
          <label>Abstand zum Rand seitlich in Pixel (0–400)<input id="coMarginX" type="number" min="0" max="400" step="4" value="${Number.isInteger(c.marginX)?c.marginX:24}" ${dis}></label>
          <label>Abstand zum Rand oben bzw. unten in Pixel (0–400)<input id="coMarginY" type="number" min="0" max="400" step="4" value="${Number.isInteger(c.marginY)?c.marginY:24}" ${dis}></label>
          <label>Breite in Prozent der Quelle (0 = automatisch, sonst 20–100)<input id="coWidth" type="number" min="0" max="100" step="5" value="${Number(c.widthPercent)||0}" ${dis}></label>
          <label>Deckkraft der Nachrichten in Prozent (10–100, Namensleisten bleiben deckend)<input id="coBubOpacity" type="number" min="10" max="100" step="5" value="${Number.isInteger(c.bubbleOpacity)?c.bubbleOpacity:100}" ${dis}></label>
          <label>Textschatten<select id="coTextShadow" ${dis}>${opt("off","Aus",c.textShadow)}${opt("soft","Leicht",c.textShadow)}${opt("strong","Stark (für helle Spielszenen)",c.textShadow)}</select></label>
          <label>Stärke der Textur in Prozent (5–100, nur wenn eine Textur hochgeladen ist)<input id="coTexo" type="number" min="5" max="100" step="5" value="${Number.isInteger(c.textureOpacity)?c.textureOpacity:60}" ${dis}></label>
        </div>
        <p class="hint">Farben: Ohne Haken gilt die Farbe des gewählten Looks. Die Akzentfarbe (oben) bleibt für Streifen und Hervorhebungen zuständig.</p>
        <div class="co-checks">
          <div class="co-color"><label class="checkline"><input id="coTabOn" type="checkbox" ${c.tabColor?"checked":""} ${dis}> Eigene Farbe der Namensleiste</label><input id="coTab" type="color" value="${esc(c.tabColor||"#808080")}" ${dis}></div>
          <div class="co-color"><label class="checkline"><input id="coTabTextOn" type="checkbox" ${c.tabTextColor?"checked":""} ${dis}> Eigene Textfarbe der Namensleiste</label><input id="coTabText" type="color" value="${esc(c.tabTextColor||"#808080")}" ${dis}></div>
          <div class="co-color"><label class="checkline"><input id="coBubOn" type="checkbox" ${c.bubbleColor?"checked":""} ${dis}> Eigene Farbe der Nachricht</label><input id="coBub" type="color" value="${esc(c.bubbleColor||"#808080")}" ${dis}></div>
          <div class="co-color"><label class="checkline"><input id="coBubTextOn" type="checkbox" ${c.bubbleTextColor?"checked":""} ${dis}> Eigene Textfarbe der Nachricht</label><input id="coBubText" type="color" value="${esc(c.bubbleTextColor||"#808080")}" ${dis}></div>
        </div>
        <p class="hint">Eigene Symbole für die Karten (Follower, Raid, Abo, Geschenkabo, Bits, Kanalpunkte) und eine Textur lädst du unter <em>Administration → Profil &amp; Branding</em> bei den Bildern hoch. Ohne Upload erscheinen die eingebauten Symbole. Nach dem Hochladen übernehmen geöffnete Quellen die Bilder von selbst; bei Problemen die Quelle in OBS neu laden.</p></div>
      <div class="card"><h3>Anzeige</h3>
        <label>Anzahl sichtbarer Nachrichten (3–15)<input id="coMax" type="number" min="3" max="15" step="1" value="${Number(c.maxMessages)||8}" ${dis}></label>
        <label>Anzeigedauer pro Nachricht in Sekunden (0 = bleibt, bis sie verdrängt wird)<input id="coDisplay" type="number" min="0" max="600" step="5" value="${Number.isInteger(c.displaySeconds)?c.displaySeconds:60}" ${dis}></label>
        <label>Verzögerung in Sekunden (0–5)<input id="coDelay" type="number" min="0" max="5" step="1" value="${Number.isInteger(c.delaySeconds)?c.delaySeconds:2}" ${dis}></label>
        <p class="hint">Der Bot löscht Verstöße erst nach dem Empfang der Nachricht. Mit Verzögerung erscheint eine Nachricht, die kurz danach gelöscht wird, gar nicht erst im Stream. Empfohlen: 2 Sekunden. Gelöschte Nachrichten verschwinden außerdem sofort aus dem Overlay.</p></div>
      <div class="card"><h3>Ausgeblendet</h3>
        <label class="checkline"><input id="coCommands" type="checkbox" ${c.hideCommands?"checked":""} ${dis}> Nachrichten, die mit „!“ beginnen (Befehle), ausblenden</label>
        <label>Nachrichten der eigenen Bots<select id="coBots" ${dis}>${opt("none","Ausblenden",c.botMessages)}${opt("game","Nur Meldungen des Chat-Spiels zeigen",c.botMessages)}${opt("all","Alle Bot-Nachrichten zeigen",c.botMessages)}</select></label>
        <label>Meldungen des Chat-Spiels (Stubenkontrolle)<select id="coGameMsgs" ${dis}>${opt("show","Im Chat zeigen (wie bisher)",c.gameMessages)}${opt("hide","Nicht im Chat zeigen, nur im Spiel-Overlay",c.gameMessages)}</select></label>
        <label>Chat bei laufender Spielrunde (in jeder Phase: Anmeldung, Kontrolle, Ergebnis)<select id="coDodge" ${dis}>${opt("none","Nichts tun (wie bisher)",c.gameDodge)}${opt("dim","Abdunkeln",c.gameDodge)}${opt("hide","Ausblenden",c.gameDodge)}${opt("up","Nach oben schieben",c.gameDodge)}</select></label>
        <label>Abdunkeln: verbleibende Deckkraft in Prozent (0–90)<input id="coDodgeDim" type="number" min="0" max="90" step="5" value="${Number.isInteger(c.gameDodgeDim)?c.gameDodgeDim:30}" ${dis}></label>
        <label>Schieben: Strecke in Pixel der Quelle (0–900)<input id="coDodgeShift" type="number" min="0" max="900" step="20" value="${Number.isInteger(c.gameDodgeShift)?c.gameDodgeShift:360}" ${dis}></label>
        <p class="hint">Gilt je Installation und nur, solange das Punktespiel eine Runde zeigt. Danach kehrt der Chat sanft zurück. „Nach oben schieben“ passt zu Chat unten und Spiel-Panel unten in der Mitte; bei Position „Oben“ wird nach unten geschoben.</p>
        <label>Weitere Konten ausblenden (Twitch-Namen, durch Leerzeichen oder Komma getrennt)<textarea id="coIgnored" rows="3" ${dis}>${esc((c.ignoredUsers||[]).join(" "))}</textarea></label>
        <p class="hint">Gedacht für Fremdbots wie Nightbot oder Fossabot. Die Meldungen des Chat-Spiels zeigt auch das Spiel-Overlay selbst; Beides gleichzeitig ergibt doppelte Anzeigen. Mit „Nicht im Chat zeigen“ erscheinen sie nur im Spiel-Overlay; die Auswahl „Nachrichten der eigenen Bots“ gilt dann für alle übrigen Bot-Nachrichten.</p>
        <div class="row wrap"><button id="chatOverlaySave" ${dis}>Einstellungen speichern</button></div></div>`;
    $("chatOverlaySave")?.addEventListener("click",async()=>{
      const body={theme:$("coTheme").value,align:$("coAlign").value,accentColor:$("coAccent").value,font:$("coFont").value,fontScale:Number($("coScale").value),
        showBadges:$("coBadges").checked,showEmotes:$("coEmotes").checked,emotes7tv:$("coEmotes7tv").checked,emotesBttv:$("coEmotesBttv").checked,emotesFfz:$("coEmotesFfz").checked,nameColorDot:$("coDot").checked,anchor:$("coAnchor").value,marginX:Number($("coMarginX").value),marginY:Number($("coMarginY").value),widthPercent:Number($("coWidth").value),textureOpacity:Number($("coTexo").value),fontFamily:$("coFontFamily").value.trim(),
        tabColor:$("coTabOn").checked?$("coTab").value:"",tabTextColor:$("coTabTextOn").checked?$("coTabText").value:"",bubbleColor:$("coBubOn").checked?$("coBub").value:"",bubbleTextColor:$("coBubTextOn").checked?$("coBubText").value:"",
        followCards:$("coFollowCards").checked,raidCards:$("coRaidCards").checked,subCards:$("coSubCards").checked,bitsCards:$("coBitsCards").checked,redeemCards:$("coRedeemCards").checked,maxMessages:Number($("coMax").value),
        displaySeconds:Number($("coDisplay").value),delaySeconds:Number($("coDelay").value),hideCommands:$("coCommands").checked,botMessages:$("coBots").value,bubbleOpacity:Number($("coBubOpacity").value),textShadow:$("coTextShadow").value,gameMessages:$("coGameMsgs").value,gameDodge:$("coDodge").value,gameDodgeDim:Number($("coDodgeDim").value),gameDodgeShift:Number($("coDodgeShift").value),ignoredUsers:$("coIgnored").value};
      try{const result=await fetch("/api/chat-overlay",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await result.json();if(!result.ok)throw Error(j.error||"Speichern fehlgeschlagen");showToast("Chat-Overlay-Einstellungen gespeichert.","success");renderChatOverlay();}catch(e){showToast(e.message,"error");}
    });
    $("chatOverlayTest")?.addEventListener("click",async()=>{
      try{const result=await fetch("/api/chat-overlay/test",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),j=await result.json();if(!result.ok)throw Error(j.error||"Test fehlgeschlagen");showToast("Testnachrichten an alle geöffneten Overlay-Quellen gesendet.","success");}catch(e){showToast(e.message,"error");}
    });
    $("chatOverlayPreview")?.addEventListener("click",()=>window.open(`${url}?demo=1`,"_blank","noopener,noreferrer"));
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

function renderHelp(){
  help.innerHTML=`
    <div class="title"><h2>Hilfe</h2></div>

    <div class="activity-tabs help-tabs">
      <button id="helpMainTab" class="activity-tab active" type="button">Hilfe</button>
      <button id="helpUpdateTab" class="activity-tab" type="button">Update-Log</button>
      <button id="helpLegalTab" class="activity-tab" type="button">Rechtliches</button>
    </div>

    <div id="helpMainPane">
      <div class="card helpgrid">
        <h3>Social Media</h3><p>Der Social-Media-Bereich ist ausschließlich für Owner sichtbar und erscheint sowohl in der Twitch- als auch in der Discord-Navigation. Instagram und TikTok bleiben redaktionelle Quellsysteme. Das Control Center erkennt neue Veröffentlichungen und verteilt sie nach Discord; es veröffentlicht selbst keine TikTok-Videos.</p>
        <h3>TikTok Login Kit</h3><p>Owner können den TikTok-Account über einen vollständigen OAuth-Ablauf verbinden. Der einmalige State läuft nach zehn Minuten ab, der Code wird ausschließlich serverseitig gegen Tokens getauscht und es werden nur <code>user.info.basic</code> und <code>video.list</code> angefordert. Redirect URI, gewährte Scopes, Tokenstatus und verbundener Account werden im Owner-Bereich angezeigt.</p>
        <h3>Sicherheitsstand V7.0.1</h3><p>V7.0.1 härtet Autorisierung, Sitzungen, OAuth, interne Discord-Dienstaufrufe, Dateianhänge, Eingabegrößen, Browser-Sicherheitsheader und Overlay-WebSockets. Nach dem Update sind bestehende Sitzungen absichtlich ungültig und eine erneute Anmeldung ist erforderlich. Für die interne Discord-Kommunikation muss in beiden Diensten dasselbe starke <code>INTERNAL_SERVICE_SECRET</code> gesetzt sein.</p>
        <h3>Discord Notfallmodus</h3><p>Owner und Admins finden unter Discord → Notfallmodus einen temporären Lockdown mit drei konfigurierbaren Stufen. ${esc(rl("member"))}-Rechte werden vor Änderungen exakt gesichert und beim Beenden wiederhergestellt; Regeln, Meldekopf, #log und Stabsraum bleiben geschützt.</p>
        <h3>Discord Logs & Benachrichtigungen</h3><p>Globale Admins und Owner verwalten Discord-Lognachrichten zentral unter Discord → Administration → Logs & Benachrichtigungen. Aktivierung, Zielkanal, Text, Testversand und Standardwiederherstellung werden pro Ereignis gepflegt; das interne Audit bleibt davon unabhängig.</p>
        <h3>Öffentliche Webseiten</h3><p>Unter Administration → Öffentliche Webseiten verwalten Owner die öffentlichen App-Informationen, Nutzungsbedingungen, Datenschutzhinweise und das Impressum. Entwürfe und Vorschauen bleiben geschützt. Änderungen an einem Entwurf ersetzen eine veröffentlichte Fassung erst nach einem erneuten, ausdrücklich bestätigten Veröffentlichen.</p>
        
        <h3>Followathon</h3><p>Unter <strong>Twitch → Live-Betrieb → Followathon</strong> kann ein serverseitiger Countdown durch echte Twitch-Follows verlängert werden. Verwendet wird die vorhandene <code>channel.follow</code>-v2-Subscription des Haupt-Bots; bestehende Follow-Begrüßungen bleiben davon unabhängig. Die maximale Restzeit und die feste späteste Endzeit gelten gemeinsam, Pausen verschieben die feste Endzeit nicht. Derselbe Twitch-Account kann pro Event nur einmal gutgeschrieben werden. Bei auffälligen Follow-Häufungen werden weitere Gutschriften bis zur manuellen Prüfung zurückgehalten. Die OBS-Browserquelle ist rein lesend und synchronisiert sich über SSE. Bei EventSub-Unterbrechungen kann eine Zähllücke entstehen; eine vollständige nachträgliche Zustellung verpasster Follows wird nicht garantiert.</p>
        <h3>${esc(gameName())} / ${esc(pointsName())}</h3><p>Das Minispiel läuft über <code>${esc(gameCommands().start)} BETRAG</code>. Einsätze werden bei der Anmeldung reserviert. Nach Anmeldeschluss gilt ein gemeinsamer Faktor; je nach Verlauf werden alle, niemand oder einzelne Teilnehmende als bestanden gewertet. <code>!daily</code> richtet sich nach dem Kalendertag in Europe/Berlin. Punkte, Runden und Buchungen werden dauerhaft gespeichert. Bei einem technischen Bot-Neustart wird eine noch laufende Runde automatisch abgebrochen und reservierte Einsätze werden zurückgegeben. Das lokale OBS-Overlay verbindet sich nur lesend per WSS.</p>
        <h3>Navigation</h3><p>Die Hauptbereiche liegen in der linken Seitenleiste. Auf Desktop und Tablet kann sie auf eine reine Icon-Ansicht eingeklappt werden; beim Überfahren der Icons erscheint ein Tooltip. Auf Smartphones öffnet die Navigation über das Menü-Symbol als Seitenmenü und schließt nach einer Auswahl automatisch. Unterbereiche erscheinen als Tabs oberhalb des Inhalts.</p>
        <h3>Command-Cooldowns</h3><p>Normale Chat-Nutzer unterliegen weiterhin dem pro Command eingestellten Cooldown. Twitch-Moderatoren und der Broadcaster/Owner sind davon ausgenommen und können Commands jederzeit erneut ausführen.</p>
        <h3>Commands</h3><p>Ein Command reagiert auf einen Chatbefehl. Über Aliases kannst du weitere Begriffe hinterlegen, die dieselbe Antwort auslösen.</p>
        <h3>Timer-Nachrichten</h3><p>Timer senden nur während der Kanal live ist. Du kannst zwischen UND und ODER wählen. UND bedeutet: Zeitintervall und Mindest-Zeilen müssen beide erfüllt sein. ODER bedeutet: Sobald entweder die Zeit abgelaufen ist oder die Mindest-Zeilen erreicht wurden, wird gesendet. Nach jeder Timer-Nachricht startet für beide Bedingungen ein neuer Zyklus.</p>
        <h3>Community</h3><p>Der Bereich bündelt Follow, Raid, Begrüßungen sowie <code>!followage</code> und <code>!watchtime</code>. Für Follows können mehrere Nachrichten gepflegt werden; sie werden der Reihe nach abwechselnd verwendet. Followage kommt direkt aus der Twitch-Follower-API. Watchtime wird ab früheren Versionen lokal aufgebaut, indem während Live-Streams die verbundenen Chat-Nutzer regelmäßig erfasst werden.</p>
        <h3>Team</h3><p>Die Team-Seite verwaltet die Personen hinter dem Stream. Aus den Profilen werden <code>!team</code>, die persönlichen Commands und ein optionaler Team-Timer automatisch erzeugt. Leere Felder werden in Chatantworten nicht als Platzhalter ausgegeben. Aliase wie <code>!anna</code> oder <code>!ben</code> können direkt am Profil gepflegt werden.</p>
        <h3>Watchtime-Verwaltung</h3><p>Editor und höhere Rollen können die lokal erfasste Watchtime durchsuchen, nach Watchtime oder letztem Kontakt sortieren und in Seiten mit maximal 100 Einträgen anzeigen. Einzelne Werte lassen sich korrigieren oder auf 0 setzen; Änderungen werden im Activity Board protokolliert.</p>
        <h3>Followage-Liste</h3><p>Editor und höhere Rollen können die Follower-Liste direkt aus Twitch abrufen. Pro Seite werden maximal 100 Nutzer angezeigt. Die Gesamtliste kann nach Followage auf- oder absteigend sowie nach Name A–Z oder Z–A sortiert werden. Dafür wird die komplette Follower-Liste bis zu 15 Minuten lokal zwischengespeichert. Über die Suche kann ein exakter Twitch-Login geprüft und dessen Follow-Datum sowie Followage angezeigt werden.</p>
        <h3>Begrüßungen</h3><p>Für bestimmte Twitch-Logins kann beim ersten Chatbeitrag eine Begrüßung gesendet werden. Dieselbe Begrüßung wird frühestens nach 12 Stunden erneut ausgelöst.</p>
        <h3>Zentraler Wortfilter V8</h3><p>Unter <strong>Moderation → Wortfilter</strong> verwalten Owner einen gemeinsamen, kategorisierten Wortbestand für Twitch und Discord. Begriffe können pro Plattform aktiviert, mit Schweregrad und Erkennungsart versehen und über getrennte Plattform-Policies behandelt werden. Unterstützt werden Ganzwort-, Phrasen-, Teilstring- und validierte Regex-Erkennung sowie optional Leetspeak, Buchstabenwiederholungen und eingefügte Trennzeichen. Die zentrale Allowlist reduziert bekannte Fehlalarme. Trefferstatistiken speichern keine Chatnachrichteninhalte. Externe Importe werden standardmäßig deaktiviert und im Testmodus angelegt.</p>
        <h3>LDNOOBW-Import</h3><p>V8.0.0 enthält einen statischen Import-Seed mit 66 deutschen Einträgen aus der LDNOOBW-Liste unter CC BY 4.0. Es gibt keine automatische Online-Aktualisierung. Der Import muss ausdrücklich gestartet und anschließend geprüft, kategorisiert und aktiviert werden. Bereits vorhandene manuelle Einträge werden nicht ungefragt überschrieben.</p>
        <h3>Legacy-Wortlisten</h3><p>Die bisherigen Twitch-Blocked-Words und Discord-Regelbegriffe werden beim ersten Start in den zentralen PostgreSQL-Bestand übernommen. Die bisherigen Konfigurationen bleiben zunächst als Legacy-/Rollbackpfad erhalten. Native Discord-AutoMod-Ereignisse werden weiterhin dedupliziert, damit dieselbe Nachricht nicht zusätzlich durch den Control-Center-Wortfilter sanktioniert wird.</p>
        <h3>Moderation / Chat-Filter</h3><p>Aktive Filter löschen die auslösende Chatnachricht über den Haupt-Bot. Ein Timeout kann pro Filter optional zugeschaltet werden. Beim Sonderzeichen-Filter zählen Punkt und Komma nicht. Beim Großbuchstaben-Filter zählt die längste zusammenhängende Folge von Großbuchstaben. Moderatoren, der Kanalinhaber und Whitelist-User können global ausgenommen werden.</p>
        <h3>AutoMod Auto-Allow für Clips</h3><p>Wenn Twitch eine Clip-Nachricht des Clip-Bots wegen des Linkfilters zurückhält, wird sie automatisch durch den Haupt-Bot freigegeben. Andere gehaltene AutoMod-Nachrichten bleiben unangetastet.</p>
        <h3>Clips</h3><p>Das Clip-Sharing fragt Twitch in einem einstellbaren Intervall nach neuen Clips des Kanals ab. Neue Clip-IDs werden dauerhaft gespeichert und durch den Clip-Bot gepostet. Beim ersten Lauf wird der vorhandene Bestand nur als bekannt markiert, damit keine alten Clips in den Chat gesendet werden.</p>
        <h3>Clip-Befehl</h3><p>Mit dem Clip-Befehl (Standard <code>!clip</code>) erstellt der Bot auf Zuruf einen Clip des laufenden Streams. Wer ihn nutzen darf, die Pausen, die Clip-Länge und der antwortende Bot sind einstellbar. Der Clip wird über das Kanal-Konto erstellt; dafür braucht es das Twitch-Recht <code>clips:edit</code> (einmal neu verbinden). Der Link kommt meist nach wenigen Sekunden in den Chat.</p>
        <h3>Gewinnspiel</h3><p>Es gibt Keyword- und Random-Gewinnspiele. Mods, Owner/Broadcaster und VIPs sind getrennte Teilnahmeoptionen. Der Teilnehmerstand wird während eines laufenden Gewinnspiels automatisch aktualisiert; mehrere unterschiedliche Gewinner können nacheinander gezogen werden.</p>
        <h3>Auto-Replies</h3><p>Auto-Replies können mehrere Auslöser haben. Pro Eintrag lassen sich Name, Abgleich, Bot, Cooldown und Antwort festlegen.</p>
        <h3>Statistiken</h3><p>Für Commands und Auto-Replies werden Auslösungen ab Version 4.9.0 gezählt. Angezeigt werden Werte für heute, den aktuellen Stream, gesamt sowie die letzte Auslösung. Die Statistik wird unabhängig von Änderungen an Antworttexten weitergeführt, solange die jeweilige Eintrags-ID erhalten bleibt.</p>
        <h3>Event-Profile</h3><p>Event-Profile speichern den Aktiv-Status und die Bot-Zuordnung von Commands, Timern, Auto-Replies, Begrüßungen sowie Follow, Raid, !followage und !watchtime. Ein Profil kann mit einem Klick aktiviert und später mit dem aktuellen gespeicherten Stand aktualisiert werden. Antworttexte, Cooldowns und andere Inhalte werden beim Profilwechsel nicht überschrieben.</p>
        <h3>Activity Board</h3><p>Änderungs-Logs und Login-Logs sind getrennt. Das Board zeigt maximal 100 Einträge pro Seite und kann nach Benutzer, Bereich und Aktion gefiltert werden.</p>
        <h3>Benutzer & Rollen</h3><p>Owner haben Vollzugriff. Admins dürfen Benutzer verwalten, aber keine Owner vergeben. Editor dürfen Inhalte bearbeiten. Viewer haben nur Lesezugriff. Twitch-Moderatoren erhalten automatisch Editor-Rechte; zusätzliche Twitch-Accounts können unabhängig vom Mod-Status freigegeben werden.</p>
        <h3>Twitch-Verbindungen</h3><p>Owner können Bot- und Kanal-Accounts direkt über OAuth verbinden oder neu autorisieren. Das Control Center prüft den erwarteten Twitch-Account und die benötigten Scopes. Refresh-Tokens werden anschließend automatisch verwendet.</p>
        <h3>Systemstatus</h3><p>Nur Owner und der lokale Admin sehen die Diagnoseansicht. Sie zeigt den Zustand der Twitch-Verbindungen, EventSub-Abos, App-Token, Clip-Monitor, Watchtime-Daten, persistente Dateien und die letzten protokollierten Systemfehler. Access- und Refresh-Tokens werden dort nicht angezeigt.</p>
        <h3>PostgreSQL</h3><p>Ab V7.2.0 läuft die strukturierte Datenhaltung lokal in PostgreSQL auf der Synology. Unter <strong>Administration → Datenbank</strong> sehen Owner den Zustand beider Dienste, Schema- und Datensatzinformationen sowie den kontrollierten Rollback-Export. Mit V7.2.17 sind zusätzlich die Twitch-Followerdaten des 15-Minuten-Followage-Caches relational gespeichert. Watchtime, EventSub-Deduplizierung, ${esc(gameName())}/${esc(pointsName())}, Followathon, Gewinnspiele, Discord-Moderation, Discord-Onboarding/Freischaltung, das Meldesystem, Social-Media-Zustände und Veröffentlichungshistorie sowie Kanalzeiten und Notfallmodus-Zustände liegen ebenfalls relational vor. V7.2.5 ergänzt darauf aufbauend den Discord-Spam-Schutz; Moderationsprotokolle waren bereits relational. Weitere komplexe Funktionszustände liegen weiterhin als versionierte JSONB-Dokumente vor. Twitch-/Social-OAuth-Tokens, Discord-Secrets und Report-Anhänge bleiben bewusst außerhalb der Datenbank.</p>
        <h3>Dienste neu starten</h3><p>Owner und lokaler Admin können im Systemstatus die Weboberfläche, den Twitch-Bot, den Discord-Bot oder alle Dienste kontrolliert neu starten. Die Container verwenden <code>restart: unless-stopped</code> und werden von Docker automatisch wieder gestartet. Die Oberfläche prüft anschließend selbstständig, wann die Dienste wieder bereit sind.</p>
        <h3>Backup / Restore</h3><p>Das zentrale Backup umfasst Twitch-/Control-Center-Daten und die sicheren Discord-Konfigurationen und Verläufe. Zugangsdaten, OAuth-/Refresh-Tokens, Sessions sowie aktive Rechte-Snapshots von Kanalzeiten und Notfallmodus werden bewusst ausgeschlossen.</p>
        <h3>EventSub-Reconnect</h3><p>Die Twitch-EventSub-Verbindung verwendet einen kontrollierten Reconnect mit gestaffelten Wiederholungsabständen. Bei einem von Twitch angeforderten Reconnect bleibt die alte Verbindung offen, bis die neue Verbindung ihr Welcome gesendet hat. Dadurch werden parallele Reconnect-Schleifen vermieden. Der Systemstatus zeigt Verbindungszustand, letzte Nachricht, Close-Code und nächsten Wiederholungsversuch.</p>
        <h3>Discord-Freischaltung</h3><p>Die Freischaltung wird unter <strong>Discord → Freischaltung</strong> eingerichtet. Neue Mitglieder erhalten dort zunächst keine Rolle. Der Bot begrüßt sie im Meldekopf und verweist mit <code>{rules}</code> direkt auf den Regelkanal. Nur eine 👍-Reaktion auf die im Dashboard hinterlegte zentrale Regelnachricht vergibt die ausgewählte Freischaltrolle. Reaktionsentzug nimmt die Rolle nicht zurück. Bei erneutem Serverbeitritt ist eine neue Bestätigung erforderlich. Bestehende Mitglieder und Kanalrechte werden beim Aktivieren nicht automatisch geändert.</p>
        <h3>Discord-Kanalrechte für die Zugangssperre</h3><p>Die Kanalrechte werden bewusst nicht automatisch verändert. <code>@everyone</code> sollte ausschließlich Meldekopf und Regeln sehen. Die ausgewählte Freischaltrolle (standardmäßig ${esc(rl("member"))}) erhält Zugriff auf die öffentlichen Community-/Social-Kanäle. Interne Bereiche wie Log bleiben für ${esc(rl("member"))} gesperrt. Andere automatisch vergebene Rollen dürfen auf den öffentlichen Kategorien kein eigenes <em>Kanal ansehen</em>-Allow besitzen, sonst können sie die Sperre umgehen. Der Bot benötigt im Regelkanal insbesondere Kanal ansehen, Nachrichten senden, Nachrichtenverlauf lesen und Reaktionen hinzufügen sowie serverweit Rollen verwalten. Seine Rolle muss oberhalb der Freischaltrolle stehen.</p>
        <h3>Discord-Regelscreening</h3><p>Für die hier verwendete reine Reaktions-Freischaltung muss das native Discord-Regelscreening deaktiviert sein. Ist es aktiv, können ausstehende Mitglieder vor dessen Abschluss nicht auf die 👍-Reaktion klicken. Das Control Center erkennt diesen Zustand soweit Discord ihn über die Guild-Features meldet und blockiert dann die Aktivierung.</p>
        <h3>Backup / Restore</h3><p>Owner und lokaler Admin können Einstellungen und ausgewählte persistente Daten als JSON sichern und wiederherstellen. OAuth-Tokens, Refresh-Tokens, App Access Token, Login-Sessions und das lokale Admin-Passwort sind grundsätzlich ausgeschlossen. Vor einem Restore wird der Inhalt geprüft und die wiederherzustellenden Bereiche können einzeln gewählt werden.</p>
        <h3>Chat Bot Badge</h3><p>Ausgehende Bot-Nachrichten werden mit einem Twitch App Access Token über die Send-Chat-Message-API verschickt. Wenn die Twitch-Berechtigungen des Bot-Accounts und des Kanals vorhanden sind, kann Twitch dadurch den offiziellen Bot-Badge anzeigen.</p>
        <h3>Speichern</h3><p>Änderungen werden erst nach Klick auf <strong>Änderungen speichern</strong> dauerhaft übernommen.</p>
      </div>
    </div>

    <div id="helpUpdatePane" class="hidden">
      <p class="hint">Die wichtigsten Änderungen je Version, neueste Version zuerst.</p>
      <div id="updateLogList"><div class="card">Lade Update-Log …</div></div>
    </div>

    <div id="helpLegalPane" class="hidden"><div class="card">Lade Rechtliches …</div></div>`;

  const setHelpView=(view)=>{
    const main=view==="help",upd=view==="updates",legal=view==="legal";
    $("helpMainTab").classList.toggle("active",main);
    $("helpUpdateTab").classList.toggle("active",upd);
    $("helpLegalTab").classList.toggle("active",legal);
    $("helpMainPane").classList.toggle("hidden",!main);
    $("helpUpdatePane").classList.toggle("hidden",!upd);
    $("helpLegalPane").classList.toggle("hidden",!legal);
    if(upd) loadUpdateLog();
    if(legal) loadLegal();
  };

  $("helpMainTab").addEventListener("click",()=>setHelpView("help"));
  $("helpUpdateTab").addEventListener("click",()=>setHelpView("updates"));
  $("helpLegalTab").addEventListener("click",()=>setHelpView("legal"));
}

// 9.24.0: Hilfe → Rechtliches. Lizenz (Kurzfassung, Volltext, Annahme) und Begleitdokumente sind für jeden angemeldeten Nutzer lesbar.
async function loadLegal(){
  const root=$("helpLegalPane");
  if(!root||root.dataset.loaded==="1")return;
  try{
    const [lr,dr]=await Promise.all([fetch("/api/license",{cache:"no-store"}),fetch("/api/legal",{cache:"no-store"})]);
    const ld=await lr.json(),dd=await dr.json();
    if(!lr.ok)throw Error(ld.error||"Lizenz konnte nicht geladen werden.");
    const l=ld.license||{},a=ld.acceptance;
    const how={wizard:"Einrichtungsassistent",bestandsinstallation:"bestehende Installation (automatisch)",bestaetigung:"Bestätigung"}[a?.source]||"";
    const state=a?`Angenommen am ${esc(new Date(a.acceptedAt).toLocaleString("de-DE"))}${how?` · ${esc(how)}`:""} · Version ${esc(a.version)}${ld.current?"":" (nicht die aktuelle Version)"}`:"Noch nicht angenommen.";
    const docs=(dd.documents||[]).map(d=>`<details class="legal-doc" data-doc="${esc(d.key)}"><summary>${esc(d.title)}</summary><pre class="license-text">Lade …</pre></details>`).join("");
    root.innerHTML=`
      <div class="card"><h3>Lizenz</h3>
        <p><strong>${esc(l.name||"")}</strong> (${esc(l.id||"")} ${esc(l.version||"")}) · ${esc(l.type||"")}</p>
        <p class="hint">${state}</p>
        <p><strong class="ok-text">Erlaubt:</strong> ${esc(l.summary?.allowed||"")}</p>
        <p><strong class="error-text">Nicht erlaubt:</strong> ${esc(l.summary?.forbidden||"")}</p>
        <p class="hint">${esc(l.copyright||"")} · Kennung ${esc(l.spdx||"")}<br>Maßgeblich ist allein der vollständige Text. Prüfsumme (SHA-256): <code>${esc(l.sha256||"nicht verfügbar")}</code></p>
        <details id="legalLicenseDetails"><summary>Vollständigen Lizenztext lesen</summary><pre class="license-text" id="legalLicenseText">Lade …</pre></details>
        <p class="hint">Kontakt und Impressum des Lizenzgebers: <a href="${esc(l.contactUrl||"#")}" target="_blank" rel="noopener noreferrer">${esc(l.contactUrl||"")}</a></p>
      </div>
      <div class="card"><h3>Weitere Dokumente</h3><p class="hint">Diese Texte gehören zur Software und liegen auch im Quellcode vor.</p>${docs}</div>`;
    root.dataset.loaded="1";
    const fill=async(el,url)=>{
      if(el.dataset.done==="1")return;
      try{const r=await fetch(url,{cache:"no-store"});const tx=await r.text();if(!r.ok)throw Error(tx||"nicht verfügbar");el.textContent=tx;el.dataset.done="1";}
      catch(e){el.textContent=`Der Text konnte nicht geladen werden: ${e.message}`;}
    };
    $("legalLicenseDetails")?.addEventListener("toggle",ev=>{if(ev.target.open)fill($("legalLicenseText"),"/api/license/text");});
    root.querySelectorAll("details.legal-doc").forEach(det=>det.addEventListener("toggle",()=>{if(det.open)fill(det.querySelector("pre"),`/api/legal?doc=${encodeURIComponent(det.dataset.doc)}`);}));
  }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

async function loadUpdateLog(){
  const root=$("updateLogList");
  if(!root) return;

  try{
    const r=await fetch("/changelog.json",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok) throw new Error(`HTTP ${r.status}`);

    const versions=Array.isArray(data.versions)?data.versions:[];
    root.innerHTML=versions.length
      ? versions.map(v=>`
        <div class="card update-log-card">
          <div class="update-log-head">
            <h3>Version ${esc(v.version||"")}</h3>
            ${v.title?`<span>${esc(v.title)}</span>`:""}
          </div>
          <ul>
            ${(v.changes||[]).map(change=>`<li>${esc(change)}</li>`).join("")}
          </ul>
        </div>`).join("")
      : `<div class="card">Noch keine Einträge vorhanden.</div>`;
  }catch(e){
    root.innerHTML=`<div class="card error">Update-Log konnte nicht geladen werden: ${esc(e.message)}</div>`;
  }
}



function ensureTeamClient(){
  settings.team ||= {};
  settings.team.bot ||= botDefault("main");
  settings.team.teamCommandText ||= bt("teamCommandText","Lerne unser Team kennen: {commands}");
  settings.team.timer ||= {enabled:true,everyMinutes:30,minLines:15,text:bt("teamTimerText","👀 Wer steckt eigentlich hinter diesem Kanal? Mit !team lernst du das Team kennen!")};
  settings.team.members ||= [];
  return settings.team;
}
function normalizeTeamCommandClient(value){
  const v=String(value||"").trim().toLowerCase();
  if(!v) return "";
  return v.startsWith("!")?v:`!${v}`;
}
function teamMemberResponseClient(member){
  const bits=[];
  if(member.rank) bits.push(String(member.rank).trim());
  if(member.since) bits.push(branding?.texts?.teamMemberSince?String(branding.texts.teamMemberSince).replace("{since}",String(member.since).trim()):`Seit ${String(member.since).trim()} dabei`);
  if(member.role) bits.push(String(member.role).trim());
  if(member.humor) bits.push(String(member.humor).trim());
  const name=String(member.name||"Teammitglied").trim();
  const pre=bt("teamMemberPrefix","👤"),suf=bt("teamMemberSuffix","");
  return `${pre?pre+" ":""}${name}${bits.length?` | ${bits.join(" | ")}`:""}${member.humor?".":""}${suf?" "+suf.trim():""}`;
}
function syncTeamManagedClientSettings(){
  const team=ensureTeamClient();
  settings.commands=(settings.commands||[]).filter(x=>x?.managedBy!=="team");
  settings.timers=(settings.timers||[]).filter(x=>x?.managedBy!=="team");
  const active=team.members.filter(m=>m?.enabled!==false && normalizeTeamCommandClient(m.command));
  const commandList=active.map(m=>normalizeTeamCommandClient(m.command)).join(" | ");
  settings.commands.push({id:"team-managed-overview",managedBy:"team",enabled:true,command:"!team",aliases:"",bot:team.bot||botDefault("main"),cooldownSeconds:30,modsOnly:false,response:String(team.teamCommandText||"").replaceAll("{commands}",commandList)});
  active.forEach(member=>settings.commands.push({
    id:`team-managed-${String(member.id||member.name||uid()).toLowerCase().replace(/[^a-z0-9_-]+/g,"-")}`,
    managedBy:"team",enabled:true,command:normalizeTeamCommandClient(member.command),aliases:String(member.aliases||"").split(",").map(normalizeTeamCommandClient).filter(Boolean).join(", "),bot:team.bot||botDefault("main"),cooldownSeconds:30,modsOnly:false,response:teamMemberResponseClient(member)
  }));
  settings.timers.push({id:"team-managed-timer",managedBy:"team",enabled:!!team.timer.enabled,description:"Team-Hinweis",bot:team.bot||botDefault("main"),everyMinutes:Math.max(1,Number(team.timer.everyMinutes||30)),minLines:Math.max(0,Number(team.timer.minLines??15)),conditionMode:"and",text:String(team.timer.text||"")});
}
function teamPreviewHtml(){
  const team=ensureTeamClient();
  const active=team.members.filter(m=>m?.enabled!==false && normalizeTeamCommandClient(m.command));
  const commands=active.map(m=>normalizeTeamCommandClient(m.command)).join(" | ");
  return `
    <div class="team-preview-line"><code>!team</code><span>${esc(String(team.teamCommandText||"").replaceAll("{commands}",commands))}</span></div>
    ${active.map(m=>`<div class="team-preview-line"><code>${esc(normalizeTeamCommandClient(m.command))}${m.aliases?` <small>(${esc(m.aliases)})</small>`:""}</code><span>${esc(teamMemberResponseClient(m))}</span></div>`).join("")}
    <div class="team-preview-line team-preview-timer"><code>Timer</code><span>${esc(team.timer.text||"")}</span></div>`;
}
function renderTeam(){
  const team=ensureTeamClient();
  const canEdit=hasCapability("twitch.team.edit");
  $("team").innerHTML=`
    <div class="title team-title">
      <div><h2>Team</h2><p class="hint">Teamprofile pflegen automatisch <code>!team</code>, die persönlichen Commands und den Team-Timer. Leere Profilfelder werden in der Chatantwort einfach weggelassen.</p></div>
      ${canEdit?'<button id="teamAddBtn" type="button">+ Teammitglied</button>':''}
    </div>
    <div class="card team-settings-card">
      <div class="team-settings-grid">
        <div><span class="fieldlabel">Antwortender Bot</span>${botSel(team.bot||botDefault("main")).replace('data-k="bot"','id="teamBot"')}</div>
        <label class="compact detail-toggle"><input id="teamTimerEnabled" type="checkbox" ${team.timer?.enabled?"checked":""}> Team-Timer aktiv</label>
        <div><span class="fieldlabel">Intervall (Min.)</span><input id="teamTimerMinutes" type="number" min="1" value="${Number(team.timer?.everyMinutes||30)}"></div>
        <div><span class="fieldlabel">Mind. Chatzeilen</span><input id="teamTimerLines" type="number" min="0" value="${Number(team.timer?.minLines??15)}"></div>
        <div class="team-settings-wide"><span class="fieldlabel">!team Antwort · <code>{commands}</code> setzt die Command-Liste ein</span><textarea id="teamCommandText">${esc(team.teamCommandText||"")}</textarea></div>
        <div class="team-settings-wide"><span class="fieldlabel">Timer-Nachricht</span><textarea id="teamTimerText">${esc(team.timer?.text||"")}</textarea></div>
      </div>
    </div>
    <div id="teamMembers" class="team-members">
      ${(team.members||[]).map((m,index)=>`
        <div class="card team-member-card" data-team-index="${index}">
          <div class="team-member-head">
            <div><strong>${esc(m.name||"Teammitglied")}</strong><span>${esc(normalizeTeamCommandClient(m.command)||"ohne Command")}</span></div>
            <div class="team-member-actions">
              <label class="compact"><input data-team-k="enabled" type="checkbox" ${m.enabled!==false?"checked":""}> Aktiv</label>
              ${canEdit?'<button class="team-remove danger" type="button">Entfernen</button>':''}
            </div>
          </div>
          <div class="team-member-grid">
            <div><span class="fieldlabel">Name</span><input data-team-k="name" value="${esc(m.name||"")}"></div>
            <div><span class="fieldlabel">Command</span><input data-team-k="command" value="${esc(m.command||"")}" placeholder="!name"></div>
            <div><span class="fieldlabel">Alias(e)</span><input data-team-k="aliases" value="${esc(m.aliases||"")}" placeholder="!alias1, !alias2"></div>
            <div><span class="fieldlabel">${esc(bt("teamRankLabel","Rang"))}</span><input data-team-k="rank" value="${esc(m.rank||"")}"></div>
            <div><span class="fieldlabel">Seit / Dienstbeginn</span><input data-team-k="since" value="${esc(m.since||"")}" placeholder="z. B. 2009"></div>
            <div><span class="fieldlabel">Rolle im Stream</span><input data-team-k="role" value="${esc(m.role||"")}"></div>
            <div class="team-member-wide"><span class="fieldlabel">Insider / Humor</span><textarea data-team-k="humor">${esc(m.humor||"")}</textarea></div>
          </div>
        </div>`).join("")}
    </div>
    <div class="card team-preview-card"><h3>Chat-Vorschau</h3><div id="teamPreview">${teamPreviewHtml()}</div></div>`;

  const updatePreview=()=>{ if($("teamPreview")) $("teamPreview").innerHTML=teamPreviewHtml(); };
  const syncTop=()=>{
    team.bot=$("teamBot")?.value||botDefault("main");
    team.timer.enabled=!!$("teamTimerEnabled")?.checked;
    team.timer.everyMinutes=Math.max(1,Number($("teamTimerMinutes")?.value||30));
    team.timer.minLines=Math.max(0,Number($("teamTimerLines")?.value||0));
    team.teamCommandText=$("teamCommandText")?.value||"";
    team.timer.text=$("teamTimerText")?.value||"";
    syncTeamManagedClientSettings(); mark(); updatePreview();
  };
  ["teamBot","teamTimerEnabled","teamTimerMinutes","teamTimerLines","teamCommandText","teamTimerText"].forEach(id=>{
    $(id)?.addEventListener("input",syncTop); $(id)?.addEventListener("change",syncTop);
  });
  document.querySelectorAll("#teamMembers [data-team-index]").forEach(card=>{
    const i=Number(card.dataset.teamIndex); const member=team.members[i]; if(!member) return;
    card.querySelectorAll("[data-team-k]").forEach(el=>{
      const sync=()=>{member[el.dataset.teamK]=el.type==="checkbox"?el.checked:el.value; syncTeamManagedClientSettings(); mark(); renderTeam();};
      el.addEventListener("change",sync);
      if(el.tagName==="TEXTAREA") el.addEventListener("blur",sync);
    });
    card.querySelector(".team-remove")?.addEventListener("click",async()=>{
      if(!(await askDelete(`Teammitglied „${member.name||"ohne Namen"}“ wirklich entfernen?`))) return;
      team.members.splice(i,1); syncTeamManagedClientSettings(); mark(); renderTeam();
    });
  });
  $("teamAddBtn")?.addEventListener("click",()=>{
    team.members.push({id:uid(),enabled:true,name:"",command:"",aliases:"",rank:"",since:"",role:"",humor:""}); mark(); renderTeam();
  });
  if(!canEdit) document.querySelectorAll("#team input,#team select,#team textarea,#team button").forEach(el=>el.disabled=true);
}


function stubenFmt(value){ return Number(value||0).toLocaleString("de-DE"); }
function stubenTime(value){ return value?new Date(value).toLocaleString("de-DE"):"–"; }
function stubenPhraseText(value){ return Array.isArray(value)?value.join("\n"):""; }
function stubenReadPhrase(id){ return ($(id)?.value||"").split(/\n+/).map(v=>v.trim()).filter(Boolean); }

async function renderStubenkontrolle(){
  const root=$("stubenkontrolle");
  if(!root) return;
  root.innerHTML=`<div class="card">Lade ${esc(gameName())} …</div>`;
  try{
    const r=await fetch("/api/stubenkontrolle",{cache:"no-store"});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||`HTTP ${r.status}`);
    const c=data.config||{};
    const admin=hasRole("admin");
    root.innerHTML=`
      <div class="title stuben-page-title">
        <div><h2>${esc(gameName())}</h2><p class="hint">Twitch-Minispiel mit eigener Währung <strong>${esc(pointsName())}</strong>. Name, Punktename und Befehle stehen in der Karte darunter. Spielkonten werden über stabile Twitch-User-IDs geführt.</p></div>
        <button id="stubenRefreshBtn" type="button">Aktualisieren</button>
      </div>
      <div id="stubenGameCard"></div>

      <div class="stuben-kpi-grid">
        <div class="card stuben-kpi"><span>Konten</span><strong>${stubenFmt(data.accounts)}</strong></div>
        <div class="card stuben-kpi"><span>Runden</span><strong>${stubenFmt(data.rounds)}</strong></div>
        <div class="card stuben-kpi"><span>Overlay</span><strong>${Number(data.overlay?.connectedClients||0)} verbunden</strong><small>${data.overlay?.lastConnectAt?`zuletzt ${stubenTime(data.overlay.lastConnectAt)}`:"noch keine Verbindung"}</small></div>
        <div class="card stuben-kpi"><span>Aktive Runde</span><strong>${data.activeRound?esc(data.activeRound.id):"–"}</strong><small>${data.activeRound?`${data.activeRound.participants?.length||0} Teilnehmende · x${data.activeRound.factor}`:"keine Runde"}</small></div>
      </div>

      <div class="activity-tabs stuben-tabs">
        <button class="activity-tab active" data-stuben-tab="settings">Einstellungen</button>
        <button class="activity-tab" data-stuben-tab="accounts">Punktekonten</button>
        <button class="activity-tab" data-stuben-tab="rounds">Runden</button>
        <button class="activity-tab" data-stuben-tab="overlay">OBS-Overlay</button>
        ${admin?'<button class="activity-tab" data-stuben-tab="admin">Admin</button>':""}
      </div>

      <div id="stubenPaneSettings" class="stuben-pane">
        <div class="card">
          <div class="title"><div><h3>Spielregeln</h3><p class="hint">Startvorschlag: 75 % individuelle Kontrolle, 10 % alle bestehen, 15 % alle erwischt; bei individueller Kontrolle 40 % Bestehens-Chance.</p></div><label class="compact"><input id="stubenEnabled" type="checkbox" ${c.enabled!==false?"checked":""}> Spiel aktiv</label></div>
          <div class="stuben-settings-grid">
            <div><span class="fieldlabel">Bot</span>${botSel(c.bot||botDefault("main")).replace('data-k="bot"','id="stubenBot"')}</div>
            <div><span class="fieldlabel">Startguthaben</span><input id="stubenStarter" type="number" min="0" value="${Number(c.starterPoints||1000)}"></div>
            <div><span class="fieldlabel">!daily</span><input id="stubenDaily" type="number" min="0" value="${Number(c.dailyPoints||100)}"></div>
            <div><span class="fieldlabel">!gift – Höchstbetrag (0 = unbegrenzt)</span><input id="stubenGiftMax" type="number" min="0" value="${Number(c.giftMaxAmount??10000)}" ${isGlobalOwner()?"":"disabled title=\"Nur Owner\""}></div>
            <div><span class="fieldlabel">!gift erlaubt für</span><label class="compact"><input id="stubenGiftBroadcaster" type="checkbox" ${isGlobalOwner()?"":"disabled"} ${c.giftAllowBroadcaster!==false?"checked":""}> Kanalinhaber</label><label class="compact"><input id="stubenGiftOwners" type="checkbox" ${isGlobalOwner()?"":"disabled"} ${c.giftAllowControlOwners===true?"checked":""}> Owner des Control Centers (verknüpftes Twitch-Konto)</label></div>
            <div><span class="fieldlabel">Mindesteinsatz</span><input id="stubenMinBet" type="number" min="1" value="${Number(c.minBet||50)}"></div>
            <div><span class="fieldlabel">Maximaleinsatz</span><input id="stubenMaxBet" type="number" min="1" value="${Number(c.maxBet||500)}"></div>
            <div><span class="fieldlabel">Anmeldung (Sek.)</span><input id="stubenRegistration" type="number" min="10" value="${Number(c.registrationSeconds||60)}"></div>
            <div><span class="fieldlabel">Pause nach Runde (Min.)</span><input id="stubenCooldown" type="number" min="0" value="${Number(c.cooldownMinutes||15)}"></div>
            <div><span class="fieldlabel">Basisfaktor</span><input id="stubenBaseFactor" type="number" min="1" step="0.1" value="${Number(c.baseFactor||1.5)}"></div>
            <div><span class="fieldlabel">+ Faktor je weiterer Person</span><input id="stubenFactorStep" type="number" min="0" step="0.1" value="${Number(c.factorPerParticipant||0.1)}"></div>
            <div><span class="fieldlabel">Maximalfaktor</span><input id="stubenMaxFactor" type="number" min="1" step="0.1" value="${Number(c.maxFactor||3)}"></div>
            <div><span class="fieldlabel">Individuell (%)</span><input id="stubenIndividualPct" type="number" min="0" max="100" value="${Number(c.individualModePct||75)}"></div>
            <div><span class="fieldlabel">Alle bestehen (%)</span><input id="stubenAllPassPct" type="number" min="0" max="100" value="${Number(c.allPassModePct||10)}"></div>
            <div><span class="fieldlabel">Alle erwischt (%)</span><input id="stubenAllCaughtPct" type="number" min="0" max="100" value="${Number(c.allCaughtModePct||15)}"></div>
            <div><span class="fieldlabel">Bestehen individuell (%)</span><input id="stubenPassPct" type="number" min="0" max="100" value="${Number(c.individualPassPct||40)}"></div>
            <div><span class="fieldlabel">Kontroll-Animation (Sek.)</span><input id="stubenControlSeconds" type="number" min="1" value="${Number(c.controlAnimationSeconds||7)}"></div>
            <div><span class="fieldlabel">Ergebnis sichtbar (Sek.)</span><input id="stubenResultSeconds" type="number" min="3" value="${Number(c.resultDisplaySeconds||15)}"></div>
            <div><span class="fieldlabel">Overlay: Verbindungsanzeige</span><select id="stubenStatusDisplay"><option value="problem"${(c.overlayStatusDisplay||"problem")==="problem"?" selected":""}>Nur bei Problemen</option><option value="always"${c.overlayStatusDisplay==="always"?" selected":""}>Immer anzeigen</option><option value="never"${c.overlayStatusDisplay==="never"?" selected":""}>Nie anzeigen</option></select></div>
            <div><span class="fieldlabel">Overlay: Lage des Panels</span><select id="stubenOverlayAnchor"><option value="top-left"${(c.overlayAnchor||"bottom-center")==="top-left"?" selected":""}>Oben links</option><option value="top-center"${(c.overlayAnchor||"bottom-center")==="top-center"?" selected":""}>Oben mittig</option><option value="top-right"${(c.overlayAnchor||"bottom-center")==="top-right"?" selected":""}>Oben rechts</option><option value="middle-left"${(c.overlayAnchor||"bottom-center")==="middle-left"?" selected":""}>Mitte links</option><option value="middle-center"${(c.overlayAnchor||"bottom-center")==="middle-center"?" selected":""}>Bildmitte</option><option value="middle-right"${(c.overlayAnchor||"bottom-center")==="middle-right"?" selected":""}>Mitte rechts</option><option value="bottom-left"${(c.overlayAnchor||"bottom-center")==="bottom-left"?" selected":""}>Unten links</option><option value="bottom-center"${(c.overlayAnchor||"bottom-center")==="bottom-center"?" selected":""}>Unten mittig</option><option value="bottom-right"${(c.overlayAnchor||"bottom-center")==="bottom-right"?" selected":""}>Unten rechts</option></select></div>
            <div><span class="fieldlabel">Overlay: Größe des Panels (%)</span><input id="stubenOverlayScale" type="number" min="40" max="100" value="${Number(c.overlayScale||80)}"></div>
            <div><span class="fieldlabel">Overlay: Abstand zum Rand (px)</span><input id="stubenOverlayMargin" type="number" min="0" max="300" value="${Number(c.overlayMargin??60)}"></div>
            <div><span class="fieldlabel">Overlay: Detailstufe</span><select id="stubenOverlayDetail"><option value="full"${(c.overlayDetail||"full")==="full"?" selected":""}>Ausführlich (Karten, Seitenanzeige, Zusatzzeile)</option><option value="compact"${c.overlayDetail==="compact"?" selected":""}>Kompakt (nur Kopfzeile und Ergebnistext)</option></select></div>
            <div><span class="fieldlabel">Overlay: Punkte-Übersicht</span><select id="stubenOverlayPoints"><option value="cards"${(c.overlayPoints||"cards")==="cards"?" selected":""}>Karten (wie bisher)</option><option value="chips"${c.overlayPoints==="chips"?" selected":""}>Chips mit Punkten, sortiert</option></select></div>
            <div><span class="fieldlabel">Overlay: Kasten hinter dem Panel</span><select id="stubenOverlayBox"><option value="on"${(c.overlayBox||"on")==="on"?" selected":""}>An (wie bisher)</option><option value="off"${c.overlayBox==="off"?" selected":""}>Aus (nur Text mit Schatten)</option></select></div>
            <div><span class="fieldlabel">Overlay: Deckkraft des Kastens (%)</span><input id="stubenOverlayBoxOpacity" type="number" min="10" max="100" value="${Number(c.overlayBoxOpacity||100)}"></div>
            <div><span class="fieldlabel">Beitritts-Meldungen im Chat</span><select id="stubenJoinChatMode"><option value="auto"${(c.joinChatMode||"auto")==="auto"?" selected":""}>Automatisch (erste einzeln, danach Sammelmeldung)</option><option value="all"${c.joinChatMode==="all"?" selected":""}>Jeden einzeln</option><option value="everyNth"${c.joinChatMode==="everyNth"?" selected":""}>Nur jeden N-ten</option><option value="off"${c.joinChatMode==="off"?" selected":""}>Aus</option></select></div>
            <div><span class="fieldlabel">Automatisch: einzeln bis Teilnehmer Nr.</span><input id="stubenJoinSingles" type="number" min="1" max="50" value="${Number(c.joinChatAutoSingles||5)}"></div>
            <div><span class="fieldlabel">Automatisch: Sammelmeldung alle (Sek.)</span><input id="stubenJoinSummary" type="number" min="3" max="60" value="${Number(c.joinChatSummarySeconds||10)}"></div>
            <div><span class="fieldlabel">Nur jeden N-ten: N</span><input id="stubenJoinNth" type="number" min="2" max="100" value="${Number(c.joinChatEveryNth||3)}"></div>
          </div>
          <p class="hint">Lage, Größe und Abstand gelten für das Panel im Overlay (bezogen auf 1920×1080). Die Männchen der Anmeldung laufen immer unten am Bildrand; bei einer Lage unten bleibt dafür ein fester Streifen von 120 px frei (der Abstand zum Rand zählt darüber). Das Panel bleibt in jeder Phase an derselben Stelle. Die Punkte-Übersicht „Chips“ zeigt höchstens 12 Teilnehmende (im Ergebnis Gewinner zuerst, nach Betrag sortiert), den Rest als „und N weitere“; in der Detailstufe „Kompakt“ erscheint sie nur im Ergebnis und ersetzt dort die Textzeile mit denselben Punkten. Ohne Kasten steht der Text mit Schatten direkt im Bild. Zum Ausprobieren lassen sich die Werte in der Overlay-Adresse überschreiben, z. B. …#key=…&amp;scale=70&amp;anchor=bottom-center&amp;detail=compact&amp;points=chips&amp;box=off&amp;boxopacity=60.</p>
          <p class="hint">Beitritts-Meldungen betreffen nur den Twitch-Chat. Das Overlay zeigt immer alle Teilnehmenden. Die Eröffnung der Runde, das Ende der Anmeldung und das Ergebnis kommen immer. Twitch erlaubt dem Bot nur eine begrenzte Zahl Nachrichten pro 30 Sekunden; bei vielen Anmeldungen ist „Automatisch“ die sichere Wahl.</p>
          <p class="hint">Die drei Verlaufswahrscheinlichkeiten werden relativ zueinander ausgewertet; 75/10/15 ergibt exakt 100 %. Auszahlungen werden auf ganze ${esc(pointsName())} gerundet.</p>
          <h4>Überschriften im Overlay</h4>
          <div class="stuben-settings-grid">
            <div><span class="fieldlabel">Anmeldung</span><input id="stubenTitleRegistration" maxlength="60" value="${esc(c.overlayTitles?.registration||"")}"></div>
            <div><span class="fieldlabel">Kontrolle</span><input id="stubenTitleControl" maxlength="60" value="${esc(c.overlayTitles?.control||"")}"></div>
            <div><span class="fieldlabel">Ergebnis</span><input id="stubenTitleResult" maxlength="60" value="${esc(c.overlayTitles?.result||"")}"></div>
          </div>
          <p class="hint">Diese Überschriften zeigt das Overlay in den drei Phasen. Leer gelassen gilt die Vorgabe der Installation.</p>
          <h4>Wechselnde Sprüche</h4>
          <div class="stuben-phrase-grid">
            <div><span class="fieldlabel">Runde eröffnet</span><textarea id="stubenPhraseOpened">${esc(stubenPhraseText(c.phrases?.roundOpened))}</textarea></div>
            <div><span class="fieldlabel">Beitritt</span><textarea id="stubenPhraseJoined">${esc(stubenPhraseText(c.phrases?.joined))}</textarea></div>
            <div><span class="fieldlabel">Beitritt (Sammelmeldung: {added}, {count}, {factor})</span><textarea id="stubenPhraseJoinedBatch">${esc(stubenPhraseText(c.phrases?.joinedBatch))}</textarea></div>
            <div><span class="fieldlabel">Kontrolle</span><textarea id="stubenPhraseControl">${esc(stubenPhraseText(c.phrases?.control))}</textarea></div>
            <div><span class="fieldlabel">Alle bestehen</span><textarea id="stubenPhraseAllPass">${esc(stubenPhraseText(c.phrases?.allPass))}</textarea></div>
            <div><span class="fieldlabel">Alle erwischt</span><textarea id="stubenPhraseAllCaught">${esc(stubenPhraseText(c.phrases?.allCaught))}</textarea></div>
            <div><span class="fieldlabel">Individuell</span><textarea id="stubenPhraseIndividual">${esc(stubenPhraseText(c.phrases?.individual))}</textarea></div>
            <div class="stuben-wide"><span class="fieldlabel">Ergebnis</span><textarea id="stubenPhraseResult">${esc(stubenPhraseText(c.phrases?.result))}</textarea></div>
          </div>
          <p class="hint">Ein Spruch pro Zeile. Platzhalter: <code>{user}</code>, <code>{bet}</code>, <code>{seconds}</code>, <code>{count}</code>, <code>{factor}</code>, beim Ergebnis zusätzlich <code>{winners}</code> und <code>{caught}</code>. Die technische Runden-ID bleibt ausschließlich in Verwaltung und Historie sichtbar.</p>
          <button id="stubenSaveConfig" type="button">Spieleinstellungen speichern</button>
        </div>
        <div class="card"><h3>Chat-Befehle</h3><div class="stuben-command-list"><code>${esc(gameCommands().balance)}</code><code>${esc(gameCommands().start)} BETRAG</code><code>!daily</code><code>!give NICK BETRAG</code><code>!gift NICK BETRAG</code><code>${esc(gameCommands().top)}</code><code>${esc(gameCommands().help)}</code></div></div>
      </div>

      <div id="stubenPaneAccounts" class="stuben-pane hidden">
        <div class="card"><div class="title"><div><h3>Punktekonten</h3><p class="hint">Suche nach Name, Twitch-Login oder User-ID.</p></div><input id="stubenAccountSearch" type="search" placeholder="Nutzer suchen …"></div><div id="stubenAccountsList">Lade …</div></div>
        <div class="card"><h3>Letzte Buchungen</h3><div id="stubenTransactionsList">Lade …</div></div>
      </div>

      <div id="stubenPaneRounds" class="stuben-pane hidden"><div class="card"><h3>Rundenhistorie</h3><div id="stubenRoundsList">Lade …</div></div></div>

      <div id="stubenPaneOverlay" class="stuben-pane hidden">
        <div class="card"><h3>Overlay-Verbindung</h3><div class="stuben-overlay-status"><strong>${Number(data.overlay?.connectedClients||0)} Browserquelle(n) verbunden</strong><span>Letzte Verbindung: ${stubenTime(data.overlay?.lastConnectAt)}</span><span>WebSocket-Pfad: <code>${esc(data.overlay?.endpoint||"/ws/stubenkontrolle")}</code></span></div></div>
        <div class="card"><h3>Overlay testen</h3><p class="hint">Diese Tests ändern keinerlei ${esc(pointsName())} oder echte Runden. Die Anmeldung wird 20 Sekunden gezeigt, Kontrolle und Ergebnis so lange wie eingestellt.</p><div class="row"><button class="stuben-test-btn" data-scenario="registration">Anmeldung testen</button><button class="stuben-test-btn" data-scenario="control">Kontrolle testen</button><button class="stuben-test-btn" data-scenario="result">Ergebnis testen</button><button class="stuben-test-btn" data-scenario="caught">Ergebnis: alle erwischt</button></div></div>
        ${admin?`<div class="card"><h3>Externer Overlay-Zugang</h3><p class="hint">Der Schlüssel ist ausschließlich für den lesenden WebSocket-Zugang bestimmt. Seit 8.9.0 gibt es das Overlay als Adresse für jede Browserquelle (OBS am PC oder Mac, Moblin): Nach „Neuen Schlüssel erzeugen“ erscheint die fertige Overlay-Adresse zum Kopieren.</p><div class="stuben-overlay-config"><div><span class="fieldlabel">Öffentliche WSS-Adresse</span><input id="stubenOverlayUrl" value="${esc(c.overlayPublicUrl||"")}" placeholder="${esc(c.overlayEffectiveUrl||"wss://bot.example.org/ws/stubenkontrolle")}"><small class="hint">Leer lassen = automatisch aus der öffentlichen Adresse${c.overlayEffectiveUrl?` (${esc(c.overlayEffectiveUrl)})`:""}.</small></div><div class="stuben-overlay-key-box"><span class="fieldlabel">Schlüssel</span><strong>${esc(c.overlayKey||"noch nicht erzeugt")}</strong></div></div><div class="row"><button id="stubenOverlaySave">Adresse speichern</button><button id="stubenOverlayRotate" class="danger">Neuen Schlüssel erzeugen</button></div><div id="stubenOverlaySecret" class="hint"></div></div>`:""}
        <div class="card"><h3>OBS / Synology</h3><p class="hint">Die fertige ZIP enthält im Ordner <code>overlay/</code> die lokale Browserquelle und eine DSM-Anleitung. Die HTML-Datei bleibt auf dem Streaming-PC; nur die Statusdaten kommen per WSS von der Synology.</p></div>
      </div>

      ${admin?`<div id="stubenPaneAdmin" class="stuben-pane hidden">
        <div class="stuben-admin-grid">
          <div class="card"><h3>${esc(pointsName())} gutschreiben</h3><input id="stubenCreditLogin" placeholder="Twitch-Login"><input id="stubenCreditAmount" type="number" min="1" placeholder="Betrag"><input id="stubenCreditNote" placeholder="Grund (optional)"><button id="stubenCreditBtn">Gutschreiben</button></div>
          <div class="card danger-zone"><h3>Alle ${esc(pointsName())} zurücksetzen</h3><p class="hint">Setzt alle Konten auf 0. Eine laufende Runde wird ohne Erstattung abgebrochen. Startguthaben und Daily-Historie werden nicht zurückgesetzt. Vorher wird automatisch ein lokales Backup angelegt.</p><input id="stubenResetConfirm" placeholder="Zur Bestätigung RESET eingeben"><button id="stubenResetBtn" class="danger-strong">Sämtliche ${esc(pointsName())} resetten</button></div>
        </div>
      </div>`:""}
    `;

    root.querySelectorAll("[data-stuben-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      root.querySelectorAll("[data-stuben-tab]").forEach(x=>x.classList.toggle("active",x===btn));
      root.querySelectorAll(".stuben-pane").forEach(x=>x.classList.add("hidden"));
      $("stubenPane"+btn.dataset.stubenTab[0].toUpperCase()+btn.dataset.stubenTab.slice(1))?.classList.remove("hidden");
      if(btn.dataset.stubenTab==="accounts") loadStubenAccounts();
      if(btn.dataset.stubenTab==="rounds") loadStubenRounds();
    }));

    mountProfileCard($("stubenGameCard"),"game");
    $("stubenRefreshBtn")?.addEventListener("click",renderStubenkontrolle);
    $("stubenSaveConfig")?.addEventListener("click",saveStubenConfig);
    $("stubenAccountSearch")?.addEventListener("input",()=>{clearTimeout(window.__stubenSearchTimer);window.__stubenSearchTimer=setTimeout(loadStubenAccounts,250);});
    root.querySelectorAll(".stuben-test-btn").forEach(btn=>btn.addEventListener("click",()=>testStubenOverlay(btn.dataset.scenario)));
    $("stubenCreditBtn")?.addEventListener("click",stubenAdminCredit);
    $("stubenResetBtn")?.addEventListener("click",stubenResetAll);
    $("stubenOverlaySave")?.addEventListener("click",()=>saveStubenOverlayAccess(false));
    $("stubenOverlayRotate")?.addEventListener("click",()=>saveStubenOverlayAccess(true));
  }catch(e){ root.innerHTML=`<div class="card error">${esc(gameName())} konnte nicht geladen werden: ${esc(e.message)}</div>`; }
}

async function saveStubenConfig(){
  const payload={
    enabled:!!$("stubenEnabled")?.checked,bot:$("stubenBot")?.value,
    starterPoints:Number($("stubenStarter")?.value||0),dailyPoints:Number($("stubenDaily")?.value||0),
    giftMaxAmount:Number($("stubenGiftMax")?.value||0),giftAllowBroadcaster:!!$("stubenGiftBroadcaster")?.checked,giftAllowControlOwners:!!$("stubenGiftOwners")?.checked, // 9.10.0
    minBet:Number($("stubenMinBet")?.value||1),maxBet:Number($("stubenMaxBet")?.value||1),registrationSeconds:Number($("stubenRegistration")?.value||60),cooldownMinutes:Number($("stubenCooldown")?.value||15),
    baseFactor:Number($("stubenBaseFactor")?.value||1.5),factorPerParticipant:Number($("stubenFactorStep")?.value||0.1),maxFactor:Number($("stubenMaxFactor")?.value||3),
    individualModePct:Number($("stubenIndividualPct")?.value||75),allPassModePct:Number($("stubenAllPassPct")?.value||10),allCaughtModePct:Number($("stubenAllCaughtPct")?.value||15),individualPassPct:Number($("stubenPassPct")?.value||40),
    controlAnimationSeconds:Number($("stubenControlSeconds")?.value||7),resultDisplaySeconds:Number($("stubenResultSeconds")?.value||15),overlayStatusDisplay:String($("stubenStatusDisplay")?.value||"problem"),
    overlayAnchor:String($("stubenOverlayAnchor")?.value||"bottom-center"),overlayScale:Number($("stubenOverlayScale")?.value||80),overlayMargin:Number($("stubenOverlayMargin")?.value??60),overlayDetail:String($("stubenOverlayDetail")?.value||"full"),overlayPoints:String($("stubenOverlayPoints")?.value||"cards"),overlayBox:String($("stubenOverlayBox")?.value||"on"),overlayBoxOpacity:Number($("stubenOverlayBoxOpacity")?.value||100),
    joinChatMode:String($("stubenJoinChatMode")?.value||"auto"),joinChatAutoSingles:Number($("stubenJoinSingles")?.value||5),joinChatSummarySeconds:Number($("stubenJoinSummary")?.value||10),joinChatEveryNth:Number($("stubenJoinNth")?.value||3),
    overlayTitles:{registration:$("stubenTitleRegistration")?.value||"",control:$("stubenTitleControl")?.value||"",result:$("stubenTitleResult")?.value||""},
    phrases:{roundOpened:stubenReadPhrase("stubenPhraseOpened"),joined:stubenReadPhrase("stubenPhraseJoined"),joinedBatch:stubenReadPhrase("stubenPhraseJoinedBatch"),control:stubenReadPhrase("stubenPhraseControl"),allPass:stubenReadPhrase("stubenPhraseAllPass"),allCaught:stubenReadPhrase("stubenPhraseAllCaught"),individual:stubenReadPhrase("stubenPhraseIndividual"),result:stubenReadPhrase("stubenPhraseResult")}
  };
  const r=await fetch("/api/stubenkontrolle/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const j=await r.json(); if(!r.ok) return showToast(j.error||"Speichern fehlgeschlagen","error",5000);
  showToast("Spieleinstellungen gespeichert."); renderStubenkontrolle();
}

function stubenPartyLabel(a,userId){
  if(a?.name||a?.login)return `${a.name||a.login}${a.login?` (@${a.login})`:""}`;
  return userId?`Twitch-ID ${userId}`:"–";
}
function stubenBookingTypeLabel(type){
  return ({
    transfer_out:"Transfer",transfer_in:"Transfer",admin_credit:"Admin-Gutschrift",daily:"Daily",gift:"Geschenk (!gift)",
    starter:"Startguthaben",round_reserve:"Rundeneinsatz",round_payout:"Rundengewinn",
    round_loss:"Rundenverlust",round_abort_refund:"Rückerstattung",admin_round_refund:"Admin-Rückerstattung",
    round_reset_forfeit:"Reset-Verfall",reset_all:"Gesamtreset"
  })[type]||type;
}
function stubenPrepareTransactions(rows=[]){
  const used=new Set(),out=[];
  for(let i=0;i<rows.length;i++){
    if(used.has(i))continue;
    const t=rows[i];
    if(t.type==="transfer_in"||t.type==="transfer_out"){
      const opposite=t.type==="transfer_in"?"transfer_out":"transfer_in";
      let pair=-1;
      for(let j=i+1;j<rows.length;j++){
        if(used.has(j))continue;
        const x=rows[j];
        if(x.type!==opposite)continue;
        if(String(x.userId||"")!==String(t.otherUserId||"")||String(x.otherUserId||"")!==String(t.userId||""))continue;
        if(Number(x.amount)!==-Number(t.amount))continue;
        if(Math.abs(Date.parse(x.ts)-Date.parse(t.ts))>5000)continue;
        pair=j;break;
      }
      if(pair>=0){
        used.add(pair);
        const incoming=t.type==="transfer_in"?t:rows[pair];
        out.push({...incoming,__transfer:true});
      }else out.push({...t,__transfer:true});
      used.add(i);continue;
    }
    out.push(t);used.add(i);
  }
  return out;
}
function stubenBookingDescription(t){
  const actor=t.actor?String(t.actor):"Admin";
  const user=stubenPartyLabel(t.user,t.userId),other=stubenPartyLabel(t.otherUser,t.otherUserId);
  if(t.type==="transfer_out")return `${user} → ${other}`;
  if(t.type==="transfer_in")return `${other} → ${user}`;
  if(t.type==="admin_credit")return `${actor} → ${user}`;
  if(t.type==="daily"||t.type==="starter")return `System → ${user}`;
  if(t.type==="round_reserve")return `${user} → Runde`;
  if(t.type==="round_payout"||t.type==="round_abort_refund"||t.type==="admin_round_refund")return `Runde/System → ${user}`;
  if(t.type==="round_loss"||t.type==="round_reset_forfeit")return `${user} → System`;
  if(t.type==="reset_all")return `${user} → Reset`;
  return t.note||user;
}
async function loadStubenAccounts(){
  const q=$("stubenAccountSearch")?.value||""; const r=await fetch(`/api/stubenkontrolle/accounts?search=${encodeURIComponent(q)}&limit=100`,{cache:"no-store"}); const j=await r.json();
  if($("stubenAccountsList")) $("stubenAccountsList").innerHTML=(j.accounts||[]).length?`<div class="stuben-table"><div class="stuben-table-head"><div>Nutzer</div><div>Verfügbar</div><div>Reserviert</div><div>Gesamt</div><div>Daily</div></div>${j.accounts.map(a=>`<div class="stuben-table-row"><div><strong>${esc(a.name)}</strong><small>@${esc(a.login)} · ${esc(a.userId)}</small></div><div>${stubenFmt(a.balance)}</div><div>${stubenFmt(a.reserved)}</div><div><strong>${stubenFmt(a.total)}</strong></div><div>${esc(a.lastDailyDate||"–")}</div></div>`).join("")}</div>`:`<p class="hint">Keine Konten gefunden.</p>`;
  const tr=await fetch("/api/stubenkontrolle/transactions?limit=80",{cache:"no-store"}); const tj=await tr.json(); const txRows=stubenPrepareTransactions(tj.transactions||[]); if($("stubenTransactionsList")) $("stubenTransactionsList").innerHTML=txRows.map(t=>`<div class="stuben-booking"><div><strong>${esc(stubenBookingTypeLabel(t.type))}</strong><small>${esc(stubenBookingDescription(t))}${t.roundId?` · ${esc(t.roundId)}`:""}</small></div><span class="${Number(t.amount)>=0?"stuben-plus":"stuben-minus"}">${Number(t.amount)>=0?"+":""}${stubenFmt(t.amount)}</span><time>${stubenTime(t.ts)}</time></div>`).join("")||'<p class="hint">Noch keine Buchungen.</p>';
}
async function loadStubenRounds(){
  const r=await fetch("/api/stubenkontrolle/rounds?limit=80",{cache:"no-store"}); const j=await r.json(); const admin=hasRole("admin");
  if($("stubenRoundsList")) $("stubenRoundsList").innerHTML=(j.rounds||[]).map(x=>`<div class="stuben-round"><div class="stuben-round-head"><div><strong>${esc(x.id)}</strong><small>${stubenTime(x.endedAt||x.createdAt)} · ${esc(x.status)} · ${x.participants?.length||0} Personen · x${x.factor||"–"}</small></div>${admin&&x.status==="completed"?`<button class="stuben-refund-round danger" data-round="${esc(x.id)}">Verlorene Einsätze erstatten</button>`:""}</div><div class="stuben-round-people">${(x.participants||[]).map(p=>`<span class="stuben-person ${p.outcome||""}">${esc(p.name)} · ${stubenFmt(p.bet)} → ${p.outcome==="passed"?`+${stubenFmt(p.delta)}`:p.outcome==="caught"?`-${stubenFmt(p.bet)}`:"offen"}${admin&&p.outcome==="caught"?` <button class="stuben-refund-person" data-round="${esc(x.id)}" data-user="${esc(p.userId)}">↩</button>`:""}</span>`).join("")}</div></div>`).join("")||'<p class="hint">Noch keine Runden.</p>';
  document.querySelectorAll(".stuben-refund-round").forEach(b=>b.addEventListener("click",()=>stubenRefund(b.dataset.round,null)));
  document.querySelectorAll(".stuben-refund-person").forEach(b=>b.addEventListener("click",()=>stubenRefund(b.dataset.round,b.dataset.user)));
}
async function stubenRefund(roundId,userId){
  if(!(await askAs("refund",userId?"Verlorenen Einsatz dieses Teilnehmers erstatten?":"Alle noch nicht erstatteten verlorenen Einsätze dieser Runde erstatten?"))) return;
  const r=await fetch("/api/stubenkontrolle/admin/refund",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({roundId,userId})}); const j=await r.json(); if(!r.ok) return showToast(j.error||"Erstattung fehlgeschlagen","error",5000); showToast(`${j.count} Erstattung(en), ${stubenFmt(j.total)} ${pointsName()}.`); loadStubenRounds();
}
async function stubenAdminCredit(){
  const payload={login:$("stubenCreditLogin")?.value,amount:Number($("stubenCreditAmount")?.value||0),note:$("stubenCreditNote")?.value}; const r=await fetch("/api/stubenkontrolle/admin/credit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); const j=await r.json(); if(!r.ok) return showToast(j.error||"Gutschrift fehlgeschlagen","error",5000); showToast(`@${j.account.login}: ${stubenFmt(j.account.balance)} verfügbar.`);
}
async function stubenResetAll(){
  const confirmation=$("stubenResetConfirm")?.value||""; if(confirmation!=="RESET") return showToast("Bitte exakt RESET eingeben.","warning",4500);
  if(!(await askAs("reset",`WIRKLICH sämtliche ${pointsName()} auf 0 setzen? Eine laufende Runde wird ohne Erstattung abgebrochen.`))) return;
  const r=await fetch("/api/stubenkontrolle/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmation})}); const j=await r.json(); if(!r.ok) return showToast(j.error||"Reset fehlgeschlagen","error",6000); showToast(`Reset durchgeführt. ${j.accounts} Konten, ${stubenFmt(j.totalBurned)} Punkte entfernt. Sicherung wurde erstellt.`,"success",6000); renderStubenkontrolle();
}
// 8.9.0: Overlay-Adresse aus der öffentlichen WSS-Adresse ableiten (nicht aus der LAN-Adresse, mit der das Portal gerade offen ist).
function stubenOverlayPageUrl(wsUrl,key){
  let origin=location.origin;
  try{const w=new URL(String(wsUrl||""));if(w.protocol==="wss:"||w.protocol==="ws:")origin=(w.protocol==="wss:"?"https://":"http://")+w.host;}catch{}
  return `${origin}/stubenkontrolle/overlay#key=${encodeURIComponent(String(key||""))}`;
}
async function testStubenOverlay(scenario){ const r=await fetch("/api/stubenkontrolle/test-overlay",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scenario})}); const j=await r.json(); if(!r.ok) showToast(j.error||"Test fehlgeschlagen","error",5000); else showToast(`Overlay-Test „${scenario}“ läuft für ca. 20 Sekunden.`); }
async function saveStubenOverlayAccess(generate){
  const url=$("stubenOverlayUrl")?.value||""; if(generate && !(await askAs("regenerate","Neuen Overlay-Schlüssel erzeugen? Der bisherige Schlüssel funktioniert danach nicht mehr."))) return;
  const r=await fetch("/api/stubenkontrolle/overlay-access",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,generate})}); const j=await r.json(); if(!r.ok) return showToast(j.error||"Overlay-Zugang konnte nicht gespeichert werden","error",5000);
  if($("stubenOverlaySecret")) $("stubenOverlaySecret").innerHTML=`<strong>WSS:</strong> <code>${esc(j.overlayEffectiveUrl||j.overlayPublicUrl)}</code><br><strong>Schlüssel:</strong> <code>${esc(j.overlayKey)}</code><br><strong>Overlay-Adresse für OBS/Moblin:</strong> <code>${esc(stubenOverlayPageUrl(j.overlayEffectiveUrl||j.overlayPublicUrl,j.overlayKey))}</code><br>Diese Adresse in jeder Browserquelle (1920 × 1080) eintragen. Alte Verbindungen mit dem vorherigen Schlüssel werden getrennt.`;
}


let wordFilterState={data:null,activeTab:"words",query:"",category:"",platform:"all",severity:"all",status:"all",source:"all",detection:"all",sort:"term_asc",page:1,pageSize:50};
function wordFilterActionOptions(v){return ["allow","log","notify","delete","warn","timeout"].map(x=>`<option value="${x}" ${x===v?"selected":""}>${({allow:"Zulassen",log:"Nur protokollieren",notify:"Moderator benachrichtigen",delete:"Nachricht löschen",warn:"Verwarnen",timeout:"Timeout"})[x]}</option>`).join("");}
function wordFilterActionLabel(v){return ({allow:"Zulassen",log:"Protokollieren",notify:"Moderator-Hinweis",delete:"Löschen",warn:"Verwarnen",timeout:"Timeout"})[v]||"Protokollieren";}
function wordFilterEffectiveAction(term,platform,policies){const pr=(term.platforms||[]).find(p=>p.platform===platform)||{};const pol=(policies||[]).find(p=>p.category_id===term.category_id&&p.platform===platform)||{};return term.test_only?"log":(pr.action||pol.action||"log");}
async function renderWordFilter(forceFetch=true){
  const root=$("wordFilter");if(!root)return;
  if(forceFetch||!wordFilterState.data)root.innerHTML=`<div class="card">Wortfilter wird geladen …</div>`;
  try{
    let d=wordFilterState.data;
    if(forceFetch||!d){const r=await fetch("/api/word-filter",{cache:"no-store"});d=await r.json();if(!r.ok)throw new Error(d.error||"Wortfilter konnte nicht geladen werden.");wordFilterState.data=d;}
    const cats=d.categories||[],terms=d.terms||[];
    const catNames=new Map(cats.map(c=>[c.category_id,c.name]));
    const q=wordFilterState.query.trim().toLocaleLowerCase("de-DE"),cat=wordFilterState.category,platform=wordFilterState.platform;
    const severity=wordFilterState.severity,status=wordFilterState.status,source=wordFilterState.source,detection=wordFilterState.detection;
    const sources=[...new Set(terms.map(t=>String(t.source_name||t.origin||"manuell")).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de"));
    let filtered=terms.filter(t=>{
      const plats=t.platforms||[],tw=plats.find(p=>p.platform==="twitch"),dc=plats.find(p=>p.platform==="discord");
      const searchable=[t.term,t.category_id,catNames.get(t.category_id),t.source_name,t.origin,t.detection_type].some(x=>String(x||"").toLocaleLowerCase("de-DE").includes(q));
      const platformOk=platform==="all"||(platform==="twitch"&&tw?.enabled)||(platform==="discord"&&dc?.enabled)||(platform==="both"&&tw?.enabled&&dc?.enabled)||(platform==="none"&&!tw?.enabled&&!dc?.enabled);
      const statusOk=status==="all"||(status==="active"&&t.enabled&&!t.test_only)||(status==="test"&&t.test_only)||(status==="disabled"&&!t.enabled&&!t.test_only);
      return (!q||searchable)&&(!cat||t.category_id===cat)&&platformOk&&(severity==="all"||Number(t.severity)===Number(severity))&&(statusOk)&&(source==="all"||String(t.source_name||t.origin||"manuell")===source)&&(detection==="all"||t.detection_type===detection);
    });
    const sorters={term_asc:(a,b)=>String(a.term).localeCompare(String(b.term),"de",{sensitivity:"base"}),term_desc:(a,b)=>String(b.term).localeCompare(String(a.term),"de",{sensitivity:"base"}),severity_desc:(a,b)=>Number(b.severity)-Number(a.severity)||String(a.term).localeCompare(String(b.term),"de"),severity_asc:(a,b)=>Number(a.severity)-Number(b.severity)||String(a.term).localeCompare(String(b.term),"de"),category_asc:(a,b)=>String(catNames.get(a.category_id)||a.category_id).localeCompare(String(catNames.get(b.category_id)||b.category_id),"de")||String(a.term).localeCompare(String(b.term),"de")};
    filtered=filtered.sort(sorters[wordFilterState.sort]||sorters.term_asc);
    const pageSize=Number(wordFilterState.pageSize||50),pages=Math.max(1,Math.ceil(filtered.length/pageSize));wordFilterState.page=Math.min(Math.max(1,Number(wordFilterState.page||1)),pages);
    const pageStart=(wordFilterState.page-1)*pageSize,pageTerms=filtered.slice(pageStart,pageStart+pageSize);
    const activeTab=wordFilterState.activeTab||"words";
    const tabNav=`<nav class="moderation-subnav word-filter-tabs" aria-label="Wortfilter-Bereiche">
      <button type="button" class="moderation-subtab ${activeTab==="words"?"active":""}" data-wf-tab="words">Wortbestand</button>
      <button type="button" class="moderation-subtab ${activeTab==="policies"?"active":""}" data-wf-tab="policies">Kategorien & Maßnahmen</button>
      <button type="button" class="moderation-subtab ${activeTab==="allowlist"?"active":""}" data-wf-tab="allowlist">Allowlist</button>
      <button type="button" class="moderation-subtab ${activeTab==="import"?"active":""}" data-wf-tab="import">Import / Export</button>
      <button type="button" class="moderation-subtab ${activeTab==="test"?"active":""}" data-wf-tab="test">Testlabor</button>
      <button type="button" class="moderation-subtab ${activeTab==="stats"?"active":""}" data-wf-tab="stats">Statistik</button>
    </nav>`;
    const wordsTab=activeTab==="words"?`<div class="card wf-filter-card"><div class="title compact-title"><div><h3>Suche & Filter</h3><p class="hint">Die Filter wirken auf den Wortbestand, ohne die Daten erneut vom Server zu laden.</p><p class="hint"><strong>Grad:</strong> 1 niedrig · 2 auffällig · 3 deutlich · 4 schwer · 5 kritisch. Die tatsächliche Maßnahme steht separat unter Wirkung.</p></div><button id="wfResetFilters" class="secondary">Filter zurücksetzen</button></div><div class="wf-filter-grid"><label class="wf-search-wide">Suche<input id="wfSearch" placeholder="Begriff, Quelle, Kategorie …" value="${esc(wordFilterState.query)}"></label><label>Kategorie<select id="wfCategory"><option value="">Alle Kategorien</option>${cats.map(c=>`<option value="${esc(c.category_id)}" ${cat===c.category_id?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label><label>Plattform<select id="wfPlatform"><option value="all">Alle Plattformen</option><option value="twitch" ${platform==="twitch"?"selected":""}>Twitch aktiv</option><option value="discord" ${platform==="discord"?"selected":""}>Discord aktiv</option><option value="both" ${platform==="both"?"selected":""}>Auf beiden aktiv</option><option value="none" ${platform==="none"?"selected":""}>Keine Plattform aktiv</option></select></label><label>Status<select id="wfStatus"><option value="all">Alle Status</option><option value="active" ${status==="active"?"selected":""}>Aktiv</option><option value="test" ${status==="test"?"selected":""}>Testmodus</option><option value="disabled" ${status==="disabled"?"selected":""}>Aus</option></select></label><label>Grad<select id="wfSeverity"><option value="all">Alle Grade</option>${[1,2,3,4,5].map(n=>`<option value="${n}" ${String(severity)===String(n)?"selected":""}>Grad ${n}</option>`).join("")}</select></label><label>Erkennung<select id="wfDetection"><option value="all">Alle Erkennungsarten</option>${[["whole_word","Ganzes Wort"],["phrase","Phrase"],["substring","Teilstring"],["regex","Regex"]].map(([v,l])=>`<option value="${v}" ${detection===v?"selected":""}>${l}</option>`).join("")}</select></label><label>Quelle<select id="wfSource"><option value="all">Alle Quellen</option>${sources.map(v=>`<option value="${esc(v)}" ${source===v?"selected":""}>${esc(v)}</option>`).join("")}</select></label><label>Sortierung<select id="wfSort"><option value="term_asc" ${wordFilterState.sort==="term_asc"?"selected":""}>Begriff A–Z</option><option value="term_desc" ${wordFilterState.sort==="term_desc"?"selected":""}>Begriff Z–A</option><option value="severity_desc" ${wordFilterState.sort==="severity_desc"?"selected":""}>Grad hoch → niedrig</option><option value="severity_asc" ${wordFilterState.sort==="severity_asc"?"selected":""}>Grad niedrig → hoch</option><option value="category_asc" ${wordFilterState.sort==="category_asc"?"selected":""}>Kategorie A–Z</option></select></label><button id="wfApplyFilters">Filter anwenden</button></div></div>
      <div class="card"><div class="title compact-title"><div><h3>Begriff hinzufügen</h3><p class="hint">Schweregrad und Maßnahme sind getrennt konfigurierbar.</p></div></div><div class="grid two-col"><label>Begriff / Phrase<input id="wfNewTerm"></label><label>Kategorie<select id="wfNewCategory">${cats.map(c=>`<option value="${esc(c.category_id)}">${esc(c.name)}</option>`).join("")}</select></label><label>Schweregrad<select id="wfNewSeverity">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===2?"selected":""}>${n}</option>`).join("")}</select></label><label>Erkennung<select id="wfNewDetection"><option value="whole_word">Ganzes Wort</option><option value="phrase">Phrase</option><option value="substring">Teilstring</option><option value="regex">Regex</option></select></label></div><div class="row wrap"><label class="toggle-row"><input id="wfNewTwitch" type="checkbox" checked><span>Twitch</span></label><label class="toggle-row"><input id="wfNewDiscord" type="checkbox" checked><span>Discord</span></label><label class="toggle-row"><input id="wfNewTest" type="checkbox"><span>Testmodus</span></label><label class="toggle-row"><input id="wfNewLeet" type="checkbox"><span>Leetspeak</span></label><label class="toggle-row"><input id="wfNewRepeat" type="checkbox"><span>Wiederholte Buchstaben</span></label><label class="toggle-row"><input id="wfNewSeparators" type="checkbox"><span>Sonderzeichen-Trennung</span></label><button id="wfAddTerm">Hinzufügen</button></div></div>
      <div class="card"><div class="title compact-title"><div><h3>Wortbestand</h3><p class="hint"><strong>${filtered.length}</strong> von ${terms.length} Begriffen · Seite ${wordFilterState.page} von ${pages} · ${pageSize} pro Seite</p></div><div class="wf-result-summary">${q||cat||platform!=="all"||severity!=="all"||status!=="all"||source!=="all"||detection!=="all"?'<span class="wf-chip">Filter aktiv</span>':''}</div></div><details class="wf-bulk-panel"><summary>Massenbearbeitung</summary><div class="row wrap wf-bulk"><button id="wfSelectAll" class="secondary">Seite auswählen</button><select id="wfBulkCategory"><option value="">Kategorie beibehalten</option>${cats.map(c=>`<option value="${esc(c.category_id)}">${esc(c.name)}</option>`).join("")}</select><select id="wfBulkSeverity"><option value="">Grad beibehalten</option>${[1,2,3,4,5].map(n=>`<option value="${n}">Grad ${n}</option>`).join("")}</select><select id="wfBulkMode"><option value="">Status beibehalten</option><option value="enable">Aktivieren</option><option value="disable">Deaktivieren</option><option value="test">Testmodus</option></select><select id="wfBulkTwitch"><option value="keep">Twitch beibehalten</option><option value="on">Twitch aktivieren</option><option value="off">Twitch deaktivieren</option></select><select id="wfBulkDiscord"><option value="keep">Discord beibehalten</option><option value="on">Discord aktivieren</option><option value="off">Discord deaktivieren</option></select><select id="wfBulkLeet"><option value="keep">Leetspeak beibehalten</option><option value="on">Leetspeak aktivieren</option><option value="off">Leetspeak deaktivieren</option></select><select id="wfBulkRepeat"><option value="keep">Wiederholte Buchstaben beibehalten</option><option value="on">Wiederholte Buchstaben aktivieren</option><option value="off">Wiederholte Buchstaben deaktivieren</option></select><select id="wfBulkSeparators"><option value="keep">Sonderzeichen-Trennung beibehalten</option><option value="on">Sonderzeichen-Trennung aktivieren</option><option value="off">Sonderzeichen-Trennung deaktivieren</option></select><button id="wfBulkApply">Auswahl anwenden</button></div></details><div class="wf-table"><div class="wf-head"><span>Begriff</span><span>Kategorie</span><span>Grad</span><span>Plattformen</span><span>Wirkung</span><span>Status</span><span>Aktionen</span></div>${pageTerms.map(t=>{const tw=(t.platforms||[]).find(p=>p.platform==="twitch"),dc=(t.platforms||[]).find(p=>p.platform==="discord"),categoryName=catNames.get(t.category_id)||t.category_id,statusLabel=t.test_only?"TEST":t.enabled?"AKTIV":"AUS",statusClass=t.test_only?"test":t.enabled?"active":"off",effects=[];if(tw?.enabled)effects.push(`T: ${wordFilterActionLabel(wordFilterEffectiveAction(t,"twitch",d.policies))}`);if(dc?.enabled)effects.push(`D: ${wordFilterActionLabel(wordFilterEffectiveAction(t,"discord",d.policies))}`);return `<div class="wf-row" data-term-id="${esc(t.term_id)}"><span data-label="Begriff"><label class="wf-select"><input type="checkbox" class="wfSelectTerm" data-id="${esc(t.term_id)}"><span><strong>${esc(t.term)}</strong><small>${esc(t.detection_type)} · ${esc(t.source_name||t.origin||"manuell")}</small></span></label></span><span data-label="Kategorie"><span class="wf-category">${esc(categoryName)}</span></span><span data-label="Grad"><span class="wf-grade">${Number(t.severity||0)}</span></span><span data-label="Plattformen"><span class="wf-platforms"><span class="wf-chip ${tw?.enabled?"on":"off"}">Twitch</span><span class="wf-chip ${dc?.enabled?"on":"off"}">Discord</span></span></span><span data-label="Wirkung"><small>${esc(effects.join(" · ")||"–")}</small></span><span data-label="Status"><span class="wf-status ${statusClass}">${statusLabel}</span></span><span data-label="Aktionen" class="wf-actions"><button class="secondary wfEditTerm" data-id="${esc(t.term_id)}">Bearbeiten</button><button class="danger secondary wfDeleteTerm" data-id="${esc(t.term_id)}">Löschen</button></span></div>`}).join("")||'<div class="wf-empty"><strong>Keine Begriffe gefunden.</strong><span>Filter ändern oder zurücksetzen.</span></div>'}</div><div class="wf-pagination"><button id="wfPrevPage" class="secondary" ${wordFilterState.page<=1?"disabled":""}>← Zurück</button><span>Seite ${wordFilterState.page} / ${pages}</span><select id="wfPageSize"><option value="25" ${pageSize===25?"selected":""}>25 / Seite</option><option value="50" ${pageSize===50?"selected":""}>50 / Seite</option><option value="100" ${pageSize===100?"selected":""}>100 / Seite</option></select><button id="wfNextPage" class="secondary" ${wordFilterState.page>=pages?"disabled":""}>Weiter →</button></div></div>`:"";
    const policiesTab=activeTab==="policies"?`<div class="card"><h3>Kategorien & Maßnahmen</h3><p class="hint">Maßnahmen werden pro Plattform und Kategorie gesetzt. <strong>Der Grad 1–5 ist nur die fachliche Schwere und löst keine Aktion automatisch aus.</strong> Entscheidend ist die hier gewählte Maßnahme.</p><div class="notice wf-severity-help"><strong>Schweregrad:</strong> 1 niedrig · 2 auffällig · 3 deutlich · 4 schwer · 5 kritisch. Beispiel: Grad 3 + „Moderator benachrichtigen“ löscht die Nachricht nicht.</div><p class="hint"><strong>Moderator benachrichtigen:</strong> sendet einen Eintrag in den unter Discord → Administration → Logs & Benachrichtigungen konfigurierten Moderations-Logkanal. Im Moderationsprotokoll wird das konkrete Ziel angezeigt.</p><div class="row wrap"><input id="wfNewCategoryName" placeholder="Neue benutzerdefinierte Kategorie"><button id="wfAddCategory" class="secondary">Kategorie anlegen</button></div><div class="wf-policies">${cats.map(c=>{const tw=(d.policies||[]).find(p=>p.category_id===c.category_id&&p.platform==="twitch")||{},dc=(d.policies||[]).find(p=>p.category_id===c.category_id&&p.platform==="discord")||{};return `<div class="wf-policy"><strong>${esc(c.name)}</strong><div class="wf-policy-platform"><label>Twitch<select data-policy-category="${esc(c.category_id)}" data-policy-platform="twitch">${wordFilterActionOptions(tw.action||"log")}</select></label><label>Timeout Sek.<input type="number" min="1" max="1209600" data-policy-timeout-category="${esc(c.category_id)}" data-policy-timeout-platform="twitch" value="${Number(tw.timeout_seconds||600)}"></label><label>Hinweistext bei „Verwarnen“<textarea rows="2" data-policy-message-category="${esc(c.category_id)}" data-policy-message-platform="twitch" placeholder="@{user} bitte beachte unsere Chatregeln.">${esc(tw.message_template||"")}</textarea></label><small class="hint">Variablen: {user}, {term}, {category}, {severity}</small><label class="toggle-row"><input type="checkbox" data-policy-escalate-category="${esc(c.category_id)}" data-policy-escalate-platform="twitch" ${tw.escalate?"checked":""}><span>Wiederholungen eskalieren</span></label></div><div class="wf-policy-platform"><label>Discord<select data-policy-category="${esc(c.category_id)}" data-policy-platform="discord">${wordFilterActionOptions(dc.action||"log")}</select></label><label>Timeout Sek.<input type="number" min="1" max="1209600" data-policy-timeout-category="${esc(c.category_id)}" data-policy-timeout-platform="discord" value="${Number(dc.timeout_seconds||600)}"></label><label>Hinweistext bei „Verwarnen“<textarea rows="2" data-policy-message-category="${esc(c.category_id)}" data-policy-message-platform="discord" placeholder="{mention} bitte beachte unsere Community-Regeln.">${esc(dc.message_template||"")}</textarea></label><small class="hint">Variablen: {mention}, {user}, {term}, {category}, {severity}</small><label class="toggle-row"><input type="checkbox" data-policy-escalate-category="${esc(c.category_id)}" data-policy-escalate-platform="discord" ${dc.escalate?"checked":""}><span>Wiederholungen eskalieren</span></label></div></div>`}).join("")}</div><button id="wfSavePolicies">Maßnahmen speichern</button></div>`:"";
    const allowlistTab=activeTab==="allowlist"?`<div class="card"><h3>Allowlist</h3><div class="row wrap"><input id="wfAllowValue" placeholder="Erlaubter Begriff / Phrase"><select id="wfAllowPlatform"><option value="both">Beide</option><option value="twitch">Twitch</option><option value="discord">Discord</option></select><button id="wfAllowAdd">Hinzufügen</button></div>${(d.allowlist||[]).map(a=>`<div class="wf-simple-row"><span>${esc(a.value)} <small>${esc(a.platform)}</small></span><button class="secondary danger wfAllowDelete" data-id="${esc(a.allow_id)}">Entfernen</button></div>`).join("")||'<p class="hint">Keine Allowlist-Einträge.</p>'}</div>`:"";
    const importTab=activeTab==="import"?`<div class="card"><h3>Import / Export</h3><p class="hint">TXT: eine Zeile pro Begriff. CSV: erste Spalte Begriff oder Spalte <code>term</code>. JSON: Array oder Objekt mit <code>terms</code>. Max. 5.000 Begriffe. Importe werden standardmäßig deaktiviert und im Testmodus angelegt. Der eingebaute deutsche LDNOOBW-Stand umfasst 66 Einträge; Quelle: LDNOOBW, CC BY 4.0. Keine automatischen Online-Updates.</p><div class="row wrap"><input id="wfImportFile" type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json"><button id="wfImportPreview" class="secondary">Vorschau</button><button id="wfLdnoobw" class="secondary">LDNOOBW/de (66) importieren</button><button id="wfExport" class="secondary">JSON exportieren</button></div><div id="wfImportResult"></div><div class="wf-import-history">${(d.imports||[]).slice(0,10).map(i=>`<div class="wf-simple-row"><span>${esc(i.source_name)} · ${Number(i.inserted_count||0)} neu / ${Number(i.duplicate_count||0)} Dubletten · ${esc(i.status)}</span>${i.status==="applied"?`<button class="secondary danger wfRollback" data-id="${esc(i.import_id)}">Rollback</button>`:""}</div>`).join("")}</div></div>`:"";
    const testTab=activeTab==="test"?`<div class="card"><h3>Testlabor</h3><div class="grid two-col"><label>Plattform<select id="wfTestPlatform"><option value="twitch">Twitch</option><option value="discord">Discord</option></select></label><label>Testnachricht<textarea id="wfTestText" rows="3" placeholder="Nachricht ohne produktive Sanktion testen …"></textarea></label></div><button id="wfTestBtn" class="secondary">Erkennung prüfen</button><div id="wfTestResult"></div></div>`:"";
    const statsTab=activeTab==="stats"?`<div class="card"><div class="title compact-title"><div><h3>Trefferstatistik / mögliche Fehlalarme</h3><p class="hint">Detailtreffer werden nach der Aufbewahrungsfrist gelöscht; aggregierte Zähler bleiben.</p></div><div class="row"><input id="wfRetentionDays" type="number" min="1" max="3650" value="${Number(d.retentionDays||90)}" style="max-width:100px"><button id="wfRetentionSave" class="secondary">Tage speichern</button></div></div>${(d.stats||[]).slice(0,30).map(x=>`<div class="wf-simple-row"><span><strong>${esc(x.term)}</strong> · ${Number(x.hits||0)} Treffer · ${Number(x.false_positives||0)} Fehlalarme</span><small>${x.last_hit_at?esc(new Date(x.last_hit_at).toLocaleString()):"–"}</small></div>`).join("")||'<p class="hint">Noch keine Treffer.</p>'}<h4>Letzte Treffer</h4>${(d.hits||[]).slice(0,20).map(h=>`<div class="wf-simple-row"><span>${esc(h.term||h.term_id||"unbekannt")} · ${esc(h.platform)} · ${esc(h.action||"log")} · ${esc(new Date(h.occurred_at).toLocaleString())}${h.false_positive?" · FEHLALARM":""}</span>${h.false_positive?"":`<button class="secondary wfFalsePositive" data-id="${Number(h.hit_id)}">Als Fehlalarm markieren</button>`}</div>`).join("")||'<p class="hint">Noch keine Treffer protokolliert.</p>'}</div>`:"";
    root.innerHTML=`
      <div class="title"><div><h2>Zentraler Wortfilter</h2><p class="hint">Gemeinsamer Wortbestand für Twitch und Discord · Revision ${Number(d.revision||0)} · ${terms.length} Begriffe</p></div><button id="wfRefresh" class="secondary">Neu laden</button></div>
      <div class="card wf-active"><h3>Wortfilter aktiv</h3><p class="hint">Je Plattform ein- und ausschaltbar, auch über Event-Profile. Der Wortbestand bleibt erhalten.</p>
        <div class="wf-active-row">${["twitch","discord"].map(p=>`<label class="module-switch-row"><span>${p==="twitch"?"Twitch":"Discord"}</span><span class="module-switch"><input type="checkbox" role="switch" data-wf-active="${p}" ${d.active?.[p]?.enabled!==false?"checked":""} aria-label="Wortfilter auf ${p==="twitch"?"Twitch":"Discord"} ein- oder ausschalten"><span class="module-slider" aria-hidden="true"></span></span></label>`).join("")}</div></div>
      ${tabNav}
      ${wordsTab}
      ${policiesTab}
      ${allowlistTab}
      ${importTab}
      ${testTab}
      ${statsTab}`;
    document.querySelectorAll("[data-wf-tab]").forEach(btn=>btn.addEventListener("click",()=>{wordFilterState.activeTab=btn.dataset.wfTab||"words";renderWordFilter(false);}));
    const reload=()=>renderWordFilter(true);
    $("wfRefresh")?.addEventListener("click",reload);
    // 9.6.0: Wortfilter je Plattform.
    root.querySelectorAll("[data-wf-active]").forEach(box=>box.addEventListener("change",async()=>{
      const platform=box.dataset.wfActive,want=box.checked,name=platform==="twitch"?"Twitch":"Discord";
      if(!want){const ok=await askConfirm({title:`Wortfilter auf ${name} ausschalten`,text:`Danach werden verbotene Begriffe auf ${name} nicht mehr erkannt, gelöscht oder sanktioniert. Der Wortbestand bleibt erhalten.`,confirmLabel:"AUSSCHALTEN",danger:true});if(!ok){box.checked=true;return;}}
      box.disabled=true;
      try{const r=await fetch("/api/word-filter/active",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({platform,enabled:want})}),j=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(j.error||"Konnte nicht gespeichert werden.");
        wordFilterState.data={...(wordFilterState.data||{}),active:j.active};showToast(`Wortfilter auf ${name} ${want?"eingeschaltet":"ausgeschaltet"}.`);
      }catch(e){box.checked=!want;showToast(e.message,"error");}
      box.disabled=false;
    }));
    const applyFilters=()=>{wordFilterState.query=$("wfSearch")?.value||"";wordFilterState.category=$("wfCategory")?.value||"";wordFilterState.platform=$("wfPlatform")?.value||"all";wordFilterState.status=$("wfStatus")?.value||"all";wordFilterState.severity=$("wfSeverity")?.value||"all";wordFilterState.source=$("wfSource")?.value||"all";wordFilterState.detection=$("wfDetection")?.value||"all";wordFilterState.sort=$("wfSort")?.value||"term_asc";wordFilterState.page=1;renderWordFilter(false);};
    $("wfApplyFilters")?.addEventListener("click",applyFilters);
    $("wfSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();applyFilters();}});
    for(const id of ["wfCategory","wfPlatform","wfStatus","wfSeverity","wfSource","wfDetection","wfSort"])$(id)?.addEventListener("change",applyFilters);
    $("wfResetFilters")?.addEventListener("click",()=>{Object.assign(wordFilterState,{query:"",category:"",platform:"all",severity:"all",status:"all",source:"all",detection:"all",sort:"term_asc",page:1});renderWordFilter(false);});
    $("wfPrevPage")?.addEventListener("click",()=>{wordFilterState.page=Math.max(1,wordFilterState.page-1);renderWordFilter(false);});
    $("wfNextPage")?.addEventListener("click",()=>{wordFilterState.page+=1;renderWordFilter(false);});
    $("wfPageSize")?.addEventListener("change",e=>{wordFilterState.pageSize=Number(e.target.value||50);wordFilterState.page=1;renderWordFilter(false);});
    $("wfAddTerm")?.addEventListener("click",async()=>{const term=$("wfNewTerm")?.value.trim();if(!term)return showToast("Bitte einen Begriff eingeben.","error");const body={term:{term,category_id:$("wfNewCategory").value,severity:Number($("wfNewSeverity").value),detection_type:$("wfNewDetection").value,enabled:true,test_only:$("wfNewTest").checked,leetspeak:$("wfNewLeet").checked,repeat_letters:$("wfNewRepeat").checked,flex_separators:$("wfNewSeparators").checked,umlauts:true,platforms:[{platform:"twitch",enabled:$("wfNewTwitch").checked},{platform:"discord",enabled:$("wfNewDiscord").checked}]}};const rr=await fetch("/api/word-filter/term",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),j=await rr.json();if(!rr.ok)return showToast(j.error||"Speichern fehlgeschlagen.","error");showToast("Begriff gespeichert.","success");reload();});
    document.querySelectorAll(".wfDeleteTerm").forEach(b=>b.addEventListener("click",async()=>{if(!(await askDelete("Begriff wirklich löschen?")))return;const rr=await fetch("/api/word-filter/term",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({termId:b.dataset.id})});if(!rr.ok)return showToast("Löschen fehlgeschlagen.","error");reload();}));
    document.querySelectorAll(".wfEditTerm").forEach(b=>b.addEventListener("click",()=>{const t=terms.find(x=>x.term_id===b.dataset.id);if(!t)return;const tw=(t.platforms||[]).find(p=>p.platform==="twitch")||{},dc=(t.platforms||[]).find(p=>p.platform==="discord")||{};let modal=document.getElementById("wfEditModal");if(modal)modal.remove();modal=document.createElement("div");modal.id="wfEditModal";modal.className="modal";modal.innerHTML=`<div class="modal-card wf-edit-modal-card"><h3>Wortfilter-Eintrag bearbeiten</h3><div class="grid two-col"><label>Begriff / Phrase<input id="wfEditValue" value="${esc(t.term)}"></label><label>Kategorie<select id="wfEditCategory">${cats.map(c=>`<option value="${esc(c.category_id)}" ${c.category_id===t.category_id?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label><label>Schweregrad<select id="wfEditSeverity">${[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(t.severity)===n?"selected":""}>${n}</option>`).join("")}</select></label><label>Erkennung<select id="wfEditDetection"><option value="whole_word" ${t.detection_type==="whole_word"?"selected":""}>Ganzes Wort</option><option value="phrase" ${t.detection_type==="phrase"?"selected":""}>Phrase</option><option value="substring" ${t.detection_type==="substring"?"selected":""}>Teilstring</option><option value="regex" ${t.detection_type==="regex"?"selected":""}>Regex</option></select></label></div><div class="row wrap wf-edit-platforms"><label class="toggle-row"><input id="wfEditTwitch" type="checkbox" ${tw.enabled?"checked":""}><span>Twitch</span></label><label class="toggle-row"><input id="wfEditDiscord" type="checkbox" ${dc.enabled?"checked":""}><span>Discord</span></label><label class="toggle-row"><input id="wfEditEnabled" type="checkbox" ${t.enabled?"checked":""}><span>Aktiv</span></label><label class="toggle-row"><input id="wfEditTest" type="checkbox" ${t.test_only?"checked":""}><span>Testmodus</span></label><label class="toggle-row"><input id="wfEditLeet" type="checkbox" ${t.leetspeak?"checked":""}><span>Leetspeak</span></label><label class="toggle-row"><input id="wfEditRepeat" type="checkbox" ${t.repeat_letters?"checked":""}><span>Wiederholte Buchstaben</span></label><label class="toggle-row"><input id="wfEditSeparators" type="checkbox" ${t.flex_separators?"checked":""}><span>Sonderzeichen-Trennung</span></label></div><div class="modal-actions"><button id="wfEditCancel" class="secondary">Abbrechen</button><button id="wfEditSave">Speichern</button></div></div>`;document.body.appendChild(modal);const close=()=>modal.remove();$("wfEditCancel").onclick=close;modal.addEventListener("click",e=>{if(e.target===modal)close();});$("wfEditSave").onclick=async()=>{const value=$("wfEditValue").value.trim();if(!value)return showToast("Bitte einen Begriff eingeben.","error");const platforms=[{...tw,platform:"twitch",enabled:$("wfEditTwitch").checked},{...dc,platform:"discord",enabled:$("wfEditDiscord").checked}];const next={...t,term:value,category_id:$("wfEditCategory").value,severity:Number($("wfEditSeverity").value),detection_type:$("wfEditDetection").value,enabled:$("wfEditEnabled").checked,test_only:$("wfEditTest").checked,leetspeak:$("wfEditLeet").checked,repeat_letters:$("wfEditRepeat").checked,flex_separators:$("wfEditSeparators").checked,platforms};const rr=await fetch("/api/word-filter/term",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({term:next})}),j=await rr.json();if(!rr.ok)return showToast(j.error||"Änderung fehlgeschlagen.","error");close();showToast("Begriff aktualisiert.","success");reload();};}));
    $("wfSelectAll")?.addEventListener("click",()=>document.querySelectorAll(".wfSelectTerm").forEach(x=>x.checked=true));
    $("wfBulkApply")?.addEventListener("click",async()=>{const ids=[...document.querySelectorAll(".wfSelectTerm:checked")].map(x=>x.dataset.id);if(!ids.length)return showToast("Keine Begriffe ausgewählt.","error");const cat=$("wfBulkCategory").value,sev=$("wfBulkSeverity").value,mode=$("wfBulkMode").value,bulkTw=$("wfBulkTwitch").value,bulkDc=$("wfBulkDiscord").value,bulkLeet=$("wfBulkLeet").value,bulkRepeat=$("wfBulkRepeat").value,bulkSeparators=$("wfBulkSeparators").value;for(const id of ids){const t=terms.find(x=>x.term_id===id);if(!t)continue;const platforms=["twitch","discord"].map(platform=>{const current=(t.platforms||[]).find(p=>p.platform===platform)||{platform,enabled:false};const choice=platform==="twitch"?bulkTw:bulkDc;return {...current,platform,enabled:choice==="on"?true:choice==="off"?false:!!current.enabled};});const next={...t,category_id:cat||t.category_id,severity:sev?Number(sev):t.severity,enabled:mode==="enable"?true:mode==="disable"?false:t.enabled,test_only:mode==="test"?true:(mode==="enable"?false:t.test_only),leetspeak:bulkLeet==="on"?true:bulkLeet==="off"?false:!!t.leetspeak,repeat_letters:bulkRepeat==="on"?true:bulkRepeat==="off"?false:!!t.repeat_letters,flex_separators:bulkSeparators==="on"?true:bulkSeparators==="off"?false:!!t.flex_separators,platforms};const rr=await fetch("/api/word-filter/term",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({term:next})});if(!rr.ok){const j=await rr.json().catch(()=>({}));return showToast(j.error||"Massenbearbeitung abgebrochen.","error");}}showToast(`${ids.length} Begriffe aktualisiert.`,"success");reload();});
    $("wfAddCategory")?.addEventListener("click",async()=>{const name=$("wfNewCategoryName").value.trim();if(!name)return;const rr=await fetch("/api/word-filter/category",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:{name,sort_order:100,builtin:false}})}),j=await rr.json();if(!rr.ok)return showToast(j.error||"Kategorie konnte nicht angelegt werden.","error");showToast("Kategorie angelegt.","success");reload();});
    document.querySelectorAll(".wfFalsePositive").forEach(b=>b.addEventListener("click",async()=>{const rr=await fetch("/api/word-filter/hit/false-positive",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hitId:Number(b.dataset.id)})});if(!rr.ok)return showToast("Fehlalarm-Markierung fehlgeschlagen.","error");reload();}));
    $("wfSavePolicies")?.addEventListener("click",async()=>{for(const sel of document.querySelectorAll("[data-policy-category]")){const cat=sel.dataset.policyCategory,platform=sel.dataset.policyPlatform,timeout=Number(document.querySelector(`[data-policy-timeout-category="${CSS.escape(cat)}"][data-policy-timeout-platform="${platform}"]`)?.value||600),escalate=!!document.querySelector(`[data-policy-escalate-category="${CSS.escape(cat)}"][data-policy-escalate-platform="${platform}"]`)?.checked,messageTemplate=document.querySelector(`[data-policy-message-category="${CSS.escape(cat)}"][data-policy-message-platform="${platform}"]`)?.value||"";const rr=await fetch("/api/word-filter/policy",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({policy:{category_id:cat,platform,action:sel.value,timeout_seconds:timeout,escalate,message_template:messageTemplate}})});if(!rr.ok){const j=await rr.json().catch(()=>({}));return showToast(j.error||"Maßnahmen konnten nicht gespeichert werden.","error");}}showToast("Maßnahmen gespeichert.","success");reload();});
    $("wfAllowAdd")?.addEventListener("click",async()=>{const value=$("wfAllowValue").value.trim();if(!value)return;const rr=await fetch("/api/word-filter/allow",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({item:{value,platform:$("wfAllowPlatform").value,match_type:"phrase",enabled:true}})}),j=await rr.json();if(!rr.ok)return showToast(j.error||"Allowlist fehlgeschlagen.","error");reload();});
    document.querySelectorAll(".wfAllowDelete").forEach(b=>b.addEventListener("click",async()=>{await fetch("/api/word-filter/allow",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({allowId:b.dataset.id})});reload();}));
    let pendingImport=null;async function previewRows(rows,meta){const existing=new Set(terms.map(t=>`${String(t.normalized_term||t.term).toLocaleLowerCase("de-DE")}::${t.detection_type||"whole_word"}`));const cleaned=[...new Set(rows.map(x=>String(x||"").trim()).filter(Boolean))],dupes=cleaned.filter(x=>existing.has(`${x.normalize("NFKC").toLocaleLowerCase("de-DE")}::whole_word`));pendingImport={rows:cleaned,meta};$("wfImportResult").innerHTML=`<div class="notice">${cleaned.length} gültige Begriffe · ${dupes.length} bereits vorhanden · ${cleaned.length-dupes.length} voraussichtlich neu. <button id="wfImportApply">Import übernehmen</button></div>`;$("wfImportApply")?.addEventListener("click",async()=>{const rr=await fetch("/api/word-filter/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sourceName:meta.sourceName||meta.filename||"Dateiimport",sourceLicense:meta.license||null,filename:meta.filename,format:meta.format,terms:cleaned.map(term=>({term,category_id:"benutzerdefiniert",severity:2,detection_type:"whole_word",enabled:false,test_only:true,platforms:[{platform:"twitch",enabled:false},{platform:"discord",enabled:false}]}))})}),j=await rr.json();if(!rr.ok)return showToast(j.error||"Import fehlgeschlagen.","error");showToast(`${j.inserted} Begriffe importiert, ${j.duplicates} Dubletten.`,"success");reload();});}
    $("wfImportPreview")?.addEventListener("click",async()=>{const f=$("wfImportFile")?.files?.[0];if(!f)return showToast("Bitte Datei auswählen.","error");if(f.size>512*1024)return showToast("Importdatei ist größer als 512 KB.","error");const txt=await f.text(),ext=f.name.split(".").pop().toLowerCase();let rows=[];if(ext==="json"){const j=JSON.parse(txt);const src=Array.isArray(j)?j:(j.terms||[]);rows=src.map(x=>typeof x==="string"?x:x.term);}else if(ext==="csv"){const lines=txt.split(/\r?\n/).filter(Boolean),head=(lines[0]||"").split(",").map(x=>x.trim().toLowerCase()),idx=head.indexOf("term");rows=(idx>=0?lines.slice(1):lines).map(line=>line.split(",")[idx>=0?idx:0]?.replace(/^"|"$/g,""));}else rows=txt.split(/\r?\n/);previewRows(rows,{filename:f.name,format:ext||"txt"});});
    $("wfLdnoobw")?.addEventListener("click",async()=>{const rr=await fetch("/api/word-filter/import/ldnoobw-de",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),j=await rr.json();if(!rr.ok)return showToast(j.error||"LDNOOBW-Import fehlgeschlagen.","error");showToast(`${j.inserted} LDNOOBW-Begriffe als deaktivierter Testbestand übernommen (${j.duplicates} Dubletten).`,"success");reload();});
    document.querySelectorAll(".wfRollback").forEach(b=>b.addEventListener("click",async()=>{if(!(await askAs("revert","Diesen Import zurücknehmen? Manuelle Einträge bleiben erhalten.")))return;await fetch("/api/word-filter/import/rollback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({importId:b.dataset.id})});reload();}));
    $("wfExport")?.addEventListener("click",()=>{location.href="/api/word-filter/export";});
    $("wfTestBtn")?.addEventListener("click",async()=>{const rr=await fetch("/api/word-filter/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({platform:$("wfTestPlatform").value,content:$("wfTestText").value})}),j=await rr.json();if(!rr.ok){$("wfTestResult").innerHTML=`<div class="error">${esc(j.error||"Test fehlgeschlagen.")}</div>`;return;}if(!j.matched){const tips=(j.suggestions||[]).map(x=>({leetspeak_disabled:"Leetspeak ist für diesen Begriff deaktiviert",repeat_letters_disabled:"Wiederholte Buchstaben sind für diesen Begriff deaktiviert",flex_separators_disabled:"Sonderzeichen-Trennung ist für diesen Begriff deaktiviert"})[x.reason]||x.reason);$("wfTestResult").innerHTML=`<div class="notice ok"><strong>Kein Treffer.</strong><br><small>Normalisiert: <code>${esc(j.input?.normalized||"")}</code></small>${tips.length?`<br><strong>Mögliche Ursache:</strong> ${esc(tips.join(" · "))}`:""}</div>`;return;}const plan=j.actionPlan||{};const steps=[plan.deleteMessage?"Nachricht löschen":null,plan.warnUser?"Nutzer verwarnen":null,plan.notifyModerator?"Moderator benachrichtigen":null,plan.timeoutUser?`Timeout ${Math.max(1,Math.ceil(Number(j.timeoutSeconds||0)/60))} Min.`:null,plan.logOnly?"Nur protokollieren":null,plan.escalation?"Wiederholungen können eskalieren":null].filter(Boolean);$("wfTestResult").innerHTML=`<div class="notice"><strong>Treffer:</strong> ${esc(j.term.term)} · ${esc(j.term.category)} · Grad ${j.term.severity}<br><strong>Effektive Aktion:</strong> ${esc(wordFilterActionLabel(j.action))}${j.term.testOnly?" · TESTMODUS":""}<br><strong>Aktionsquelle:</strong> ${esc(({"term-override":"Eintragsspezifischer Override","category-policy":"Kategorie & Maßnahmen","test-mode":"Testmodus","default":"Standard"})[j.actionSource]||j.actionSource||"–")}<br><strong>Ausführungsplan:</strong> ${esc(steps.join(" → ")||"Keine Sanktion")}<br><strong>Erkennung:</strong> ${esc(j.term.detectionType)} · Leetspeak ${j.term.leetspeak?"AN":"AUS"} · Wiederholungen ${j.term.repeatLetters?"AN":"AUS"} · Trennzeichen ${j.term.flexSeparators?"AN":"AUS"}<br><strong>Normalisiert:</strong> <code>${esc(j.diagnostics?.normalized||"")}</code><br><strong>Geprüfter Text:</strong> <code>${esc(j.diagnostics?.candidate||"")}</code><br><strong>Quelle:</strong> ${esc(j.term.source||"manuell")}${j.notificationTarget?`<br><strong>Moderator-Hinweis:</strong> #${esc(j.notificationTarget.channelName||j.notificationTarget.channelId)}`:""}<br><strong>Legacy-Fallback:</strong> ${j.legacyFallbackActive?"AKTIV (nur Notfallpfad)":"AUS – zentraler Wortfilter ist maßgeblich"}<br><small>Grad 1–5 bewertet die Schwere. Er löst keine Sanktion selbstständig aus.</small></div>`;});
    $("wfRetentionSave")?.addEventListener("click",async()=>{const days=Number($("wfRetentionDays")?.value||90);const rr=await fetch("/api/word-filter/retention",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({days})}),j=await rr.json();if(!rr.ok)return showToast(j.error||"Aufbewahrung konnte nicht gespeichert werden.","error");showToast(`Aufbewahrung: ${j.days} Tage · ${j.deleted||0} alte Detailtreffer entfernt.`,"success");reload();});
  }catch(e){root.innerHTML=`<div class="error">${esc(e.message)}</div>`;}
}

function renderAll(){renderCommands();renderTimers();renderEvents();renderBlocked();renderModeration();renderAuto();renderTeam();renderHelp();}
async function saveAll(){
  const openCommandId=document.querySelector("#commands .command-details:not(.hidden)")?.closest("[data-id]")?.dataset.id || null;

  // Wichtig: Nicht nur auf input/change-Events vertrauen.
  // Direkt vor dem Speichern werden die aktuell sichtbaren Command-Felder
  // noch einmal explizit aus dem DOM in das Datenmodell übernommen.
  syncCommandsFromDom();
  syncTeamManagedClientSettings();

  // Während des Speicherns darf der Auto-Refresh nichts überschreiben.
  stopCommandAutoRefresh();

  const commandSnapshot=JSON.stringify(settings?.commands||[]);

  $("saveState").textContent="Speichere …";
  $("saveBtn").disabled=true;

  try{
    const r=await fetch("/api/settings",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      cache:"no-store",
      body:JSON.stringify(settings)
    });

    const j=await r.json().catch(()=>({}));

    if(!r.ok){
      const reason=j.detail || j.error || `HTTP ${r.status}`;
      throw new Error(reason);
    }

    if(j.settings) settings=j.settings;

    // Direkt danach den tatsächlich gespeicherten Serverstand kontrollieren.
    const verifyR=await fetch("/api/settings",{cache:"no-store"});
    const verified=await verifyR.json().catch(()=>({}));
    if(!verifyR.ok) throw new Error(verified.error||`Verifikation HTTP ${verifyR.status}`);

    // Team-verwaltete Commands hängt der Server immer ans Ende; für den Vergleich zählen nur die eigenen.
    // PostgreSQL (jsonb) liefert Objektschlüssel in anderer Reihenfolge zurück; deshalb mit sortierten Schlüsseln vergleichen.
    const stable=v=>Array.isArray(v)?`[${v.map(stable).join(",")}]`:(v&&typeof v==="object")?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`:JSON.stringify(v);
    const ownCommands=list=>stable((list||[]).filter(x=>x?.managedBy!=="team"));
    const verifiedCommands=ownCommands(verified?.commands);
    if(verifiedCommands!==ownCommands(JSON.parse(commandSnapshot))){
      console.error("Command-Speicherprüfung fehlgeschlagen",{
        expected:JSON.parse(commandSnapshot),
        actual:verified?.commands||[]
      });
      throw new Error("Server hat die Command-Änderungen nicht vollständig übernommen.");
    }

    settings=verified;
    dirty=false;

    renderAll();
    await loadDashboardSummary();

    if(openCommandId && !$("commands")?.classList.contains("hidden")){
      const row=document.querySelector(`#commands [data-id="${CSS.escape(openCommandId)}"]`);
      row?.querySelector(".command-details")?.classList.remove("hidden");
    }

    $("saveState").textContent="✅ Gespeichert und geprüft";
    setTimeout(()=>$("saveState").textContent="Keine ungespeicherten Änderungen",1800);

    if(!$("activity").classList.contains("hidden")){
      renderActivity();
    }
  }catch(e){
    dirty=true;
    $("saveState").textContent=`❌ ${e.message}`;
    console.error("Speichern fehlgeschlagen:",e);
  }finally{
    $("saveBtn").disabled=false;
    if(!$("commands")?.classList.contains("hidden")) startCommandAutoRefresh();
  }
}
async function testMessage(){
  await fetch("/api/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bot:$("testBot").value,message:$("testMessage").value})});
}

async function resetConfiguration(){
  const ok = await askDelete("Wirklich Commands, Timer, Begrüßungen, Legacy-Wortliste und Auto-Replies löschen und bei 0 beginnen? Der zentrale V8-Wortfilter bleibt erhalten.");
  if(!ok) return;

  const r = await fetch("/api/reset-settings",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    cache:"no-store"
  });

  const j = await r.json().catch(()=>({}));

  if(!r.ok){
    alert(j.error || "Zurücksetzen fehlgeschlagen.");
    return;
  }

  settings = j.settings;
  dirty = false;
  renderAll();
  await loadDashboardSummary();
  $("saveState").textContent="✅ Konfiguration zurückgesetzt";
  setTimeout(()=>$("saveState").textContent="Keine ungespeicherten Änderungen",1800);
}

$("resetConfigBtn")?.addEventListener("click",resetConfiguration);

async function localLogin(){
  $("localLoginError").textContent="";
  const password = $("localPassword").value;
  const r = await fetch("/auth/local",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({password})
  });
  const j = await r.json().catch(()=>({}));
  if(r.ok){
    location.reload();
    return;
  }
  localLoginError.textContent = j.error || "Lokaler Login fehlgeschlagen.";
}
$("localLoginBtn")?.addEventListener("click", localLogin);
$("localPassword")?.addEventListener("keydown", e=>{ if(e.key==="Enter") localLogin(); });

window.addEventListener("beforeunload",e=>{if(dirty){e.preventDefault();e.returnValue="";}});
initTheme();
loadAppVersion();
init();
// Version 8.1 – eigenständige Minigame-Verwaltung mit zustandsabhängiger Navigation.
// Eine XP-Geschäftsaktion für beide Mitglieder-Einstiege; Autorisierung erfolgt weiterhin serverseitig.
async function updateDiscordMemberXp(userId,mode,rawAmount){
  const amount=Number(rawAmount);
  if(!/^\d{17,20}$/.test(String(userId||'')))throw Error('Ungültige Discord-ID.');
  if(!['add','subtract','set'].includes(mode))throw Error('Ungültige XP-Aktion.');
  if(rawAmount===null||String(rawAmount).trim()===''||!Number.isSafeInteger(amount)||amount<0)throw Error('Bitte eine gültige XP-Anzahl eingeben.');
  const result=await levelRequest('/api/discord/levelsystem/xp','POST',{userId:String(userId),mode,amount});
  if(result.wasPromoted&&result.announcement&&!result.announcement.published){showToast('Rangaufstieg gespeichert; keine Discord-Meldung: '+(result.announcement.reason||'Unbekannter Grund'),'warning',6500);}
  return result;
}
const levelRequest=async(url,method='GET',body)=>{const r=await fetch(url,{method,cache:'no-store',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw Error(d.error||`HTTP ${r.status}`);return d;};
// Alle Minigame-Spielerprofile öffnen denselben Mitglieder-Dialog und dieselben APIs.
// Keine separate XP-, Rollen- oder Moderations-Geschäftslogik.
async function openDiscordMemberFromMinigame(userId){
  if(!hasCapability('discord.members.view')){showToast('Keine Berechtigung zum Anzeigen von Discord-Mitgliedern.','error');return;}
  if(!/^\d{17,20}$/.test(String(userId||''))){showToast('Ungültige Discord-ID.','error');return;}
  discordMemberState.query=String(userId);
  discordSelectedMemberId=String(userId);
  discordMemberProfileTab='minigame';
  try{await openNavTab('discordMembers',{persist:true});}
  catch(error){discordSelectedMemberId=null;showToast(`Mitgliederprofil: ${error.message}`,'error');}
}
async function renderDiscordLevelsystem(tab=activeNavTab){
 const root=$(tab);if(!root)return;
 root.innerHTML='<h2>Minigame</h2><p class="hint">Daten werden geladen …</p>';
 try{
  const [data,setup]=await Promise.all([levelRequest('/api/discord/levelsystem'),levelRequest('/api/discord/levelsystem/setup')]);
  const c=data.config||{},channels=setup.preview?.channels||{};
  const ready=Boolean(c.enabled&&['regeln','topliste','befoerderungen','rangprofile'].every(k=>channels[k]));
  const changed=ready!==minigameReady;minigameReady=ready;
  if(changed){renderMainNav();renderSubTabs();}
  if(!ready&& !['discordLevelsystem','discordLevelXpRules','discordLevelRanks','discordLevelMissions','discordLevelStatistics'].includes(tab)){await openNavTab('discordLevelsystem');return;}
  const editable=hasCapability('discord.moderation.edit');
  const field=(id,label,value,type='number')=>`<label>${esc(label)}<input id="${id}" type="${type}" value="${esc(value??'')}"></label>`;
  const header=`<div class="title"><div><h2>Minigame · ${esc(({discordLevelsystem:'Konfiguration',discordLevelXpRules:'XP-Regeln',discordLevelPlayers:'Spieler',discordLevelRanks:lv('rankPlural'),discordLevelMissions:`${lv('dailyPlural')} & ${lv('missionPlural')}`,discordLevelStatistics:'Statistiken'})[tab]||'')}</h2><p class="hint">Community-${esc(lv('rankPlural'))}, XP und ${esc(lv('missionPlural'))}</p></div>${tab==='discordLevelsystem'?'<button id="levelRefresh" class="secondary">Aktualisieren</button>':''}</div>`;
  const note='';
  const saved=c.channels||{};
  const statusFor=(key)=>saved[key]&&!channels[key]?['error','FEHLER','Gespeicherte Zuordnung nicht erreichbar']:channels[key]?['ok','VORHANDEN','Kanal erkannt']:['missing','FEHLT','Noch nicht eingerichtet'];
  const statusCard=(name,state,detail)=>`<div class="mg-card mg-${state[0]}"><div class="mg-card-head"><strong>${esc(name==='MINIGAME-KATEGORIE'?'MINIGAME':name)}</strong><b class="mg-pill">${esc(state[1])}</b></div><small>${esc(state[2])}</small></div>`;
  const names={regeln:'Regeln',topliste:'Topliste',befoerderungen:lv('promotionsPlural'),rangprofile:'Rangprofile'};
  const defaults={category:'╭➤ MINIGAME',regeln:'📜・regeln',topliste:'🏆・topliste',befoerderungen:'🎖️・befoerderungen',rangprofile:'🪪・rangprofile'};
  const configuredNames={...defaults,...(c.channelNames||{})};
  const categoryReady=Boolean(setup.preview?.category);
  const rulesPublished=Boolean(data.rulesPublished);
  const channelsReady=categoryReady&&Object.keys(names).every(k=>statusFor(k)[0]==='ok');
  const hasError=Object.keys(names).some(k=>statusFor(k)[0]==='error');
  const summaryStatus=hasError?['error','FEHLER']:ready?['ok','BEREIT']:['missing','EINRICHTUNG'];
  const configContent=`<div class="mg-panel"><div class="mg-heading"><div><h3>System & Discord</h3><p class="hint">Einrichtungsstatus der Minigame-Kanäle.</p></div><span class="mg-overall mg-${summaryStatus[0]}">${summaryStatus[1]}</span></div><div class="mg-grid">${statusCard(configuredNames.category,categoryReady?['ok','VORHANDEN','Kategorie erkannt']:['missing','FEHLT','Kategorie noch nicht erstellt'],'MINIGAME')}${Object.entries(names).map(([k,v])=>statusCard(configuredNames[k],statusFor(k),v)).join('')}</div><div class="mg-stats"><div><span>STATUS</span><strong>${ready?'Aktiv':c.enabled?'Unvollständig':'Nicht aktiviert'}</strong></div><div><span>TEILNEHMER</span><strong>${Number(data.total||0)}</strong></div><div><span>KANÄLE</span><strong>${Object.keys(names).filter(k=>statusFor(k)[0]==='ok').length}/4</strong></div></div><p class="hint">XP-Regeln und ${esc(lv('rankPlural'))} kannst du bereits vor der Aktivierung einstellen. Die Spielerverwaltung wird danach freigeschaltet.</p></div><div class="mg-panel"><h3>Namen der Kategorie und Kanäle</h3><p class="hint">Eigene Namen und Emojis sind möglich. Zuerst speichern, danach „Minigame-Kanäle einrichten“ ausführen. Vorhandene Kanäle werden anhand ihrer IDs wiederverwendet und umbenannt.</p><div class="settings-grid">${[['category','Kategorie'],['regeln','Regeln'],['topliste','Topliste'],['befoerderungen',lv('promotionsPlural')],['rangprofile','Rangprofile']].map(([key,label])=>`<label>${label}<input data-level-name="${key}" type="text" maxlength="90" value="${esc(configuredNames[key])}" ${editable?'':'disabled'}></label>`).join('')}</div><button id="levelNameSave" ${editable?'':'disabled'}>Kanalnamen speichern</button></div><div class="mg-panel"><h3>Einrichtung & Aktivierung</h3><p class="hint">Zuerst XP-Regeln und ${esc(lv('rankPlural'))} speichern, danach die Regeln veröffentlichen und das Spiel aktivieren.</p><p><strong>Regelveröffentlichung: ${rulesPublished?'Aktuell veröffentlicht':'Ausstehend oder nach Änderungen erneut erforderlich'}</strong></p><div class="mg-actions"><button id="levelSetup" ${editable?'':'disabled'}>Minigame-Kanäle einrichten</button><button id="levelRules" class="secondary" ${editable?'':'disabled'}>Regeln veröffentlichen</button><button id="levelTop" class="secondary" ${editable?'':'disabled'}>Topliste aktualisieren</button></div><div class="mg-enable"><label><input id="levelEnabled" type="checkbox" ${c.enabled?'checked':''} ${editable?'':'disabled'}> Minigame aktivieren</label><button id="levelActivation" ${editable?'':'disabled'}>Aktivierung speichern</button></div></div>`;
  const rulesContent=`<div class="card"><h3>XP-Regeln</h3><div class="settings-grid">${field('levelChatXp','XP je Nachricht',c.chatXp)}${field('levelMemeXp','XP je Bildnachricht',c.memeXp)}${field('levelChatSeconds','Chat-Cooldown (Sekunden)',c.chatCooldownMs/1000)}${field('levelMemeMinutes','Meme-Cooldown (Minuten)',c.memeCooldownMs/60000)}${field('levelMinChars','Mindestzeichen',c.minChars)}${field('levelMemeChannel','Meme-Channel-ID',c.memeChannelId||'','text')}</div><label>Einleitung der Regeln<textarea id="levelRulesIntro" rows="3">${esc(c.rulesIntro||'')}</textarea></label><label>Schlusstext der Regeln<textarea id="levelRulesOutro" rows="3">${esc(c.rulesOutro||'')}</textarea></label><label><input id="levelReverse" type="checkbox" ${c.reverseDeleted?'checked':''}> XP gelöschter Nachrichten zurücknehmen</label><label><input id="levelAnnounceManual" type="checkbox" ${c.announceManualPromotions===true?'checked':''}> ${esc(lv('promotionsPlural'))} durch manuelle XP-Vergabe veröffentlichen</label><p class="hint">Standardmäßig aus. Nur echte Rangaufstiege durch manuelle XP-Gutschriften werden im Kanal „${esc(lv('promotionsPlural'))}“ angekündigt; keine Herabstufungen.</p><button id="levelSave" ${editable?'':'disabled'}>XP-Regeln speichern</button></div>`;
  const all=(data.players||data.leaderboard||[]).map((u,i)=>({...u,position:i+1}));
  const branches={heer:'Heer',luftwaffe:'Luftwaffe',marine:'Marine'};
  const playersContent=`<div class="card"><h3>Spielerverwaltung</h3><p class="hint">${all.length} erfasste Spieler · Suche nach Anzeigename oder Discord-ID. Filter und Sortierung erfolgen direkt in der Liste.</p><div class="settings-grid"><label>Spieler suchen<input id="levelPlayerSearch" placeholder="Name oder Discord-ID"></label>${lv('branches')?`<label>${esc(lv('branchLabel'))}<select id="levelPlayerBranch"><option value="">Alle</option>${Object.entries(branches).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>`:'<input id="levelPlayerBranch" type="hidden" value="">'}<label>Sortierung<select id="levelPlayerOrder"><option value="xp-desc">XP absteigend</option><option value="xp-asc">XP aufsteigend</option><option value="name">Name</option></select></label><label>Einträge je Seite<select id="levelPlayerPageSize"><option>25</option><option>50</option><option>100</option></select></label></div><div style="overflow-x:auto"><table><thead><tr><th>Spieler</th>${lv('branches')?`<th>${esc(lv('branchLabel'))}</th>`:''}<th>${esc(lv('rank'))}</th><th>XP</th><th>Aktionen</th></tr></thead><tbody id="levelPlayerRows"></tbody></table></div><p id="levelPlayerCount" class="hint"></p><button id="levelPrev" class="secondary">Zurück</button> <span id="levelPage"></span> <button id="levelNext" class="secondary">Weiter</button></div><div class="card" id="levelPlayerEditor" hidden><h3>XP anpassen</h3><p id="levelSelectedPlayer"></p><label>Aktion<select id="levelMode"><option value="add">XP hinzufügen</option><option value="subtract">XP abziehen</option><option value="set">XP setzen</option></select></label>${field('levelAmount','XP-Anzahl',0)}<button id="levelXpSave" ${editable?'':'disabled'}>XP-Anpassung speichern</button></div>`;
  const missionsContent=`<div class="card"><h3>${esc(lv('dailyTitle'))} /dailyxp</h3><label><input id="dailyEnabled" type="checkbox" ${c.dailyEnabled?'checked':''}> ${esc(lv('dailyNoun'))} aktivieren</label><div class="settings-grid">${field('dailyMin','Minimale XP',c.dailyMinXp)}${field('dailyMax','Maximale XP',c.dailyMaxXp)}</div><p class="hint">Einmal täglich von 00:00 bis 23:59 Uhr (Europe/Berlin). Antwort privat auf Discord.</p></div><div class="card"><h3>${esc(lv('missionTitle'))} /${esc(lv('missionCmd'))}</h3><label><input id="missionEnabled" type="checkbox" ${c.missionEnabled?'checked':''}> ${esc(lv('missionPlural'))} aktivieren</label><div class="settings-grid">${field('missionLimit','Versuche pro Kalendertag',c.missionDailyLimit)}${field('missionMinHours','Dauer mindestens (Stunden)',c.missionMinHours)}${field('missionMaxHours','Dauer höchstens (Stunden)',c.missionMaxHours)}${field('missionChance','Erfolgswahrscheinlichkeit (%)',c.missionSuccessPercent)}${field('missionSuccessMin','Erfolg: XP ab',c.missionSuccessMinXp)}${field('missionSuccessMax','Erfolg: XP bis',c.missionSuccessMaxXp)}${field('missionFailMin','Fehlschlag: XP ab',c.missionFailMinXp)}${field('missionFailMax','Fehlschlag: XP bis',c.missionFailMaxXp)}</div><h4>Missionen bearbeiten</h4><p class="hint">Eine Mission je Zeile: ID | Titel | Beschreibung | aktiv (ja/nein). IDs nur Kleinbuchstaben, Zahlen, Bindestrich und Unterstrich.</p><textarea id="missionDefinitions" rows="8">${esc((c.missionDefinitions||[]).map(m=>[m.id,m.name,m.description,m.enabled?'ja':'nein'].join(' | ')).join('\n'))}</textarea><p>Ergebnisse werden serverseitig beim Start festgelegt; nach Ablauf werden XP mit /${esc(lv('missionCmd'))} abholen gutgeschrieben. Es ist nur eine ${esc(lv('missionSingular'))} gleichzeitig möglich.</p><button id="missionSave" ${editable?'':'disabled'}>Spielmodi speichern</button></div>`;
  const statisticsContent=`<div class="card"><h3>Community-Statistik</h3><label>Zeitraum<select id="levelStatsDays"><option value="7">7 Tage</option><option value="30" selected>30 Tage</option><option value="90">90 Tage</option><option value="0">Gesamt</option></select></label><div id="levelStatsResults">Statistiken werden geladen …</div></div>`;
  const ranks=(c.ranks||[]);
  const ranksContent=`<div class="card"><h3>${esc(lv('rankPlural'))} bearbeiten</h3><p class="hint">Bezeichnungen, XP-Schwellen und aktive Ränge lassen sich vor Spielstart festlegen. XP-Schwellen müssen eindeutig und aufsteigend sein.</p><div style="overflow-x:auto"><table><thead><tr><th>Stufe</th>${lv('branches')?'<th>Heer</th><th>Luftwaffe</th><th>Marine</th>':'<th>Name</th>'}<th>Ab XP</th><th>Aktiv</th></tr></thead><tbody>${ranks.map((r,i)=>`<tr data-rank="${i}"><td>${esc(r.id)}</td><td><input data-field="heer" value="${esc(r.heer)}" aria-label="${lv('branches')?'Heer ':''}Rang ${i+1}"></td>${lv('branches')?`<td><input data-field="luftwaffe" value="${esc(r.luftwaffe||r.heer)}" aria-label="Luftwaffe Rang ${i+1}"></td><td><input data-field="marine" value="${esc(r.marine)}" aria-label="Marine Rang ${i+1}"></td>`:''}<td><input data-field="xp" type="number" min="0" value="${Number(r.xp)||0}" aria-label="XP Rang ${i+1}"></td><td><input data-field="active" type="checkbox" ${r.active!==false?'checked':''}></td></tr>`).join('')}</tbody></table></div><button id="levelRankSave" ${editable?'':'disabled'}>${esc(lv('rankPlural'))} speichern</button></div>`;
  root.innerHTML=header+({discordLevelsystem:configContent,discordLevelXpRules:rulesContent,discordLevelPlayers:playersContent,discordLevelRanks:ranksContent,discordLevelMissions:missionsContent,discordLevelStatistics:statisticsContent}[tab]||configContent)+note;
  const feedback=(message,type='error')=>showToast(message,type,type==='error'?6500:3500);
  if(tab==='discordLevelsystem')$('levelRefresh').onclick=()=>renderDiscordLevelsystem(tab);
  if(tab==='discordLevelsystem'){
   $('levelNameSave').onclick=async()=>{try{const channelNames=Object.fromEntries([...root.querySelectorAll('[data-level-name]')].map(el=>[el.dataset.levelName,el.value.trim()]));if(Object.values(channelNames).some(v=>!v||[...v].length>90))throw Error('Bitte alle Namen ausfüllen (maximal 90 Zeichen).');if(new Set(Object.values(channelNames).slice(1).map(n=>n.toLocaleLowerCase('de-DE'))).size!==4)throw Error('Kanalnamen müssen eindeutig sein.');await levelRequest('/api/discord/levelsystem/config','PUT',{channelNames});feedback('Kanalnamen gespeichert. Mit „Minigame-Kanäle einrichten“ auf Discord übernehmen.','success');await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};
   $('levelSetup').onclick=async()=>{if(!await askConfirm({title:'Minigame-Kanäle einrichten',text:'Gespeicherte Namen auf Discord übernehmen? Bereits zugeordnete Kanäle werden umbenannt und ihre Rechte synchronisiert. Keine Nachrichten werden gelöscht.',confirmLabel:'EINRICHTEN',cancelLabel:'ABBRECHEN'}))return;try{await levelRequest('/api/discord/levelsystem/setup','POST');feedback('Kanalnamen und Berechtigungen wurden synchronisiert.','success');await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};
   $('levelActivation').onclick=async()=>{try{if($('levelEnabled').checked&&!channelsReady)throw Error('Zuerst Kategorie und alle vier Kanäle einrichten.');if($('levelEnabled').checked&&!rulesPublished)throw Error('Bitte zuerst die aktuellen Regeln auf Discord veröffentlichen.');await levelRequest('/api/discord/levelsystem/config','PUT',{enabled:$('levelEnabled').checked});await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};
   for(const [id,kind] of [['levelRules','rules'],['levelTop','top']])$(id).onclick=async()=>{try{await levelRequest('/api/discord/levelsystem/publish','POST',{kind});showToast('Discord-Nachricht veröffentlicht bzw. aktualisiert.','success');await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};
  }
  if(tab==='discordLevelXpRules')$('levelSave').onclick=async()=>{try{await levelRequest('/api/discord/levelsystem/config','PUT',{chatXp:Number($('levelChatXp').value),memeXp:Number($('levelMemeXp').value),chatCooldownMs:Number($('levelChatSeconds').value)*1000,memeCooldownMs:Number($('levelMemeMinutes').value)*60000,minChars:Number($('levelMinChars').value),memeChannelId:$('levelMemeChannel').value.trim()||null,reverseDeleted:$('levelReverse').checked,announceManualPromotions:$('levelAnnounceManual').checked,rulesIntro:$('levelRulesIntro').value,rulesOutro:$('levelRulesOutro').value});feedback('XP-Regeln gespeichert. Bitte Regeln erneut veröffentlichen.','success');await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};
  if(tab==='discordLevelMissions')$('missionSave').onclick=async()=>{try{
   const n=id=>Number($(id).value);const definitions=$('missionDefinitions').value.split('\n').map(s=>s.trim()).filter(Boolean).map(s=>{const parts=s.split('|').map(x=>x.trim());if(parts.length!==4)throw Error('Jede Mission braucht vier Felder.');return {id:parts[0],name:parts[1],description:parts[2],enabled:parts[3].toLowerCase()==='ja'};});
   await levelRequest('/api/discord/levelsystem/config','PUT',{dailyEnabled:$('dailyEnabled').checked,dailyMinXp:n('dailyMin'),dailyMaxXp:n('dailyMax'),missionEnabled:$('missionEnabled').checked,missionDailyLimit:n('missionLimit'),missionMinHours:n('missionMinHours'),missionMaxHours:n('missionMaxHours'),missionSuccessPercent:n('missionChance'),missionSuccessMinXp:n('missionSuccessMin'),missionSuccessMaxXp:n('missionSuccessMax'),missionFailMinXp:n('missionFailMin'),missionFailMaxXp:n('missionFailMax'),missionDefinitions:definitions});feedback('Spielmodi gespeichert.','success');await renderDiscordLevelsystem(tab);
  }catch(e){feedback(e.message);}};
  if(tab==='discordLevelStatistics'){
   const loadStats=async()=>{try{const s=(await levelRequest('/api/discord/levelsystem/statistics?days='+$('levelStatsDays').value)).statistics;const o=s.missionOverview||{};const cards=[['Teilnehmer',s.users],['Aktuelle Gesamt-XP',s.totalXp],[lv('promotionsPlural'),s.promotions],[lv('dailyPlural'),s.dailyClaims],['Abgeschlossene '+lv('missionPlural'),s.missions],['Erfolgreiche '+lv('missionPlural'),s.missionSuccesses],['Fehlgeschlagene '+lv('missionPlural'),o.failed||0],['Erfolgsquote',String(o.successRate||0)+' %'],[lv('missionSingular')+'-XP',o.rewardXp||0],['Aktive '+lv('missionPlural'),o.active||0],['Bereit zur Abholung',o.ready||0]];$('levelStatsResults').innerHTML=`<div class="mg-stats">${cards.map(([a,b])=>`<div><span>${esc(a)}</span><strong>${Number(b).toLocaleString('de-DE')}</strong></div>`).join('')}</div><h4>XP nach Quelle</h4><div class="mg-stats">${Object.entries(s.bySource).map(([a,b])=>`<div><span>${esc(({chat:'Chat',meme:'Memes',daily:lv('dailyNoun'),mission:lv('missionPlural'),manual:'Manuell',deleted:'Rückbuchungen'})[a]||a)}</span><strong>${Number(b).toLocaleString('de-DE')}</strong></div>`).join('')}</div><h4>${esc(lv('missionPlural'))} nach ${esc(lv('missionSingular'))}</h4><div class="mg-stats">${(o.byMission||[]).map(m=>`<div><span>${esc(m.name)} · ${m.successes}/${m.completed} erfolgreich</span><strong>${Number(m.xp).toLocaleString('de-DE')} XP</strong></div>`).join('')||`<p class="hint">Noch keine abgeschlossenen ${esc(lv('missionPlural'))} im Zeitraum.</p>`}</div><h4>Aktivste Teilnehmer</h4><div class="mg-stats">${(o.topPlayers||[]).map(m=>`<div><span>${esc(m.name)} · ${m.successes}/${m.completed} erfolgreich</span><strong>${Number(m.xp).toLocaleString('de-DE')} XP</strong></div>`).join('')||'<p class="hint">Noch keine Teilnehmer im Zeitraum.</p>'}</div><h4>Rangverteilung</h4><div class="mg-stats">${Object.entries(s.distribution).sort((a,b)=>b[1]-a[1]).map(([a,b])=>`<div><span>${esc(a)}</span><strong>${Number(b)}</strong></div>`).join('')}</div>`;}catch(e){$('levelStatsResults').textContent=e.message;}};
   $('levelStatsDays').onchange=loadStats;await loadStats();
  }
  if(tab==='discordLevelRanks')$('levelRankSave').onclick=async()=>{try{const updated=[...root.querySelectorAll('tr[data-rank]')].map(row=>{const oldRank=ranks[Number(row.dataset.rank)];const val=k=>row.querySelector(`[data-field="${k}"]`).value.trim();return {...oldRank,heer:val('heer'),luftwaffe:lv('branches')?val('luftwaffe'):val('heer'),marine:lv('branches')?val('marine'):val('heer'),xp:Number(val('xp')),active:row.querySelector('[data-field="active"]').checked};});let previous=-1;for(const r of updated){if(!Number.isSafeInteger(r.xp)||r.xp<=previous)throw Error('XP-Schwellen müssen eindeutig und aufsteigend sein.');if(['heer','luftwaffe','marine'].some(k=>!r[k]))throw Error(`Alle ${lv('rankNameWord')} ausfüllen.`);previous=r.xp;}await levelRequest('/api/discord/levelsystem/config','PUT',{ranks:updated});feedback(`${lv('rankPlural')} gespeichert.`+' Bitte Regeln danach erneut veröffentlichen.','success');await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};
  if(tab==='discordLevelPlayers'){
   let page=0,selected=null;const pageSize=()=>Number($('levelPlayerPageSize').value)||25;
   const view=()=>{const query=$('levelPlayerSearch').value.toLocaleLowerCase('de').trim(),branch=$('levelPlayerBranch').value,sort=$('levelPlayerOrder').value;const filtered=all.filter(u=>(!branch||u.branch===branch)&&(!query||String(u.id).includes(query)||String(u.name||'').toLocaleLowerCase('de').includes(query)));filtered.sort((a,b)=>sort==='name'?String(a.name||a.id).localeCompare(String(b.name||b.id),'de'):sort==='xp-asc'?a.xp-b.xp||a.id.localeCompare(b.id):b.xp-a.xp||a.id.localeCompare(b.id));const pages=Math.max(1,Math.ceil(filtered.length/pageSize()));page=Math.max(0,Math.min(page,pages-1));$('levelPlayerRows').innerHTML=filtered.slice(page*pageSize(),(page+1)*pageSize()).map(u=>`<tr><td>${esc(u.name||u.id)}<div class="hint">${esc(u.id)}</div></td>${lv('branches')?`<td>${esc(branches[u.branch]||u.branch||'–')}</td>`:''}<td>${esc((ranks.filter(r=>r.active!==false&&Number(u.xp)>=r.xp).at(-1)||{})[u.branch||'heer']||lv('noRank'))}</td><td>${Number(u.xp)||0}</td><td><div class="level-member-actions"><button class="secondary" data-user="${esc(u.id)}" ${editable?'':'disabled'}>XP ändern</button>${hasCapability('discord.members.view')?`<button class="secondary" data-member-profile="${esc(u.id)}">Profil öffnen</button>`:''}</div></td></tr>`).join('')||`<tr><td colspan="${lv('branches')?5:4}">Keine passenden Spieler.</td></tr>`;$('levelPlayerCount').textContent=filtered.length+' von '+all.length+' Spielern';$('levelPage').textContent=`Seite ${page+1} von ${pages}`;$('levelPrev').disabled=page===0;$('levelNext').disabled=page>=pages-1;$('levelPlayerRows').querySelectorAll('[data-user]').forEach(btn=>btn.onclick=()=>{selected=all.find(u=>u.id===btn.dataset.user);$('levelSelectedPlayer').textContent=(selected.name||selected.id)+' · '+selected.xp+' XP';$('levelPlayerEditor').hidden=false;});$('levelPlayerRows').querySelectorAll('[data-member-profile]').forEach(btn=>btn.onclick=()=>openDiscordMemberFromMinigame(btn.dataset.memberProfile));};
   for(const id of ['levelPlayerSearch','levelPlayerBranch','levelPlayerOrder','levelPlayerPageSize'])$(id).addEventListener(id==='levelPlayerSearch'?'input':'change',()=>{page=0;view();});$('levelPrev').onclick=()=>{page--;view();};$('levelNext').onclick=()=>{page++;view();};
   $('levelXpSave').onclick=async()=>{if(!selected)return;try{await updateDiscordMemberXp(selected.id,$('levelMode').value,$('levelAmount').value);await renderDiscordLevelsystem(tab);}catch(e){feedback(e.message);}};view();
  }
 }catch(e){root.innerHTML=`<h2>Minigame</h2><p class="hint">Daten konnten nicht geladen werden.</p>`;showToast(`Minigame: ${e.message}`,'error',6500);}
}

async function renderDiscordInvite(){
 const root=$("discordInvite");if(!root)return;
 root.innerHTML='<div class="card">Discord-Einladung wird geladen …</div>';
 try{
  const [r,cs]=await Promise.all([fetch("/api/discord/invite"),fetch("/api/discord/status")]);
  const data=await r.json();if(!r.ok)throw Error(data.error||"Invite konnte nicht geladen werden.");
  const status=await cs.json();
  const channels=Object.values(status?.checks?.channels||{}).filter(c=>c&&c.id&&[0,5].includes(Number(c.type)));
  const writable=isGlobalAdmin()&&hasCapability("discord.channels.edit");
  const statusLabels={valid:"Gültig",invalid:"Ungültig",unchecked:"Nicht geprüft",error:"Fehler"};
  root.innerHTML=`<div class="title"><div><h2>Discord · Einladungslink</h2><p class="hint">Zentrale, persistente Freigabe für Twitch-Commands mit {discord_invite}.</p></div></div>
  <div class="card"><h3>Discord-Einladungslink</h3>
  <label class="row wrap"><input id="inviteEnabled" type="checkbox" ${data.enabled?'checked':''} ${writable?'':'disabled'}> Discord-Einladung automatisch teilen</label>
  <label>Einladungskanal<select id="inviteChannel" ${writable?'':'disabled'}><option value="">Bitte Kanal wählen</option>${channels.map(c=>`<option value="${esc(c.id)}" ${c.id===data.channelId?'selected':''}>#${esc(c.name||c.id)}</option>`).join('')}${data.channelId&&!channels.some(c=>c.id===data.channelId)?`<option value="${esc(data.channelId)}" selected>Gespeicherter Kanal ${esc(data.channelId)}</option>`:''}</select></label>
  <div class="row wrap"><span>Status: <strong>${esc(statusLabels[data.status]||data.status)}</strong></span><span>Ablauf: ${esc(data.expiresAt?new Date(data.expiresAt).toLocaleString('de-DE'):'Läuft nie ab / unbekannt')}</span><span>Verwendungen: ${data.uses===null?'Nicht abrufbar':esc(String(data.uses))}</span></div>
  <p>Gespeicherter Invite: <strong>${esc(data.inviteUrl||'Kein Invite gespeichert')}</strong></p><p class="hint">Letzte erfolgreiche Prüfung: ${esc(data.lastSuccessfulCheckAt?new Date(data.lastSuccessfulCheckAt).toLocaleString('de-DE'):'Noch keine')}</p>
  ${data.lastError?`<div class="warning">${esc(data.lastError)}</div>`:''}
  <div class="row wrap">${writable?'<button id="inviteSave">Einstellungen speichern</button><button id="inviteCheck" class="secondary">Invite jetzt prüfen</button><button id="inviteCreate" class="secondary danger-outline">Neuen Invite erstellen</button>':'<p class="hint">Nur autorisierte Administratoren dürfen die Freigabe ändern.</p>'}</div>
  <p class="hint">Standardmäßig deaktiviert. Ein gespeicherter Invite bleibt bei Deaktivierung erhalten. Prüfintervall: sechs Stunden.</p></div>`;
  const request=async(path,method,body)=>{const rr=await fetch(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body||{})}),result=await rr.json();if(!rr.ok)throw Error(result.error||'Aktion fehlgeschlagen');showToast('Invite-Einstellungen aktualisiert.','success');renderDiscordInvite();};
  $("inviteSave")?.addEventListener("click",()=>request("/api/discord/invite/config","PUT",{enabled:$("inviteEnabled").checked,channelId:$("inviteChannel").value}).catch(e=>showToast(e.message,'error')));
  $("inviteCheck")?.addEventListener("click",()=>request("/api/discord/invite/check","POST",{}).catch(e=>showToast(e.message,'error')));
  $("inviteCreate")?.addEventListener("click",async()=>{
   const confirmed=await askConfirm({title:"Discord-Invite erstellen",text:"Wirklich einen neuen Discord-Invite erstellen? Bestehende Links werden nicht gelöscht.",confirmLabel:"INVITE ERSTELLEN",cancelLabel:"ABBRECHEN",danger:true});
   if(!confirmed)return;
   request("/api/discord/invite/create","POST",{confirm:true}).catch(e=>showToast(e.message,"error"));
  });
 }catch(e){root.innerHTML=`<div class="card error">${esc(e.message)}</div>`;}
}

// V8.6.9: Statische Klick-Aktionen ohne Inline-Handler (Content-Security-Policy ohne 'unsafe-inline' für Skripte).
document.addEventListener("click",ev=>{
  const el=ev.target instanceof Element?ev.target.closest("[data-click]"):null;
  if(!el)return;
  const actions={addCommand,addTimer,addGreeting,addBlocked,addAuto,saveAll,testMessage};
  const fn=actions[el.dataset.click];
  if(typeof fn==="function")fn();
});


// ===== Updates (8.9.10) =====
const UPDATE_STATUS_TEXT={deployed:"Installiert","failed-rolled-back":"Fehlgeschlagen, alter Stand wiederhergestellt","failed-before-change":"Nicht installiert (nichts verändert)","failed-manual-recovery-required":"Fehlgeschlagen, Eingriff nötig","not-started":"Nicht gestartet","approval-invalid":"Freigabe ungültig","approval-expired":"Freigabe abgelaufen",rejected:"Abgelehnt",superseded:"Durch neuere Version ersetzt",deploying:"Läuft",acknowledged:"Störung bestätigt","tools-pending":"Update-Werkzeug wird zuerst aktualisiert"};
// 8.11.0: Stand des Update-Werkzeugs auf dem Host (Fassung, Startdatei, fehlgeschlagenes Werkzeug-Update).
function updaterCardHtml(u){
  if(!u)return "";
  const fb=u.openFallback;
  const rows=[`Fassung <strong>${esc(u.toolVersion)}</strong> · ${u.launcher?"Startdatei aktiv: Das Werkzeug kann mit einem Release mitkommen und wird nach deiner Freigabe selbst gewechselt.":"ohne Startdatei: Das Werkzeug wird noch von Hand getauscht (Einrichtung siehe UPDATE-8.11.0.md)."}`];
  if(u.launcher&&u.previous)rows.push(`Rückfallfassung: ${esc(u.previous)}`);
  if(u.pending)rows.push(`Bereitgelegt: ${esc(u.pending)} – wird beim nächsten Lauf geprüft und aktiviert.`);
  if(u.lastSwitch)rows.push(`Letzter Wechsel: ${esc(u.lastSwitch.from||"–")} → ${esc(u.lastSwitch.to)} am ${esc(updateFmtDate(u.lastSwitch.at))}`);
  let html=`<div class="card ${fb?"error":""}"><h3>Update-Werkzeug</h3>${rows.map(r=>`<p class="hint">${r}</p>`).join("")}`;
  if(fb)html+=`<p><strong>Werkzeug-Update ${esc(fb.version)} fehlgeschlagen</strong> (${esc(updateFmtDate(fb.at))}): ${esc(fb.reason||"Grund unbekannt")}. Das bisherige Werkzeug läuft weiter; Updates des Control Centers bleiben möglich.</p>`;
  for(const w of u.warnings||[])html+=`<p class="hint">Hinweis: ${esc(w)}</p>`;
  return html+`</div>`;
}
let updatesTimer=null;
async function updatesCall(path,opts){
  const r=await fetch(path,opts);
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
  return data;
}
function updateFmtDate(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString("de-DE"):"";}
function updateFmtSize(n){return Number.isFinite(n)?(n/1024/1024).toFixed(1).replace(".",",")+" MB":"";}
async function renderUpdates(){
  const pane=$("updates");
  if(!hasRole("owner")){pane.innerHTML=`<div class="card error">Updates sind nur für Owner verfügbar.</div>`;return;}
  clearTimeout(updatesTimer);
  let d;
  try{d=await updatesCall("/api/updates");}
  catch(e){pane.innerHTML=`<div class="card error">Updates konnten nicht geladen werden: ${esc(e.message)}</div>`;return;}
  const a=d.active;
  let html=`<div class="title"><div><h2>Updates</h2><p class="hint">Laufende Version: <strong>${esc(d.currentVersion)}</strong>. Neue Versionen werden vom Pull-Deployment auf der NAS bereitgestellt, die Installation erfolgt nur nach deiner Freigabe.</p></div></div>`;
  if(!d.configured){
    html+=`<div class="card error"><h3>Freigabe-Verzeichnis nicht eingebunden</h3><p>Die Updates-Seite ist installiert, aber noch nicht mit dem Pull-Deployment verbunden. Einrichtung siehe UPDATE-8.9.10.md.</p></div>`;
  }
  if(a){
    const att=a.attention;
    html+=`<div class="card ${att?"error":""}"><h3>${att?"Eingriff nötig":"Update läuft"}: ${esc(a.version)}</h3>
      <p>Freigegeben von ${esc(a.approvedBy||"")} am ${esc(updateFmtDate(a.approvedAt))}. ${a.maintenance?.startedByUpdate?"Der Discord-Wartungsmodus wurde dafür aktiviert und wird danach automatisch beendet.":a.maintenance?.skipped?"Ohne Wartungsmodus freigegeben.":"Der Wartungsmodus war bereits aktiv und bleibt nach dem Update unverändert."}</p>
      ${att?`<p>${esc(att.message)}</p><div class="actions"><button class="secondary" data-update-ack="${esc(a.version)}" data-end="0">Störung bestätigen</button>${a.maintenance?.startedByUpdate?`<button class="secondary" data-update-ack="${esc(a.version)}" data-end="1">Bestätigen und Wartungsmodus beenden</button>`:""}</div>`:`<p class="hint">Das Host-Werkzeug prüft alle 5 Minuten. Diese Seite aktualisiert sich selbst.</p>`}</div>`;
  }
  const open=d.notices.filter(n=>!d.results.some(r=>r.version===n.version&&["deployed","rejected","superseded"].includes(r.status)));
  if(!open.length&&!a&&d.configured)html+=`<div class="card"><p>Keine neue Version. Das System ist auf dem aktuellen Stand.</p></div>`;
  for(const n of open){
    const running=a&&a.version===n.version;
    html+=`<div class="card"><h3>Version ${esc(n.version)}</h3>
      <p>${esc(n.summary||"Keine Beschreibung")}</p>
      <p class="hint">Veröffentlicht ${esc(updateFmtDate(n.publishedAt))} · ${esc(updateFmtSize(n.size))} · ${n.filesTotal} Dateien${n.tests?` · ${n.tests} Tests`:""} · Prüfsumme (SHA256) <code>${esc(n.sha256Short||"–")}</code></p>`;
    if(n.toolsUpdate){
      const t=n.toolsUpdate;
      html+=t.mode==="auto"
        ?`<p><strong>Enthält ein Werkzeug-Update:</strong> ${esc(t.from||"–")} → ${esc(t.version)}. Mit deiner Freigabe wird zuerst das Update-Werkzeug gewechselt (Selbsttest, bei Fehler Rückfall auf die bisherige Fassung), danach folgt die Installation im nächsten Lauf – insgesamt etwa 5 Minuten länger.</p>`
        :`<p class="hint">Das Release bringt das Update-Werkzeug ${esc(t.version)} mit; es wird nicht automatisch eingespielt${t.reason?` (${esc(t.reason)})`:""}.</p>`;
    }
    if(n.deepCheckDeferred)html+=`<p class="hint">Die Dateiliste dieser Version kann erst das neue Werkzeug prüfen. Das geschieht nach der Freigabe, bevor etwas verändert wird; Prüfsumme und Größe sind bereits geprüft.</p>`;
    if(n.manualReasons.length)html+=`<p><strong>Manuell zu installieren:</strong></p><ul>${n.manualReasons.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`;
    if(n.error)html+=`<p class="error-text">${esc(n.error)}</p>`;
    if(n.releaseUrl)html+=`<p><a href="${esc(n.releaseUrl)}" target="_blank" rel="noopener noreferrer">Release auf GitHub</a></p>`;
    if(n.approvable&&!running){
      html+=`<div class="actions"><button data-update-approve="${esc(n.version)}" data-sha="${esc(n.sha256Short)}" ${a?"disabled":""}>Freigeben und installieren</button><button class="secondary" data-update-approve="${esc(n.version)}" data-sha="${esc(n.sha256Short)}" data-skip="1" ${a?"disabled":""}>Ohne Wartungsmodus freigeben</button><button class="secondary" data-update-reject="${esc(n.version)}" ${a?"disabled":""}>Ablehnen</button></div>`;
      html+=`<p class="hint">Vor der Installation wechselt der Discord-Server automatisch in den Wartungsmodus und danach wieder zurück. Die Bots sind während der Installation kurz nicht erreichbar.</p>`;
    }else if(!n.approvable&&!running)html+=`<p class="hint">Status: ${esc(n.status)}. Diese Version kann hier nicht freigegeben werden.</p>`;
    html+=`</div>`;
  }
  const hist=[...(d.history||[]).map(h=>({version:h.version,status:h.outcome==="installed"?"deployed":(h.status||h.outcome),at:h.at,message:h.message})),...d.results.map(r=>({version:r.version,status:r.status,at:r.at,message:r.message}))];
  const seen=new Set(),rows=[];
  for(const h of hist){const k=h.version+"|"+h.status;if(seen.has(k))continue;seen.add(k);rows.push(h);}
  rows.sort((x,y)=>String(y.at).localeCompare(String(x.at)));
  html+=updaterCardHtml(d.updater);
  if(rows.length)html+=`<div class="card"><h3>Verlauf</h3><table class="table"><thead><tr><th>Version</th><th>Ergebnis</th><th>Zeitpunkt</th></tr></thead><tbody>${rows.slice(0,15).map(h=>`<tr><td>${esc(h.version)}</td><td>${esc(UPDATE_STATUS_TEXT[h.status]||h.status)}${h.message?`<br><small>${esc(String(h.message).slice(0,200))}</small>`:""}</td><td>${esc(updateFmtDate(h.at))}</td></tr>`).join("")}</tbody></table></div>`;
  pane.innerHTML=html;
  pane.querySelectorAll("[data-update-approve]").forEach(b=>b.addEventListener("click",()=>updateApprove(b.dataset.updateApprove,b.dataset.sha,b.dataset.skip==="1")));
  pane.querySelectorAll("[data-update-reject]").forEach(b=>b.addEventListener("click",()=>updateReject(b.dataset.updateReject)));
  pane.querySelectorAll("[data-update-ack]").forEach(b=>b.addEventListener("click",()=>updateAck(b.dataset.updateAck,b.dataset.end==="1")));
  if(a&&!a.attention)updatesTimer=setTimeout(()=>{if(!$("updates").classList.contains("hidden"))renderUpdates();},15000);
}
async function updateApprove(version,sha,skipMaintenance=false){
  const ok=await askConfirm({title:skipMaintenance?`Update ${version} ohne Wartungsmodus installieren?`:`Update ${version} installieren?`,text:skipMaintenance?`Der Discord-Wartungsmodus wird NICHT aktiviert. Die Bots sind während der Installation kurz nicht erreichbar, Mitglieder bekommen keinen Hinweis. Prüfsumme ${sha}.`:`Der Discord-Server geht in den Wartungsmodus, die Bots werden kurz neu gestartet und danach wird der Wartungsmodus automatisch beendet. Prüfsumme ${sha}.`,confirmLabel:"FREIGEBEN",danger:true});
  if(!ok)return;
  try{
    await updatesCall(`/api/updates/${version}/approve`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmVersion:version,confirmSha:sha,skipMaintenance})});
    showToast(skipMaintenance?"Update freigegeben (ohne Wartungsmodus).":"Update freigegeben. Der Wartungsmodus ist aktiv.");
  }catch(e){showToast("Freigabe fehlgeschlagen: "+e.message,"error",8000);}
  renderUpdates();
}
async function updateReject(version){
  const ok=await askConfirm({title:`Version ${version} ablehnen?`,text:"Die Version wird nicht installiert.",confirmLabel:"ABLEHNEN"});
  if(!ok)return;
  try{await updatesCall(`/api/updates/${version}/reject`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});showToast("Version abgelehnt.");}
  catch(e){showToast("Ablehnen fehlgeschlagen: "+e.message,"error",8000);}
  renderUpdates();
}
async function updateAck(version,endMaintenance){
  try{await updatesCall(`/api/updates/${version}/acknowledge`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({endMaintenance})});showToast("Störung bestätigt.");}
  catch(e){showToast("Fehlgeschlagen: "+e.message,"error",8000);}
  renderUpdates();
}
