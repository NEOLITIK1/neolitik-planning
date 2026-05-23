import { useState, useEffect, useCallback, useRef } from "react";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SB_URL = "https://kgnpfwfuqwltxyrqfejk.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtnbnBmd2Z1cXdsdHh5cnFmZWprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyODExODMsImV4cCI6MjA5NDg1NzE4M30.1-y6H9mB65WdJPSGrn70m0Z4kgzDDdt2hnwD04QRqio";
const sbH = { "Content-Type":"application/json","apikey":SB_KEY,"Authorization":`Bearer ${SB_KEY}` };

async function sbGet(key) {
  const r = await fetch(`${SB_URL}/rest/v1/neolitik_config?key=eq.${key}&select=data`,{headers:sbH});
  const d = await r.json(); return d?.[0]?.data ?? null;
}
async function sbSet(key,data) {
  await fetch(`${SB_URL}/rest/v1/neolitik_config`,{
    method:"POST", headers:{...sbH,"Prefer":"resolution=merge-duplicates"},
    body:JSON.stringify({key,data}),
  });
}
async function sbGetOps() {
  const r = await fetch(`${SB_URL}/rest/v1/neolitik_operators?select=id,data`,{headers:sbH});
  const d = await r.json(); return d?.map(row=>({id:row.id,...row.data}))??null;
}
async function sbSetOps(ops) {
  const rows = ops.map(({id,...rest})=>({id,data:rest}));
  await fetch(`${SB_URL}/rest/v1/neolitik_operators`,{
    method:"POST", headers:{...sbH,"Prefer":"resolution=merge-duplicates"},
    body:JSON.stringify(rows),
  });
  const ids = ops.map(o=>o.id).join(",");
  if(ids) await fetch(`${SB_URL}/rest/v1/neolitik_operators?id=not.in.(${ids})`,{method:"DELETE",headers:sbH});
}

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const DEFAULT_OPERATORS = [
  {id:"martin",   full:"Maxime MARTIN",     short:"MARTIN",   level:"N4",active:true},
  {id:"lendormy", full:"Matthieu LENDORMY",  short:"LENDORMY", level:"N4",active:true},
  {id:"gibeaux",  full:"Théo GIBEAUX",       short:"GIBEAUX",  level:"N4",active:true},
  {id:"hebert",   full:"Maxime HEBERT",      short:"HEBERT",   level:"N3",active:true},
  {id:"bruny",    full:"Julien BRUNY",        short:"BRUNY",    level:"N2",active:true},
  {id:"vallet",   full:"Kévin VALLET",        short:"VALLET",   level:"N1",active:true},
  {id:"cadinot",  full:"Thomas CADINOT",     short:"CADINOT",  level:"N1",active:true},
  {id:"allain",   full:"Jason ALLAIN",        short:"ALLAIN",   level:"N1",active:true},
];

const BRAND = "#3a5c35";
const LEVEL_BADGE = {
  N4:{bg:"#C8E6C9",color:"#1B5E20"},
  N3:{bg:"#FFF9C4",color:"#F57F17"},
  N2:{bg:"#FFE0B2",color:"#BF360C"},
  N1:{bg:"#EEEEEE",color:"#424242"},
};
const DAYS_FR = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];

// Ordre d'affichage : Matin / AM / Nuit
const SHIFT_META = [
  {key:"matin", label:"Matin 5h50–14h",  bg:"#f0faf1", hbg:"#D6EFD8", tc:"#1B5E20"},
  {key:"am",    label:"AM 13h50–22h",    bg:"#fffde7", hbg:"#FFF9C4", tc:"#F57F17"},
  {key:"nuit",  label:"Nuit 21h50–6h",   bg:"#e3f2fd", hbg:"#BBDEFB", tc:"#0D47A1"},
];

// ── UTILITAIRES DATE ──────────────────────────────────────────────────────────
function getMondayOfWeek(w,year){
  const jan1=new Date(year,0,1),d=jan1.getDay()||7;
  const mon=new Date(year,0,d<=4?2-d:9-d);
  mon.setDate(mon.getDate()+(w-1)*7); return mon;
}
function fmtDate(d){return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;}
function formatWeekDates(w,year){
  const m=getMondayOfWeek(w,year),s=new Date(m); s.setDate(m.getDate()+4);
  return `${fmtDate(m)} – ${fmtDate(s)}`;
}
function getCurrentWeek(year){
  const now=new Date(),jan1=new Date(year,0,1),d=jan1.getDay()||7;
  const firstMon=new Date(year,0,d<=4?2-d:9-d);
  const diff=Math.floor((now-firstMon)/86400000);
  return diff<0?1:Math.floor(diff/7)+1;
}

// ── ALGORITHME DYNAMIQUE ──────────────────────────────────────────────────────
// Contraintes absolues : 1 N4/poste, 3 en nuit, jamais 2 nuits consécutives
// Rotation Nuit → AM → Matin
function buildSchedules(operators, startWeek, numWeeks, absences, leaves, overrides) {
  const active    = operators.filter(o=>o.active);
  // Les volants (N4 ajoutés manuellement) sont exclus du calcul automatique
  // Ils apparaissent uniquement via glissement manuel (réserve)
  const activeN4  = active.filter(o=>o.level==="N4" && !o.isVolant);
  const activeNon4= active.filter(o=>o.level!=="N4" && !o.isVolant);

  const nightCount= Object.fromEntries(active.map(o=>[o.short,0]));
  const matCount  = Object.fromEntries(active.map(o=>[o.short,0]));
  const amCount   = Object.fromEntries(active.map(o=>[o.short,0]));

  let prevNuit = [];
  const schedules = [];

  for(let i=0;i<numWeeks;i++){
    const s = startWeek+i;

    // Override manuel pour cette semaine ?
    if(overrides[s]){
      const ov = overrides[s];
      // Normalisation : on ne garde que les shorts (sécurité si nom complet stocké par erreur)
      const toShort = name => {
        const found = operators.find(o=>o.short===name||o.full===name);
        return found ? found.short : name;
      };
      const ovMatin = (ov.matin||[]).map(toShort);
      const ovAm    = (ov.am||[]).map(toShort);
      const ovNuit  = (ov.nuit||[]).map(toShort);
      schedules.push({s, matin:ovMatin, am:ovAm, nuit:ovNuit, alerts:[], isOverridden:true});
      ovMatin.forEach(o=>{if(matCount[o]!==undefined)matCount[o]++;});
      ovAm.forEach(o=>{if(amCount[o]!==undefined)amCount[o]++;});
      ovNuit.forEach(o=>{if(nightCount[o]!==undefined)nightCount[o]++;});
      prevNuit = ovNuit; // toujours des shorts normalisés
      continue;
    }

    // Absences de la semaine (complètes uniquement pour le remplacement)
    const absWeekFull = [
      ...(absences[s]||[]).filter(e=>!e.includes("|")),
      ...(leaves[s]||[]).filter(e=>!e.includes(":")),
    ];
    const absWeekPartial = (absences[s]||[]).filter(e=>e.includes("|"));
    const alerts = [];

    // ── NUIT ──
    // Disponibles : pas en nuit S-1, pas absents
    const availN4nuit  = activeN4.filter(o=>!prevNuit.includes(o.short)&&!absWeekFull.includes(o.short));
    const availNon4nuit= activeNon4.filter(o=>!prevNuit.includes(o.short)&&!absWeekFull.includes(o.short));

    // Tri : moins de nuits d'abord, départage : plus d'AM (rééquilibrage)
    const sortNuit = (a,b)=> nightCount[a.short]!==nightCount[b.short]
      ? nightCount[a.short]-nightCount[b.short]
      : amCount[b.short]-amCount[a.short];

    availN4nuit.sort(sortNuit);
    availNon4nuit.sort(sortNuit);

    let n4Nuit = availN4nuit[0];

    // Fallback si aucun N4 dispo pour la nuit : prendre le moins chargé même s'il était en nuit
    if(!n4Nuit){
      alerts.push(`⛔ S${s} : aucun N4 disponible en nuit — contrainte non satisfaite, glissement manuel requis`);
      const fallback = activeN4.filter(o=>!absWeekFull.includes(o.short));
      fallback.sort(sortNuit);
      n4Nuit = fallback[0];
    }

    const non4Nuit = availNon4nuit.slice(0,2);
    if(non4Nuit.length<2)
      alerts.push(`⛔ S${s} : effectif nuit insuffisant (${non4Nuit.length+1}/3) — glissement manuel requis`);

    const nuit = [n4Nuit?.short,...non4Nuit.map(o=>o.short)].filter(Boolean);

    // ── MATIN & AM ──
    const restN4   = activeN4.filter(o=>!nuit.includes(o.short)&&!absWeekFull.includes(o.short));
    const restNon4 = activeNon4.filter(o=>!nuit.includes(o.short)&&!absWeekFull.includes(o.short));

    // Tri Matin : moins de matin, départage : plus de nuits (rééquilibrage)
    const sortMat = (a,b)=> matCount[a.short]!==matCount[b.short]
      ? matCount[a.short]-matCount[b.short]
      : nightCount[b.short]-nightCount[a.short];

    restN4.sort(sortMat);
    restNon4.sort(sortMat);

    const n4Matin = restN4[0];
    const n4Am    = restN4[1];

    if(!n4Matin) alerts.push(`⛔ S${s} : aucun N4 disponible en matin — glissement manuel requis`);
    if(!n4Am)    alerts.push(`⛔ S${s} : aucun N4 disponible en AM — glissement manuel requis`);

    const matin = [n4Matin?.short, restNon4[0]?.short, restNon4[1]?.short].filter(Boolean);
    const am    = [n4Am?.short,    restNon4[2]?.short].filter(Boolean);

    if(matin.length<3) alerts.push(`⚠ S${s} : matin ${matin.length}/3`);
    if(am.length<2)    alerts.push(`⚠ S${s} : AM ${am.length}/2`);

    // Absences partielles : informatif
    absWeekPartial.forEach(e=>{
      const[short,,day]=e.split("|");
      alerts.push(`ℹ S${s} : ${short} absent le ${day}`);
    });

    schedules.push({s, matin, am, nuit, alerts, isOverridden:false});

    matin.forEach(o=>{if(matCount[o]!==undefined)matCount[o]++;});
    am.forEach(o=>{if(amCount[o]!==undefined)amCount[o]++;});
    nuit.forEach(o=>{if(nightCount[o]!==undefined)nightCount[o]++;});
    prevNuit = nuit;
  }
  return {schedules, nightCount, matCount, amCount};
}

// ── COMPOSANTS ────────────────────────────────────────────────────────────────
function LevelBadge({level}){
  const s=LEVEL_BADGE[level]||LEVEL_BADGE.N1;
  return <span style={{background:s.bg,color:s.color,borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:500}}>{level}</span>;
}

function OpChip({name,operators,draggable,onDragStart,highlight}){
  const op=operators.find(o=>o.short===name);
  const s=LEVEL_BADGE[op?.level||"N1"];
  return(
    <span draggable={draggable} onDragStart={onDragStart} title={op?.full||name}
      style={{display:"inline-flex",alignItems:"center",gap:3,
        background:highlight?"#FFF176":s.bg, color:s.color,
        borderRadius:4,padding:"2px 7px",fontSize:12,margin:"2px",fontWeight:500,
        cursor:draggable?"grab":"default",
        outline:highlight?"2px solid #F9A825":"none"}}>
      {name}
    </span>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]             = useState("planning");
  const [operators,setOperators] = useState(DEFAULT_OPERATORS);
  const [absences,setAbsences]   = useState({});
  const [leaves,setLeaves]       = useState({});
  const [overrides,setOverrides] = useState({}); // { semaine: {matin,am,nuit} }
  const [satWeeks,setSatWeeks]   = useState([]);
  const [notes,setNotes]         = useState({});
  const [year,setYear]           = useState(2026);
  const [history,setHistory]     = useState([]);
  const [startWeek,setStartWeek] = useState(22);
  const [numWeeks,setNumWeeks]   = useState(5);
  const [view,setView]           = useState("liste");
  const [showFullNames,setShowFullNames] = useState(false);
  const [highlightOp,setHighlightOp]     = useState(null);
  const [absOp,setAbsOp]   = useState(""); const [absWeek,setAbsWeek]   = useState(22); const [absDay,setAbsDay]   = useState(0);
  const [leaveOp,setLeaveOp]     = useState("");
  const [leaveFrom,setLeaveFrom] = useState(22); const [leaveTo,setLeaveTo]     = useState(22);
  const [leaveFromDay,setLeaveFromDay] = useState(1); const [leaveToDay,setLeaveToDay]   = useState(5);
  const [showAddOp,setShowAddOp] = useState(false);
  const [newOp,setNewOp]         = useState({prenom:"",nom:"",level:"N1"});
  const [syncMsg,setSyncMsg]     = useState("Chargement...");
  const [flashMsg,setFlashMsg]   = useState(null);
  const [schedules,setSchedules] = useState([]);
  const [equity,setEquity]       = useState([]);
  const [loaded,setLoaded]       = useState(false);
  const [exportModal,setExportModal] = useState(false);
  const dragRef = useRef(null);

  const weeks = Array.from({length:numWeeks},(_,i)=>startWeek+i);
  const currentWeek = getCurrentWeek(year);
  const flash = (msg,color="#2e7d32")=>{setFlashMsg({msg,color});setTimeout(()=>setFlashMsg(null),2500);};
  const activeOps = operators.filter(o=>o.active);

  // ── CHARGEMENT SUPABASE
  useEffect(()=>{
    (async()=>{
      try{
        setSyncMsg("Connexion...");
        const [ops,abs,lv,ov,sw,nt,hi,yr]=await Promise.all([
          sbGetOps(),sbGet("absences"),sbGet("leaves"),sbGet("overrides"),
          sbGet("satweeks"),sbGet("notes"),sbGet("history"),sbGet("year"),
        ]);
        if(ops&&ops.length>0)setOperators(ops);
        if(abs)setAbsences(abs); if(lv)setLeaves(lv); if(ov)setOverrides(ov);
        if(sw)setSatWeeks(sw); if(nt)setNotes(nt); if(hi)setHistory(hi);
        if(yr)setYear(Number(yr));
        setSyncMsg("Synchronisé ✓");
      }catch(e){setSyncMsg(`Erreur: ${e.message}`);}
      finally{setLoaded(true);}
    })();
  },[]);

  const save = useCallback(async(k,v)=>{
    setSyncMsg("Enreg...");
    try{await sbSet(k,v);setSyncMsg("Synchronisé ✓");}
    catch{setSyncMsg("Erreur sync");}
  },[]);

  const saveOperators = useCallback(v=>{setOperators(v);sbSetOps(v).then(()=>setSyncMsg("Synchronisé ✓")).catch(()=>setSyncMsg("Erreur sync"));},[]);
  const saveAbsences  = useCallback(v=>{setAbsences(v); save("absences",v);},[save]);
  const saveLeaves    = useCallback(v=>{setLeaves(v);   save("leaves",v);},[save]);
  const saveOverrides = useCallback(v=>{setOverrides(v);save("overrides",v);},[save]);
  const saveSatWeeks  = useCallback(v=>{setSatWeeks(v); save("satweeks",v);},[save]);
  const saveNotes     = useCallback(v=>{setNotes(v);    save("notes",v);},[save]);
  const saveYear      = useCallback(v=>{setYear(v);     save("year",String(v));},[save]);

  const pushHistory = useCallback((label,state)=>{
    setHistory(prev=>{
      const next=[{label,ts:Date.now(),state},...prev].slice(0,15);
      sbSet("history",next); return next;
    });
  },[]);

  // ── CALCUL PLANNING
  const recompute = useCallback((ops,abs,lv,ov,wks)=>{
    const {schedules:sc,nightCount,matCount,amCount} = buildSchedules(ops,wks[0],wks.length,abs,lv,ov);
    setSchedules(sc);
    const eq = ops.filter(o=>o.active).map(op=>({
      ...op,
      matin: matCount[op.short]||0,
      am:    amCount[op.short]||0,
      nuit:  nightCount[op.short]||0,
      total:(matCount[op.short]||0)+(amCount[op.short]||0)+(nightCount[op.short]||0),
    }));
    setEquity(eq);
  },[]);

  // Recalcul automatique uniquement sur changements structurels
  // (opérateurs, absences, congés, période) — PAS sur les overrides
  // Les overrides sont lus par buildSchedules mais ne déclenchent pas de recalcul
  useEffect(()=>{
    if(!loaded)return;
    recompute(operators,absences,leaves,overrides,weeks);
  },[loaded,startWeek,numWeeks,operators,absences,leaves,year]);

  // ── RECALCULER : absorbe les overrides, repart de l'algo pur
  // Recalcul : conserve tous les overrides manuels (option B)
  // L'algo recalcule les semaines sans override en tenant compte
  // des overrides comme contexte (prevNuit, compteurs équité)
  const recalculate = ()=>{
    pushHistory("Recalcul planning",{overrides});
    // On force un recalcul en retriggering le useEffect sans toucher aux overrides
    // Il suffit de re-sauvegarder les overrides tels quels pour déclencher le recalcul
    recompute(operators, absences, leaves, overrides, weeks);
    flash("Planning recalculé ✓");
  };

  const allAlerts = schedules.flatMap(s=>s.alerts).filter(a=>!a.startsWith("ℹ"));
  const allInfos  = schedules.flatMap(s=>s.alerts).filter(a=>a.startsWith("ℹ"));

  // ── ABSENCES
  const addAbsence = ()=>{
    if(!absOp)return;
    pushHistory(`Absence: ${absOp} S${absWeek}`,{absences});
    const entry = absDay===0 ? absOp : `${absOp}|${absWeek}|${DAYS_FR[absDay]}`;
    const cur=(absences[absWeek]||[]).filter(e=>{
      const s=e.includes("|")?e.split("|")[0]:e;
      return !(s===absOp&&(absDay===0?!e.includes("|"):e.includes("|")));
    });
    saveAbsences({...absences,[absWeek]:[...cur,entry]});
    flash(`Absence ajoutée : ${absOp} S${absWeek}`);
  };
  const removeAbsence = (week,entry)=>{
    const cur=(absences[week]||[]).filter(e=>e!==entry);
    const next={...absences}; if(!cur.length)delete next[week]; else next[week]=cur;
    saveAbsences(next);
  };

  // ── CONGÉS
  const leaveShort = e=>e.includes(":")?e.split(":")[0]:e;
  const leaveLabel = e=>{
    if(!e.includes(":"))return "Semaine complète";
    const[,range]=e.split(":");const[s,en]=range.split("-").map(Number);
    return `${DAYS_FR[s]} – ${DAYS_FR[en]}`;
  };
  const addLeave = ()=>{
    if(!leaveOp)return;
    pushHistory(`Congé: ${leaveOp}`,{leaves});
    const next={...leaves};
    for(let w=leaveFrom;w<=leaveTo;w++){
      const sd=w===leaveFrom?leaveFromDay:1, ed=w===leaveTo?leaveToDay:5;
      const entry=(sd===1&&ed>=5)?leaveOp:`${leaveOp}:${sd}-${ed}`;
      next[w]=[...(next[w]||[]).filter(e=>e!==leaveOp&&!e.startsWith(`${leaveOp}:`)),entry];
    }
    saveLeaves(next); flash(`Congé ajouté : ${leaveOp}`);
  };
  const removeLeave = (week,entry)=>{
    const cur=(leaves[week]||[]).filter(e=>e!==entry);
    const next={...leaves}; if(!cur.length)delete next[week]; else next[week]=cur;
    saveLeaves(next);
  };

  // ── DRAG & DROP (glissement ponctuel — ne déclenche PAS de recalcul)
  // onDragStart reçoit toujours le short (n dans les schedules = short)
  const onDragStart = (week,shift,name)=>{
    // Sécurité : normaliser vers le short au cas où
    const short = operators.find(o=>o.full===name)?.short || name;
    dragRef.current={week,shift,name:short};
  };
  const onDrop = (week,targetShift)=>{
    const src=dragRef.current;
    if(!src){ dragRef.current=null; return; }

    const cur = schedules.find(s=>s.s===week);
    if(!cur){ dragRef.current=null; return; }

    const existing = overrides[week]||{matin:[...cur.matin],am:[...cur.am],nuit:[...cur.nuit]};

    // Cas : glissement depuis la réserve volants
    if(src.shift==="reserve"){
      if((existing[targetShift]||[]).includes(src.name)){
        flash(`${src.name} déjà en ${targetShift} S${week}`,"#c62828");
        dragRef.current=null; return;
      }
      pushHistory(`Volant: ${src.name} → ${targetShift} S${week}`,{overrides});
      const newOvR={...overrides,[week]:{
        ...existing,
        [targetShift]:[...(existing[targetShift]||[]),src.name],
      }};
      setOverrides(newOvR);
      save("overrides",newOvR);
      setSchedules(prev=>prev.map(sc=>sc.s!==week?sc:{
        ...sc, [targetShift]:[...(sc[targetShift]||[]),src.name], isOverridden:true,
      }));
      flash(`${src.name} → ${targetShift} S${week}`);
      dragRef.current=null; return;
    }

    // Cas : glissement entre postes de la même semaine
    if(src.shift===targetShift||src.week!==week){ dragRef.current=null; return; }

    const nSrc=(existing[src.shift]||[]).filter(n=>n!==src.name);
    const nTgt=[...(existing[targetShift]||[]),src.name];
    pushHistory(`Glissement: ${src.name} S${week} ${src.shift}→${targetShift}`,{overrides});
    const newOvG={...overrides,[week]:{
      ...existing,
      [src.shift]:   nSrc,
      [targetShift]: nTgt,
    }};
    setOverrides(newOvG);
    save("overrides",newOvG);
    setSchedules(prev=>prev.map(sc=>sc.s!==week?sc:{
      ...sc, [src.shift]:nSrc, [targetShift]:nTgt, isOverridden:true,
    }));
    flash(`${src.name} → ${targetShift} S${week}`);
    dragRef.current=null;
  };

  // ── UNDO
  const undoLast = ()=>{
    if(!history.length)return;
    const last=history[0],st=last.state;
    if(st.operators){setOperators(st.operators);sbSetOps(st.operators);}
    if(st.absences){setAbsences(st.absences);save("absences",st.absences);}
    if(st.leaves){setLeaves(st.leaves);save("leaves",st.leaves);}
    if(st.overrides){setOverrides(st.overrides);save("overrides",st.overrides);}
    const newH=history.slice(1); setHistory(newH); sbSet("history",newH);
    flash(`Annulé : ${last.label}`,"#c62828");
  };

  // ── ÉQUIPE
  const addOperator = ()=>{
    if(!newOp.prenom.trim()||!newOp.nom.trim())return;
    const short=newOp.nom.toUpperCase().trim();
    // Les N4 ajoutés manuellement sont des volants : exclus du calcul auto, en réserve uniquement
    const isVolant = newOp.level==="N4";
    const op={id:`op_${Date.now()}`,full:`${newOp.prenom.trim()} ${short}`,short,level:newOp.level,active:true,isVolant};
    saveOperators([...operators,op]);
    setNewOp({prenom:"",nom:"",level:"N1"}); setShowAddOp(false);
    flash(`${op.full} ajouté${isVolant?" (volant N4 — glissement manuel)":""}`);
  };
  const toggleActive = id=>saveOperators(operators.map(o=>o.id===id?{...o,active:!o.active}:o));
  const deleteOp = id=>{if(window.confirm("Supprimer définitivement ?"))saveOperators(operators.filter(o=>o.id!==id));};

  const toggleSat = w=>saveSatWeeks(satWeeks.includes(w)?satWeeks.filter(x=>x!==w):[...satWeeks,w]);

  // ── EXPORT
  const exportText = ()=>{
    let txt="NEOLITIK – Planning 3×8\nSemaine\tMatin\tAM\tNuit\n";
    schedules.forEach(({s,matin,am,nuit})=>{
      txt+=`S${s}\t${matin.join(", ")}\t${am.join(", ")}\t${nuit.join(", ")}\n`;
    });
    return txt;
  };

  const chipName = n=> showFullNames ? (operators.find(o=>o.short===n)?.full||n) : n;

  const TABS=[
    {id:"planning", label:"Planning",   icon:"📅"},
    {id:"conges",   label:"Congés",     icon:"🏖"},
    {id:"absences", label:"Historique", icon:"📋"},
    {id:"equite",   label:"Équité",     icon:"📊"},
    {id:"equipe",   label:"Équipe",     icon:"👥"},
  ];

  const maxEquity = Math.max(...equity.map(e=>e.total),1);
  const imbalance = op => Math.max(op.matin,op.am,op.nuit)-Math.min(op.matin,op.am,op.nuit) > numWeeks*0.4;

  // ── RENDER ────────────────────────────────────────────────────────────────
  return(
    <div style={{fontFamily:"'DM Sans','Outfit',sans-serif",background:"#f7f8fa",minHeight:"100vh"}}>

      {/* Flash */}
      {flashMsg&&<div style={{position:"fixed",top:16,right:16,zIndex:9999,background:flashMsg.color,color:"#fff",padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:600,boxShadow:"0 4px 12px rgba(0,0,0,.2)"}}>{flashMsg.msg}</div>}

      {/* Export modal */}
      {exportModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{background:"#fff",borderRadius:12,width:560,maxWidth:"92vw",padding:24,boxShadow:"0 8px 40px rgba(0,0,0,.18)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <span style={{fontWeight:600,fontSize:14}}>Données à copier</span>
              <button onClick={()=>setExportModal(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#666"}}>×</button>
            </div>
            <textarea readOnly value={exportText()} style={{width:"100%",height:220,fontFamily:"monospace",fontSize:11,border:"1px solid #e0e0e0",borderRadius:6,padding:10,resize:"vertical",background:"#f8f8f7",color:"#000"}}/>
            <div style={{display:"flex",gap:10,marginTop:12,alignItems:"center"}}>
              <button onClick={()=>{const ta=document.querySelector("#export-ta");ta&&ta.select();document.execCommand("copy");flash("Copié !")}}
                style={{background:BRAND,color:"#fff",border:"none",borderRadius:6,padding:"8px 18px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
                Copier
              </button>
              <span style={{fontSize:11,color:"#888"}}>Collez dans une nouvelle conversation pour générer le fichier Excel.</span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{background:BRAND,color:"#fff",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:52,position:"sticky",top:0,zIndex:100}}>
        <span style={{fontWeight:700,fontSize:18,letterSpacing:1.5}}>NEOLITIK</span>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {history.length>0&&(
            <button onClick={undoLast} title={`Annuler : ${history[0]?.label}`}
              style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",borderRadius:6,cursor:"pointer",padding:"4px 10px",fontSize:12,color:"#fff"}}>
              ↩ Annuler
            </button>
          )}
          <button onClick={()=>setExportModal(true)} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",borderRadius:6,cursor:"pointer",padding:"4px 12px",fontSize:12,color:"#fff"}}>
            ↑ Exporter
          </button>
          <span style={{fontSize:11,opacity:.7}}>{syncMsg}</span>
        </div>
      </div>

      {/* Onglets */}
      <div style={{display:"flex",borderBottom:"1px solid #e0e0e0",background:"#fff",paddingLeft:16,overflowX:"auto",position:"sticky",top:52,zIndex:99}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{background:"none",border:"none",padding:"11px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:tab===t.id?600:400,color:tab===t.id?BRAND:"#666",borderBottom:tab===t.id?`2px solid ${BRAND}`:"2px solid transparent",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{padding:"20px 20px 60px",maxWidth:1200,margin:"0 auto"}}>

        {/* ══ PLANNING ══ */}
        {tab==="planning"&&(
          <div>
            {/* Barre contrôle */}
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"12px 16px",marginBottom:12,display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <label style={{fontSize:13,color:"#555",fontWeight:500}}>Année</label>
                <select value={year} onChange={e=>saveYear(Number(e.target.value))} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                  {[2025,2026,2027,2028,2029].map(y=><option key={y}>{y}</option>)}
                </select>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <label style={{fontSize:13,color:"#555",fontWeight:500}}>Sem. départ</label>
                <input type="number" min={1} max={52} value={startWeek} onChange={e=>setStartWeek(Number(e.target.value))} style={{width:60,padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {[3,5,10,15,26].map(n=>(
                  <button key={n} onClick={()=>setNumWeeks(n)} style={{padding:"4px 10px",borderRadius:6,border:"1px solid #ccc",background:numWeeks===n?BRAND:"#fff",color:numWeeks===n?"#fff":"#333",cursor:"pointer",fontSize:13}}>{n}</button>
                ))}
                <span style={{fontSize:13,color:"#888"}}>sem.</span>
              </div>
              <div style={{display:"flex",gap:6,marginLeft:"auto",flexWrap:"wrap"}}>
                <button onClick={recalculate} style={{padding:"6px 16px",borderRadius:7,background:"#c62828",color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}
                  title="Absorbe les ajustements manuels et repart de l'algorithme">
                  🔄 Recalculer
                </button>
                {[{k:"liste",l:"📋 Liste"},{k:"colonnes",l:"🗂 Colonnes"}].map(v=>(
                  <button key={v.k} onClick={()=>setView(v.k)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid #ccc",background:view===v.k?BRAND:"#fff",color:view===v.k?"#fff":"#333",cursor:"pointer",fontSize:13}}>{v.l}</button>
                ))}
                <button onClick={()=>setShowFullNames(p=>!p)} style={{padding:"5px 10px",borderRadius:6,border:"1px solid #ccc",background:showFullNames?"#e8f5e9":"#fff",cursor:"pointer",fontSize:13}}>
                  👤 {showFullNames?"Court":"Complet"}
                </button>
              </div>
            </div>

            {/* Réserve volants N4 */}
            {operators.filter(o=>o.active&&o.isVolant).length>0&&(
              <div style={{background:"#fff",borderRadius:10,border:"2px dashed #a5d6a7",padding:"10px 16px",marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:600,color:BRAND,marginBottom:6}}>🔄 Réserve — Glissez un volant N4 vers un poste</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {operators.filter(o=>o.active&&o.isVolant).map(op=>(
                    <span key={op.id} draggable
                      onDragStart={()=>{ dragRef.current={week:null,shift:"reserve",name:op.short}; }}
                      title={op.full}
                      style={{display:"inline-flex",alignItems:"center",gap:4,background:"#C8E6C9",color:"#1B5E20",borderRadius:6,padding:"4px 12px",fontSize:13,fontWeight:600,cursor:"grab",border:"1px solid #a5d6a7"}}>
                      ✋ {op.short} <span style={{fontSize:10,opacity:.7}}>volant</span>
                    </span>
                  ))}
                </div>
                <div style={{fontSize:11,color:"#888",marginTop:5}}>Glissement ponctuel uniquement. Pour intégrer au cycle : 🔄 Recalculer après placement.</div>
              </div>
            )}

            {/* Surlignage */}
            <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10,alignItems:"center"}}>
              <span style={{fontSize:12,color:"#888"}}>Surligner :</span>
              <button onClick={()=>setHighlightOp(null)} style={{padding:"2px 10px",borderRadius:20,border:"1px solid #ccc",background:!highlightOp?BRAND:"#fff",color:!highlightOp?"#fff":"#555",cursor:"pointer",fontSize:12}}>Tous</button>
              {activeOps.map(o=>{
                const s=LEVEL_BADGE[o.level];
                return(
                  <button key={o.id} onClick={()=>setHighlightOp(highlightOp===o.short?null:o.short)}
                    style={{padding:"2px 10px",borderRadius:20,border:`1px solid ${s.bg}`,background:highlightOp===o.short?s.bg:"#fff",color:s.color,cursor:"pointer",fontSize:12,fontWeight:highlightOp===o.short?700:400}}>
                    {o.short}
                  </button>
                );
              })}
            </div>

            {/* Absence ponctuelle */}
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"12px 16px",marginBottom:12}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Absence ponctuelle</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                <select value={absOp} onChange={e=>setAbsOp(e.target.value)} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                  <option value="">-- Opérateur --</option>
                  {activeOps.map(o=><option key={o.id} value={o.short}>{o.full}</option>)}
                </select>
                <span style={{fontSize:13,color:"#555"}}>S.</span>
                <input type="number" min={1} max={52} value={absWeek} onChange={e=>setAbsWeek(Number(e.target.value))} style={{width:58,padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
                <select value={absDay} onChange={e=>setAbsDay(Number(e.target.value))} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>
                  <option value={0}>Semaine complète</option>
                  {[1,2,3,4,5].map(d=><option key={d} value={d}>{DAYS_FR[d]}</option>)}
                </select>
                <button onClick={addAbsence} style={{padding:"5px 14px",borderRadius:6,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13}}>Ajouter</button>
              </div>
              <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:5}}>
                {Object.entries(absences).sort((a,b)=>Number(a[0])-Number(b[0])).flatMap(([week,arr])=>
                  arr.map(entry=>{
                    const isP=entry.includes("|");
                    const[short,,dayLbl]=isP?entry.split("|"):[entry,null,null];
                    return(
                      <span key={`${week}-${entry}`} style={{background:isP?"#fff8e1":"#fdecea",color:isP?"#f57f17":"#b71c1c",borderRadius:20,padding:"3px 10px",fontSize:12,display:"flex",alignItems:"center",gap:5}}>
                        S{week} – {short}{isP?` (${dayLbl})`:""}
                        <button onClick={()=>removeAbsence(Number(week),entry)} style={{background:"none",border:"none",cursor:"pointer",color:"inherit",padding:0,fontSize:14}}>×</button>
                      </span>
                    );
                  })
                )}
              </div>
            </div>

            {/* Alertes critiques */}
            {allAlerts.length>0&&(
              <div style={{background:"#fdecea",border:"1px solid #ef9a9a",borderRadius:8,padding:"10px 14px",marginBottom:10,fontSize:13,color:"#b71c1c"}}>
                <strong>⚠ Alertes ({allAlerts.length})</strong>
                <ul style={{margin:"4px 0 0 16px",padding:0}}>
                  {allAlerts.map((a,i)=><li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            {/* Infos partielles */}
            {allInfos.length>0&&(
              <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:8,padding:"8px 14px",marginBottom:10,fontSize:12,color:"#f57f17"}}>
                {allInfos.map((a,i)=><div key={i}>{a}</div>)}
              </div>
            )}

            {/* Légende */}
            <div style={{fontSize:12,color:"#555",marginBottom:10,background:"#f0f4ff",border:"1px solid #c5cae9",borderRadius:7,padding:"8px 12px"}}>
              💡 <strong>Glissement :</strong> faites glisser un opérateur d'un poste à un autre pour un ajustement ponctuel — marqué ✏.<br/>
              🔄 <strong>Recalculer :</strong> absorbe tous les ajustements manuels comme nouvelle base et repart de l'algorithme.
            </div>

            {/* VUE LISTE */}
            {view==="liste"&&(
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #e0e0e0",fontSize:13}}>
                  <thead>
                    <tr style={{background:BRAND,color:"#fff"}}>
                      <th style={{padding:"10px 12px",textAlign:"left",minWidth:80}}>Semaine</th>
                      <th style={{padding:"10px 12px",textAlign:"left",minWidth:110}}>Dates</th>
                      <th style={{padding:"10px 12px",background:"#D6EFD8",color:"#1B5E20",minWidth:150}}>Matin 5h50–14h</th>
                      <th style={{padding:"10px 12px",background:"#FFF9C4",color:"#F57F17",minWidth:130}}>AM 13h50–22h</th>
                      <th style={{padding:"10px 12px",background:"#BBDEFB",color:"#0D47A1",minWidth:150}}>Nuit 21h50–6h</th>
                      <th style={{padding:"10px 12px",textAlign:"center",width:80,fontSize:11}}>Sam.</th>
                      <th style={{padding:"10px 12px",minWidth:120,fontSize:11}}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((sc,i)=>{
                      const hasSat=satWeeks.includes(sc.s);
                      const isCurrent=sc.s===currentWeek;
                      const m=getMondayOfWeek(sc.s,year),end=new Date(m);
                      end.setDate(m.getDate()+(hasSat?5:4));
                      const hasAlert=sc.alerts.some(a=>!a.startsWith("ℹ"));
                      return(
                        <tr key={sc.s} style={{borderBottom:"1px solid #f0f0f0",background:isCurrent?"#f1f8e9":i%2===0?"#fff":"#fafafa",outline:isCurrent?`2px solid ${BRAND}`:"none"}}>
                          <td style={{padding:"10px 12px",fontWeight:700,color:isCurrent?BRAND:"inherit"}}>
                            S{sc.s}
                            {isCurrent&&<span style={{marginLeft:4,fontSize:10,background:BRAND,color:"#fff",borderRadius:3,padding:"1px 4px"}}>● Now</span>}
                            {sc.isOverridden&&<span style={{marginLeft:4,fontSize:10,background:"#fff3e0",color:"#e65100",borderRadius:3,padding:"1px 4px"}}>✏</span>}
                            {hasAlert&&<span style={{marginLeft:4,fontSize:10,background:"#fdecea",color:"#c62828",borderRadius:3,padding:"1px 4px"}}>⚠</span>}
                          </td>
                          <td style={{padding:"10px 12px",fontSize:12}}>
                            <div>{fmtDate(m)} – {fmtDate(end)}</div>
                            {hasSat&&<div style={{fontSize:11,color:"#c62828",fontWeight:600,marginTop:2}}>⚠ Sam. travaillé</div>}
                          </td>
                          {SHIFT_META.map(sh=>{
                            const ops_in_shift = sc[sh.key]||[];
                            const hasShiftAlert = sc.alerts.some(a=>a.includes(sh.key==="matin"?"matin":sh.key==="am"?"AM":"nuit")&&!a.startsWith("ℹ"));
                            return(
                              <td key={sh.key} style={{padding:"8px",background:hasShiftAlert?"#fdecea":sh.bg}}
                                onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(sc.s,sh.key)}>
                                <div style={{display:"flex",flexWrap:"wrap"}}>
                                  {ops_in_shift.map(n=>(
                                    <OpChip key={n} name={chipName(n)} operators={operators} draggable
                                      onDragStart={()=>onDragStart(sc.s,sh.key,n)}
                                      highlight={!!(highlightOp&&n===highlightOp)}/>
                                  ))}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{padding:"8px",textAlign:"center"}}>
                            <button onClick={()=>toggleSat(sc.s)} style={{background:hasSat?"#fdecea":"#f5f5f5",border:`1px solid ${hasSat?"#ef9a9a":"#ccc"}`,borderRadius:6,cursor:"pointer",padding:"4px 8px",fontSize:12,color:hasSat?"#b71c1c":"#555"}}>
                              {hasSat?"✓ Sam":"+ Sam"}
                            </button>
                          </td>
                          <td style={{padding:"8px 10px"}}>
                            <input value={notes[sc.s]||""} onChange={e=>saveNotes({...notes,[sc.s]:e.target.value})}
                              placeholder="Note…" style={{width:"100%",padding:"4px 6px",borderRadius:5,border:"1px solid #e0e0e0",fontSize:12,background:"transparent"}}/>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* VUE COLONNES */}
            {view==="colonnes"&&(
              <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:8}}>
                {schedules.map(sc=>{
                  const hasSat=satWeeks.includes(sc.s);
                  const isCurrent=sc.s===currentWeek;
                  const hasAlert=sc.alerts.some(a=>!a.startsWith("ℹ"));
                  const m=getMondayOfWeek(sc.s,year),end=new Date(m);
                  end.setDate(m.getDate()+(hasSat?5:4));
                  return(
                    <div key={sc.s} style={{minWidth:200,background:"#fff",border:`2px solid ${hasAlert?"#ef9a9a":isCurrent?BRAND:"#e0e0e0"}`,borderRadius:10,overflow:"hidden",flexShrink:0}}>
                      <div style={{background:hasAlert?"#c62828":isCurrent?"#2d4828":BRAND,color:"#fff",padding:"10px 14px"}}>
                        <div style={{fontWeight:700,fontSize:15,display:"flex",alignItems:"center",gap:6}}>
                          S{sc.s}
                          {isCurrent&&<span style={{fontSize:10,background:"rgba(255,255,255,.25)",borderRadius:3,padding:"1px 4px"}}>● Now</span>}
                          {sc.isOverridden&&<span style={{fontSize:10,background:"rgba(255,165,0,.35)",borderRadius:3,padding:"1px 4px"}}>✏</span>}
                        </div>
                        <div style={{fontSize:11,opacity:.8}}>{fmtDate(m)} – {fmtDate(end)}{hasSat?" · Sam ⚠":""}</div>
                        <input value={notes[sc.s]||""} onChange={e=>saveNotes({...notes,[sc.s]:e.target.value})}
                          placeholder="Note…" style={{marginTop:5,width:"100%",padding:"3px 6px",borderRadius:4,border:"1px solid rgba(255,255,255,.3)",fontSize:11,background:"rgba(255,255,255,.1)",color:"#fff"}}/>
                      </div>
                      {SHIFT_META.map(sh=>{
                        const ops_in_shift=sc[sh.key]||[];
                        const hasShiftAlert=sc.alerts.some(a=>a.includes(sh.key==="matin"?"matin":sh.key==="am"?"AM":"nuit")&&!a.startsWith("ℹ"));
                        return(
                          <div key={sh.key} style={{background:hasShiftAlert?"#fdecea":sh.hbg,padding:"8px 10px",borderBottom:"1px solid rgba(0,0,0,.06)"}}
                            onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(sc.s,sh.key)}>
                            <div style={{fontSize:11,fontWeight:600,color:sh.tc,marginBottom:4}}>{sh.label}</div>
                            <div style={{display:"flex",flexWrap:"wrap"}}>
                              {ops_in_shift.map(n=>(
                                <OpChip key={n} name={chipName(n)} operators={operators} draggable
                                  onDragStart={()=>onDragStart(sc.s,sh.key,n)}
                                  highlight={!!(highlightOp&&n===highlightOp)}/>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ CONGÉS ══ */}
        {tab==="conges"&&(
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Gestion des congés</div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"16px 18px",marginBottom:20}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>Déclarer des congés</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
                {[
                  {label:"Opérateur",el:<select value={leaveOp} onChange={e=>setLeaveOp(e.target.value)} style={{padding:"6px 10px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}><option value="">-- Choisir --</option>{activeOps.map(o=><option key={o.id} value={o.short}>{o.full}</option>)}</select>},
                  {label:"Sem. début",el:<input type="number" min={1} max={52} value={leaveFrom} onChange={e=>setLeaveFrom(Number(e.target.value))} style={{width:70,padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>},
                  {label:"Jour début",el:<select value={leaveFromDay} onChange={e=>setLeaveFromDay(Number(e.target.value))} style={{padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>{[1,2,3,4,5].map(d=><option key={d} value={d}>{DAYS_FR[d]}</option>)}</select>},
                  {label:"Sem. fin",el:<input type="number" min={1} max={52} value={leaveTo} onChange={e=>setLeaveTo(Number(e.target.value))} style={{width:70,padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>},
                  {label:"Jour fin",el:<select value={leaveToDay} onChange={e=>setLeaveToDay(Number(e.target.value))} style={{padding:"6px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}>{[1,2,3,4,5].map(d=><option key={d} value={d}>{DAYS_FR[d]}</option>)}</select>},
                ].map(({label,el})=>(
                  <div key={label}><div style={{fontSize:12,color:"#666",marginBottom:4}}>{label}</div>{el}</div>
                ))}
                <button onClick={addLeave} style={{padding:"7px 18px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}>Ajouter</button>
              </div>
              <div style={{fontSize:12,color:"#888",marginTop:8}}>Semaine complète = remplacement automatique. Jours partiels = informatif uniquement.</div>
            </div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
              <div style={{padding:"12px 16px",borderBottom:"1px solid #f0f0f0",fontWeight:600,fontSize:13,background:"#f9f9f9"}}>Congés planifiés</div>
              {Object.keys(leaves).length===0&&<div style={{padding:"20px",fontSize:13,color:"#999",textAlign:"center"}}>Aucun congé planifié</div>}
              {(()=>{
                const byOp={};
                Object.entries(leaves).forEach(([w,arr])=>arr.forEach(e=>{
                  const s=leaveShort(e); if(!byOp[s])byOp[s]=[];
                  byOp[s].push({week:Number(w),entry:e});
                }));
                return Object.entries(byOp).sort((a,b)=>a[0].localeCompare(b[0])).map(([opShort,items])=>{
                  const opFull=operators.find(o=>o.short===opShort)?.full||opShort;
                  return(
                    <div key={opShort} style={{padding:"12px 16px",borderBottom:"1px solid #f0f0f0"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <span style={{fontWeight:500,fontSize:14}}>{opFull}</span>
                        <LevelBadge level={operators.find(o=>o.short===opShort)?.level||"N1"}/>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                        {[...items].sort((a,b)=>a.week-b.week).map(({week,entry})=>{
                          const mm=getMondayOfWeek(week,year),lbl=leaveLabel(entry),isFull=lbl==="Semaine complète";
                          return(
                            <span key={`${week}-${entry}`} style={{background:isFull?"#e8f5e9":"#fff8e1",color:isFull?"#2e7d32":"#f57f17",borderRadius:20,padding:"3px 10px",fontSize:12,display:"flex",alignItems:"center",gap:5,border:`1px solid ${isFull?"#a5d6a7":"#ffe082"}`}}>
                              <strong>S{week}</strong> · {fmtDate(mm)} · {lbl}
                              <button onClick={()=>removeLeave(week,entry)} style={{background:"none",border:"none",cursor:"pointer",color:"inherit",padding:0,fontSize:14}}>×</button>
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

        {/* ══ HISTORIQUE ══ */}
        {tab==="absences"&&(
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Historique absences ponctuelles</div>
            {Object.keys(absences).length===0
              ?<div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"24px",fontSize:13,color:"#999",textAlign:"center"}}>Aucune absence</div>
              :(
                <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden",marginBottom:24}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead><tr style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0"}}>
                      <th style={{padding:"10px 14px",textAlign:"left"}}>Semaine</th>
                      <th style={{padding:"10px 14px",textAlign:"left"}}>Dates</th>
                      <th style={{padding:"10px 14px",textAlign:"left"}}>Absences</th>
                      <th style={{padding:"10px 14px",textAlign:"center",width:80}}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {Object.entries(absences).sort((a,b)=>Number(a[0])-Number(b[0])).map(([week,arr],i)=>(
                        <tr key={week} style={{borderBottom:"1px solid #f0f0f0",background:i%2===0?"#fff":"#fafafa"}}>
                          <td style={{padding:"10px 14px",fontWeight:600}}>S{week}</td>
                          <td style={{padding:"10px 14px",fontSize:12,color:"#666"}}>{formatWeekDates(Number(week),year)}</td>
                          <td style={{padding:"10px 14px"}}>
                            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                              {arr.map(entry=>{
                                const isP=entry.includes("|");
                                const[short,,dayLbl]=isP?entry.split("|"):[entry,null,null];
                                const lv=operators.find(o=>o.short===short)?.level||"N1";
                                const s=LEVEL_BADGE[lv];
                                return(
                                  <span key={entry} style={{display:"inline-flex",alignItems:"center",gap:5,background:isP?"#fff8e1":"#fdecea",color:isP?"#f57f17":"#b71c1c",borderRadius:20,padding:"3px 10px",fontSize:12}}>
                                    <span style={{background:s.bg,color:s.color,borderRadius:3,padding:"0 4px",fontSize:10,fontWeight:600}}>{lv}</span>
                                    {short}{isP?` — ${dayLbl}`:" (sem.)"}
                                    <button onClick={()=>removeAbsence(Number(week),entry)} style={{background:"none",border:"none",cursor:"pointer",color:"inherit",padding:0,fontSize:14}}>×</button>
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td style={{padding:"10px 14px",textAlign:"center"}}>
                            <button onClick={()=>{const n={...absences};delete n[week];saveAbsences(n);}} style={{padding:"3px 10px",borderRadius:5,border:"1px solid #ccc",background:"#f5f5f5",cursor:"pointer",fontSize:12}}>Vider</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Journal des actions</div>
            {history.length===0
              ?<div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"20px",fontSize:13,color:"#999",textAlign:"center"}}>Aucune action</div>
              :(
                <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
                  {history.map((h,i)=>(
                    <div key={h.ts} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:i<history.length-1?"1px solid #f0f0f0":"none",background:i===0?"#f1f8e9":"#fff"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:i===0?600:400}}>{h.label}</div>
                        <div style={{fontSize:11,color:"#999"}}>{new Date(h.ts).toLocaleString("fr-FR")}</div>
                      </div>
                      {i===0&&<button onClick={undoLast} style={{padding:"4px 12px",borderRadius:6,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:12}}>↩ Annuler</button>}
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

        {/* ══ ÉQUITÉ ══ */}
        {tab==="equite"&&(
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:14}}>Équité — S{startWeek} à S{startWeek+numWeeks-1} ({year})</div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0"}}>
                    <th style={{padding:"10px 14px",textAlign:"left"}}>Opérateur</th>
                    <th style={{padding:"10px 14px",textAlign:"left"}}>Niv.</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#1B5E20"}}>Matin</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#F57F17"}}>AM</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#0D47A1"}}>Nuit</th>
                    <th style={{padding:"10px 14px",textAlign:"center"}}>Total</th>
                    <th style={{padding:"10px 14px",textAlign:"center"}}>Équilibre</th>
                  </tr>
                </thead>
                <tbody>
                  {equity.map((op,i)=>{
                    const imb=imbalance(op);
                    return(
                      <tr key={op.id} style={{borderBottom:"1px solid #f0f0f0",background:imb?"#fff8e1":i%2===0?"#fff":"#fafafa"}}>
                        <td style={{padding:"10px 14px",fontWeight:500}}>{op.full}</td>
                        <td style={{padding:"10px 14px"}}><LevelBadge level={op.level}/></td>
                        {[
                          {k:"matin",bg:"#D6EFD8",tc:"#1B5E20"},
                          {k:"am",   bg:"#FFF9C4",tc:"#F57F17"},
                          {k:"nuit", bg:"#BBDEFB",tc:"#0D47A1"},
                        ].map(sh=>(
                          <td key={sh.k} style={{padding:"8px 14px",textAlign:"center"}}>
                            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                              <div style={{width:Math.round((op[sh.k]/Math.max(numWeeks,1))*60),height:8,background:sh.bg,borderRadius:4,minWidth:2}}/>
                              <span style={{color:sh.tc,fontWeight:600}}>{op[sh.k]}</span>
                            </div>
                          </td>
                        ))}
                        <td style={{padding:"8px 14px",textAlign:"center"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                            <div style={{width:Math.round((op.total/maxEquity)*60),height:8,background:"#ccc",borderRadius:4,minWidth:2}}/>
                            <span style={{fontWeight:600}}>{op.total}</span>
                          </div>
                        </td>
                        <td style={{padding:"8px 14px",textAlign:"center"}}>
                          {imb
                            ?<span style={{background:"#fff3e0",color:"#e65100",borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:600}}>⚠ Déséquilibre</span>
                            :<span style={{background:"#e8f5e9",color:"#2e7d32",borderRadius:4,padding:"2px 8px",fontSize:11}}>✓ OK</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══ ÉQUIPE ══ */}
        {tab==="equipe"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontWeight:600,fontSize:15}}>Équipe ({operators.length} opérateurs, {activeOps.length} actifs)</div>
              <button onClick={()=>setShowAddOp(!showAddOp)} style={{padding:"6px 14px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13}}>+ Ajouter</button>
            </div>
            <div style={{background:"#e8f5e9",border:"1px solid #a5d6a7",borderRadius:7,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#2e7d32"}}>
              ℹ️ L'algorithme intègre automatiquement tout opérateur actif. Les N4 ajoutés manuellement participent au cycle de nuit dès leur activation.
            </div>
            {activeOps.length<8&&(
              <div style={{background:"#fff8e1",border:"1px solid #ffe082",borderRadius:7,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#f57f17"}}>
                ⚠️ Moins de 8 opérateurs actifs : certains postes peuvent être sous-effectif. Les alertes sont visibles dans l'onglet Planning.
              </div>
            )}
            {showAddOp&&(
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
                <div key={op.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderBottom:i<operators.length-1?"1px solid #f0f0f0":"none",opacity:op.active?1:.5}}>
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
