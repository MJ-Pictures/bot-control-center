"use strict";
// 8.9.7: Der Lösch-Dialog ("Löschen bestätigen" / roter LÖSCHEN-Knopf) wurde auch für Aktionen wie
// Aktivieren, Beenden oder Veröffentlichen benutzt. Diese Tests stellen sicher, dass er nur noch
// bei echten Löschungen erscheint und alle anderen Bestätigungen passende Titel und Knöpfe haben.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const src=fs.readFileSync(path.join(__dirname,"..","public","app.js"),"utf8");

function fn(name){
  const i=src.indexOf("function "+name+"(");
  assert.ok(i>=0,`Funktion ${name} nicht gefunden`);
  let d=0,k=src.indexOf("){",i)+1; // Rumpf beginnt nach der Parameterliste (askConfirm hat Parameter in {})
  for(;k<src.length;k++){const c=src[k];if(c==="{")d++;else if(c==="}"){d--;if(d===0)break;}}
  return src.slice(i,k+1);
}
function presetsSource(){
  const i=src.indexOf("const CONFIRM_PRESETS=");
  assert.ok(i>=0,"CONFIRM_PRESETS nicht gefunden");
  return src.slice(i,src.indexOf("\n};",i)+3);
}

// Attrappe der Oberfläche
function makeDialog(){
  const els={};
  const el=()=>({textContent:"",_hidden:true,classes:new Set(),focused:false,
    classList:{add(c){this._s.add(c)},remove(c){this._s.delete(c)},toggle(c,on){on?this._s.add(c):this._s.delete(c)},_s:null},focus(){this.focused=true;}});
  for(const id of ["confirmModal","confirmYes","confirmNo","confirmTitle","confirmText"]){const e=el();e.classList._s=new Set(["hidden"]);e.classList.add=function(c){this._s.add(c);};els[id]=e;}
  const code=`let confirmResolver=null;\n${presetsSource()}\n${fn("askConfirm")}\n${fn("askAs")}\n${fn("askDelete")}\nreturn {askAs,askDelete};`;
  const api=new Function("$",code)(id=>els[id]);
  return {els,...api};
}

test("Löschen-Dialog bleibt für echte Löschungen unverändert",()=>{
  const d=makeDialog();
  d.askDelete("Eintrag wirklich löschen?");
  assert.equal(d.els.confirmTitle.textContent,"Löschen bestätigen");
  assert.equal(d.els.confirmYes.textContent,"LÖSCHEN");
  assert.equal(d.els.confirmYes.classList._s.has("danger-strong"),true);
});

test("Aktivieren zeigt weder 'Löschen bestätigen' noch einen LÖSCHEN-Knopf und ist nicht rot",()=>{
  const d=makeDialog();
  d.askAs("activate","Profil „X“ jetzt aktivieren?");
  assert.equal(d.els.confirmTitle.textContent,"Profil aktivieren");
  assert.equal(d.els.confirmYes.textContent,"AKTIVIEREN");
  assert.equal(d.els.confirmYes.classList._s.has("danger-strong"),false);
  assert.equal(d.els.confirmText.textContent,"Profil „X“ jetzt aktivieren?");
});

test("Jede Voreinstellung hat eigenen Titel und Knopf, nie 'Löschen'",()=>{
  const presets=new Function(presetsSource()+"\nreturn CONFIRM_PRESETS;")();
  assert.ok(Object.keys(presets).length>=13);
  for(const [kind,p] of Object.entries(presets)){
    assert.ok(p.title&&p.confirmLabel,`${kind}: Titel oder Knopf fehlt`);
    assert.doesNotMatch(p.title+" "+p.confirmLabel,/lösch/i,`${kind} darf kein Löschen anzeigen`);
    assert.equal(typeof p.danger,"boolean",kind);
  }
  assert.equal(presets.end.danger,true);
  assert.equal(presets.refund.danger,false);
});

test("askDelete wird nur noch bei Löschen oder Entfernen verwendet",()=>{
  const calls=[...src.matchAll(/askDelete\(/g)].map(m=>m.index).filter(i=>!src.slice(Math.max(0,i-9),i).includes("function "));
  assert.ok(calls.length>=10,`zu wenige Aufrufe gefunden (${calls.length})`);
  const bad=[];
  for(const i of calls){
    const text=src.slice(i,i+230);
    if(!/lösch|entfern/i.test(text))bad.push(text.slice(0,110));
  }
  assert.deepEqual(bad,[],"askDelete bei Aktionen, die kein Löschen sind: "+bad.join(" | "));
});

test("Alle askAs-Aufrufe nutzen eine vorhandene Voreinstellung",()=>{
  const presets=new Function(presetsSource()+"\nreturn CONFIRM_PRESETS;")();
  const kinds=[...src.matchAll(/askAs\("([a-zA-Z]+)",/g)].map(m=>m[1]);
  assert.ok(kinds.length>=20,`erwartet mindestens 20 Aufrufe, gefunden ${kinds.length}`);
  for(const k of kinds)assert.ok(presets[k],`unbekannte Voreinstellung: ${k}`);
});

test("Event-Profile: Aktivieren erklärt, was passiert, und die Bedienhinweise passen zu den Knöpfen",()=>{
  assert.match(src,/askAs\("activate",`Profil „\$\{profile\.name\}“ jetzt aktivieren\?/);
  assert.match(src,/legt kein neues Profil an|Aktivieren legt kein neues Profil an/);
  assert.match(src,/\+ Neues Profil/);
  assert.doesNotMatch(src,/>\+ Profil</,"alter Knopfname noch vorhanden");
  assert.doesNotMatch(src,/„Aktuellen Stand übernehmen“/,"Hilfetext nennt einen Knopf, den es nicht gibt");
});
