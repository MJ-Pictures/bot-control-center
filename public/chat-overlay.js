"use strict";
// 9.27.0: Chat-Overlay. Alle Texte werden als Text eingesetzt (nie als HTML); Bilder nur von Twitchs Bildserver
// (Emotes über die Emote-Kennung, Abzeichen nur mit geprüfter Adresse). Die Seite hat keine eigenen Daten:
// Nachrichten kommen über den Ereignisstrom der Weboberfläche und sind dort schon gefiltert.
const chat = document.getElementById("chat");
const params = new URLSearchParams(location.search);
const demo = params.get("demo") === "1";
const EMOTE = /^[A-Za-z0-9_-]{1,80}$/;
// 9.27.4: Emotes von Drittanbietern. Die Adressen entstehen nur aus diesen festen Vorlagen und einer geprüften Kennung.
const EXT = { "7tv": id => `https://cdn.7tv.app/emote/${id}/2x.webp`, bttv: id => `https://cdn.betterttv.net/emote/${id}/2x.webp`, ffz: id => `https://cdn.frankerfacez.com/emote/${id}/2` };
const EXT_ID = { "7tv": /^[A-Za-z0-9]{10,40}$/, bttv: /^[a-f0-9]{24}$/i, ffz: /^[0-9]{1,9}$/ };
const BADGE = /^https:\/\/static-cdn\.jtvnw\.net\/badges\/v1\/[0-9a-f-]{36}\/[1-4]$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const IMAGE_URL = /^\/branding\/image\/[A-Za-z]{1,30}\?v=[A-Za-z0-9]{1,16}$/;
const THEMES = ["dark", "light", "angular"];
let images = {};   // eigene Bilder der Installation (Symbole, Textur), nur geprüfte Adressen
let cfg = { theme: "dark", align: "left", fontScale: 100, maxMessages: 8, displaySeconds: 60, accentColor: "#FAB70A", font: "system", showBadges: true, showEmotes: true, nameColorDot: false };
const items = new Map();   // Nachrichten-ID → { el, uid, timer }

function applyConfig(c) {
  cfg = { ...cfg, ...c };
  let theme = cfg.theme, align = cfg.align;
  if (demo) { // Nur in der Vorschau: Look und Ausrichtung per Adresse prüfbar (?theme=light&align=right)
    if (THEMES.includes(params.get("theme"))) theme = params.get("theme");
    if (["left", "right"].includes(params.get("align"))) align = params.get("align");
  }
  const b = document.body;
  b.dataset.theme = THEMES.includes(theme) ? theme : "dark";
  b.dataset.align = align === "right" ? "right" : "left";
  const customFont = cfg.font === "custom" && FONT_NAME.test(String(cfg.fontFamily || ""));
  b.dataset.font = cfg.font === "akzidenz" ? "akzidenz" : customFont ? "custom" : "system";
  if (customFont) b.style.setProperty("--font", `"${cfg.fontFamily}"`); else b.style.removeProperty("--font");
  b.dataset.anchor = cfg.anchor === "top" ? "top" : "bottom";
  const px = (v, d) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(400, Number(v))) : d;
  b.style.setProperty("--mx", `${px(cfg.marginX, 24)}px`); b.style.setProperty("--my", `${px(cfg.marginY, 24)}px`);
  const wp = Number(cfg.widthPercent);
  chat.style.width = Number.isFinite(wp) && wp >= 20 && wp <= 100 ? `min(${wp}vw,calc(100% - 2*var(--mx,24px)))` : "";
  for (const [key, prop] of [["tabColor", "--tab"], ["tabTextColor", "--tabfg"], ["bubbleColor", "--bub"], ["bubbleTextColor", "--bubfg"]])
    if (COLOR.test(String(cfg[key] || ""))) b.style.setProperty(prop, cfg[key]); else b.style.removeProperty(prop);
  images = {};
  for (const [slot, url] of Object.entries(cfg.images || {})) if (/^chat[A-Za-z]+$/.test(slot) && IMAGE_URL.test(String(url))) images[slot] = String(url);
  if (images.chatTexture) { b.style.setProperty("--tex", `url("${images.chatTexture}")`); b.style.setProperty("--texo", String(Math.max(0.05, Math.min(1, Number(cfg.textureOpacity) / 100 || 0.6)))); b.classList.add("has-tex"); }
  else { b.style.removeProperty("--tex"); b.classList.remove("has-tex"); }
  b.style.setProperty("--accent", COLOR.test(cfg.accentColor) ? cfg.accentColor : "#FAB70A");
  b.style.setProperty("--scale", String(Math.min(1.6, Math.max(0.7, Number(cfg.fontScale) / 100 || 1))));
  trim();
}
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const TIER = { "1": "Stufe 1", "2": "Stufe 2", "3": "Stufe 3", prime: "Prime" };
// Titel und Untertext jeder Kartenart; alle Texte werden als Text eingesetzt.
const CARDS = {
  follow: { title: () => "Neuer Follower", sub: () => "" },
  raid: { title: () => "Raid", sub: m => Number.isInteger(m.viewers) ? `mit ${plural(m.viewers, "Zuschauer", "Zuschauern")}` : "" },
  sub: { title: () => "Neuer Abonnent", sub: m => TIER[m.tier] || "" },
  resub: { title: () => "Abo verlängert", sub: m => [Number.isInteger(m.amount) ? `seit ${plural(m.amount, "Monat", "Monaten")}` : "", TIER[m.tier] || ""].filter(Boolean).join(" · ") },
  gift: { title: () => "Geschenkabo", sub: m => m.target ? `schenkt ${m.target} ein Abo` : "verschenkt ein Abo" },
  gifts: { title: () => "Geschenkabos", sub: m => Number.isInteger(m.amount) ? `verschenkt ${m.amount === 1 ? "ein Abo" : plural(m.amount, "Abo", "Abos")}` : "verschenkt Abos" },
  bits: { title: () => "Bits", sub: m => Number.isInteger(m.amount) ? plural(m.amount, "Bit", "Bits") : "" },
  redeem: { title: () => "Kanalpunkte", sub: m => m.title ? `löst „${m.title}“ ein` : "löst eine Belohnung ein" }
};
const ICON_SLOT = { follow: "chatIconFollow", raid: "chatIconRaid", sub: "chatIconSub", resub: "chatIconSub", gift: "chatIconGift", gifts: "chatIconGift", bits: "chatIconBits", redeem: "chatIconRedeem" };
const ICON_CLASS = { follow: "follow", raid: "raid", sub: "sub", resub: "sub", gift: "gift", gifts: "gift", bits: "bits", redeem: "redeem" };
function buildCard(m) {
  const kind = CARDS[m.event] ? m.event : "follow";
  const msg = el("div", `msg card ${ICON_CLASS[kind]}`);
  const tab = el("div", "tab");
  const ico = el("span", "ico");
  const own = images[ICON_SLOT[kind]];
  if (own) { ico.classList.add("custom"); ico.style.backgroundImage = `url("${own}")`; }
  tab.append(ico, el("span", "nm", CARDS[kind].title(m)));
  const bubble = el("div", "bubble");
  bubble.appendChild(el("span", "who", String(m.name || "")));
  const sub = CARDS[kind].sub(m);
  if (sub) bubble.appendChild(el("span", "sub", sub));
  msg.append(tab, bubble);
  return msg;
}
function build(m) {
  if (m.kind === "event") return buildCard(m);
  const msg = el("div", "msg" + (m.kind === "bot" ? " bot" : ""));
  const tab = el("div", "tab");
  if (cfg.nameColorDot && COLOR.test(m.color || "")) { const d = el("span", "dot"); d.style.background = m.color; tab.appendChild(d); }
  tab.appendChild(el("span", "nm", String(m.name || "")));
  const badges = cfg.showBadges && Array.isArray(m.badges) ? m.badges.filter(x => x && BADGE.test(String(x.u || ""))) : [];
  if (badges.length) {
    const wrap = el("span", "badges");
    for (const x of badges.slice(0, 6)) { const img = el("img", "badge"); img.alt = ""; img.src = x.u; img.referrerPolicy = "no-referrer"; wrap.appendChild(img); }
    tab.appendChild(wrap);
  }
  const bubble = el("div", "bubble");
  if (m.reply) bubble.appendChild(el("span", "rp", "↩ " + String(m.reply)));
  let last = null;                                           // zuletzt gezeigtes Emote-Bild (für Zero-Width-Emotes)
  for (const p of Array.isArray(m.parts) ? m.parts : []) {
    if (p.t === "emote" && cfg.showEmotes && EMOTE.test(String(p.id || ""))) {
      const img = el("img", "emote"); img.alt = String(p.v || ""); img.referrerPolicy = "no-referrer";
      img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${p.id}/default/dark/2.0`;
      img.addEventListener("error", () => img.replaceWith(document.createTextNode(String(p.v || ""))));
      bubble.appendChild(img); last = img;
    } else if (p.t === "ext" && cfg.showEmotes && EXT[p.p] && EXT_ID[p.p].test(String(p.id || ""))) {
      const img = el("img", "emote"); img.alt = String(p.v || ""); img.referrerPolicy = "no-referrer";
      img.src = EXT[p.p](p.id);
      img.addEventListener("error", () => img.replaceWith(document.createTextNode(String(p.v || ""))));
      if (p.zw === true && last && last.parentNode) {
        let host = last.parentNode;
        if (!host.classList.contains("stack")) { host = el("span", "stack"); last.replaceWith(host); host.appendChild(last); }
        img.classList.add("zw"); host.appendChild(img);
      } else { bubble.appendChild(img); last = img; }
    } else if (p.t === "emote" || p.t === "ext" || p.t === "text") {
      const text = String(p.v || "");
      bubble.appendChild(document.createTextNode(text));
      if (/\S/.test(text)) last = null;                       // Leerzeichen zwischen Emotes unterbrechen die Reihe nicht
    }
  }
  msg.append(tab, bubble);
  return msg;
}
function drop(id, animate = true) {
  const it = items.get(id);
  if (!it) return;
  items.delete(id);
  clearTimeout(it.timer);
  if (!animate) { it.el.remove(); return; }
  it.el.classList.add("out");
  setTimeout(() => it.el.remove(), 380);
}
function trim() {
  const max = Math.max(3, Math.min(15, Number(cfg.maxMessages) || 8));
  while (items.size > max) drop(items.keys().next().value, false);
}
function add(m, ageMs = 0) {
  if (!m || typeof m.id !== "string" || items.has(m.id)) return;
  const e = build(m);
  chat.appendChild(e);
  const it = { el: e, uid: m.uid || null, timer: null };
  items.set(m.id, it);
  const life = Number(cfg.displaySeconds) > 0 ? Number(cfg.displaySeconds) * 1000 - (Number(ageMs) || 0) : 0;
  if (Number(cfg.displaySeconds) > 0) it.timer = setTimeout(() => drop(m.id), Math.max(500, life));
  trim();
}
function removeBy(d) {
  if (d.id) drop(String(d.id));
  else if (d.uid) for (const [id, it] of [...items]) if (it.uid === String(d.uid)) drop(id);
}
function clearAll() { for (const id of [...items.keys()]) drop(id); }

function connect() {
  const stream = new EventSource("/api/chat-overlay/public/stream");
  const parse = fn => ev => { try { fn(JSON.parse(ev.data)); } catch { /* ungültige Daten ignorieren */ } };
  stream.addEventListener("config", parse(applyConfig));
  stream.addEventListener("history", parse(list => { if (Array.isArray(list)) for (const m of list) add(m, m.ageMs); }));
  stream.addEventListener("message", parse(m => { if (!demo || !m.id.startsWith("test-")) add(m); }));
  stream.addEventListener("remove", parse(removeBy));
  stream.addEventListener("clear", parse(clearAll));
}

// Vorschau: ?demo=1 erzeugt Beispielnachrichten im Browser (kein Chat nötig).
function startDemo() {
  const samples = [
    ["Nachtfuchs89", "Moin zusammen!", "moderator"], ["KaffeeHeld", "Ton ist da, läuft super.", ""],
    ["Wolke7", "Grüße aus Köln! Heute ist richtig was los im Chat und der Stream sieht klasse aus.", ""],
    ["LinaLiest", "Schöner Streamstart!", "subscriber"], ["NordlichtTim", "Bin neu hier, hallo!", ""],
    ["Kekskrümel", "Das ist eine bewusst lange Nachricht, damit man im Vorschau-Modus sieht, wie der Zeilenumbruch in diesem Look aussieht.", ""]
  ];
  let n = 0;
  const next = () => {
    const [name, text, badge] = samples[n % samples.length];
    add({ id: `demo-${n}`, uid: String(1000 + n), name, color: ["#3C8DFF", "#E24C4C", "#2EB87A", "#B06BFF"][n % 4], kind: "chat", badges: [], parts: [{ t: "text", v: text }], reply: n % 5 === 4 ? "KaffeeHeld" : null });
    n++;
  };
  next(); next();
  setInterval(next, 2400);
  // Beispiel-Ereigniskarten, damit auch sie in der Vorschau zu sehen sind
  setTimeout(() => add({ id: "demo-follow", kind: "event", event: "follow", name: "Nachtfuchs89" }), 1200);
  setTimeout(() => add({ id: "demo-raid", kind: "event", event: "raid", name: "BeispielKanal", viewers: 24 }), 4200);
  setTimeout(() => add({ id: "demo-resub", kind: "event", event: "resub", name: "Treue_Seele", amount: 14, tier: "1" }), 6600);
  setTimeout(() => add({ id: "demo-bits", kind: "event", event: "bits", name: "Cheerer", amount: 100 }), 9000);
  setTimeout(() => add({ id: "demo-redeem", kind: "event", event: "redeem", name: "Fitnessfan", amount: 500, title: "10 Liegestütze" }), 11400);
}

applyConfig({});
connect();
if (demo) startDemo();
