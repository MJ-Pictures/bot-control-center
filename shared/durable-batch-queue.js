"use strict";
// Persisted, ordered, idempotent replay queue for aggregated Twitch counters.
// Spool files contain only IDs, display names and numeric counts; never chat content.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function createDurableBatchQueue({directory,apply,logger=()=>{},maxBytes=64*1024*1024}={}){
 if(typeof apply!=='function'||!directory)throw Error('Queue-Konfiguration fehlt');
 const pending=[];
 let bytes=0;
 const valid=id=>/^[\w-]{8,130}$/.test(id);
 function ensure(){fs.mkdirSync(directory,{recursive:true,mode:0o700});try{fs.chmodSync(directory,0o700);}catch{}}
 function syncDir(){try{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}catch{}}
 function filename(id){if(!valid(id))throw Error('Ungültige Batch-ID');return path.join(directory,`${id}.json`);}
 function enqueue(batch){
  const id=String(batch?.batchId||'');const dest=filename(id);
  if(!Array.isArray(batch.rows)||!batch.rows.length)throw Error('Leerer Batch');
  const content=JSON.stringify(batch);
  const size=Buffer.byteLength(content);
  if(size>maxBytes||bytes+size>maxBytes)throw Error('Zähler-Zwischenspeicher ist voll');
  ensure();
  if(fs.existsSync(dest))throw Error('Batch-ID bereits vorhanden');
  const temp=path.join(directory,`.${id}.${crypto.randomUUID()}.tmp`);
  try{
   const fd=fs.openSync(temp,'wx',0o600);
   try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temp,dest);syncDir();
  }catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
  pending.push({id,file:dest,size,rows:batch.rows.length,attempts:0});bytes+=size;
 }
 function recover(){
  ensure();pending.length=0;bytes=0;
  const files=fs.readdirSync(directory).filter(f=>f.endsWith('.json')).sort((a,b)=>a.localeCompare(b));
  for(const file of files){
   const content=fs.readFileSync(path.join(directory,file),'utf8');
   let batch;try{batch=JSON.parse(content);}catch(e){throw Error(`Ungültiger Recovery-Batch ${file}: ${e.message}`);}
   if(!valid(String(batch.batchId))||file!==`${batch.batchId}.json`||!Array.isArray(batch.rows))throw Error(`Ungültiger Recovery-Batch ${file}`);
   const size=Buffer.byteLength(content);pending.push({id:batch.batchId,file:path.join(directory,file),size,rows:batch.rows.length,attempts:0});bytes+=size;
  }
  if(bytes>maxBytes)logger('Zähler-Spool ist über Kapazitätsgrenze; bestehende Daten werden nicht verworfen');
 }
 function drain(maxBatches=8){
  let succeeded=0,retries=0,failed=false,error=null;
  for(let i=0;i<maxBatches&&pending.length;i++){
   const item=pending[0];
   try{
    const batch=JSON.parse(fs.readFileSync(item.file,'utf8'));
    // PostgreSQL transaction deduplicates by batchId, including ambiguous success-then-disconnect.
    if(item.attempts)retries++;
    item.attempts++;
    apply(batch);
    fs.unlinkSync(item.file);syncDir();
    pending.shift();bytes-=item.size;succeeded++;
   }catch(e){failed=true;error=String(e.message||e).slice(0,240);logger(`Batch ${item.id}: ${error}`);break;}
  }
  return {succeeded,retries,failed,error};
 }
 function stats(){return {pendingBatches:pending.length,queuedRows:pending.reduce((n,x)=>n+x.rows,0),bytes,capacity:maxBytes};}
 return {enqueue,recover,drain,stats};
}
module.exports={createDurableBatchQueue};
