/* ---------- Finance: accounts, bills and recurring charges ----------
   Accounts lists balances and what you're worth across them. Bills are the month's payments, each due
   on a day of the month, marked paid month by month. Recurring are subscriptions and other repeating
   charges, with what they cost a month and a year. Kept on this device for now. */
const FINKEY="gf-finance";
const ACCT_TYPES=["Checking","Savings","Credit card","Investment","Loan","Cash"];
const CYCLES=[["weekly","Weekly",52],["monthly","Monthly",12],["quarterly","Every 3 months",4],["yearly","Yearly",1]];
let fin={accounts:[],bills:[],subs:[]};
try{const v=JSON.parse(localStorage.getItem(FINKEY)||"null");if(v&&Array.isArray(v.accounts))fin={accounts:v.accounts,bills:v.bills||[],subs:v.subs||[]}}catch(e){}
const saveFin=()=>{try{localStorage.setItem(FINKEY,JSON.stringify(fin))}catch(e){}};
const money=(n,cents=true)=>(n<0?"−":"")+"$"+Math.abs(+n||0).toLocaleString("en-US",{minimumFractionDigits:cents?2:0,maximumFractionDigits:cents?2:0});
const owes=a=>a.type==="Credit card"||a.type==="Loan"; // balances that count against you
const monthKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
const ordinal=n=>n+(["th","st","nd","rd"][(n%100-20)%10]||["th","st","nd","rd"][n%100]||"th");

function sampleFin(){if(samplesOff())return;const id=()=>uid(),t=new Date(),iso=k=>{const d=new Date(t);d.setDate(d.getDate()+k);return dISO(d)};
  fin={accounts:[{id:id(),n:"Everyday checking",type:"Checking",bal:2840.12},{id:id(),n:"High-yield savings",type:"Savings",bal:12500},{id:id(),n:"Visa",type:"Credit card",bal:612.4},{id:id(),n:"Brokerage",type:"Investment",bal:18230.55}],
    bills:[{id:id(),n:"Rent",amt:1850,day:1,auto:false,paid:[monthKey()]},{id:id(),n:"Electric",amt:96,day:12,auto:true,paid:[]},{id:id(),n:"Water",amt:42,day:Math.max(1,t.getDate()-2),auto:false,paid:[]},
      {id:id(),n:"Phone",amt:65,day:22,auto:true,paid:[]},{id:id(),n:"Internet",amt:70,day:Math.min(28,t.getDate()+3),auto:false,paid:[]}],
    subs:[{id:id(),n:"Netflix",amt:15.49,cycle:"monthly",next:iso(6)},{id:id(),n:"Spotify",amt:11.99,cycle:"monthly",next:iso(12)},{id:id(),n:"iCloud+",amt:2.99,cycle:"monthly",next:iso(2)},
      {id:id(),n:"Gym",amt:39,cycle:"monthly",next:iso(18)},{id:id(),n:"Amazon Prime",amt:139,cycle:"yearly",next:iso(74)}]};
  [...fin.accounts,...fin.bills,...fin.subs].forEach(x=>x.sample=1);saveFin()}
const SAMPLE_FIN={accounts:["Everyday checking","High-yield savings","Visa","Brokerage"],bills:["Rent","Electric","Water","Phone","Internet"],subs:["Netflix","Spotify","iCloud+","Gym","Amazon Prime"]};
// takes out sample accounts, bills and charges (count only, with count=true)
function clearFinSamples(count){let n=0;Object.keys(SAMPLE_FIN).forEach(k=>{const is=x=>x.sample||SAMPLE_FIN[k].includes(x.n);n+=fin[k].filter(is).length;if(!count)fin[k]=fin[k].filter(x=>!is(x))});if(!count)saveFin();return n}
if(/(^|[?&])demo\b/.test(location.search)&&!samplesOff()&&!fin.accounts.length&&!fin.bills.length&&!fin.subs.length)sampleFin();
const sampleLink=again=>!samplesOff()&&!fin.accounts.length&&!fin.bills.length&&!fin.subs.length?`<p class="hint hm-sample">New here? <button class="txt" id="finSample">Fill in sample accounts and bills</button> to see how it works.</p>`:"";
const bindSample=(root,again)=>{const b=root.querySelector("#finSample");if(b)b.onclick=()=>{sampleFin();again()}};
const lead=(big,small,say)=>`<div class="hm-lead fin-lead"><p class="hm-count"><b>${big}</b> ${small}</p>${say?`<p class="fin-say">${say}</p>`:""}</div>`;

/* ---------- Accounts ---------- */
function finAccounts(body){const again=()=>finAccounts(body);
  const assets=fin.accounts.filter(a=>!owes(a)).reduce((s,a)=>s+(+a.bal||0),0),debt=fin.accounts.filter(owes).reduce((s,a)=>s+(+a.bal||0),0);
  const groups=ACCT_TYPES.map(t=>[t,fin.accounts.filter(a=>a.type===t)]).filter(g=>g[1].length);
  body.innerHTML=`<div class="hm-page narrow">${lead(money(assets-debt,false),"net worth",fin.accounts.length?`${money(assets,false)} in ${fin.accounts.filter(a=>!owes(a)).length} account${fin.accounts.filter(a=>!owes(a)).length===1?"":"s"}${debt?`, ${money(debt,false)} owed`:""}.`:"")}
    <div class="fin-cols">${groups.map(([t,as])=>`<section class="hm-panel"><h3>${t}<span>${money(as.reduce((s,a)=>s+(+a.bal||0),0))}</span></h3>
      ${as.map(a=>`<button class="fin-row" data-acct="${a.id}"><span class="nm">${esc(a.n)}</span><span class="v${owes(a)?" neg":""}">${owes(a)?"−":""}${money(Math.abs(a.bal))}</span></button>`).join("")}</section>`).join("")||`<div class="sec-empty"><svg class="ic" aria-hidden="true"><use href="#i-wallet"/></svg><p class="sec-empty-t">No accounts yet</p><p class="hint">Add one with +.</p></div>`}</div>
    ${sampleLink()}</div>`;
  body.querySelectorAll("[data-acct]").forEach(b=>b.onclick=()=>viewAccount(fin.accounts.find(a=>a.id===b.dataset.acct),again));bindSample(body,again)}
function editAccount(a,again,back=null){const v=a||{n:"",type:"Checking",bal:0};
  formSheet(a?"Edit account":"New account",`<label for="hmName">Name</label><input id="hmName" type="text" maxlength="60" value="${esc(v.n)}" placeholder="e.g. Everyday checking">
    <label for="fnType">Type</label><select id="fnType">${hmOpts(ACCT_TYPES.map(t=>[t,t]),v.type)}</select>
    <label for="fnBal">Balance</label><input id="fnBal" type="number" step="0.01" inputmode="decimal" value="${v.bal}">`,
    ()=>{const x={n:$("hmName").value.trim(),type:$("fnType").value,bal:Math.abs(+$("fnBal").value||0)};if(a)Object.assign(a,x);else fin.accounts.push({id:uid(),...x});saveFin();toast(a?"Account saved":`Added ${x.n}`,{kind:"ok",key:"fin",icon:"wallet"});again()},
    null,[],back)}

/* ---------- Bills: this month's, by due day ---------- */
function finBills(body){const again=()=>finBills(body),mk=monthKey(),today=new Date().getDate();
  const paid=b=>(b.paid||[]).includes(mk),list=fin.bills.slice().sort((a,b)=>a.day-b.day);
  const total=list.reduce((s,b)=>s+(+b.amt||0),0),left=list.filter(b=>!paid(b)),late=left.filter(b=>b.day<today&&!b.auto),soon=left.filter(b=>b.day>=today&&b.day-today<=7);
  const say=!list.length?"":late.length?`<em>${late.length} bill${late.length>1?"s":""} past due</em>: ${esc(late[0].n)}, ${money(late[0].amt)}.`
    :soon.length?`Next: ${esc(soon[0].n)}, ${money(soon[0].amt)} ${soon[0].day===today?"today":`on the ${ordinal(soon[0].day)}`}.`:left.length?"Nothing due in the next week.":"Everything's paid this month.";
  const row=b=>{const p=paid(b),st=p?"Paid":b.day<today&&!b.auto?"Past due":b.auto?"Autopay":b.day===today?"Due today":`Due the ${ordinal(b.day)}`;
    return `<div class="hm-task fin-bill${p?" paid":""}"><button class="hm-check${p?" on":""}" data-paid="${b.id}" aria-label="${p?"Mark unpaid":"Mark paid"}: ${esc(b.n)}">${p?'<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>':""}</button>
      <button class="hm-tx" data-bill="${b.id}"><span class="nm">${esc(b.n)}</span><span class="mt"><span class="${st==="Past due"?"late":""}">${st}</span>${b.auto&&!p?"":""}</span></button><span class="fin-amt">${money(b.amt)}</span></div>`};
  body.innerHTML=`<div class="hm-page narrow">${lead(money(left.reduce((s,b)=>s+(+b.amt||0),0),false),`left to pay in ${new Date().toLocaleDateString("en-US",{month:"long"})}`,say)}
    ${list.length?`<div class="fin-cols"><section class="hm-panel"><h3>This month<span>${money(total)} total</span></h3>${list.map(row).join("")}</section></div>`
      :`<div class="sec-empty"><svg class="ic" aria-hidden="true"><use href="#i-clockl"/></svg><p class="sec-empty-t">No bills yet</p><p class="hint">Add one with +.</p></div>`}
    ${sampleLink()}</div>`;
  body.querySelectorAll("[data-paid]").forEach(b=>b.onclick=()=>{togglePaid(fin.bills.find(y=>y.id===b.dataset.paid));again()});
  body.querySelectorAll("[data-bill]").forEach(b=>b.onclick=()=>viewBill(fin.bills.find(x=>x.id===b.dataset.bill),again));bindSample(body,again)}
function editBill(b,again,back=null){const v=b||{n:"",amt:"",day:1,auto:false};
  formSheet(b?"Edit bill":"New bill",`<label for="hmName">Bill</label><input id="hmName" type="text" maxlength="60" value="${esc(v.n)}" placeholder="e.g. Electric">
    <label for="fnAmt">Amount</label><input id="fnAmt" type="number" min="0" step="0.01" inputmode="decimal" value="${v.amt}">
    <label for="fnDay">Due on day</label><input id="fnDay" type="number" min="1" max="31" inputmode="numeric" value="${v.day}">
    <label for="fnAuto">Autopay</label><select id="fnAuto">${hmOpts([["0","No"],["1","Yes"]],v.auto?"1":"0")}</select>`,
    ()=>{const x={n:$("hmName").value.trim(),amt:Math.max(0,+$("fnAmt").value||0),day:Math.min(31,Math.max(1,Math.round(+$("fnDay").value||1))),auto:$("fnAuto").value==="1"};
      if(b)Object.assign(b,x);else fin.bills.push({id:uid(),paid:[],...x});saveFin();toast(b?"Bill saved":`Added ${x.n}`,{kind:"ok",key:"fin",icon:"clockl"});again()},
    null,[],back)}

/* ---------- Recurring charges ---------- */
const perYear=s=>(+s.amt||0)*((CYCLES.find(c=>c[0]===s.cycle)||CYCLES[1])[2]);
// a charge whose date has passed rolls forward to its next one
function rollSubs(){const T=todayISO();let ch=false;fin.subs.forEach(s=>{let g=0;while(s.next&&s.next<T&&g++<60){const d=new Date(s.next+"T00:00:00");
  if(s.cycle==="weekly")d.setDate(d.getDate()+7);else if(s.cycle==="quarterly")d.setMonth(d.getMonth()+3);else if(s.cycle==="yearly")d.setFullYear(d.getFullYear()+1);else d.setMonth(d.getMonth()+1);s.next=dISO(d);ch=true}});if(ch)saveFin()}
function finRecurring(body){const again=()=>finRecurring(body);rollSubs();
  const list=fin.subs.slice().sort((a,b)=>(a.next||"9").localeCompare(b.next||"9")),yr=list.reduce((s,x)=>s+perYear(x),0);
  const days=s=>Math.round((new Date(s.next+"T00:00:00")-new Date(todayISO()+"T00:00:00"))/864e5);
  const soon=list.filter(s=>s.next&&days(s)<=7);
  body.innerHTML=`<div class="hm-page narrow">${lead(money(yr/12),"a month",list.length?`${money(yr,false)} a year across ${list.length} charge${list.length===1?"":"s"}.${soon.length?` Next: ${esc(soon[0].n)} ${days(soon[0])===0?"today":days(soon[0])===1?"tomorrow":`in ${days(soon[0])} days`}.`:""}`:"")}
    ${list.length?`<div class="fin-cols"><section class="hm-panel"><h3>Upcoming<span>${list.length}</span></h3>${list.map(s=>`<button class="fin-row" data-sub="${s.id}"><span class="nm">${esc(s.n)}<small>${(CYCLES.find(c=>c[0]===s.cycle)||CYCLES[1])[1]}${s.next?` · next ${shortD(s.next)}`:""}</small></span><span class="v">${money(s.amt)}</span></button>`).join("")}</section></div>`
      :`<div class="sec-empty"><svg class="ic" aria-hidden="true"><use href="#i-syncl"/></svg><p class="sec-empty-t">No recurring charges yet</p><p class="hint">Add subscriptions with +.</p></div>`}
    ${sampleLink()}</div>`;
  body.querySelectorAll("[data-sub]").forEach(b=>b.onclick=()=>viewSub(fin.subs.find(x=>x.id===b.dataset.sub),again));bindSample(body,again)}
function editSub(s,again,back=null){const v=s||{n:"",amt:"",cycle:"monthly",next:todayISO()};
  formSheet(s?"Edit charge":"New recurring charge",`<label for="hmName">Name</label><input id="hmName" type="text" maxlength="60" value="${esc(v.n)}" placeholder="e.g. Netflix">
    <label for="fnAmt">Amount</label><input id="fnAmt" type="number" min="0" step="0.01" inputmode="decimal" value="${v.amt}">
    <label for="fnCycle">Repeats</label><select id="fnCycle">${hmOpts(CYCLES.map(c=>[c[0],c[1]]),v.cycle)}</select>
    <label for="fnNext">Next charge</label><input id="fnNext" type="date" value="${esc(v.next||"")}">`,
    ()=>{const x={n:$("hmName").value.trim(),amt:Math.max(0,+$("fnAmt").value||0),cycle:$("fnCycle").value,next:$("fnNext").value||todayISO()};
      if(s)Object.assign(s,x);else fin.subs.push({id:uid(),...x});saveFin();toast(s?"Charge saved":`Added ${x.n}`,{kind:"ok",key:"fin",icon:"syncl"});again()},
    null,[],back)}

/* ---------- an item's own sheet ---------- */
function togglePaid(x,mk=monthKey()){x.paid=x.paid||[];if(x.paid.includes(mk))x.paid=x.paid.filter(k=>k!==mk);else{x.paid.push(mk);toast(`Paid: ${x.n}`,{kind:"ok",key:"fin",icon:"okl"})}saveFin()}
function finDelete(list,x,again){const k=fin[list].indexOf(x);fin[list]=fin[list].filter(y=>y!==x);saveFin();closeDetail();again();
  toast(`Deleted ${x.n}`,{kind:"removed",key:"fin",action:"Undo",ms:6000,onAction:()=>{fin[list].splice(k,0,x);saveFin();again()}})}
function viewAccount(a,again){if(!a)return;const re=()=>viewAccount(a,again);
  viewSheet(esc(a.type),a.n,[["Balance",`<span class="${owes(a)?"late":""}">${owes(a)?"−":""}${money(Math.abs(a.bal))}</span>`],["Counts as",owes(a)?"Owed":"Savings and cash"]],
    [["edit","Edit",()=>editAccount(a,again,re)],["trashl","Delete",()=>finDelete("accounts",a,again)]])}
function viewBill(b,again){if(!b)return;const re=()=>viewBill(b,again),p=(b.paid||[]).includes(monthKey()),late=!p&&!b.auto&&b.day<new Date().getDate();
  const recent=(b.paid||[]).slice().sort().reverse().slice(0,3).map(k=>new Date(k+"-01T00:00:00").toLocaleDateString("en-US",{month:"short",year:"numeric"})).join(", ");
  viewSheet(b.auto?"Autopay":"Bill",b.n,[["Amount",money(b.amt)],["Due",`the ${ordinal(b.day)} of each month`],["This month",p?"Paid":late?'<span class="late">Past due</span>':"Not paid yet"],["Paid in",recent]],
    [["okl",p?"Mark unpaid":"Mark paid",()=>{togglePaid(b);again();re()}],["edit","Edit",()=>editBill(b,again,re)],["trashl","Delete",()=>finDelete("bills",b,again)]])}
function viewSub(x,again){if(!x)return;const re=()=>viewSub(x,again),c=CYCLES.find(y=>y[0]===x.cycle)||CYCLES[1];
  viewSheet(c[1],x.n,[["Amount",money(x.amt)],["Next charge",x.next?shortD(x.next):""],["A month",money(perYear(x)/12)],["A year",money(perYear(x))]],
    [["edit","Edit",()=>editSub(x,again,re)],["trashl","Delete",()=>finDelete("subs",x,again)]])}

window.SECTION_VIEWS=Object.assign(window.SECTION_VIEWS||{},{"finance.accounts":finAccounts,"finance.bills":finBills,"finance.recurring":finRecurring});
window.SECTION_ADD=Object.assign(window.SECTION_ADD||{},{finance:(btn,refresh)=>openMenu(btn,"Add",[["wallet","New account",()=>editAccount(null,refresh)],["clockl","New bill",()=>editBill(null,refresh)],["syncl","New recurring charge",()=>editSub(null,refresh)]])});
