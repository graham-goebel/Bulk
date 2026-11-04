/* ---------- Home: calendar and tasks ----------
   Today is the dashboard: the week, how many tasks are left and what to start with, the day's
   events on a timeline, what's on now, and the day's tasks and schedule side by side. Calendar lists the
   week; Tasks lists everything by when it's due. Tasks and events are kept on this device for now.
   Views register with sections.js through window.SECTION_VIEWS. */
const HOMEKEY="gf-home";
const CALS={Family:"#e5674a",Work:"#4c7be0",Kids:"#4bb07a"};
const LISTS={Home:"#ec8a3a",Errands:"#e3b21f",Work:"#4c7be0",Personal:"#d9579b",Health:"#3fae7a",Finance:"#8a6be0",Roland:"#a07650",Housekeeping:"#7b8794",Kids:"#4bb07a",Family:"#e5674a"};
const PRIS=[["","No priority"],["High","High"],["Medium","Medium"],["Low","Low"]];
const REPEATS=[["","Doesn't repeat"],["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]];
let home={tasks:[],events:[]},homeDay=0; // homeDay: days from today shown on Today
try{const v=JSON.parse(localStorage.getItem(HOMEKEY)||"null");if(v&&Array.isArray(v.tasks)&&Array.isArray(v.events))home=v}catch(e){}
// daily goals, each with a target and a step for its + button; the log keeps each day's progress
const GOAL_COLORS=["#3f8fe0","#3fae7a","#d9579b","#e3a21f","#8a6be0","#ec8a3a"];
if(!Array.isArray(home.goals))home.goals=[{id:"water",n:"Water",target:8,unit:"glasses",step:1,c:GOAL_COLORS[0]},{id:"walk",n:"Walking",target:8000,unit:"steps",step:1000,c:GOAL_COLORS[1]},
  {id:"skin",n:"Skincare",target:2,unit:"routines",step:1,c:GOAL_COLORS[2]},{id:"stretch",n:"Stretch",target:10,unit:"minutes",step:5,c:GOAL_COLORS[3]}];
if(!home.log||typeof home.log!=="object")home.log={};
// every save also sends changed tasks to Notion shortly after (fromSync: the sync's own saves)
const saveHome=fromSync=>{try{localStorage.setItem(HOMEKEY,JSON.stringify(home))}catch(e){}if(fromSync!==true&&typeof queueTaskPush==="function")queueTaskPush()};
const dISO=dt=>`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
const dayAt=k=>{const t=new Date();t.setHours(0,0,0,0);t.setDate(t.getDate()+k);return t};
const todayISO=()=>dISO(new Date());
const nowMins=()=>{const n=new Date();return n.getHours()*60+n.getMinutes()};
const dot=c=>`<i class="hm-dot" style="background:${c}"></i>`;
const repLabel=r=>(REPEATS.find(x=>x[0]===r)||["",""])[1];
const shortD=s=>new Date(s+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
function addPeriod(s,rep){const d=new Date(s+"T00:00:00");if(rep==="daily")d.setDate(d.getDate()+1);else if(rep==="weekly")d.setDate(d.getDate()+7);else if(rep==="monthly")d.setMonth(d.getMonth()+1);return dISO(d)}
const openTasks=()=>home.tasks.filter(t=>!t.done);
// linked calendars (an iCloud calendar's share link, read by the Worker): their events, kept on this device
const CALKEY="gf-calendars",FEED_COLORS=[["#e5674a","Coral"],["#4c7be0","Blue"],["#4bb07a","Green"],["#8a6be0","Purple"],["#e3a21f","Gold"],["#d9579b","Pink"],["#7b8794","Slate"]];
let cals={feeds:[],events:[],at:0,err:{}};
try{const v=JSON.parse(localStorage.getItem(CALKEY)||"null");if(v&&Array.isArray(v.feeds))cals={feeds:v.feeds,events:Array.isArray(v.events)?v.events:[],at:+v.at||0,err:v.err||{}}}catch(e){}
const saveCals=()=>{feedCache=null;try{localStorage.setItem(CALKEY,JSON.stringify(cals))}catch(e){}};
let feedCache=null;
const hm2=d=>`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
// a feed's events in the app's shape, in this device's time; an all-day event shows on each day it covers
function feedEvents(){if(feedCache)return feedCache;
  feedCache=cals.events.flatMap(ev=>{const f=cals.feeds.find(x=>x.id===ev.f);if(!f||f.off)return [];
    const base={n:ev.n,where:ev.where||"",cal:f.n,c:f.c,src:f.id};
    if(ev.allDay){const out=[];for(let d=ev.start;d<(ev.end||plusDays(ev.start,1))&&out.length<31;d=plusDays(d,1))out.push({...base,id:ev.id+"|"+d,date:d,allDay:true,start:"00:00",end:"",from:ev.start,to:plusDays(ev.end||plusDays(ev.start,1),-1)});return out}
    const a=new Date(ev.start),b=new Date(ev.end||ev.start);if(isNaN(a))return [];
    return [{...base,id:ev.id,date:dISO(a),start:hm2(a),end:dISO(b)===dISO(a)?hm2(b):"23:59"}]});
  return feedCache}
const allEvents=()=>home.events.concat(feedEvents());
const eventsOn=s=>allEvents().filter(e=>e.date===s).sort((a,b)=>(b.allDay?1:0)-(a.allDay?1:0)||a.start.localeCompare(b.start));
const timedOn=s=>eventsOn(s).filter(e=>!e.allDay);
const calColor=e=>e.c||CALS[e.cal]||"var(--muted)";
let calBusy=null;
async function refreshCals(force){
  if(!cals.feeds.length||!API.url||!passcode())return;if(!force&&Date.now()-cals.at<15*60e3)return;if(calBusy)return calBusy;
  calBusy=(async()=>{try{
      const r=await api("/calendar",{urls:cals.feeds.map(f=>f.url),from:dISO(dayAt(-14)),to:dISO(dayAt(90))});const evs=[];cals.err={};
      (r.feeds||[]).forEach((x,i)=>{const f=cals.feeds[i];if(!f)return;
        if(x.error){cals.err[f.id]=x.error;evs.push(...cals.events.filter(e=>e.f===f.id))}
        else{if(x.name&&!f.named)f.n=x.name;evs.push(...x.events.map(e=>({...e,f:f.id})))}});
      cals.events=evs;cals.at=Date.now();saveCals();
      if(force)toast(Object.keys(cals.err).length?"Some calendars couldn't be read":"Calendars up to date",{kind:Object.keys(cals.err).length?"error":"ok",key:"cal",icon:"cal"});
    }catch(e){if(force)toast(e.code==="bad_passcode"?"Add your Notion passcode in Settings first":"Couldn't reach your calendars",{kind:"error",key:"cal",icon:"cal"})}
    finally{calBusy=null;renderCalSettings();if(document.body.dataset.sec==="home"&&$("sheet").hidden)renderSection(secOf("home"))}})();
  return calBusy}
setTimeout(()=>refreshCals(),2000);setInterval(()=>{if(document.visibilityState==="visible")refreshCals()},5*60e3);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshCals()});
const tasksOn=s=>openTasks().filter(t=>t.due&&(t.due===s||(s===todayISO()&&t.due<s))).sort((a,b)=>a.due.localeCompare(b.due)||(a.at||"99").localeCompare(b.at||"99"));
// follow-ups: checking a task off brings it back after a few days (every time) or once on a date
const FOLLOWS=[["","No follow-up"],["days","Every few days"],["date","Once, on a date"]];
const plusDays=(s,n)=>{const d=new Date(s+"T00:00:00");d.setDate(d.getDate()+n);return dISO(d)};
const fuLabel=t=>t.fu==="days"?`Every ${t.fuN===1?"day":`${t.fuN||3} days`}`:t.fu==="date"&&t.fuOn?`Again ${shortD(t.fuOn)}`:"";

// sample data, shaped like a real week, for trying it out
// the switch in Settings → Sample data turns samples off for good on this device
const samplesOff=()=>{try{return localStorage.getItem("gf-samples-off")==="1"}catch(e){return false}};
function sampleHome(){if(samplesOff())return;const T=dISO(dayAt(0)),P=dISO(dayAt(-2)),id=()=>uid();
  home={...home,tasks:[{id:id(),n:"Pay water bill",due:P,list:"Home",rep:"monthly"},{id:id(),n:"Pick up dry cleaning",due:T,list:"Errands",rep:""},
    {id:id(),n:"Water the plants",due:T,list:"Home",rep:"daily"},{id:id(),n:"Send project update",due:T,list:"Work",rep:"weekly"},{id:id(),n:"Book flights for December",due:"",list:"Personal",rep:""},
    {id:id(),n:"Follow up with landlord about the sink",due:T,at:"16:00",list:"Home",rep:"",fu:"days",fuN:3,fuCount:1}],
    events:[{id:id(),n:"Standup",date:T,start:"09:00",end:"09:15",cal:"Work",where:""},{id:id(),n:"Dentist",date:T,start:"14:00",end:"15:00",cal:"Family",where:"Main St"},
    {id:id(),n:"Soccer practice",date:T,start:"17:30",end:"18:30",cal:"Kids",where:""},{id:id(),n:"Team review",date:dISO(dayAt(1)),start:"11:00",end:"12:00",cal:"Work",where:""},
    {id:id(),n:"Family dinner",date:dISO(dayAt(3)),start:"18:30",end:"20:00",cal:"Family",where:""}]};
  home.tasks.forEach(t=>t.sample=1);home.events.forEach(e=>e.sample=1);saveHome()}
// sample items: flagged ones, and ones from before the flag (known by name)
const SAMPLE_TASKS=["Pay water bill","Pick up dry cleaning","Water the plants","Send project update","Book flights for December","Follow up with landlord about the sink"];
const SAMPLE_EVENTS=["Standup","Dentist","Soccer practice","Team review","Family dinner"];
if(/(^|[?&])demo\b/.test(location.search)&&!samplesOff()&&!home.tasks.length&&!home.events.length)sampleHome();

// The week under the header, like the meal planner's: picking a day shows it (Today) or starts the list there (Calendar).
function weekStrip(){return `<nav class="strip narrow hm-strip" aria-label="Days">${[0,1,2,3,4,5,6].map(k=>{const d=dayAt(k),s=dISO(d),has=eventsOn(s).length||tasksOn(s).length;
  return `<button data-k="${k}" aria-pressed="${k===homeDay}"${k===0?' class="today"':""}><span>${d.toLocaleDateString("en-US",{weekday:"short"})}</span><b>${d.getDate()}</b>${has?'<i class="has"></i>':""}</button>`}).join("")}</nav>`}
function bindStrip(root,again){root.querySelectorAll(".hm-strip [data-k]").forEach(b=>b.onclick=()=>{homeDay=+b.dataset.k;again()})}
/* ---------- Today ---------- */
function homeToday(body){refreshCals();syncTasks();
  const day=dayAt(homeDay),S=dISO(day),isT=homeDay===0,now=nowMins();
  const evs=eventsOn(S),due=tasksOn(S),any=isT?openTasks().filter(t=>!t.due):[],T=todayISO();
  const overdue=isT?due.filter(t=>t.due<T):[],left=due.length+any.length;
  const tev=evs.filter(e=>!e.allDay),cur=isT?tev.find(e=>mins(e.start)<=now&&now<mins(e.end||e.start)):null,next=isT?tev.find(e=>mins(e.start)>now):null;
  // the sentence: what's overdue, else what's first
  const first=overdue[0]||due[0]||any[0];
  const say=!left?`Nothing to do${isT?" today":""}. <span class="hm-mute">Enjoy the space.</span>`
    :overdue.length?`You have <em>${overdue.length} overdue task${overdue.length>1?"s":""}</em>. Start with ${esc(first.n)}.`
    :`${left} task${left>1?"s":""} ${isT?"today":"on "+day.toLocaleDateString("en-US",{weekday:"long"})}. Start with ${esc(first.n)}.`;
  const nowCard=cur?`<p class="hm-now-t">${esc(cur.n)} started ${ago(now-mins(cur.start))}.</p><p class="hm-now-s">It runs until <b>${fmtTime(cur.end||cur.start)}</b>. ${left} task${left===1?"":"s"} still open today.</p>`
    :next?`<p class="hm-now-t">Next up: ${esc(next.n)} at ${fmtTime(next.start)}.</p><p class="hm-now-s">In ${ago(mins(next.start)-now,true)}. ${left} task${left===1?"":"s"} open today.</p>`
    :isT?`<p class="hm-now-t">No more events today.</p><p class="hm-now-s">${left} task${left===1?"":"s"} open.</p>`:"";
  // the count and the sentence lead, then the day on a line with what's on now, then three columns:
  // tasks, schedule and goals
  body.innerHTML=`
    ${weekStrip()}
    <div class="hm-page narrow">
    <div class="hm-hero">
      <div class="hm-lead"><p class="hm-count"><b>${left}</b> task${left===1?"":"s"} to do</p><p class="hm-say">${say}</p></div>
      <div class="hm-day-now">${timeline(tev,isT?now:null)}${nowCard?`<div class="hm-now">${nowCard}</div>`:""}${isT?foodLine():""}</div>
    </div>
    <div class="hm-rh"><h2>${isT?"Today":day.toLocaleDateString("en-US",{weekday:"long"})}</h2><span>${evs.length} event${evs.length===1?"":"s"} and ${left} task${left===1?"":"s"}</span></div>
    <div class="hm-panels">
      <section class="hm-panel"><h3>Tasks</h3>${due.length||any.length?due.map(taskRow).join(""):`<p class="hint">No tasks due.</p>`}
        ${any.length?`<h3 class="hm-sub">Anytime</h3>${any.map(taskRow).join("")}`:""}</section>
      <section class="hm-panel"><h3>Schedule</h3>${evs.length?evs.map(e=>eventRow(e,isT&&e===cur)).join(""):`<p class="hint">Nothing scheduled.</p>`}</section>
      <section class="hm-panel"><h3>Goals<span>${goalsMet(S)} of ${home.goals.length} done</span></h3>${home.goals.map(g=>goalRow(g,S)).join("")||`<p class="hint">No goals yet. Add one with +.</p>`}</section>
    </div>
    ${!home.tasks.length&&!home.events.length&&!samplesOff()?`<p class="hint hm-sample">New here? <button class="txt" id="hmSample">Fill in a sample week</button> to see how it works.</p>`:""}</div>`;
  bindStrip(body,()=>homeToday(body));
  bindRows(body,()=>homeToday(body));bindGoals(body,S,()=>homeToday(body));
  const fl=body.querySelector(".hm-food");if(fl)fl.onclick=()=>showSection("food");
  if($("hmSample"))$("hmSample").onclick=()=>{sampleHome();homeToday(body)};
}
function ago(m,future){m=Math.max(0,Math.round(m));const h=Math.floor(m/60),r=m%60;const t=h?`${h} hour${h>1?"s":""}${r?` ${r} minute${r>1?"s":""}`:""}`:`${r} minute${r===1?"":"s"}`;return future?t:t+" ago"}
// the day's events on a line from 7 AM to 10 PM, with a mark for now
function timeline(evs,now){const A=7*60,B=22*60,pc=m=>`${((Math.min(B,Math.max(A,m))-A)/(B-A)*100).toFixed(2)}%`;
  return `<div class="hm-tl"><div class="hm-tl-line">${[9,12,15,18,21].map(h=>`<i class="tk" style="left:${pc(h*60)}"></i><span class="tl" style="left:${pc(h*60)}">${h%12||12} ${h<12?"AM":"PM"}</span>`).join("")}
    ${evs.map(e=>`<button class="mk${now!=null&&mins(e.start)<=now&&now<mins(e.end||e.start)?" cur":""}" data-ev="${esc(e.id)}" style="left:${pc(mins(e.start))};--c:${calColor(e)}" aria-label="${esc(e.n)} at ${fmtTime(e.start)}"></button><span class="ml" style="left:${pc(mins(e.start))}">${esc(e.n)}</span>`).join("")}
    ${now!=null&&now>=A&&now<=B?`<i class="nw" style="left:${pc(now)}"></i>`:""}</div></div>`}
// food, from the meal planner
function foodLine(){let d=state.days.findIndex((_,k)=>isToday(k));if(d<0)return "";
  const ms=mealsOf(d),eaten=ms.filter(m=>m.done).reduce((a,m)=>a+m.o.k,0),n=nowMins(),nx=ms.find(m=>!m.done&&!m.missed&&!m.o.skip&&mins(m.time)>=n-30);
  return `<button class="hm-food"><svg class="ic" aria-hidden="true"><use href="#i-apple"/></svg><span><b>${fmt(eaten)}</b> of ${fmt(state.target)} calories${nx?` · next, ${esc(nx.o.n)} at ${fmtTime(nx.time)}`:""}</span></button>`}
function taskRow(t){const T=todayISO(),late=t.due&&t.due<T,when=[t.due&&t.due!==T?shortD(t.due):"",t.at?fmtTime(t.at):""].filter(Boolean).join(", ");
  const meta=[when?(late?`<span class="late">${when}</span>`:when):"",`${dot(LISTS[t.list]||"var(--muted)")}${esc(t.list||"")}`,t.rep&&!t.fu?`<svg class="ic" aria-hidden="true"><use href="#i-syncl"/></svg>${repLabel(t.rep)}`:"",
    t.fu?`<svg class="ic" aria-hidden="true"><use href="#i-bell"/></svg>${fuLabel(t)}`:"",t.fuCount?`followed up ${t.fuCount}×`:"",t.pri==="High"?`<span class="late">High priority</span>`:""].filter(Boolean);
  return `<div class="hm-task"><button class="hm-check" data-done="${t.id}" aria-label="Complete ${esc(t.n)}"></button><button class="hm-tx" data-task="${t.id}"><span class="nm">${esc(t.n)}</span><span class="mt">${meta.join('<span class="sep">·</span>')}</span></button></div>`}
function eventRow(e,cur){return `<button class="hm-ev${cur?" cur":""}" data-ev="${esc(e.id)}"><span class="tm">${e.allDay?"<b>All day</b>":`<b>${fmtTime(e.start)}</b>${cur?"Now":e.end?fmtTime(e.end):""}`}</span><span class="nm">${dot(calColor(e))}<span>${esc(e.n)}${e.where?`<small>${esc(e.where)}</small>`:""}</span></span></button>`}
function bindRows(root,again){
  root.querySelectorAll("[data-done]").forEach(b=>b.onclick=()=>completeTask(b.dataset.done,again));
  root.querySelectorAll("[data-task]").forEach(b=>b.onclick=()=>viewTask(home.tasks.find(t=>t.id===b.dataset.task),again));
  root.querySelectorAll("[data-ev]").forEach(b=>b.onclick=()=>viewEvent(allEvents().find(e=>e.id===b.dataset.ev),again));
}
// Done: a follow-up comes back after its days (or on its date, once); a repeating task moves to its
// next date; anything else is done. Undo puts it back either way. "Done for good" in the task's sheet ends a follow-up.
function completeTask(id,again){const t=home.tasks.find(x=>x.id===id);if(!t)return;const before={...t},T=todayISO();let say;
  if(t.fu==="days"){t.due=plusDays(T,Math.max(1,t.fuN||3));t.fuCount=(t.fuCount||0)+1;t.fuLast=T;delete t.reminded;say=`Following up ${shortD(t.due)}`}
  else if(t.fu==="date"&&t.fuOn&&t.fuOn>T){t.due=t.fuOn;t.fu="";t.fuCount=(t.fuCount||0)+1;t.fuLast=T;delete t.reminded;say=`Following up ${shortD(t.due)}`}
  else if(t.rep&&t.due){t.due=addPeriod(t.due<T?T:t.due,t.rep);delete t.reminded;say=`${t.n}: next on ${shortD(t.due)}`}
  else{t.done=true;say=`Done: ${t.n}`}
  saveHome();again();
  toast(say,{kind:"ok",key:"task",icon:t.done?"okl":"bell",action:"Undo",ms:6000,onAction:()=>{Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,before);saveHome();again()}})}
// reminders: when a task's time comes (and the app is open), a toast says so, once
function remindTasks(){if(document.visibilityState!=="visible")return;const T=todayISO(),n=nowMins();
  openTasks().filter(t=>t.at&&t.due&&t.due<=T&&(t.due<T||mins(t.at)<=n)&&t.reminded!==t.due+" "+t.at).slice(0,3).forEach(t=>{t.reminded=t.due+" "+t.at;saveHome();
    toast(`${t.fu||t.fuCount?"Follow up":"Reminder"}: ${t.n}`,{key:"remind-"+t.id,icon:"bell",ms:12000,action:"Done",onAction:()=>completeTask(t.id,()=>{if(document.body.dataset.sec==="home")renderSection(secOf("home"))})})})}
setTimeout(remindTasks,1500);setInterval(remindTasks,30000);document.addEventListener("visibilitychange",remindTasks);

/* ---------- goals ---------- */
const goalVal=(g,s)=>+((home.log[s]||{})[g.id]||0);
const goalsMet=s=>home.goals.filter(g=>goalVal(g,s)>=g.target).length;
const gfmt=n=>n>=1000?fmt(n):+(+n).toFixed(1);
function goalRow(g,s){const v=goalVal(g,s),p=Math.min(1,g.target?v/g.target:0),done=v>=g.target;
  return `<div class="hm-goal${done?" done":""}" style="--c:${g.c||"var(--ink)"}"><button class="hm-gx" data-goal="${g.id}"><span class="nm">${esc(g.n)}</span><span class="mt"><b>${gfmt(v)}</b> of ${gfmt(g.target)} ${esc(g.unit||"")}</span>
    <span class="hm-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${v}"><i style="width:${(p*100).toFixed(1)}%"></i></span></button>
    <button class="hm-gb" data-gminus="${g.id}" aria-label="Less ${esc(g.n)}"${v<=0?" disabled":""}>−</button><button class="hm-gb plus" data-gplus="${g.id}" aria-label="More ${esc(g.n)}">+</button></div>`}
function bumpGoal(g,s,dir){const day=home.log[s]=home.log[s]||{},was=+(day[g.id]||0);
  day[g.id]=Math.max(0,+(was+dir*(g.step||1)).toFixed(2));saveHome();
  if(dir>0&&was<g.target&&day[g.id]>=g.target)toast(`${g.n}: done for the day`,{kind:"ok",key:"goal",icon:"okl"})}
function bindGoals(root,s,again){
  const bump=(id,dir)=>{const g=home.goals.find(x=>x.id===id);if(!g)return;bumpGoal(g,s,dir);again()};
  root.querySelectorAll("[data-gplus]").forEach(b=>b.onclick=()=>bump(b.dataset.gplus,1));
  root.querySelectorAll("[data-gminus]").forEach(b=>b.onclick=()=>bump(b.dataset.gminus,-1));
  root.querySelectorAll("[data-goal]").forEach(b=>b.onclick=()=>viewGoal(home.goals.find(g=>g.id===b.dataset.goal),s,again));
}
function editGoal(g,again,back){const v=g||{n:"",target:1,unit:"",step:1};
  formSheet(g?"Edit goal":"New goal",`<label for="hmName">Goal</label><input id="hmName" type="text" maxlength="40" value="${esc(v.n)}" placeholder="e.g. Read">
    <label for="hmTarget">Each day</label><input id="hmTarget" type="number" min="0" step="any" inputmode="decimal" value="${v.target}">
    <label for="hmUnit">Unit</label><input id="hmUnit" type="text" maxlength="20" value="${esc(v.unit||"")}" placeholder="e.g. pages">
    <label for="hmStep">Each tap adds</label><input id="hmStep" type="number" min="0" step="any" inputmode="decimal" value="${v.step||1}">`,
    ()=>{const x={n:$("hmName").value.trim(),target:Math.max(0,+$("hmTarget").value||1),unit:$("hmUnit").value.trim(),step:Math.max(0.1,+$("hmStep").value||1)};
      if(g)Object.assign(g,x);else home.goals.push({id:uid(),c:GOAL_COLORS[home.goals.length%GOAL_COLORS.length],...x});toast(g?"Goal saved":`Added ${x.n}`,{kind:"ok",key:"goal",icon:"okl"});again()},null,[],back)}
function deleteGoal(g,again){const k=home.goals.indexOf(g);home.goals=home.goals.filter(x=>x!==g);saveHome();again();
  toast(`Deleted ${g.n}`,{kind:"removed",key:"goal",action:"Undo",ms:6000,onAction:()=>{home.goals.splice(k,0,g);saveHome();again()}})}

/* ---------- adding and editing ---------- */
// A form in the sheet. Opened from an item's sheet (back), it has a back arrow and returns there on Save.
// Only a new item's name is focused (and not on touch screens), so nothing opens straight into typing.
function formSheet(title,html,onSave,onDelete,acts=[],back=null){
  if($("sheet").hidden){sheetFocus=document.activeElement;$("sheetBox").style.height=""}else holdSize();sheetCtx=null;
  $("sheetBox").innerHTML=`${sheetHead("",title,{action:{id:"hmSave",label:"Save"}})}<div class="pf">${html}</div>`;
  showBg($("sheet"));resetSheet($("sheetBox"));document.body.style.overflow="hidden";
  // a form is usually longer than the sheet it came from: let it grow
  if(back)requestAnimationFrame(()=>{$("sheetBox").style.height=""});
  if(back)backBtn(back);else{const c=$("shClose");c.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg>';c.setAttribute("aria-label","Close");c.onclick=closeDetail}
  const name=$("hmName"),need=()=>{$("hmSave").disabled=!name.value.trim()};name.addEventListener("input",need);need();
  $("hmSave").onclick=()=>{if(!name.value.trim())return;onSave();saveHome();if(back){sheetBacking=true;try{back()}finally{sheetBacking=false}}else closeDetail()};
  const all=acts.map(([i,l,f])=>[i,l,()=>{f();saveHome();closeDetail()}]);if(onDelete)all.push(["trashl","Delete",()=>{onDelete();saveHome();closeDetail()}]);if(all.length)sheetActs(all);
  if(!touchUI&&!back&&!name.value)name.focus();
}
// An item's own sheet: what it is, with its actions (Edit among them) along the bottom.
function viewSheet(kicker,title,rows,acts,extra=""){
  if($("sheet").hidden){sheetFocus=document.activeElement;$("sheetBox").style.height=""}else holdSize();sheetCtx=null;
  $("sheetBox").innerHTML=`${sheetHead(kicker,esc(title))}${extra}<ul class="ing hm-info">${rows.filter(r=>r&&r[1]!=null&&r[1]!=="").map(([l,v])=>`<li><span>${l}</span><span class="q">${v}</span></li>`).join("")}</ul>`;
  showBg($("sheet"));resetSheet($("sheetBox"));document.body.style.overflow="hidden";
  const c=$("shClose");c.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-x"/></svg>';c.setAttribute("aria-label","Close");c.onclick=closeDetail;
  sheetActs(acts);
}
const kick=(c,t)=>`${dot(c)}${esc(t)}`;
function viewTask(t,again){if(!t)return;const T=todayISO(),re=()=>viewTask(t,again),late=t.due&&t.due<T&&!t.done;
  viewSheet(kick(LISTS[t.list]||"var(--muted)",t.list||"Task"),t.n,[
    ["Due",t.due?`<span class="${late?"late":""}">${t.due===T?"Today":shortD(t.due)}</span>`:"Anytime"],["Remind at",t.at?fmtTime(t.at):""],
    ["Repeats",t.rep?repLabel(t.rep):""],["Follow up",t.fu?esc(fuLabel(t)):""],
    ["Followed up",t.fuCount?`${t.fuCount} time${t.fuCount>1?"s":""}${t.fuLast?`, last ${shortD(t.fuLast)}`:""}`:""],["Priority",t.pri||""],["Notes",esc(t.notes||"")],["Status",t.done?"Done":""]],
    [t.done?["syncl","Reopen",()=>{t.done=false;saveHome();again();re()}]:["okl",t.fu||t.rep?"Check off":"Complete",()=>{closeDetail();completeTask(t.id,again)}],
     ["edit","Edit",()=>editTask(t,again,{},re)],
     !t.done&&(t.fu||t.rep)?["lock","Done for good",()=>{const before={...t};t.done=true;saveHome();closeDetail();again();
       toast(`Done: ${t.n}`,{kind:"ok",key:"task",icon:"okl",action:"Undo",ms:6000,onAction:()=>{Object.assign(t,before);t.done=false;saveHome();again()}})}]:null,
     ["trashl","Delete",()=>{closeDetail();deleteTask(t,again)}]]);
}
function deleteTask(t,again){home.tasks=home.tasks.filter(x=>x!==t);saveHome();again();
  toast(`Deleted ${t.n}`,{kind:"removed",key:"task",action:"Undo",ms:6000,onAction:()=>{home.tasks.push(t);saveHome();again()}})}
function viewEvent(e,again){if(!e)return;const re=()=>viewEvent(allEvents().find(x=>x.id===e.id)||e,again);
  const when=e.allDay?(e.from&&e.to&&e.from!==e.to?`${shortD(e.from)} – ${shortD(e.to)}`:`${shortD(e.date)}, all day`):`${shortD(e.date)}, ${fmtTime(e.start)}${e.end?` – ${fmtTime(e.end)}`:""}`;
  const feed=e.src&&cals.feeds.find(f=>f.id===e.src);
  viewSheet(kick(calColor(e),e.cal||"Event"),e.n,[["When",when],["Where",esc(e.where||"")],["Calendar",feed?`${esc(feed.n)} <span class="hm-mute">· linked, read only</span>`:esc(e.cal||"")]],
    [["bell","Follow-up task",()=>editTask(null,again,{n:`Follow up: ${e.n}`,due:plusDays(e.date,1),list:"Work",fu:"days",fuN:3},re)],
     e.src?null:["edit","Edit",()=>editEvent(e,again,re)],
     e.src?null:["trashl","Delete",()=>{closeDetail();home.events=home.events.filter(x=>x!==e);saveHome();again();
       toast(`Deleted ${e.n}`,{kind:"removed",key:"event",action:"Undo",ms:6000,onAction:()=>{home.events.push(e);saveHome();again()}})}]]);
}
function viewGoal(g,s,again){if(!g)return;const re=()=>viewGoal(g,s,again),v=goalVal(g,s),u=esc(g.unit||"");
  const week=Array.from({length:7},(_,j)=>{const d=new Date(s+"T00:00:00");d.setDate(d.getDate()-6+j);const k=dISO(d),x=goalVal(g,k);return {k,x,p:Math.min(1,g.target?x/g.target:0),d}});
  const bars=`<div class="hm-week" style="--c:${g.c||"var(--ink)"}" aria-label="The last 7 days">${week.map(w=>`<span class="${w.p>=1?"met":""}" title="${esc(shortD(w.k))}: ${gfmt(w.x)} ${u}"><b><i style="height:${(w.p*100).toFixed(0)}%"></i></b><small>${w.d.toLocaleDateString("en-US",{weekday:"narrow"})}</small></span>`).join("")}</div>`;
  viewSheet(kick(g.c||"var(--ink)",s===todayISO()?"Today":shortD(s)),g.n,[["Progress",`<b>${gfmt(v)}</b> of ${gfmt(g.target)} ${u}`],["Each tap adds",`${gfmt(g.step||1)} ${u}`],
    ["Last 7 days",`met ${week.filter(w=>w.p>=1).length} of 7 days`]],
    [["plusl",`Add ${gfmt(g.step||1)}`,()=>{bumpGoal(g,s,1);again();re()}],v>0?["downl",`Take off ${gfmt(g.step||1)}`,()=>{bumpGoal(g,s,-1);again();re()}]:null,
     ["edit","Edit",()=>editGoal(g,again,re)],["trashl","Delete",()=>{closeDetail();deleteGoal(g,again)}]],bars);
}
const hmOpts=(list,sel)=>list.map(([v,l])=>`<option value="${esc(v)}"${v===sel?" selected":""}>${esc(l)}</option>`).join("");
function editTask(t,again,pre={},back=null){const v=t||{n:"",due:dISO(dayAt(homeDay)),list:"Home",rep:"",...pre};
  formSheet(t?"Edit task":"New task",`<label for="hmName">Task</label><input id="hmName" type="text" maxlength="120" value="${esc(v.n)}" placeholder="e.g. Pay water bill">
    <label for="hmDue">Due</label><input id="hmDue" type="date" value="${esc(v.due||"")}">
    <label for="hmAt">Remind at</label><input id="hmAt" type="time" step="300" value="${esc(v.at||"")}">
    <label for="hmList">List</label><select id="hmList">${hmOpts([...new Set([...Object.keys(LISTS),...home.tasks.map(x=>x.list).filter(Boolean)])].map(k=>[k,k]),v.list)}</select>
    <label for="hmPri">Priority</label><select id="hmPri">${hmOpts(PRIS,v.pri||"")}</select>
    <label for="hmRep">Repeats</label><select id="hmRep">${hmOpts(REPEATS,v.rep)}</select>
    <label for="hmFu">Follow up</label><select id="hmFu">${hmOpts(FOLLOWS,v.fu||"")}</select>
    <div class="pf-row" id="hmFuDays"><label for="hmFuN">After</label><span class="qty"><input id="hmFuN" type="number" min="1" max="365" inputmode="numeric" value="${v.fuN||3}"> days, each time</span></div>
    <div class="pf-row" id="hmFuDate"><label for="hmFuOn">On</label><input id="hmFuOn" type="date" value="${esc(v.fuOn||plusDays(v.due||todayISO(),7))}"></div>
    <p class="hint pf-note" id="hmFuNote"></p>
    <label for="hmNotes">Notes</label><input id="hmNotes" type="text" maxlength="500" value="${esc(v.notes||"")}" placeholder="Optional">
    ${t&&t.fuCount?`<p class="hint pf-note">Followed up ${t.fuCount} time${t.fuCount>1?"s":""}${t.fuLast?`, last on ${shortD(t.fuLast)}`:""}.</p>`:""}`,
    ()=>{const fu=$("hmFu").value,x={n:$("hmName").value.trim(),due:$("hmDue").value||"",at:$("hmAt").value||"",list:$("hmList").value,pri:$("hmPri").value,notes:$("hmNotes").value.trim(),rep:$("hmRep").value,fu,
        fuN:Math.min(365,Math.max(1,Math.round(+$("hmFuN").value||3))),fuOn:fu==="date"?$("hmFuOn").value||"":""};
      if(fu&&!x.due)x.due=todayISO();if(!x.at||x.at!==(t&&t.at)||x.due!==(t&&t.due))x.reminded="";
      if(t)Object.assign(t,x);else home.tasks.push({id:uid(),...x});toast(t?"Task saved":`Added ${x.n}`,{kind:"ok",key:"task",icon:"okl"});again()},
    null,[],back);
  const sync=()=>{const f=$("hmFu").value,n=Math.max(1,Math.round(+$("hmFuN").value||3));$("hmFuDays").hidden=f!=="days";$("hmFuDate").hidden=f!=="date";
    $("hmFuNote").textContent=f==="days"?`Checking it off brings it back ${n===1?"tomorrow":`in ${n} days`}, until you mark it done for good.`:f==="date"?"Checking it off brings it back once, on that date.":"";$("hmFuNote").hidden=!f};
  $("hmFu").onchange=sync;$("hmFuN").oninput=sync;sync()}
function editEvent(e,again,back=null){const v=e||{n:"",date:dISO(dayAt(homeDay)),start:"09:00",end:"10:00",cal:"Family",where:""};
  formSheet(e?"Edit event":"New event",`<label for="hmName">Event</label><input id="hmName" type="text" maxlength="120" value="${esc(v.n)}" placeholder="e.g. Dentist">
    <label for="hmDate">Date</label><input id="hmDate" type="date" value="${esc(v.date)}">
    <label for="hmStart">Starts</label><input id="hmStart" type="time" step="300" value="${esc(v.start)}">
    <label for="hmEnd">Ends</label><input id="hmEnd" type="time" step="300" value="${esc(v.end||"")}">
    <label for="hmCal">Calendar</label><select id="hmCal">${hmOpts(Object.keys(CALS).map(k=>[k,k]),v.cal)}</select>
    <label for="hmWhere">Where</label><input id="hmWhere" type="text" maxlength="80" value="${esc(v.where||"")}" placeholder="Optional">`,
    ()=>{const x={n:$("hmName").value.trim(),date:$("hmDate").value||todayISO(),start:$("hmStart").value||"09:00",end:$("hmEnd").value||"",cal:$("hmCal").value,where:$("hmWhere").value.trim()};
      if(x.end&&x.end<x.start)x.end=x.start;if(e)Object.assign(e,x);else home.events.push({id:uid(),...x});toast(e?"Event saved":`Added ${x.n}`,{kind:"ok",key:"event",icon:"cal"});again()},
    null,[],back);
}

/* ---------- Calendar: the next two weeks, day by day ---------- */
function homeCalendar(body){refreshCals();const again=()=>homeCalendar(body);
  body.innerHTML=weekStrip()+`<div class="hm-page narrow"><div class="hm-legend">${Object.entries(CALS).map(([n,c])=>`<span>${dot(c)}${n}</span>`).join("")}${cals.feeds.filter(f=>!f.off).map(f=>`<span>${dot(f.c)}${esc(f.n)}</span>`).join("")}</div>`+
    Array.from({length:14},(_,j)=>{const k=homeDay+j,d=dayAt(k),s=dISO(d),evs=eventsOn(s),ts=k?openTasks().filter(t=>t.due===s):tasksOn(s);
      return `<section class="hm-day"><h3>${k===0?"Today":k===1?"Tomorrow":d.toLocaleDateString("en-US",{weekday:"long"})}<span>${d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></h3>
        ${evs.map(e=>eventRow(e,false)).join("")}${ts.map(taskRow).join("")}${!evs.length&&!ts.length?`<p class="hint">Free</p>`:""}</section>`}).join("")+`</div>`;
  bindRows(body,again);bindStrip(body,again)}

/* ---------- Tasks: everything by when it's due ---------- */
function homeTasks(body){syncTasks();const again=()=>homeTasks(body),T=todayISO(),all=openTasks().sort((a,b)=>(a.due||"9").localeCompare(b.due||"9"));
  const groups=[["Overdue",all.filter(t=>t.due&&t.due<T)],["Today",all.filter(t=>t.due===T)],["Upcoming",all.filter(t=>t.due>T)],["Anytime",all.filter(t=>!t.due)]];
  body.innerHTML=`<div class="hm-page narrow">`+(all.length?groups.filter(g=>g[1].length).map(([h,ts])=>`<section class="hm-day"><h3>${h}<span>${ts.length}</span></h3>${ts.map(taskRow).join("")}</section>`).join("")
    :`<div class="sec-empty"><svg class="ic" aria-hidden="true"><use href="#i-okl"/></svg><p class="sec-empty-t">No open tasks</p><p class="hint">Add one with +.</p></div>`)
    +(home.tasks.some(t=>t.done)?`<p class="hint hm-sample">${home.tasks.filter(t=>t.done).length} done · <button class="txt" id="hmClear">Clear done</button></p>`:"")+`</div>`;
  bindRows(body,again);if($("hmClear"))$("hmClear").onclick=()=>{home.tasks=home.tasks.filter(t=>!t.done);saveHome();again()}}

window.SECTION_VIEWS=Object.assign(window.SECTION_VIEWS||{},{"home.today":homeToday,"home.calendar":homeCalendar,"home.tasks":homeTasks});
// the header's + adds a task or an event; the view refreshes after
window.SECTION_ADD=Object.assign(window.SECTION_ADD||{},{home:(btn,refresh)=>openMenu(btn,"Add",[["okl","New task",()=>editTask(null,refresh)],["cal","New event",()=>editEvent(null,refresh)],["flame","New goal",()=>editGoal(null,refresh)],["cal","Link a calendar",()=>editFeed(null)]])});

/* ---------- linking calendars ----------
   An iCloud calendar's share link (Calendar app: tap ⓘ next to a calendar, turn on Public Calendar, Share Link)
   or any other .ics link. The Worker reads it, so this needs the Notion passcode, like sync. */
function editFeed(f){const v=f||{n:"",url:"",c:FEED_COLORS[cals.feeds.length%FEED_COLORS.length][0]};
  formSheet(f?"Edit calendar":"Link a calendar",`<label for="hmName">Name</label><input id="hmName" type="text" maxlength="40" value="${esc(v.n)}" placeholder="e.g. Home">
    <label for="hmUrl">Link</label><input id="hmUrl" type="url" inputmode="url" value="${esc(v.url)}" placeholder="webcal://… or https://…ics">
    <label for="hmCol">Color</label><select id="hmCol">${FEED_COLORS.map(([c,l])=>`<option value="${c}" data-swatch="${c}"${c===v.c?" selected":""}>${l}</option>`).join("")}</select>
    <p class="hint pf-note">On iPhone: Calendar app → Calendars → ⓘ next to a calendar → turn on Public Calendar → Share Link. Anyone with the link can see that calendar, so keep it private.</p>`,
    ()=>{const url=$("hmUrl").value.trim(),x={n:$("hmName").value.trim(),c:$("hmCol").value};if(!url)return;
      if(f){const moved=f.url!==url;Object.assign(f,x,{url,named:true});if(moved){cals.events=cals.events.filter(e=>e.f!==f.id);cals.at=0}}
      else{cals.feeds.push({id:uid(),url,named:true,...x});cals.at=0}
      saveCals();toast(f?"Calendar saved":`Linked ${x.n}`,{kind:"ok",key:"cal",icon:"cal"});refreshCals(true);renderCalSettings()},null,
    f?[["trashl","Unlink",()=>{cals.feeds=cals.feeds.filter(x=>x!==f);cals.events=cals.events.filter(e=>e.f!==f.id);saveCals();renderCalSettings();
      if(document.body.dataset.sec==="home")renderSection(secOf("home"));toast(`Unlinked ${f.n}`,{kind:"removed",key:"cal"})}]]:[]);
}
// Settings → Calendars: the linked ones, with how they're doing
function renderCalSettings(){const el=$("calSet");if(!el)return;
  el.innerHTML=(cals.feeds.length?cals.feeds.map(f=>{const n=cals.events.filter(e=>e.f===f.id).length,err=cals.err[f.id];
      return `<div class="row"><button class="txt hm-feed" data-feed="${f.id}">${dot(f.c)}${esc(f.n)}</button><span class="hint${err?" late":""}">${err?esc(err):cals.at?`${n} event${n===1?"":"s"}`:"Not read yet"}</span></div>`}).join("")
    :`<p class="hint">Show your iCloud calendars on Tasks: link a calendar's share link.</p>`)
    +`<div class="row"><button class="txt" id="calAdd" type="button">Link a calendar</button>${cals.feeds.length?`<button class="txt" id="calNow" type="button">Refresh now</button>`:""}</div>`
    +(cals.feeds.length&&!passcode()?`<p class="hint late">Add your Notion passcode below to read them.</p>`:"");
  el.querySelectorAll("[data-feed]").forEach(b=>b.onclick=()=>{closeGoalsFor(()=>editFeed(cals.feeds.find(f=>f.id===b.dataset.feed)))});
  $("calAdd").onclick=()=>closeGoalsFor(()=>editFeed(null));if($("calNow"))$("calNow").onclick=()=>refreshCals(true)}
// the forms live in the item sheet, so Settings steps aside first
function closeGoalsFor(fn){const g=$("goals");if(g&&!g.hidden&&$("goalsClose"))$("goalsClose").click();setTimeout(fn,g&&!g.hidden?280:0)}
renderCalSettings();
// keep "now" current while Today is showing
setInterval(()=>{if(document.body.dataset.sec==="home"&&$("sheet").hidden&&document.visibilityState==="visible"&&document.querySelector("#secBody-home .hm-hero"))homeToday($("secBody-home"))},30000);

/* ---------- Settings → Sample data: take the samples out to start with your own ---------- */
function clearSamples(){
  const isT=t=>t.sample||SAMPLE_TASKS.includes(t.n),isE=e=>e.sample||SAMPLE_EVENTS.includes(e.n);
  const before={home:JSON.stringify(home),fin:JSON.stringify(fin)};
  const n=home.tasks.filter(isT).length+home.events.filter(isE).length+clearFinSamples(true);
  home.tasks.filter(isT).forEach(t=>{const el=document.querySelector(`#toasts [data-key="${CSS.escape("remind-"+t.id)}"]`);if(el)el.remove()}); // their reminders go too
  home.tasks=home.tasks.filter(t=>!isT(t));home.events=home.events.filter(e=>!isE(e));home.log={}; // goal progress so far was trying it out
  clearFinSamples();saveHome();try{localStorage.setItem("gf-samples-off","1")}catch(e){}
  const again=()=>{renderSampleSettings();if(document.body.dataset.sec!=="food")renderSection(secOf(document.body.dataset.sec))};again();
  toast(n?`Removed ${n} sample item${n===1?"":"s"}`:"Samples are off",{kind:"removed",key:"samples",ms:8000,action:"Undo",onAction:()=>{
    home=JSON.parse(before.home);fin=JSON.parse(before.fin);saveHome();saveFin();try{localStorage.removeItem("gf-samples-off")}catch(e){}again()}})}
function renderSampleSettings(){const el=$("sampleSet");if(!el)return;const off=samplesOff();
  el.innerHTML=`<div class="row"><span>${off?"Samples are off. Tasks and Finance only show what you add.":"Take out the sample tasks, events, accounts and bills, and reset goal progress, to start with your own."}</span>
    ${off?`<button class="txt" id="sampleOn" type="button">Allow samples</button>`:`<button class="btn" id="sampleOff" type="button">Remove</button>`}</div>`;
  if($("sampleOff"))$("sampleOff").onclick=clearSamples;
  if($("sampleOn"))$("sampleOn").onclick=()=>{try{localStorage.removeItem("gf-samples-off")}catch(e){}renderSampleSettings()}}
renderSampleSettings();

/* ---------- tasks sync with Notion (the Planner Tasks database, through the Worker) ----------
   home.synced remembers each Notion task as it was last agreed (page id → its fields), so a change on this
   device is anything that differs from that, and a task gone from here with an entry there was deleted.
   Samples stay on the device. Reading takes Notion's version unless this device has a change still to send. */
const TF=["n","due","at","list","rep","pri","notes","done","fu","fuN","fuOn","fuCount","fuLast"];
const tPick=t=>Object.fromEntries(TF.map(k=>[k,t[k]??(k==="done"?false:k==="fuN"?3:k==="fuCount"?0:"")]));
const tKey=t=>JSON.stringify(TF.map(k=>tPick(t)[k]));
const nidOf=id=>String(id||"").replace(/-/g,"");
const isSampleTask=t=>!t.nid&&(t.sample||SAMPLE_TASKS.includes(t.n));
if(!home.synced||typeof home.synced!=="object")home.synced={};
let tSync={busy:false,t:0,err:"",at:0,last:0};
const canSyncTasks=()=>!!(API.url&&passcode());
function queueTaskPush(){if(!canSyncTasks())return;clearTimeout(tSync.t);tSync.t=setTimeout(()=>syncTasks(true),1200)}
async function pushTasks(){
  const tz=(Intl.DateTimeFormat().resolvedOptions()||{}).timeZone||"";
  // a task whose Notion page was already deleted (brought back with Undo) is made again
  home.tasks.forEach(t=>{if(t.nid&&home.synced[t.nid]===undefined)delete t.nid});
  for(let round=0;round<15;round++){
    const live=home.tasks.filter(t=>!isSampleTask(t)),have=new Set(home.tasks.map(t=>t.nid).filter(Boolean));
    const creates=live.filter(t=>!t.nid).map(t=>({...tPick(t),ref:t.id,tz}));
    const updates=live.filter(t=>t.nid&&tKey(t)!==home.synced[t.nid]).map(t=>({...tPick(t),id:t.nid,tz}));
    const deletes=Object.keys(home.synced).filter(n=>!have.has(n));
    const batch={creates:creates.slice(0,20)},room=()=>20-batch.creates.length-(batch.updates||[]).length;
    batch.updates=updates.slice(0,room());batch.deletes=deletes.slice(0,room());
    if(!batch.creates.length&&!batch.updates.length&&!batch.deletes.length)return;
    const sent=new Map([...batch.creates.map(c=>[c.ref,tKey(c)]),...batch.updates.map(u=>[u.id,tKey(u)])]);
    const r=await api("/tasks/batch",batch);
    (r.created||[]).forEach(c=>{const t=home.tasks.find(x=>x.id===c.ref);if(t){t.nid=nidOf(c.id);home.synced[t.nid]=sent.get(c.ref)}});
    (r.ok||[]).forEach(id=>{id=nidOf(id);if(sent.has(id))home.synced[id]=sent.get(id);else delete home.synced[id]});
    saveHome(true);
    if((r.failed||[]).length){tSync.err=r.failed[0].message;return}
  }
}
async function pullTasks(){
  const r=await api("/tasks"),remote=(r.tasks||[]).map(x=>({...x,id:nidOf(x.id)}));
  const byNid=new Map(home.tasks.filter(t=>t.nid).map(t=>[t.nid,t])),gone=new Set(Object.keys(home.synced).filter(n=>!byNid.has(n)));
  const out=[],synced={};
  remote.forEach(x=>{if(gone.has(x.id)){synced[x.id]=home.synced[x.id];return} // deleted here, not sent yet
    const l=byNid.get(x.id);
    if(l&&home.synced[x.id]!==undefined&&tKey(l)!==home.synced[x.id]){out.push(l);synced[x.id]=home.synced[x.id];return} // changed here, not sent yet
    out.push({...(l||{}),...tPick(x),id:l?l.id:uid(),nid:x.id});synced[x.id]=tKey(x)});
  home.tasks.filter(t=>!t.nid).forEach(t=>out.push(t)); // new here (or samples)
  home.tasks=out;home.synced=synced;saveHome(true);
}
// send what changed, then read everything back; at most once a minute unless asked
async function syncTasks(force){
  if(!canSyncTasks()||tSync.busy)return;if(!force&&Date.now()-tSync.last<60e3)return;
  tSync.busy=true;tSync.last=Date.now();const before=tKeyAll();
  try{await pushTasks();await pullTasks();tSync.err="";tSync.at=Date.now()}
  catch(e){tSync.err=e.code==="notion_access"?"Notion can't open Planner Tasks. In Notion, open Planner Tasks → ⋯ → Connections and add this app's connection."
    :e.code==="server_not_configured"?"The server isn't set up for tasks yet.":e.code==="bad_passcode"?"Wrong Notion passcode.":e.message||"Couldn't sync tasks."}
  finally{tSync.busy=false;renderTaskSettings();
    if(tKeyAll()!==before&&document.body.dataset.sec==="home"&&$("sheet").hidden)renderSection(secOf("home"))}
}
const tKeyAll=()=>home.tasks.map(t=>t.id+tKey(t)).join("|");
setTimeout(()=>syncTasks(true),1200);setInterval(()=>{if(document.visibilityState==="visible")syncTasks(true)},3*60e3);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")syncTasks()});
// Settings → Tasks: how the sync is doing
function renderTaskSettings(){const el=$("taskSet");if(!el)return;const n=home.tasks.filter(t=>t.nid).length;
  el.innerHTML=`<div class="row"><span class="sync-line">${!canSyncTasks()?"Add your Notion passcode below to sync tasks.":tSync.err?`<span class="late">${esc(tSync.err)}</span>`:tSync.at?`Synced with Planner Tasks · ${n} task${n===1?"":"s"}`:"Syncing…"}</span>${canSyncTasks()?`<button class="txt" id="taskNow" type="button">Sync now</button>`:""}</div>`;
  if($("taskNow"))$("taskNow").onclick=()=>syncTasks(true)}
renderTaskSettings();
