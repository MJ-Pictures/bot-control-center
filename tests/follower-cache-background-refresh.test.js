const appSource=require("./helpers/app-source");
const fs=require("fs"); const path=require("path");
const s=appSource();
if(!s.includes("Stale-while-revalidate")) throw new Error("stale-while-revalidate missing");
if(!s.includes("refreshFollowerCacheInBackground()")) throw new Error("background refresh helper missing");
if(!s.includes("cacheRefreshing:")) throw new Error("cache refresh status missing");
console.log("follower-cache-background-refresh.test.js: OK");
