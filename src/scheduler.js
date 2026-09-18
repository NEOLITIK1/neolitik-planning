// Pure scheduling rules shared by the application and its tests. No network or UI.
import {dateOfDay,isoDate} from './dates.js';
export const SHIFTS = ['matin', 'am', 'nuit'];
const LABELS = ['Matin', 'AM', 'Nuit'];
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const isLeader = op => !!op && (typeof op.isLeader === 'boolean' ? op.isLeader : op.level === 'N4');
export const normalizeOperators = ops => ops.map(op => ({...op, isLeader:isLeader(op), partnerId:op.partnerId || null}));
export const inWindow = (op, week) => (!op.fromWeek || week >= op.fromWeek) && (!op.toWeek || week <= op.toWeek);
export const isFullAbsent = (name, week, absences={}, leaves={}) =>
  (absences[week] || []).includes(name) || (leaves[week] || []).includes(name);
export function absentOnDay(name, week, day, absences={}, leaves={}) {
  return isFullAbsent(name, week, absences, leaves) ||
    (absences[week] || []).includes(`${name}|${week}|${DAYS[day]}`) ||
    (leaves[week] || []).some(entry => {
      const [short, range] = entry.split(':');
      if (short !== name || !range) return false;
      const [start, end] = range.split('-').map(Number);
      return day >= start && day <= end;
    });
}
export function openDays(week, options={}) {
  const jan4 = new Date(options.year || 2026, 0, 4);
  jan4.setDate(jan4.getDate() - ((jan4.getDay()+6)%7) + (week-1)*7);
  return SHIFTS.map((_, shift) => [1,2,3,4,5,6].filter(day => {
    if (day === 6 && (!(options.satWeeks || []).includes(week) ||
      shift > ({M:0, AM:1, N:2}[options.satEndPostes?.[week] || 'N']))) return false;
    const date = new Date(jan4); date.setDate(date.getDate()+day-1);
    const dateStr = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
    return !options.joursChomes?.[`${week}-${dateStr}`];
  }));
}

// Pairing is mutual and exclusive. Re-pairing releases both former partners.
export function linkOperators(operators, id, partnerId) {
  const op = operators.find(o => o.id === id);
  const partner = operators.find(o => o.id === partnerId);
  if (!op || (partnerId && !partner)) throw new Error('Opérateur introuvable.');
  if (id === partnerId) throw new Error('Un opérateur ne peut pas être son propre binôme.');
  if (partner && isLeader(op) && isLeader(partner)) throw new Error('Deux chefs ne peuvent pas former un binôme.');
  if (partner && (!!op.isVolant !== !!partner.isVolant)) throw new Error('Les deux membres doivent avoir le même mode (automatique ou volant).');
  const changed = new Set([id, partnerId].filter(Boolean));
  return normalizeOperators(operators).map(o => ({...o, partnerId:
    o.id === id ? partnerId || null : o.id === partnerId ? id :
    changed.has(o.partnerId) ? null : o.partnerId}));
}

function groupsFor(available) {
  const groups = [], visited = new Set();
  for (const op of available) {
    if (visited.has(op.id)) continue;
    const group = [], queue = [op];
    while (queue.length) {
      const item = queue.pop();
      if (visited.has(item.id)) continue;
      visited.add(item.id); group.push(item);
      available.filter(o => o.id === item.partnerId || o.partnerId === item.id).forEach(o => queue.push(o));
    }
    groups.push(group);
  }
  return groups.sort((a,b) => b.filter(isLeader).length-a.filter(isLeader).length || b.length-a.length || a[0].id.localeCompare(b[0].id));
}

export function cleanOverride(slots, operators, week, absences={}, leaves={}) {
  const seen = new Set(), removed = [];
  const result = Object.fromEntries(SHIFTS.map(key => [key, (slots[key] || []).flatMap(name => {
    const op = operators.find(o => o.short === name || o.full === name);
    if (!op || !op.active || !inWindow(op,week) || isFullAbsent(op.short,week,absences,leaves) || seen.has(op.short)) {
      removed.push(name); return [];
    }
    seen.add(op.short); return [op.short];
  })]));
  return {slots:result, removed};
}

export function validateSchedule(slots, operators, week, absences={}, leaves={}, previous={}, options={}) {
  const issues = [], seen = new Set(), days = options.onlyDay ? openDays(week, options).map(list=>list.filter(d=>d===options.onlyDay)) : openDays(week,options);
  const add = (code, message, severity='error') => issues.push({code, message:`S${week} : ${message}`, severity});
  SHIFTS.forEach((key,index) => {
    const names = slots[key] || [], ops = names.map(name => operators.find(o => o.short === name)).filter(Boolean);
    if(options.onlyDay && !days[index].length && names.length)add('closed-shift', `${LABELS[index]} est fermé ce jour`);
    const leaders = ops.filter(isLeader);
    if (days[index].length && leaders.length !== 1) add('leader-count', `${LABELS[index]} — ${leaders.length} chef(s), exactement 1 requis`);
    if (days[index].length && key === 'nuit' && names.length < 3) add('night-min', `Nuit — ${names.length}/3 personnes minimum`);
    for (const name of names) {
      if (seen.has(name)) add('duplicate', `${name} affecté à plusieurs postes`);
      seen.add(name);
      const op = operators.find(o => o.short === name);
      if (!op || !op.active || !inWindow(op,week) || isFullAbsent(name,week,absences,leaves) || (options.onlyDay && absentOnDay(name,week,options.onlyDay,absences,leaves))) add('unavailable', `${name} indisponible en ${LABELS[index]}`);
    }
    for (const day of days[index]) {
      const present = ops.filter(o => !absentOnDay(o.short,week,day,absences,leaves));
      if (leaders.length === 1 && !present.some(isLeader)) add('daily-leader', `${DAYS[day]} ${LABELS[index]} — chef absent, remplacement nécessaire`);
      if (key === 'nuit' && names.length >= 3 && present.length < 3) add('daily-night', `${DAYS[day]} Nuit — ${present.length}/3 présents minimum`);
    }
  });
  const available = operators.filter(o => o.active && inWindow(o,week) && !isFullAbsent(o.short,week,absences,leaves));
  const present=options.onlyDay?available.filter(o=>!absentOnDay(o.short,week,options.onlyDay,absences,leaves)):available;
  for(const op of present){
    const locked=options.locks?.[week]?.[op.id];
    if(locked && days[SHIFTS.indexOf(locked)]?.length && !(slots[locked]||[]).includes(op.short))add('locked-assignment', `${op.short} est verrouillé en ${locked}`);
  }
  for (const group of groupsFor(present)) {
    if (group.length < 2) continue;
    const positions = group.map(o => SHIFTS.find(key => (slots[key] || []).includes(o.short)) || 'reserve');
    if (new Set(positions).size > 1) add('pair-split', `Binôme séparé : ${group.map(o=>o.short).join(' + ')}`);
    if (group.filter(isLeader).length > 1) add('pair-leaders', `Binôme incompatible : deux chefs (${group.map(o=>o.short).join(' + ')})`);
    if (new Set(group.map(o=>!!o.isVolant)).size > 1) add('pair-mode', 'Un binôme mélange mode automatique et volant');
  }
  const repeated = (slots.nuit || []).filter(name => (previous.nuit || []).includes(name));
  if (repeated.length) add('repeat-night', `Nuits consécutives : ${repeated.join(', ')}${options.automatic ? ' — minimum nécessaire avec les contraintes de cette semaine' : ' — ajustement manuel'}`, 'warning');
  if (days[0].length && (slots.matin || []).length < 3) add('day-staff', `Matin — ${(slots.matin || []).length}/3 conseillés`, 'warning');
  if (days[1].length && (slots.am || []).length < 2) add('day-staff', `AM — ${(slots.am || []).length}/2 conseillés`, 'warning');
  return issues;
}

export function daySlots(schedule,year,day,absences={},leaves={},options={}){
  const date=isoDate(dateOfDay(year,schedule.s,day));
  const source=schedule.dailySchedules?.[date] || schedule;
  const open=openDays(schedule.s,{...options,year});
  return Object.fromEntries(SHIFTS.map((key,i)=>[key,open[i].includes(day)?(source[key]||[]).filter(n=>!absentOnDay(n,schedule.s,day,absences,leaves)):[]]));
}

function shiftWindow(key,week,year,day,options){
  const date=dateOfDay(year,week,day),dateStr=`${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`;
  const entry=options.joursAmenages?.[`${week}-${dateStr}`]?.[key];
  const number=value=>{const [h,m]=value.split(':').map(Number);return h+m/60;};
  const standard={matin:[5+50/60,14],am:[13+50/60,22],nuit:[21+50/60,30]};
  let [start,end]=entry?[number(entry.s),number(entry.e)]:standard[key];
  if(end<=start)end+=24;
  return [day*24+start,day*24+end];
}

// Extra checks for a one-day change. The weekly rotation itself is retained.
export function dailyRestIssues(slots,schedule,operators,year,day,absences,leaves,options={}){
  const issues=[];
  for(const op of operators){
    const key=SHIFTS.find(k=>slots[k].includes(op.short));if(!key)continue;
    const window=shiftWindow(key,schedule.s,year,day,options);
    for(const adjacent of [day-1,day+1]){
      if(adjacent<1||adjacent>6)continue;
      const other=daySlots(schedule,year,adjacent,absences,leaves,options);
      const otherKey=SHIFTS.find(k=>other[k].includes(op.short));if(!otherKey)continue;
      const weeklyKey=SHIFTS.find(k=>(schedule[k]||[]).includes(op.short));
      if(key===weeklyKey && otherKey===weeklyKey)continue;
      const otherWindow=shiftWindow(otherKey,schedule.s,year,adjacent,options);
      const rest=adjacent<day?window[0]-otherWindow[1]:otherWindow[0]-window[1];
      if(rest<(options.minimumRestHours??11)-1e-8)issues.push({severity:'error',code:'daily-rest',message:`S${schedule.s} : ${op.short} — repos de ${rest.toFixed(1)} h entre ${DAYS[Math.min(day,adjacent)]} et ${DAYS[Math.max(day,adjacent)]}, minimum de planification ${options.minimumRestHours??11} h`});
    }
  }
  return issues;
}

export function proposeDay(schedule,operators,year,day,absences={},leaves={},options={}){
  const week=schedule.s;
  const absent=operators.filter(o=>absentOnDay(o.short,week,day,absences,leaves)).map(o=>o.short);
  const dayAbs={...absences,[week]:[...(absences[week]||[]),...absent]};
  const base=daySlots(schedule,year,day,absences,leaves,options);
  const available=normalizeOperators(operators).filter(o=>o.active && inWindow(o,week) && !absent.includes(o.short) &&
    (!o.isVolant || SHIFTS.some(k=>base[k].includes(o.short)) || options.includeVolants));
  const {candidates,limited}=candidatesFor(available,week,dayAbs,leaves,{...options,year,onlyDay:day});
  let best=null,score=null;
  for(const candidate of candidates){
    const slots=Object.fromEntries(SHIFTS.map((k,i)=>[k,candidate.slots[i]]));
    const rest=dailyRestIssues(slots,schedule,operators,year,day,absences,leaves,options).length;
    const changes=available.reduce((n,op)=>n+(SHIFTS.find(k=>base[k].includes(op.short))!==SHIFTS.find(k=>slots[k].includes(op.short))?1:0),0);
    const current=[rest,changes,Math.max(0,slots.nuit.length-3),Math.abs(slots.matin.length-slots.am.length)];
    if(!score||lexLess(current,score)){best=slots;score=current;}
  }
  const slots=best||base;
  const issues=[...validateSchedule(slots,operators,week,absences,leaves,{}, {...options,year,onlyDay:day}),...dailyRestIssues(slots,schedule,operators,year,day,absences,leaves,options)];
  if(limited)issues.push({severity:'error',code:'search-limit',message:`S${week} : recherche journalière incomplète`});
  return {...slots,issues};
}

export function applyDailyPlanning(schedules,operators,year,absences={},leaves={},options={}){
  return schedules.map(base=>{
    if(base.isArchived)return base; // stored daily assignments have the same protection as weekly ones
    const schedule={...base,dailySchedules:{},dailyChanges:[]};
    const weekIssues=(base.issues||[]).filter(i=>!['leader-count','night-min','daily-leader','daily-night','infeasible','pair-split','locked-assignment'].includes(i.code));
    for(let day=1;day<=6;day++){
      const date=isoDate(dateOfDay(year,base.s,day));
      const original=daySlots(base,year,day,absences,leaves,options);
      const manual=options.dailyOverrides?.[date];
      let slots=original;
      if(manual)slots=cleanOverride(manual,operators,base.s,absences,leaves).slots;
      else if(validateSchedule(slots,operators,base.s,absences,leaves,{}, {...options,year,onlyDay:day}).some(i=>i.severity==='error')){
        const proposed=proposeDay(schedule,operators,year,day,absences,leaves,options);
        if(!proposed.issues.some(i=>i.severity==='error'))slots=Object.fromEntries(SHIFTS.map(k=>[k,proposed[k]]));
      }
      schedule.dailySchedules[date]={...slots,isOverridden:!!manual};
      for(const op of operators){
        const before=SHIFTS.find(k=>original[k].includes(op.short)), after=SHIFTS.find(k=>slots[k].includes(op.short));
        if(before!==after)schedule.dailyChanges.push({date,day,name:op.short,from:before||'réserve',to:after||'réserve'});
      }
    }
    for(let day=1;day<=6;day++){
      const date=isoDate(dateOfDay(year,base.s,day)),slots=schedule.dailySchedules[date];
      const issues=[...validateSchedule(slots,operators,base.s,absences,leaves,{}, {...options,year,onlyDay:day}),...dailyRestIssues(slots,schedule,operators,year,day,absences,leaves,options)]
        .filter(i=>i.severity==='error');
      schedule.dailySchedules[date].issues=issues;
      weekIssues.push(...issues.map(i=>({...i,message:`${date} — ${i.message}`})));
    }
    if(schedule.dailyChanges.length)weekIssues.push({severity:'info',code:'daily-change',message:`S${base.s} : ${schedule.dailyChanges.length} changement(s) journalier(s), voir le détail des remplacements ou la vue Jours`});
    schedule.issues=weekIssues;schedule.alerts=issueAlerts(weekIssues);
    return schedule;
  });
}
export const issueAlerts = issues => issues.map(i => `${i.severity === 'error' ? '⛔' : i.severity === 'warning' ? '⚠' : 'ℹ'} ${i.message}`);

// Enumerate full assignments (rather than selecting each shift greedily).
// Candidate sets are reused across weeks with identical availability.
function candidatesFor(available, week, absences, leaves, options) {
  const groups = groupsFor(available), days = options.onlyDay ? openDays(week, options).map(list=>list.filter(d=>d===options.onlyDay)) : openDays(week, options);
  const locks=options.locks?.[week] || {};
  const leadersAvailable = available.filter(isLeader).length;
  const slots = [[],[],[]], leaders = [0,0,0], reserved = [];
  let candidates = [], bestHard = Infinity, nodes = 0, limited = false;
  const limit = options.searchLimit ?? 600000;
  function visit(index) {
    if (++nodes > limit) { limited = true; return; }
    if (index === groups.length) {
      let hard = 0;
      for (let shift=0;shift<3;shift++) {
        if (days[shift].length && leaders[shift] !== 1) hard += 100;
        for (const day of days[shift]) {
          const present = slots[shift].filter(o=>!absentOnDay(o.short,week,day,absences,leaves));
          if (!present.some(isLeader)) hard += 100;
          if (shift === 2) hard += Math.max(0,3-present.length)*10;
        }
      }
      if (hard > bestHard) return;
      if (hard < bestHard) {bestHard = hard; candidates = [];}
      candidates.push({slots:slots.map(list=>list.map(o=>o.short)), reserve:reserved.map(o=>o.short)});
      return;
    }
    const group = groups[index], nLeaders = group.filter(isLeader).length;
    const forced=[...new Set(group.map(o=>locks[o.id]).filter(Boolean))];
    for (let shift=0;shift<3;shift++) {
      if(forced.length>1 || (forced.length===1 && forced[0]!==SHIFTS[shift]))continue;
      if (!days[shift].length || leaders[shift]+nLeaders > 1) continue;
      slots[shift].push(...group); leaders[shift]+=nLeaders;
      visit(index+1);
      slots[shift].splice(slots[shift].length-group.length); leaders[shift]-=nLeaders;
      if (limited) return;
    }
    // A fourth chief cannot be placed alongside another chief; rotate the reserve.
    if (!forced.length && ((nLeaders && leadersAvailable > days.filter(d=>d.length).length) || nLeaders > 1 || days.every(d=>!d.length))) {
      reserved.push(...group); visit(index+1); reserved.splice(reserved.length-group.length);
    }
  }
  visit(0);
  const nightOptions=[...new Map(candidates.map(c=>[c.slots[2].join('|'),c.slots[2]])).values()];
  return {candidates, limited, nightOptions};
}
const lexLess = (a,b) => { for(let i=0;i<a.length;i++) {if(Math.abs(a[i]-b[i])>1e-9) return a[i]<b[i];} return false; };

export function buildSchedules(operators, startWeek, numWeeks, absences={}, leaves={}, overrides={}, archive={}, options={}) {
  const ops = normalizeOperators(operators), counters = SHIFTS.map(()=>Object.fromEntries(ops.map(o=>[o.short,0])));
  const presentCount = Object.fromEntries(ops.map(o=>[o.short,0]));
  const schedules = [], cache = new Map(); let previous = options.previousSchedule || {};
  const availableAt = week => ops.filter(o=>o.active && !o.isVolant && inWindow(o,week) && !isFullAbsent(o.short,week,absences,leaves));
  const getCandidates = week => {
    const available = availableAt(week), days = openDays(week,options);
    const key = JSON.stringify([available.map(o=>[o.id,[1,2,3,4,5,6].map(d=>absentOnDay(o.short,week,d,absences,leaves))]),days,options.locks?.[week] || {}]);
    if(!cache.has(key))cache.set(key,candidatesFor(available,week,absences,leaves,options));
    return cache.get(key);
  };
  for(let week=1; week<startWeek+numWeeks; week++) {
    const available = availableAt(week);
    available.forEach(o=>presentCount[o.short]++);
    let schedule;
    if (archive[week]) {
      const old = archive[week];
      schedule = {...old, s:week, ...Object.fromEntries(SHIFTS.map(key=>[key,[...(old[key] || [])]])), alerts:[], issues:[], isArchived:true, isOverridden:false};
    } else if (overrides[week]) {
      const {slots,removed} = cleanOverride(overrides[week],ops,week,absences,leaves);
      const issues = validateSchedule(slots,ops,week,absences,leaves,previous,options);
      if (removed.length) issues.push({severity:'info',code:'override-cleaned',message:`S${week} : ajustement nettoyé — indisponibles ou doublons retirés : ${[...new Set(removed)].join(', ')}`});
      const assigned=new Set(SHIFTS.flatMap(key=>slots[key]));
      const reserve=available.filter(o=>!assigned.has(o.short)).map(o=>o.short);
      schedule = {s:week,...slots,reserve,issues,alerts:issueAlerts(issues),isOverridden:true};
    } else {
      const {candidates, limited} = getCandidates(week);
      // Anticipate known absences next week. This does not depend on the visible window.
      const nextFixed = archive[week+1] || (overrides[week+1] && cleanOverride(overrides[week+1],ops,week+1,absences,leaves).slots);
      const nextNights = nextFixed ? [nextFixed.nuit || []] : week<53 ? getCandidates(week+1).nightOptions : [];
      const weights=counters.map(count=>Object.fromEntries(available.map(o=>[o.short,(2*count[o.short]+1)/Math.max(1,presentCount[o.short])])));
      const reserveRates=Object.fromEntries(available.map(o=>[o.short,-(counters[0][o.short]+counters[1][o.short]+counters[2][o.short])/Math.max(1,presentCount[o.short])]));
      let best = null, bestScore = null;
      for (const candidate of candidates) {
        const [matin,am,nuit] = candidate.slots;
        const repeated = nuit.filter(n=>(previous.nuit || []).includes(n)).length;
        if(bestScore && repeated>bestScore[0])continue;
        let nextRepeated = nextNights.length ? Infinity : 0;
        for(const next of nextNights) {
          nextRepeated=Math.min(nextRepeated,next.filter(n=>nuit.includes(n)).length);
          if(nextRepeated===0)break;
        }
        const deficits = Math.max(0,3-matin.length)+Math.max(0,2-am.length);
        const reserveFairness = candidate.reserve.reduce((sum,n)=>sum+reserveRates[n],0);
        const prefix=[repeated,nextRepeated,deficits,Math.max(0,nuit.length-3),reserveFairness];
        if(bestScore && lexLess(bestScore.slice(0,5),prefix))continue;
        let fairness = 0, repeatedDay = 0;
        candidate.slots.forEach((names,shift)=>names.forEach(name=>{
          // Marginal squared burden per available week: newcomers do not catch up on the past.
          fairness += weights[shift][name];
          if(shift<2 && (previous[SHIFTS[shift]] || []).includes(name)) repeatedDay++;
        }));
        const score = [...prefix, repeatedDay, fairness, Math.abs(matin.length-am.length)];
        if (!bestScore || lexLess(score,bestScore)) {best=candidate; bestScore=score;}
      }
      const slots = Object.fromEntries(SHIFTS.map((k,i)=>[k,best?.slots[i] || []]));
      const issues = validateSchedule(slots,ops,week,absences,leaves,previous,{...options,automatic:!limited});
      if (limited) issues.unshift({severity:'error',code:'search-limit',message:`S${week} : recherche trop volumineuse ; résultat provisoire, optimum non garanti. Réduire le périmètre de l'équipe.`});
      if (issues.some(i=>i.severity==='error') && !limited) issues.unshift({severity:'error',code:'infeasible',message:`S${week} : aucune répartition conforme avec ${available.length} personnes et ${available.filter(isLeader).length} chefs disponibles. Vérifier les congés, binômes et remplaçants.`});
      if (best?.reserve.length) issues.push({severity:'info',code:'reserve',message:`S${week} : réserve automatique (chef supplémentaire et éventuel binôme) : ${best.reserve.join(', ')}`});
      schedule = {s:week,...slots,reserve:best?.reserve || [],issues,alerts:issueAlerts(issues),isOverridden:false};
    }
    if(!schedule.isArchived) {
      for(const entry of (absences[week]||[]).filter(e=>e.includes('|'))) {
        const [name,,day]=entry.split('|');
        schedule.issues.push({severity:'info',code:'partial-absence',message:`S${week} : ${name} absent le ${day}`});
      }
      for(const entry of (leaves[week]||[]).filter(e=>e.includes(':'))) {
        const [name,range]=entry.split(':'), [start,end]=range.split('-').map(Number);
        schedule.issues.push({severity:'info',code:'partial-leave',message:`S${week} : ${name} en congé ${DAYS[start]}–${DAYS[end]}`});
      }
      schedule.alerts=issueAlerts(schedule.issues);
    }
    SHIFTS.forEach((key,index)=>(schedule[key] || []).forEach(name=>{
      if(counters[index][name]!==undefined && !isFullAbsent(name,week,absences,leaves))counters[index][name]++;
    }));
    previous = schedule;
    if(week>=startWeek) schedules.push(schedule);
  }
  return {schedules,matCount:counters[0],amCount:counters[1],nightCount:counters[2],presentCount};
}

// Move/swap whole available pairs. Validation remains a separate step so a UI can
// allow a repair in several gestures while preventing invalid publication.
export function moveAssignment(slots, operators, week, absences, leaves, name, targetShift, targetName=null) {
  if(!SHIFTS.includes(targetShift)) throw new Error('Poste inconnu.');
  const available = operators.filter(o=>o.active && inWindow(o,week) && !isFullAbsent(o.short,week,absences,leaves));
  const groups = groupsFor(available);
  const group = groups.find(g=>g.some(o=>o.short===name));
  if(!group) throw new Error('Opérateur absent ou hors de sa période de présence.');
  const moving = group.map(o=>o.short), origin = SHIFTS.find(k=>(slots[k] || []).includes(name));
  const other = targetName && groups.find(g=>g.some(o=>o.short===targetName));
  const swapping = other && !other.some(o=>moving.includes(o.short)) ? other.map(o=>o.short) : [];
  const remove = new Set([...moving,...swapping]);
  const result = Object.fromEntries(SHIFTS.map(k=>[k,(slots[k] || []).filter(n=>!remove.has(n))]));
  result[targetShift].push(...moving);
  if(swapping.length && origin) result[origin].push(...swapping);
  // Chiefs must be swapped, never stacked by a drag.
  for(const key of SHIFTS) if(result[key].filter(n=>isLeader(operators.find(o=>o.short===n))).length>1)
    throw new Error('Deux chefs dans le même poste : dépose le chef sur celui à remplacer pour les échanger.');
  return result;
}
