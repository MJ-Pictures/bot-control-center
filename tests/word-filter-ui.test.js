const fs=require("fs");
const ui=fs.readFileSync(require("path").join(__dirname,"../public/app.js"),"utf8");
const css=fs.readFileSync(require("path").join(__dirname,"../public/style.css"),"utf8");
function ok(v,m){if(!v)throw new Error(m)}
for(const id of ["wfSearch","wfCategory","wfPlatform","wfStatus","wfSeverity","wfSource","wfDetection","wfSort","wfResetFilters","wfPrevPage","wfNextPage","wfPageSize"])ok(ui.includes(id),`UI-Element fehlt: ${id}`);
ok(ui.includes('renderWordFilter(false)'),"Lokales Filter-Rendering fehlt");
ok(ui.includes('pageTerms'),"Seitennavigation fehlt");
ok(css.includes('.wf-filter-grid'),"Filterlayout fehlt");
ok(css.includes('@media(max-width:900px)'),"Mobile Regeln fehlen");

for(const tab of ["words","policies","allowlist","import","test","stats"])ok(ui.includes(`data-wf-tab="${tab}"`),`Wortfilter-Tab fehlt: ${tab}`);
ok(ui.includes('activeTab:"words"'),"Persistenter Wortfilter-Tabzustand fehlt");
ok(css.includes('.word-filter-tabs'),"Responsive Wortfilter-Tabnavigation fehlt");
console.log("word-filter-ui.test.js: OK");
