const appSource=require("./helpers/app-source");
"use strict";
// Stellt sicher, dass keine API-Route in app/server.js von der Standard-Sperre
// ("API-Route ist nicht in der Autorisierungsmatrix freigegeben") blockiert wird.
// Anlass 8.9.5: /api/admin/performance fehlte in der Matrix, die Diagnose-Karte im
// Systemstatus blieb dadurch leer.
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const src=appSource();

function fn(name){
  const i=src.indexOf("function "+name+"(");
  assert.ok(i>=0,`Funktion ${name} nicht gefunden`);
  let d=0,k=src.indexOf("{",i);
  for(;k<src.length;k++){const c=src[k];if(c==="{")d++;else if(c==="}"){d--;if(d===0)break;}}
  return src.slice(i,k+1);
}
function cst(name){
  const i=src.indexOf("const "+name+"=");
  assert.ok(i>=0,`Konstante ${name} nicht gefunden`);
  return src.slice(i).match(/^[\s\S]*?\]\)?;/)[0];
}
const api=new Function([
  cst("PUBLIC_API_ROUTES"),cst("EXPLICIT_GUARD_API_PREFIXES"),
  fn("privilegedRouteRequirement"),fn("apiCapabilityFor"),fn("apiAnyCapabilitiesFor"),fn("apiRouteExplicitlyGuarded"),
  "return {privilegedRouteRequirement,apiCapabilityFor,apiAnyCapabilitiesFor,apiRouteExplicitlyGuarded};"
].join("\n"))();

const guarded=(p,m)=>!!(api.privilegedRouteRequirement(p,m)||api.apiCapabilityFor(p,m)||api.apiAnyCapabilitiesFor(p,m)||api.apiRouteExplicitlyGuarded(p));

test("Die Diagnose-Route ist eine reine Administrator-Route",()=>{
  assert.equal(api.privilegedRouteRequirement("/api/admin/performance","GET"),"admin");
  assert.equal(guarded("/api/admin/performance","GET"),true);
});

test("Keine API-Route im Server wird von der Standard-Sperre der Rechtematrix blockiert",()=>{
  const routes=new Map();
  for(const m of src.matchAll(/u\.pathname\s*===\s*"(\/api\/[^"]*)"(?:\s*&&\s*req\.method\s*===\s*"([A-Z]+)")?/g))routes.set(`${m[2]||"GET"} ${m[1]}`,[m[1],m[2]||"GET"]);
  for(const m of src.matchAll(/u\.pathname\.startsWith\("(\/api\/[^"]+)"\)/g))routes.set(`GET ${m[1]}*`,[m[1]+"x","GET"]);
  assert.ok(routes.size>100,`zu wenige Routen gefunden (${routes.size}); Muster prüfen`);
  const blocked=[...routes.entries()].filter(([,[p,m]])=>!guarded(p,m)).map(([k])=>k);
  assert.deepEqual(blocked,[],`Von der Default-Deny-Prüfung gesperrt: ${blocked.join(", ")}`);
});

test("Der Handler der Diagnose-Route prüft weiterhin selbst die Administrator-Berechtigung",()=>{
  const i=src.indexOf('u.pathname === "/api/admin/performance"');
  assert.ok(i>0);
  assert.match(src.slice(i,i+300),/requireGlobalAdmin\(req,res\)/);
});
