/* ---------- Home: calendar and tasks ----------
   Today is the dashboard: the week, how many tasks are left and what to start with, the day's
   events on a timeline, what's on now, and the day's tasks and schedule side by side. Calendar lists the
   week; Tasks lists everything by when it's due. Tasks and events are kept on this device for now.
   Views register with sections.js through window.SECTION_VIEWS. */
const HOMEKEY="gf-home";
const CALS={Family:"#e5674a",Work:"#4c7be0",Kids:"#4bb07a"};
const LISTS={Home:"#ec8a3a",Errands:"#e3b21f",Work:"#4c7be0",Personal:"#d9579b",Kids:"#4bb07a",Family:"#e5674a"};
const REPEATS=[["","Doesn't repeat"],["daily","Daily"],["weekly","Weekly"],["monthly","Monthly"]];
let home={tasks:[],events:[]},homeDay=0; // homeDay: days from today shown on Today
try{const v=JSON.parse(localStorage.getItem(HOMEKEY)||"null");if(v&&Array.isArray(v.tasks)&&Array.isArray(v.events))home=v}catch(e){}
// daily goals, each with a target and a step for its + button; the log keeps each day's progress
const GOAL_COLORS=["#3f8fe0","#3fae7a","#d9579b","#e3a21f","#8a6be0","#ec8a3a"];
if(!Array.isArray(home.goals))home.goals=[{id:"water",n:"Water",target:8,unit:"glasses",step:1,c:GOAL_COLORS[0]},{id:"walk",n:"Walking",target:8000,unit:"steps",step:1000,c:GOAL_COLORS[1]},
  {id:"skin",n:"Skincare",target:2,unit:"routines",step:1,c:GOAL_COLORS[2]},{id:"stretch",n:"Stretch",target:10,unit:"minutes",step:5,c:GOAL_COLORS[3]}];
if(!home.log||typeof home.log!=="object")home.log={};
const saveHome=()=>{try{localStorage.setItem(HOMEKEY,JSON.stringify(home))}catch(e){}};
const dISO=dt=>`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
const dayAt=k=>{const t=new Date();t.setHours(0,0,0,0);t.setDate(t.getDate()+k);return t};
const todayISO=()=>dISO(new Date());
const nowMins=()=>{const n=new Date();return n.getHours()*60+n.getMinutes()};
const dot=c=>`<i class="hm-dot" style="background:${c}"></i>`;
const repLabel=r=>(REPEATS.find(x=>x[0]===r)||["",""])[1];
const shortD=s=>new Date(s+"T00:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
function addPeriod(s,rep){const d=new Date(s+"T00:00:00");if(rep==="daily")d.setDate(d.getDate()+1);else if(rep==="weekly")d.setDate(d.getDate()+7);else if(rep==="monthly")d.setMonth(d.getMonth()+1);return dISO(d)}
const openTasks=()=>home.tasks.filter(t=>!t.done);
const eventsOn=s=>home.events.filter(e=>e.date===s).sort((a,b)=>a.start.localeCompare(b.start));
const tasksOn=s=>openTasks().filter(t=>t.due&&(t.due===s||(s===todayISO()&&t.due<s))).sort((a,b)=>a.due.localeCompare(b.due)||(a.at||"99").localeCompare(b.at||"99"));
// follow-ups: checking a task off brings it back after a few days (every time) or once on a date
const FOLLOWS=[["","No follow-up"],["days","Every few days"],["date","Once, on a date"]];
const plusDays=(s,n)=>{const d=new Date(s+"T00:00:00");d.setDate(d.getDate()+n);return dISO(d)};
const fuLabel=t=>t.fu==="days"?`Every ${t.fuN===1?"day":`${t.fuN||3} days`}`:t.fu==="date"&&t.fuOn?`Again ${shortD(t.fuOn)}`:"";

// sample data, shaped like a real week, for trying it out
function sampleHome(){const T=dISO(dayAt(0)),P=dISO(dayAt(-2)),id=()=>uid();
  home={...home,tasks:[{id:id(),n:"Pay water bill",due:P,list:"Home",rep:"monthly"},{id:id(),n:"Pick up dry cleaning",due:T,list:"Errands",rep:""},
    {id:id(),n:"Water the plants",due:T,list:"Home",rep:"daily"},{id:id(),n:"Send project update",due:T,list:"Work",rep:"weekly"},{id:id(),n:"Book flights for December",due:"",list:"Personal",rep:""},
    {id:id(),n:"Follow up with landlord about the sink",due:T,at:"16:00",list:"Home",rep:"",fu:"days",fuN:3,fuCount:1}],
    events:[{id:id(),n:"Standup",date:T,start:"09:00",end:"09:15",cal:"Work",where:""},{id:id(),n:"Dentist",date:T,start:"14:00",end:"15:00",cal:"Family",where:"Main St"},
    {id:id(),n:"Soccer practice",date:T,start:"17:30",end:"18:30",cal:"Kids",where:""},{id:id(),n:"Team review",date:dISO(dayAt(1)),start:"11:00",end:"12:00",cal:"Work",where:""},
    {id:id(),n:"Family dinner",date:dISO(dayAt(3)),start:"18:30",end:"20:00",cal:"Family",where:""}]};saveHome()}
if(/(^|[?&])demo\b/.test(location.search)&&!home.tasks.length&&!home.events.length)sampleHome();

// The week under the header, like the meal planner's: picking a day shows it (Today) or starts the list there (Calendar).
function weekStrip(){return `<nav class="strip narrow hm-strip" aria-label="Days">${[0,1,2,3,4,5,6].map(k=>{const d=dayAt(k),s=dISO(d),has=eventsOn(s).length||tasksOn(s).length;
  return `<button data-k="${k}" aria-pressed="${k===homeDay}"${k===0?' class="today"':""}><span>${d.toLocaleDateString("en-US",{weekday:"short"})}</span><b>${d.getDate()}</b>${has?'<i class="has"></i>':""}</button>`}).join("")}</nav>`}
function bindStrip(root,again){root.querySelectorAll(".hm-strip [data-k]").forEach(b=>b.onclick=()=>{homeDay=+b.dataset.k;again()})}
/* ---------- Today ---------- */
function homeToday(body){
  const day=dayAt(homeDay),S=dISO(day),isT=homeDay===0,now=nowMins();
  const evs=eventsOn(S),due=tasksOn(S),any=isT?openTasks().filter(t=>!t.due):[],T=todayISO();
  const overdue=isT?due.filter(t=>t.due<T):[],left=due.length+any.length;
  const cur=isT?evs.find(e=>mins(e.start)<=now&&now<mins(e.end||e.start)):null,next=isT?evs.find(e=>mins(e.start)>now):null;
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
      <div class="hm-day-now">${timeline(evs,isT?now:null)}${nowCard?`<div class="hm-now">${nowCard}</div>`:""}${isT?foodLine():""}</div>
    </div>
    <div class="hm-rh"><h2>${isT?"Today":day.toLocaleDateString("en-US",{weekday:"long"})}</h2><span>${evs.length} event${evs.length===1?"":"s"} and ${left} task${left===1?"":"s"}</span></div>
    <div class="hm-panels">
      <section class="hm-panel"><h3>Tasks</h3>${due.length||any.length?due.map(taskRow).join(""):`<p class="hint">No tasks due.</p>`}
        ${any.length?`<h3 class="hm-sub">Anytime</h3>${any.map(taskRow).join("")}`:""}</section>
      <section class="hm-panel"><h3>Schedule</h3>${evs.length?evs.map(e=>eventRow(e,isT&&e===cur)).join(""):`<p class="hint">Nothing scheduled.</p>`}</section>
      <section class="hm-panel"><h3>Goals<span>${goalsMet(S)} of ${home.goals.length} done</span></h3>${home.goals.map(g=>goalRow(g,S)).join("")||`<p class="hint">No goals yet. Add one with +.</p>`}</section>
    </div>
    ${!home.tasks.length&&!home.events.length?`<p class="hint hm-sample">New here? <button class="txt" id="hmSample">Fill in a sample week</button> to see how it works.</p>`:""}</div>`;
  bindStrip(body,()=>homeToday(body));
  bindRows(body,()=>homeToday(body));bindGoals(body,S,()=>homeToday(body));
  const fl=body.querySelector(".hm-food");if(fl)fl.onclick=()=>showSection("food");
  if($("hmSample"))$("hmSample").onclick=()=>{sampleHome();homeToday(body)};
}
function ago(m,future){m=Math.max(0,Math.round(m));const h=Math.floor(m/60),r=m%60;const t=h?`${h} hour${h>1?"s":""}${r?` ${r} minute${r>1?"s":""}`:""}`:`${r} minute${r===1?"":"s"}`;return future?t:t+" ago"}
// the day's events on a line from 7 AM to 10 PM, with a mark for now
function timeline(evs,now){const A=7*60,B=22*60,pc=m=>`${((Math.min(B,Math.max(A,m))-A)/(B-A)*100).toFixed(2)}%`;
  return `<div class="hm-tl"><div class="hm-tl-line">${[9,12,15,18,21].map(h=>`<i class="tk" style="left:${pc(h*60)}"></i><span class="tl" style="left:${pc(h*60)}">${h%12||12} ${h<12?"AM":"PM"}</span>`).join("")}
    ${evs.map(e=>`<button class="mk${now!=null&&mins(e.start)<=now&&now<mins(e.end||e.start)?" cur":""}" data-ev="${e.id}" style="left:${pc(mins(e.start))};--c:${CALS[e.cal]||"var(--ink)"}" aria-label="${esc(e.n)} at ${fmtTime(e.start)}"></button><span class="ml" style="left:${pc(mins(e.start))}">${esc(e.n)}</span>`).join("")}
    ${now!=null&&now>=A&&now<=B?`<i class="nw" style="left:${pc(now)}"></i>`:""}</div></div>`}
// food, from the meal planner
function foodLine(){let d=state.days.findIndex((_,k)=>isToday(k));if(d<0)return "";
  const ms=mealsOf(d),eaten=ms.filter(m=>m.done).reduce((a,m)=>a+m.o.k,0),n=nowMins(),nx=ms.find(m=>!m.done&&!m.missed&&!m.o.skip&&mins(m.time)>=n-30);
  return `<button class="hm-food"><svg class="ic" aria-hidden="true"><use href="#i-apple"/></svg><span><b>${fmt(eaten)}</b> of ${fmt(state.target)} calories${nx?` · next, ${esc(nx.o.n)} at ${fmtTime(nx.time)}`:""}</span></button>`}
function taskRow(t){const T=todayISO(),late=t.due&&t.due<T,when=[t.due&&t.due!==T?shortD(t.due):"",t.at?fmtTime(t.at):""].filter(Boolean).join(", ");
  const meta=[when?(late?`<span class="late">${when}</span>`:when):"",`${dot(LISTS[t.list]||"var(--muted)")}${esc(t.list||"")}`,t.rep&&!t.fu?`<svg class="ic" aria-hidden="true"><use href="#i-syncl"/></svg>${repLabel(t.rep)}`:"",
    t.fu?`<svg class="ic" aria-hidden="true"><use href="#i-bell"/></svg>${fuLabel(t)}`:"",t.fuCount?`followed up ${t.fuCount}×`:""].filter(Boolean);
  return `<div class="hm-task"><button class="hm-check" data-done="${t.id}" aria-label="Complete ${esc(t.n)}"></button><button class="hm-tx" data-task="${t.id}"><span class="nm">${esc(t.n)}</span><span class="mt">${meta.join('<span class="sep">·</span>')}</span></button></div>`}
function eventRow(e,cur){return `<button class="hm-ev${cur?" cur":""}" data-ev="${e.id}"><span class="tm"><b>${fmtTime(e.start)}</b>${cur?"Now":e.end?fmtTime(e.end):""}</span><span class="nm">${dot(CALS[e.cal]||"var(--muted)")}<span>${esc(e.n)}${e.where?`<small>${esc(e.where)}</small>`:""}</span></span></button>`}
function bindRows(root,again){
  root.querySelectorAll("[data-done]").forEach(b=>b.onclick=()=>completeTask(b.dataset.done,again));
  root.querySelectorAll("[data-task]").forEach(b=>b.onclick=()=>editTask(home.tasks.find(t=>t.id===b.dataset.task),again));
  root.querySelectorAll("[data-ev]").forEach(b=>b.onclick=()=>editEvent(home.events.find(e=>e.id===b.dataset.ev),again));
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
function bindGoals(root,s,again){
  const bump=(id,dir)=>{const g=home.goals.find(x=>x.id===id);if(!g)return;const day=home.log[s]=home.log[s]||{},was=+(day[g.id]||0);
    day[g.id]=Math.max(0,+(was+dir*(g.step||1)).toFixed(2));saveHome();again();
    if(dir>0&&was<g.target&&day[g.id]>=g.target)toast(`${g.n}: done for the day`,{kind:"ok",key:"goal",icon:"okl"})};
  root.querySelectorAll("[data-gplus]").forEach(b=>b.onclick=()=>bump(b.dataset.gplus,1));
  root.querySelectorAll("[data-gminus]").forEach(b=>b.onclick=()=>bump(b.dataset.gminus,-1));
  root.querySelectorAll("[data-goal]").forEach(b=>b.onclick=()=>editGoal(home.goals.find(g=>g.id===b.dataset.goal),again));
}
function editGoal(g,again){const v=g||{n:"",target:1,unit:"",step:1};
  formSheet(g?"Edit goal":"New goal",`<label for="hmName">Goal</label><input id="hmName" type="text" maxlength="40" value="${esc(v.n)}" placeholder="e.g. Read">
    <label for="hmTarget">Each day</label><input id="hmTarget" type="number" min="0" step="any" inputmode="decimal" value="${v.target}">
    <label for="hmUnit">Unit</label><input id="hmUnit" type="text" maxlength="20" value="${esc(v.unit||"")}" placeholder="e.g. pages">
    <label for="hmStep">Each tap adds</label><input id="hmStep" type="number" min="0" step="any" inputmode="decimal" value="${v.step||1}">`,
    ()=>{const x={n:$("hmName").value.trim(),target:Math.max(0,+$("hmTarget").value||1),unit:$("hmUnit").value.trim(),step:Math.max(0.1,+$("hmStep").value||1)};
      if(g)Object.assign(g,x);else home.goals.push({id:uid(),c:GOAL_COLORS[home.goals.length%GOAL_COLORS.length],...x});toast(g?"Goal saved":`Added ${x.n}`,{kind:"ok",key:"goal",icon:"okl"});again()},
    g?()=>{home.goals=home.goals.filter(x=>x!==g);toast(`Deleted ${g.n}`,{kind:"removed",key:"goal",action:"Undo",ms:6000,onAction:()=>{home.goals.push(g);saveHome();again()}});again()}:null)}

/* ---------- adding and editing ---------- */
function formSheet(title,html,onSave,onDelete,acts=[]){
  if($("sheet").hidden){sheetFocus=document.activeElement;$("sheetBox").style.height=""}else holdSize();sheetCtx=null;
  $("sheetBox").innerHTML=`${sheetHead("",title,{action:{id:"hmSave",label:"Save"}})}<div class="pf">${html}</div>`;
  showBg($("sheet"));resetSheet($("sheetBox"));document.body.style.overflow="hidden";$("shClose").onclick=closeDetail;
  const name=$("hmName"),need=()=>{$("hmSave").disabled=!name.value.trim()};name.addEventListener("input",need);need();
  $("hmSave").onclick=()=>{if(!name.value.trim())return;onSave();saveHome();closeDetail()};
  const all=acts.map(([i,l,f])=>[i,l,()=>{f();saveHome();closeDetail()}]);if(onDelete)all.push(["trashl","Delete",()=>{onDelete();saveHome();closeDetail()}]);if(all.length)sheetActs(all);
  if(!touchUI)name.focus();
}
const hmOpts=(list,sel)=>list.map(([v,l])=>`<option value="${esc(v)}"${v===sel?" selected":""}>${esc(l)}</option>`).join("");
function editTask(t,again,pre={}){const v=t||{n:"",due:dISO(dayAt(homeDay)),list:"Home",rep:"",...pre};
  formSheet(t?"Edit task":"New task",`<label for="hmName">Task</label><input id="hmName" type="text" maxlength="120" value="${esc(v.n)}" placeholder="e.g. Pay water bill">
    <label for="hmDue">Due</label><input id="hmDue" type="date" value="${esc(v.due||"")}">
    <label for="hmAt">Remind at</label><input id="hmAt" type="time" step="300" value="${esc(v.at||"")}">
    <label for="hmList">List</label><select id="hmList">${hmOpts(Object.keys(LISTS).map(k=>[k,k]),v.list)}</select>
    <label for="hmRep">Repeats</label><select id="hmRep">${hmOpts(REPEATS,v.rep)}</select>
    <label for="hmFu">Follow up</label><select id="hmFu">${hmOpts(FOLLOWS,v.fu||"")}</select>
    <div class="pf-row" id="hmFuDays"><label for="hmFuN">After</label><span class="qty"><input id="hmFuN" type="number" min="1" max="365" inputmode="numeric" value="${v.fuN||3}"> days, each time</span></div>
    <div class="pf-row" id="hmFuDate"><label for="hmFuOn">On</label><input id="hmFuOn" type="date" value="${esc(v.fuOn||plusDays(v.due||todayISO(),7))}"></div>
    <p class="hint pf-note" id="hmFuNote"></p>
    ${t&&t.fuCount?`<p class="hint pf-note">Followed up ${t.fuCount} time${t.fuCount>1?"s":""}${t.fuLast?`, last on ${shortD(t.fuLast)}`:""}.</p>`:""}`,
    ()=>{const fu=$("hmFu").value,x={n:$("hmName").value.trim(),due:$("hmDue").value||"",at:$("hmAt").value||"",list:$("hmList").value,rep:$("hmRep").value,fu,
        fuN:Math.min(365,Math.max(1,Math.round(+$("hmFuN").value||3))),fuOn:fu==="date"?$("hmFuOn").value||"":""};
      if(fu&&!x.due)x.due=todayISO();if(!x.at||x.at!==(t&&t.at)||x.due!==(t&&t.due))x.reminded="";
      if(t)Object.assign(t,x);else home.tasks.push({id:uid(),...x});toast(t?"Task saved":`Added ${x.n}`,{kind:"ok",key:"task",icon:"okl"});again()},
    t?()=>{home.tasks=home.tasks.filter(x=>x!==t);toast(`Deleted ${t.n}`,{kind:"removed",key:"task",action:"Undo",ms:6000,onAction:()=>{home.tasks.push(t);saveHome();again()}});again()}:null,
    t&&!t.done&&(t.fu||t.rep)?[["okl","Done for good",()=>{const before={...t};t.done=true;toast(`Done: ${t.n}`,{kind:"ok",key:"task",icon:"okl",action:"Undo",ms:6000,onAction:()=>{Object.assign(t,before);t.done=false;saveHome();again()}});again()}]]:[]);
  const sync=()=>{const f=$("hmFu").value,n=Math.max(1,Math.round(+$("hmFuN").value||3));$("hmFuDays").hidden=f!=="days";$("hmFuDate").hidden=f!=="date";
    $("hmFuNote").textContent=f==="days"?`Checking it off brings it back ${n===1?"tomorrow":`in ${n} days`}, until you mark it done for good.`:f==="date"?"Checking it off brings it back once, on that date.":"";$("hmFuNote").hidden=!f};
  $("hmFu").onchange=sync;$("hmFuN").oninput=sync;sync()}
function editEvent(e,again){const v=e||{n:"",date:dISO(dayAt(homeDay)),start:"09:00",end:"10:00",cal:"Family",where:""};
  formSheet(e?"Edit event":"New event",`<label for="hmName">Event</label><input id="hmName" type="text" maxlength="120" value="${esc(v.n)}" placeholder="e.g. Dentist">
    <label for="hmDate">Date</label><input id="hmDate" type="date" value="${esc(v.date)}">
    <label for="hmStart">Starts</label><input id="hmStart" type="time" step="300" value="${esc(v.start)}">
    <label for="hmEnd">Ends</label><input id="hmEnd" type="time" step="300" value="${esc(v.end||"")}">
    <label for="hmCal">Calendar</label><select id="hmCal">${hmOpts(Object.keys(CALS).map(k=>[k,k]),v.cal)}</select>
    <label for="hmWhere">Where</label><input id="hmWhere" type="text" maxlength="80" value="${esc(v.where||"")}" placeholder="Optional">`,
    ()=>{const x={n:$("hmName").value.trim(),date:$("hmDate").value||todayISO(),start:$("hmStart").value||"09:00",end:$("hmEnd").value||"",cal:$("hmCal").value,where:$("hmWhere").value.trim()};
      if(x.end&&x.end<x.start)x.end=x.start;if(e)Object.assign(e,x);else home.events.push({id:uid(),...x});toast(e?"Event saved":`Added ${x.n}`,{kind:"ok",key:"event",icon:"cal"});again()},
    e?()=>{home.events=home.events.filter(x=>x!==e);toast(`Deleted ${e.n}`,{kind:"removed",key:"event",action:"Undo",ms:6000,onAction:()=>{home.events.push(e);saveHome();again()}});again()}:null);
}

/* ---------- Calendar: the next two weeks, day by day ---------- */
function homeCalendar(body){const again=()=>homeCalendar(body);
  body.innerHTML=weekStrip()+`<div class="hm-page narrow"><div class="hm-legend">${Object.entries(CALS).map(([n,c])=>`<span>${dot(c)}${n}</span>`).join("")}</div>`+
    Array.from({length:14},(_,j)=>{const k=homeDay+j,d=dayAt(k),s=dISO(d),evs=eventsOn(s),ts=k?openTasks().filter(t=>t.due===s):tasksOn(s);
      return `<section class="hm-day"><h3>${k===0?"Today":k===1?"Tomorrow":d.toLocaleDateString("en-US",{weekday:"long"})}<span>${d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span></h3>
        ${evs.map(e=>eventRow(e,false)).join("")}${ts.map(taskRow).join("")}${!evs.length&&!ts.length?`<p class="hint">Free</p>`:""}</section>`}).join("")+`</div>`;
  bindRows(body,again);bindStrip(body,again)}

/* ---------- Tasks: everything by when it's due ---------- */
function homeTasks(body){const again=()=>homeTasks(body),T=todayISO(),all=openTasks().sort((a,b)=>(a.due||"9").localeCompare(b.due||"9"));
  const groups=[["Overdue",all.filter(t=>t.due&&t.due<T)],["Today",all.filter(t=>t.due===T)],["Upcoming",all.filter(t=>t.due>T)],["Anytime",all.filter(t=>!t.due)]];
  body.innerHTML=`<div class="hm-page narrow">`+(all.length?groups.filter(g=>g[1].length).map(([h,ts])=>`<section class="hm-day"><h3>${h}<span>${ts.length}</span></h3>${ts.map(taskRow).join("")}</section>`).join("")
    :`<div class="sec-empty"><svg class="ic" aria-hidden="true"><use href="#i-okl"/></svg><p class="sec-empty-t">No open tasks</p><p class="hint">Add one with +.</p></div>`)
    +(home.tasks.some(t=>t.done)?`<p class="hint hm-sample">${home.tasks.filter(t=>t.done).length} done · <button class="txt" id="hmClear">Clear done</button></p>`:"")+`</div>`;
  bindRows(body,again);if($("hmClear"))$("hmClear").onclick=()=>{home.tasks=home.tasks.filter(t=>!t.done);saveHome();again()}}

window.SECTION_VIEWS=Object.assign(window.SECTION_VIEWS||{},{"home.today":homeToday,"home.calendar":homeCalendar,"home.tasks":homeTasks});
// the header's + adds a task or an event; the view refreshes after
window.SECTION_ADD=Object.assign(window.SECTION_ADD||{},{home:(btn,refresh)=>openMenu(btn,"Add",[["okl","New task",()=>editTask(null,refresh)],["cal","New event",()=>editEvent(null,refresh)],["flame","New goal",()=>editGoal(null,refresh)]])});
// keep "now" current while Today is showing
setInterval(()=>{if(document.body.dataset.sec==="home"&&$("sheet").hidden&&document.visibilityState==="visible"&&document.querySelector("#secBody-home .hm-hero"))homeToday($("secBody-home"))},30000);
