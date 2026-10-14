const CONFIG = require('./shared/config.js');
const Zonen = require('./shared/zonen.js');
const Locations = require('./shared/locations.js');
const { Game } = require('./server/game.js');
const space = require('./server/sim/space.js');
const ZonenSim = require('./server/sim/zonen.js');
const Welt = require('./server/sim/welt.js');
const DT=1/CONFIG.tickHz;
const g = new Game({ noStore:true, worlds:false, seed:21, debug:true, env:{MISSION_SOURCE:'fallback'}, log(){} });
const c={inbox:[],send(m){},sendRaw(){}};
g.addConnection(c); g.handleMessage(c,{t:'hello',clientId:'Z',name:'z',color:0}); g.handleMessage(c,{t:'lobbyOpt',startMission:'free'}); g.handleMessage(c,{t:'ready',ready:true});
Welt.waehle(g,'sund'); g.god=true;
const loc=Locations.get('helix'); const gv=loc.scene.gravimetrie;
space.enterScene(g,'helix',{});
g.ship.power.engines=3; g.ship.powerIntent&&(g.ship.powerIntent.engines=3,g.ship.powerIntent.weapons=1,g.ship.powerIntent.shields=2,g.ship.powerIntent.life=2);
const mev=[]; const me0=g.missionEvent.bind(g); g.missionEvent=(k,d)=>{mev.push(k+JSON.stringify(d));return me0(k,d);};
for(let i=0;i<10;i++) g.step();
g.ship.x=gv.start.x; g.ship.y=gv.start.y; g.ship.angle=0;
ZonenSim.schalten(g,'halt',true); g.players[0].console='helm';
g.ship.power.engines=4; g.ship.powerIntent&&(g.ship.powerIntent.engines=4,g.ship.powerIntent.shields=1,g.ship.powerIntent.weapons=1,g.ship.powerIntent.life=2);
g.ship.x=gv.station.x-250; g.ship.y=gv.station.y; g.ship.vx=0;g.ship.vy=0;g.ship.angle=Math.PI;g.ship.turnVel=0;
for(let i=0;i<10;i++) g.step();
const ziele=gv.fluchtweg; console.log(JSON.stringify(ziele), JSON.stringify(loc.scene.zonen.filter(z=>/halt/.test(z.id)).map(z=>[z.id,z.x,z.y,z.w||z.r,z.h])));
let i=0; let prev={x:g.ship.x,y:g.ship.y};
for(let k=0;k<Math.round(40/DT);k++){
  const sh=g.ship; const z=ziele[i]; if(!z) break;
  const sx=z.x-prev.x, sy=z.y-prev.y, sl=Math.hypot(sx,sy)||1;
  if(((sh.x-z.x)*sx+(sh.y-z.y)*sy)/sl>=-30){prev=z;i++;continue;}
  const dd=Math.max(1,Math.hypot(z.x-sh.x,z.y-sh.y)); const ux=(z.x-sh.x)/dd, uy=(z.y-sh.y)/dd;
  const v=Zonen.wirkung(ZonenSim.szeneZonen(g),sh.x+ux*120,sh.y+uy*120);
  const e=((sh.x-prev.x)*-sy+(sh.y-prev.y)*sx)/sl; const nx=-sy/sl, ny=sx/sl;
  const want=Math.atan2(uy*140-v.vy-ny*e*0.5, ux*140-v.vx-nx*e*0.5);
  let d=want-sh.angle; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
  sh.helm.stage=5; sh.helm.turn=Math.max(-1,Math.min(1,d*2.5));
  g.step();
  if(k%30===0 && k*DT<30) console.log((k*DT).toFixed(1), Math.round(sh.x),Math.round(sh.y),'i',i,'e',Math.round(e),'v',Math.round(v.vx),Math.round(v.vy),'sp',Math.round(sh.speed),'ang',sh.angle.toFixed(2));
}
