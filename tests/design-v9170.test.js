// 9.17.0 Design: Maßsystem und Abstände (Schritte werden fortgeschrieben)
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const css=fs.readFileSync(path.join(__dirname,"..","public/style.css"),"utf8");
test("Design Schritt 0: Maßsystem als Variablen",()=>{
  for(const v of ["--space-1:4px","--space-2:8px","--space-3:12px","--space-4:16px","--space-5:24px","--radius-sm:6px","--radius:10px","--radius-pill:999px","--block-gap:"])assert.ok(css.includes(v),v);
});
test("Design Schritt 1: Karten in Raster- und Listencontainern ohne eigenen Außenabstand",()=>{
  for(const c of [".module-list",".community-grid",".watch-summary-grid",".moderation-filter-list",".stats-summary-grid",".diag-summary-grid",".diag-two-col",".backup-grid"])assert.ok(css.includes(`${c}>.card`),c);
  assert.match(css,/\.backup-grid>\.card\{margin:0\}/);
});
test("Design Schritt 2: eine gemeinsame Kachel für Status-, Kennzahl- und Zählerkacheln",()=>{
  assert.match(css,/--tile-pad:10px 12px/);assert.match(css,/--tile-value:1\.2rem/);
  assert.match(css,/\.status-card,\.summary-item,\.diag-summary,\.watch-summary,\.stats-summary,\.stuben-kpi\{padding:var\(--tile-pad\);border-radius:var\(--radius\)/);
  assert.match(css,/\.status-card\{min-height:0\}/);
});
test("Design Schritt 3: Seitenkopf (Überschrift und Hinweis) gestrafft",()=>{
  assert.match(css,/\.pane>\.title\{margin-bottom:var\(--space-3\)\}/);
  assert.match(css,/\.pane>\.title h2\{margin:var\(--space-2\) 0 0\}/);
  assert.match(css,/\.pane>\.title \.hint\{margin:var\(--space-2\) 0 0\}/);
});
test("Design Schritt 4: eine Steuerhöhe für Knöpfe, Eingabefelder und Auswahllisten; Reiter",()=>{
  assert.match(css,/--control-h:34px/);
  assert.match(css,/button,\.btn\{padding:var\(--control-pad\);min-height:var\(--control-h\);border-radius:var\(--radius-sm\)\}/);
  assert.match(css,/select\{min-height:var\(--control-h\);padding:var\(--control-pad-input\)/);
  assert.match(css,/\.sub-tab\{padding:7px 12px;min-height:0\}/);
  assert.match(css,/\.admin-tab-section-links \.sub-tab\{padding:7px 8px\}/); // Administration bleibt einzeilig
});
test("Design Schritt 5: Event-Profile-Erklärkarte einklappbar, Modulkarten kompakt",()=>{
  const js=fs.readFileSync(path.join(__dirname,"..","public","app.js"),"utf8");
  assert.match(js,/<details class="card event-profile-howto">\s*<summary>So funktionieren Event-Profile<\/summary>/);
  assert.match(css,/\.module-card\{padding:10px 14px\}/);
  assert.match(css,/\.card>h3:first-child,\.card>h2:first-child\{margin:0 0 var\(--space-2\)\}/);
});
test("Design Schritt 5 (Teil 2): Kennzahlen der Übersicht als auto-fit-Raster, Sonderknöpfe in Steuerhöhe",()=>{
  assert.match(css,/\.summary-grid\{grid-template-columns:repeat\(auto-fit,minmax\(110px,1fr\)\)/);
  assert.match(css,/\.icon-btn,\.follow-message-delete\{width:var\(--control-h\);height:var\(--control-h\)/);
});
test("Design 9.17.5: Kopfzeile im Light-Mode lesbar, Kartenüberschriften ohne Extra-Abstand, Knopfhöhen",()=>{
  assert.match(css,/header \.account-menu-trigger\{color:#fff\}/);
  assert.match(css,/header \.account-menu-panel\{color:var\(--text\)\}/);
  assert.match(css,/header \.account-menu-panel strong\{color:inherit/);
  assert.match(css,/\.card>\.title:first-child h2:first-child,.*\{margin-top:0\}/);
  assert.match(css,/\.social-history-actions \.btn,\.social-history-actions button\{.*height:var\(--control-h\)/);
});
test("Design 9.17.6: Kontrast-Korrekturen in beiden Designs",()=>{
  assert.match(css,/\.app-footer a\{color:inherit;text-decoration:underline\}/);
  assert.match(css,/:root\[data-theme="dark"\] \.error,/);
  assert.match(css,/:root\[data-theme="dark"\] \.helpgrid p/);
  assert.match(css,/:root:not\(\[data-theme="dark"\]\) \.diag-missing\{color:#b42318\}/);
  assert.match(css,/:root:not\(\[data-theme="dark"\]\) \.favorite-toggle\{color:#b77a00\}/);
});
test("Design 9.17.7: Followathon-Formular und Leistungskennzahlen haben ein Raster",()=>{
  assert.match(css,/\.fa-form\{display:grid;gap:var\(--space-3\)/);
  assert.match(css,/\.diag-grid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(200px,1fr\)\)/);
});
test("Design 9.17.8: restliche Kontrastwerte (Schwelle 4,5)",()=>{
  assert.match(css,/:root:not\(\[data-theme="dark"\]\) \.favorite-toggle\{color:#8f5f00\}/);
  assert.match(css,/\.platform-switch-btn:not\(\.active\) \.platform-switch-icon\{color:#55616c\}/);
  assert.match(css,/:root\[data-theme="dark"\] \.module-critical\{color:#ff8a82\}/);
});
