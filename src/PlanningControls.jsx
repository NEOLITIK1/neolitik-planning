import React,{useState} from 'react';
import {SHIFTS,isLeader,inWindow,isFullAbsent,absentOnDay,daySlots,moveAssignment,validateSchedule,dailyRestIssues,proposeDay} from './scheduler.js';
import {dateOfDay,fmtDate,isoDate} from './dates.js';

const LABELS={matin:'Matin',am:'AM',nuit:'Nuit'};
const SHORT={matin:'M',am:'AM',nuit:'N'};
const COLORS={matin:'#D6EFD8',am:'#FFF9C4',nuit:'#BBDEFB'};
const DAYS=['','Lun','Mar','Mer','Jeu','Ven','Sam'];
const panel={background:'#fff',border:'1px solid #ddd',borderRadius:9,padding:14,marginBottom:14};
const button={border:'1px solid #bbb',borderRadius:5,padding:'5px 9px',background:'#fff',cursor:'pointer',fontSize:12};
const select={padding:5,border:'1px solid #ccc',borderRadius:5,fontSize:12};

export function WeeklyLocks({weeks,operators,locks,onChange,isLocked}){
  const [selectedWeek,setWeek]=useState(''),[person,setPerson]=useState(''),[shift,setShift]=useState('nuit');
  const week=weeks.includes(Number(selectedWeek))?Number(selectedWeek):weeks[0];
  return <details style={panel}><summary style={{cursor:'pointer',fontWeight:600,fontSize:13}}>🔒 Affectations à conserver lors du recalcul</summary>
    <p style={{fontSize:12,color:'#666'}}>Verrouille un opérateur sur un poste pour une semaine. Son binôme suit ; les autres affectations restent calculées automatiquement.</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <select style={select} aria-label="Semaine du verrouillage" value={week||''} onChange={e=>setWeek(e.target.value)}>{weeks.map(w=><option key={w} value={w}>S{w}</option>)}</select>
      <select style={select} aria-label="Opérateur à verrouiller" value={person} onChange={e=>setPerson(e.target.value)}><option value="">Choisir un opérateur</option>{operators.filter(o=>o.active&&!o.isVolant).map(o=><option key={o.id} value={o.id}>{o.full}</option>)}</select>
      <select style={select} aria-label="Poste verrouillé" value={shift} onChange={e=>setShift(e.target.value)}>{SHIFTS.map(k=><option key={k} value={k}>{LABELS[k]}</option>)}</select>
      <button style={button} disabled={!person||isLocked(week)} onClick={()=>onChange(week,person,shift)}>Verrouiller</button>
    </div>
    {Object.entries(locks).filter(([w])=>weeks.includes(Number(w))).map(([w,entries])=>Object.entries(entries).map(([id,key])=><div key={`${w}-${id}`} style={{fontSize:12,marginTop:8}}>
      S{w} · {operators.find(o=>o.id===id)?.full||id} → {LABELS[key]} <button style={button} disabled={isLocked(Number(w))} onClick={()=>onChange(Number(w),id,null)}>Déverrouiller</button>
    </div>))}
  </details>;
}

export function DailyChanges({schedule}){
  if(!schedule.dailyChanges?.length)return null;
  return <div style={{fontSize:11,background:'#fff8e1',padding:8,borderRadius:5,marginTop:6}}>
    <strong>Remplacements à la journée</strong>
    {schedule.dailyChanges.map((change,i)=><div key={i}>{change.date} · {change.name} : {LABELS[change.from]||change.from} → {LABELS[change.to]||change.to}</div>)}
  </div>;
}

export function DailyPlanning({schedules,operators,year,absences={},leaves={},satWeeks=[],satEndPostes={},joursChomes={},joursAmenages={},notes={},showFullNames=true,onAbsence,onClosed,onHours,onEditDay,onToggleSat,onSatEnd,isLocked=()=>true}){
  const options={satWeeks,satEndPostes,joursChomes,joursAmenages};
  return <div>{schedules.map(sc=>{
    const days=Array.from({length:satWeeks.includes(sc.s)?6:5},(_,i)=>i+1);
    const names=[...new Set([...SHIFTS.flatMap(k=>sc[k]||[]),...Object.values(sc.dailySchedules||{}).flatMap(slots=>SHIFTS.flatMap(k=>slots[k]||[])),...operators.filter(o=>o.active&&o.isVolant&&inWindow(o,sc.s)&&!isFullAbsent(o.short,sc.s,absences,leaves)).map(o=>o.short)])];
    return <div key={sc.s} style={{...panel,padding:0,overflow:'hidden'}}>
      <div style={{background:'#3a5c35',color:'#fff',padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <strong>S{sc.s}</strong><span style={{fontSize:12}}>{fmtDate(dateOfDay(year,sc.s,1))} – {fmtDate(dateOfDay(year,sc.s,days.length))}</span><span style={{fontSize:12}}>{notes[sc.s]}</span>
        {onToggleSat&&!isLocked(sc.s)&&<><button style={button} onClick={()=>onToggleSat(sc.s)}>{satWeeks.includes(sc.s)?'Retirer samedi':'+ Samedi'}</button>{satWeeks.includes(sc.s)&&<select style={select} aria-label={`Dernier poste samedi S${sc.s}`} value={satEndPostes[sc.s]||'N'} onChange={e=>onSatEnd(sc.s,e.target.value)}><option value="M">Matin</option><option value="AM">AM</option><option value="N">Nuit</option></select>}</>}
      </div>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>
        <th style={{padding:10,textAlign:'left',minWidth:140}}>Opérateur</th>
        {days.map(day=>{
          const date=dateOfDay(year,sc.s,day),dateStr=fmtDate(date),key=`${sc.s}-${dateStr}`,closed=joursChomes[key],entry=joursAmenages[key];
          return <th key={day} style={{padding:8,minWidth:100,background:closed?'#eee':entry?'#ede7f6':'#fafafa'}}>
            {DAYS[day]} {dateStr}<br/>{closed&&<span>Chômé</span>}
            {!closed&&SHIFTS.map(k=><div key={k} style={{fontSize:9,fontWeight:400,marginTop:2}}>{LABELS[k]} {entry?.[k]?`${entry[k].s}–${entry[k].e}`:{matin:'05:50–14:00',am:'13:50–22:00',nuit:'21:50–06:00'}[k]}</div>)}
            {!isLocked(sc.s)&&onEditDay&&!closed&&<button style={{...button,marginTop:5}} aria-label={`Affectations du ${isoDate(date)}`} onClick={()=>onEditDay(sc,day)}>Affectations</button>}
            {!isLocked(sc.s)&&onClosed&&<div style={{marginTop:4}}><button style={button} onClick={()=>onClosed(sc.s,dateStr)}>{closed?'Ouvrir':'Chômer'}</button>{!closed&&onHours&&<button style={{...button,marginLeft:3}} onClick={()=>onHours(sc.s,dateStr,DAYS[day])}>Horaires</button>}</div>}
          </th>;
        })}
      </tr></thead><tbody>{names.map(name=>{
        const op=operators.find(o=>o.short===name);
        return <tr key={name} style={{borderTop:'1px solid #eee'}}><td style={{padding:10}}>{isLeader(op)?'★ ':''}{showFullNames?(op?.full||name):name}<span style={{fontSize:10,color:'#888',marginLeft:6}}>{op?.level}</span></td>
          {days.map(day=>{
            const slots=daySlots(sc,year,day,absences,leaves,options),key=SHIFTS.find(k=>slots[k].includes(name));
            const date=dateOfDay(year,sc.s,day),closed=joursChomes[`${sc.s}-${fmtDate(date)}`];
            const absent=absentOnDay(name,sc.s,day,absences,leaves);
            const changed=sc.dailyChanges?.some(c=>c.day===day&&c.name===name);
            const label=absent?'Abs.':key?SHORT[key]:op?.isVolant&&!closed&&day!==6&&inWindow(op,sc.s)?'J':'—';
            return <td key={day} style={{textAlign:'center',padding:8,background:closed?'#fafafa':'#fff'}}><button disabled={!onAbsence||closed} onClick={()=>onAbsence(sc.s,name,fmtDate(date),DAYS[day])} title={onAbsence?'Marquer/retirer une absence ce jour':undefined} style={{border:changed?'2px solid #e39a25':'1px solid transparent',borderRadius:5,padding:'4px 9px',color:'#223',background:key?COLORS[key]:absent?'#fdecea':'#f5f5f5',fontSize:12,cursor:onAbsence?'pointer':'default'}}>{label}{changed?' ↔':''}</button></td>;
          })}
        </tr>;
      })}</tbody></table></div>
      <DailyChanges schedule={sc}/>
    </div>;
  })}</div>;
}

export function DayEditor({schedule,day,year,operators,absences,leaves,options,onSave,onClose}){
  const [draft,setDraft]=useState(()=>daySlots(schedule,year,day,absences,leaves,options));
  const [includeVolants,setIncludeVolants]=useState(false),[message,setMessage]=useState('');
  const date=isoDate(dateOfDay(year,schedule.s,day));
  const available=operators.filter(o=>o.active&&inWindow(o,schedule.s)&&!absentOnDay(o.short,schedule.s,day,absences,leaves));
  const issues=[...validateSchedule(draft,operators,schedule.s,absences,leaves,{}, {...options,year,onlyDay:day}),...dailyRestIssues(draft,schedule,operators,year,day,absences,leaves,options)].filter(i=>i.severity==='error');
  const change=(op,key)=>{
    try{
      if(!key){
        const names=available.filter(o=>o.id===op.id||o.id===op.partnerId||o.partnerId===op.id).map(o=>o.short);
        setDraft(Object.fromEntries(SHIFTS.map(k=>[k,draft[k].filter(n=>!names.includes(n))])));
      }else{
        const target=isLeader(op)?draft[key].find(n=>isLeader(operators.find(o=>o.short===n))):null;
        const absent=operators.filter(o=>absentOnDay(o.short,schedule.s,day,absences,leaves)).map(o=>o.short);
        setDraft(moveAssignment(draft,operators,schedule.s,{...absences,[schedule.s]:[...(absences[schedule.s]||[]),...absent]},leaves,op.short,key,target));
      }
      setMessage('');
    }catch(e){setMessage(e.message);}
  };
  return <div style={{position:'fixed',inset:0,zIndex:1500,background:'#0006',display:'flex',alignItems:'center',justifyContent:'center'}}><div role="dialog" aria-label="Affectations journalières" style={{background:'#fff',borderRadius:12,padding:22,width:580,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto'}}>
    <strong>Affectations du {date}</strong><p style={{fontSize:12,color:'#666'}}>Seule cette journée change. Les autres jours gardent leur rotation. Les binômes disponibles restent ensemble ; les affectations verrouillées doivent être respectées.</p>
    <label style={{fontSize:12}}><input type="checkbox" checked={includeVolants} onChange={e=>setIncludeVolants(e.target.checked)}/> Inclure les volants dans la proposition</label>
    <button style={{...button,marginLeft:8}} onClick={()=>{const result=proposeDay(schedule,operators,year,day,absences,leaves,{...options,includeVolants});setDraft(Object.fromEntries(SHIFTS.map(k=>[k,result[k]])));setMessage(result.issues.some(i=>i.severity==='error')?'Aucune proposition entièrement conforme avec cet effectif.':'Proposition calculée en limitant les changements.');}}>Proposer un remplacement</button>
    {available.map(op=><div key={op.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid #eee',fontSize:13}}><span>{isLeader(op)?'★ ':''}{op.full}{op.isVolant?' · volant':''}</span><select style={select} aria-label={`Poste du jour de ${op.short}`} value={SHIFTS.find(k=>draft[k].includes(op.short))||''} onChange={e=>change(op,e.target.value)}><option value="">Réserve / non posté</option>{SHIFTS.map(k=><option key={k} value={k}>{LABELS[k]}</option>)}</select></div>)}
    {message&&<p style={{fontSize:12}}>{message}</p>}
    {issues.length>0&&<div role="alert" style={{color:'#b71c1c',fontSize:12,margin:'12px 0'}}>Brouillon non publiable :{[...new Set(issues.map(i=>i.message))].map(text=><div key={text}>{text}</div>)}</div>}
    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,flexWrap:'wrap'}}><button style={button} onClick={()=>onSave(null)}>Revenir au calcul automatique</button><button style={button} onClick={onClose}>Annuler</button><button style={{...button,background:'#3a5c35',color:'#fff'}} onClick={()=>onSave(draft)}>Enregistrer la journée</button></div>
  </div></div>;
}
