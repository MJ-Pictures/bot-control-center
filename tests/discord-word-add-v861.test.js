"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {validateAddTerm,makeAddTerm}=require("../shared/discord-word-add");
const snap={categories:[{category_id:"beleidigung"},{category_id:"benutzerdefiniert"}]};
test("Discord add validates and enables leetspeak",()=>{const v=validateAddTerm({word:" Testwort ",category:"beleidigung",severity:4,platform:"both"},snap);const term=makeAddTerm(v,"123");assert.equal(term.term,"Testwort");assert.equal(term.leetspeak,true);assert.equal(term.severity,4);assert.deepEqual(term.platforms.map(x=>x.enabled),[true,true]);});
test("Discord add rejects unknown categories and invalid severity",()=>{assert.throws(()=>validateAddTerm({word:"Test",category:"irrelevant"},snap));assert.throws(()=>validateAddTerm({word:"Test",severity:9},snap));});
test("Discord add defaults only to discord",()=>{const v=validateAddTerm({word:"Testwort"},snap),term=makeAddTerm(v,"42");assert.deepEqual(term.platforms.map(x=>x.enabled),[true,false]);});
