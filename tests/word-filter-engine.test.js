"use strict";
const assert=require("assert");
const {compile,match,safeRegex}=require("../shared/word-filter-engine");

function snap(term,extra={}){return compile({revision:1,allowlist:extra.allowlist||[],terms:[{
  term_id:"t1",term,category_id:"beleidigungen",severity:3,detection_type:extra.type||"whole_word",enabled:true,test_only:false,
  leetspeak:!!extra.leet,repeat_letters:!!extra.repeat,flex_separators:!!extra.separators,umlauts:extra.umlauts!==false,
  platforms:[{platform:"twitch",enabled:true},{platform:"discord",enabled:true}]
}]});}
assert(match(snap("arsch"),"twitch","du arsch bist da"));
assert(!match(snap("arsch"),"twitch","marschieren"));
assert(match(snap("scheiße"),"discord","SCHEISSE"));
assert(match(snap("arsch",{leet:true}),"discord","@rsch"));
assert(match(snap("arsch",{repeat:true}),"discord","arrrssch"));
assert(match(snap("arsch",{separators:true}),"discord","a.r-s c_h"));
assert(match(snap("böse phrase",{type:"phrase"}),"twitch","Das ist eine böse phrase heute"));
assert(!match(snap("arsch",{allowlist:[{value:"arschlochmuseum",platform:"both",match_type:"phrase",enabled:true}]}),"twitch","arschlochmuseum"));
assert.strictEqual(safeRegex("(a+)+$").ok,false);
assert.strictEqual(safeRegex("\\bfoo\\b").ok,true);

const many=compile({revision:2,terms:Array.from({length:5000},(_,i)=>({term_id:`x${i}`,term:`wort${i}`,category_id:"benutzerdefiniert",severity:1,detection_type:"whole_word",enabled:true,platforms:[{platform:"twitch",enabled:true},{platform:"discord",enabled:true}]})),allowlist:[]});
const start=Date.now();for(let i=0;i<200;i++)match(many,"twitch","eine harmlose nachricht");
assert(Date.now()-start<2500,"Matcher für große Listen ist zu langsam");
console.log("word-filter-engine.test.js: OK");
const cross=compile({revision:3,terms:[{term_id:"onlyd",term:"plattformwort",category_id:"benutzerdefiniert",severity:2,detection_type:"whole_word",enabled:true,platforms:[{platform:"twitch",enabled:false},{platform:"discord",enabled:true}]}],allowlist:[]});
assert(!match(cross,"twitch","plattformwort"));
assert(match(cross,"discord","plattformwort"));
const fs=require("fs");const ld=fs.readFileSync(require("path").join(__dirname,"..","shared","ldnoobw-de.txt"),"utf8").split(/\r?\n/).filter(Boolean);assert.strictEqual(ld.length,66);
