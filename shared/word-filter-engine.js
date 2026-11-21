"use strict";

const vm=require("vm");

const REGEX_MAX_LENGTH=260;
const REGEX_MAX_UNBOUNDED=4;
const REGEX_MAX_REPEAT=100;
const REGEX_TEST_TIMEOUT_MS=50;
const REGEX_INPUT_MAX=2000;

const LEET_MAP={"0":"o","1":"i","3":"e","4":"a","5":"s","7":"t","@":"a","$":"s"};

function fold(value,{leet=false,repeat=false,separators=false,umlauts=true}={}){
  let s=String(value||"").normalize("NFKC").toLocaleLowerCase("de-DE");
  if(umlauts)s=s.replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss");
  if(leet){s=s.replace(/[013457@$]/g,ch=>LEET_MAP[ch]||ch);s=s.replace(/([\p{L}\p{N}])!([\p{L}\p{N}])/gu,"$1i$2");}
  if(separators)s=s.replace(/[\p{P}\p{S}\s]+/gu,"");
  if(repeat)s=s.replace(/([\p{L}\p{N}])\1+/gu,"$1");
  return s.trim();
}
function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
// Statische Prüfung (M-3): lehnt Muster ab, die zu katastrophalem Backtracking neigen.
// Abgelehnt werden wiederholte Gruppen, die selbst Quantifizierer oder Alternativen
// enthalten (z. B. (a+)+, (a|a)+, (\\w+\\s?)*), zu viele unbegrenzte Quantifizierer
// und sehr große Wiederholungszahlen. Zusätzlich schützt testRegexGuarded() zur Laufzeit.
function analyzeRegex(p){
  const stack=[{quant:false,alt:false}];
  let unbounded=0,i=0;
  const n=p.length;
  const readQuantifier=(pos)=>{
    const ch=p[pos];
    if(ch==="*"||ch==="+")return {len:1,repeats:true,unbounded:true};
    if(ch==="?")return {len:1,repeats:false,unbounded:false};
    if(ch==="{"){
      const m=/^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(pos,pos+24));
      if(!m)return null;
      const min=Number(m[1]),hasComma=!!m[2],maxRaw=m[3];
      const max=hasComma?(maxRaw===""?Infinity:Number(maxRaw)):min;
      if(max>REGEX_MAX_REPEAT&&max!==Infinity)return {len:m[0].length,tooBig:true};
      return {len:m[0].length,repeats:max>1,unbounded:max===Infinity};
    }
    return null;
  };
  let lastWasGroup=null;
  while(i<n){
    const ch=p[i];
    if(ch==="\\"){i+=2;lastWasGroup=null;continue;}
    if(ch==="["){
      i++;if(p[i]==="^")i++;if(p[i]==="]")i++;
      while(i<n&&p[i]!=="]"){if(p[i]==="\\")i++;i++;}
      i++;lastWasGroup=null;continue;
    }
    if(ch==="("){
      stack.push({quant:false,alt:false});
      i++;
      if(p[i]==="?"){
        // (?: (?= (?! (?<name> – nur die Präfixe überspringen, der Inhalt wird normal geprüft
        if(p[i+1]===":"||p[i+1]==="="||p[i+1]==="!")i+=2;
        else if(p[i+1]==="<"){const close=p.indexOf(">",i);i=close<0?n:close+1;}
      }
      lastWasGroup=null;continue;
    }
    if(ch===")"){
      if(stack.length<2)return {ok:false,error:"Regex enthält eine schließende Klammer ohne öffnende."};
      const g=stack.pop();
      const parent=stack[stack.length-1];
      const q=readQuantifier(i+1);
      if(q&&q.tooBig)return {ok:false,error:`Wiederholungszahlen über ${REGEX_MAX_REPEAT} sind nicht erlaubt.`};
      if(q){
        if(q.repeats&&(g.quant||g.alt))return {ok:false,error:"Wiederholte Gruppen mit Quantifizierern oder Alternativen sind nicht erlaubt."};
        if(q.unbounded)unbounded++;
        parent.quant=true;
        i+=1+q.len;
        if(p[i]==="?"||p[i]==="+")i++;
      }else i++;
      if(g.quant)parent.quant=true;
      if(g.alt)parent.alt=true;
      lastWasGroup=null;continue;
    }
    if(ch==="|"){stack[stack.length-1].alt=true;i++;lastWasGroup=null;continue;}
    const q=readQuantifier(i);
    if(q&&(ch==="*"||ch==="+"||ch==="?"||ch==="{")){
      if(q.tooBig)return {ok:false,error:`Wiederholungszahlen über ${REGEX_MAX_REPEAT} sind nicht erlaubt.`};
      if(q.unbounded)unbounded++;
      stack[stack.length-1].quant=true;
      i+=q.len;
      if(p[i]==="?"||p[i]==="+")i++;
      continue;
    }
    i++;lastWasGroup=null;
  }
  if(stack.length!==1)return {ok:false,error:"Regex enthält eine öffnende Klammer ohne schließende."};
  if(unbounded>REGEX_MAX_UNBOUNDED)return {ok:false,error:`Zu viele unbegrenzte Quantifizierer (höchstens ${REGEX_MAX_UNBOUNDED}).`};
  return {ok:true};
}
function safeRegex(pattern){
  const p=String(pattern||"");
  if(!p||p.length>REGEX_MAX_LENGTH)return {ok:false,error:`Regex muss 1–${REGEX_MAX_LENGTH} Zeichen lang sein.`};
  if(/\\[1-9]/.test(p)||/\(\?<([=!])/.test(p))return {ok:false,error:"Backreferences und Lookbehind sind nicht erlaubt."};
  const analysis=analyzeRegex(p);
  if(!analysis.ok)return analysis;
  try{new RegExp(p,"iu");return {ok:true};}catch(e){return {ok:false,error:e.message};}
}
// Laufzeitschutz (M-3): Regex-Treffer laufen mit hartem Zeitlimit; Eingaben werden gekürzt.
const guardContext=vm.createContext({rx:null,text:""});
const guardScript=new vm.Script("rx.lastIndex=0;rx.test(text)");
function testRegexGuarded(regex,text){
  guardContext.rx=regex;
  guardContext.text=String(text||"").slice(0,REGEX_INPUT_MAX);
  try{return guardScript.runInContext(guardContext,{timeout:REGEX_TEST_TIMEOUT_MS})===true;}
  finally{guardContext.rx=null;guardContext.text="";}
}
function buildRegex(term,type,opts={}){
  const raw=String(term||"").trim();
  if(type==="regex"){
    const check=safeRegex(raw);if(!check.ok)return {error:check.error};
    return {regex:new RegExp(raw,"iu")};
  }
  const normalized=fold(raw,opts);
  let core=escapeRegex(normalized);
  if(type==="whole_word")core=`(^|[^\\p{L}\\p{N}_])${core}(?=$|[^\\p{L}\\p{N}_])`;
  return {normalized,regex:new RegExp(core,"iu")};
}
function compile(snapshot={}){
  const allow=(snapshot.allowlist||[]).filter(x=>x.enabled!==false).map(x=>({platform:x.platform||"both",type:x.match_type||"phrase",value:String(x.value||"")}));
  const terms=[];
  const simpleWhole={twitch:new Map(),discord:new Map()};
  for(const row of snapshot.terms||[]){
    if(row.enabled===false)continue;
    const opts={leet:!!row.leetspeak,repeat:!!row.repeat_letters,separators:!!row.flex_separators,umlauts:row.umlauts!==false};
    const built=buildRegex(row.term,row.detection_type||"whole_word",opts);
    if(built.error){console.warn(`⚠️ Wortfilter: Begriff "${String(row.term||"").slice(0,80)}" wird übersprungen: ${built.error}`);continue;}
    const compiledRow={...row,_regex:built.regex,_opts:opts};
    terms.push(compiledRow);
    if((row.detection_type||"whole_word")==="whole_word"&&!opts.leet&&!opts.repeat&&!opts.separators&&!/\s/u.test(built.normalized||"")){
      for(const pr of row.platforms||[])if(pr.enabled!==false&&simpleWhole[pr.platform])simpleWhole[pr.platform].set(built.normalized,compiledRow);
      compiledRow._indexedWhole=true;
    }
  }
  terms.sort((a,b)=>Number(b.severity||0)-Number(a.severity||0)||String(a.term||"").localeCompare(String(b.term||""),"de"));
  for(const platform of ["twitch","discord"]){
    const sorted=[...simpleWhole[platform].entries()].sort((a,b)=>Number(b[1].severity||0)-Number(a[1].severity||0));
    simpleWhole[platform]=new Map(sorted);
  }
  return {revision:Number(snapshot.revision||0),terms,allow,simpleWhole,policies:Array.isArray(snapshot.policies)?snapshot.policies:[]};
}
function stripAllowlist(compiled,platform,text,opts){
  let out=fold(text,opts);
  for(const a of compiled.allow||[]){
    if(a.platform!=="both"&&a.platform!==platform)continue;
    const val=fold(a.value,opts);if(!val)continue;
    if(a.type==="whole_word"){
      const rx=new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegex(val)}(?=$|[^\\p{L}\\p{N}_])`,"giu");out=out.replace(rx,"$1 ");
    }else out=out.replace(new RegExp(escapeRegex(val),"giu")," ");
  }
  return out;
}
function diagnoseCandidate(row,platform,text,compiled){
  const raw=String(text||"");
  const opts=row?._opts||{umlauts:true};
  const normalized=fold(raw,opts);
  const allowlisted=row?.detection_type==="regex"?raw:stripAllowlist(compiled,platform,raw,opts);
  return {
    raw,
    normalized,
    candidate:allowlisted,
    detectionType:row?.detection_type||"whole_word",
    leetspeak:!!row?.leetspeak,
    repeatLetters:!!row?.repeat_letters,
    flexSeparators:!!row?.flex_separators,
    umlauts:row?.umlauts!==false
  };
}
function diagnose(compiled,platform,text){
  const raw=String(text||"");if(!raw)return [];
  const findings=[];
  for(const row of compiled.terms||[]){
    const pr=(row.platforms||[]).find(x=>x.platform===platform);if(!pr||pr.enabled===false||row.detection_type==="regex")continue;
    const base={leet:!!row.leetspeak,repeat:!!row.repeat_letters,separators:!!row.flex_separators,umlauts:row.umlauts!==false};
    const checks=[];
    if(!base.leet)checks.push(["leetspeak_disabled",{...base,leet:true}]);
    if(!base.repeat)checks.push(["repeat_letters_disabled",{...base,repeat:true}]);
    if(!base.separators)checks.push(["flex_separators_disabled",{...base,separators:true}]);
    for(const [reason,opts] of checks){
      const built=buildRegex(row.term,row.detection_type||"whole_word",opts);if(built.error)continue;
      const candidate=stripAllowlist(compiled,platform,raw,opts);built.regex.lastIndex=0;
      if(built.regex.test(candidate)){findings.push({termId:row.term_id,term:row.term,reason,candidate});break;}
    }
    if(findings.length>=10)break;
  }
  return findings;
}

function match(compiled,platform,text){
  const raw=String(text||"");if(!raw)return null;
  const fastMap=compiled.simpleWhole?.[platform];
  if(fastMap&&fastMap.size){
    const candidate=stripAllowlist(compiled,platform,raw,{umlauts:true});
    const tokens=candidate.split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
    for(const tok of tokens){
      const row=fastMap.get(tok);if(!row)continue;
      const pr=(row.platforms||[]).find(x=>x.platform===platform);if(pr&&pr.enabled!==false)return {term:row,platformRule:pr,matched:String(row.term||"")};
    }
  }
  for(const row of compiled.terms||[]){
    if(row._indexedWhole)continue;
    const pr=(row.platforms||[]).find(x=>x.platform===platform);
    if(!pr||pr.enabled===false)continue;
    const candidate=row.detection_type==="regex"?raw:stripAllowlist(compiled,platform,raw,row._opts);
    if(row.detection_type==="regex"){
      if(row._regexDisabled)continue;
      let hit=false;
      try{hit=testRegexGuarded(row._regex,candidate);}
      catch(e){row._regexDisabled=true;console.error(`⚠️ Wortfilter: Regex "${String(row.term||"").slice(0,80)}" überschritt das Zeitlimit und wird bis zur nächsten Neuladung übersprungen.`);continue;}
      if(hit)return {term:row,platformRule:pr,matched:String(row.term||"")};
      continue;
    }
    row._regex.lastIndex=0;
    if(row._regex.test(candidate))return {term:row,platformRule:pr,matched:String(row.term||"")};
  }
  return null;
}
module.exports={fold,safeRegex,analyzeRegex,testRegexGuarded,compile,match,diagnoseCandidate,diagnose};
