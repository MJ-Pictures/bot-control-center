"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const app = fs.readFileSync(path.join(__dirname, "..", "public/app.js"), "utf8");
const css = fs.readdirSync(path.join(__dirname, "..", "public")).filter(f => f.endsWith(".css")).map(f => fs.readFileSync(path.join(__dirname, "..", "public", f), "utf8")).join("\n");

function load() {
  const m = app.match(/function capabilityModuleOff\(cap\)\{[\s\S]*?\n\}\nfunction permissionRowHidden\(row\)\{[^\n]*\n/);
  assert.ok(m, "Funktion fehlt");
  return new Function("NAV_GROUPS", "settings", "moduleEnabledUi", m[0] + ";return {capabilityModuleOff,permissionRowHidden};");
}
const NAV = {
  a: { items: [{ tab: "giveaway", capability: "twitch.giveaway.view", module: "giveaway" }, { tab: "x", capability: "twitch.commands.view" }] },
  b: { items: [{ tab: "d1", capability: "discord.moderation.view", module: "levelsystem" }, { tab: "d2", capability: "discord.moderation.view", module: "discordModeration" }] }
};
const mk = modules => { const settings = { modules }; return load()(NAV, settings, id => settings.modules[id] === true); };

test("Recht eines ausgeschalteten Moduls wird ausgeblendet", () => {
  const f = mk({ giveaway: false, levelsystem: true, discordModeration: true });
  assert.equal(f.capabilityModuleOff("twitch.giveaway.view"), true);
  assert.equal(f.permissionRowHidden({ view: "twitch.giveaway.view" }), true);
});
test("Eingeschaltetes Modul, Recht ohne Modul und unbekanntes Recht bleiben sichtbar", () => {
  const f = mk({ giveaway: true });
  assert.equal(f.capabilityModuleOff("twitch.giveaway.view"), false);
  assert.equal(f.capabilityModuleOff("twitch.commands.view"), false);
  assert.equal(f.capabilityModuleOff("twitch.nichtda.view"), false);
});
test("Geteiltes Recht nur ausgeblendet, wenn alle zugehörigen Module aus sind", () => {
  assert.equal(mk({ levelsystem: false, discordModeration: true }).capabilityModuleOff("discord.moderation.view"), false);
  assert.equal(mk({ levelsystem: false, discordModeration: false }).capabilityModuleOff("discord.moderation.view"), true);
});
test("Ohne geladene Modul-Einstellungen wird nichts ausgeblendet", () => {
  const f = load()(NAV, {}, () => false);
  assert.equal(f.capabilityModuleOff("twitch.giveaway.view"), false);
});
test("Ausgeblendete Zeilen bleiben im Dokument (Rechte bleiben beim Speichern erhalten) und haben CSS", () => {
  assert.match(app, /data-permission-key="\$\{esc\(x\.key\)\}" \$\{permissionRowHidden\(x\)\?"hidden":""\}/);
  assert.match(css, /\.permission-row\[hidden\]/);
  assert.match(app, /permission-hidden-note/);
});
