// A complete, playable fallback H5 game ("sort + merge" puzzle) skinned by a concept + SVG assets.
// Used in MOCK mode and offered as a fallback when the AI build cannot pass validation.
function templateGame({ title = 'Golu Game', tagline = '', palette = [], items = [], itemNames = [], background = '', icon = '', hint = 'Tap a stack, then tap another to move matching pieces.' }) {
  const cfg = { title, tagline, palette, itemNames, hint };
  const assets = { background, icon, items };
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>${title.replace(/</g, '')}</title>
<style>html,body{margin:0;height:100%;background:#0b0f1e;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}canvas{display:block;margin:0 auto}</style>
</head><body><canvas id="c"></canvas>
<script>window.GAME=${JSON.stringify(cfg)};window.ASSETS=${JSON.stringify(assets)};</script>
<script>
(()=>{
const G=window.GAME,A=window.ASSETS||{};
const cv=document.getElementById('c'),cx=cv.getContext('2d');
let W=390,H=844,S=1,DPR=Math.min(2,window.devicePixelRatio||1);
const PAL=(G.palette&&G.palette.length>=4?G.palette:['#ff5d73','#ffc145','#4cd3c2','#7b6cff','#5ab0ff','#ff8fd8','#9be15d','#ff9f45']);
const COLORS=PAL.concat(['#ff5d73','#ffc145','#4cd3c2','#7b6cff','#5ab0ff','#ff8fd8','#9be15d','#ff9f45']).slice(0,8);
const load=s=>{if(!s)return null;const i=new Image();i.src=s;return i};
const bg=load(A.background),icon=load(A.icon),itemImgs=(A.items||[]).map(load);
function resize(){const vw=innerWidth,vh=innerHeight;const r=Math.min(vw/390,vh/844);W=390;H=844;S=r;cv.width=Math.round(390*r*DPR);cv.height=Math.round(844*r*DPR);cv.style.width=Math.round(390*r)+'px';cv.style.height=Math.round(844*r)+'px';cv.style.marginTop=Math.max(0,(vh-844*r)/2)+'px';cx.setTransform(r*DPR,0,0,r*DPR,0,0)}
addEventListener('resize',resize);resize();
// ---- audio ----
let AC=null;function snd(f=440,d=.08,type='sine',v=.15,slide=0){try{AC=AC||new (window.AudioContext||window.webkitAudioContext)();const o=AC.createOscillator(),g=AC.createGain();o.type=type;o.frequency.value=f;if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(40,f+slide),AC.currentTime+d);g.gain.value=v;g.gain.exponentialRampToValueAtTime(.001,AC.currentTime+d);o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+d)}catch(e){}}
const sfx={pick:()=>snd(660,.07,'triangle'),drop:()=>snd(420,.09,'sine',.18,-120),bad:()=>snd(160,.15,'square',.08),merge:()=>{snd(523,.1,'triangle');setTimeout(()=>snd(784,.14,'triangle'),90);setTimeout(()=>snd(1046,.2,'sine'),180)},win:()=>[523,659,784,1046].forEach((f,i)=>setTimeout(()=>snd(f,.25,'triangle',.2),i*120)),lose:()=>[392,330,262].forEach((f,i)=>setTimeout(()=>snd(f,.3,'sawtooth',.08),i*160))};
// ---- state ----
const CAP=4;let state='menu',level=1,score=0,best=+(localStorage.getItem('golu_best_'+G.title)||0),moves=0,maxMoves=0,tubes=[],sel=-1,parts=[],floats=[],tutorial=true,shake=0,t=0,anim=null,mergedCount=0,need=0,combo=0;
function rnd(n){return Math.floor(Math.random()*n)}
function genLevel(){const nColors=Math.min(3+Math.floor((level-1)/2),8),empties=2;const pool=[];for(let c=0;c<nColors;c++)for(let k=0;k<CAP;k++)pool.push(c);
 for(let i=pool.length-1;i>0;i--){const j=rnd(i+1);[pool[i],pool[j]]=[pool[j],pool[i]]}
 tubes=[];for(let i=0;i<nColors;i++)tubes.push({items:pool.slice(i*CAP,i*CAP+CAP),done:false,pop:0});for(let i=0;i<empties;i++)tubes.push({items:[],done:false,pop:0});
 // avoid already-solved tubes
 tubes.forEach(tb=>{if(tb.items.length===CAP&&tb.items.every(x=>x===tb.items[0])){const o=tubes.find(z=>z!==tb&&z.items.length);if(o){const a=tb.items.pop(),b=o.items.pop();tb.items.push(b);o.items.push(a)}}});
 need=nColors;mergedCount=0;moves=0;maxMoves=nColors*6+6-Math.min(level,8);sel=-1;combo=0}
function layout(){const n=tubes.length,perRow=n>6?Math.ceil(n/2):n,rows=Math.ceil(n/perRow),tw=Math.min(62,330/perRow-10),th=CAP*tw*0.92+24;const out=[];
 for(let i=0;i<n;i++){const r=Math.floor(i/perRow),c=i%perRow,cnt=Math.min(perRow,n-r*perRow);const gap=(370-cnt*tw)/(cnt+1);out.push({x:10+gap+c*(tw+gap),y:300+r*(th+40)+(rows===1?60:0),w:tw,h:th})}return out}
function topRun(tb){const it=tb.items;if(!it.length)return 0;let k=1;while(k<it.length&&it[it.length-1-k]===it[it.length-1])k++;return k}
function canPour(a,b){if(a===b)return false;const A1=tubes[a],B1=tubes[b];if(!A1.items.length||A1.done||B1.done)return false;if(B1.items.length>=CAP)return false;return !B1.items.length||B1.items[B1.items.length-1]===A1.items[A1.items.length-1]}
function anyMove(){for(let a=0;a<tubes.length;a++)for(let b=0;b<tubes.length;b++)if(canPour(a,b))return true;return false}
function pour(a,b){const A1=tubes[a],B1=tubes[b];const c=A1.items[A1.items.length-1];let n=Math.min(topRun(A1),CAP-B1.items.length);for(let i=0;i<n;i++)B1.items.push(A1.items.pop());moves++;tutorial=false;sfx.drop();const L=layout()[b];burst(L.x+L.w/2,L.y+L.h-B1.items.length*L.w*.92,COLORS[c],8);
 if(B1.items.length===CAP&&B1.items.every(x=>x===c)){B1.done=true;B1.pop=1;mergedCount++;combo++;const gain=100*combo+Math.max(0,maxMoves-moves)*5;score+=gain;floats.push({x:L.x+L.w/2,y:L.y-10,txt:'MERGE +'+gain,c:COLORS[c],life:1.4});burst(L.x+L.w/2,L.y+L.h/2,COLORS[c],40);shake=8;sfx.merge()}else combo=0;
 if(mergedCount>=need){setTimeout(()=>{state='win';sfx.win();score+=Math.max(0,maxMoves-moves)*20;if(score>best){best=score;localStorage.setItem('golu_best_'+G.title,best)}},500)}
 else if(moves>=maxMoves||!anyMove()){setTimeout(()=>{if(state==='play'){state='lose';sfx.lose()}},600)}}
function burst(x,y,c,n){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=1+Math.random()*5;parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,life:1,c,r:2+Math.random()*4})}}
// ---- input ----
function pt(e){const r=cv.getBoundingClientRect();const p=e.touches?e.touches[0]||e.changedTouches[0]:e;return{x:(p.clientX-r.left)/S,y:(p.clientY-r.top)/S}}
function btn(x,y,w,h,p){return p.x>=x&&p.x<=x+w&&p.y>=y&&p.y<=y+h}
function onDown(e){e.preventDefault();const p=pt(e);
 if(state==='menu'){if(btn(95,560,200,64,p)){state='play';level=1;score=0;genLevel();sfx.merge()}return}
 if(state==='win'){if(btn(95,520,200,64,p)){level++;genLevel();state='play';sfx.pick()}return}
 if(state==='lose'){if(btn(95,520,200,64,p)){genLevel();state='play';sfx.pick()}return}
 if(btn(330,24,44,44,p)){genLevel();sfx.pick();return}
 const L=layout();const i=L.findIndex(l=>p.x>=l.x-8&&p.x<=l.x+l.w+8&&p.y>=l.y-40&&p.y<=l.y+l.h+10);
 if(i<0){sel=-1;return}
 if(sel<0){if(tubes[i].items.length&&!tubes[i].done){sel=i;sfx.pick()}else sfx.bad()}
 else if(sel===i){sel=-1}
 else if(canPour(sel,i)){pour(sel,i);sel=-1}
 else{sfx.bad();shake=4;sel=tubes[i].items.length&&!tubes[i].done?i:-1}}
cv.addEventListener('mousedown',onDown);cv.addEventListener('touchstart',onDown,{passive:false});
// ---- draw ----
function rr(x,y,w,h,r){cx.beginPath();cx.moveTo(x+r,y);cx.arcTo(x+w,y,x+w,y+h,r);cx.arcTo(x+w,y+h,x,y+h,r);cx.arcTo(x,y+h,x,y,r);cx.arcTo(x,y,x+w,y,r);cx.closePath()}
function drawBg(){if(bg&&bg.complete&&bg.naturalWidth){const r=Math.max(W/bg.naturalWidth,H/bg.naturalHeight);const w=bg.naturalWidth*r,h=bg.naturalHeight*r;cx.drawImage(bg,(W-w)/2,(H-h)/2,w,h)}else{const g=cx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#1b1f4b');g.addColorStop(1,'#0b0f1e');cx.fillStyle=g;cx.fillRect(0,0,W,H)}
 cx.fillStyle='rgba(5,8,20,.25)';cx.fillRect(0,0,W,H)}
function drawItem(c,x,y,s,glow){const img=itemImgs[c];cx.save();if(glow){cx.shadowColor=COLORS[c];cx.shadowBlur=18}
 if(img&&img.complete&&img.naturalWidth){cx.drawImage(img,x-s/2,y-s/2,s,s)}else{const g=cx.createRadialGradient(x-s*.15,y-s*.2,s*.05,x,y,s*.5);g.addColorStop(0,'#fff');g.addColorStop(.25,COLORS[c]);g.addColorStop(1,shade(COLORS[c],-40));cx.fillStyle=g;cx.beginPath();cx.arc(x,y,s*.44,0,7);cx.fill()}
 cx.restore()}
function shade(h,a){const n=parseInt(h.slice(1),16);let r=(n>>16)+a,g=(n>>8&255)+a,b=(n&255)+a;r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));return'rgb('+r+','+g+','+b+')'}
function button(x,y,w,h,label,c1,c2){const pulse=1+Math.sin(t*4)*.03;cx.save();cx.translate(x+w/2,y+h/2);cx.scale(pulse,pulse);const g=cx.createLinearGradient(0,-h/2,0,h/2);g.addColorStop(0,c1);g.addColorStop(1,c2);cx.shadowColor=c1;cx.shadowBlur=20;rr(-w/2,-h/2,w,h,h/2);cx.fillStyle=g;cx.fill();cx.shadowBlur=0;cx.fillStyle='rgba(255,255,255,.25)';rr(-w/2+6,-h/2+4,w-12,h/2-4,h/3);cx.fill();cx.fillStyle='#fff';cx.font='800 24px system-ui';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(label,0,2);cx.restore()}
function text(s,x,y,size,c='#fff',w=800){cx.fillStyle=c;cx.font=w+' '+size+'px system-ui';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(s,x,y)}
function wrap(s,x,y,maxW,lh,size,c){cx.font='600 '+size+'px system-ui';const ws=String(s).split(' ');let line='',yy=y;for(const w of ws){const tl=line+w+' ';if(cx.measureText(tl).width>maxW&&line){text(line.trim(),x,yy,size,c,600);line=w+' ';yy+=lh}else line=tl}text(line.trim(),x,yy,size,c,600)}
function drawTubes(){const L=layout();tubes.forEach((tb,i)=>{const l=L[i];const lift=i===sel?-18:0;tb.pop=Math.max(0,tb.pop-.02);
 cx.save();cx.translate(0,lift);rr(l.x,l.y,l.w,l.h,l.w/2.4);cx.fillStyle=tb.done?'rgba(255,215,90,.18)':'rgba(255,255,255,.10)';cx.fill();cx.lineWidth=3;cx.strokeStyle=tb.done?'#ffd75a':i===sel?'#fff':'rgba(255,255,255,.45)';cx.stroke();
 cx.fillStyle='rgba(255,255,255,.18)';rr(l.x+5,l.y+8,5,l.h-20,3);cx.fill();
 const s=l.w*.86;tb.items.forEach((c,k)=>{const y=l.y+l.h-12-s/2-k*s*1.04;const isTop=k===tb.items.length-1;const bob=i===sel&&isTop?Math.sin(t*10)*3:0;drawItem(c,l.x+l.w/2,y+bob,s*(tb.done?1+tb.pop*.3:1),tb.done)});
 if(tb.done){text('★',l.x+l.w/2,l.y-14,22+tb.pop*20,'#ffd75a')}
 cx.restore()});
 if(tutorial&&state==='play'){const a=tubes.findIndex((tb,i)=>tubes.some((_,j)=>canPour(i,j)&&(!tubes[j].items.length?false:true)));const ai=a>=0?a:0;const bi=tubes.findIndex((_,j)=>canPour(ai,j));const tgt=sel<0?L[ai]:L[bi>=0?bi:0];const hx=tgt.x+tgt.w/2,hy=tgt.y+tgt.h+30+Math.sin(t*6)*8;text('👆',hx,hy,40);cx.fillStyle='rgba(0,0,0,.55)';rr(30,H-150,330,60,16);cx.fill();wrap(G.hint,195,H-128,300,20,15,'#fff')}}
function hud(){cx.fillStyle='rgba(0,0,0,.35)';rr(12,16,366,60,18);cx.fill();text('LV '+level,52,46,20,'#ffd75a');text(String(score),195,40,26);text('BEST '+best,195,62,11,'#bcd');const left=maxMoves-moves;text('MOVES',275,34,10,'#bcd');text(String(left),275,56,22,left<=3?'#ff5d73':'#fff');
 cx.fillStyle='rgba(255,255,255,.15)';rr(330,24,44,44,12);cx.fill();text('↻',352,47,24);
 const pw=300;cx.fillStyle='rgba(255,255,255,.12)';rr(45,92,pw,12,6);cx.fill();const g=cx.createLinearGradient(45,0,45+pw,0);g.addColorStop(0,COLORS[0]);g.addColorStop(1,COLORS[2]);cx.fillStyle=g;rr(45,92,Math.max(12,pw*mergedCount/need),12,6);cx.fill();text(mergedCount+'/'+need+' merged',195,120,12,'#dfe');
 if(combo>1)text('COMBO x'+combo,195,150,22+Math.sin(t*12)*2,'#ff8fd8')}
function fx(){parts=parts.filter(p=>(p.life-=.02)>0);parts.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.15;cx.globalAlpha=p.life;cx.fillStyle=p.c;cx.beginPath();cx.arc(p.x,p.y,p.r*p.life,0,7);cx.fill()});cx.globalAlpha=1;
 floats=floats.filter(f=>(f.life-=.016)>0);floats.forEach(f=>{f.y-=.8;cx.globalAlpha=Math.min(1,f.life);text(f.txt,f.x,f.y,20,f.c);cx.globalAlpha=1})}
function overlay(title,sub,label,c1,c2){cx.fillStyle='rgba(5,8,20,.72)';cx.fillRect(0,0,W,H);rr(35,250,320,360,28);cx.fillStyle='rgba(255,255,255,.08)';cx.fill();cx.strokeStyle='rgba(255,255,255,.25)';cx.lineWidth=2;cx.stroke();text(title,195,320,40,c1);wrap(sub,195,385,260,24,17,'#e8ecff');text('Score '+score,195,455,22,'#fff');button(95,520,200,64,label,c1,c2)}
function menu(){const bob=Math.sin(t*2)*8;if(icon&&icon.complete&&icon.naturalWidth){cx.save();cx.shadowColor='#000';cx.shadowBlur=30;cx.drawImage(icon,125,170+bob,140,140);cx.restore()}else{for(let i=0;i<5;i++)drawItem(i%COLORS.length,115+i*40,240+Math.sin(t*3+i)*12,44,true)}
 text(G.title,195,360,G.title.length>16?28:36);wrap(G.tagline||'',195,405,300,22,16,'#cfd6ff');
 for(let i=0;i<4;i++)drawItem(i,135+i*40,480+Math.sin(t*4+i)*6,34,false);button(95,560,200,64,'PLAY',COLORS[0],shade(COLORS[0],-50));text('Best '+best,195,660,14,'#bcd',600)}
let last=0;function loop(ts){const dt=Math.min(.05,(ts-last)/1000||0);last=ts;t+=dt;cx.save();if(shake>0){cx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=.85;if(shake<.3)shake=0}
 drawBg();if(state==='menu')menu();else{hud();drawTubes();fx();if(state==='win')overlay('LEVEL CLEAR!','All stacks merged. '+(maxMoves-moves)+' moves to spare!','NEXT',COLORS[2],shade(COLORS[2],-50));if(state==='lose')overlay('OUT OF MOVES','So close! Plan your pours and try again.','RETRY',COLORS[0],shade(COLORS[0],-50))}
 cx.restore();requestAnimationFrame(loop)}
requestAnimationFrame(loop);
})();
</script></body></html>`;
}
module.exports = { templateGame };
