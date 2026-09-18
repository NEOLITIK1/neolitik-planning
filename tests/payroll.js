import {computeMonthHours} from '../src/payroll.js';
export function runPayroll(){
  const results=[];
  const op={id:'old',short:'OLD',full:'Ancien opérateur',active:false,level:'N1'};
  const setup=(year,week)=>({operators:[op],archive:{[year]:{[week]:{matin:[],am:[],nuit:['OLD']}}}});
  const check=(name,ok)=>results.push({name,pass:!!ok,detail:ok?'':'Calcul mensuel incorrect'});
  let data=setup(2026,1),rows=computeMonthHours(2026,0,data);
  check('Paie réelle : opérateur inactif conservé dans l’archive, janvier S1 = 14 heures',rows[0]?.total===14&&rows[0]?.night===14);
  rows=computeMonthHours(2026,0,{...data,absences:{1:['OLD']}});
  check('Paie réelle : absence complète neutralise une affectation archivée',rows.length===0);
  rows=computeMonthHours(2026,0,{...data,leaves:{1:['OLD']}});
  check('Paie réelle : congé complet neutralise une affectation archivée',rows.length===0);
  rows=computeMonthHours(2026,0,{...data,absences:{1:['OLD|1|Jeu']}});
  check('Paie réelle : absence ponctuelle = 7 heures déduites',rows[0]?.total===7);
  rows=computeMonthHours(2026,0,{...data,leaves:{1:['OLD:4-5']}});
  check('Paie réelle : congé partiel = jours concernés déduits',rows.length===0);
  rows=computeMonthHours(2026,0,{...data,joursAmenages:{'1-02/01':{nuit:{s:'14:00',e:'22:00'}}}});
  check('Paie réelle : horaires aménagés conservent le payé et modifient la nuit',rows[0]?.total===14&&rows[0]?.night===7);
  data={...setup(2026,18),satWeeks:[18],satEndPostes:{18:'N'}};
  const april=computeMonthHours(2026,3,data)[0],may=computeMonthHours(2026,4,data)[0];
  check('Paie réelle : heures supplémentaires au prorata entre avril et mai',Math.abs(april?.sup-14/3)<1e-8&&Math.abs(may?.sup-7/3)<1e-8&&april?.total===28&&may?.total===14);
  rows=computeMonthHours(2026,4,{...data,satEndPostes:{18:'AM'}});
  check('Paie réelle : samedi nuit non travaillé exclu du total',rows[0]?.total===7&&rows[0]?.sup===0);
  rows=computeMonthHours(2026,4,{...data,joursChomes:{'18-01/05':true}});
  check('Paie réelle : jour chômé exclu, semaine ramenée à 35 heures',rows[0]?.total===7&&rows[0]?.sup===0);
  return results;
}
