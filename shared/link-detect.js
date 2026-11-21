"use strict";
// Link-Erkennung für den Twitch-Linkfilter.
//
// Eindeutige Links (http://, https://, www.) werden immer erkannt. Ohne diese
// Anfänge ("beispiel.de") zählt ein Treffer nur, wenn die Endung eine echte
// Domain-Endung ist und nicht wie ein Satzanfang aussieht. Damit sind Texte wie
// "toll.Und", "1.Kompanie", "3.Zug" oder "z.B.das" keine Links mehr.

// Endungen, die im Chat praktisch nur als Domain vorkommen.
const STRONG_TLDS=new Set([
  "com","net","org","de","eu","info","biz","tv","gg","io","ch","ly","gl","xyz","app","dev",
  "link","live","online","site","shop","store","top","club","vip","cc","ws","fm","tk","ru",
  "cn","uk","fr","nl","pl","ca","au","jp","kr","br","gov","edu","mil","name","pro","cloud",
  "tech","space","website","click","icu","today","news","wiki","chat","social","stream","zone"
]);

// Endungen, die zugleich häufige Wörter sind (es, in, is, it, at, to, me, so …).
// Ohne Pfad ("/…") zählen sie nicht als Link, damit "danke.in" kein Treffer ist.
const WEAK_TLDS=new Set([
  "at","es","in","is","it","me","to","us","co","be","by","do","no","my","as","am","im","so","se","ai","ml","ga","cf"
]);

// Teile: Labels, Endung, optional Port, optional Pfad.
const BARE=/((?:[a-z0-9][a-z0-9-]*\.)+)([a-z]{2,24})(?![a-z0-9-])(?::\d{1,5})?(\/[^\s<]*)?/gi;
const EXPLICIT=/(?:https?:\/\/|www\.)[^\s<]+/gi;

function looksLikeSentenceStart(tld){
  // "Und", "Es", "Ist": Großbuchstabe vorn, Rest klein. Domains schreibt man
  // klein ("de") oder ganz groß ("DE"), nicht so.
  return /^[A-Z][a-z]+$/.test(tld);
}

function bareHostsFrom(text,skipRanges){
  const found=[];
  BARE.lastIndex=0;
  let m;
  while((m=BARE.exec(text))){
    const start=m.index,end=start+m[0].length;
    if(skipRanges.some(([a,b])=>start<b&&end>a))continue;
    const labels=m[1].slice(0,-1);
    const tld=m[2];
    const path=m[3]||"";
    if(!/[a-z]/i.test(labels))continue;           // "3.4.de" ohne Buchstaben im Namen
    const hasPath=path.length>1;
    // "toll.Und": nur ohne Pfad ein Satzanfang. "Bit.Ly/abc" bleibt ein Link.
    if(looksLikeSentenceStart(tld)&&!hasPath)continue;
    const lower=tld.toLowerCase();
    if(STRONG_TLDS.has(lower)){found.push(m[0]);continue;}
    if(WEAK_TLDS.has(lower)&&hasPath){found.push(m[0]);}
  }
  return found;
}

function extractUrls(text){
  const input=String(text||"");
  const explicit=[];
  const ranges=[];
  EXPLICIT.lastIndex=0;
  let m;
  while((m=EXPLICIT.exec(input))){explicit.push(m[0]);ranges.push([m.index,m.index+m[0].length]);}
  return explicit.concat(bareHostsFrom(input,ranges));
}

module.exports={extractUrls,STRONG_TLDS,WEAK_TLDS};
