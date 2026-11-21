"use strict";
// 9.25.3: Der Followathon-Zeitgeber lädt den Zustand nicht mehr jede Sekunde komplett aus PostgreSQL,
// sondern nur noch bei geänderter Revision (eine kleine Abfrage). Die Tests laufen gegen einen Fake-Speicher
// mit Zählern; die Datenbankabfrage selbst wird in der Release-Prüfung gegen einen echten Server geprüft.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createFollowathon } = require("../app/followathon");
const { createSubathon } = require("../app/subathon");

const clone = (v) => JSON.parse(JSON.stringify(v));

class FakeStore {
  constructor({ withRevision = true } = {}) {
    this.enabled = true;
    this.state = null;
    this.revision = 0;
    this.stateCalls = 0;
    this.revisionCalls = 0;
    this.putCalls = 0;
    this.revisionFails = false;
    if (withRevision) {
      this.getFollowathonRevision = () => {
        this.revisionCalls++;
        if (this.revisionFails) throw new Error("Revisionsabfrage defekt");
        return this.state ? { found: true, revision: this.revision } : { found: false };
      };
    }
  }
  getFollowathonState() { this.stateCalls++; return this.state ? { found: true, state: clone(this.state), revision: this.revision } : { found: false }; }
  hasDocument() { return false; }
  getDocument() { return {}; }
  importFollowathonStateIfEmpty(state) { if (this.state) return { inserted: false, revision: this.revision }; this.state = clone(state); this.revision = 1; return { inserted: true, revision: 1 }; }
  putFollowathonState(state, expectedRevision) {
    if (expectedRevision !== null && expectedRevision !== undefined && Number(expectedRevision) !== this.revision) {
      const e = new Error("revision conflict"); e.code = "FOLLOWATHON_REVISION_CONFLICT"; throw e;
    }
    this.putCalls++; this.state = clone(state); this.revision += 1; return { revision: this.revision };
  }
  markImport() { return { inserted: true }; }
  reset() { this.stateCalls = 0; this.revisionCalls = 0; this.putCalls = 0; }
}

const make = (store) => createFollowathon({ file: "/nicht-benutzt/followathon.json", storage: store, storageKey: "followathon", audit: () => {} });
const fakeRes = () => ({ out: [], writeHead() {}, write(s) { this.out.push(s); return true; }, on() {} });

async function running(store) {
  const fa = make(store);
  await fa.createEvent({ name: "Zwischenspeicher", startDurationSeconds: 600, secondsPerFollow: 60, creditAcceptance: true }, "owner");
  await fa.action("start", {}, "owner");
  return fa;
}

test("tick lädt den Stand nur einmal und danach nur noch die Revision", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  store.reset();
  for (let i = 0; i < 10; i++) fa.tick();
  assert.equal(store.stateCalls, 1, "voller Ladevorgang nur beim ersten Tick");
  assert.equal(store.revisionCalls, 9, "danach je Tick nur die Revisionsabfrage");
  assert.equal(store.putCalls, 0, "ein Tick ohne Änderung schreibt nichts");
});

test("mit verbundenem Overlay liest tick ebenfalls nur einmal je Sekunde", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  const res = fakeRes();
  fa.addSseClient(res, "127.0.0.1");
  assert.equal(res.out.length, 1, "neuer Client erhält sofort den Stand");
  store.reset();
  fa.tick(); fa.tick(); fa.tick();
  assert.equal(store.stateCalls, 0, "Zwischenspeicher ist nach dem Verbinden des Clients warm");
  assert.equal(store.revisionCalls, 3, "je Tick genau eine Revisionsabfrage (früher zwei volle Ladevorgänge)");
  assert.ok(res.out.length >= 2, "der Overlay-Client erhält weiterhin Zustandsmeldungen (gleiche Meldungen innerhalb derselben Millisekunde werden zusammengefasst)");
  const payload = JSON.parse(res.out[res.out.length - 1].split("\n")[1].slice(6));
  assert.equal(payload.exists, true);
  assert.equal(payload.status, "running");
});

test("Änderung durch eine zweite Instanz wird über die Revision erkannt", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  fa.tick();
  const other = make(store);
  await other.action("pause", {}, "owner");
  store.reset();
  const state = fa.getPublicState();
  assert.equal(state.status, "paused", "geänderter Stand wird neu geladen");
  assert.equal(store.stateCalls, 1);
  fa.getPublicState();
  assert.equal(store.stateCalls, 1, "danach wieder aus dem Zwischenspeicher");
});

test("eigene Schreibvorgänge machen den Zwischenspeicher ungültig, Zählung bleibt korrekt", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  fa.tick();
  const f1 = await fa.handleFollow({ user_id: "1", user_name: "Alpha", followed_at: new Date().toISOString() }, { message_id: "m1" });
  assert.equal(f1.decision, "credited");
  fa.tick();
  const dup = await fa.handleFollow({ user_id: "1", user_name: "Alpha", followed_at: new Date().toISOString() }, { message_id: "m2" });
  assert.equal(dup.decision, "duplicate-user");
  const f2 = await fa.handleFollow({ user_id: "2", user_name: "Bravo", followed_at: new Date().toISOString() }, { message_id: "m3" });
  assert.equal(f2.decision, "credited");
  const admin = await fa.getAdminState();
  assert.equal(admin.event.followCount, 2);
  assert.equal(admin.event.creditedSeconds, 120);
});

test("Aufrufer erhalten eigene Kopien: Verändern wirkt nicht auf den Zwischenspeicher", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  fa.tick();
  const a = (await fa.getAdminState()).event;
  a.name = "VERÄNDERT"; a.log.length = 0;
  const b = (await fa.getAdminState()).event;
  assert.equal(b.name, "Zwischenspeicher");
  assert.ok(b.log.length > 0);
});

test("abgelaufener Countdown wird im Tick beendet und gespeichert", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  fa.tick();
  const realNow = Date.now;
  Date.now = () => realNow() + 3 * 3600 * 1000;
  try { fa.tick(); } finally { Date.now = realNow; }
  assert.equal(store.state.events[0].status, "ended");
  assert.equal(store.state.events[0].endReason, "countdown-zero");
  const other = make(store);
  assert.equal((await other.getAdminState()).event.status, "ended");
});

test("fällt die Revisionsabfrage aus, wird wie bisher vollständig geladen (kein Fehler)", async () => {
  const store = new FakeStore();
  const fa = await running(store);
  fa.tick();
  store.revisionFails = true;
  store.reset();
  fa.tick(); fa.tick();
  assert.equal(store.stateCalls, 2, "ohne Revisionsabfrage wird jedes Mal geladen");
  assert.equal(fa.getPublicState().status, "running");
});

test("Speicher ohne Revisionsabfrage (ältere Speicherklasse) verhält sich unverändert", async () => {
  const store = new FakeStore({ withRevision: false });
  const fa = await running(store);
  store.reset();
  fa.tick(); fa.tick();
  assert.equal(store.stateCalls, 2);
});

test("Subathon-Tick liest je Sekunde nur einmal und ohne Overlay-Client nichts doppelt", () => {
  let reads = 0;
  const doc = { schema: 1, currentEventId: null, events: [], seenMessageIds: {}, config: { retentionDays: 90 } };
  const storage = { enabled: true, getDocument() { reads++; return clone(doc); }, putDocument() {} };
  const sa = createSubathon({ file: "/nicht-benutzt/s.json", storage, storageKey: "subathon" });
  reads = 0;
  sa.tick();
  assert.equal(reads, 1, "früher zwei Lesevorgänge je Tick");
  const res = fakeRes();
  sa.addSseClient(res, "127.0.0.1");
  reads = 0;
  sa.tick();
  assert.equal(reads, 1);
  assert.equal(res.out.length >= 2, true);
});

test("Datenbankschicht: Revisionsabfrage ist als Operation und Methode vorhanden", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "shared", "pg-sync-store.js"), "utf8");
  assert.match(src, /case "followathon_revision":/);
  assert.match(src, /SELECT revision FROM followathon_meta WHERE namespace=\$1/);
  assert.match(src, /getFollowathonRevision\(\)\{return this\.call\("followathon_revision"/);
});

test("Zeitgeber in server.js ruft weiterhin nur followathon.tick() und subathon.tick() auf", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "app", "server.js"), "utf8");
  assert.match(src, /followathon\.tick\(\)/);
  assert.match(src, /subathon\.tick\(\)/);
});
