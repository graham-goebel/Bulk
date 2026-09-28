/* Client for a JSON API behind a passcode, such as the Cloudflare Worker in worker/ (which talks to Notion).
   Plain script; load after ui/kit.js (it uses toast() for network trouble).

     API.configure({url, passKey})   the API's base address, and the localStorage key for the passcode.
                                     Also handles a sign-in link: …#key=PASSCODE stores it and cleans the address bar.
     passcode()                       the stored passcode ("" if none)
     api(path, body?)                 GET (or POST with a JSON body); resolves to the JSON reply. Rejects with
                                     {code, status, message}: code is the server's "error", or "network".
     apiRead(path)                    api() for reads, retried once after a network or server error
     keepStorage()                    asks the browser not to evict this site's storage
*/
const API=window.API=window.API||{url:"",passKey:"api-passcode"};
API.configure=function({url="",passKey=API.passKey}={}){
  API.url=String(url||"").replace(/\/+$/,"");API.passKey=passKey;
  // a sign-in link stores the passcode on this device, then the key is removed from the address bar
  const m=location.hash.match(/^#key=(.+)$/);
  if(m){try{localStorage.setItem(passKey,decodeURIComponent(m[1]))}catch(e){}keepStorage();history.replaceState(null,"",location.pathname+location.search)}
};
function passcode(){try{return localStorage.getItem(API.passKey)||""}catch(e){return ""}}
function keepStorage(){try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body){
  let res;
  try{res=await fetch(API.url+path,{method:body?"POST":"GET",headers:{"Content-Type":"application/json","X-Passcode":passcode()},body:body?JSON.stringify(body):undefined,cache:"no-store"})}
  catch(e){toast(navigator.onLine===false?"You're offline. Changes are kept on this device.":"Can't reach the server. Changes are kept on this device.",{kind:"error",key:"net",quiet:20000});throw {code:"network",message:"Can't reach the server."}}
  let data=null;try{data=await res.json()}catch(e){}
  if(!res.ok)throw {code:(data&&data.error)||("http_"+res.status),status:res.status,message:(data&&data.message)||""};
  return data;
}
async function apiRead(path){try{return await api(path)}catch(e){if(e.code==="network"||e.status>=500){await wait(1200+Math.random()*800);return api(path)}throw e}}
Object.assign(API,{passcode,api,apiRead,keepStorage});
