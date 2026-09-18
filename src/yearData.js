import {normalizeOperators} from './scheduler.js';
import {stableSerialize} from './state.js';

export const ANNUAL_KEYS=['absences','leaves','overrides','satweeks','satendpostes','jourschomes','joursamenages','notes','history','redostack','planning_draft','locks','dailyOverrides'];
export function emptyYear(){return {absences:{},leaves:{},overrides:{},satweeks:[],satendpostes:{},jourschomes:{},joursamenages:{},notes:{},history:[],redostack:[],planning_draft:null,locks:{},dailyOverrides:{}};}
export function migrateYears(existing,legacy,year){
  if(existing?.version===2)return structuredClone(existing);
  const data=emptyYear();
  for(const key of ANNUAL_KEYS)if(legacy[key]!=null)data[key]=structuredClone(legacy[key]);
  return {version:2,legacyYear:year,years:{[year]:data}};
}
export function yearData(store,year){return {...emptyYear(),...store?.years?.[year]};}
export function setYearValue(store,year,key,value){
  return {...store,version:2,years:{...store.years,[year]:{...yearData(store,year),[key]:structuredClone(value)}}};
}
// Keep global employment boundaries; derived week fields only belong to the viewed year.
export function migrateEmployment(operators,legacyYear){
  return normalizeOperators(operators).map(op=>({...op,
    employmentFrom:op.employmentFrom!==undefined?op.employmentFrom:op.fromWeek?{year:legacyYear,week:op.fromWeek}:null,
    employmentTo:op.employmentTo!==undefined?op.employmentTo:op.toWeek?{year:legacyYear,week:op.toWeek}:null,
  }));
}
export function operatorsInYear(operators,year){
  return operators.map(op=>({...op,
    active:!!op.active && (!op.employmentFrom || year>=op.employmentFrom.year) && (!op.employmentTo || year<=op.employmentTo.year),
    fromWeek:op.employmentFrom ? (op.employmentFrom.year===year?op.employmentFrom.week:undefined) : op.fromWeek,
    toWeek:op.employmentTo ? (op.employmentTo.year===year?op.employmentTo.week:undefined) : op.toWeek,
  }));
}

export function mergeYearOperatorEdits(records,edited,year){
  const previous=operatorsInYear(records,year);
  return edited.map(op=>{
    const original=records.find(o=>o.id===op.id), before=previous.find(o=>o.id===op.id);
    if(!original)return op;
    const result={...original};
    for(const key of Object.keys(op))if(stableSerialize(op[key])!==stableSerialize(before[key]))result[key]=op[key];
    return result;
  });
}
