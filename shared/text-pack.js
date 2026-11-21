"use strict";
// 9.13.0 · Textpaket: Standardtexte und -inhalte (neutral). Eine Bestandsinstallation (Profil.textPack = "legacy-bwk",
// nur durch die Übernahme gesetzt, nicht wählbar) bekommt statt dessen ihre bisherigen Texte aus legacy-bwk-migration.js.
// Im Code außerhalb dieser beiden Dateien stehen keine marken- oder dienstbezogenen Standardtexte.

// 9.15.0: Bot-Felder der neutralen Standardwerte sind leer = Haupt-Bot der Installation (die Bot-Liste steht im Profil).
const NEUTRAL_DEFAULT_SETTINGS = {
  commands: [],
  timers: [],
  greetings: [],
  events: {
    follow: {
      enabled: true,
      bot: "",
      text: "Willkommen im Chat, {user}! 👋",
      messages: [
        "Willkommen im Chat, {user}! 👋",
        "Schön, dass du jetzt dabei bist, {user}! Willkommen im Chat. 🎉",
        "Neuer Follow gesichtet: {user} ist jetzt mit an Bord. 👋"
      ]
    },
        raid: { enabled: true, bot: "", text: "Willkommen an den Raid von {user} mit {viewers} Zuschauenden! 👋" }
  },
  communityCommands: {
    followage: {
      enabled: true,
      bot: "",
      cooldownSeconds: 30,
      text: "{user} folgt dem Kanal seit {date} – also seit {followage}. 🎉",
      notFollowingText: "{user} folgt dem Kanal aktuell nicht."
    },
    watchtime: {
      enabled: true,
      bot: "",
      cooldownSeconds: 30,
      text: "{user}, deine erfasste Watchtime beträgt {watchtime}.",
      noDataText: "{user}, für dich wurde bisher noch keine Watchtime erfasst."
    }
  },
  blockedWords: [],
  autoReplies: [],
  team: {
    bot: "",
    teamCommandText: "Hinter jedem guten Stream steckt ein Team. Lerne es kennen: {commands}",
    timer: {
      enabled: true,
      everyMinutes: 30,
      minLines: 15,
      text: "👀 Wer steckt eigentlich hinter diesem Kanal? Mit !team lernst du das Team kennen!"
    },
    members: []
  },
  clipSharing: {
    enabled: false,
    intervalSeconds: 20,
    onlyLive: true,
    showCreator: true,
    message: "🎬 Neuer Clip: „{title}“ – erstellt von @{creator} {url}"
  },
  moderation: {
    global: {
      whitelistUsers: [],
      exemptModerators: true,
      exemptBroadcaster: true
    },
    links: {
      enabled: false,
      whitelistDomains: [],
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Freut uns, dass du etwas mit uns teilen möchtest, aber Links sind hier nicht erlaubt."
    },
    emotes: {
      enabled: false,
      limit: 5,
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Bitte nicht so viele Emotes auf einmal. 🙂"
    },
    symbols: {
      enabled: false,
      limit: 8,
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Bitte nicht so viele Satzzeichen hintereinander. 🙂"
    },
    caps: {
      enabled: false,
      limit: 12,
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Bitte schreib nicht alles in Großbuchstaben. 🙂"
    }
  },
  ui: { title: "Bot Control Center" }
}

const NEUTRAL_CLEAN_SETTINGS = {
  commands: [],
  timers: [],
  greetings: [],
  events: {
    follow: {
      enabled: false,
      bot: "",
      text: "Willkommen im Chat, {user}! 👋",
      messages: ["Willkommen im Chat, {user}! 👋"]
    },
    raid: {
      enabled: false,
      bot: "",
      text: "Willkommen an den Raid von {user} mit {viewers} Zuschauenden! 👋"
    }
  },
  communityCommands: {
    followage: {
      enabled: true,
      bot: "",
      cooldownSeconds: 30,
      text: "{user} folgt dem Kanal seit {date} – also seit {followage}. 🎉",
      notFollowingText: "{user} folgt dem Kanal aktuell nicht."
    },
    watchtime: {
      enabled: true,
      bot: "",
      cooldownSeconds: 30,
      text: "{user}, deine erfasste Watchtime beträgt {watchtime}.",
      noDataText: "{user}, für dich wurde bisher noch keine Watchtime erfasst."
    }
  },
  blockedWords: [],
  autoReplies: [],
  team: {
    bot: "",
    teamCommandText: "Hinter jedem guten Stream steckt ein Team. Lerne es kennen: {commands}",
    timer: {
      enabled: true,
      everyMinutes: 30,
      minLines: 15,
      text: "👀 Wer steckt eigentlich hinter diesem Kanal? Mit !team lernst du das Team kennen!"
    },
    members: []
  },
  clipSharing: {
    enabled: false,
    intervalSeconds: 20,
    onlyLive: true,
    showCreator: true,
    message: "🎬 Neuer Clip: „{title}“ – erstellt von @{creator} {url}"
  },
  moderation: {
    global: {
      whitelistUsers: [],
      exemptModerators: true,
      exemptBroadcaster: true
    },
    links: {
      enabled: false,
      whitelistDomains: [],
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Freut uns, dass du etwas mit uns teilen möchtest, aber Links sind hier nicht erlaubt."
    },
    emotes: {
      enabled: false,
      limit: 5,
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Bitte nicht so viele Emotes auf einmal. 🙂"
    },
    symbols: {
      enabled: false,
      limit: 8,
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Bitte nicht so viele Satzzeichen hintereinander. 🙂"
    },
    caps: {
      enabled: false,
      limit: 12,
      reactionBot: "",
      timeoutEnabled: true,
      timeoutSeconds: 600,
      warningSeconds: 5,
      timeoutMessageEnabled: true,
      timeoutMessage: "Bitte schreib nicht alles in Großbuchstaben. 🙂"
    }
  },
  ui: { title: "Bot Control Center" } // 9.11.0: ungenutzt; der Name kommt aus dem Installationsprofil
}

// Spiel-Phrasen des Punktespiels (Platzhalter: {GAME} {game} {points} {startCommand} {user} {bet} {seconds} {count} {factor} {added} {winners} {caught}).
const NEUTRAL_GAME_PHRASES = {
  roundOpened: [
    "🎲 {GAME}! @{user} eröffnet eine Runde. Einsatz: {bet} {points}. Mit {startCommand} BETRAG könnt ihr {seconds}s lang mitmachen.",
    "🚨 @{user} startet eine neue Runde – {seconds}s Anmeldung mit {startCommand} BETRAG!"
  ],
  joinedBatch: [
    "➕ +{added} machen mit · jetzt {count} dabei · Faktor aktuell x{factor}."
  ],
  joined: [
    "✅ @{user} ist dabei: {bet} {points} reserviert. {count} Teilnehmende · aktueller Faktor x{factor}.",
    "🎟️ @{user} macht mit. Einsatz {bet} · Faktor aktuell x{factor}."
  ],
  control: [
    "👀 Anmeldung beendet: {count} Teilnehmende, Faktor x{factor}. Die Auswertung läuft …",
    "🚪 Die Anmeldung ist geschlossen! {count} Teilnehmende. Der endgültige Faktor ist x{factor}."
  ],
  allPass: [
    "✨ Wunder geschehen: ALLE bestehen bei {game}.",
    "🎉 Alle Teilnehmenden kommen durch!"
  ],
  allCaught: [
    "💀 Katastrophe. ALLE scheitern. Die {points} bleiben beim Spiel.",
    "🚨 Komplettausfall! Niemand besteht."
  ],
  individual: [
    "🔍 Heute wird jede Teilnahme einzeln bewertet.",
    "🎯 Einzelbewertung! Bei manchen klappt es, bei anderen nicht."
  ],
  result: [
    "🏁 Runde beendet. Gewinner: {winners}. Erwischte: {caught}.",
    "📋 {game}: bestanden {winners} · erwischt {caught}."
  ]
};

const NEUTRAL = Object.freeze({
  name: "neutral",
  defaultSettings: NEUTRAL_DEFAULT_SETTINGS,
  cleanSettings: NEUTRAL_CLEAN_SETTINGS,
  gamePhrases: NEUTRAL_GAME_PHRASES,
  // 9.18.0: Überschriften im Spiel-Overlay (je Installation einstellbar; hier die Vorgabe).
  // 9.18.0: Kurzbezeichnungen der drei Discord-Rollenfunktionen und weitere Oberflächen-Begriffe
  roleLabels: { member: "Member", moderator: "Moderator", administrator: "Administrator", memberPlural: "Mitglieder" },
  roleTitles: { member: "Member", moderator: "Moderator", administrator: "Administrator" },
  roleLabelsServer: { member: "Member", moderator: "Moderator", administrator: "Administrator", memberPlural: "Mitglieder" },
  testName: "TestUser",
  teamRankLabel: "Rang",
  level: {
    branches: false, missionCmd: "mission",
    rank: "Rang", nextRank: "Nächster Rang", maxRank: "Höchsten Rang erreicht", noRank: "Ohne Rang",
    promotion: "Aufstieg!", promoted: "wurde zu **{rank}** befördert.",
    dailyTitle: "Tägliche Meldung", dailyDone: "Du hast dich heute bereits gemeldet. Wieder ab 00:00 Uhr.", dailyFail: "Meldung fehlgeschlagen",
    missionStart: "Danach mit /mission abholen abschließen.", missionBusy: "Du bist bereits auf einer Mission. Nutze /mission status.", missionNone: "Deine Missionen für heute sind aufgebraucht.",
    missionStatsTitle: "Deine Missionsstatistik", missionDone: "Abgeschlossene Missionen",
    missionOk: "✅ Mission erfolgreich", missionBad: "⚠️ Mission nicht erfolgreich", missionMissing: "Keine aktive Mission.", missionRunning: "Mission läuft noch bis",
    missionReady: "✅ Mission abgeschlossen – Belohnung mit /mission abholen einlösen.", missionWait: "⏳ Mission läuft.", missionIdle: "Keine aktive Mission · heutige Starts", missionHint: "Nutze /mission starten.",
    missionFail: "Mission fehlgeschlagen", missionDesc: "Missionen verwalten", missionStartDesc: "Neue Mission starten", missionStatusDesc: "Laufende Mission prüfen", missionStatsDesc: "Deine abgeschlossenen Missionen und Erfolgsquote", missionClaimDesc: "Abgeschlossene Mission abholen",
    dailyDesc: "Tägliche Meldung: einmal täglich zufällige XP",
    rankPlural: "Ränge", rankNameWord: "Rangbezeichnungen", missionSingular: "Mission", missionPlural: "Missionen", missionTitle: "Missionen & Übungen", dailyNoun: "Meldung", dailyPlural: "Meldungen", missionRecord: "Missionsakte", branchLabel: "Zweig", promotionsPlural: "Aufstiege"
  },
  gameOverlayTitles: { registration: "ANMELDUNG ZUM SPIEL", control: "KONTROLLE LÄUFT!", result: "ERGEBNIS DER RUNDE" },
  gameLines: { cooldown: "⏳ Nächste Runde {game} in {minutes} Min. Bitte noch einen Moment Geduld.", closed: "🚪 Anmeldung ist bereits geschlossen. Die Auswertung läuft schon." },
  // Mitglieder-Vorstellung (!mitgliedname): Vorsatz und Nachsatz
  teamMemberPrefix: "👤",
  teamMemberSuffix: "",
  teamMemberSince: "Seit {since} dabei",
  // Linkfilter
  linkDomains: [],
  linkLinks: [],
  // Discord
  discord: {
    rulesText: "**Serverregeln**\n\nBitte lies die Regeln vollständig. Mit deiner 👍-Reaktion auf genau diese Nachricht bestätigst du, dass du sie gelesen hast und akzeptierst. Anschließend erhältst du automatisch die Freischaltrolle.",
    welcomeMessage: "👋 Willkommen {mention}! Bevor du loslegst, lies bitte unsere Regeln in {rules} und bestätige dort die zentrale Regelnachricht mit 👍. Erst danach wirst du freigeschaltet.",
    lockMessage: "🛠️ **WARTUNG** · Der Server ist vorübergehend gesperrt. Die Freigabe erfolgt nach Abschluss der Arbeiten.",
    unlockMessage: "✅ **FREIGABE ERTEILT** · Die Wartung ist abgeschlossen. Der Server ist wieder geöffnet. 👋",
    accessGrantedMessage: "👋 **Zugang zum Server**",
    inviteTeaser: "👋 Es gibt bald einen Discord-Server … 👀 Sobald er freigegeben ist, erfährst du es hier. Bis dahin: Sammelpunkt Twitch-Chat! 💬",
    inviteLive: "👋 Der Discord-Server ist freigegeben! Hier geht's rein: {discord_invite}",
    levelRulesIntro: "🏆 Community-Minigame\nSammle XP und steige spielerisch im Rang auf.",
    levelRulesOutro: "Kein Spam oder Farming. Alle Ränge sind ausschließlich Community-Spielränge.",
    userAgent: "BotControlCenterDiscordBot/1.0",
    socialFooterBrand: ""
  },
  // Testmeldungen
  test: { channelName: "Testkanal", channelLogin: "testkanal" }
});

const PACKS = { neutral: NEUTRAL };

// Name des Textpakets aus Profil oder Einstellungen ({installation:{textPack}} bzw. das Profil selbst).
function packNameOf(source) {
  const v = source?.installation?.textPack ?? source?.textPack;
  return v === "legacy-bwk" ? "legacy-bwk" : "neutral";
}

function get(source) {
  const name = typeof source === "string" ? (source === "legacy-bwk" ? "legacy-bwk" : "neutral") : packNameOf(source);
  if (name === "legacy-bwk") {
    if (!PACKS["legacy-bwk"]) PACKS["legacy-bwk"] = require("./legacy-bwk-migration").legacyTextPack();
    return PACKS["legacy-bwk"];
  }
  return NEUTRAL;
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }

module.exports = { NEUTRAL, get, packNameOf, clone };
