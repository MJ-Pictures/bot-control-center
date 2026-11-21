const fs = require("fs");
const assert = require("assert");
const src = fs.readFileSync(require("path").join(__dirname,"..","public","app.js"),"utf8");
for (const id of ["wfBulkLeet","wfBulkRepeat","wfBulkSeparators"]) assert(src.includes(`id="${id}"`), `${id} fehlt in Massenbearbeitung`);
assert(src.includes('leetspeak:bulkLeet==="on"?true:bulkLeet==="off"?false:!!t.leetspeak'), "Leetspeak-Batchlogik fehlt");
assert(src.includes('repeat_letters:bulkRepeat==="on"?true:bulkRepeat==="off"?false:!!t.repeat_letters'), "Repeat-Batchlogik fehlt");
assert(src.includes('flex_separators:bulkSeparators==="on"?true:bulkSeparators==="off"?false:!!t.flex_separators'), "Separator-Batchlogik fehlt");
console.log("word-filter-bulk-options.test.js: OK");
