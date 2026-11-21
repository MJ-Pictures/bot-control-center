const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
test('search dialog has accessible input and close controls',()=>{
 for(const id of ['globalSearchOpen','globalSearchOverlay','globalSearchInput','globalSearchClose','globalSearchResults'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/aria-modal="true"/);
});
test('global search respects permissions and debounces bounded member search',()=>{
 assert.match(source,/navFavoriteAllowed\(item,platform\)/);
 assert.match(source,/hasCapability\('discord.members.view'\)/);
 assert.match(source,/encodeURIComponent\(query\)\}&limit=10/);
 assert.match(source,/globalSearchTimer=setTimeout/);
});
