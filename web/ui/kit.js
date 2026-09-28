/* UI kit: the interaction pieces the app is built from. Plain script, no build step, no dependencies.
   Load after ui/icons.js and before your app script; everything below is a global (and also on window.UI).

   DOM it expects (copy from index.html):
     <div class="toasts" id="toasts" aria-live="polite"></div>
     <div class="sheet-bg" id="sheet" hidden><div class="sheet" id="sheetBox" role="dialog" aria-modal="true" aria-labelledby="shTitle"></div></div>
   Other sheets (like a settings sheet) are any .sheet-bg > .sheet pair; give them swipeDismiss().

   What's here
     $(id), esc(text), uid()                      small helpers
     touchUI, reduceMotion                        device facts
     OUTLINE                                      icon name -> its outline variant, for menus and chips
     toast(text, {kind, key, icon, action, onAction, ms, quiet})
     openMenu(button, label, [[icon, text, fn, hidden]...]), closeMenu()
     sheetHead(eyebrow, title, {id, close, more, action})   a sheet's sticky bar and big title (HTML)
     sheetActs([[icon, text, fn, hidden]...])      floating action chips at the bottom of #sheetBox,
                                                  most-used first (counts in localStorage under UI.actionsKey)
     showBg(bg), hideBg(bg), resetSheet(box)      open/close a .sheet-bg with its animation
     holdSize(), backBtn(fn), nestedSheet()        a sheet inside a sheet: keeps the size, back arrow,
                                                  and each level's scroll position (by its title)
     swipeDismiss(bg, close, canBack)             swipe down to close, right to go back (touch)
     addClear(input)                               a clear (x) button inside a search field
*/
const UI=window.UI=window.UI||{};
UI.actionsKey=UI.actionsKey||"ui-kit-actions";

const touchUI=window.matchMedia&&window.matchMedia("(pointer:coarse)").matches; // on phones, fields aren't focused as a sheet opens, so the keyboard doesn't push it up
const reduceMotion=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $=id=>document.getElementById(id);
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function uid(){return (Math.random().toString(36).slice(2)+"00000000").slice(0,8)}

/* ---------- toasts ---------- */
// Short notes about network calls. A toast with the same key replaces the one on screen, and the same
// message repeated within `quiet` ms is dropped, so background retries don't pile up.
const toastSeen={};
function toast(text,{kind="info",key=text,ms,action,onAction,quiet=0,icon:ic}={}){
  const now=Date.now(),seen=key+"|"+text;if(quiet&&toastSeen[seen]&&now-toastSeen[seen]<quiet)return;toastSeen[seen]=now;
  const box=$("toasts");let el=box.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if(!el){el=document.createElement("div");el.dataset.key=key;box.appendChild(el);while(box.children.length>3)box.firstChild.remove();requestAnimationFrame(()=>el.classList.add("in"))}
  el.className="toast "+kind+(el.classList.contains("in")?" in":"");el.setAttribute("role",kind==="error"?"alert":"status");
  // the icon says what happened; only work still in progress spins
  const icon=ic||{error:"warn",ok:"okl",info:"syncl",removed:"trashl"}[kind]||"syncl";
  el.innerHTML=`<svg class="ic${kind==="info"&&!ic?" spin":""}" aria-hidden="true"><use href="#i-${OUTLINE[icon]||icon}"/></svg><span class="msg"></span>`;el.querySelector(".msg").textContent=text;
  if(action){const b=document.createElement("button");b.textContent=action;b.onclick=()=>{dismiss();onAction&&onAction()};el.appendChild(b)}
  const dismiss=()=>{clearTimeout(el._t);el.classList.remove("in");setTimeout(()=>el.remove(),300)};
  el.onclick=e=>{if(e.target.tagName!=="BUTTON")dismiss()};
  clearTimeout(el._t);el._t=setTimeout(dismiss,ms||(kind==="error"?6000:kind==="info"?15000:2400));
  return{done:(t,k="ok")=>toast(t,{kind:k,key})};
}

/* ---------- sheet title on scroll ----------
   As a sheet (or a .sheet-pane inside one) scrolls, --p goes from 0 to 1 over the first 72px: the big title
   shrinks away and the small one fades into the bar (see kit.css). */
document.addEventListener("scroll",e=>{const t=e.target;if(!(t instanceof Element))return;
  const box=t.classList.contains("sheet")?t:t.classList.contains("sheet-pane")?t.closest(".sheet"):null;
  if(box)box.style.setProperty("--p",Math.min(1,t.scrollTop/72).toFixed(3))},true);

/* ---------- menus ---------- */
let menuFor=null;
// A small action menu anchored to a button. items: [icon, label, action, disabled]
function openMenu(btn,label,items){
  if(menuFor&&menuFor.btn===btn){closeMenu();return}closeMenu(true);
  if(!items.some(x=>x&&!x[3])){toast("Nothing to do here right now",{key:"menu",icon:"dots"});return}
  const m=document.createElement("div");m.className="menu";m.setAttribute("role","menu");m.setAttribute("aria-label",label);
  // actions that don't apply right now aren't listed
  items.filter(x=>x&&!x[3]).forEach(([icon,text,fn,off])=>{const b=document.createElement("button");b.setAttribute("role","menuitem");b.disabled=!!off;
    b.innerHTML=`<svg class="ic" aria-hidden="true"><use href="#i-${OUTLINE[icon]||icon}"/></svg><span></span>`;b.lastChild.textContent=text;b.onclick=()=>{closeMenu(true);fn()};m.appendChild(b)});
  document.body.appendChild(m);
  const r=btn.getBoundingClientRect(),mh=m.offsetHeight,mw=m.offsetWidth,below=r.bottom+6+mh<window.innerHeight-90;
  const left=Math.max(12,Math.min(window.innerWidth-mw-12,r.right-mw));m.style.left=left+"px";m.style.top=(below?r.bottom+6:r.top-6-mh)+"px";
  // it grows out of the button that opened it
  m.style.transformOrigin=`${Math.round(r.left+r.width/2-left)}px ${below?"-6px":`calc(100% + 6px)`}`;m.classList.add("in");
  btn.setAttribute("aria-expanded","true");menuFor={m,btn};
  const first=m.querySelector("button:not(:disabled)");if(first)first.focus();
}
function closeMenu(quiet){if(!menuFor)return;const{m,btn}=menuFor;menuFor=null;
  if(reduceMotion)m.remove();else{m.classList.remove("in");m.classList.add("out");m.style.pointerEvents="none";setTimeout(()=>m.remove(),130)}btn.setAttribute("aria-expanded","false");if(!quiet)btn.focus()}
document.addEventListener("pointerdown",e=>{if(menuFor&&!menuFor.m.contains(e.target)&&!menuFor.btn.contains(e.target))closeMenu(true)},true);
document.addEventListener("scroll",()=>closeMenu(true),{capture:true,passive:true}); // any scroll, including inside a sheet
document.addEventListener("keydown",e=>{
  if(!menuFor)return;const items=[...menuFor.m.querySelectorAll("button:not(:disabled)")],k=items.indexOf(document.activeElement);
  if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();closeMenu()} // close the menu, not the sheet under it
  else if((e.key==="ArrowDown"||e.key==="ArrowUp")&&items.length){e.preventDefault();items[(k+(e.key==="ArrowDown"?1:-1)+items.length)%items.length].focus()}
  else if(e.key==="Tab")closeMenu(true);
});

/* ---------- sheets ---------- */
// Sheets animate out, then hide. Opening one again cancels a close that's still running.
function hideBg(bg){if(bg.hidden)return;clearTimeout(bg._t);if(reduceMotion){bg.hidden=true;return}
  bg.classList.add("closing");bg._t=setTimeout(()=>{bg.hidden=true;bg.classList.remove("closing")},260)}
function showBg(bg){clearTimeout(bg._t);bg.classList.remove("closing");bg.hidden=false}
function sheetHead(eyebrow,title,{id="shTitle",close="shClose",more=null,action=null}={}){
  return `<div class="sh-bar"><button class="sh-x" id="${close}" aria-label="Close"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
    <p class="sh-mini" aria-hidden="true">${title}</p>${more?`<button class="more" id="${more}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions"><svg class="ic" aria-hidden="true"><use href="#i-dots"/></svg></button>`:action?`<button class="sh-act" id="${action.id}">${action.label}</button>`:"<span></span>"}</div>
    <div class="sh-big">${eyebrow?`<p class="sh-sl">${eyebrow}</p>`:""}<h2 id="${id}">${title}</h2></div>`;
}
function resetSheet(box){box.scrollTop=0;box.style.setProperty("--p","0")}
// Moving from one sheet to another inside it (a picker, a form) keeps the sheet the size it was, and the close
// button becomes a back arrow. The size is let go when the sheet closes.
// Leaving a sheet for one inside it remembers where it was scrolled (by its title); coming back restores it.
let sheetScroll={},sheetBacking=false;
const sheetKey=()=>{const t=$("shTitle");return t?t.textContent:""};
function holdSize(){const b=$("sheetBox");if($("sheet").hidden)return;if(!sheetBacking&&sheetKey())sheetScroll[sheetKey()]=b.scrollTop;if(!b.style.height)b.style.height=b.offsetHeight+"px";
  // the new content fades in over the old
  if(!reduceMotion){b.classList.add("swap");clearTimeout(b._sw);b._sw=setTimeout(()=>b.classList.remove("swap"),400)}}
function backBtn(fn){const c=$("shClose");c.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-back"/></svg>';c.setAttribute("aria-label","Back");
  c.onclick=()=>{sheetBacking=true;try{fn()}finally{sheetBacking=false}const y=sheetScroll[sheetKey()];if(y){const b=$("sheetBox");b.scrollTop=y;requestAnimationFrame(()=>{b.scrollTop=y})}}}
// Menus and action chips draw the outline versions of the icons.
const OUTLINE={ok:"okl",sync:"syncl",skip:"skipl",lock:"lockl",unlock:"unlockl",trash:"trashl",x:"xl",down:"downl",plus:"plusl",adjust:"edit",warn:"warnl",clock:"clockl"};
// Sheet actions: a row of chips pinned along the sheet's bottom edge, scrolling sideways when they don't all fit.
// Footer actions move toward the front the more they're used. An action is known by its icon family, so
// "Mark eaten" and "Unmark eaten" count together. Counts are kept on this device.
let actUse=null;const actLoad=()=>{if(!actUse){try{actUse=JSON.parse(localStorage.getItem(UI.actionsKey)||"{}")||{}}catch(e){actUse={}}}return actUse};
const actId=icon=>String(icon).replace(/^unlock/,"lock").replace(/(f|l)$/,"").replace(/^trash.*/,"trash").replace(/^x.*/,"x");
function sheetActs(items){
  const bar=document.createElement("div");bar.className="sh-acts";bar.setAttribute("role","toolbar");bar.setAttribute("aria-label","Actions");
  const use=actLoad(),list=items.filter(x=>x&&!x[3]).map((x,k)=>({x,k,n:use[actId(x[0])]||0})).sort((a,b)=>b.n-a.n||a.k-b.k);
  list.forEach(({x:[icon,text,fn]})=>{const b=document.createElement("button");b.className="act";
    b.innerHTML=`<svg class="ic" aria-hidden="true"><use href="#i-${OUTLINE[icon]||icon}"/></svg><span></span>`;b.lastChild.textContent=text;
    b.onclick=e=>{const id=actId(icon);actUse[id]=(actUse[id]||0)+1;try{localStorage.setItem(UI.actionsKey,JSON.stringify(actUse))}catch(err){}fn(e)};bar.appendChild(b)});
  if(bar.children.length)$("sheetBox").appendChild(bar);
}
// A clear (✕) button inside a search box, shown while there's text in it.
function addClear(inp){const b=document.createElement("button");b.type="button";b.className="ps-btn sclr";b.setAttribute("aria-label","Clear search");b.innerHTML='<svg class="ic" aria-hidden="true"><use href="#i-xl"/></svg>';
  const sync=()=>{b.hidden=!inp.value};b.onclick=e=>{e.preventDefault();inp.value="";inp.dispatchEvent(new Event("input"));sync();inp.focus()};inp.addEventListener("input",sync);inp.after(b);sync()}

/* ---------- swipe a sheet down to dismiss it (touch screens) ----------
   Starts only when the sheet (or the panel under the finger) is scrolled to the top, and the drag is mostly
   downward. Past about a third of the sheet, or a quick flick, closes it; otherwise it springs back. */
function swipeDismiss(bg,close,canBack){
  const sh=bg.querySelector(".sheet");let y0=null,x0=0,dy=0,dx=0,t0=0,drag=null,down=false;
  const scrolled=t=>{for(let el=t;el&&el!==bg;el=el.parentElement)if(el.scrollTop>0&&el.scrollHeight>el.clientHeight+1)return true;return false};
  // a horizontal strip that scrolls (chips, the timeline) keeps its own swipes
  const hScroll=t=>{for(let el=t;el&&el!==sh;el=el.parentElement)if(el.scrollWidth>el.clientWidth+1&&/(auto|scroll)/.test(getComputedStyle(el).overflowX))return true;return false};
  const reset=(ms)=>{sh.style.transition=ms?`transform ${ms}ms ease,opacity ${ms}ms ease`:"";sh.style.transform="";sh.style.opacity="";bg.style.background="";if(ms)setTimeout(()=>{sh.style.transition=""},ms+20)};
  sh.addEventListener("touchstart",e=>{y0=null;if(e.touches.length!==1||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
    y0=e.touches[0].clientY;x0=e.touches[0].clientX;t0=Date.now();dy=dx=0;drag=null;down=!scrolled(e.target)},{passive:true});
  sh.addEventListener("touchmove",e=>{if(y0==null)return;const t=e.touches[0];dy=t.clientY-y0;dx=t.clientX-x0;
    if(!drag){
      if(down&&dy>8&&dy>Math.abs(dx))drag="y";
      else if(dx>10&&dx>Math.abs(dy)*1.3&&canBack&&canBack()&&!hScroll(e.target))drag="x";
      else{if(dy<-6||Math.abs(dx)>14||(!down&&dy>6))y0=null;return}}
    e.preventDefault();sh.style.transition="none";
    if(drag==="y"){const d=Math.max(0,dy);sh.style.transform=`translateY(${d}px)`;bg.style.background=`rgba(0,0,0,${(.38*(1-Math.min(1,d/sh.offsetHeight))).toFixed(3)})`}
    else{const d=Math.max(0,dx);sh.classList.add("hdrag");sh.style.setProperty("--sx",d+"px");sh.style.setProperty("--so",String(1-Math.min(.7,d/sh.offsetWidth)))}},{passive:false});
  const end=()=>{if(y0==null)return;y0=null;if(!drag)return;const dir=drag;drag=null;const ms=Math.max(1,Date.now()-t0);
    if(dir==="x"){
      // swiping right in a sheet opened from another goes back to that one
      const clear=()=>{sh.classList.remove("hdrag","hout","hback");sh.style.removeProperty("--sx");sh.style.removeProperty("--so")};
      if(dx>Math.min(110,sh.offsetWidth*.28)||(dx/ms>.5&&dx>40)){sh.classList.remove("hdrag");sh.classList.add("hout");
        setTimeout(()=>{clear();close("back");sh.classList.remove("swap");sh.classList.add("hin");setTimeout(()=>sh.classList.remove("hin"),300)},160)}
      else{sh.classList.add("hback");sh.style.setProperty("--sx","0px");sh.style.setProperty("--so","1");setTimeout(clear,220)}
      sh.style.transition="";return}
    if(dy>Math.min(140,sh.offsetHeight*.3)||(dy/ms>.6&&dy>30)){
      // in a sheet opened from another (it has a back arrow), swiping down also only goes back to that one
      if(close()==="back"){reset(250);return}
      setTimeout(()=>reset(0),320)}
    else reset(200)};
  sh.addEventListener("touchend",end);sh.addEventListener("touchcancel",end);
}
const nestedSheet=()=>{const c=$("shClose");return !!c&&c.getAttribute("aria-label")==="Back"};

Object.assign(UI,{$,esc,uid,touchUI,reduceMotion,OUTLINE,toast,openMenu,closeMenu,sheetHead,sheetActs,showBg,hideBg,resetSheet,holdSize,backBtn,nestedSheet,swipeDismiss,addClear});
