'use strict';
// SUND-01 A: Paritätsprobe gegen den Python-Prototyp (Vault/Pantheon/Welt/sim_sund.py).   node tools/sim-welt-paritaet.js
// Der Port ist regelgleich: mit Python-Zufall (MT19937: random, uniform, shuffle nach CPython 3.13) und der Hexreihenfolge des Prototyps (K.H aus
// karte_sund.py) liefert er je Seed dieselben Zahlen wie der Prototyp. Geprüft werden Seeds 0..9 mit den Werten aus content/welt/sund-sim-werte.json
// (stuetz an, Sammeln mind. 3, Verschleiß im Feld 1,5 %, Überdehnung 0, Posten-Stützpunkt 6). Erwartet stammt aus
//   dict(S.DEFAULT, stuetz=True, overext=0.0, feld_decay=0.015, sammeln_min=3, stuetz_cap=6.0), je Seed S.run(p, seed).
// Das Modul selbst benutzt mulberry32 (zufall.js); hier wird nur zur Prüfung auf MT umgeschaltet. Nicht Teil von npm test (Werte dürfen sich ändern).
const Daten = require('../server/weltsim/daten.js');
const Zufall = require('../server/weltsim/zufall.js');
const Kz = require('../server/weltsim/kennzahlen.js');

// Python-kompatibles random (MT19937, seed als int)
function MT(seed){
  const mt=new Uint32Array(624); let idx=624;
  const init=(s)=>{mt[0]=s>>>0;for(let i=1;i<624;i++){const p=mt[i-1]^(mt[i-1]>>>30);mt[i]=(Math.imul(1812433253,p)+i)>>>0;}};
  init(19650218);
  const key=[seed>>>0];let i=1,j=0;
  for(let k=Math.max(624,key.length);k>0;k--){const p=mt[i-1]^(mt[i-1]>>>30);mt[i]=((mt[i]^Math.imul(p,1664525))+key[j]+j)>>>0;i++;j++;if(i>=624){mt[0]=mt[623];i=1;}if(j>=key.length)j=0;}
  for(let k=623;k>0;k--){const p=mt[i-1]^(mt[i-1]>>>30);mt[i]=((mt[i]^Math.imul(p,1566083941))-i)>>>0;i++;if(i>=624){mt[0]=mt[623];i=1;}}
  mt[0]=0x80000000;
  const gen=()=>{
    if(idx>=624){let kk;for(kk=0;kk<624;kk++){const y=(mt[kk]&0x80000000)|(mt[(kk+1)%624]&0x7fffffff);mt[kk]=mt[(kk+397)%624]^(y>>>1)^((y&1)?0x9908b0df:0);}idx=0;}
    let y=mt[idx++];y^=y>>>11;y^=(y<<7)&0x9d2c5680;y^=(y<<15)&0xefc60000;y^=y>>>18;return y>>>0;};
  const random=()=>{const a=gen()>>>5,b=gen()>>>6;return (a*67108864+b)/9007199254740992;};
  const randbelow=(n)=>{const k=32-Math.clz32(n);let r=gen()>>>(32-k);while(r>=n)r=gen()>>>(32-k);return r;};
  return {random,randbelow};
}

const HEX_PROTOTYP = ['0204', '0203', '0105', '0205', '0304', '0305', '0403', '0405', '1004', '1003', '1105', '1005', '0904', '0905', '0803', '0805', '0503', '0603', '0703', '0505', '0605', '0705', '0504', '0604', '0704', '0602', '0606'];
// Spalten: seed eroberungen schlachten angriffe ansprueche posten abgebrochen rom_h ger_h staerke_rom staerke_ger kon_marken rr pb fenster
const ERWARTET = [
  "0 0 0 0 0 0 0 8 8 51.0000 51.0000 3466.857 0 0 0",
  "1 3 62 4 3 2 0 7 9 54.0000 50.0890 3504.012 15 40 24",
  "2 4 187 16 6 6 0 8 8 52.3033 61.4292 4333.889 60 88 60",
  "3 2 243 17 11 6 0 8 8 44.2054 43.7420 3761.031 61 77 53",
  "4 2 195 14 11 8 0 8 8 47.8193 40.6292 4166.334 53 78 52",
  "5 2 217 20 9 8 1 8 8 37.7812 41.8095 4197.036 83 56 46",
  "6 1 51 2 1 1 0 7 9 51.0000 54.0000 3717.917 3 46 25",
  "7 1 52 2 1 1 0 7 9 51.0000 54.0000 3716.534 8 40 22",
  "8 2 127 5 8 6 0 8 8 45.1465 50.2260 3468.462 13 85 45",
  "9 2 210 16 11 9 0 8 8 41.2743 42.0591 3822.258 44 90 59"
];

let rng = null;
Zufall.zahl = () => rng.random();
Zufall.gleichverteilt = (z, a, b) => a + (b - a) * rng.random();
Zufall.mische = (z, l) => { for (let i = l.length - 1; i >= 1; i--) { const j = rng.randbelow(i + 1); const t = l[i]; l[i] = l[j]; l[j] = t; } return l; };
Zufall.waehle = (z, l) => l[rng.randbelow(l.length)];

const { karte, werte } = Daten.laden();
karte.hexe.sort((a, b) => HEX_PROTOTYP.indexOf(a.code) - HEX_PROTOTYP.indexOf(b.code));
let fehler = 0;
ERWARTET.forEach((soll, s) => {
  rng = MT(s);
  const r = Kz.lauf({ karte, werte, seed: s });
  const ist = [s, r.captures, r.battles, r.attacks, r.claims, r.posten, r.abort, r.rom_hafen, r.ger_hafen, r.strength.rom.toFixed(4) + ' ' + r.strength.ger.toFixed(4), r.kon_marken.toFixed(3), r.rr, r.pb, r.atk.length].join(' ');
  if (ist !== soll) { fehler++; console.log(`ABWEICHUNG Seed ${s}`, `
  Port:     ${ist}`, `
  Prototyp: ${soll}`); }
});
console.log(fehler ? fehler + ' Abweichungen' : 'Port bit-gleich zum Prototyp (' + ERWARTET.length + ' Seeds)');
process.exit(fehler ? 1 : 0);
