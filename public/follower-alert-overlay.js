"use strict";
const banner=document.getElementById("banner"),nameEl=document.getElementById("name");
let queue=[],playing=false,durationSeconds=7;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function resize(){banner.style.transform=`scale(${Math.min(1,innerWidth/980,innerHeight/190)})`;}
addEventListener("resize",resize);resize();
function setDuration(value){const n=Number(value);if(Number.isInteger(n)&&n>=5&&n<=20)durationSeconds=n;}
function fitName(name){const len=[...name].length;nameEl.style.fontSize=`${len>29?29:len>23?35:len>17?42:55}px`;}
async function playNext(){
 if(playing||!queue.length)return;
 playing=true;
 while(queue.length){
  const nickname=queue.shift();
  nameEl.classList.remove("shown");nameEl.textContent=nickname;fitName(nickname);
  banner.classList.add("visible");
  // Forced style flush so consecutive alerts also animate from opacity: 0.
  void nameEl.offsetWidth;
  await sleep(100);nameEl.classList.add("shown");
  await sleep(durationSeconds*1000-750);
  nameEl.classList.remove("shown");await sleep(650);
  banner.classList.remove("visible");await sleep(180);
 }
 playing=false;
}
function enqueue(name){if(typeof name!=="string"||!name.trim())return;queue.push(name.slice(0,48));if(queue.length>12)queue=queue.slice(-12);playNext();}
function connect(){
 const stream=new EventSource("/api/follower-alert/public/stream");
 stream.addEventListener("config",event=>{try{setDuration(JSON.parse(event.data).durationSeconds);}catch{}});
 stream.addEventListener("follow",event=>{try{enqueue(JSON.parse(event.data).userName);}catch{}});
}
connect();

// 9.14.0: Fehlt das Banner-Bild (kein Upload, kein Standardbild), erscheint ein einfacher Hintergrund.
(()=>{const art=document.getElementById("art"),banner=document.getElementById("banner");if(!art||!banner)return;
  const miss=()=>banner.classList.add("noart");art.addEventListener("error",miss);if(art.complete&&art.naturalWidth===0)miss();})();
