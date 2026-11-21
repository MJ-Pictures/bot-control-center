"use strict";
// 8.9.19 · Entkopplung Schritt 2: interne Adressen und Dienstnamen sind einstellbar.
// Die Dienste erreichen sich über Adressen im Docker-Netz. Bisher standen einige davon fest im
// Code; jetzt kommen sie aus der Umgebung, mit dem bisherigen Wert als Standard. Weil an diese
// Adressen das interne Dienst-Geheimnis gesendet wird, wird streng geprüft: nur http/https,
// keine Zugangsdaten, kein Pfad, keine Abfrage. Ein ungültiger Wert wird nicht verwendet.
function parseInternalBaseUrl(value){
  const raw=String(value??"").trim();
  if(!raw)return {ok:false,reason:"leer"};
  if(raw.length>200||/[\s\\]/.test(raw))return {ok:false,reason:"ungültige Zeichen"};
  let u;try{u=new URL(raw);}catch{return {ok:false,reason:"keine gültige Adresse"};}
  if(u.protocol!=="http:"&&u.protocol!=="https:")return {ok:false,reason:"nur http oder https"};
  if(u.username||u.password)return {ok:false,reason:"Zugangsdaten in der Adresse sind nicht erlaubt"};
  if(!u.hostname)return {ok:false,reason:"Hostname fehlt"};
  if((u.pathname&&u.pathname!=="/")||u.search||u.hash)return {ok:false,reason:"nur Basisadresse ohne Pfad"};
  return {ok:true,url:`${u.protocol}//${u.host}`};
}
// Liefert die eingestellte Basisadresse oder – wenn nichts oder Ungültiges eingestellt ist – den Standard.
function internalBaseUrl(value,fallback,{name="Adresse",warn=()=>{}}={}){
  const def=parseInternalBaseUrl(fallback);
  if(!def.ok)throw new Error(`Standardwert für ${name} ist ungültig.`);
  if(value===undefined||value===null||String(value).trim()==="")return def.url;
  const parsed=parseInternalBaseUrl(value);
  if(parsed.ok)return parsed.url;
  try{warn(`${name} ist ungültig (${parsed.reason}); es wird der Standard ${def.url} verwendet.`);}catch{}
  return def.url;
}
// Anzeigename eines Dienstes (nur für Statusausgaben): kurze, harmlose Zeichenfolge.
function serviceLabel(value,fallback){
  const raw=String(value??"").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(raw)?raw:String(fallback);
}
module.exports={parseInternalBaseUrl,internalBaseUrl,serviceLabel};
