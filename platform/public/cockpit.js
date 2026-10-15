const $=id=>document.getElementById(id);
function show(id){for(const d of document.querySelectorAll('dialog[open]'))d.close();$(id).showModal();}
document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>$(b.dataset.dismiss).close());
$('device-settings').onclick=()=>show('device-dialog');
$('open-video').onclick=()=>show('device-dialog');
$('open-sync').onclick=$('device-sync').onclick=()=>show('sync-dialog');
const tabs=[...document.querySelectorAll('[data-view]')];
function activate(tab){for(const b of tabs){const selected=b===tab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;$('view-'+b.dataset.view).hidden=!selected;}}
for(const [i,b] of tabs.entries()){b.onclick=()=>activate(b);b.onkeydown=e=>{let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;if(n!==undefined){e.preventDefault();activate(tabs[n]);tabs[n].focus();}};}
for(const b of document.querySelectorAll('[data-expand]'))b.onclick=()=>{const panel=$(b.dataset.expand+'-video').closest('.video-panel'),expanded=panel.classList.toggle('expanded');b.textContent=expanded?'还原':'放大';b.setAttribute('aria-expanded',String(expanded));};
document.addEventListener('keydown',e=>{if(e.key==='Escape')for(const p of document.querySelectorAll('.video-panel.expanded')){p.classList.remove('expanded');const b=p.querySelector('[data-expand]');b.textContent='放大';b.setAttribute('aria-expanded','false');}});
let routeHash='';
window.addEventListener('platform-state',e=>{const state=e.detail,hash=JSON.stringify(state.plans);if(routeHash===hash)return;routeHash=hash;$('route-list').replaceChildren();
for(const role of ['patrol','suppression']){const p=state.plans[role],card=document.createElement('article');card.className='route-card';const title=document.createElement('h3');title.textContent=role==='patrol'?'巡检机航线':'灭火机航线';card.append(title);const count=document.createElement('strong');count.textContent=p?String(p.waypoints.length):'—';card.append(count,document.createTextNode(' 航点'));for(const text of p?[p.name||'规划航线',p.source==='qgc-folder'?'自动同步 · v'+(p.revision||1):'手动导入',p.receivedAt?new Date(p.receivedAt).toLocaleString():'']:['等待 QGC 保存并同步']){const line=document.createElement('p');line.textContent=text;card.append(line);}$('route-list').append(card);}});
const notice=$('notice');new MutationObserver(()=>{notice.hidden=!notice.textContent.trim();}).observe(notice,{childList:true,characterData:true,subtree:true});
