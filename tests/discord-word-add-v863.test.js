"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {categorySuggestions,wordAddLogMessage}=require("../shared/discord-word-add");
const categories=[{category_id:"beleidigungen",name:"Beleidigungen"},{category_id:"drohungen",name:"Drohungen"},{category_id:"extremismus",name:"Extremismus"}];
test("/add autocomplete uses existing database category IDs",()=>{assert.deepEqual(categorySuggestions(categories,"beleid"),[{name:"Beleidigungen",value:"beleidigungen"}]);assert.deepEqual(categorySuggestions(categories,"droh"),[{name:"Drohungen",value:"drohungen"}]);});
test("/add autocomplete caps result at Discord limit",()=>{assert.equal(categorySuggestions(Array.from({length:40},(_,i)=>({category_id:`id-${i}`,name:`K ${i}`})),"").length,25);});
test("/add log message displays actor category severity and platforms",()=>{const s=wordAddLogMessage({term:"Testwort",category_id:"beleidigungen",severity:3,platforms:[{platform:"discord",enabled:true},{platform:"twitch",enabled:false}]},"12345","Beleidigungen");assert.match(s,/Testwort/);assert.match(s,/Beleidigungen/);assert.match(s,/Grad 3/);assert.match(s,/discord/);assert.match(s,/<@12345>/);});
