"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const src = fs.readFileSync("discord-app/discord-server.js", "utf8");
const ui = fs.readFileSync("public/app.js", "utf8");

test("Timeout für neue Mitglieder: Standard aus, Grenzen 0–1440", () => {
  assert.match(src, /newMemberTimeoutMinutes: 0,/);
  assert.match(src, /newMemberTimeoutMinutes: Math\.max\(0, Math\.min\(1440, Math\.trunc\(Number\(raw\.newMemberTimeoutMinutes\) \|\| 0\)\)\)/);
  assert.match(src, /ganze Zahl von 0 bis 1440 Minuten/);
});

test("Timeout wird VOR der Rollenvergabe gesetzt und blockiert die Freischaltung nicht", () => {
  const flow = src.slice(src.indexOf("const timeoutResult=await applyNewMemberTimeout"));
  assert.ok(flow.indexOf("applyNewMemberTimeout") < flow.indexOf("/roles/${onboardingConfig.unlockRoleId}"));
  const helper = src.slice(src.indexOf("async function applyNewMemberTimeout"), src.indexOf("function newMemberTimeoutNote"));
  assert.match(helper, /if\(!\(minutes>0\)\)return \{applied:false,minutes:0\}/);
  assert.match(helper, /communication_disabled_until/);
  assert.match(helper, /catch\(err\)\{[\s\S]*return \{applied:false,minutes,error:err\.message\}/);
  assert.match(helper, /existing>=until\)return \{applied:false,minutes,kept:true\}/); // vorhandenen längeren Timeout nicht verkürzen
});

test("Nur die erste Freischaltung bekommt den Timeout (wiederholte Reaktion nicht)", () => {
  const idx = src.indexOf("if(entry.verifiedAt){");
  assert.ok(idx > 0 && idx < src.indexOf("applyNewMemberTimeout(member,payload.user_id)"));
});

test("Botrecht „Mitglieder moderieren“ wird nur bei aktivem Timeout verlangt", () => {
  assert.match(src, /Number\(onboardingConfig\.newMemberTimeoutMinutes\) > 0 && !checks\.moderateMembers/);
});

test("Log-Eintrag nennt den Timeout, auch bei bereits gespeicherten Vorlagen", () => {
  assert.match(src, /\{append:newMemberTimeoutNote\(timeoutResult\)\}/);
  assert.match(src, /renderDiscordLogTemplate\(event\.template,payload\)\+\(options\.append\|\|""\)/);
});

test("Oberfläche: Feld und Übergabe beim Speichern", () => {
  assert.match(ui, /id="discordNewMemberTimeout"/);
  assert.match(ui, /newMemberTimeoutMinutes:Math\.max\(0,Math\.trunc/);
});
