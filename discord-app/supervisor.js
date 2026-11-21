const {spawn}=require("child_process");

const target=process.argv[2];
if(!target){
  console.error("Supervisor: Startdatei fehlt.");
  process.exit(2);
}

let child=null;
let stopping=false;
let restartTimer=null;

function start(){
  if(stopping)return;
  console.log(`🧭 Supervisor startet ${target} …`);
  child=spawn(process.execPath,[target],{
    stdio:"inherit",
    env:process.env
  });

  child.on("exit",(code,signal)=>{
    child=null;
    if(stopping)return;
    const delay=code===75?350:1500;
    console.log(`🔄 ${target} beendet (${signal||code}). Neustart in ${delay} ms.`);
    restartTimer=setTimeout(start,delay);
  });
}

function stop(signal){
  if(stopping)return;
  stopping=true;
  if(restartTimer)clearTimeout(restartTimer);
  console.log(`🛑 Supervisor beendet ${target} (${signal}).`);
  if(child && !child.killed){
    child.kill("SIGTERM");
    const hard=setTimeout(()=>{try{child?.kill("SIGKILL");}catch{}},5000);
    hard.unref?.();
  }
  setTimeout(()=>process.exit(0),5500).unref?.();
}

process.on("SIGTERM",()=>stop("SIGTERM"));
process.on("SIGINT",()=>stop("SIGINT"));
start();
