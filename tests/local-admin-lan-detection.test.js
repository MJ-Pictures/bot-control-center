const appSource=require("./helpers/app-source");
const fs=require('fs');
const path=require('path');
const src=appSource();
const net=fs.readFileSync(path.join(__dirname,'..','shared','client-ip.js'),'utf8');
// Seit V8.6.6 liegt die Erkennung in shared/client-ip.js; server.js bindet sie ein.
for(const needle of ['function directLocalHostRequest(req)','isPrivateOrLoopbackIp(peer)','ipInAnyCidr(host, localCidrs)']){
  if(!net.includes(needle)) throw new Error(`missing in shared/client-ip.js: ${needle}`);
}
for(const needle of ['createClientIpResolver','mode:TRUSTED_PROXY_CIDRS.length?"lan-and-trusted-proxy":"direct-lan-only"']){
  if(!src.includes(needle)) throw new Error(`missing in server.js: ${needle}`);
}
if(src.includes('LOCAL_ADMIN_ENABLED&&!TRUSTED_PROXY_CIDRS.length)warnings.push')) throw new Error('legacy proxy warning still active');
console.log('local-admin-lan-detection.test.js: OK');
