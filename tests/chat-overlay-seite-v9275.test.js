"use strict";
// 9.27.5: Führt das Skript der Overlay-Seite mit einer kleinen DOM-Attrappe wirklich aus. 9.27.4 lieferte ein Skript aus,
// das beim Laden abbrach (Codeblock am Dateianfang); reine Textprüfungen hatten das nicht bemerkt.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ""; this.dataset = {}; this.textContent = ""; this.parentNode = null; this.listeners = {};
    const props = {}; this.style = { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; }, props };
    const self = this; this.classList = { add: c => { if (!self.className.split(" ").includes(c)) self.className = (self.className + " " + c).trim(); }, remove: c => { self.className = self.className.split(" ").filter(x => x !== c).join(" "); }, contains: c => self.className.split(" ").includes(c) }; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(typeof c === "string" ? { text: c, parentNode: null } : c); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.children[p.children.indexOf(this)] = n; n.parentNode = p; this.parentNode = null; }
  remove() { this.parentNode?.removeChild(this); }
  addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }
  setAttribute() {}
}
function runPage(search = "") {
  const chat = new El("div"), body = new El("body"), sources = [];
  class ES { constructor(u) { this.url = u; this.l = {}; sources.push(this); } addEventListener(n, f) { this.l[n] = f; } emit(n, d) { this.l[n]?.({ data: JSON.stringify(d) }); } }
  const context = { document: { getElementById: () => chat, body, createElement: t => new El(t), createTextNode: t => ({ text: t, parentNode: null }) },
    location: { search }, URLSearchParams, EventSource: ES, setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {}, clearTimeout: () => {}, console, Math, Number, String, Array, Object, JSON, RegExp, Map, Set, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(__dirname + "/../public/chat-overlay.js", "utf8"), context, { filename: "chat-overlay.js" });
  return { chat, body, source: sources[0] };
}
const imgs = el => el.children.filter(c => c.tag === "img");
const bubbleOf = chat => chat.children.at(-1).children.find(c => c.className.includes("bubble"));

test("Seite lädt fehlerfrei, verbindet sich und zeigt eine Textnachricht", () => {
  const { chat, source } = runPage("");
  assert.ok(source, "EventSource wurde nicht angelegt: Skript bricht beim Laden ab");
  source.emit("message", { id: "m1", name: "Anna", kind: "chat", parts: [{ t: "text", v: "Hallo" }], badges: [] });
  assert.equal(chat.children.length, 1);
  assert.equal(bubbleOf(chat).children[0].text, "Hallo");
});
test("Vorschau (?demo=1) erzeugt Beispielnachrichten", () => {
  const { chat } = runPage("?demo=1");
  assert.ok(chat.children.length >= 1);
});
test("Twitch-Emote und Fremd-Emote werden als Bild gezeigt, mit festen Adressen", () => {
  const { chat, source } = runPage("");
  source.emit("message", { id: "m2", name: "Anna", kind: "chat", badges: [], parts: [
    { t: "emote", id: "25", v: "Kappa" }, { t: "text", v: " " },
    { t: "ext", p: "7tv", id: "01FCY771D800007PQ2DF3GDTN6", v: "RainTime" }, { t: "text", v: " " },
    { t: "ext", p: "bttv", id: "54fa8f1401e468494b85b537", v: "CiGrip" }, { t: "ext", p: "ffz", id: "9", v: "ZrehplaR" }] });
  const src = imgs(bubbleOf(chat)).map(i => i.src);
  assert.deepEqual(src, [
    "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
    "https://cdn.7tv.app/emote/01FCY771D800007PQ2DF3GDTN6/2x.webp",
    "https://cdn.betterttv.net/emote/54fa8f1401e468494b85b537/2x.webp",
    "https://cdn.frankerfacez.com/emote/9/2"]);
});
test("Ungültige Dienste oder Kennungen werden als Text gezeigt, nie als Bild", () => {
  const { chat, source } = runPage("");
  source.emit("message", { id: "m3", name: "Anna", kind: "chat", badges: [], parts: [
    { t: "ext", p: "evil", id: "abc", v: "A" }, { t: "ext", p: "7tv", id: "\"><img src=x>", v: "B" }, { t: "ext", p: "ffz", id: "12/../x", v: "C" }] });
  assert.equal(imgs(bubbleOf(chat)).length, 0);
  assert.equal(bubbleOf(chat).children.map(c => c.text).join(""), "ABC");
});
test("Zero-Width-Emote wird über das vorherige gelegt", () => {
  const { chat, source } = runPage("");
  source.emit("message", { id: "m4", name: "Anna", kind: "chat", badges: [], parts: [
    { t: "ext", p: "bttv", id: "54fa8f1401e468494b85b537", v: "CiGrip" }, { t: "text", v: " " },
    { t: "ext", p: "7tv", id: "01FCY771D800007PQ2DF3GDTN6", v: "RainTime", zw: true }] });
  const stack = bubbleOf(chat).children.find(c => c.className.includes("stack"));
  assert.ok(stack); assert.equal(imgs(stack).length, 2); assert.ok(imgs(stack)[1].className.includes("zw"));
});
