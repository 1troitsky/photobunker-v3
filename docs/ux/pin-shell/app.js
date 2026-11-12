
(()=>{'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={digits:'',length:4,busy:false,lockState:'idle',generation:0,failures:0};
const demoCodes={4:'2468',5:'24680',6:'246810',7:'2468101',8:'24681012'};
let pending;
function markIndicators(){const panel=$('#indicators');panel.innerHTML=Array.from({length:state.length},(_,i)=>`<span class="${i<state.digits.length?'filled':''}" aria-hidden="true"></span>`).join('');panel.setAttribute('aria-label',`Введено ${state.digits.length} из ${state.length} цифр`);}
function hint(message='',kind=''){const el=$('#pin-feedback');el.textContent=message;el.className=kind?'pin-'+kind:'';}
function reset(){clearTimeout(pending);state.generation++;state.digits='';state.busy=false;state.lockState='idle';$('#indicators').classList.remove('invalid','complete');hint('');markIndicators();}
function renderControl(){ $$('#pin-length [data-length]').forEach(b=>{const v=Number(b.dataset.length);b.classList.toggle('selected',v===state.length);b.setAttribute('aria-pressed',String(v===state.length))});$('#demo-code').textContent=demoCodes[state.length] }
function setLength(n){if(!Number.isInteger(n)||n<4||n>8)return;state.length=n;reset();renderControl()}
function enter(key){if(state.busy)return;if(key==='back'){state.digits=state.digits.slice(0,-1);markIndicators();hint('');return;}if(!/^\d$/.test(key)||state.digits.length>=state.length)return;state.digits+=key;markIndicators();hint('');if(state.digits.length===state.length){state.busy=true;const g=++state.generation;pending=setTimeout(()=>{if(state.generation!==g)return;const ok=state.digits===demoCodes[state.length];if(ok){state.lockState='success';$('#indicators').classList.add('complete');hint('PIN принят','success');pending=setTimeout(()=>{if(state.generation===g)reset()},1450)}else{state.failures++;state.lockState='error';$('#indicators').classList.add('invalid');hint('Неверный PIN','error');pending=setTimeout(()=>{if(state.generation===g)reset()},900)}},220)}}
$$('[data-device]').forEach(b=>b.addEventListener('click',()=>{const d=b.dataset.device;$('#device').className='device '+d;$$('[data-device]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b))})}));
$$('[data-length]').forEach(b=>b.addEventListener('click',()=>setLength(Number(b.dataset.length))));
$('#keys').addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b)enter(b.dataset.key)});
window.addEventListener('keydown',e=>{if(e.altKey||e.metaKey||e.ctrlKey||/INPUT|TEXTAREA/.test(e.target.tagName))return;if(/^\d$/.test(e.key)){e.preventDefault();enter(e.key)}else if(e.key==='Backspace'){e.preventDefault();enter('back')}else if(e.key==='Escape'){e.preventDefault();reset()}});
renderControl();markIndicators();
})();
