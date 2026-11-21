const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {createFollowathon}=require('../app/followathon');

const make=(file)=>createFollowathon({file,audit:()=>{},publicBaseUrl:'https://example.test',getTwitchStatus:async()=>({account:{valid:true},eventSub:{connected:true,subscription:{ok:true}}})});

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bwk-followathon-'));
  const file=path.join(dir,'state.json');
  let fa=make(file);

  // Basis, Message-ID-Deduplizierung, Refollow-Schutz, Pause und Annahmestopp.
  await fa.createEvent({name:'Test',startDurationSeconds:120,secondsPerFollow:60,maxRemainingSeconds:240,anomalyThreshold:20,anomalyWindowSeconds:60},'owner');
  await fa.action('start',{},'mod');
  let st=await fa.getAdminState(); assert.equal(st.event.status,'running');
  await fa.handleFollow({user_id:'1',user_name:'A',followed_at:new Date().toISOString()},{message_id:'m1'});
  st=await fa.getAdminState(); assert.equal(st.event.followCount,1); assert(st.event.creditedNetSeconds>=60);
  await fa.handleFollow({user_id:'1',user_name:'A',followed_at:new Date().toISOString()},{message_id:'m2'});
  st=await fa.getAdminState(); assert.equal(st.event.followCount,1,'refollow must not credit twice');
  await fa.handleFollow({user_id:'2',user_name:'B',followed_at:new Date().toISOString()},{message_id:'m1'});
  st=await fa.getAdminState(); assert.equal(st.event.followCount,1,'message id must dedupe');

  await fa.action('pause',{},'mod'); const paused=(await fa.getAdminState()).event.remainingSeconds;
  await new Promise(r=>setTimeout(r,20));
  await fa.handleFollow({user_id:'3',user_name:'C',followed_at:new Date().toISOString()},{message_id:'m3'});
  st=await fa.getAdminState(); assert.equal(st.event.status,'paused'); assert(st.event.remainingSeconds>=paused,'pause accepts credits without countdown');
  await fa.action('acceptance',{enabled:false},'mod');
  await fa.handleFollow({user_id:'4',user_name:'D',followed_at:new Date().toISOString()},{message_id:'m4'});
  st=await fa.getAdminState(); assert.equal(st.event.followCount,2,'acceptance stop must block credit');

  // Persistenz/Neustart: pausierter Zustand bleibt erhalten.
  const pausedBeforeRestart=st.event.remainingSeconds;
  fa=make(file); st=await fa.getAdminState();
  assert.equal(st.event.status,'paused'); assert.equal(st.event.remainingSeconds,pausedBeforeRestart);

  // Fortsetzen, parallele unterschiedliche Follows werden serialisiert verarbeitet.
  await fa.action('acceptance',{enabled:true},'mod');
  await fa.action('resume',{},'mod');
  await Promise.all([
    fa.handleFollow({user_id:'5',user_name:'E',followed_at:new Date().toISOString()},{message_id:'m5'}),
    fa.handleFollow({user_id:'6',user_name:'F',followed_at:new Date().toISOString()},{message_id:'m6'})
  ]);
  st=await fa.getAdminState(); assert.equal(st.event.followCount,4,'concurrent follows must both be recorded');

  // Null beendet dauerhaft und spätere Follows reaktivieren nicht.
  await fa.action('adjust',{seconds:9999,direction:'subtract',reason:'zero test'},'mod');
  st=await fa.getAdminState(); assert.equal(st.event.status,'ended'); assert.equal(st.event.remainingSeconds,0);
  await fa.handleFollow({user_id:'7',user_name:'G',followed_at:new Date().toISOString()},{message_id:'m7'});
  st=await fa.getAdminState(); assert.equal(st.event.status,'ended','follow must never restart ended timer');

  // Maximalgrenze erzeugt Teilgutschrift statt versteckter Warteschlange.
  await fa.createEvent({name:'Limit',startDurationSeconds:120,secondsPerFollow:60,maxRemainingSeconds:130,anomalyThreshold:20,anomalyWindowSeconds:60},'owner');
  await fa.action('start',{},'mod');
  await fa.handleFollow({user_id:'10',user_name:'LimitUser',followed_at:new Date().toISOString()},{message_id:'lm1'});
  st=await fa.getAdminState();
  const credit=st.event.log.find(x=>x.messageId==='lm1');
  assert(credit.creditedSeconds>0 && credit.creditedSeconds<=11,'credit must be clipped by max remaining limit');
  assert.equal(credit.decision,'partial-credit');

  // Auffälligkeitsschutz hält ab Überschreiten der Schwelle zurück.
  await fa.action('end',{},'mod');
  await fa.createEvent({name:'Anomaly',startDurationSeconds:600,secondsPerFollow:60,anomalyThreshold:2,anomalyWindowSeconds:60},'owner');
  await fa.action('start',{},'mod');
  const stamp=new Date().toISOString();
  await fa.handleFollow({user_id:'20',user_name:'U1',followed_at:stamp},{message_id:'a1'});
  await fa.handleFollow({user_id:'21',user_name:'U2',followed_at:stamp},{message_id:'a2'});
  await fa.handleFollow({user_id:'22',user_name:'U3',followed_at:stamp},{message_id:'a3'});
  st=await fa.getAdminState(); assert.equal(st.event.followCount,2); assert.equal(st.event.held.length,1);
  await fa.reviewHeld(st.event.held[0].id,true,'mod');
  st=await fa.getAdminState(); assert.equal(st.event.followCount,3,'approved held follow must be credited exactly once');

  // Testmodus ändert produktiven Zustand nicht.
  const before=JSON.stringify({followCount:st.event.followCount,credited:st.event.creditedNetSeconds});
  const sim=await fa.testFollow({userName:'Simulation'},'mod'); assert(sim.ok);
  st=await fa.getAdminState();
  assert.equal(JSON.stringify({followCount:st.event.followCount,credited:st.event.creditedNetSeconds}),before);

  console.log('followathon.test.js: OK');
})().catch(e=>{console.error(e);process.exit(1)});
