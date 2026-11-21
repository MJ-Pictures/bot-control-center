"use strict";
// 9.20.3: Eigene EventSub-WebSocket-Verbindung für das Kanal-Konto (Subathon: Abos, Geschenkabos, Resubs, Bits).
// Twitch bindet eine WebSocket-Sitzung an den Benutzer, dessen Token die Abos anlegt. Die Verbindung des Haupt-Bots
// kann deshalb keine Abos mit dem Token des Kanalinhabers aufnehmen; diese Verbindung gehört allein dem Kanal-Konto.
// Abhängigkeiten sind einsetzbar (WebSocket, Abo-Anlage, Zeitgeber), damit sie ohne Twitch getestet werden kann.

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const SUBATHON_TYPES = Object.freeze([
  ["channel.subscribe", "1"],
  ["channel.subscription.gift", "1"],
  ["channel.subscription.message", "1"],
  ["channel.cheer", "1"]
]);

function createChannelEventSub({
  WebSocketImpl = globalThis.WebSocket,
  url = EVENTSUB_URL,
  types = SUBATHON_TYPES,
  createSubscription,            // async (type, version, sessionId) => { ok, status, error }
  onNotification,                // async (type, event, metadata) => void
  log = console,
  now = () => Date.now(),
  setTimer = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
  clearTimer = t => clearTimeout(t),
  setTick = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
  clearTick = t => clearInterval(t),
  backoffMs = [2000, 5000, 15000, 30000, 60000]
} = {}) {
  if (typeof createSubscription !== "function") throw new Error("createSubscription fehlt.");
  if (typeof onNotification !== "function") throw new Error("onNotification fehlt.");

  let wanted = false, socket = null, pending = null, sessionId = null, attempts = 0;
  let reconnectTimer = null, watch = null, keepaliveMs = 45000, lastMessageAt = 0, generation = 0;
  const seen = new Map();   // message_id → Zeit (Entdoppelung)
  const st = { state: "stopped", lastError: null, lastConnectedAt: null, lastDisconnectedAt: null, lastCloseCode: null, subscriptions: {} };

  const stamp = () => new Date(now()).toISOString();
  const OPEN = () => WebSocketImpl.OPEN ?? 1;
  const isOpen = s => !!s && s.readyState === OPEN();
  const rememberMessage = (id) => {
    const t = now();
    for (const [k, v] of seen) if (t - v > 10 * 60000) seen.delete(k);
    if (seen.has(id)) return false;
    seen.set(id, t); return true;
  };

  function clearWatch() { if (watch) { clearTick(watch); watch = null; } }
  function startWatch(gen) {
    clearWatch();
    watch = setTick(() => {
      if (gen !== generation || !isOpen(socket)) return;
      if (now() - lastMessageAt > keepaliveMs * 1.5) {
        st.lastError = "Keepalive-Timeout";
        try { socket.close(4000, "keepalive timeout"); } catch {}
      }
    }, 5000);
  }

  function scheduleReconnect() {
    if (!wanted || reconnectTimer) return;
    const delay = backoffMs[Math.min(attempts, backoffMs.length - 1)]; attempts++;
    st.state = "reconnecting";
    reconnectTimer = setTimer(() => { reconnectTimer = null; if (wanted) open(url); }, delay);
  }

  async function subscribeAll(sid, gen) {
    st.subscriptions = {};
    for (const [type, version] of types) {
      if (gen !== generation) return;
      try {
        const r = await createSubscription(type, version, sid);
        st.subscriptions[type] = r && r.ok ? { ok: true, status: r.status ?? 202, updatedAt: stamp() } : { ok: false, status: r?.status ?? null, error: String(r?.error || "").slice(0, 300), updatedAt: stamp() };
      } catch (e) {
        st.subscriptions[type] = { ok: false, status: null, error: String(e?.message || e).slice(0, 300), updatedAt: stamp() };
      }
    }
  }

  function open(target, { reconnect = false } = {}) {
    let s;
    try { s = new WebSocketImpl(target); }
    catch (e) { st.lastError = String(e?.message || e); scheduleReconnect(); return; }
    if (reconnect) pending = s; else { socket = s; st.state = "connecting"; }
    const gen = generation;
    s.onmessage = async (ev) => {
      if (gen !== generation) return;
      let msg; try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch { return; }
      const type = msg?.metadata?.message_type;
      lastMessageAt = now();
      if (type === "session_welcome") {
        const sess = msg.payload?.session || {};
        if (reconnect) {
          // Twitch übernimmt die Abos in die neue Sitzung; die alte Verbindung kann schließen.
          const old = socket; socket = s; pending = null; sessionId = sess.id || sessionId;
          try { old?.close(1000, "reconnected"); } catch {}
        } else {
          sessionId = sess.id || null;
          st.state = "connected"; st.lastConnectedAt = stamp(); st.lastError = null; attempts = 0;
          if (Number(sess.keepalive_timeout_seconds) > 0) keepaliveMs = Number(sess.keepalive_timeout_seconds) * 1000;
          startWatch(gen);
          await subscribeAll(sessionId, gen);
        }
      } else if (type === "session_keepalive") {
        // nur Lebenszeichen
      } else if (type === "session_reconnect") {
        const next = msg.payload?.session?.reconnect_url;
        if (next && !pending) open(next, { reconnect: true });
      } else if (type === "notification") {
        const id = msg.metadata?.message_id;
        if (id && !rememberMessage(id)) return;
        try { await onNotification(msg.metadata?.subscription_type || msg.payload?.subscription?.type, msg.payload?.event || {}, msg.metadata || {}); }
        catch (e) { log.warn?.(`⚠️ Subathon-Ereignis konnte nicht verarbeitet werden: ${e?.message || e}`); }
      } else if (type === "revocation") {
        const t = msg.payload?.subscription?.type;
        if (t) st.subscriptions[t] = { ok: false, status: null, error: `Von Twitch widerrufen (${msg.payload?.subscription?.status || "unbekannt"})`, updatedAt: stamp() };
      }
    };
    s.onerror = () => { st.lastError = "Verbindungsfehler"; };
    s.onclose = (ev) => {
      if (s === pending) { pending = null; return; }
      if (s !== socket) return;          // alte, bewusst ersetzte Verbindung
      socket = null; sessionId = null; clearWatch();
      st.lastDisconnectedAt = stamp(); st.lastCloseCode = Number(ev?.code || 0) || null;
      if (!wanted) { st.state = "stopped"; return; }
      scheduleReconnect();
    };
  }

  function start() {
    if (wanted) return;
    wanted = true; generation++; attempts = 0; st.lastError = null;
    open(url);
  }
  function stop() {
    wanted = false; generation++;
    if (reconnectTimer) { clearTimer(reconnectTimer); reconnectTimer = null; }
    clearWatch();
    for (const s of [socket, pending]) { try { s?.close(1000, "stop"); } catch {} }
    socket = null; pending = null; sessionId = null; st.state = "stopped"; st.subscriptions = {};
  }
  const status = () => ({
    running: wanted, state: st.state, connected: st.state === "connected" && isOpen(socket), sessionReady: !!sessionId,
    lastError: st.lastError, lastConnectedAt: st.lastConnectedAt, lastDisconnectedAt: st.lastDisconnectedAt, lastCloseCode: st.lastCloseCode,
    subscriptions: JSON.parse(JSON.stringify(st.subscriptions))
  });
  return Object.freeze({ start, stop, status, isWanted: () => wanted });
}

module.exports = { createChannelEventSub, SUBATHON_TYPES, EVENTSUB_URL };
