"use strict";

// N-2: Admin-Hierarchie. Wer Benutzer verwaltet, darf nur Ziele unterhalb der eigenen Stufe ändern
// und keine Stufe vergeben, die er selbst nicht besitzt.
//   owner (globalOwner / lokaler Admin)  → darf alles
//   admin (globalAdmin)                  → darf nur normale Benutzer verwalten (kein Admin, kein Owner)
function isOwnerActor(me){
  return !!(me&&(me.localAdmin===true||me.globalOwner===true||me.role==="owner"));
}
function isPrivilegedTarget(target){
  return !!(target&&(target.globalOwner===true||target.globalAdmin===true||target.role==="owner"||target.role==="admin"));
}
// newRole: optional – die Stufe, die dem Ziel zugewiesen werden soll.
function mayManageTarget(me,target,newRole){
  if(isOwnerActor(me))return {ok:true};
  if(isPrivilegedTarget(target))return {ok:false,error:"Nur Owner dürfen Administratoren und Owner ändern, deaktivieren oder entfernen."};
  const r=String(newRole||"").toLowerCase();
  if(r==="owner"||r==="admin")return {ok:false,error:"Nur Owner dürfen die Rollen Administrator oder Owner vergeben."};
  return {ok:true};
}
module.exports={isOwnerActor,isPrivilegedTarget,mayManageTarget};
