/* ---------- sections: one place for home, food, finance and health ----------
   A left sidebar switches between sections. Food is the meal planner (app.js) with its own header and
   floating tab bar; every other section gets the same shape: a header, its views, and a floating tab bar
   to move between them. A section's views are plain functions that fill a container, so a new one is a
   few lines below. Which section and view you were on is remembered on this device. */
const SECKEY="gf-gain-planner-sections";
const SECS=[
  {id:"home",label:"Tasks",icon:"okl",views:[["today","Today","sun"],["calendar","Calendar","cal"],["tasks","All tasks","list"]]},
  {id:"food",label:"Food",icon:"apple"},
  {id:"finance",label:"Finance",icon:"wallet",views:[["accounts","Accounts","wallet"],["bills","Bills","clockl"],["recurring","Recurring","syncl"]]},
  {id:"health",label:"Health",icon:"pulse",views:[["overview","Overview","pulse"],["body","Body","flame"],["activity","Activity","clockl"]]},
];
let sec={id:"food",view:{}};
try{const v=JSON.parse(localStorage.getItem(SECKEY)||"null");if(v&&SECS.some(s=>s.id===v.id))sec={id:v.id,view:v.view&&typeof v.view==="object"?v.view:{}}}catch(e){}
// "?food", "?home" etc. in the address opens that section
{const q=location.search.slice(1).split("&")[0];if(SECS.some(s=>s.id===q))sec.id=q}
const saveSec=()=>{try{localStorage.setItem(SECKEY,JSON.stringify(sec))}catch(e){}};
const secOf=id=>SECS.find(s=>s.id===id);
const viewOf=s=>{const v=sec.view[s.id];return s.views.some(x=>x[0]===v)?v:s.views[0][0]};

// The sidebar: a rail of icons on wide screens, a drawer on phones (opened from the header's sidebar button).
document.body.insertAdjacentHTML("beforeend",`
  <aside class="rail" id="rail" aria-label="Sections">${SECS.map(s=>`<button class="rail-btn" data-sec="${s.id}" aria-label="${s.label}" title="${s.label}"><svg class="ic" aria-hidden="true"><use href="#i-${s.icon}"/></svg><span>${s.label}</span></button>`).join("")}
    <button class="rail-btn rail-acct" id="railAcct" aria-haspopup="menu" aria-expanded="false" aria-label="Account" title="Account"><svg class="ic" aria-hidden="true"><use href="#i-user"/></svg><span>Account</span></button></aside>
  <div class="rail-bg" id="railBg" hidden></div>
  ${SECS.filter(s=>s.views).map(s=>`<div class="sec" id="sec-${s.id}" data-sec="${s.id}" hidden>
    <header class="app-head sec-head"><button class="icon-btn rail-open" aria-label="Sections" title="Sections"><svg class="ic" aria-hidden="true"><use href="#i-sidebar"/></svg></button>
      <div class="h-txt"><h1 class="h-title" id="secTitle-${s.id}">${s.label}</h1></div><div class="head-r">${(window.SECTION_ADD||{})[s.id]?`<button class="icon-btn sec-add" data-add="${s.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Add" title="Add"><svg class="ic" aria-hidden="true"><use href="#i-plusl"/></svg></button>`:""}</div></header>
    <main class="sec-main"><div class="narrow sec-body" id="secBody-${s.id}"></div></main>
    <nav class="tabbar sec-tabbar" aria-label="${s.label} views">${s.views.map(([k,l,ic])=>`<button data-view="${k}" aria-label="${l}" title="${l}"><svg class="ic" aria-hidden="true"><use href="#i-${ic}"/></svg></button>`).join("")}</nav>
  </div>`).join("")}`);
// the food header gets the same sidebar button, before its title
$("foodHead").insertAdjacentHTML("afterbegin",`<button class="icon-btn rail-open" aria-label="Sections" title="Sections"><svg class="ic" aria-hidden="true"><use href="#i-sidebar"/></svg></button>`);

// the account button, at the bottom of the sidebar in every section; on phones, picking from its menu closes the drawer
$("railAcct").onclick=()=>openAccount($("railAcct"),()=>openRail(false),{side:matchMedia("(min-width:700px)").matches?"right":""});
document.querySelectorAll("[data-add]").forEach(b=>b.onclick=()=>{const s=secOf(b.dataset.add);window.SECTION_ADD[s.id](b,()=>renderSection(s))});
function openRail(on){$("rail").classList.toggle("open",on);$("railBg").hidden=!on}
document.querySelectorAll(".rail-open").forEach(b=>b.onclick=()=>openRail(true));
$("railBg").onclick=()=>openRail(false);
document.querySelectorAll(".rail-btn[data-sec]").forEach(b=>b.onclick=()=>{openRail(false);showSection(b.dataset.sec)});
document.querySelectorAll(".sec-tabbar [data-view]").forEach(b=>b.onclick=()=>{const s=secOf(b.closest(".sec").dataset.sec);
  if(viewOf(s)===b.dataset.view){window.scrollTo({top:0,behavior:reduceMotion?"auto":"smooth"});return}
  sec.view[s.id]=b.dataset.view;saveSec();renderSection(s);window.scrollTo(0,0)});

function showSection(id,first){
  const was=sec.id;sec.id=id;saveSec();
  document.body.dataset.sec=id;
  document.querySelectorAll(".rail-btn[data-sec]").forEach(b=>b.dataset.sec===id?b.setAttribute("aria-current","page"):b.removeAttribute("aria-current"));
  document.querySelectorAll(".sec").forEach(el=>el.hidden=el.dataset.sec!==id);
  if(id==="food"){if(!first&&was!=="food")renderAll(false)}
  else{if(typeof P3!=="undefined"&&P3)P3.stop();renderSection(secOf(id))}
  if(!first)window.scrollTo(0,0);
}
function renderSection(s){
  const v=viewOf(s),label=s.views.find(x=>x[0]===v)[1];
  $("secTitle-"+s.id).textContent=label;
  document.querySelectorAll(`#sec-${s.id} [data-view]`).forEach(b=>b.dataset.view===v?b.setAttribute("aria-current","page"):b.removeAttribute("aria-current"));
  const body=$("secBody-"+s.id);body.innerHTML="";(VIEWS[s.id+"."+v]||emptyView(s,label))(body);
}

/* ---------- views ---------- */
function emptyView(s,label){return body=>{body.innerHTML=`<div class="sec-empty"><svg class="ic" aria-hidden="true"><use href="#i-${s.icon}"/></svg><p class="sec-empty-t">${esc(label)}</p><p class="hint">This view is ready for its content.</p></div>`}}
// views come from their own files (home.js, …) through window.SECTION_VIEWS
const VIEWS=window.SECTION_VIEWS||{};

showSection(sec.id,true);

/* ---------- appearance (Settings): theme and glass ---------- */
{const get=k=>{try{return localStorage.getItem(k)}catch(e){return null}},set=(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}};
  const sync=()=>{const t=get("gf-theme")||"light",g=get("gf-glass")==="1";
    document.querySelectorAll("[data-theme-opt]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.themeOpt===t));
    const gb=$("glassToggle");if(gb){gb.setAttribute("aria-pressed",g);gb.textContent=g?"On":"Off"}};
  document.querySelectorAll("[data-theme-opt]").forEach(b=>b.onclick=()=>{set("gf-theme",b.dataset.themeOpt);applyTheme();sync()});
  if($("glassToggle"))$("glassToggle").onclick=()=>{set("gf-glass",get("gf-glass")==="1"?"0":"1");applyTheme();sync()};
  sync()}
