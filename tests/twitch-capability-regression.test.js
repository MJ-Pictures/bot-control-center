const appSource=require("./helpers/app-source");
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const src=appSource();
assert(src.includes('hasStoredTwitchCapabilities=Array.isArray(managed?.capabilities)&&managed.capabilities.length>0'));
assert(src.includes('&&!hasStoredTwitchCapabilities;'));
assert(src.includes('hasStoredTwitchCapabilities=Array.isArray(managed.capabilities)&&managed.capabilities.length>0'));
console.log('twitch-capability-regression.test.js: OK');
