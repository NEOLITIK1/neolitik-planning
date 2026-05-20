import { useState, useEffect, useCallback, useRef } from "react";

const SB_URL = "https://kgnpfwfuqwltxyrqfejk.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnbnBmd2Z1cXdsdHh5cnFmZWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyODExODMsImV4cCI6MjA5NDg1NzE4M30.1-y6H9mB65WdJPSGrn70m0Z4kgzDDdt2hnwD04QRqio";
const sbH = { "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}` };

async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/neolitik_config?key=eq.${key}&select=data`, { headers: sbH });
  const d = await r.json();
  return d?.[0]?.data ?? null;
}
async function sbSet(key, data) {
  await fetch(`${SB_URL}/rest/v1/neolitik_config`, {
    method: "POST",
    headers: { ...sbH, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify({ key, data }),
  });
}
async function sbGetOps() {
  const r = await fetch(`${SB_URL}/rest/v1/neolitik_operators?select=id,data`, { headers: sbH });
  const d = await r.json();
  return d?.map(row => ({ id: row.id, ...row.data })) ?? null;
}
async function sbSetOps(ops) {
  const rows = ops.map(({ id, ...rest }) => ({ id, data: rest }));
  await fetch(`${SB_URL}/rest/v1/neolitik_operators`, {
    method: "POST",
    headers: { ...sbH, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  const ids = ops.map(o => o.id).join(",");
  if (ids) await fetch(`${SB_URL}/rest/v1/neolitik_operators?id=not.in.(${ids})`, { method: "DELETE", headers: sbH });
}

const DEFAULT_OPERATORS = [
  { id:"martin",   full:"Maxime MARTIN",     short:"MARTIN",   level:"N4", active:true },
  { id:"lendormy", full:"Matthieu LENDORMY",  short:"LENDORMY", level:"N4", active:true },
  { id:"gibeaux",  full:"Théo GIBEAUX",       short:"GIBEAUX",  level:"N4", active:true },
  { id:"hebert",   full:"Maxime HEBERT",      short:"HEBERT",   level:"N3", active:true },
  { id:"bruny",    full:"Julien BRUNY",        short:"BRUNY",    level:"N2", active:true },
  { id:"vallet",   full:"Kévin VALLET",        short:"VALLET",   level:"N1", active:true },
  { id:"cadinot",  full:"Thomas CADINOT",     short:"CADINOT",  level:"N1", active:true },
  { id:"allain",   full:"Jason ALLAIN",        short:"ALLAIN",   level:"N1", active:true },
];
const REF_WEEK = 22;
const BRAND = "#3a5c35";
const N4_CYCLE = [
  { matin:["GIBEAUX"],  am:["MARTIN"],   nuit:["LENDORMY"] },
  { matin:["LENDORMY"], am:["GIBEAUX"],  nuit:["MARTIN"]   },
  { matin:["MARTIN"],   am:["LENDORMY"], nuit:["GIBEAUX"]  },
];
const NON_N4_CYCLE = [
  { matin:["HEBERT","VALLET"],  am:["ALLAIN"],  nuit:["BRUNY","CADINOT"]  },
  { matin:["HEBERT","BRUNY"],   am:["CADINOT"], nuit:["VALLET","ALLAIN"]  },
  { matin:["BRUNY","ALLAIN"],   am:["VALLET"],  nuit:["HEBERT","CADINOT"] },
  { matin:["CADINOT","ALLAIN"], am:["HEBERT"],  nuit:["BRUNY","VALLET"]   },
  { matin:["VALLET","CADINOT"], am:["BRUNY"],   nuit:["HEBERT","ALLAIN"]  },
];
const LEVEL_BADGE = {
  N4:{ bg:"#C8E6C9", color:"#1B5E20" },
  N3:{ bg:"#FFF9C4", color:"#F57F17" },
  N2:{ bg:"#FFE0B2", color:"#BF360C" },
  N1:{ bg:"#EEEEEE", color:"#424242" },
};
const DAYS_FR = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

function getMondayOfWeek(w, year=2026) {
  const jan1=new Date(year,0,1), d=jan1.getDay()||7;
  const mon=new Date(year,0,d<=4?2-d:9-d);
  mon.setDate(mon.getDate()+(w-1)*7);
  return mon;
}
function fmtDate(d) { return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`; }
function formatWeekDates(w) {
  const m=getMondayOfWeek(w), s=new Date(m); s.setDate(m.getDate()+4);
  return `${fmtDate(m)} – ${fmtDate(s)}`;
}

function computeSchedule(weekNum, operators, absences, leaves) {
  const activeOps = operators.filter(o=>o.active);
  const n4ops = activeOps.filter(o=>o.level==="N4").map(o=>o.short);
  const n4Ph = ((weekNum-REF_WEEK)%3+3)%3;
  const nonPh = ((weekNum-REF_WEEK)%5+5)%5;
  const weekAbsences = [...(absences[weekNum]||[]), ...(leaves[weekNum]||[])];
  const slots = {
    matin:[...N4_CYCLE[n4Ph].matin,...NON_N4_CYCLE[nonPh].matin],
    am:   [...N4_CYCLE[n4Ph].am,   ...NON_N4_CYCLE[nonPh].am  ],
    nuit: [...N4_CYCLE[n4Ph].nuit, ...NON_N4_CYCLE[nonPh].nuit],
  };
  const newOps = activeOps.filter(o=>!DEFAULT_OPERATORS.some(d=>d.short===o.short));
  newOps.forEach(op=>{
    const off=((weekNum-REF_WEEK)%15+15)%15;
    const idx=newOps.findIndex(o2=>o2.short===op.short);
    const sh=["matin","am","nuit"][(idx+off)%3];
    if(!slots[sh].includes(op.short)) slots[sh].push(op.short);
  });
  const alerts=[];
  ["matin","am","nuit"].forEach(shift=>{
    slots[shift].filter(s=>weekAbsences.includes(s)).forEach(absent=>{
      const isN4=activeOps.find(o=>o.short===absent)?.level==="N4";
      const used=new Set([...slots.matin,...slots.am,...slots.nuit].filter(s=>!weekAbsences.includes(s)));
      let rep=null;
      if(isN4) rep=n4ops.find(s=>!used.has(s)&&!weekAbsences.includes(s));
      if(!rep) rep=activeOps.map(o=>o.short).find(s=>!used.has(s)&&!weekAbsences.includes(s));
      if(rep){
        const mk=activeOps.find(o=>o.short===rep)?.level==="N4"?"↺":"⚠";
        slots[shift]=slots[shift].map(s=>s===absent?`${mk}${rep}`:s);
        used.add(rep);
      } else {
        slots[shift]=slots[shift].filter(s=>s!==absent);
        alerts.push(`S${weekNum}: manque en ${shift} (${absent} absent)`);
      }
    });
    if(!slots[shift].map(s=>s.replace(/^[↺⚠]/,"")).some(s=>n4ops.includes(s)))
      alerts.push(`S${weekNum}: aucun N4 en ${shift}`);
  });
  return { week:weekNum, slots, alerts };
}

function LevelBadge({ level }) {
  const s=LEVEL_BADGE[level]||LEVEL_BADGE.N1;
  return <span style={{background:s.bg,color:s.color,borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:500}}>{level}</span>;
}
function OpChip({ name, operators, draggable, onDragStart }) {
  const clean=name.replace(/^[↺⚠]/,""), marker=name!==clean?name[0]:"";
  const op=operators.find(o=>o.short===clean);
  const s=LEVEL_BADGE[op?.level||"N1"];
  return (
    <span draggable={draggable} onDragStart={onDragStart}
      style={{display:"inline-flex",alignItems:"center",gap:3,background:s.bg,color:s.color,
        borderRadius:4,padding:"2px 7px",fontSize:12,margin:"2px",fontWeight:500,
        cursor:draggable?"grab":"default"}}>
      {marker&&<span style={{fontSize:11}}>{marker}</span>}{clean}
    </span>
  );
}

export default function App() {
  const [tab, setTab] = useState("planning");
  const [operators, setOperators] = useState(DEFAULT_OPERATORS);
  const [absences, setAbsences] = useState({});
  const [leaves, setLeaves] = useState({});
  const [overrides, setOverrides] = useState({});
  const [satWeeks, setSatWeeks] = useState([]);
  const [startWeek, setStartWeek] = useState(22);
  const [numWeeks, setNumWeeks] = useState(5);
  const [view, setView] = useState("liste");
  const [absOp, setAbsOp] = useState(""); const [absWeek, setAbsWeek] = useState(22);
  const [leaveOp, setLeaveOp] = useState("");
  const [leaveFrom, setLeaveFrom] = useState(22); const [leaveTo, setLeaveTo] = useState(22);
  const [leaveFromDay, setLeaveFromDay] = useState(1); const [leaveToDay, setLeaveToDay] = useState(5);
  const [showAddOp, setShowAddOp] = useState(false);
  const [newOp, setNewOp] = useState({prenom:"",nom:"",level:"N1"});
  const [syncMsg, setSyncMsg] = useState("Chargement...");
  const [schedules, setSchedules] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const dragRef = useRef(null);
  const weeks = Array.from({length:numWeeks},(_,i)=>startWeek+i);

  useEffect(()=>{
    (async()=>{
      try {
        setSyncMsg("Connexion...");
        const [ops, abs, lv, ov, sw] = await Promise.all([
          sbGetOps(),
          sbGet("absences"),
          sbGet("leaves"),
          sbGet("overrides"),
          sbGet("satweeks"),
        ]);
        if (ops && ops.length > 0) setOperators(ops);
        if (abs) setAbsences(abs);
        if (lv)  setLeaves(lv);
        if (ov)  setOverrides(ov);
        if (sw)  setSatWeeks(sw);
        setSyncMsg("Synchronisé ✓");
      } catch(e) { setSyncMsg(`Erreur: ${e.message}`); }
      finally { setLoaded(true); }
    })();
  },[]);

  const save = useCallback(async (k, v) => {
    setSyncMsg("Enreg...");
    try { await sbSet(k, v); setSyncMsg("Synchronisé ✓"); }
    catch { setSyncMsg("Erreur sync"); }
  }, []);
  const saveOperators = useCallback(v => { setOperators(v); sbSetOps(v).then(()=>setSyncMsg("Synchronisé ✓")).catch(()=>setSyncMsg("Erreur sync")); }, []);
  const saveAbsences  = useCallback(v => { setAbsences(v);  save("absences", v);  }, [save]);
  const saveLeaves    = useCallback(v => { setLeaves(v);     save("leaves", v);    }, [save]);
  const saveOverrides = useCallback(v => { setOverrides(v);  save("overrides", v); }, [save]);
  const saveSatWeeks  = useCallback(v => { setSatWeeks(v);   save("satweeks", v);  }, [save]);

  const activeOps = operators.filter(o=>o.active);

  const generate = useCallback(()=>{
    const base = weeks.map(w=>computeSchedule(w,operators,absences,leaves));
    setSchedules(base.map(s=>{
      const mk=sh=>overrides[`${s.week}-${sh}`]||s.slots[sh];
      return {...s,slots:{matin:mk("matin"),am:mk("am"),nuit:mk("nuit")}};
    }));
  },[weeks,operators,absences,leaves,overrides]);

  useEffect(()=>{ if(loaded) generate(); },[loaded,startWeek,numWeeks,operators,absences,leaves]);

  const allAlerts = schedules.flatMap(s=>s.alerts);

  const addAbsence=()=>{
    if(!absOp) return;
    const cur=absences[absWeek]||[];
    if(cur.includes(absOp)) return;
    saveAbsences({...absences,[absWeek]:[...cur,absOp]});
  };
  const removeAbsence=(week,op)=>{
    const cur=(absences[week]||[]).filter(o=>o!==op);
    const next={...absences}; if(!cur.length) delete next[week]; else next[week]=cur;
    saveAbsences(next);
  };

  const leaveShort=e=>e.includes(":")?e.split(":")[0]:e;
  const leaveLabel=e=>{
    if(!e.includes(":")) return "Semaine complète";
    const [,range]=e.split(":");
    const [s,en]=range.split("-").map(Number);
    return `${DAYS_FR[s]} – ${DAYS_FR[en]}`;
  };

  const addLeave=()=>{
    if(!leaveOp) return;
    const next={...leaves};
    for(let w=leaveFrom;w<=leaveTo;w++){
      const isFirst=w===leaveFrom, isLast=w===leaveTo;
      let startD=isFirst?leaveFromDay:1, endD=isLast?leaveToDay:5;
      const entry=(startD===1&&endD>=5)?leaveOp:`${leaveOp}:${startD}-${endD}`;
      const cur=next[w]||[];
      next[w]=[...cur.filter(e=>e!==leaveOp&&!e.startsWith(`${leaveOp}:`)), entry];
    }
    saveLeaves(next);
  };
  const removeLeaveEntry=(week,entry)=>{
    const cur=(leaves[week]||[]).filter(e=>e!==entry);
    const next={...leaves}; if(!cur.length) delete next[week]; else next[week]=cur;
    saveLeaves(next);
  };

  const onDragStart=(weekNum,shift,name)=>{ dragRef.current={weekNum,shift,name}; };
  const onDrop=(weekNum,targetShift)=>{
    const src=dragRef.current;
    if(!src||src.weekNum!==weekNum||src.shift===targetShift) return;
    const srcSlot=schedules.find(s=>s.week===weekNum)?.slots[src.shift]||[];
    const tgtSlot=schedules.find(s=>s.week===weekNum)?.slots[targetShift]||[];
    const nSrc=srcSlot.filter(n=>n!==src.name), nTgt=[...tgtSlot,src.name];
    const ov={...overrides,[`${weekNum}-${src.shift}`]:nSrc,[`${weekNum}-${targetShift}`]:nTgt};
    saveOverrides(ov);
    setSchedules(prev=>prev.map(s=>s.week!==weekNum?s:{...s,slots:{...s.slots,[src.shift]:nSrc,[targetShift]:nTgt}}));
    dragRef.current=null;
  };

  const toggleSat=(w)=>{ saveSatWeeks(satWeeks.includes(w)?satWeeks.filter(x=>x!==w):[...satWeeks,w]); };

  const equity=activeOps.map(op=>{
    let matin=0,am=0,nuit=0;
    schedules.forEach(s=>{
      if(s.slots.matin.some(x=>x.replace(/^[↺⚠]/,"")=== op.short)) matin++;
      if(s.slots.am.some(x=>x.replace(/^[↺⚠]/,"")=== op.short)) am++;
      if(s.slots.nuit.some(x=>x.replace(/^[↺⚠]/,"")=== op.short)) nuit++;
    });
    return {...op,matin,am,nuit,total:matin+am+nuit};
  });
  const maxTotal=Math.max(...equity.map(e=>e.total),1);

  const addOperator=()=>{
    if(!newOp.prenom.trim()||!newOp.nom.trim()) return;
    const short=newOp.nom.toUpperCase().trim();
    const op={id:`op_${Date.now()}`,full:`${newOp.prenom.trim()} ${short}`,short,level:newOp.level,active:true};
    saveOperators([...operators,op]);
    setNewOp({prenom:"",nom:"",level:"N1"}); setShowAddOp(false);
  };
  const toggleActive=id=>saveOperators(operators.map(o=>o.id===id?{...o,active:!o.active}:o));
  const deleteOp=id=>{ if(window.confirm("Supprimer ?")) saveOperators(operators.filter(o=>o.id!==id)); };

  const shiftMeta=[
    {key:"matin",label:"Matin",bg:"#f0faf1",hbg:"#D6EFD8",tc:"#1B5E20"},
    {key:"am",   label:"AM",   bg:"#fffde7",hbg:"#FFF9C4",tc:"#F57F17"},
    {key:"nuit", label:"Nuit", bg:"#e3f2fd",hbg:"#BBDEFB",tc:"#0D47A1"},
  ];

  const TABS=[
    {id:"planning", label:"Planning",   icon:"ti-calendar"},
    {id:"conges",   label:"Congés",     icon:"ti-beach"},
    {id:"absences", label:"Historique", icon:"ti-history"},
    {id:"equite",   label:"Équité",     icon:"ti-chart-bar"},
    {id:"equipe",   label:"Équipe",     icon:"ti-users"},
  ];

  return (
    <div style={{fontFamily:"'DM Sans','Outfit',sans-serif",background:"#f7f8fa",minHeight:"100vh"}}>
      <div style={{background:BRAND,color:"#fff",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
        <span style={{fontWeight:700,fontSize:18,letterSpacing:1.5}}>NEOLITIK</span>
        <span style={{fontSize:11,opacity:.7}}>{syncMsg}</span>
      </div>
      <div style={{display:"flex",borderBottom:"1px solid #e0e0e0",background:"#fff",paddingLeft:16,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:tab===t.id?600:400,color:tab===t.id?BRAND:"#666",borderBottom:tab===t.id?`2px solid ${BRAND}`:"2px solid transparent",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5}}>
            <i className={`ti ${t.icon}`} style={{fontSize:14}}/>{t.label}
          </button>
        ))}
      </div>

      <div style={{padding:"20px 20px 40px",maxWidth:1100,margin:"0 auto"}}>

        {tab==="planning" && (
          <div>
            <div style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <label style={{fontSize:13,color:"#555"}}>Semaine de départ</label>
                <input type="number" min={1} max={52} value={startWeek} onChange={e=>setStartWeek(Number(e.target.value))} style={{width:64,padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <label style={{fontSize:13,color:"#555"}}>Semaines</label>
                {[3,5,10,15,26].map(n=>(
                  <button key={n} onClick={()=>setNumWeeks(n)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #ccc",background:numWeeks===n?BRAND:"#fff",color:numWeeks===n?"#fff":"#333",cursor:"pointer",fontSize:13}}>{n}</button>
                ))}
              </div>
              <button onClick={generate} style={{marginLeft:"auto",padding:"6px 16px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
                <i className="ti ti-refresh" style={{fontSize:14}}/> Générer
              </button>
              {[{k:"liste",l:"Liste"},{k:"colonnes",l:"Colonnes"}].map(v=>(
                <button key={v.k} onClick={()=>setView(v.k)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid #ccc",background:view===v.k?BRAND:"#fff",color:view===v.k?"#fff":"#333",cursor:"pointer",fontSize:13}}>{v.l}</button>
              ))}
            </div>

            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"12px 16px",marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Absence ponctuelle</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <select value={absOp} onChange={e=>setAbsOp(e.target.value)} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                  <option value="">-- Opérateur --</option>
                  {activeOps.map(o=><option key={o.id} value={o.short}>{o.full}</option>)}
                </select>
                <span style={{fontSize:13,color:"#555"}}>S.</span>
                <input type="number" min={1} max={52} value={absWeek} onChange={e=>setAbsWeek(Number(e.target.value))} style={{width:60,padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
                <button onClick={addAbsence} style={{padding:"5px 14px",borderRadius:6,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13}}>Ajouter</button>
              </div>
            </div>

            {allAlerts.length>0 && (
              <div style={{background:"#fdecea",border:"1px solid #ef9a9a",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:13,color:"#b71c1c"}}>
                <strong>Alertes :</strong>
                <ul style={{margin:"4px 0 0 16px",padding:0}}>{allAlerts.map((a,i)=><li key={i}>{a}</li>)}</ul>
              </div>
            )}

            <div style={{fontSize:12,color:"#888",marginBottom:10}}>Glissez un opérateur d'un poste à un autre pour le déplacer manuellement.</div>

            {view==="liste" && (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #e0e0e0",fontSize:13}}>
                  <thead>
                    <tr style={{background:BRAND,color:"#fff"}}>
                      <th style={{padding:"10px 12px",textAlign:"left"}}>Semaine</th>
                      <th style={{padding:"10px 12px",textAlign:"left"}}>Dates</th>
                      <th style={{padding:"10px 12px",background:"#D6EFD8",color:"#1B5E20"}}>Matin 5h50–14h</th>
                      <th style={{padding:"10px 12px",background:"#FFF9C4",color:"#F57F17"}}>AM 13h50–22h</th>
                      <th style={{padding:"10px 12px",background:"#BBDEFB",color:"#0D47A1"}}>Nuit 21h50–6h</th>
                      <th style={{padding:"10px 12px",textAlign:"center",fontSize:11}}>Sam.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s,i)=>{
                      const hasSat=satWeeks.includes(s.week);
                      const m=getMondayOfWeek(s.week), end=new Date(m); end.setDate(m.getDate()+(hasSat?5:4));
                      return (
                        <tr key={s.week} style={{borderBottom:"1px solid #f0f0f0",background:i%2===0?"#fff":"#fafafa"}}>
                          <td style={{padding:"10px 12px",fontWeight:600}}>S{s.week}</td>
                          <td style={{padding:"10px 12px",fontSize:12}}>
                            <div>{fmtDate(m)} – {fmtDate(end)}</div>
                            {hasSat&&<div style={{fontSize:11,color:"#c62828",fontWeight:600,marginTop:2}}>⚠ Sam. travaillé</div>}
                          </td>
                          {shiftMeta.map(sh=>(
                            <td key={sh.key} style={{padding:"8px",background:sh.bg}} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(s.week,sh.key)}>
                              <div style={{display:"flex",flexWrap:"wrap"}}>
                                {s.slots[sh.key].map(n=>(
                                  <OpChip key={n} name={n} operators={operators} draggable onDragStart={()=>onDragStart(s.week,sh.key,n)}/>
                                ))}
                              </div>
                            </td>
                          ))}
                          <td style={{padding:"8px",textAlign:"center"}}>
                            <button onClick={()=>toggleSat(s.week)} style={{background:hasSat?"#fdecea":"#f5f5f5",border:`1px solid ${hasSat?"#ef9a9a":"#ccc"}`,borderRadius:6,cursor:"pointer",padding:"4px 8px",fontSize:12,color:hasSat?"#b71c1c":"#555"}}>
                              {hasSat?"✓ Sam":"+ Sam"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {view==="colonnes" && (
              <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:8}}>
                {schedules.map(s=>{
                  const hasSat=satWeeks.includes(s.week);
                  const m=getMondayOfWeek(s.week), end=new Date(m); end.setDate(m.getDate()+(hasSat?5:4));
                  return (
                    <div key={s.week} style={{minWidth:200,background:"#fff",border:"1px solid #e0e0e0",borderRadius:10,overflow:"hidden",flexShrink:0}}>
                      <div style={{background:BRAND,color:"#fff",padding:"10px 14px"}}>
                        <div style={{fontWeight:700,fontSize:15}}>S{s.week}</div>
                        <div style={{fontSize:11,opacity:.7}}>{fmtDate(m)} – {fmtDate(end)}</div>
                        {hasSat&&<div style={{fontSize:10,background:"#c62828",borderRadius:3,padding:"1px 5px",marginTop:3,display:"inline-block"}}>⚠ Sam. travaillé</div>}
                        <button onClick={()=>toggleSat(s.week)} style={{display:"block",marginTop:4,background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:4,cursor:"pointer",padding:"2px 8px",fontSize:11,color:"#fff"}}>
                          {hasSat?"Retirer Sam.":"+ Sam. travaillé"}
                        </button>
                      </div>
                      {shiftMeta.map(sh=>(
                        <div key={sh.key} style={{background:sh.hbg,padding:"8px 10px",borderBottom:"1px solid rgba(0,0,0,0.06)"}} onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(s.week,sh.key)}>
                          <div style={{fontSize:11,fontWeight:600,color:sh.tc,marginBottom:4}}>{sh.label}</div>
                          <div style={{display:"flex",flexWrap:"wrap"}}>
                            {s.slots[sh.key].map(n=>(
                              <OpChip key={n} name={n} operators={operators} draggable onDragStart={()=>onDragStart(s.week,sh.key,n)}/>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab==="conges" && (
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Gestion des congés</div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"16px 18px",marginBottom:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>Déclarer des congés</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:12,color:"#666",marginBottom:4}}>Opérateur</div>
                  <select value={leaveOp} onChange={e=>setLeaveOp(e.target.value)} style={{padding:"6px 10px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                    <option value="">-- Choisir --</option>
                    {activeOps.map(o=><option key={o.id} value={o.short}>{o.full}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#666",marginBottom:4}}>Sem. début</div>
                  <input type="number" min={1} max={52} value={leaveFrom} onChange={e=>setLeaveFrom(Number(e.target.value))} style={{width:70,padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#666",marginBottom:4}}>Jour début</div>
                  <select value={leaveFromDay} onChange={e=>setLeaveFromDay(Number(e.target.value))} style={{padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                    {[1,2,3,4,5].map(d=><option key={d} value={d}>{DAYS_FR[d]}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#666",marginBottom:4}}>Sem. fin</div>
                  <input type="number" min={1} max={52} value={leaveTo} onChange={e=>setLeaveTo(Number(e.target.value))} style={{width:70,padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
                </div>
                <div>
                  <div style={{fontSize:12,color:"#666",marginBottom:4}}>Jour fin</div>
                  <select value={leaveToDay} onChange={e=>setLeaveToDay(Number(e.target.value))} style={{padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                    {[1,2,3,4,5].map(d=><option key={d} value={d}>{DAYS_FR[d]}</option>)}
                  </select>
                </div>
                <button onClick={addLeave} style={{padding:"7px 18px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}>Ajouter</button>
              </div>
              <div style={{fontSize:12,color:"#888",marginTop:8}}>Semaine complète = Lun → Ven. Les semaines complètes génèrent un remplacement automatique.</div>
            </div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #f0f0f0",fontWeight:600,fontSize:13,background:"#f9f9f9"}}>Congés planifiés</div>
              {Object.keys(leaves).length===0 && <div style={{padding:"20px",fontSize:13,color:"#999",textAlign:"center"}}>Aucun congé planifié</div>}
              {(()=>{
                const byOp={};
                Object.entries(leaves).forEach(([w,arr])=>arr.forEach(e=>{
                  const s=leaveShort(e); if(!byOp[s]) byOp[s]=[];
                  byOp[s].push({week:Number(w),entry:e});
                }));
                return Object.entries(byOp).sort((a,b)=>a[0].localeCompare(b[0])).map(([opShort,items])=>{
                  const opFull=operators.find(o=>o.short===opShort)?.full||opShort;
                  return (
                    <div key={opShort} style={{padding:"12px 16px",borderBottom:"1px solid #f0f0f0"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <span style={{fontWeight:500,fontSize:14}}>{opFull}</span>
                        <LevelBadge level={operators.find(o=>o.short===opShort)?.level||"N1"}/>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {[...items].sort((a,b)=>a.week-b.week).map(({week,entry})=>{
                          const m=getMondayOfWeek(week), lbl=leaveLabel(entry), isFull=lbl==="Semaine complète";
                          return (
                            <span key={`${week}-${entry}`} style={{background:isFull?"#e8f5e9":"#fff8e1",color:isFull?"#2e7d32":"#f57f17",borderRadius:20,padding:"3px 10px",fontSize:12,display:"flex",alignItems:"center",gap:5,border:`1px solid ${isFull?"#a5d6a7":"#ffe082"}`}}>
                              <strong>S{week}</strong> · {fmtDate(m)} · {lbl}
                              <button onClick={()=>removeLeaveEntry(week,entry)} style={{background:"none",border:"none",cursor:"pointer",color:"inherit",padding:0,fontSize:14}}>×</button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {tab==="absences" && (
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Historique des absences ponctuelles</div>
            {Object.keys(absences).length===0 && <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"24px",fontSize:13,color:"#999",textAlign:"center"}}>Aucune absence enregistrée</div>}
            {Object.keys(absences).length>0 && (
              <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0"}}>
                      <th style={{padding:"10px 14px",textAlign:"left"}}>Semaine</th>
                      <th style={{padding:"10px 14px",textAlign:"left"}}>Dates</th>
                      <th style={{padding:"10px 14px",textAlign:"left"}}>Opérateurs absents</th>
                      <th style={{padding:"10px 14px",textAlign:"center",width:80}}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(absences).sort((a,b)=>Number(a[0])-Number(b[0])).map(([week,ops],i)=>(
                      <tr key={week} style={{borderBottom:"1px solid #f0f0f0",background:i%2===0?"#fff":"#fafafa"}}>
                        <td style={{padding:"10px 14px",fontWeight:600}}>S{week}</td>
                        <td style={{padding:"10px 14px",fontSize:12,color:"#666"}}>{formatWeekDates(Number(week))}</td>
                        <td style={{padding:"10px 14px"}}>
                          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                            {ops.map(op=>{
                              const lv=operators.find(o=>o.short===op)?.level||"N1";
                              const s=LEVEL_BADGE[lv];
                              return (
                                <span key={op} style={{display:"inline-flex",alignItems:"center",gap:5,background:"#fdecea",color:"#b71c1c",borderRadius:20,padding:"3px 10px",fontSize:12}}>
                                  <span style={{background:s.bg,color:s.color,borderRadius:3,padding:"0 4px",fontSize:10,fontWeight:600}}>{lv}</span>
                                  {op}
                                  <button onClick={()=>removeAbsence(Number(week),op)} style={{background:"none",border:"none",cursor:"pointer",color:"#b71c1c",padding:0,fontSize:14}}>×</button>
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{padding:"10px 14px",textAlign:"center"}}>
                          <button onClick={()=>{const n={...absences};delete n[week];saveAbsences(n);}} style={{padding:"3px 10px",borderRadius:5,border:"1px solid #ccc",background:"#f5f5f5",cursor:"pointer",fontSize:12,color:"#555"}}>Vider</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab==="equite" && (
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Équité — S{startWeek} à S{startWeek+numWeeks-1}</div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0"}}>
                    <th style={{padding:"10px 14px",textAlign:"left"}}>Opérateur</th>
                    <th style={{padding:"10px 14px",textAlign:"left"}}>Niveau</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#1B5E20"}}>Matin</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#F57F17"}}>AM</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#0D47A1"}}>Nuit</th>
                    <th style={{padding:"10px 14px",textAlign:"center"}}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {equity.map((op,i)=>(
                    <tr key={op.id} style={{borderBottom:"1px solid #f0f0f0",background:i%2===0?"#fff":"#fafafa"}}>
                      <td style={{padding:"10px 14px",fontWeight:500}}>{op.full}</td>
                      <td style={{padding:"10px 14px"}}><LevelBadge level={op.level}/></td>
                      {[{k:"matin",bg:"#D6EFD8",tc:"#1B5E20"},{k:"am",bg:"#FFF9C4",tc:"#F57F17"},{k:"nuit",bg:"#BBDEFB",tc:"#0D47A1"}].map(sh=>(
                        <td key={sh.k} style={{padding:"8px 14px",textAlign:"center"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                            <div style={{width:Math.round((op[sh.k]/numWeeks)*60),height:8,background:sh.bg,borderRadius:4,minWidth:2}}/>
                            <span style={{color:sh.tc,fontWeight:600}}>{op[sh.k]}</span>
                          </div>
                        </td>
                      ))}
                      <td style={{padding:"8px 14px",textAlign:"center"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                          <div style={{width:Math.round((op.total/maxTotal)*60),height:8,background:"#ccc",borderRadius:4,minWidth:2}}/>
                          <span style={{fontWeight:600}}>{op.total}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab==="equipe" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontWeight:600,fontSize:15}}>Équipe ({operators.length} opérateurs)</div>
              <button onClick={()=>setShowAddOp(!showAddOp)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13}}>
                + Ajouter
              </button>
            </div>
            {showAddOp && (
              <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:10,padding:16,marginBottom:14,display:"flex",flexWrap:"wrap",gap:10,alignItems:"flex-end"}}>
                {[{label:"Prénom",key:"prenom",w:120},{label:"NOM",key:"nom",w:120}].map(f=>(
                  <div key={f.key}>
                    <div style={{fontSize:12,color:"#666",marginBottom:4}}>{f.label}</div>
                    <input value={newOp[f.key]} onChange={e=>setNewOp({...newOp,[f.key]:e.target.value})} placeholder={f.label} style={{padding:"6px 10px",borderRadius:6,border:"1px solid #ccc",fontSize:13,width:f.w}}/>
                  </div>
                ))}
                <div>
                  <div style={{fontSize:12,color:"#666",marginBottom:4}}>Niveau</div>
                  <select value={newOp.level} onChange={e=>setNewOp({...newOp,level:e.target.value})} style={{padding:"6px 10px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                    {["N1","N2","N3","N4"].map(l=><option key={l}>{l}</option>)}
                  </select>
                </div>
                <button onClick={addOperator} style={{padding:"7px 16px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13}}>Enregistrer</button>
                <button onClick={()=>setShowAddOp(false)} style={{padding:"7px 14px",borderRadius:7,background:"#fff",color:"#333",border:"1px solid #ccc",cursor:"pointer",fontSize:13}}>Annuler</button>
              </div>
            )}
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
              {operators.map((op,i)=>(
                <div key={op.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:i<operators.length-1?"1px solid #f0f0f0":"none",opacity:op.active?1:.45}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:LEVEL_BADGE[op.level].bg,color:LEVEL_BADGE[op.level].color,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:12}}>
                      {op.full.split(" ").map(w=>w[0]).slice(0,2).join("")}
                    </div>
                    <div>
                      <div style={{fontWeight:500,fontSize:14}}>{op.full}</div>
                      <div style={{fontSize:12,color:"#888"}}>{op.active?"Actif":"Inactif"}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <LevelBadge level={op.level}/>
                    <button onClick={()=>toggleActive(op.id)} style={{padding:"4px 12px",borderRadius:6,border:"1px solid #ccc",background:"#fff",cursor:"pointer",fontSize:12,color:op.active?"#c62828":"#2e7d32"}}>
                      {op.active?"Désactiver":"Activer"}
                    </button>
                    <button onClick={()=>deleteOp(op.id)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #f5c6c6",background:"#fff5f5",cursor:"pointer",fontSize:12,color:"#c62828"}}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
