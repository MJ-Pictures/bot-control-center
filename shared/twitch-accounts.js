"use strict";
// 8.9.20 · Entkopplung 3a: Stammdaten der Twitch-Konten (welche Konten es gibt, wofür, mit welchen
// Rechten). Das ist feste Konfiguration und kein Laufzeitzustand; Weboberfläche und Twitch-Bot lesen
// sie beide von hier. Token-Inhalte und Dateipfade stehen hier nicht: "tokenKey" nennt nur, unter
// welchem Schlüssel der Twitch-Bot die Token-Datei führt.
// 9.15.0: Die Konten kommen aus der Bot-Liste der Installation (shared/bot-roster.js, gespeichert in
// settings.installation.bots). Hier steht nur, welche Rechte der Haupt-Bot braucht.
const MAIN_BOT_SCOPES = ["user:read:chat","user:write:chat","user:bot","moderator:manage:chat_messages","moderator:manage:banned_users","moderator:manage:blocked_terms","moderator:read:followers","moderator:manage:automod","moderator:read:chatters"];
// 9.20.0: Mit dem Modul „Subathon“ braucht das Kanal-Konto zusätzlich Abo- und Bits-Rechte (nur dann, damit andere Installationen nicht neu verbinden müssen).
const SUBATHON_CHANNEL_SCOPES = ["channel:read:subscriptions","bits:read"];
// 9.27.2: Kanalpunkte-Karten im Chat-Overlay (Einlösungen lesen). Nur angefordert, wenn die Karte eingeschaltet ist.
const REDEMPTION_CHANNEL_SCOPES = ["channel:read:redemptions"];
// 9.28.0: Chat-Befehl „!clip“ erstellt den Clip über das Kanal-Konto (Recht clips:edit). Nur angefordert, wenn der Befehl eingeschaltet ist.
const CLIP_COMMAND_CHANNEL_SCOPES = require("./clip-command").CLIP_CHANNEL_SCOPES;
function twitchAccountDefs(channelLogin, roster, opts){
  const botRoster = require("./bot-roster");
  return botRoster.accountDefsFromRoster(roster || botRoster.freshRoster(), MAIN_BOT_SCOPES, channelLogin, [...(opts?.subathon === true ? SUBATHON_CHANNEL_SCOPES : []), ...(opts?.redemptions === true ? REDEMPTION_CHANNEL_SCOPES : []), ...(opts?.clipCommand === true ? CLIP_COMMAND_CHANNEL_SCOPES : [])]);
}
// Sicht für die Weboberfläche: ohne tokenKey.
function publicTwitchAccounts(channelLogin, roster, opts){
  return twitchAccountDefs(channelLogin, roster, opts).map(({tokenKey,...rest})=>({...rest,requiredScopes:[...rest.requiredScopes]}));
}
module.exports={twitchAccountDefs,publicTwitchAccounts,MAIN_BOT_SCOPES,SUBATHON_CHANNEL_SCOPES,REDEMPTION_CHANNEL_SCOPES,CLIP_COMMAND_CHANNEL_SCOPES};
