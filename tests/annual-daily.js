import {migrateYears,yearData,setYearValue,migrateEmployment,operatorsInYear,mergeYearOperatorEdits,emptyYear} from '../src/yearData.js';
import {buildSchedules,applyDailyPlanning,daySlots,SHIFTS,dailyRestIssues} from '../src/scheduler.js';
import {isoWeek,weeksInYear,isoDate,dateOfDay} from '../src/dates.js';
import {computeMonthHours} from '../src/payroll.js';
import {stableSerialize} from '../src/state.js';
const fixture=(n=9,chiefs=4)=>Array.from({length:n},(_,i)=>({id:`p${i}`,short:`P${i}`,full:`Opérateur P${i}`,level:i<chiefs?'N4':'N1',active:true,isLeader:i<chiefs}));
const base={s:2,matin:['P0','P4','P5'],am:['P1','P6'],nuit:['P2','P7','P8'],issues:[],alerts:[],isOverridden:true};
const empty={matin:[],am:[],nuit:[]};
const errors=sc=>(sc.issues||[]).filter(i=>i.severity==='error');
export function runAnnualDaily(){
  const results=[];const expect=(ok,message='Condition non satisfaite')=>{if(!ok)throw new Error(message);};
  const check=(name,fn)=>{try{fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,detail:e.message});}};
  check('Migration annuelle idempotente : anciennes données uniquement dans leur année',()=>{
    const original={absences:{2:['P0']},leaves:{3:['P1']},history:[{label:'avant'}]};
    const store=migrateYears(null,original,2026);expect(yearData(store,2026).absences[2][0]==='P0');expect(!yearData(store,2027).absences[2]);
    expect(stableSerialize(migrateYears(store,{absences:{1:['autre']}},2027))===stableSerialize(store));
    expect(original.absences[2][0]==='P0');
  });
  check('Écritures de deux années : ni mélange des absences, ni écrasement du journal',()=>{
    let store=migrateYears(null,{history:[{label:'2026'}]},2026);
    store=setYearValue(store,2027,'absences',{2:['P4']});store=setYearValue(store,2026,'locks',{4:{p0:'nuit'}});
    expect(!yearData(store,2026).absences[2]&&yearData(store,2027).absences[2][0]==='P4');
    expect(yearData(store,2026).history[0].label==='2026'&&yearData(store,2027).history.length===0);
  });
  check('Contrat terminé en 2026 : pas de réapparition automatique en 2027',()=>{
    const ops=migrateEmployment([{...fixture()[0],fromWeek:10,toWeek:40}],2026);
    expect(operatorsInYear(ops,2026)[0].toWeek===40&&!operatorsInYear(ops,2027)[0].active);
    expect(!operatorsInYear(ops,2025)[0].active);
  });
  check('Édition de niveau dans une autre année : activité et dates globales préservées',()=>{
    const ops=migrateEmployment([{...fixture()[0],toWeek:40}],2026),view=operatorsInYear(ops,2027);view[0].level='N2';
    const result=mergeYearOperatorEdits(ops,view,2027);
    expect(result[0].active&&result[0].employmentTo.year===2026&&result[0].level==='N2');
  });
  check('Années ISO : 2026 contient 53 semaines, 2027 en contient 52',()=>{
    expect(weeksInYear(2026)===53&&weeksInYear(2027)===52);
    expect(isoWeek(new Date(2027,0,1)).year===2026&&isoWeek(new Date(2027,0,1)).week===53);
    expect(isoWeek(new Date(2025,11,29)).year===2026&&isoWeek(new Date(2025,11,29)).week===1);
  });
  check('Verrouillage individuel : le poste reste fixé après recalcul',()=>{
    const ops=fixture(8,3),locks={2:{p3:'nuit'}};
    const sc=buildSchedules(ops,1,4,{},{},{},{},{year:2026,locks}).schedules;
    expect(sc[1].nuit.includes('P3')&&!errors(sc[1]).length);
  });
  check('Un binôme suit le verrouillage de son partenaire',()=>{
    const ops=fixture(8,3);ops[3].partnerId='p4';ops[4].partnerId='p3';
    const s=buildSchedules(ops,1,1,{},{},{},{},{locks:{1:{p3:'nuit'}}}).schedules[0];
    expect(s.nuit.includes('P3')&&s.nuit.includes('P4'));
  });
  check('Deux chefs verrouillés en nuit : conflit explicite',()=>{
    const s=buildSchedules(fixture(8,3),1,1,{},{},{},{},{locks:{1:{p0:'nuit',p1:'nuit'}}}).schedules[0];
    expect(errors(s).length>0&&s.issues.some(i=>i.code==='locked-assignment'));
  });
  check('Contexte de nuit de décembre conservé pour la première semaine de janvier',()=>{
    const ops=fixture(8,3),previous={matin:['P0'],am:['P1'],nuit:['P2','P3','P4']};
    const sc=buildSchedules(ops,1,1,{},{},{},{},{year:2027,previousSchedule:previous}).schedules[0];
    expect(sc.nuit.every(n=>!previous.nuit.includes(n)));
  });
  check('Chef absent mardi : réserve mobilisée uniquement mardi',()=>{
    const abs={2:['P0|2|Mar']},sc=applyDailyPlanning([base],fixture(),2026,abs)[0];
    expect(daySlots(sc,2026,2,abs).matin.includes('P3'));
    expect(daySlots(sc,2026,1,abs).matin.includes('P0')&&daySlots(sc,2026,3,abs).matin.includes('P0'));
    expect(!daySlots(sc,2026,1,abs).matin.includes('P3')&&!errors(sc).length);
  });
  check('Absence partielle : aucun opérateur n’est compté présent le jour absent',()=>{
    const abs={2:['P0|2|Mar','P5|2|Mer']},sc=applyDailyPlanning([base],fixture(),2026,abs)[0];
    expect(!SHIFTS.some(k=>daySlots(sc,2026,2,abs)[k].includes('P0')));
    expect(!SHIFTS.some(k=>daySlots(sc,2026,3,abs)[k].includes('P5')));
  });
  check('Sans chef remplaçant : publication reste impossible',()=>{
    const ops=fixture();ops[3].active=false;
    const sc=applyDailyPlanning([base],ops,2026,{2:['P0|2|Mar']})[0];expect(errors(sc).length>0);
  });
  check('Ajustement journalier : conservé sur une seule date',()=>{
    const date=isoDate(dateOfDay(2026,2,3));
    const override={matin:['P3','P4','P5'],am:['P1','P6'],nuit:['P2','P7','P8']};
    const sc=applyDailyPlanning([base],fixture(),2026,{},{},{dailyOverrides:{[date]:override}})[0];
    expect(daySlots(sc,2026,3).matin.includes('P3')&&!daySlots(sc,2026,2).matin.includes('P3'));
    expect(sc.dailyChanges.some(c=>c.name==='P3'&&c.day===3));
  });
  check('Une journée manuelle ne contourne pas un verrouillage hebdomadaire',()=>{
    const date=isoDate(dateOfDay(2026,2,3));
    const sc=applyDailyPlanning([base],fixture(),2026,{},{},{locks:{2:{p0:'matin'}},dailyOverrides:{[date]:{matin:['P3','P4','P5'],am:['P1','P6'],nuit:['P2','P7','P8']}}})[0];
    expect(sc.issues.some(i=>i.code==='locked-assignment'));
  });
  check('Remplacement journalier : enchaînement nuit puis matin refusé',()=>{
    const slots={matin:['P0','P4'],am:['P1','P6'],nuit:['P2','P5','P7','P8']};
    expect(dailyRestIssues(slots,base,fixture(),2026,3,{},{},{}).some(i=>i.code==='daily-rest'&&i.message.includes('P5')));
  });
  check('Archives journalières : jamais recalculées après une modification d’effectif',()=>{
    const sc=applyDailyPlanning([base],fixture(),2026,{2:['P0|2|Mar']})[0];sc.isArchived=true;
    const before=JSON.stringify(sc),next=applyDailyPlanning([sc],[],2026,{},{},{});
    expect(JSON.stringify(next[0])===before);
  });
  check('Paie : le remplaçant travaille 7 h, le chef absent seulement 28 h',()=>{
    const data={...emptyYear(),absences:{2:['P0|2|Mar']},overrides:{2:base}};
    const store={version:2,years:{2026:data}},archive={2026:{1:empty,3:empty,4:empty,5:empty}};
    const rows=computeMonthHours(2026,0,{operators:fixture(),archive,yearStore:store});
    expect(rows.find(r=>r.op.short==='P3')?.total===7);
    expect(rows.find(r=>r.op.short==='P0')?.total===28);
  });
  check('Paie janvier 2027 : les jours de S53 2026 sont comptés avec les absences 2026',()=>{
    const op={id:'old',short:'OLD',full:'OLD',level:'N1',active:false};
    const archive={2026:{53:{matin:[],am:[],nuit:['OLD']}}};
    const years={2026:{...emptyYear(),absences:{53:['OLD|53|Lun']}},2027:emptyYear()};
    const row=computeMonthHours(2027,0,{operators:[op],archive,yearStore:{version:2,years}})[0];
    expect(row?.total===7&&row?.night===7);
    years[2026].absences={53:['OLD|53|Ven']};
    expect(computeMonthHours(2027,0,{operators:[op],archive,yearStore:{version:2,years}}).length===0);
  });
  check('Paie décembre 2025 : les jours de S1 2026 utilisent les réglages 2026',()=>{
    const op={id:'old',short:'OLD',full:'OLD',level:'N1',active:false};
    const archive={2026:{1:{matin:[],am:[],nuit:['OLD']}}};
    const years={2025:emptyYear(),2026:{...emptyYear(),absences:{1:['OLD|1|Mar']}}};
    const row=computeMonthHours(2025,11,{operators:[op],archive,yearStore:{version:2,years}})[0];expect(row?.total===14);
  });
  return results;
}
