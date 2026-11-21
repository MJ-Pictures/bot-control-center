"use strict";
// 9.1.1: Zentrale Modulregistrierung. Jedes abschaltbare Modul trägt sich hier ein und bekommt
// automatisch einen Schieberegler unter Administration → Integrationen → Module.
//
// Regeln (Mario, 16.11.2026):
//  - Ein ausgeschaltetes Modul ist nirgends in der Oberfläche sichtbar (Navigation, Reiter, Übersichten).
//  - Beim Ausschalten wird eine Warnung angezeigt (kann unter Umständen zu Datenverlusten führen).
//  - Die Daten bleiben beim Ausschalten erhalten (Variante A): das Modul ruht nur, beim
//    Wiedereinschalten ist alles wie vorher. Solange es aus ist, wird nichts erfasst.
//  - Neue Module sind standardmäßig aus; bestehende Installationen behalten ihr Verhalten.
//
// Zustand: settings.modules = { <id>: true|false }. Diese Datei hat keine Abhängigkeiten.

const MODULES = Object.freeze([
  Object.freeze({
    id: "lurkReturn",
    label: "Lurk-Rückkehr",
    description: "Meldet im Twitch-Chat, wie lange jemand nach einem Lurk-Command weg war (Community → Lurk-Rückkehr).",
    platform: "twitch",
    defaultEnabled: false,
    requires: Object.freeze([]),
    // Oberflächen-Reiter, die nur bei eingeschaltetem Modul sichtbar sind.
    tabs: Object.freeze(["lurk"]),
    // Zusatz zur Warnmeldung beim Ausschalten: was bleibt, was geht verloren.
    offNote: "Einstellungen, Stufen und laufende Lurk-Zustände bleiben gespeichert. Solange das Modul aus ist, werden keine Lurks und Rückkehrer erfasst; wer in dieser Zeit weggeht, wird nicht gemeldet.",
    // Bestehende Installationen: war das Modul vor 9.1.1 schon aktiv, bleibt es an.
    legacyEnabled: settings => settings?.lurkReturn?.enabled === true,
    runsIn: "Twitch-Bot"
  }),
  // 9.2.0: bestehende Fachmodule. Standard „an“, damit sich bestehende Installationen nicht ändern.
  Object.freeze({
    id: "giveaway",
    label: "Gewinnspiel",
    description: "Gewinnspiele im Twitch-Chat: Teilnahme per Chatnachricht, Ziehung, Verlauf (Gruppe „Gewinnspiel“).",
    platform: "twitch",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["giveaway"]),
    apiPrefixes: Object.freeze(["/api/giveaway"]),
    offNote: "Laufende und vergangene Gewinnspiele bleiben gespeichert. Solange das Modul aus ist, nimmt niemand per Chat teil und es kann nichts gestartet oder gezogen werden. Ausschalten ist nicht möglich, solange ein Gewinnspiel läuft.",
    runsIn: "Weboberfläche und Twitch-Bot"
  }),
  Object.freeze({
    id: "followerAlert",
    label: "Follower-Alert",
    description: "OBS-Einblendung bei neuen Followern (Live-Zentrale → Follower-Alert).",
    platform: "twitch",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["followerAlert"]),
    apiPrefixes: Object.freeze(["/api/follower-alert"]),
    overlayPages: Object.freeze(["/follower-alert/overlay"]),
    publicStates: Object.freeze(["/api/follower-alert/public/state"]),
    publicStreams: Object.freeze(["/api/follower-alert/public/stream"]),
    offNote: "Die Einstellungen bleiben gespeichert. Solange das Modul aus ist, zeigt die OBS-Quelle eine leere Seite und neue Follower werden nicht eingeblendet. Event-Profile verändern den Follower-Alert dann nicht.",
    runsIn: "Weboberfläche"
  }),
  // 9.3.0
  Object.freeze({
    id: "followathon",
    label: "Followathon",
    description: "Countdown, der durch neue Follower verlängert wird, mit OBS-Overlay (Live-Zentrale → Followathon).",
    platform: "twitch",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["followathon"]),
    apiPrefixes: Object.freeze(["/api/followathon"]),
    overlayPages: Object.freeze(["/followathon/overlay"]),
    publicStates: Object.freeze(["/api/followathon/public/state"]),
    publicStreams: Object.freeze(["/api/followathon/public/stream"]),
    offNote: "Events, Verlauf und Gutschriften bleiben gespeichert. Solange das Modul aus ist, werden keine Follows gutgeschrieben und die OBS-Quelle zeigt eine leere Seite. Ausschalten ist nicht möglich, solange ein Followathon läuft oder pausiert ist.",
    runsIn: "Weboberfläche"
  }),
  // 9.20.0
  Object.freeze({
    id: "subathon",
    label: "Subathon",
    description: "Countdown, der durch Abos, geschenkte Abos, Bits und (optional) Follows verlängert wird, mit OBS-Overlay (Live-Zentrale → Subathon). Beim Start wird ein laufender Followathon beendet.",
    platform: "twitch",
    defaultEnabled: false,
    requires: Object.freeze([]),
    tabs: Object.freeze(["subathon"]),
    apiPrefixes: Object.freeze(["/api/subathon"]),
    overlayPages: Object.freeze(["/subathon/overlay"]),
    publicStates: Object.freeze(["/api/subathon/public/state"]),
    publicStreams: Object.freeze(["/api/subathon/public/stream"]),
    offNote: "Events, Verlauf und Gutschriften bleiben gespeichert. Solange das Modul aus ist, werden keine Abos, Bits oder Follows gutgeschrieben und die OBS-Quelle zeigt eine leere Seite. Ausschalten ist nicht möglich, solange ein Subathon läuft oder pausiert ist.",
    runsIn: "Weboberfläche (Ereignisse kommen über den Twitch-Bot)"
  }),
  Object.freeze({
    id: "stubenkontrolle",
    // 9.11.0: {game}, {points} und {commands} setzt die Weboberfläche aus dem Installationsprofil ein.
    label: "{game}",
    description: "Chat-Spiel mit eigener Punktewährung „{points}“ ({commands}) und OBS-Overlay (Live-Zentrale → {game}).",
    platform: "twitch",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["stubenkontrolle"]),
    apiPrefixes: Object.freeze(["/api/stubenkontrolle"]),
    overlayPages: Object.freeze(["/stubenkontrolle/overlay"]),
    offNote: "{points}, Runden und Buchungen bleiben gespeichert. Solange das Modul aus ist, reagiert der Bot nicht auf die Spiel-Befehle (eigene Commands mit gleichem Namen greifen dann wieder) und die OBS-Quelle zeigt eine leere Seite. Ausschalten ist nicht möglich, solange eine Runde läuft. Event-Profile verändern {game} dann nicht.",
    runsIn: "Weboberfläche (Befehle kommen über den Twitch-Bot)"
  }),
  // 9.4.0: erstes Modul im Discord-Bot. Der Discord-Bot erfährt den Stand über shared/module-state-client.js.
  Object.freeze({
    id: "socialMedia",
    label: "Social Media",
    description: "Neue Instagram- und TikTok-Beiträge automatisch in Discord veröffentlichen (Gruppe „Social Media“).",
    platform: "discord",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["socialOverview", "socialInstagram", "socialTikTok", "socialPublications", "socialSettings"]),
    apiPrefixes: Object.freeze(["/api/social", "/auth/tiktok"]),
    offNote: "Verbindungen, Einstellungen und der Verlauf veröffentlichter Beiträge bleiben gespeichert. Solange das Modul aus ist, werden Instagram und TikTok nicht abgefragt und nichts in Discord veröffentlicht; Beiträge aus dieser Zeit werden beim Wiedereinschalten nur dann nachgeholt, wenn sie bei der nächsten Abfrage noch zu den neuesten gehören. Das Instagram-Zugangstoken wird weiter automatisch verlängert, damit die Verbindung nicht abläuft.",
    runsIn: "Discord-Bot (Verwaltung über die Weboberfläche)"
  }),
  // 9.5.0
  Object.freeze({
    id: "levelsystem",
    label: "Levelsystem / Ränge",
    description: "Discord-Minigame: XP für Nachrichten, Ränge als Rollen, tägliche Meldungen, Missionen, Topliste (Gruppe „Minigame“).",
    platform: "discord",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["discordLevelsystem", "discordLevelXpRules", "discordLevelPlayers", "discordLevelRanks", "discordLevelMissions", "discordLevelStatistics"]),
    apiPrefixes: Object.freeze(["/api/discord/levelsystem", "/api/discord/members/levels"]),
    offNote: "XP-Stände, Ränge, Verlauf und Einstellungen bleiben gespeichert, und niemand verliert seine Rang-Rolle. Solange das Modul aus ist, gibt es keine XP, keine Beförderungen, keine Aktualisierung der Topliste; die Slash-Commands (/rang, /dailyxp, /einsatz …) antworten „derzeit deaktiviert“. Aktivität aus dieser Zeit wird später nicht nachgetragen.",
    runsIn: "Discord-Bot (Verwaltung über die Weboberfläche)"
  }),
  // 9.6.0: Moderation, getrennt nach System. critical = verschärfte Warnung mit Eintippen des Namens.
  Object.freeze({
    id: "twitchChatFilter",
    label: "Twitch-Chat-Filter",
    description: "Automatische Filter im Twitch-Chat: Links, Emotes, Satzzeichen, Großbuchstaben (Moderation → Chat-Filter).",
    platform: "twitch",
    defaultEnabled: true,
    critical: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["moderation"]),
    offNote: "Achtung: Danach werden im Twitch-Chat keine Links, Emote-Spam, Satzzeichen- oder Großbuchstaben-Nachrichten mehr gefiltert. Der Twitch-Chat ist insoweit ungeschützt. Die Filtereinstellungen bleiben gespeichert, Event-Profile verändern die Chat-Filter dann nicht.",
    runsIn: "Twitch-Bot"
  }),
  Object.freeze({
    id: "wordFilter",
    label: "Wortfilter",
    description: "Zentrale Liste verbotener Begriffe für Twitch und Discord, je Plattform einzeln schaltbar (Moderation → Wortfilter, Legacy-Wortliste).",
    platform: "both",
    defaultEnabled: true,
    critical: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["wordFilter", "blocked"]),
    apiPrefixes: Object.freeze(["/api/word-filter"]),
    offNote: "Achtung: Danach werden verbotene Begriffe weder im Twitch-Chat noch auf Discord erkannt, gelöscht oder sanktioniert. Begriffe, Kategorien, Ausnahmen und Treffer bleiben gespeichert. Tipp: Für nur eine Plattform reicht der Schalter auf der Wortfilter-Seite bzw. im Event-Profil.",
    runsIn: "Twitch-Bot und Discord-Bot"
  }),
  Object.freeze({
    id: "discordModeration",
    label: "Discord-Moderation",
    description: "Automatische Moderation auf Discord: Spam-Schutz und Link-Filter (Moderation & Sicherheit → Moderation). Der Notfallmodus gehört nicht dazu und bleibt immer verfügbar.",
    platform: "discord",
    defaultEnabled: true,
    critical: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["discordModeration"]),
    // Kein Sperren von /api/discord/moderation: „Protokoll & Test“ liest dieselbe Schnittstelle.
    // Gesperrt wird nur das Speichern der Einstellungen (im Discord-Bot, /moderation/config).
    offNote: "Achtung: Danach greifen auf Discord weder Spam-Schutz noch Link-Filter. Der Server ist insoweit ungeschützt. Der Notfallmodus, Sanktionsübersicht, Userhistorie und Meldungen bleiben verfügbar; Einstellungen und Protokolle bleiben gespeichert.",
    runsIn: "Discord-Bot (Verwaltung über die Weboberfläche)"
  }),
  // 9.7.0 (zweite Welle)
  Object.freeze({
    id: "clips",
    label: "Clips",
    description: "Neue Twitch-Clips erkennen, im Twitch-Chat teilen und an Discord melden (Live-Zentrale → Clips).",
    platform: "twitch",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["clips"]),
    apiPrefixes: Object.freeze(["/api/clips"]),
    offNote: "Einstellungen und bereits gemeldete Clips bleiben gespeichert. Solange das Modul aus ist, werden keine Clips gesucht, geteilt oder an Discord gemeldet; Clips aus dieser Zeit werden nicht nachgeholt. Event-Profile verändern das Clip-Teilen dann nicht.",
    runsIn: "Twitch-Bot (Verwaltung über die Weboberfläche)"
  }),
  Object.freeze({
    id: "eventProfiles",
    label: "Event-Profile",
    description: "Vorlagen, die viele Funktionen auf einmal umschalten, z. B. für besondere Streams (Live-Zentrale → Event-Profile).",
    platform: "twitch",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["eventprofiles"]),
    apiPrefixes: Object.freeze(["/api/event-profiles"]),
    offNote: "Alle Profile bleiben gespeichert. Solange das Modul aus ist, kann kein Profil gewechselt werden; der zuletzt angewendete Zustand bleibt einfach stehen, und Änderungen an Commands, Timern usw. werden nicht in die Profile übernommen. Nach dem Wiedereinschalten gleicht sich das aktive Profil mit dem dann aktuellen Stand ab.",
    runsIn: "Weboberfläche"
  }),
  // 9.8.0
  Object.freeze({
    id: "discordAnnouncements",
    label: "Discord-Ankündigungen",
    description: "Live- und Clip-Meldungen von Twitch automatisch in Discord posten (Discord → Ankündigungen).",
    platform: "both",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["discordAnnouncements"]),
    apiPrefixes: Object.freeze(["/api/discord/announcements"]),
    offNote: "Einstellungen und Verlauf bleiben gespeichert. Solange das Modul aus ist, werden Stream-Starts und Clips nicht in Discord gemeldet; Meldungen aus dieser Zeit werden nicht nachgeholt.",
    runsIn: "Twitch-Bot und Discord-Bot"
  }),
  Object.freeze({
    id: "discordInvite",
    label: "Einladungslink",
    description: "Verwalteter Discord-Einladungslink für Twitch-Commands mit {discord_invite} (Discord → Einladungslink).",
    platform: "both",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["discordInvite"]),
    apiPrefixes: Object.freeze(["/api/discord/invite"]),
    offNote: "Die Einstellungen und der bestehende Einladungslink bleiben erhalten (der Link selbst bleibt bei Discord gültig). Solange das Modul aus ist, wird der Link nicht geprüft oder erneuert, und {discord_invite} in Twitch-Commands zeigt den festen Ersatztext statt des Links.",
    runsIn: "Discord-Bot (genutzt vom Twitch-Bot)"
  }),
  // 9.9.0
  Object.freeze({
    id: "discordReports",
    label: "Meldungen",
    description: "Meldesystem auf Discord: „Nachricht melden“, „User melden“, /melden und Melde-Knopf; Bearbeitung durch das Team (Moderation & Sicherheit → Meldungen).",
    platform: "discord",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["discordReports"]),
    apiPrefixes: Object.freeze(["/api/discord/reports"]),
    offNote: "Alle bisherigen Meldungen samt Anhängen und die Einstellungen bleiben gespeichert. Solange das Modul aus ist, können Mitglieder nichts melden – Befehle und Melde-Knopf antworten „derzeit deaktiviert“ – und offene Meldungen lassen sich im Control Center nicht bearbeiten.",
    runsIn: "Discord-Bot (Verwaltung über die Weboberfläche)"
  }),
  Object.freeze({
    id: "discordChannelTimes",
    label: "Kanalzeiten",
    description: "Discord-Kanäle nach Zeitplan öffnen und schließen, inklusive Wartungsmodus (Discord → Kanalzeiten).",
    platform: "discord",
    defaultEnabled: true,
    requires: Object.freeze([]),
    tabs: Object.freeze(["discordChannelTimes"]),
    apiPrefixes: Object.freeze(["/api/discord/channel-times"]),
    offNote: "Zeitpläne und Einstellungen bleiben gespeichert. Achtung: Die Kanäle bleiben genau in dem Zustand, in dem sie beim Ausschalten sind – offen bleibt offen, geschlossen bleibt geschlossen, auch ein laufender Wartungsmodus. Solange das Modul aus ist, öffnet oder schließt der Bot nichts mehr; Änderungen dann direkt in Discord vornehmen.",
    runsIn: "Discord-Bot (Verwaltung über die Weboberfläche)"
  })
]);

// Fabrik: baut die Funktionen für eine Modulliste. Der Standard unten nutzt MODULES; die Fabrik gibt es,
// damit Abhängigkeiten und Sonderfälle ohne echte Module testbar sind.
function createModuleRegistry(defs) {
  const list = Object.freeze(defs.slice());
  const byId = new Map(list.map(m => [m.id, m]));
  const legacyOf = (settings, m) => { try { return !!(m.legacyEnabled && m.legacyEnabled(settings)); } catch { return false; } };

  const listModules = () => list.slice();
  const getModule = id => byId.get(String(id)) || null;
  const isKnownModule = id => byId.has(String(id));

  // Ergänzt settings.modules um alle registrierten Module (boolesch) und entfernt unbekannte Schlüssel.
  // Fehlt ein Eintrag, gilt der Standard – außer ein Altbestand war bereits aktiv.
  function normalizeModuleSettings(settings) {
    if (!settings || typeof settings !== "object") return settings;
    const src = settings.modules && typeof settings.modules === "object" && !Array.isArray(settings.modules) ? settings.modules : {};
    const out = {};
    for (const m of list) out[m.id] = typeof src[m.id] === "boolean" ? src[m.id] : (m.defaultEnabled || legacyOf(settings, m));
    settings.modules = out;
    return settings;
  }

  // true nur, wenn das Modul registriert und eingeschaltet ist. Unbekannte Module gelten als aus.
  function isModuleEnabled(settings, id) {
    const m = getModule(id);
    if (!m) return false;
    const v = settings?.modules?.[m.id];
    return typeof v === "boolean" ? v : (m.defaultEnabled || legacyOf(settings, m));
  }

  // Setzt ein Modul ein/aus und prüft Abhängigkeiten. Gibt {ok, changed, error?} zurück; bei Fehler bleibt settings unverändert.
  function setModuleEnabled(settings, id, enabled) {
    const m = getModule(id);
    if (!m) return { ok: false, error: "Unbekanntes Modul." };
    if (typeof enabled !== "boolean") return { ok: false, error: "Ungültiger Wert." };
    normalizeModuleSettings(settings);
    if (enabled) {
      const missing = m.requires.filter(req => !settings.modules[req]);
      if (missing.length) return { ok: false, error: `Zuerst nötig: ${missing.map(req => getModule(req)?.label || req).join(", ")}.` };
    } else {
      const dependents = list.filter(o => o.requires.includes(m.id) && settings.modules[o.id]);
      if (dependents.length) return { ok: false, error: `Wird noch gebraucht von: ${dependents.map(o => o.label).join(", ")}.` };
    }
    const changed = settings.modules[m.id] !== enabled;
    settings.modules[m.id] = enabled;
    return { ok: true, changed };
  }

  // 9.2.0: Zu welchem Modul gehört eine Adresse? kind: "overlay" (OBS-Seite), "state" (öffentlicher Zustand),
  // "stream" (öffentlicher Ereignisstrom) oder "api" (Verwaltung). null = gehört zu keinem Modul.
  function routeModule(pathname) {
    const p = String(pathname || "");
    const under = prefix => p === prefix || p.startsWith(`${prefix}/`);
    for (const m of list) {
      if ((m.overlayPages || []).includes(p)) return { module: m.id, kind: "overlay" };
      if ((m.publicStates || []).includes(p)) return { module: m.id, kind: "state" };
      if ((m.publicStreams || []).includes(p)) return { module: m.id, kind: "stream" };
    }
    for (const m of list) if ((m.apiPaths || []).includes(p)) return { module: m.id, kind: "api" }; // 9.6.0: genaue Pfade
    for (const m of list) if ((m.apiPrefixes || []).some(under)) return { module: m.id, kind: "api" };
    return null;
  }

  // Öffentliche Beschreibung für die Oberfläche (ohne Funktionen).
  function describeModules(settings) {
    normalizeModuleSettings(settings);
    return list.map(m => ({
      id: m.id, label: m.label, description: m.description, platform: m.platform,
      enabled: settings.modules[m.id] === true, requires: m.requires.slice(), offNote: m.offNote, runsIn: m.runsIn || "", critical: m.critical === true
    }));
  }

  return { listModules, getModule, isKnownModule, normalizeModuleSettings, isModuleEnabled, setModuleEnabled, describeModules, routeModule };
}

const registry = createModuleRegistry(MODULES);

// 9.6.0: Wortfilter je Plattform (zweite Ebene unter dem Modul „Wortfilter“), schaltbar auf der Wortfilter-Seite
// und in Event-Profilen. Form: settings.wordFilterActive = { twitch:{enabled}, discord:{enabled} }, Standard an.
const WORD_FILTER_PLATFORMS = Object.freeze(["twitch", "discord"]);
function normalizeWordFilterActive(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const src = settings.wordFilterActive && typeof settings.wordFilterActive === "object" ? settings.wordFilterActive : {};
  const out = {};
  for (const p of WORD_FILTER_PLATFORMS) out[p] = { enabled: src[p]?.enabled !== false };
  settings.wordFilterActive = out;
  return settings;
}
// Wirkt der Wortfilter auf dieser Plattform? Modul an UND Plattform-Schalter an.
function wordFilterActiveFor(settings, platform) {
  if (!registry.isModuleEnabled(settings, "wordFilter")) return false;
  return settings?.wordFilterActive?.[platform]?.enabled !== false;
}

module.exports = { MODULES, createModuleRegistry, ...registry, WORD_FILTER_PLATFORMS, normalizeWordFilterActive, wordFilterActiveFor };
