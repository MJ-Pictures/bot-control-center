const appSource=require("./helpers/app-source");
"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const path=require("path");
const csp=require("../shared/csp");
const root=path.join(__dirname,"..");
const read=f=>fs.readFileSync(path.join(root,f),"utf8");

test("N-4: Overlay-Seiten bekommen die strenge Policy ohne Inline-Skripte",()=>{
  for(const p of ["/followathon/overlay","/follower-alert/overlay"]){
    assert.equal(csp.kindForPath(p),"overlay");
    const h=csp.cspHeaders(p);
    assert.deepEqual(Object.keys(h),["Content-Security-Policy"]);
    assert.match(h["Content-Security-Policy"],/script-src 'self'(;|$)/);
    assert.doesNotMatch(h["Content-Security-Policy"],/script-src[^;]*unsafe-inline/);
    assert.match(h["Content-Security-Policy"],/default-src 'none'/);
    assert.match(h["Content-Security-Policy"],/connect-src 'self'(;|$)/);
    assert.doesNotMatch(h["Content-Security-Policy"],/https:|wss:/);
  }
});
test("N-4: Hauptoberfläche erzwingt seit 8.6.9 die strenge Policy ohne Inline-Skripte",()=>{
  const h=csp.cspHeaders("/");
  assert.deepEqual(Object.keys(h),["Content-Security-Policy"],"kein Report-Only-Header mehr");
  const p=h["Content-Security-Policy"];
  assert.equal(p,csp.APP_ENFORCED);
  assert.match(p,/script-src 'self';/);
  assert.doesNotMatch(p,/script-src[^;]*unsafe-inline/);
  assert.match(p,/script-src-attr 'none'/);
  assert.match(p,/connect-src 'self';/);
  assert.match(p,/report-uri \/csp-report/);
  assert.doesNotMatch(p,/unsafe-eval/);
  assert.equal(csp.kindForPath("/api/status"),"app");
});
test("N-4: Overlay-Seiten enthalten keine Inline-Skripte und keine Inline-Handler",()=>{
  for(const f of ["public/followathon-overlay.html","public/follower-alert-overlay.html"]){
    const html=read(f);
    const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length>=1,f);
    for(const s of scripts){assert.match(s[1],/\bsrc="\/[a-z-]+\.js"/,`${f}: Skript muss extern sein`);assert.equal(s[2].trim(),"",`${f}: kein Inline-Code`);}
    assert.equal(/\son[a-z]+\s*=/i.test(html),false,`${f}: keine Inline-Handler`);
    assert.equal(/javascript:/i.test(html),false);
  }
  for(const f of ["public/followathon-overlay.js","public/follower-alert-overlay.js"]){
    assert.ok(read(f).length>500,f);
    new Function(read(f)); // Syntax
  }
});
test("N-4: Overlay-Skripte sprechen nur mit dem eigenen Server",()=>{
  for(const f of ["public/followathon-overlay.js","public/follower-alert-overlay.js"]){
    const js=read(f);
    assert.equal(/https?:\/\//.test(js),false,`${f}: keine fremden URLs`);
    assert.equal(/\beval\s*\(|new Function\s*\(|WebSocket\s*\(/.test(js),false);
  }
});
test("N-4: Meldungen werden normalisiert, gezählt und je Signatur nur einmal geloggt",()=>{
  const logs=[];
  const c=csp.createCspReportCollector({log:m=>logs.push(m)});
  const body={"csp-report":{"document-uri":"https://bot.example/index.html?token=geheim","effective-directive":"script-src-attr","blocked-uri":"inline"}};
  for(let i=0;i<5;i++)c.record(JSON.stringify(body));
  c.record(JSON.stringify([{type:"csp-violation",body:{documentURL:"https://bot.example/index.html",effectiveDirective:"connect-src",blockedURL:"https://evil.example/x?y=1"}}]));
  const s=c.summary();
  assert.equal(s.total,6);
  assert.equal(s.signatures.length,2);
  assert.equal(s.signatures[0].count,5);
  assert.equal(logs.length,2);
  assert.equal(JSON.stringify(s).includes("geheim"),false,"Query-Strings werden nicht gespeichert");
  assert.equal(JSON.stringify(s).includes("y=1"),false);
});
test("N-4: Meldeendpunkt ist begrenzt (Signaturen, Rate, Müll)",()=>{
  const c=csp.createCspReportCollector({maxKeys:3,maxPerWindow:5});
  for(let i=0;i<10;i++)c.record({"csp-report":{"effective-directive":"img-src","blocked-uri":`https://h${i}.example/a`,"document-uri":"https://x/"}});
  assert.equal(c.summary().signatures.length,3);
  assert.equal(c.summary().dropped,7);
  assert.equal(c.record("kein json"),0);
  assert.equal(c.record(null),0);
  let ok=0;for(let i=0;i<8;i++)if(c.allow("1.2.3.4",1000))ok++;
  assert.equal(ok,5);
  assert.equal(c.allow("5.6.7.8",1000),true);
  assert.equal(c.allow("1.2.3.4",1000+61000),true);
});
test("N-4: server.js bindet Policies und Meldeendpunkt ein",()=>{
  const s=appSource();
  // Seit 8.9.0 mit zweitem Argument (öffentliche Adresse für den WebSocket des Stubenkontrolle-Overlays).
  assert.match(s,/\.\.\.csp\.cspHeaders\(pathname(,\{publicBaseUrl:publicBaseUrl\(\)\})?\)/); // 9.11.0: Adresse aus Umgebung oder Profil
  assert.match(s,/u\.pathname === csp\.REPORT_PATH && req\.method === "POST"/);
  assert.match(s,/cspReports\.allow\(clientIp\(req\)\)/);
  assert.match(s,/total>8192/);
  assert.match(s,/cspViolations:cspReports\.summary\(\)/);
  assert.equal(/Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'/.test(s.slice(s.indexOf("function securityHeaders"),s.indexOf("function securityHeaders")+900)),false,"keine doppelte Alt-Policy in securityHeaders");
});
