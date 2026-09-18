import {yearData,emptyYear,operatorsInYear} from "./yearData.js";
import {buildSchedules,applyDailyPlanning,daySlots} from "./scheduler.js";
import {getMondayOfWeek,fmtDate,isoWeek,weeksInYear} from "./dates.js";
// ── PARAMÈTRES PAIE (calcul des heures) ──────────────────────────────────────
// Réglages validés avec le dirigeant. À ajuster ici si la convention change.
export const PAID_HOURS_PER_SHIFT = 7;      // heures payées par poste (pause déduite)
export const NIGHT_WINDOW = [22, 6];        // heures de nuit : 22h → 6h
export const WEEKLY_BASE  = 35;             // seuil hebdomadaire des heures supplémentaires
// Présence réelle de chaque poste (heures décimales, horloge continue : 6h = 30)
export const SHIFT_PRESENCE = {
  matin: [5+50/60, 14],
  am:    [13+50/60, 22],
  nuit:  [21+50/60, 24+6],
};
export const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// Chevauchement (en heures) de l'intervalle [a,b] avec [lo,hi]
function overlapHours(a,b,lo,hi){ return Math.max(0, Math.min(b,hi)-Math.max(a,lo)); }
// Heures de nuit payées d'un poste = présence ∩ plage de nuit, plafonnée aux heures payées.
export function nightHoursForShift(key){
  const p=SHIFT_PRESENCE[key]; if(!p) return 0;
  const [s,e]=p, [ns,ne]=NIGHT_WINDOW;
  // La plage de nuit traverse minuit : on la couvre en [ns, ne+24] et [ns-24, ne].
  const night = overlapHours(s,e,ns,ne+24) + overlapHours(s,e,ns-24,ne);
  return Math.min(night, PAID_HOURS_PER_SHIFT);
}
export const NIGHT_HOURS = { matin:nightHoursForShift("matin"), am:nightHoursForShift("am"), nuit:nightHoursForShift("nuit") };
// Jours d'un mois calendaire — gère février et années bissextiles via l'objet Date.
export function daysInMonth(year, month /*0-11*/){ return new Date(year, month+1, 0).getDate(); }
// Heures décimales → "Hh MM" (ex. 7 → "7h00", 0,1667 → "0h10", 35,5 → "35h30")
export function fmtHours(h){ const m=Math.round(h*60); return `${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}`; }


function hhmmToDec(str){ const [h,m]=String(str||"0:0").split(":").map(Number); return (h||0)+(m||0)/60; }
export function nightHoursForWindow(sStr,eStr){
  let s=hhmmToDec(sStr), e=hhmmToDec(eStr);
  if(e<=s) e+=24; // créneau qui traverse minuit
  const [ns,ne]=NIGHT_WINDOW;
  return Math.min(overlapHours(s,e,ns,ne+24)+overlapHours(s,e,ns-24,ne), PAID_HOURS_PER_SHIFT);
}

export function computeMonthHours(mYear,mMonth,options){
  const {operators,archive={},yearStore}=options;
  const weeks=new Map();
  for(let day=1;day<=daysInMonth(mYear,mMonth);day++){
    const ref=isoWeek(new Date(mYear,mMonth,day));weeks.set(`${ref.year}-${ref.week}`,ref);
  }
  const byYear=new Map();
  for(const {year,week} of weeks.values()){
    if(byYear.has(year))continue;
    const data=yearStore?yearData(yearStore,year):year===mYear?{
      ...emptyYear(),absences:options.absences||{},leaves:options.leaves||{},overrides:options.overrides||{},
      satweeks:options.satWeeks||[],satendpostes:options.satEndPostes||{},jourschomes:options.joursChomes||{},joursamenages:options.joursAmenages||{},
      locks:options.locks||{},dailyOverrides:options.dailyOverrides||{},
    }:emptyYear();
    const scheduleOptions={year,satWeeks:data.satweeks,satEndPostes:data.satendpostes,joursChomes:data.jourschomes,joursAmenages:data.joursamenages,locks:data.locks,dailyOverrides:data.dailyOverrides,previousSchedule:archive[year-1]?.[weeksInYear(year-1)]};
    const ops=operatorsInYear(operators,year);
    const maxWeek=Math.max(...[...weeks.values()].filter(ref=>ref.year===year).map(ref=>ref.week));
    const {schedules}=buildSchedules(ops,1,maxWeek,data.absences,data.leaves,data.overrides,archive[year]||{},scheduleOptions);
    const daily=applyDailyPlanning(schedules,ops,year,data.absences,data.leaves,scheduleOptions);
    byYear.set(year,{data,scheduleOptions,schedules:new Map(daily.map(sc=>[sc.s,sc]))});
  }
  const result=new Map(operators.map(op=>[op.short,{op,total:0,night:0,sup:0,days:0,sat:0}]));
  for(const {year,week} of weeks.values()){
    const {data,scheduleOptions,schedules}=byYear.get(year),sc=schedules.get(week);if(!sc)continue;
    const monday=getMondayOfWeek(week,year);
    for(const op of operators){
      let weekly=0,total=0,night=0,days=0,sat=0;
      for(let offset=0;offset<6;offset++){
        const date=new Date(monday);date.setDate(date.getDate()+offset);
        const slots=daySlots(sc,year,offset+1,data.absences,data.leaves,scheduleOptions);
        const shift=['matin','am','nuit'].find(k=>slots[k].includes(op.short));if(!shift)continue;
        weekly+=PAID_HOURS_PER_SHIFT;
        if(date.getFullYear()!==mYear||date.getMonth()!==mMonth)continue;
        total+=PAID_HOURS_PER_SHIFT;days++;if(offset===5)sat++;
        const window=data.joursamenages[`${week}-${fmtDate(date)}`]?.[shift];
        night+=window?nightHoursForWindow(window.s,window.e):NIGHT_HOURS[shift];
      }
      const row=result.get(op.short);
      row.total+=total;row.night+=night;row.days+=days;row.sat+=sat;
      if(weekly)row.sup+=Math.max(0,weekly-WEEKLY_BASE)*total/weekly;
    }
  }
  return [...result.values()].filter(row=>row.total>0).map(row=>({...row,normal:Math.max(0,row.total-row.sup)})).sort((a,b)=>b.total-a.total);
}
