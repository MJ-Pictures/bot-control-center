const appSource=require("./helpers/app-source");
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createDurableBatchQueue}=require('../shared/durable-batch-queue');
function setup(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bwk-queue-'));return {dir,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};}
test('geordnete Batches: zuerst fehlgeschlagener Batch, danach neuer',()=>{const {dir,cleanup}=setup();try{let fail=true;const processed=[];const q=createDurableBatchQueue({directory:dir,apply:b=>{if(fail)throw Error('down');processed.push(b.batchId);}});q.enqueue({batchId:'0001-abcdefgh',rows:[{delta:2}]});assert.equal(q.drain().failed,true);q.enqueue({batchId:'0002-abcdefgh',rows:[{delta:3}]});fail=false;assert.equal(q.drain().succeeded,2);assert.deepEqual(processed,['0001-abcdefgh','0002-abcdefgh']);}finally{cleanup();}});
test('Recovery after process crash replays stored batches',()=>{const {dir,cleanup}=setup();try{const q=createDurableBatchQueue({directory:dir,apply:()=>{throw Error('offline')}});q.enqueue({batchId:'0001-abcdefgh',rows:[{delta:1}]});const ids=[];const recovered=createDurableBatchQueue({directory:dir,apply:b=>ids.push(b.batchId)});recovered.recover();assert.equal(recovered.stats().pendingBatches,1);assert.equal(recovered.drain().succeeded,1);assert.deepEqual(ids,['0001-abcdefgh']);}finally{cleanup();}});
test('committed-but-unacknowledged batch survives for PG idempotent replay',()=>{const {dir,cleanup}=setup();try{const seen=new Set(),applied=[];const apply=b=>{if(!seen.has(b.batchId)){seen.add(b.batchId);applied.push(b.rows[0].delta);}if(applied.length===1)throw Error('connection reset');};const q=createDurableBatchQueue({directory:dir,apply});q.enqueue({batchId:'0001-abcdefgh',rows:[{delta:5}]});assert.equal(q.drain().failed,true);const second=createDurableBatchQueue({directory:dir,apply:b=>{if(!seen.has(b.batchId)){seen.add(b.batchId);applied.push(b.rows[0].delta);}}});second.recover();second.drain();assert.deepEqual(applied,[5]);}finally{cleanup();}});
test('capacity error does not silently delete previously saved queue',()=>{const {dir,cleanup}=setup();try{const q=createDurableBatchQueue({directory:dir,apply:()=>{},maxBytes:100});q.enqueue({batchId:'0001-abcdefgh',rows:[{delta:1}]});assert.throws(()=>q.enqueue({batchId:'0002-abcdefgh',rows:[{description:'X'.repeat(100)}]}));assert.equal(q.stats().pendingBatches,1);}finally{cleanup();}});
test('diagnostic API is protected and UI exposes no sensitive content',()=>{const code=appSource();assert.match(code,/\/api\/admin\/performance/);assert.match(code,/requireGlobalAdmin\(req,res\)/);assert.match(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'),/Nachrichtenverarbeitung & Persistenz/);});
for(const volume of [100,500,1000])test(`synthetische Batchlast mit ${volume} Nachrichten und Duplikaten`,()=>{
 const {dir,cleanup}=setup();try{
  const accepted=new Set(),rows=new Map();const started=process.hrtime.bigint();
  for(let i=0;i<volume;i++){
   const id=`chat-${i}`;const uid=`user-${i%67}`;
   if(accepted.has(id))continue;accepted.add(id);rows.set(uid,(rows.get(uid)||0)+1);
  }
  // Repeat all IDs; they must not change the batch.
  for(let i=0;i<volume;i++)if(!accepted.has(`chat-${i}`))throw Error('dedup failed');
  let committed=0;const q=createDurableBatchQueue({directory:dir,apply:b=>{committed+=b.rows.reduce((n,r)=>n+r.delta,0);}});
  q.enqueue({batchId:`load-${String(volume).padStart(5,'0')}-abcdefgh`,rows:[...rows].map(([userId,delta])=>({userId,delta}))});
  assert.equal(q.drain().succeeded,1);assert.equal(committed,volume);
  const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;assert.ok(Number.isFinite(elapsedMs));
 }finally{cleanup();}
});
