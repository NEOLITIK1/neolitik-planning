import {buildSchedules,isLeader,normalizeOperators,linkOperators,moveAssignment,validateSchedule,absentOnDay,SHIFTS} from '../src/scheduler.js';

const fixture=(size=8,chiefs=3)=>Array.from({length:size},(_,i)=>({id:`p${i}`,short:`P${i}`,full:`Prénom P${i}`,active:true,level:i<chiefs?'N4':'N1',isLeader:i<chiefs}));
const where=(sc,name)=>SHIFTS.find(k=>sc[k].includes(name));
const errors=sc=>(sc.issues||[]).filter(i=>i.severity==='error');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function runRules() {
  const results=[];
  function check(name,run) {try {run();results.push({name,pass:true});} catch(e){results.push({name,pass:false,detail:e.message});}}
  function expect(ok,message='Condition non satisfaite'){if(!ok)throw new Error(message);}
  function mustThrow(fn){let threw=false;try{fn();}catch{threw=true;}expect(threw,'Le conflit aurait dû être refusé.');}

  check('Migration : anciens N4 chefs, rôle explicite false conservé',()=>{
    const ops=normalizeOperators([{id:'a',level:'N4'},{id:'b',level:'N4',isLeader:false}]);
    expect(isLeader(ops[0])&&!isLeader(ops[1]));
  });
  check('Un N2 chef et un N4 non chef sont traités selon leur rôle',()=>{
    const ops=fixture();ops[0].level='N2';ops[3].level='N4';
    const sc=buildSchedules(ops,1,12).schedules;
    expect(sc.every(s=>!errors(s).length && SHIFTS.every(k=>s[k].filter(n=>isLeader(ops.find(o=>o.short===n))).length===1)));
  });
  check('Lien symétrique, exclusif ; les anciens partenaires sont libérés',()=>{
    let ops=linkOperators(fixture(),'p3','p4');ops=linkOperators(ops,'p5','p6');ops=linkOperators(ops,'p3','p5');
    expect(ops[3].partnerId==='p5'&&ops[5].partnerId==='p3'&&!ops[4].partnerId&&!ops[6].partnerId);
    ops=linkOperators(ops,'p3',null);expect(!ops[3].partnerId&&!ops[5].partnerId);
  });
  check('Binômes invalides refusés : deux chefs, soi-même, mode volant différent',()=>{
    const ops=fixture();mustThrow(()=>linkOperators(ops,'p0','p1'));mustThrow(()=>linkOperators(ops,'p3','p3'));
    ops[4].isVolant=true;mustThrow(()=>linkOperators(ops,'p3','p4'));
  });
  check('Deux binômes restent ensemble pendant 52 semaines, sans doublon',()=>{
    let ops=linkOperators(fixture(9),'p0','p3');ops=linkOperators(ops,'p4','p5');
    const sc=buildSchedules(ops,1,52).schedules;
    expect(sc.every(s=>where(s,'P0')===where(s,'P3')&&where(s,'P4')===where(s,'P5')&&!errors(s).length));
    expect(sc.every(s=>new Set(SHIFTS.flatMap(k=>s[k])).size===9));
  });
  check('Partenaire absent ou hors contrat : le membre disponible reste affecté',()=>{
    const ops=linkOperators(fixture(),'p3','p4');ops[4].fromWeek=4;
    const sc=buildSchedules(ops,1,6,{5:['P4']}).schedules;
    expect(sc.every(s=>!!where(s,'P3')));expect(!where(sc[0],'P4')&&!where(sc[4],'P4'));
  });
  check('Nuit à quatre autorisée lorsqu’un groupe indivisible impose quatre',()=>{
    const ops=fixture(7);ops[0].partnerId='p3';ops[3].partnerId='p0';
    ops[4].partnerId='p5';ops[5].partnerId='p4';
    // Force the third non-chief with the other non-chief pair using imported linked data.
    ops[6].partnerId='p5';
    const s=buildSchedules(ops,1,1).schedules[0];expect(s.nuit.length>=3&&!errors(s).length);
    expect(s.nuit.length===4,JSON.stringify(s));
  });
  check('Six personnes : trois chaque nuit et dérogation explicitée',()=>{
    const sc=buildSchedules(fixture(6),1,12).schedules;
    expect(sc.every(s=>s.nuit.length===3&&!errors(s).length));
    expect(sc.slice(1).every(s=>s.issues.some(i=>i.code==='repeat-night')));
  });
  check('Trois chefs, deux équipiers : aucun faux planning conforme',()=>{
    const sc=buildSchedules(fixture(5),1,5).schedules;
    expect(sc.every(s=>s.nuit.length===3&&!errors(s).length));
    const impossible=buildSchedules(fixture(4),1,1).schedules[0];expect(errors(impossible).length>0);
  });
  check('Chef manquant : impossibilité signalée, aucun doublage d’un chef',()=>{
    const ops=fixture();const sc=buildSchedules(ops,1,2,{1:['P0']}).schedules[0];
    expect(sc.issues.some(i=>i.code==='infeasible'));expect(SHIFTS.every(k=>sc[k].filter(n=>isLeader(ops.find(o=>o.short===n))).length<=1));
  });
  check('Quatrième chef : réserve explicite et rotation équitable',()=>{
    const ops=fixture(9,4),r=buildSchedules(ops,1,52);
    expect(r.schedules.every(s=>s.reserve.length===1&&!errors(s).length));
    const totals=ops.slice(0,4).map(o=>r.nightCount[o.short]+r.matCount[o.short]+r.amCount[o.short]);
    expect(Math.max(...totals)-Math.min(...totals)<=2,JSON.stringify(totals));
  });
  check('Absence partielle : la nuit conserve trois présents chaque jour',()=>{
    const ops=fixture(9), abs={1:['P3|1|Lun','P4|1|Mar','P5|1|Mer']};
    const s=buildSchedules(ops,1,1,abs).schedules[0];expect(!errors(s).length);
    expect([1,2,3,4,5].every(day=>s.nuit.filter(n=>!absentOnDay(n,1,day,abs)).length>=3));
  });
  check('Chef absent un jour : publication invalidée par une erreur quotidienne',()=>{
    const s=buildSchedules(fixture(),1,1,{1:['P0|1|Mer']}).schedules[0];expect(s.issues.some(i=>i.code==='daily-leader'));
  });
  check('Chef remplaçant automatique disponible : couvre le congé partiel',()=>{
    const s=buildSchedules(fixture(9,4),1,1,{1:['P0|1|Mer']}).schedules[0];expect(!errors(s).length&&!where(s,'P0'));
  });
  check('Jour fermé : l’absence du chef ce jour-là ne crée pas de faux conflit',()=>{
    const s=buildSchedules(fixture(),1,1,{1:['P0|1|Mer']},{},{},{},{year:2026,joursChomes:{'1-31/12':true}}).schedules[0];expect(!errors(s).length);
  });
  check('Samedi nuit travaillé : l’absence partielle y est contrôlée',()=>{
    const ops=fixture(),slots={matin:['P0','P3','P4'],am:['P1','P5'],nuit:['P2','P6','P7']};
    const issues=validateSchedule(slots,ops,1,{1:['P6|1|Sam']},{},{},{satWeeks:[1],satEndPostes:{1:'N'}});
    expect(issues.some(i=>i.code==='daily-night'));
    expect(!validateSchedule(slots,ops,1,{1:['P6|1|Sam']},{},{},{satWeeks:[1],satEndPostes:{1:'AM'}}).some(i=>i.code==='daily-night'));
  });
  check('Ajustement : absents complets et doublons nettoyés, archives intactes',()=>{
    const ops=fixture();ops[7].isVolant=true;
    const slots={matin:['P0','P3','P7'],am:['P1','P3','P4'],nuit:['P2','P5','P6']};
    const r=buildSchedules(ops,1,2,{2:['P7']},{},{2:slots},{1:slots});
    expect(same(r.schedules[0].matin,slots.matin));expect(!where(r.schedules[1],'P7'));
    const all=SHIFTS.flatMap(k=>r.schedules[1][k]);expect(new Set(all).size===all.length);
  });
  check('Ajustement non conforme : binôme séparé et deux chefs détectés',()=>{
    const ops=linkOperators(fixture(),'p3','p4');
    const issues=validateSchedule({matin:['P0','P1','P3'],am:['P4','P5'],nuit:['P2','P6','P7']},ops,1);
    expect(issues.some(i=>i.code==='pair-split')&&issues.some(i=>i.code==='leader-count'));
  });
  check('Glissement et échange : binôme entier déplacé sans doublon',()=>{
    const ops=linkOperators(fixture(),'p3','p4'),slots={matin:['P0','P3','P4'],am:['P1','P5'],nuit:['P2','P6','P7']};
    const moved=moveAssignment(slots,ops,1,{}, {},'P3','am');expect(where(moved,'P3')==='am'&&where(moved,'P4')==='am');
    const swapped=moveAssignment(slots,ops,1,{}, {},'P3','am','P5');expect(where(swapped,'P5')==='matin'&&where(swapped,'P4')==='am');
    expect(new Set(SHIFTS.flatMap(k=>swapped[k])).size===8);
  });
  check('Chef : déplacement sur un second chef refusé, échange accepté',()=>{
    const ops=fixture(),slots={matin:['P0','P3','P4'],am:['P1','P5'],nuit:['P2','P6','P7']};
    mustThrow(()=>moveAssignment(slots,ops,1,{}, {},'P0','am'));
    expect(where(moveAssignment(slots,ops,1,{}, {},'P0','am','P1'),'P1')==='matin');
  });
  check('Volant chef : remplacement d’un chef, sans doublon ni indisponible',()=>{
    const ops=fixture(9);ops[8].isLeader=true;ops[8].isVolant=true;
    const slots={matin:['P0','P3','P4'],am:['P1','P5'],nuit:['P2','P6','P7']};
    const moved=moveAssignment(slots,ops,1,{}, {},'P8','am','P1');expect(where(moved,'P8')==='am'&&!where(moved,'P1'));
    mustThrow(()=>moveAssignment(slots,ops,1,{1:['P8']},{},'P8','am','P1'));
  });
  check('Départ et changements de rôle ne réécrivent pas les archives',()=>{
    const ops=fixture(),old=buildSchedules(ops,1,4).schedules,archive=Object.fromEntries(old.map(s=>[s.s,s]));
    const before=JSON.stringify(archive);ops[0].active=false;ops[1].level='N1';ops[1].isLeader=false;
    const sc=buildSchedules(ops,1,4,{1:['P3']},{},{1:{matin:[],am:[],nuit:[]}},archive).schedules;
    expect(sc.every((s,i)=>SHIFTS.every(k=>same(s[k],old[i][k]))));expect(JSON.stringify(archive)===before);
  });
  check('Équité : absence complète exclue des semaines disponibles',()=>{
    const r=buildSchedules(fixture(),1,4,{2:['P3']},{3:['P3']});expect(r.presentCount.P3===2&&r.presentCount.P4===4);
  });
  check('La longueur et le début de la fenêtre ne changent pas les rotations',()=>{
    const ops=fixture(),abs={6:['P3','P4']};
    const a=buildSchedules(ops,1,5,abs).schedules,b=buildSchedules(ops,1,12,abs).schedules;
    expect(same(a,b.slice(0,5)));expect(same(buildSchedules(ops,4,5,abs).schedules,b.slice(3,8)));
  });
  check('Une recherche interrompue ne prétend jamais avoir trouvé un résultat garanti',()=>{
    const s=buildSchedules(fixture(),1,1,{},{},{},{},{searchLimit:2}).schedules[0];expect(s.issues.some(i=>i.code==='search-limit'));
  });

  // Independent exhaustive oracle for small staffing cases; no production helpers
  // are used to enumerate assignments or decide their feasibility/overlap.
  check('Oracle exhaustif : nuit consécutive uniquement si indispensable (16 cas)',()=>{
    for(let scenario=0;scenario<16;scenario++) {
      const ops=fixture(6+scenario%3),previous={matin:['P0'],am:['P1'],nuit:scenario%2?['P2','P3','P4']:['P0','P4','P5']};
      if(scenario%4===0){ops[3].partnerId='p4';ops[4].partnerId='p3';}
      let optimum=Infinity;
      const choices=Array(ops.length).fill(0);
      const visit=i=>{
        if(i===ops.length) {
          if([0,1,2].some(k=>ops.filter((o,j)=>o.isLeader&&choices[j]===k).length!==1))return;
          if(choices.filter(k=>k===2).length<3)return;
          if(ops[3].partnerId&&choices[3]!==choices[4])return;
          optimum=Math.min(optimum,ops.filter((o,j)=>choices[j]===2&&previous.nuit.includes(o.short)).length);return;
        }
        for(let k=0;k<3;k++){choices[i]=k;visit(i+1);}
      };
      visit(0);
      const s=buildSchedules(ops,2,1,{},{},{},{1:previous}).schedules[0];
      const repeated=s.nuit.filter(n=>previous.nuit.includes(n)).length;
      expect(repeated===optimum,`Scénario ${scenario}: ${repeated} au lieu de ${optimum}`);
    }
  });
  return results;
}
