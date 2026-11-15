const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const pointerFine=window.matchMedia('(pointer: fine)');
function attachLoginBackground(){
  const page=document.querySelector('.login-page');
  if(!page||page.dataset.backgroundReady)return;
  page.dataset.backgroundReady='true';
  if(reducedMotion.matches||!pointerFine.matches)return;
  let frame=0,last=null;
  page.addEventListener('pointermove',(event)=>{
    const rect=page.getBoundingClientRect();
    const x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
    last={x,y};
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;if(!last)return;
      page.style.setProperty('--pointer-x',`${(last.x-.5)*-12}px`);
      page.style.setProperty('--pointer-y',`${(last.y-.5)*-10}px`);
      page.style.setProperty('--pointer-glow-x',`${last.x*100}%`);
      page.style.setProperty('--pointer-glow-y',`${last.y*100}%`);
    });
  },{passive:true});
  page.addEventListener('pointerleave',()=>{
    page.style.setProperty('--pointer-x','0px');page.style.setProperty('--pointer-y','0px');
    page.style.setProperty('--pointer-glow-x','50%');page.style.setProperty('--pointer-glow-y','44%');
  },{passive:true});
}
new MutationObserver(attachLoginBackground).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
attachLoginBackground();
