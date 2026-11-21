"use strict";
// Stubenkontrolle: Zeichnungen der Kontrollfigur und der Männchen (SVG).
// Dieselben Funktionen erzeugen die WebM-Clips (Bild für Bild) und die Live-Animation im Overlay,
// wenn der Browser WebM mit Alphakanal nicht transparent abspielt (Safari/WebKit, z. B. Moblin auf dem iPhone).
(function(){

const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x)};
const outBack=x=>{x=clamp(x);const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2)};
const lerp=(a,b,t)=>a+(b-a)*t;
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const mix=(a,b,t)=>{const A=hex(a),B=hex(b);return "#"+A.map((v,i)=>Math.round(lerp(v,B[i],t)).toString(16).padStart(2,"0")).join("")};
const OL="#2a2118"; // Konturfarbe
// 9.24.0: Stil "teacher" = neutrale Standardfigur (Lehrer mit Brille, Strickjacke, Krawatte); "legacy" = bisherige Kontrollfigur der Bestandsinstallation.
let STYLE="legacy";

function limb(pts,w,col){ // Armsegmente mit Kontur
  const d="M"+pts.map(p=>p.join(" ")).join(" L");
  return `<path d="${d}" stroke="${OL}" stroke-width="${w+10}" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="${d}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
}
function fist(x,y,skin,thumb,rot=0){ // Faust mit gebeugten Fingern, thumb 0..1 = Daumen ausgestreckt
  const th=clamp(thumb);
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <g transform="translate(-24 -22) rotate(${-16*th}) scale(1 ${0.2+0.8*th})">
      <rect x="-16" y="-54" width="32" height="64" rx="16" fill="${skin}" stroke="${OL}" stroke-width="5"/></g>
    <rect x="-42" y="-26" width="84" height="58" rx="20" fill="${skin}" stroke="${OL}" stroke-width="5"/>
    <path d="M-10 -12 h46 M-10 2 h46 M-10 16 h42" stroke="${OL}" stroke-width="3.5" stroke-linecap="round" opacity=".6" fill="none"/>
  </g>`;
}
function star(x,y,s,rot,col="#ffe066"){
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 -26 L7 -7 L27 0 L7 7 L0 26 L-7 7 L-27 0 L-7 -7 Z" fill="${col}" stroke="#b8860b" stroke-width="2.5" stroke-linejoin="round"/></g>`;
}

function spiess(o){
  const skin=o.skin||"#f2c29b", skinD=mix(skin,"#a0522d",.22);
  const T=STYLE==="teacher";
  const cloth=T?"#3d5a80":"#566b3a", clothD=T?"#2c4263":"#3f5029";
  const eo=o.eyeOpen??1, smile=o.smile??0, open=o.open??0, a=o.anger??0, raise=o.brow??0, hat=o.hat??0;
  // Brauen
  const bo=258-14*a-raise, bi=258+16*a-raise;
  const brows=`<path d="M228 ${bo} L286 ${bi}" stroke="#4a3a2a" stroke-width="13" stroke-linecap="round"/><path d="M372 ${bo} L314 ${bi}" stroke="#4a3a2a" stroke-width="13" stroke-linecap="round"/>`;
  // Augen
  const eyeY=292, ry=Math.max(2,17*eo);
  let eyes="";
  if(o.happyEyes>0.5){ eyes=`<path d="M238 ${eyeY+6} Q260 ${eyeY-14} 282 ${eyeY+6}" stroke="${OL}" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M318 ${eyeY+6} Q340 ${eyeY-14} 362 ${eyeY+6}" stroke="${OL}" stroke-width="7" stroke-linecap="round" fill="none"/>`; }
  else { const pr=Math.max(3,8-4*a);
    eyes=`<ellipse cx="260" cy="${eyeY}" rx="21" ry="${ry}" fill="#fff" stroke="${OL}" stroke-width="4"/><ellipse cx="340" cy="${eyeY}" rx="21" ry="${ry}" fill="#fff" stroke="${OL}" stroke-width="4"/>
    <circle cx="${262+(o.look||0)}" cy="${eyeY+1}" r="${pr}" fill="#2a1d12"/><circle cx="${338+(o.look||0)}" cy="${eyeY+1}" r="${pr}" fill="#2a1d12"/>`;
    if(a>0.2) eyes+=`<path d="M236 ${eyeY-ry+2} L284 ${eyeY-ry+2+a*10}" stroke="${skin}" stroke-width="${6+a*8}" stroke-linecap="round" opacity=".0"/>`;
  }
  // Mund
  const c1=20*smile-10*(o.frown||0), c2=20*smile+110*open+6;
  const mouthD=`M258 388 Q300 ${388+c1} 342 388 Q300 ${388+c2} 258 388 Z`;
  const mouth=`<defs><clipPath id="mc"><path d="${mouthD}"/></clipPath></defs>
   <path d="${mouthD}" fill="#6b1717" stroke="${OL}" stroke-width="5" stroke-linejoin="round"/>
   <g clip-path="url(#mc)"><rect x="250" y="380" width="100" height="${12+10*open}" fill="#fff"/>
   <ellipse cx="300" cy="${388+c2*0.78}" rx="28" ry="${8+16*open}" fill="#d9606f"/></g>`;
  const bart=`<path d="M300 352 C272 334 224 342 212 376 C244 380 272 372 300 362 C328 372 356 380 388 376 C376 342 328 334 300 352 Z" fill="#7a6650" stroke="${OL}" stroke-width="5" stroke-linejoin="round"/>`;
  const glasses=`<g fill="none" stroke="#3a2c20" stroke-width="7" stroke-linecap="round"><circle cx="260" cy="292" r="36" fill="#bfe3ff" fill-opacity=".18"/><circle cx="340" cy="292" r="36" fill="#bfe3ff" fill-opacity=".18"/><path d="M296 290 Q300 282 304 290"/><path d="M225 288 L196 280 M375 288 L404 280"/></g>`;
  const cheeks=o.blush?`<circle cx="228" cy="345" r="20" fill="#ff8a8a" opacity="${.55*o.blush}"/><circle cx="372" cy="345" r="20" fill="#ff8a8a" opacity="${.55*o.blush}"/>`:"";
  let head=`
   <rect x="262" y="395" width="76" height="80" fill="${skinD}" stroke="${OL}" stroke-width="5"/>
   <ellipse cx="192" cy="312" rx="19" ry="30" fill="${skin}" stroke="${OL}" stroke-width="5"/><ellipse cx="408" cy="312" rx="19" ry="30" fill="${skin}" stroke="${OL}" stroke-width="5"/>
   <ellipse cx="300" cy="302" rx="108" ry="122" fill="${skin}" stroke="${OL}" stroke-width="6"/>
   ${cheeks}
   <ellipse cx="300" cy="332" rx="21" ry="17" fill="${skinD}" stroke="${OL}" stroke-width="4"/>
   ${eyes}${T?glasses:""}${brows}${mouth}${T?"":bart}
   <g transform="translate(0 ${-hat})"><path d="M183 258 C164 188 226 128 332 134 C424 140 436 204 418 258 C354 226 250 226 183 258 Z" fill="#3b4a28" stroke="${OL}" stroke-width="6" stroke-linejoin="round"/>
   <path d="M186 252 C250 226 354 226 416 252" fill="none" stroke="#242d17" stroke-width="12" stroke-linecap="round"/>
   <circle cx="246" cy="205" r="15" fill="#e3b341" stroke="${OL}" stroke-width="4"/><path d="M246 195 l3 7 7 .5 -5.5 4.5 2 7 -6.5 -4 -6.5 4 2 -7 -5.5 -4.5 7 -.5z" fill="#fff3b0"/></g>`;
  if(T) head=head.replace(/<g transform="translate\(0 -?[\d.]+\)"><path d="M183 258[\s\S]*<\/g>\s*$/,`<g transform="translate(0 ${-hat})"><path d="M186 270 C170 196 226 146 300 146 C378 146 432 198 414 270 C392 226 348 204 300 206 C252 204 210 226 186 270 Z" fill="#9a9ca3" stroke="${OL}" stroke-width="6" stroke-linejoin="round"/><path d="M232 192 Q268 170 312 178 M332 174 Q372 180 392 208" stroke="#7c7e85" stroke-width="7" fill="none" stroke-linecap="round"/></g>`);
  const torso=`
   <path d="M96 800 L108 570 Q120 466 232 446 L368 446 Q480 466 492 570 L504 800 Z" fill="${cloth}" stroke="${OL}" stroke-width="6" stroke-linejoin="round"/>
   <path d="M232 446 L300 548 L368 446 Z" fill="#d6c79a" stroke="${OL}" stroke-width="5" stroke-linejoin="round"/>
   <path d="M288 470 h24 l10 96 -22 24 -22 -24z" fill="#2f3a22" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
   <path d="M232 446 L262 440 L300 470 L262 480Z M368 446 L338 440 L300 470 L338 480Z" fill="${clothD}" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
   <rect x="150" y="610" width="92" height="64" rx="8" fill="${clothD}" stroke="${OL}" stroke-width="5"/><rect x="358" y="610" width="92" height="64" rx="8" fill="${clothD}" stroke="${OL}" stroke-width="5"/>
   <circle cx="196" cy="640" r="8" fill="#e3b341" stroke="${OL}" stroke-width="3"/><circle cx="404" cy="640" r="8" fill="#e3b341" stroke="${OL}" stroke-width="3"/>
   <rect x="96" y="744" width="408" height="38" fill="#2a2118"/><rect x="274" y="738" width="52" height="50" rx="6" fill="#e3b341" stroke="${OL}" stroke-width="4"/>`;
  const torsoT=`
   <path d="M96 800 L108 570 Q120 466 232 446 L368 446 Q480 466 492 570 L504 800 Z" fill="${cloth}" stroke="${OL}" stroke-width="6" stroke-linejoin="round"/>
   <path d="M232 446 L300 548 L368 446 Z" fill="#f4f1ea" stroke="${OL}" stroke-width="5" stroke-linejoin="round"/>
   <path d="M288 470 h24 l10 92 -22 30 -22 -30z" fill="#8c2f39" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
   <path d="M232 446 L262 440 L300 470 L262 480Z M368 446 L338 440 L300 470 L338 480Z" fill="${clothD}" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
   <path d="M300 592 L300 800" stroke="${OL}" stroke-width="4" fill="none"/>
   <circle cx="284" cy="650" r="7" fill="#e8e2d2" stroke="${OL}" stroke-width="3"/><circle cx="284" cy="716" r="7" fill="#e8e2d2" stroke="${OL}" stroke-width="3"/>
   <rect x="150" y="640" width="92" height="58" rx="8" fill="${clothD}" stroke="${OL}" stroke-width="5"/><rect x="358" y="640" width="92" height="58" rx="8" fill="${clothD}" stroke="${OL}" stroke-width="5"/>`;
  const shoulder=(x,rot)=>`<g transform="translate(${x} 478) rotate(${rot})"><rect x="-44" y="-16" width="88" height="32" rx="6" fill="${clothD}" stroke="${OL}" stroke-width="5"/><path d="M-30 -6 h60 M-30 6 h60" stroke="#d9dde0" stroke-width="5" stroke-linecap="round"/></g>`;
  // Kompaniefeldwebel-Schnur: eine dicke geflochtene Schnur, unter der Schulterklappe befestigt, als Schlaufe um den Oberarm.
  const cord=(()=>{ const A=o.armL; if(!A) return "";
    const [sx,sy]=A.s,[ex,ey]=A.e, L=Math.hypot(ex-sx,ey-sy), dx=(ex-sx)/L, dy=(ey-sy)/L;
    let nx=-dy, ny=dx; if(nx*(sx-300)<0){nx=-nx;ny=-ny;}
    const P=(t,k)=>[sx+dx*L*t+nx*k, sy+dy*L*t+ny*k];
    const top=[150,466], a1=P(0.12,30), a2=P(0.50,40), low=P(0.62,6), b1=P(0.50,-30), b2=P(0.22,-34), end=[166,476];
    const d=`M${top} C${a1} ${a2} ${low} C${b1} ${b2} ${end}`;
    return `<path d="${d}" stroke="${OL}" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" stroke="#d9a520" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" stroke="#ffe27a" stroke-width="13" fill="none" stroke-dasharray="3 6" stroke-linecap="butt"/>
      <path d="${d}" stroke="#a87812" stroke-width="5" fill="none" stroke-dasharray="2 7" stroke-dashoffset="4.5"/>
      <rect x="128" y="458" width="52" height="22" rx="5" fill="#3f5029" stroke="${OL}" stroke-width="4" transform="rotate(-14 154 469)"/>`;
  })();
  // Arme: o.armL/o.armR = {s:[x,y], e:[x,y], h:[x,y], thumb, rot}
  const arm=A=>A?limb([A.s,A.e,A.h],64,cloth)+`<circle cx="${A.e[0]}" cy="${A.e[1]}" r="1" fill="none"/>`:"";
  const hand=A=>A?fist(A.h[0],A.h[1],skin,A.thumb||0,A.rot||0):"";
  const cuff=A=>A?`<circle cx="${lerp(A.e[0],A.h[0],.78)}" cy="${lerp(A.e[1],A.h[1],.78)}" r="1"/>`:"";
  const clip=o.clipboard?(([x,y])=>`<g transform="translate(${x-30} ${y-70}) rotate(-6)"><rect x="0" y="0" width="128" height="160" rx="10" fill="#9a6b3c" stroke="${OL}" stroke-width="5"/><rect x="12" y="20" width="104" height="128" rx="3" fill="#f7f3e8" stroke="${OL}" stroke-width="3"/><path d="M26 50 h60 M26 72 h76 M26 94 h52 M26 116 h70" stroke="#8a8f99" stroke-width="5" stroke-linecap="round"/><path d="M92 46 l8 8 14 -16" stroke="#2f8f4e" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M92 112 l18 14 M110 112 l-18 14" stroke="#c9342a" stroke-width="6" stroke-linecap="round"/><rect x="40" y="-10" width="48" height="24" rx="6" fill="#b8bec7" stroke="${OL}" stroke-width="4"/></g>`)(o.armL.h):"";
  const lens=o.magnifier?(([x,y])=>`<g transform="translate(${x} ${y}) rotate(${o.magRot||-20})"><rect x="-9" y="-90" width="18" height="80" rx="8" fill="#5a3d24" stroke="${OL}" stroke-width="5"/><circle cx="0" cy="-138" r="50" fill="#bfe3ff" fill-opacity=".35" stroke="${OL}" stroke-width="7"/><circle cx="0" cy="-138" r="43" fill="none" stroke="#c9ccd2" stroke-width="7"/><path d="M-22 -160 q10 -14 26 -14" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".8"/></g>`)(o.armR.h):"";
  return o.magnifier?`${T?torsoT:torso}${arm(o.armL)}${arm(o.armR)}${T?"":shoulder(146,-14)+shoulder(454,14)+cord}${clip}${hand(o.armL)}${head}${lens}${hand(o.armR)}`:`${T?torsoT:torso}${arm(o.armL)}${arm(o.armR)}${T?"":shoulder(146,-14)+shoulder(454,14)+cord}${clip}${hand(o.armL)}${hand(o.armR)}${head}`;
}

function wrap(inner,{sc=1,ty=0,tx=0,op=1,rot=0}){
  return `<g opacity="${op}" transform="translate(${300+tx} ${800+ty}) rotate(${rot}) scale(${sc}) translate(-300 -800)">${inner}</g>`;
}
function steamPuff(x,y,p,s){ // p 0..1
  const o=Math.sin(Math.PI*p)*.85;
  return `<circle cx="${x+Math.sin(p*7+s)*10}" cy="${y-p*130}" r="${12+p*26}" fill="#fff" opacity="${o}" stroke="#d6dde3" stroke-width="3"/>`;
}
function rays(cx,cy,pulse,t){
  const L=[[[150,228],[104,196]],[[138,300],[88,296]],[[150,372],[106,402]]], out=[];
  const k=0.55+0.45*pulse;
  for(const side of [1,-1])for(const [a,b] of L){
    const ax=300+side*(300-a[0])*-1, bx=300+side*(300-b[0])*-1;
    const x0=a[0]*(side===1?1:0)+(side===1?0:600-a[0]), x1=b[0]*(side===1?1:0)+(side===1?0:600-b[0]);
    const ex=x0+(x1-x0)*k, ey=a[1]+(b[1]-a[1])*k;
    out.push(`<path d="M${x0} ${a[1]} L${ex} ${ey}" stroke="${OL}" stroke-width="12" stroke-linecap="round"/><path d="M${x0} ${a[1]} L${ex} ${ey}" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`);
  }
  return out.join("");
}
function angerMark(x,y,s,rot){
  const P=["M-8 -26 Q-8 -8 -26 -8","M8 -26 Q8 -8 26 -8","M-8 26 Q-8 8 -26 8","M8 26 Q8 8 26 8"];
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><g stroke="${OL}" stroke-width="15" stroke-linecap="round" fill="none">${P.map(d=>`<path d="${d}"/>`).join("")}</g><g stroke="#e0301f" stroke-width="8" stroke-linecap="round" fill="none">${P.map(d=>`<path d="${d}"/>`).join("")}</g></g>`;
}

// ---- Szene: bestanden (5 s) ----
function passed(t){
  const pop=outBack(t/0.7), appear=ease(t/0.35), exit=0; // seit 8.9.1: kein Ausblenden im Clip
  const sc=lerp(0.6,1,pop)*lerp(1,0.92,exit), ty=lerp(90,0,ease(t/0.7))+60*exit, op=appear*(1-exit);
  const idle=Math.sin(t*2*Math.PI*1.1)*4*ease((t-0.7)/0.4);
  const up=ease((t-0.45)/0.75);
  const sh=[444,522], eRest=[512,640], hRest=[500,740], eUp=[552,586], hUp=[528,440];
  const pt=(a,b)=>[lerp(a[0],b[0],up),lerp(a[1],b[1],up)];
  const th=outBack((t-1.05)/0.35);
  const pulse=1+0.1*Math.max(0,Math.sin(Math.PI*((t-1.6)%0.9)/0.9))*(t>1.6?1:0);
  const hy=pt(hRest,hUp);
  const armR={s:sh,e:pt(eRest,eUp),h:[hy[0],hy[1]+idle*0.6],thumb:th,rot:lerp(0,8,up)};
  const armL={s:[156,522],e:[98,640],h:[178,712],thumb:0,rot:0};
  const sm=ease((t-0.3)/0.6);
  const body=spiess({armL,armR,smile:sm*1.0,open:sm*0.28,happyEyes:t>1.05?1:0,eyeOpen:1,brow:6*sm,blush:sm,anger:0});
  const stars=[[110,210,0],[500,190,1],[70,420,2],[545,330,3]].map(([x,y,i])=>{
    const k=clamp((t-1.2-i*0.18)/0.4), tw=0.75+0.25*Math.sin(t*6+i*2);
    return k>0&&exit<1?star(x,y,outBack(k)*tw*(0.8+0.2*(i%2)),t*40*(i%2?1:-1)):"";}).join("");
  const thumbGlow=th>0.5?"":"";
  return wrap(`<g transform="translate(0 ${idle})">${body}</g>`,{sc,ty,op})+ (op>0.02?`<g opacity="${op}">${stars}</g>`:"");
}

// ---- Szene: durchgefallen (6 s) ----
function caught(t){
  const pop=outBack(t/0.6), appear=ease(t/0.3), exit=0; // seit 8.9.1: kein Ausblenden im Clip
  const red=ease((t-0.5)/2.2), pulseRed=red*(0.9+0.1*Math.sin(t*9));
  const skin=mix("#f2c29b","#d92a1c",pulseRed);
  const ang=ease((t-0.25)/0.6);
  const shoutOn=t>1.0&&t<5.2;
  const cyc=Math.sin(2*Math.PI*3.0*(t-1.0));
  const open=shoutOn?0.3+0.6*(0.5+0.5*cyc):0.04+0.05*ang;
  const amp=ease((t-0.8)/1.4)*(t<5.3?1:0.3)*7;
  const sx=Math.sin(t*63)*amp, sy=Math.cos(t*51)*amp*0.6;
  const throb=shoutOn?1+0.035*(0.5+0.5*cyc):1;
  const sc=lerp(0.6,1,pop)*throb*lerp(1,0.9,exit), ty=lerp(90,0,ease(t/0.6))+60*exit, op=appear*(1-exit);
  const trem=Math.sin(t*70)*3*ang;
  const armL={s:[156,522],e:[70,560+trem],h:[118,452+trem],thumb:0,rot:-14};
  const armR={s:[444,522],e:[530,560-trem],h:[482,452-trem],thumb:0,rot:14};
  const hat=shoutOn?10*Math.max(0,cyc):0;
  const body=spiess({armL,armR,skin,anger:ang,open,frown:ang*(shoutOn?0:1),eyeOpen:lerp(1,0.78,ang),brow:0,hat,look:shoutOn?Math.sin(t*9)*0:0});
  let fx="";
  if(t>1.4&&exit<1){
    for(let i=0;i<5;i++){ const p=(((t-1.4)*0.9+i/5)%1); fx+=steamPuff(186,246,p,i)+steamPuff(414,246,p+0.0,i+9); }
    const mk=0.9+0.2*Math.sin(t*14);
    fx+=angerMark(420,150,mk*outBack((t-1.4)/0.3),12)+angerMark(150,175,0.7*mk*outBack((t-1.9)/0.3),-14);
  }
  const rayPulse=shoutOn?Math.max(0,cyc):0;
  const rayLayer=shoutOn?rays(300,300,rayPulse,t):"";
  return wrap(`<g transform="translate(${sx} ${sy})">${body}${fx}${rayLayer}</g>`,{sc,ty,op,rot:sx*0.12});
}

// ---- Männchen (Sprite) ----
const TEACH_COLORS=[["#3d5a80","#2c4263"],["#6a9955","#4d7340"],["#c0764a","#8f5233"],["#7a5aa6","#583e80"],["#2f8f9d","#216a75"],["#c2a33a","#8f7824"]];
const TEACH_HAIR=["#3b2a1d","#1f1f24","#d6b05a","#a9552b","#9a9ca3","#5a3b2a"];
const WALK_COLORS=[["#566b3a","#3f5029"],["#8a7a4f","#6b5d38"],["#4f6a85","#384e66"],["#8a3b35","#662a26"],["#2f7f78","#215a55"],["#b07a2a","#85591a"]];
function walker(phase,variant){
  const T=STYLE==="teacher";
  const [c,cd]=(T?TEACH_COLORS:WALK_COLORS)[variant%WALK_COLORS.length];
  const skin="#f2c29b", sw=Math.sin(phase), bob=Math.abs(Math.cos(phase))*-5;
  const hipx=62, hipy=106+bob, shx=62, shy=70+bob;
  const leg=(a)=>{const fx=hipx+Math.sin(a)*30, fy=hipy+48-Math.max(0,-Math.cos(a))*0; const kx=hipx+Math.sin(a)*14+ (a>0?4:0), ky=hipy+26; return `M${hipx} ${hipy} L${kx} ${ky} L${fx} ${hipy+48-Math.max(0,Math.sin(a+Math.PI/2))*0}`;};
  const lift=a=>Math.max(0,Math.cos(a))*8; // Fuß hebt sich beim Vorschwingen
  const legPath=(a)=>{const fx=hipx+Math.sin(a)*30, fy=hipy+50-Math.max(0,Math.sin(a+1.2))*0; return `M${hipx} ${hipy} L${(hipx+fx)/2} ${hipy+26} L${fx} ${fy-lift(a+Math.PI/2)*0.6}`;};
  const armPath=(a,l)=>{const hx=shx+Math.sin(a)*24, hy=shy+34-Math.abs(Math.sin(a))*3; return `M${shx} ${shy+4} L${hx} ${hy}`;};
  return `<g transform="translate(0 -14)">
    <path d="${legPath(phase+Math.PI)}" stroke="${OL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="${legPath(phase+Math.PI)}" stroke="${cd}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="${armPath(phase)}" stroke="${OL}" stroke-width="15" stroke-linecap="round" fill="none"/><path d="${armPath(phase)}" stroke="${cd}" stroke-width="8" stroke-linecap="round" fill="none"/>
    <rect x="44" y="${shy-8}" width="36" height="${hipy-shy+14}" rx="12" fill="${c}" stroke="${OL}" stroke-width="4"/>
    <rect x="34" y="${shy-4}" width="14" height="40" rx="6" fill="${cd}" stroke="${OL}" stroke-width="3.5"/>
    <path d="${legPath(phase)}" stroke="${OL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="${legPath(phase)}" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="${hipx+Math.sin(phase)*30+4}" cy="${hipy+50}" r="0"/>
    <circle cx="66" cy="${shy-26}" r="22" fill="${skin}" stroke="${OL}" stroke-width="4"/>
    <circle cx="74" cy="${shy-26}" r="3.2" fill="#2a1d12"/><path d="M68 ${shy-14} q8 6 15 0" stroke="${OL}" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${T?`<path d="M43 ${shy-26} C40 ${shy-56} 92 ${shy-58} 89 ${shy-26} C82 ${shy-40} 56 ${shy-42} 43 ${shy-26} Z" fill="${TEACH_HAIR[variant%TEACH_HAIR.length]}" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>`:`<path d="M42 ${shy-30} C42 ${shy-58} 90 ${shy-58} 90 ${shy-30} L92 ${shy-28} L40 ${shy-28} Z" fill="${cd}" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>`}
    <path d="${armPath(phase+Math.PI)}" stroke="${OL}" stroke-width="15" stroke-linecap="round" fill="none"/><path d="${armPath(phase+Math.PI)}" stroke="${c}" stroke-width="8" stroke-linecap="round" fill="none"/>
  </g>`;
}


// ---- Szene: Kontrolle (Schleife, 4 s, nahtlos) ----
function control(t){
  const P=4, w=2*Math.PI*t/P;
  const bob=Math.sin(2*w)*5, sway=Math.sin(w)*6;
  const look=Math.sin(w)*9;
  const ph=t%P, blink=(ph>1.9&&ph<2.06)?0.1:1;
  const mag=[496+Math.sin(w)*12,456+Math.cos(2*w)*8];
  const armR={s:[444,522],e:[556,590],h:mag,thumb:0,rot:-10};
  const armL={s:[156,522],e:[96,640],h:[196,640],thumb:0,rot:10};
  const body=spiess({armL,armR,clipboard:true,magnifier:true,magRot:8+Math.sin(w)*7,anger:0.18,frown:0.5,smile:0,open:0,eyeOpen:blink*0.85,look,brow:0});
  return wrap(`<g transform="translate(${sway} ${bob})">${body}</g>`,{sc:1,ty:0,op:1,rot:sway*0.25});
}
const DURATION={passed:5,caught:6,control:4};
function frameSvg(mode,t,style){
  STYLE=style==="teacher"?"teacher":"legacy";
  const inner=mode==="passed"?passed(t):mode==="control"?control(t):caught(t);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="fm" maskUnits="userSpaceOnUse" x="-100" y="-100" width="800" height="1000"><rect x="-100" y="-100" width="800" height="1000" fill="#fff"/><rect x="0" y="0" width="600" height="800" fill="url(#fg)"/><rect x="-100" y="-100" width="100" height="1000" fill="#fff"/><rect x="600" y="-100" width="100" height="1000" fill="#fff"/><rect x="-100" y="-100" width="800" height="100" fill="#fff"/></mask></defs><g mask="url(#fm)">${inner}</g></svg>`;
}
function walkerSvg(phase,variant,style){STYLE=style==="teacher"?"teacher":"legacy";return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">${walker(phase,variant)}</svg>`;}
const api={frameSvg,walkerSvg,DURATION};
if(typeof window!=="undefined")window.GameVerdict=api;
if(typeof module!=="undefined")module.exports=api;
})();
