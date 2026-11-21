"use strict";
const assert = require("assert");
const { SpamDetector, normalizeSpamProtectConfig, countMentions } = require("../discord-app/spam-protect");

function msg(id, content, roles = [], channel = "100") {
  return { id:String(id), guild_id:"1", channel_id:String(channel), content, author:{id:"42",username:"tester",bot:false}, member:{roles}, webhook_id:null };
}
const cfg = normalizeSpamProtectConfig({enabled:true, flood:{threshold:4,windowSeconds:5}, duplicate:{threshold:3,windowSeconds:10}, mentions:{threshold:4}, action:{cooldownSeconds:2}});

// Flood: 4 messages inside 5 seconds.
{
  const d=new SpamDetector();
  assert.equal(d.inspect(msg(1,"a"),cfg,{nowMs:1000}),null);
  assert.equal(d.inspect(msg(2,"b"),cfg,{nowMs:2000}),null);
  assert.equal(d.inspect(msg(3,"c"),cfg,{nowMs:3000}),null);
  assert.equal(d.inspect(msg(4,"d"),cfg,{nowMs:4000}).type,"flood");
}
// Duplicate: 3 identical normalized messages.
{
  const d=new SpamDetector();
  assert.equal(d.inspect(msg(1,"Hallo   Welt"),cfg,{nowMs:1000}),null);
  assert.equal(d.inspect(msg(2,"hallo welt"),cfg,{nowMs:2000}),null);
  assert.equal(d.inspect(msg(3,"HALLO WELT"),cfg,{nowMs:3000}).type,"duplicate");
}
// Mention spam.
{
  const d=new SpamDetector();
  const m=msg(1,"<@123456789012345> <@223456789012345> <@&323456789012345> @everyone");
  assert.equal(countMentions(m),4);
  assert.equal(d.inspect(m,cfg,{nowMs:1000}).type,"mentions");
}
// Exempt role and channel.
{
  const d=new SpamDetector();
  const x=normalizeSpamProtectConfig({...cfg,exemptRoleIds:["999"],exemptChannelIds:["777"]});
  for(let i=0;i<6;i++)assert.equal(d.inspect(msg(i,"x"+[i], ["999"]),x,{nowMs:1000+i}),null);
  for(let i=0;i<6;i++)assert.equal(d.inspect(msg(i,"x"+[i], [],"777"),x,{nowMs:2000+i}),null);
}
// Staff exemption.
{
  const d=new SpamDetector();
  for(let i=0;i<6;i++)assert.equal(d.inspect(msg(i,"z"+[i],["555"]),cfg,{nowMs:1000+i,staffRoleIds:["555"]}),null);
}
// Cooldown prevents repeated actions from the same burst.
{
  const d=new SpamDetector();
  for(let i=0;i<3;i++)d.inspect(msg(i,"dup"),cfg,{nowMs:1000+i});
  assert.equal(d.inspect(msg(9,"dup"),cfg,{nowMs:1500}),null);
}
console.log("discord-spam-protect.test.js: OK");
