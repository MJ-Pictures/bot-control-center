"use strict";
// Only a currently stored, explicit permission or global administrative status grants /admin.
// Discord guild role names are intentionally not considered.
function discordControlCenterAllowed(user){
  return !!(user && (user.globalOwner===true || user.globalAdmin===true || user.discordBackendEnabled===true));
}
module.exports={discordControlCenterAllowed};
