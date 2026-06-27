import React, { useState, useEffect, useCallback, useRef } from "react";

// ── TOKENS D'ACCÈS ───────────────────────────────────────────────────────────
// Le token admin n'apparaît plus en clair dans le code : seul son empreinte
// SHA-256 est embarquée. L'URL reste ?admin=neolitik-admin-2026 — le token
// saisi est haché côté navigateur et comparé à l'empreinte.
// (Limite connue : la clé anon Supabase reste exposée ; une vraie protection
// des données nécessiterait des règles RLS côté Supabase.)
const ADMIN_HASH   = "015281d6d5f769ed0f86baaa647ba18f5998a9ccca059f8e925fc011a99318b6";
const PUBLIC_TOKEN = "equipe-neolitik";        // URL public : ?view=planning&token=equipe-neolitik

const params = new URLSearchParams(window.location.search);
const IS_PUBLIC = params.get("view") === "planning" && params.get("token") === PUBLIC_TOKEN;

async function sha256Hex(str){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}


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

// ── PARAMÈTRES PAIE (calcul des heures) ──────────────────────────────────────
// Réglages validés avec le dirigeant. À ajuster ici si la convention change.
const PAID_HOURS_PER_SHIFT = 7;      // heures payées par poste (pause déduite)
const NIGHT_WINDOW = [22, 6];        // heures de nuit : 22h → 6h
const WEEKLY_BASE  = 35;             // seuil hebdomadaire des heures supplémentaires
// Présence réelle de chaque poste (heures décimales, horloge continue : 6h = 30)
const SHIFT_PRESENCE = {
  matin: [5+50/60, 14],
  am:    [13+50/60, 22],
  nuit:  [21+50/60, 24+6],
};
const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// Chevauchement (en heures) de l'intervalle [a,b] avec [lo,hi]
function overlapHours(a,b,lo,hi){ return Math.max(0, Math.min(b,hi)-Math.max(a,lo)); }
// Heures de nuit payées d'un poste = présence ∩ plage de nuit, plafonnée aux heures payées.
function nightHoursForShift(key){
  const p=SHIFT_PRESENCE[key]; if(!p) return 0;
  const [s,e]=p, [ns,ne]=NIGHT_WINDOW;
  // La plage de nuit traverse minuit : on la couvre en [ns, ne+24] et [ns-24, ne].
  const night = overlapHours(s,e,ns,ne+24) + overlapHours(s,e,ns-24,ne);
  return Math.min(night, PAID_HOURS_PER_SHIFT);
}
const NIGHT_HOURS = { matin:nightHoursForShift("matin"), am:nightHoursForShift("am"), nuit:nightHoursForShift("nuit") };
// Jours d'un mois calendaire — gère février et années bissextiles via l'objet Date.
function daysInMonth(year, month /*0-11*/){ return new Date(year, month+1, 0).getDate(); }
// Heures décimales → "Hh MM" (ex. 7 → "7h00", 0,1667 → "0h10", 35,5 → "35h30")
function fmtHours(h){ const m=Math.round(h*60); return `${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}`; }

// ── JOURS À HORAIRES AMÉNAGÉS ────────────────────────────────────────────────
// Ce jour-là, les 3 équipes décalent leurs horaires pour se chevaucher.
// Affectations + total payé (7h) inchangés ; seules les heures de NUIT sont
// recalculées d'après les horaires saisis. Stocké : { matin:{s,e}, am, nuit, commun }.
const AMENAGE_DEFAULT = { matin:{s:"05:50",e:"14:00"}, am:{s:"13:50",e:"22:00"}, nuit:{s:"21:50",e:"06:00"}, commun:"" };
function hhmmToDec(str){ const [h,m]=String(str||"0:0").split(":").map(Number); return (h||0)+(m||0)/60; }
function nightHoursForWindow(sStr,eStr){
  let s=hhmmToDec(sStr), e=hhmmToDec(eStr);
  if(e<=s) e+=24; // créneau qui traverse minuit
  const [ns,ne]=NIGHT_WINDOW;
  return Math.min(overlapHours(s,e,ns,ne+24)+overlapHours(s,e,ns-24,ne), PAID_HOURS_PER_SHIFT);
}
function fmtClock(str){ const [h,m]=String(str||"0:0").split(":").map(Number); return `${h}h${m?String(m).padStart(2,"0"):""}`; }
// Résumé des horaires aménagés affiché dans l'en-tête d'un jour (admin + public)
function AmenageSummary({entry}){
  if(entry && typeof entry==="object"){
    return (
      <span style={{display:"block",fontSize:9,fontWeight:400,color:"#4527A0",lineHeight:1.5}}>
        M {fmtClock(entry.matin.s)}–{fmtClock(entry.matin.e)}<br/>
        AM {fmtClock(entry.am.s)}–{fmtClock(entry.am.e)}<br/>
        N {fmtClock(entry.nuit.s)}–{fmtClock(entry.nuit.e)}
        {entry.commun?<span style={{display:"block",color:"#7E57C2",fontWeight:600}}>↔ {entry.commun}</span>:null}
      </span>
    );
  }
  if(typeof entry==="string" && entry) return <span style={{display:"block",fontSize:9,fontWeight:400,color:"#7E57C2"}}>↔ {entry}</span>;
  return null;
}

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
// Contraintes souples : éviter 2 Matin ou 2 AM consécutifs (priorité absolue + swap AM/Matin)
// Rotation Nuit → AM → Matin
// archive : semaines écoulées figées (réalité travaillée) — priorité absolue,
// jamais recalculées même si l'effectif change ensuite (fiabilité paie/suivi).
// fromWeek/toWeek par opérateur : fenêtre de présence (arrivées/départs en cours d'année).
// L'équité est proportionnelle aux semaines de présence : un nouvel arrivant
// n'est pas surchargé pour "rattraper" les compteurs des anciens.
function buildSchedules(operators, startWeek, numWeeks, absences, leaves, overrides, archive={}) {
  const active    = operators.filter(o=>o.active);
  // Les volants (N4 ajoutés manuellement) sont exclus du calcul automatique
  // Ils apparaissent uniquement via glissement manuel (réserve)
  const activeN4  = active.filter(o=>o.level==="N4" && !o.isVolant);
  const activeNon4= active.filter(o=>o.level!=="N4" && !o.isVolant);

  const nightCount= Object.fromEntries(active.map(o=>[o.short,0]));
  const matCount  = Object.fromEntries(active.map(o=>[o.short,0]));
  const amCount   = Object.fromEntries(active.map(o=>[o.short,0]));
  const presentCount = Object.fromEntries(active.map(o=>[o.short,0]));

  const inWindow = (o,s)=>(!o.fromWeek||s>=o.fromWeek)&&(!o.toWeek||s<=o.toWeek);

  let prevNuit  = [];
  let prevMatin = [];
  let prevAm    = [];
  const schedules = [];

  for(let i=0;i<numWeeks;i++){
    const s = startWeek+i;

    active.forEach(o=>{ if(inWindow(o,s)) presentCount[o.short]++; });

    // Semaine archivée (écoulée) : la réalité travaillée prime sur tout
    if(archive[s]){
      const ar = archive[s];
      const arMatin=ar.matin||[], arAm=ar.am||[], arNuit=ar.nuit||[];
      schedules.push({s, matin:arMatin, am:arAm, nuit:arNuit, alerts:[], isOverridden:false, isArchived:true});
      arMatin.forEach(o=>{if(matCount[o]!==undefined)matCount[o]++;});
      arAm.forEach(o=>{if(amCount[o]!==undefined)amCount[o]++;});
      arNuit.forEach(o=>{if(nightCount[o]!==undefined)nightCount[o]++;});
      prevNuit  = arNuit;
      prevMatin = arMatin;
      prevAm    = arAm;
      continue;
    }

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
      // Validation des contraintes sur l'override (violations silencieuses)
      const ovAlerts = [];
      if(!ovNuit.some(n=>operators.find(o=>o.short===n&&o.level==="N4")))
        ovAlerts.push(`⛔ S${s} : override — aucun N4 en nuit`);
      if(!ovAm.some(n=>operators.find(o=>o.short===n&&o.level==="N4")))
        ovAlerts.push(`⛔ S${s} : override — aucun N4 en AM`);
      if(!ovMatin.some(n=>operators.find(o=>o.short===n&&o.level==="N4")))
        ovAlerts.push(`⛔ S${s} : override — aucun N4 en Matin`);
      if(ovNuit.length!==3)
        ovAlerts.push(`⛔ S${s} : override — nuit ${ovNuit.length}/3`);
      const consNuit=ovNuit.filter(n=>prevNuit.includes(n));
      if(consNuit.length>0)
        ovAlerts.push(`⚠ S${s} : override — nuit consécutive : ${consNuit.join(", ")}`);
      schedules.push({s, matin:ovMatin, am:ovAm, nuit:ovNuit, alerts:ovAlerts, isOverridden:true});
      ovMatin.forEach(o=>{if(matCount[o]!==undefined)matCount[o]++;});
      ovAm.forEach(o=>{if(amCount[o]!==undefined)amCount[o]++;});
      ovNuit.forEach(o=>{if(nightCount[o]!==undefined)nightCount[o]++;});
      prevNuit  = ovNuit;
      prevMatin = ovMatin;
      prevAm    = ovAm;
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
    // Disponibles : présents cette semaine, pas en nuit S-1, pas absents
    const availN4nuit  = activeN4.filter(o=>inWindow(o,s)&&!prevNuit.includes(o.short)&&!absWeekFull.includes(o.short));
    const availNon4nuit= activeNon4.filter(o=>inWindow(o,s)&&!prevNuit.includes(o.short)&&!absWeekFull.includes(o.short));

    // Équité proportionnelle : taux = compteur / semaines de présence
    const rate = (cnt,o)=> cnt[o.short]/Math.max(presentCount[o.short],1);

    // Tri : taux de nuits le plus bas d'abord, départage : plus d'AM (rééquilibrage)
    const sortNuit = (a,b)=> rate(nightCount,a)!==rate(nightCount,b)
      ? rate(nightCount,a)-rate(nightCount,b)
      : rate(amCount,b)-rate(amCount,a);

    availN4nuit.sort(sortNuit);
    availNon4nuit.sort(sortNuit);

    let n4Nuit = availN4nuit[0];

    // Fallback si aucun N4 dispo pour la nuit : prendre le moins chargé même s'il était en nuit
    if(!n4Nuit){
      alerts.push(`⛔ S${s} : aucun N4 disponible en nuit — contrainte non satisfaite, glissement manuel requis`);
      const fallback = activeN4.filter(o=>inWindow(o,s)&&!absWeekFull.includes(o.short));
      fallback.sort(sortNuit);
      n4Nuit = fallback[0];
    }

    const non4Nuit = availNon4nuit.slice(0,2);
    if(non4Nuit.length<2)
      alerts.push(`⛔ S${s} : effectif nuit insuffisant (${non4Nuit.length+1}/3) — glissement manuel requis`);

    const nuit = [n4Nuit?.short,...non4Nuit.map(o=>o.short)].filter(Boolean);

    // ── MATIN & AM ──
    const restN4   = activeN4.filter(o=>inWindow(o,s)&&!nuit.includes(o.short)&&!absWeekFull.includes(o.short));
    const restNon4 = activeNon4.filter(o=>inWindow(o,s)&&!nuit.includes(o.short)&&!absWeekFull.includes(o.short));

    // Tri : 1) anti-consécutif (priorité absolue), 2) équité proportionnelle, 3) départage nuits
    const sortMat = (a,b)=>{
      const ac=prevMatin.includes(a.short)?1:0, bc=prevMatin.includes(b.short)?1:0;
      if(ac!==bc) return ac-bc; // jamais deux Matins de suite si on peut l'éviter
      if(rate(matCount,a)!==rate(matCount,b)) return rate(matCount,a)-rate(matCount,b);
      return rate(nightCount,b)-rate(nightCount,a);
    };
    const sortAm = (a,b)=>{
      const ac=prevAm.includes(a.short)?1:0, bc=prevAm.includes(b.short)?1:0;
      if(ac!==bc) return ac-bc; // jamais deux AM de suite si on peut l'éviter
      if(rate(amCount,a)!==rate(amCount,b)) return rate(amCount,a)-rate(amCount,b);
      return rate(nightCount,b)-rate(nightCount,a);
    };

    // N4 pour AM (premier tri par équité + anti-consécutif)
    const restN4ForAm = [...restN4].sort(sortAm);
    let n4Am = restN4ForAm[0];

    // N4 pour Matin (parmi les restants après AM)
    let n4Matin = restN4.filter(o=>o.short!==n4Am?.short).sort(sortMat)[0];

    // ── Optimisation d'assignation AM/Matin ──────────────────────────────────
    // Problème : avec 3 N4, la sélection séquentielle (AM d'abord) peut laisser
    // systématiquement le même N4 en Matin par élimination.
    // Solution : après sélection initiale, tester si échanger AM/Matin réduit
    // le nombre d'enchaînements consécutifs (score plus bas = meilleur).
    if(n4Am && n4Matin) {
      const scoreCur = (prevAm.includes(n4Am.short)?10:0) + (prevMatin.includes(n4Matin.short)?10:0);
      const scoreSwp = (prevAm.includes(n4Matin.short)?10:0) + (prevMatin.includes(n4Am.short)?10:0);
      if(scoreSwp < scoreCur){ const t=n4Am; n4Am=n4Matin; n4Matin=t; }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Non-N4 pour AM : distribués équitablement entre AM et Matin
    // Avec 5 non-N4 restants=3 → AM:1 Matin:2 ; avec 6 non-N4 restants=4 → AM:2 Matin:2
    const restNon4ForAm = [...restNon4].sort(sortAm);
    const amNon4Count = Math.max(1, Math.floor(restNon4.length / 2));
    const non4AmList = restNon4ForAm.slice(0, amNon4Count);

    const am = [n4Am?.short, ...non4AmList.map(o=>o.short)].filter(Boolean);
    const non4Matin = restNon4
      .filter(o=>!non4AmList.some(a=>a.short===o.short))
      .sort(sortMat);

    const matin = [n4Matin?.short, ...non4Matin.map(o=>o.short)].filter(Boolean);

    if(!n4Matin) alerts.push(`⛔ S${s} : aucun N4 disponible en matin — glissement manuel requis`);
    if(!n4Am)    alerts.push(`⛔ S${s} : aucun N4 disponible en AM — glissement manuel requis`);
    if(matin.length<3) alerts.push(`⚠ S${s} : matin ${matin.length}/3`);
    if(am.length<2)    alerts.push(`⚠ S${s} : AM ${am.length}/2`);

    // Absences partielles : informatif
    absWeekPartial.forEach(e=>{
      const[short,,day]=e.split("|");
      alerts.push(`ℹ S${s} : ${short} absent le ${day}`);
    });

    // Congés partiels : informatif (non traités par l'algo mais signalés)
    (leaves[s]||[]).filter(e=>e.includes(":")).forEach(e=>{
      const[short,range]=e.split(":");
      const[sd,ed]=range.split("-").map(Number);
      alerts.push(`ℹ S${s} : ${short} en congé ${DAYS_FR[sd]}–${DAYS_FR[ed]}`);
    });

    schedules.push({s, matin, am, nuit, alerts, isOverridden:false});

    matin.forEach(o=>{if(matCount[o]!==undefined)matCount[o]++;});
    am.forEach(o=>{if(amCount[o]!==undefined)amCount[o]++;});
    nuit.forEach(o=>{if(nightCount[o]!==undefined)nightCount[o]++;});
    prevNuit  = nuit;
    prevMatin = matin;
    prevAm    = am;
  }
  return {schedules, nightCount, matCount, amCount, presentCount};
}

// ── COMPOSANTS ────────────────────────────────────────────────────────────────
function LevelBadge({level}){
  const s=LEVEL_BADGE[level]||LEVEL_BADGE.N1;
  return <span style={{background:s.bg,color:s.color,borderRadius:4,padding:"1px 7px",fontSize:11,fontWeight:500}}>{level}</span>;
}

function OpChip({name,operators,draggable,onDragStart,onDropChip,highlight}){
  const op=operators.find(o=>o.short===name||o.full===name);
  const s=LEVEL_BADGE[op?.level||"N1"];
  // onDropChip : déposer un opérateur SUR un autre = échange direct de leurs postes
  return(
    <span draggable={draggable} onDragStart={onDragStart}
      onDragOver={onDropChip?e=>{e.preventDefault();e.stopPropagation();}:undefined}
      onDrop={onDropChip?e=>{e.stopPropagation();onDropChip();}:undefined}
      title={op?.full||name}
      style={{display:"inline-flex",alignItems:"center",gap:3,
        background:highlight?"#FFF176":s.bg, color:s.color,
        borderRadius:4,padding:"2px 7px",fontSize:12,margin:"2px",fontWeight:500,
        cursor:draggable?"grab":"default",
        outline:highlight?"2px solid #F9A825":"none"}}>
      {name}
    </span>
  );
}

// Jours fériés français (fixes + calcul Pâques pour mobiles)
function getEaster(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100;
  const d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25);
  const g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7;
  const m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31);
  const day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day);
}
function getFeries(year) {
  const easter=getEaster(year);
  const add=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
  const fmt=d=>`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
  return [
    `01/01`,`01/05`,`08/05`,`14/07`,`15/08`,`01/11`,`11/11`,`25/12`,
    fmt(add(easter,1)),   // Lundi de Pâques
    fmt(add(easter,39)),  // Ascension
    fmt(add(easter,50)),  // Lundi de Pentecôte
  ];
}

// ── VUE PUBLIQUE (lecture seule) ─────────────────────────────────────────────
function PublicView() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(()=>{
    (async()=>{
      try {
        const snapshot = await sbGet("published_planning");
        if(!snapshot) { setError("Aucun planning publié pour le moment."); return; }
        setData(snapshot);
      } catch(e) {
        setError("Erreur de chargement.");
      } finally {
        setLoading(false);
      }
    })();
  },[]);

  if(loading) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:"'DM Sans',sans-serif",color:"#666"}}>
      Chargement du planning…
    </div>
  );
  if(error) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontFamily:"'DM Sans',sans-serif",color:"#c62828"}}>
      {error}
    </div>
  );

  const {schedules, operators, satWeeks, satEndPostes, joursChomes, joursAmenages, notes, publishedAt, year, publishView} = data;
  const SMETA = [
    {key:"matin",label:"🌅 Matin 5h50–14h", hbg:"#D6EFD8",tc:"#1B5E20"},
    {key:"am",   label:"🌆 AM 13h50–22h",   hbg:"#FFF9C4",tc:"#F57F17"},
    {key:"nuit", label:"🌙 Nuit 21h50–6h",  hbg:"#BBDEFB",tc:"#0D47A1"},
  ];

  return(
    <div style={{fontFamily:"'DM Sans','Outfit',sans-serif",background:"#f7f8fa",minHeight:"100vh"}}>
      {/* Header */}
      <div style={{background:BRAND,color:"#fff",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
        <span style={{fontWeight:700,fontSize:18,letterSpacing:1.5}}>NEOLITIK</span>
        <span style={{fontSize:12,opacity:.7}}>Planning 3×8 — lecture seule</span>
      </div>

      <div style={{padding:"20px 16px 60px",maxWidth:1100,margin:"0 auto"}}>
        {/* Info publication */}
        {publishedAt&&(
          <div style={{fontSize:12,color:"#888",marginBottom:16,textAlign:"right"}}>
            Publié le {new Date(publishedAt).toLocaleString("fr-FR")}
          </div>
        )}

        {/* Vue Colonnes */}
        {(publishView||"colonnes")==="colonnes"&&(
          <div style={{display:"flex",gap:12,overflowX:"auto",paddingBottom:8}}>
            {schedules.map(sc=>{
              const hasSat=(satWeeks||[]).includes(sc.s);
              const note=(notes||{})[sc.s];
              const m=getMondayOfWeek(sc.s,year||2026);
              const end=new Date(m); end.setDate(m.getDate()+(hasSat?5:4));
              return(
                <div key={sc.s} style={{minWidth:200,flex:"0 0 200px",background:"#fff",border:"1px solid #e0e0e0",borderRadius:10,overflow:"hidden"}}>
                  <div style={{background:BRAND,color:"#fff",padding:"10px 14px"}}>
                    <div style={{fontWeight:700,fontSize:15,display:"flex",alignItems:"center",gap:6}}>
                      S{sc.s}
                      {hasSat&&<span style={{background:"#c62828",borderRadius:3,padding:"1px 6px",fontSize:10}}>🔴 Sam.</span>}
                    </div>
                    <div style={{fontSize:11,opacity:.8}}>{fmtDate(m)} – {fmtDate(end)}</div>
                    {note&&<div style={{marginTop:4,fontSize:11,background:"rgba(255,255,255,.15)",borderRadius:4,padding:"2px 6px"}}>{note}</div>}
                  </div>
                  {SMETA.map(sh=>{
                    const ops_in=sc[sh.key]||[];
                    return(
                      <div key={sh.key} style={{background:sh.hbg,padding:"8px 10px",borderBottom:"1px solid rgba(0,0,0,.06)"}}>
                        <div style={{fontSize:10,fontWeight:600,color:sh.tc,marginBottom:5,textTransform:"uppercase",letterSpacing:.5}}>{sh.label}</div>
                        <div style={{display:"flex",flexDirection:"column",gap:3}}>
                          {ops_in.map(short=>{
                            const op=(operators||[]).find(o=>o.short===short);
                            return <span key={short} style={{fontSize:12,fontWeight:500}}>{op?.full||short}</span>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Vue Jours */}
        {publishView==="jours"&&schedules.map(sc=>{
          const hasSat=(satWeeks||[]).includes(sc.s);
          const weekSatEnd=(satEndPostes||{})[sc.s]||"N";
          const satEndIdx={M:0,AM:1,N:2}[weekSatEnd];
          const shiftIdx={matin:0,am:1,nuit:2};
          const m=getMondayOfWeek(sc.s,year||2026);
          const numDays=hasSat?6:5;
          const feriesDates=getFeries(year||2026);
          const days=Array.from({length:numDays},(_,d)=>{
            const date=new Date(m); date.setDate(m.getDate()+d);
            const dateStr=`${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}`;
            const isChome=!!((joursChomes||{})[`${sc.s}-${dateStr}`]);
            const isAmenage=(joursAmenages||{})[`${sc.s}-${dateStr}`]!==undefined;
            return{d,dateStr,isFerie:feriesDates.includes(dateStr),isSat:d===5,isChome,isAmenage,amenage:(joursAmenages||{})[`${sc.s}-${dateStr}`]};
          });
          const note=(notes||{})[sc.s];
          const end=new Date(m); end.setDate(m.getDate()+(numDays-1));
          return(
            <div key={sc.s} style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",marginBottom:14,overflow:"hidden"}}>
              <div style={{background:BRAND,color:"#fff",padding:"8px 14px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,fontSize:14}}>S{sc.s}</span>
                <span style={{fontSize:12,opacity:.8}}>{fmtDate(m)} – {fmtDate(end)}</span>
                {hasSat&&<span style={{fontSize:11,background:"rgba(255,255,255,.2)",borderRadius:3,padding:"1px 6px"}}>Sam. ↳ {weekSatEnd==="M"?"Matin":weekSatEnd==="AM"?"AM":"Nuit"}</span>}
                {note&&<span style={{fontSize:11,opacity:.8,marginLeft:"auto"}}>{note}</span>}
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid #f0f0f0",background:"#fafafa"}}>
                      <th style={{padding:"6px 10px",textAlign:"left",fontWeight:500,fontSize:11,color:"#666",minWidth:150}}>Opérateur</th>
                      {days.map(({d,dateStr,isFerie,isSat,isChome,isAmenage,amenage})=>(
                        <th key={d} style={{padding:"6px 8px",textAlign:"center",fontWeight:500,fontSize:11,
                          color:isChome?"#aaa":isSat?"#e65100":"#666",minWidth:70,
                          background:isAmenage&&!isChome?"#EDE7F6":"transparent",
                          opacity:isChome?0.5:1}}>
                          {["Lun","Mar","Mer","Jeu","Ven","Sam"][d]}
                          <span style={{display:"block",fontSize:10,fontWeight:400}}>
                            {dateStr}
                            {isFerie&&<span style={{fontSize:9,color:"#888",marginLeft:2}}>Férié</span>}
                          </span>
                          {isChome&&<span style={{display:"block",fontSize:9,color:"#888",fontWeight:400}}>Chômé</span>}
                          {isAmenage&&!isChome&&<span style={{display:"block",fontSize:9,color:"#4527A0",fontWeight:600}}>⇄ Aménagé</span>}
                          {isAmenage&&!isChome&&<AmenageSummary entry={amenage}/>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {key:"matin",label:"🌅 Matin",bg:"#D6EFD8",tc:"#1B5E20"},
                      {key:"am",   label:"🌆 AM",   bg:"#FFF9C4",tc:"#F57F17"},
                      {key:"nuit", label:"🌙 Nuit",  bg:"#BBDEFB",tc:"#0D47A1"},
                    ].map(({key,label,bg,tc})=>{
                      const opsIn=sc[key]||[];
                      if(!opsIn.length)return null;
                      return(
                        <React.Fragment key={key}>
                          <tr><td colSpan={numDays+1} style={{padding:"3px 10px",background:bg,fontSize:10,fontWeight:600,color:tc}}>{label}</td></tr>
                          {opsIn.map(short=>{
                            const op=(operators||[]).find(o=>o.short===short);
                            return(
                              <tr key={short} style={{borderBottom:"0.5px solid #f5f5f5"}}>
                                <td style={{padding:"5px 10px",fontWeight:500}}>{op?.full||short}</td>
                                {days.map(({d,isSat,isChome})=>{
                                  const isOff=isSat&&shiftIdx[key]>satEndIdx;
                                  return(
                                    <td key={d} style={{padding:"4px 6px",textAlign:"center",background:isChome?"#f9f9f9":isSat?"#fffdf5":"transparent"}}>
                                      <span style={{background:isOff||isChome?"#f5f5f5":bg,color:isOff||isChome?"#bbb":tc,borderRadius:3,padding:"2px 6px",fontSize:11,fontWeight:500}}>
                                        {isOff||isChome?"—":key==="matin"?"M":key==="am"?"AM":"N"}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                    {/* Volants en journée */}
                    {(operators||[]).filter(o=>o.isVolant&&o.active).map(op=>{
                      const inPlanning=[...(sc.matin||[]),...(sc.am||[]),...(sc.nuit||[])].includes(op.short);
                      if(inPlanning)return null;
                      return(
                        <React.Fragment key={op.short}>
                          <tr><td colSpan={numDays+1} style={{padding:"3px 10px",background:"#EDE7F6",fontSize:10,fontWeight:600,color:"#4527A0"}}>☀️ Journée</td></tr>
                          <tr style={{borderBottom:"0.5px solid #f5f5f5"}}>
                            <td style={{padding:"5px 10px",fontWeight:500}}>{op.full}</td>
                            {days.map(({d,isChome})=>(
                              <td key={d} style={{padding:"4px 6px",textAlign:"center",background:isChome?"#f9f9f9":"transparent"}}>
                                <span style={{background:isChome?"#f5f5f5":"#EDE7F6",color:isChome?"#bbb":"#4527A0",borderRadius:3,padding:"2px 6px",fontSize:11,fontWeight:500}}>
                                  {isChome?"—":"J"}
                                </span>
                              </td>
                            ))}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

      </div>
    </div>
  );
}

// ── GARDE D'ACCÈS ─────────────────────────────────────────────────────────────
// Vérifie le token admin par empreinte SHA-256 (asynchrone), puis rend AdminApp.
export default function App(){
  const [adminOk,setAdminOk] = useState(null); // null = vérification en cours
  useEffect(()=>{
    (async()=>{
      const t = params.get("admin");
      if(!t){ setAdminOk(false); return; }
      try{ setAdminOk(await sha256Hex(t)===ADMIN_HASH); }
      catch{ setAdminOk(false); } // crypto.subtle absent (http non sécurisé)
    })();
  },[]);

  // Mode lecture seule
  if(IS_PUBLIC) return <PublicView/>;

  if(adminOk===null) return(
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f7f8fa",color:"#888",fontSize:13}}>
      Vérification de l'accès…
    </div>
  );

  // Accès sans token admin valide → page de garde
  if(!adminOk){
    return(
      <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f7f8fa"}}>
        <div style={{textAlign:"center",color:"#555"}}>
          <div style={{fontWeight:700,fontSize:18,color:"#1a1a2e",marginBottom:8}}>NEOLITIK</div>
          <div style={{fontSize:13}}>Accès non autorisé.</div>
        </div>
      </div>
    );
  }

  return <AdminApp/>;
}

// ── APP PRINCIPALE (admin) ────────────────────────────────────────────────────
function AdminApp(){
  const [tab,setTab]             = useState("planning");
  const [operators,setOperators] = useState(DEFAULT_OPERATORS);
  const [absences,setAbsences]   = useState({});
  const [leaves,setLeaves]       = useState({});
  const [overrides,setOverrides] = useState({}); // { semaine: {matin,am,nuit} }
  const [archive,setArchive]     = useState({}); // { annee: { semaine: {matin,am,nuit} } } — semaines écoulées figées (paie/suivi)
  const [satWeeks,setSatWeeks]       = useState([]);
  const [satEndPostes,setSatEndPostes] = useState({}); // { [semaine]: "M"|"AM"|"N" }
  const [joursChomes,setJoursChomes]   = useState({}); // { "semaine-dateStr": true } jour chômé = toute l'équipe absente
  const [joursAmenages,setJoursAmenages] = useState({}); // { "semaine-dateStr": "créneau" } horaires aménagés (postes décalés/chevauchement) — info, heures inchangées
  const [notes,setNotes]             = useState({});
  const [year,setYear]           = useState(2026);
  const [hoursMonth,setHoursMonth] = useState(()=>new Date().getMonth());   // 0-11, récap d'heures
  const [hoursYear,setHoursYear]   = useState(()=>new Date().getFullYear());
  const [history,setHistory]     = useState([]);
  const [redoStack,setRedoStack] = useState([]); // états rétablissables (annulés)
  const [startWeek,setStartWeek] = useState(()=>getCurrentWeek(new Date().getFullYear()));
  const [numWeeks,setNumWeeks]   = useState(5);
  const [view,setView]           = useState("liste");
  const [publishView,setPublishView] = useState("colonnes"); // vue publiée : colonnes ou jours
  const [showFullNames,setShowFullNames] = useState(false);
  const [highlightOp,setHighlightOp]     = useState(null);
  const [absOp,setAbsOp]   = useState(""); const [absWeek,setAbsWeek]   = useState(()=>getCurrentWeek(new Date().getFullYear())); const [absDay,setAbsDay]   = useState(0);
  const [leaveOp,setLeaveOp]     = useState("");
  const [leaveFrom,setLeaveFrom] = useState(()=>getCurrentWeek(new Date().getFullYear())); const [leaveTo,setLeaveTo]     = useState(()=>getCurrentWeek(new Date().getFullYear()));
  const [leaveFromDay,setLeaveFromDay] = useState(1); const [leaveToDay,setLeaveToDay]   = useState(5);
  const [showAddOp,setShowAddOp] = useState(false);
  const [newOp,setNewOp]         = useState({prenom:"",nom:"",level:"N1"});
  const [syncMsg,setSyncMsg]     = useState("Chargement...");
  const [flashMsg,setFlashMsg]   = useState(null);
  const [schedules,setSchedules] = useState([]);
  const [allSchedules,setAllSchedules] = useState([]); // S1 → fin de fenêtre (archivage + export paie)
  const [equity,setEquity]       = useState([]);
  const [loaded,setLoaded]       = useState(false);
  const [publishModal,setPublishModal] = useState(false);
  const [publishNbWeeks,setPublishNbWeeks] = useState(3);
  const [amenageEdit,setAmenageEdit]   = useState(null); // { week, dateStr, dayLabel } | null
  const [amenageDraft,setAmenageDraft] = useState(null); // { matin:{s,e}, am, nuit, commun }
  const dragRef = useRef(null);

  const weeks = Array.from({length:numWeeks},(_,i)=>startWeek+i);
  const currentWeek = getCurrentWeek(year);
  // Archive de l'année affichée uniquement — les semaines de 2026 ne doivent
  // jamais s'appliquer au planning 2027 (les numéros de semaine se répètent)
  const yearArchive = archive[year]||{};
  const flash = (msg,color="#2e7d32")=>{setFlashMsg({msg,color});setTimeout(()=>setFlashMsg(null),2500);};
  const activeOps = operators.filter(o=>o.active);

  // ── CHARGEMENT SUPABASE
  useEffect(()=>{
    (async()=>{
      try{
        setSyncMsg("Connexion...");
        const [ops,abs,lv,ov,ar,sw,sep,jc,ja,nt,hi,rs,yr]=await Promise.all([
          sbGetOps(),sbGet("absences"),sbGet("leaves"),sbGet("overrides"),sbGet("archive"),
          sbGet("satweeks"),sbGet("satendpostes"),sbGet("jourschomes"),sbGet("joursamenages"),sbGet("notes"),sbGet("history"),sbGet("redostack"),sbGet("year"),
        ]);
        if(ops&&ops.length>0)setOperators(ops);
        if(abs)setAbsences(abs); if(lv)setLeaves(lv); if(ov)setOverrides(ov); if(ar)setArchive(ar);
        if(sw)setSatWeeks(sw); if(sep)setSatEndPostes(sep); if(jc)setJoursChomes(jc); if(ja)setJoursAmenages(ja);
        if(nt)setNotes(nt); if(hi)setHistory(hi); if(rs)setRedoStack(rs);
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

  const saveOperators   = useCallback(v=>{setOperators(v);sbSetOps(v).then(()=>setSyncMsg("Synchronisé ✓")).catch(()=>setSyncMsg("Erreur sync"));},[]);
  const saveAbsences    = useCallback(v=>{setAbsences(v);    save("absences",v);},[save]);
  const saveLeaves      = useCallback(v=>{setLeaves(v);      save("leaves",v);},[save]);
  const saveOverrides   = useCallback(v=>{setOverrides(v);   save("overrides",v);},[save]);
  const saveArchive     = useCallback(v=>{setArchive(v);     save("archive",v);},[save]);
  const saveSatWeeks    = useCallback(v=>{setSatWeeks(v);    save("satweeks",v);},[save]);
  const saveSatEndPostes= useCallback(v=>{setSatEndPostes(v);save("satendpostes",v);},[save]);
  const saveJoursChomes = useCallback(v=>{setJoursChomes(v);save("jourschomes",v);},[save]);
  const saveJoursAmenages=useCallback(v=>{setJoursAmenages(v);save("joursamenages",v);},[save]);
  const saveNotes       = useCallback(v=>{setNotes(v);       save("notes",v);},[save]);
  const saveYear        = useCallback(v=>{setYear(v);        save("year",String(v));},[save]);

  const pushHistory = useCallback((label,state)=>{
    setHistory(prev=>{
      const next=[{label,ts:Date.now(),state},...prev].slice(0,15);
      sbSet("history",next); return next;
    });
    // Toute nouvelle action invalide la pile de rétablissement
    setRedoStack([]); sbSet("redostack",[]);
  },[]);

  // ── CALCUL PLANNING
  // Construit depuis S1 pour des compteurs d'équité précis sur l'année entière.
  // N'affiche que la fenêtre demandée (wks), mais l'équité est annuelle.
  const recompute = (ops,abs,lv,ov,arc,wks)=>{
    if(!wks.length) return;
    const displayEnd = wks[wks.length-1];
    const {schedules:allSc,nightCount,matCount,amCount,presentCount} = buildSchedules(ops,1,displayEnd,abs,lv,ov,arc);
    setAllSchedules(allSc);
    setSchedules(allSc.filter(s=>s.s>=wks[0]));
    const eq = ops.filter(o=>o.active).map(op=>({
      ...op,
      matin: matCount[op.short]||0,
      am:    amCount[op.short]||0,
      nuit:  nightCount[op.short]||0,
      present: presentCount[op.short]||0,
      total:(matCount[op.short]||0)+(amCount[op.short]||0)+(nightCount[op.short]||0),
    }));
    setEquity(eq);
  };

  // Recalcul automatique uniquement sur changements structurels
  // (opérateurs, absences, congés, archive, période) — PAS sur les overrides
  // Les overrides sont lus par buildSchedules mais ne déclenchent pas de recalcul
  useEffect(()=>{
    if(!loaded)return;
    recompute(operators,absences,leaves,overrides,yearArchive,weeks);
  },[loaded,startWeek,numWeeks,operators,absences,leaves,archive,year]);

  // ── ARCHIVAGE AUTOMATIQUE des semaines écoulées ──────────────────────────
  // Dès qu'une semaine passe (S < semaine courante), son planning est figé tel
  // qu'il était : les départs/arrivées d'opérateurs ou recalculs ultérieurs ne
  // réécrivent plus le passé. C'est la référence pour la paie et le suivi.
  useEffect(()=>{
    if(!loaded) return;
    if(year!==new Date().getFullYear()) return; // archive uniquement l'année en cours
    const toAdd={};
    allSchedules.forEach(sc=>{
      if(sc.s<currentWeek && !yearArchive[sc.s])
        toAdd[sc.s]={matin:sc.matin,am:sc.am,nuit:sc.nuit};
    });
    if(Object.keys(toAdd).length) saveArchive({...archive,[year]:{...yearArchive,...toAdd}});
  },[loaded,allSchedules]);

  // ── RECALCULER : efface les overrides à partir de startWeek, repart de l'algo.
  // Les overrides AVANT startWeek sont conservés comme base de contexte
  // (prevNuit, prevMatin, prevAm, compteurs d'équité).
  // Cas d'usage : modifier manuellement S23, sélectionner S24 comme départ,
  // cliquer Recalculer → l'algo se base sur la config manuelle de S23.
  const recalculate = ()=>{
    const affectedOvCount = Object.keys(overrides).filter(wk=>parseInt(wk)>=startWeek).length;
    if(affectedOvCount>0 && !window.confirm(
      `⚠ Recalculer va supprimer ${affectedOvCount} ajustement(s) manuel(s) à partir de S${startWeek}.\n\nLes overrides avant S${startWeek} sont conservés comme base.\nL'algorithme recalcule de S${startWeek} à S${startWeek+numWeeks-1}.\n\nContinuer ?`
    )) return;
    pushHistory("Recalcul planning",{overrides});
    // Garder les overrides AVANT startWeek (base de contexte)
    const cleanedOverrides = {};
    Object.entries(overrides).forEach(([wk, slots])=>{
      if(parseInt(wk) < startWeek) cleanedOverrides[wk] = slots;
    });
    saveOverrides(cleanedOverrides);
    recompute(operators, absences, leaves, cleanedOverrides, yearArchive, weeks);
    flash(`Planning recalculé à partir de S${startWeek} ✓`);
  };

  const allAlerts = schedules.flatMap(s=>s.alerts).filter(a=>!a.startsWith("ℹ"));
  const allInfos  = schedules.flatMap(s=>s.alerts).filter(a=>a.startsWith("ℹ"));

  // ── ABSENCES
  const addAbsence = ()=>{
    if(!absOp)return;
    pushHistory(`Absence: ${absOp} S${absWeek}`,{absences});
    const entry = absDay===0 ? absOp : `${absOp}|${absWeek}|${DAYS_FR[absDay]}`;
    // Semaine complète : remplace tout (complet + partiels redondants).
    // Jour précis : ne retire que le doublon exact — plusieurs jours partiels coexistent.
    const cur=(absences[absWeek]||[]).filter(e=>{
      if(absDay===0){ const sh=e.includes("|")?e.split("|")[0]:e; return sh!==absOp; }
      return e!==entry;
    });
    saveAbsences({...absences,[absWeek]:[...cur,entry]});
    // Saisie rétroactive autorisée : le planning écoulé est archivé (inchangé),
    // l'absence est enregistrée pour le suivi et la paie.
    if(isWeekLocked(absWeek))
      flash(`Absence enregistrée S${absWeek} (semaine écoulée — planning archivé inchangé)`,"#e65100");
    else
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
    if(leaveTo<leaveFrom){flash("Semaine de fin antérieure à la semaine de début","#c62828");return;}
    if(leaveFrom===leaveTo&&leaveToDay<leaveFromDay){flash("Jour de fin antérieur au jour de début","#c62828");return;}
    pushHistory(`Congé: ${leaveOp}`,{leaves});
    const next={...leaves};
    for(let w=leaveFrom;w<=leaveTo;w++){
      const sd=w===leaveFrom?leaveFromDay:1, ed=w===leaveTo?leaveToDay:5;
      const entry=(sd===1&&ed>=5)?leaveOp:`${leaveOp}:${sd}-${ed}`;
      // Si c'est un congé semaine complète, remplacer tout
      // Si c'est un congé partiel, ne remplacer qu'un congé complet existant
      // (les partiels coexistent pour couvrir des jours différents)
      if(sd===1&&ed>=5){
        // Semaine complète : supprime tout (complet + partiels)
        next[w]=[...(next[w]||[]).filter(e=>e!==leaveOp&&!e.startsWith(`${leaveOp}:`)),entry];
      } else {
        // Partiel : supprime un congé complet s'il existe, mais garde les autres partiels
        next[w]=[...(next[w]||[]).filter(e=>e!==leaveOp),entry];
      }
    }
    saveLeaves(next);
    // ── Alerte préventive : vérifier disponibilité N4 semaine par semaine
    const n4Warnings=[];
    const n4Base = operators.filter(o=>o.active&&o.level==="N4"&&!o.isVolant);
    for(let w=leaveFrom;w<=leaveTo;w++){
      const onFullLeave = n4Base.filter(o=>(next[w]||[]).some(e=>e===o.short)).map(o=>o.short);
      const onFullAbs   = (absences[w]||[]).filter(e=>!e.includes("|"));
      const unavail     = new Set([...onFullLeave,...onFullAbs]);
      const avail       = n4Base.filter(o=>!unavail.has(o.short));
      if(avail.length<3) n4Warnings.push(`S${w} : ${avail.length}/3 N4`);
    }
    if(n4Warnings.length>0)
      flash(`Congé enregistré — ⚠ Effectif N4 critique : ${n4Warnings.slice(0,3).join(" · ")}${n4Warnings.length>3?` +${n4Warnings.length-3}`:""}`, "#e65100");
    else
      flash(`Congé ajouté : ${leaveOp}`);
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
    if(isWeekLocked(week)){flash("Semaine écoulée — modification impossible","#c62828");dragRef.current=null;return;}

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
      recompute(operators,absences,leaves,newOvR,yearArchive,weeks);
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
    recompute(operators,absences,leaves,newOvG,yearArchive,weeks);
    flash(`${src.name} → ${targetShift} S${week}`);
    dragRef.current=null;
  };

  // ── ÉCHANGE EN UN CLIC : déposer un opérateur SUR un autre = swap des postes
  // Cas d'usage : arrangement ponctuel entre deux ouvriers ("je te prends ta
  // nuit, tu prends mon matin") sans faire deux glissements.
  const onSwap = (week,targetShift,targetName)=>{
    const src=dragRef.current;
    // Pas un échange (réserve, autre semaine, soi-même) → comportement glissement normal
    if(!src||src.shift==="reserve"||src.week!==week||src.name===targetName){ onDrop(week,targetShift); return; }
    if(src.shift===targetShift){ dragRef.current=null; return; } // même poste : rien à échanger
    if(isWeekLocked(week)){flash("Semaine écoulée — modification impossible","#c62828");dragRef.current=null;return;}
    const cur = schedules.find(s=>s.s===week);
    if(!cur){ dragRef.current=null; return; }
    const existing = overrides[week]||{matin:[...cur.matin],am:[...cur.am],nuit:[...cur.nuit]};
    pushHistory(`Échange: ${src.name} ↔ ${targetName} S${week}`,{overrides});
    const newOvS={...overrides,[week]:{
      ...existing,
      [src.shift]:   [...(existing[src.shift]||[]).filter(n=>n!==src.name),targetName],
      [targetShift]: [...(existing[targetShift]||[]).filter(n=>n!==targetName),src.name],
    }};
    setOverrides(newOvS);
    save("overrides",newOvS);
    recompute(operators,absences,leaves,newOvS,yearArchive,weeks);
    flash(`Échange ${src.name} ↔ ${targetName} S${week} ✓`);
    dragRef.current=null;
  };

  // ── UNDO / REDO ───────────────────────────────────────────────────────────
  // history = états AVANT chaque action ; redoStack = états annulés, rétablissables.
  // Chaque entrée ne stocke que les clés touchées (operators/absences/leaves/overrides).
  // Capture les valeurs actuelles des clés présentes dans un modèle d'état.
  const snapshotKeys = tpl =>{
    const s={};
    if(tpl.operators!==undefined) s.operators=operators;
    if(tpl.absences!==undefined)  s.absences=absences;
    if(tpl.leaves!==undefined)    s.leaves=leaves;
    if(tpl.overrides!==undefined) s.overrides=overrides;
    return s;
  };
  // Applique un état partiel (les clés absentes gardent la valeur courante).
  const applyState = st =>{
    const nOps=st.operators||operators, nAbs=st.absences||absences, nLv=st.leaves||leaves, nOv=st.overrides||overrides;
    if(st.operators)  { setOperators(nOps);  sbSetOps(nOps); }
    if(st.absences)   { setAbsences(nAbs);   save("absences", nAbs); }
    if(st.leaves)     { setLeaves(nLv);      save("leaves",   nLv); }
    if(st.overrides)  { setOverrides(nOv);   save("overrides",nOv); }
    recompute(nOps, nAbs, nLv, nOv, yearArchive, weeks);
  };
  const undoLast = ()=>{
    if(!history.length)return;
    const last=history[0];
    const redoEntry={label:last.label, state:snapshotKeys(last.state)}; // état actuel, avant restauration
    applyState(last.state);
    const newH=history.slice(1); setHistory(newH); sbSet("history",newH);
    const newR=[redoEntry,...redoStack].slice(0,15); setRedoStack(newR); sbSet("redostack",newR);
    flash(`Annulé : ${last.label}`,"#c62828");
  };
  const redoLast = ()=>{
    if(!redoStack.length)return;
    const next=redoStack[0];
    const histEntry={label:next.label, ts:Date.now(), state:snapshotKeys(next.state)};
    applyState(next.state);
    const newR=redoStack.slice(1); setRedoStack(newR); sbSet("redostack",newR);
    const newH=[histEntry,...history].slice(0,15); setHistory(newH); sbSet("history",newH);
    flash(`Rétabli : ${next.label}`,"#2e7d32");
  };

  // ── ÉQUIPE
  const addOperator = ()=>{
    if(!newOp.prenom.trim()||!newOp.nom.trim())return;
    const short=newOp.nom.toUpperCase().trim();
    // Tous les nouveaux opérateurs sont intégrés à l'algo automatiquement (isVolant:false).
    // L'utilisateur peut passer un op en volant manuellement depuis l'onglet Équipe.
    const op={id:`op_${Date.now()}`,full:`${newOp.prenom.trim()} ${short}`,short,level:newOp.level,active:true,isVolant:false};
    saveOperators([...operators,op]);
    setNewOp({prenom:"",nom:"",level:"N1"}); setShowAddOp(false);
    flash(`${op.full} ajouté — intégré au planning automatique`);
  };
  const toggleActive  = id=>saveOperators(operators.map(o=>o.id===id?{...o,active:!o.active}:o));
  const toggleVolant  = id=>saveOperators(operators.map(o=>o.id===id?{...o,isVolant:!o.isVolant}:o));
  const deleteOp = id=>{
    if(!window.confirm("Supprimer définitivement ?")) return;
    const op = operators.find(o=>o.id===id);
    const next = operators.filter(o=>o.id!==id);
    saveOperators(next);
    // Nettoyer les overrides : retirer l'opérateur supprimé de toutes les semaines
    if(op && Object.keys(overrides).length>0){
      const cleaned = {};
      let changed = false;
      Object.entries(overrides).forEach(([wk, slots])=>{
        const cl = {
          matin: (slots.matin||[]).filter(s=>s!==op.short),
          am:    (slots.am||[]).filter(s=>s!==op.short),
          nuit:  (slots.nuit||[]).filter(s=>s!==op.short),
        };
        if(cl.matin.length!==(slots.matin||[]).length || cl.am.length!==(slots.am||[]).length || cl.nuit.length!==(slots.nuit||[]).length) changed=true;
        if(cl.matin.length||cl.am.length||cl.nuit.length) cleaned[wk]=cl;
      });
      if(changed) saveOverrides(cleaned);
    }
  };

  // Semaine verrouillée : strictement inférieure à la semaine courante
  const isWeekLocked = w => w < currentWeek;

  const toggleJourChome = (weekNum, dateStr) => {
    if(isWeekLocked(weekNum)){flash("Semaine écoulée — modification impossible","#c62828");return;}
    const key=`${weekNum}-${dateStr}`;
    const next={...joursChomes};
    if(next[key]) delete next[key]; else next[key]=true;
    saveJoursChomes(next);
  };

  // Jour à horaires aménagés : ouvre l'éditeur d'horaires (3 équipes décalées
  // pour se chevaucher). Affectations + total 7h inchangés ; nuit recalculée.
  const openAmenage = (weekNum, dateStr, dayLabel) => {
    if(isWeekLocked(weekNum)){flash("Semaine écoulée — modification impossible","#c62828");return;}
    const existing=joursAmenages[`${weekNum}-${dateStr}`];
    const draft = (existing && typeof existing==="object")
      ? {matin:{...existing.matin}, am:{...existing.am}, nuit:{...existing.nuit}, commun:existing.commun||""}
      : JSON.parse(JSON.stringify(AMENAGE_DEFAULT));
    setAmenageDraft(draft);
    setAmenageEdit({week:weekNum, dateStr, dayLabel});
  };
  const saveAmenage = () => {
    if(!amenageEdit)return;
    const key=`${amenageEdit.week}-${amenageEdit.dateStr}`;
    saveJoursAmenages({...joursAmenages,[key]:amenageDraft});
    setAmenageEdit(null); setAmenageDraft(null);
    flash("Horaires aménagés enregistrés");
  };
  const removeAmenage = () => {
    if(!amenageEdit)return;
    const key=`${amenageEdit.week}-${amenageEdit.dateStr}`;
    const next={...joursAmenages}; delete next[key];
    saveJoursAmenages(next);
    setAmenageEdit(null); setAmenageDraft(null);
    flash("Horaires aménagés retirés");
  };

  const toggleAbsJour = (weekNum, opShort, dateStr, dayLabel) => {
    // Autorisé sur semaine écoulée : le planning archivé ne bouge pas,
    // mais l'absence réelle est tracée pour la paie.
    const entry=`${opShort}|${weekNum}|${dayLabel}`;
    const cur=(absences[weekNum]||[]);
    const exists=cur.includes(entry);
    const next={...absences,[weekNum]:exists?cur.filter(e=>e!==entry):[...cur,entry]};
    if(next[weekNum]&&!next[weekNum].length)delete next[weekNum];
    saveAbsences(next);
  };

  const toggleSat = w=>{
    if(isWeekLocked(w)){flash("Semaine écoulée — modification impossible","#c62828");return;}
    saveSatWeeks(satWeeks.includes(w)?satWeeks.filter(x=>x!==w):[...satWeeks,w]);
  };
  const setSatEndForWeek = (w,v)=>{
    if(isWeekLocked(w)){flash("Semaine écoulée — modification impossible","#c62828");return;}
    saveSatEndPostes({...satEndPostes,[w]:v});
  };

  // ── PUBLICATION
  const publish = async()=>{
    const toPublish = schedules.slice(0, publishNbWeeks);
    const snapshot = {
      schedules: toPublish,
      operators: operators.filter(o=>o.active),
      satWeeks,
      satEndPostes,
      joursChomes,
      joursAmenages,
      notes,
      year,
      publishView,
      publishedAt: new Date().toISOString(),
    };
    setSyncMsg("Publication...");
    try {
      await sbSet("published_planning", snapshot);
      setSyncMsg("Synchronisé ✓");
      setPublishModal(false);
      flash(`Planning publié — ${publishNbWeeks} semaine(s) en vue ${publishView==="jours"?"Jours":"Colonnes"}`);
    } catch(e) {
      setSyncMsg("Erreur publication");
      flash(`Erreur publication : ${e?.message||"inconnue"}`,"#c62828");
    }
  };

  const chipName = n=> showFullNames ? (operators.find(o=>o.short===n)?.full||n) : n;

  const TABS=[
    {id:"planning",  label:"Planning",   icon:"📅"},
    {id:"conges",    label:"Congés",     icon:"🏖"},
    {id:"absences",  label:"Historique", icon:"📋"},
    {id:"equite",    label:"Équité",     icon:"📊"},
    {id:"heures",    label:"Heures",     icon:"🕐"},
    {id:"timeline",  label:"Timeline",   icon:"📈"},
    {id:"equipe",    label:"Équipe",     icon:"👥"},
  ];

  // Samedis travaillés par opérateur (S1 → fin de fenêtre). Suivi explicite :
  // c'est souvent là que naît le sentiment d'injustice, plus que sur les nuits.
  const satCounts = (()=>{
    const m={}; const shIdx={matin:0,am:1,nuit:2};
    allSchedules.forEach(sc=>{
      if(!satWeeks.includes(sc.s)) return;
      const end={M:0,AM:1,N:2}[satEndPostes[sc.s]||"N"];
      ["matin","am","nuit"].forEach(k=>{
        if(shIdx[k]<=end) (sc[k]||[]).forEach(n=>{ m[n]=(m[n]||0)+1; });
      });
    });
    return m;
  })();

  const maxEquity = Math.max(...equity.map(e=>e.total),1);
  // Seuil d'imbalance au prorata des semaines de présence de chaque opérateur
  // (un arrivé en S40 n'est pas comparé sur 52 semaines)
  const equityWeeks = startWeek + numWeeks - 1;
  const imbalance = op => Math.max(op.matin,op.am,op.nuit)-Math.min(op.matin,op.am,op.nuit) > Math.max(op.present||equityWeeks,1) * 0.4;

  // ── IMPRESSION ────────────────────────────────────────────────────────────────
  const printPlanning = ()=>{
    const rows = schedules.map(sc=>{
      const m=getMondayOfWeek(sc.s,year), end=new Date(m); end.setDate(m.getDate()+4);
      const note = notes[sc.s]||"";
      const hasSat = satWeeks.includes(sc.s);
      return `<tr>
        <td><strong>S${sc.s}</strong>${sc.isOverridden?"&nbsp;✏":""}${hasSat?"&nbsp;🗓":""}
            <br><small>${fmtDate(m)} – ${fmtDate(end)}</small>
            ${note?`<br><small style="color:#888">${note}</small>`:""}
        </td>
        <td style="background:#D6EFD8;color:#1B5E20">${sc.matin.join(", ")||"—"}</td>
        <td style="background:#FFF9C4;color:#F57F17">${sc.am.join(", ")||"—"}</td>
        <td style="background:#BBDEFB;color:#0D47A1">${sc.nuit.join(", ")||"—"}</td>
      </tr>`;
    }).join("");
    const win = window.open("","_blank");
    if(!win){flash("Popup bloqué — autoriser les popups pour imprimer","#c62828");return;}
    win.document.write(`<!DOCTYPE html><html><head>
      <title>Planning NEOLITIK ${year}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:20px;font-size:12px;color:#222;}
        h1{font-size:15px;margin:0 0 2px;}p{margin:0 0 10px;color:#777;font-size:11px;}
        table{width:100%;border-collapse:collapse;}
        th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;vertical-align:top;}
        th{background:#3a5c35;color:#fff;font-size:11px;}
        tr:nth-child(even)td:first-child{background:#fafafa;}
        small{font-size:10px;}
        @media print{.no-print{display:none!important;}}
      </style>
    </head><body>
      <h1>NEOLITIK — Planning 3×8 · ${year}</h1>
      <p>S${startWeek}–S${startWeek+numWeeks-1} · Imprimé le ${new Date().toLocaleDateString("fr-FR")}</p>
      <button class="no-print" onclick="window.print()" style="margin-bottom:12px;padding:5px 14px;cursor:pointer;border:1px solid #ccc;border-radius:4px;">🖨 Imprimer</button>
      <table>
        <thead><tr>
          <th>Semaine</th>
          <th>🌅 Matin 5h50–14h</th>
          <th>🌆 AM 13h50–22h</th>
          <th>🌙 Nuit 21h50–6h</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`);
    win.document.close();
  };

  // ── EXPORT CSV (SUIVI & PAIE) ─────────────────────────────────────────────
  // Une ligne par opérateur et par semaine, de S1 à la fin de la fenêtre :
  // poste tenu, absences/congés déclarés, samedi travaillé, source (archive/manuel/algo).
  // Compatible Excel français (séparateur ; et BOM UTF-8).
  const exportCSV = ()=>{
    if(!allSchedules.length){flash("Aucune donnée à exporter","#c62828");return;}
    const shiftIdx={matin:0,am:1,nuit:2};
    const lines=[["Semaine","Dates","Operateur","Niveau","Poste","Absences / Conges","Samedi travaille","Source"].join(";")];
    allSchedules.forEach(sc=>{
      const m=getMondayOfWeek(sc.s,year), end=new Date(m); end.setDate(m.getDate()+4);
      const dates=`${fmtDate(m)} - ${fmtDate(end)}`;
      const hasSat=satWeeks.includes(sc.s);
      const satEnd={M:0,AM:1,N:2}[satEndPostes[sc.s]||"N"];
      operators.forEach(op=>{
        const assigned=[...(sc.matin||[]),...(sc.am||[]),...(sc.nuit||[])].includes(op.short);
        // hors fenêtre de présence ou inactif sans affectation → pas de ligne
        if(op.fromWeek&&sc.s<op.fromWeek&&!assigned) return;
        if(op.toWeek&&sc.s>op.toWeek&&!assigned) return;
        if(!op.active&&!assigned) return;
        let poste="Repos", key=null;
        if((sc.matin||[]).includes(op.short)){poste="Matin";key="matin";}
        else if((sc.am||[]).includes(op.short)){poste="AM";key="am";}
        else if((sc.nuit||[]).includes(op.short)){poste="Nuit";key="nuit";}
        else if(op.isVolant){poste="Journee";}
        const ann=[];
        (absences[sc.s]||[]).forEach(e=>{
          if(e===op.short) ann.push("Absent (semaine)");
          else if(e.startsWith(op.short+"|")) ann.push(`Absent ${e.split("|")[2]}`);
        });
        (leaves[sc.s]||[]).forEach(e=>{
          if(e===op.short) ann.push("Conge (semaine)");
          else if(e.startsWith(op.short+":")){
            const[,range]=e.split(":");const[sd,ed]=range.split("-").map(Number);
            ann.push(`Conge ${DAYS_FR[sd]}-${DAYS_FR[ed]}`);
          }
        });
        const sat = hasSat&&key!==null&&shiftIdx[key]<=satEnd ? "Oui":"Non";
        const source = sc.isArchived?"Archive (fige)":sc.isOverridden?"Ajustement manuel":"Algorithme";
        lines.push([`S${sc.s}`,dates,op.full,op.level,poste,ann.join(" + "),sat,source].join(";"));
      });
    });
    const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`neolitik-suivi-${year}-S1-S${allSchedules[allSchedules.length-1].s}.csv`;
    a.click(); URL.revokeObjectURL(url);
    flash("Export CSV généré — ouvrable dans Excel pour la paie");
  };

  // ── MOTEUR HEURES (récap mensuel paie) ────────────────────────────────────
  // Reconstitue, jour par jour, les heures réellement effectuées par opérateur
  // sur le mois calendaire choisi. Tient compte : poste de la semaine (planning
  // ou archive figée), jours chômés, absences (semaine/jour), congés (complets/
  // partiels), samedis travaillés. Un jour aménagé reste un jour posté normal (7h).
  // Heures sup = au-delà de 35h sur la semaine complète ; pour une semaine à
  // cheval sur deux mois, les HS sont réparties au prorata des heures du mois.
  const computeMonthHours = (mYear, mMonth)=>{
    const arc = archive[mYear]||{};
    const {schedules:full} = buildSchedules(operators, 1, 53, absences, leaves, overrides, arc);
    const byWeek={}; full.forEach(sc=>{ byWeek[sc.s]=sc; });

    // Heures d'un opérateur un jour donné (offset 0=Lun … 5=Sam) ; null = ne travaille pas
    const dayHours=(op, sc, offset, dateStr)=>{
      if(!sc) return null;
      let key=null;
      if(sc.matin.includes(op.short)) key="matin";
      else if(sc.am.includes(op.short)) key="am";
      else if(sc.nuit.includes(op.short)) key="nuit";
      if(!key) return null;                                       // pas affecté = repos
      if(joursChomes[`${sc.s}-${dateStr}`]) return null;          // usine fermée ce jour
      if(offset===5){                                              // samedi
        if(!satWeeks.includes(sc.s)) return null;
        const satEnd={M:0,AM:1,N:2}[satEndPostes[sc.s]||"N"];
        if({matin:0,am:1,nuit:2}[key] > satEnd) return null;      // poste non travaillé ce samedi
      }
      const dayLabel=["Lun","Mar","Mer","Jeu","Ven","Sam"][offset];
      if((absences[sc.s]||[]).includes(`${op.short}|${sc.s}|${dayLabel}`)) return null; // absent ce jour
      const partialLeave=(leaves[sc.s]||[]).some(e=>{
        if(!e.startsWith(op.short+":")) return false;
        const[,range]=e.split(":"); const[sd,ed]=range.split("-").map(Number);
        return offset+1>=sd && offset+1<=ed;
      });
      if(partialLeave) return null;
      // Jour à horaires aménagés : total inchangé (7h), nuit recalculée d'après le créneau saisi
      const am=joursAmenages[`${sc.s}-${dateStr}`];
      const night=(am && typeof am==="object" && am[key]) ? nightHoursForWindow(am[key].s, am[key].e) : NIGHT_HOURS[key];
      return { total:PAID_HOURS_PER_SHIFT, night };
    };

    const res={};
    operators.forEach(op=>{ res[op.short]={op, total:0, night:0, sup:0, days:0, sat:0}; });

    // Semaines touchant le mois — pour chacune on calcule TOUS ses jours (Lun→Sam)
    // afin de connaître le total hebdo (>35h), en marquant ceux du mois sélectionné.
    const weeksTouched=new Set();
    const lastDay=daysInMonth(mYear, mMonth);
    for(let d=1; d<=lastDay; d++){
      const date=new Date(mYear, mMonth, d);
      for(let w=1; w<=53; w++){
        const mon=getMondayOfWeek(w, mYear);
        const diff=Math.floor((date-mon)/86400000);
        if(diff>=0 && diff<=5){ weeksTouched.add(w); break; }
      }
    }

    weeksTouched.forEach(w=>{
      const sc=byWeek[w]; if(!sc) return;
      const mon=getMondayOfWeek(w, mYear);
      operators.forEach(op=>{
        let weekTotal=0, inTotal=0, inNight=0, inDays=0, inSat=0;
        for(let offset=0; offset<=5; offset++){
          const date=new Date(mon); date.setDate(mon.getDate()+offset);
          const h=dayHours(op, sc, offset, fmtDate(date));
          if(!h) continue;
          weekTotal+=h.total;
          if(date.getFullYear()===mYear && date.getMonth()===mMonth){
            inTotal+=h.total; inNight+=h.night; inDays++;
            if(offset===5) inSat++;
          }
        }
        if(inTotal===0) return;
        const supWeek=Math.max(0, weekTotal-WEEKLY_BASE);
        const supMonth=weekTotal>0 ? supWeek*(inTotal/weekTotal) : 0;
        const r=res[op.short];
        r.total+=inTotal; r.night+=inNight; r.sup+=supMonth; r.days+=inDays; r.sat+=inSat;
      });
    });

    return operators
      .map(op=>{ const r=res[op.short]; return {...r, normal:Math.max(0, r.total-r.sup)}; })
      .filter(r=>r.total>0)
      .sort((a,b)=> b.total-a.total);
  };

  const monthHours = React.useMemo(
    ()=> tab==="heures" ? computeMonthHours(hoursYear, hoursMonth) : [],
    [tab, hoursYear, hoursMonth, operators, absences, leaves, overrides, archive, satWeeks, satEndPostes, joursChomes, joursAmenages]
  );
  const monthTotals = monthHours.reduce((a,r)=>({
    total:a.total+r.total, night:a.night+r.night, sup:a.sup+r.sup, normal:a.normal+r.normal, days:a.days+r.days, sat:a.sat+r.sat,
  }),{total:0,night:0,sup:0,normal:0,days:0,sat:0});

  const exportHoursCSV = ()=>{
    if(!monthHours.length){flash("Aucune heure sur ce mois","#c62828");return;}
    const num=h=>h.toFixed(2).replace(".",",");
    const lines=[["Mois","Operateur","Niveau","Jours travailles","dont Samedis","Heures effectuees","Heures normales","Heures de nuit","Heures sup"].join(";")];
    monthHours.forEach(r=>lines.push([
      `${MONTHS_FR[hoursMonth]} ${hoursYear}`, r.op.full, r.op.level, r.days, r.sat,
      num(r.total), num(r.normal), num(r.night), num(r.sup),
    ].join(";")));
    lines.push(["","TOTAL","","","",num(monthTotals.total),num(monthTotals.normal),num(monthTotals.night),num(monthTotals.sup)].join(";"));
    const blob=new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url;
    a.download=`neolitik-heures-${hoursYear}-${String(hoursMonth+1).padStart(2,"0")}.csv`;
    a.click(); URL.revokeObjectURL(url);
    flash("Export heures généré — ouvrable dans Excel");
  };
  const shiftHoursMonth = delta=>{
    let m=hoursMonth+delta, y=hoursYear;
    if(m<0){m=11;y--;} else if(m>11){m=0;y++;}
    setHoursMonth(m); setHoursYear(y);
  };

  // ── RENDER ────────────────────────────────────────────────────────────────
  return(
    <div style={{fontFamily:"'DM Sans','Outfit',sans-serif",background:"#f7f8fa",minHeight:"100vh"}}>

      {/* Flash */}
      {flashMsg&&<div style={{position:"fixed",top:16,right:16,zIndex:9999,background:flashMsg.color,color:"#fff",padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:600,boxShadow:"0 4px 12px rgba(0,0,0,.2)"}}>{flashMsg.msg}</div>}

      {/* Modale Publier */}
      {publishModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{background:"#fff",borderRadius:12,width:420,maxWidth:"92vw",padding:24,boxShadow:"0 8px 40px rgba(0,0,0,.18)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <span style={{fontWeight:600,fontSize:15}}>📢 Publier le planning</span>
              <button onClick={()=>setPublishModal(false)} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#666"}}>×</button>
            </div>
            <p style={{fontSize:13,color:"#555",marginBottom:16,lineHeight:1.5}}>
              Choisissez le nombre de semaines à rendre visibles via le lien partagé.<br/>
              <strong>Les modifications en cours ne seront visibles qu'après publication.</strong>
            </p>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <span style={{fontSize:13,fontWeight:500}}>Semaines visibles :</span>
              {[2,3,4,5].map(n=>(
                <button key={n} onClick={()=>setPublishNbWeeks(n)}
                  style={{padding:"6px 14px",borderRadius:6,border:"1px solid #ccc",background:publishNbWeeks===n?BRAND:"#fff",color:publishNbWeeks===n?"#fff":"#333",cursor:"pointer",fontSize:13,fontWeight:publishNbWeeks===n?600:400}}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
              <span style={{fontSize:13,fontWeight:500}}>Vue publiée :</span>
              {[{v:"colonnes",l:"🗂 Colonnes"},{v:"jours",l:"📆 Jours"}].map(({v,l})=>(
                <button key={v} onClick={()=>setPublishView(v)}
                  style={{padding:"6px 14px",borderRadius:6,border:"1px solid #ccc",background:publishView===v?BRAND:"#fff",color:publishView===v?"#fff":"#333",cursor:"pointer",fontSize:13,fontWeight:publishView===v?600:400}}>
                  {l}
                </button>
              ))}
            </div>
            <div style={{background:"#f0f4ff",border:"1px solid #c5cae9",borderRadius:7,padding:"10px 12px",marginBottom:20,fontSize:12,color:"#555"}}>
              🔗 Lien à partager :<br/>
              <span style={{fontFamily:"monospace",fontSize:11,wordBreak:"break-all",color:BRAND}}>
                {window.location.origin}/?view=planning&token={PUBLIC_TOKEN}
              </span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setPublishModal(false)} style={{padding:"8px 16px",borderRadius:7,border:"1px solid #ccc",background:"#fff",cursor:"pointer",fontSize:13}}>Annuler</button>
              <button onClick={publish} style={{padding:"8px 20px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}>Publier</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale Horaires aménagés */}
      {amenageEdit&&amenageDraft&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{background:"#fff",borderRadius:12,width:480,maxWidth:"94vw",padding:24,boxShadow:"0 8px 40px rgba(0,0,0,.18)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <span style={{fontWeight:600,fontSize:15}}>⇄ Horaires aménagés — {amenageEdit.dayLabel} {amenageEdit.dateStr}</span>
              <button onClick={()=>{setAmenageEdit(null);setAmenageDraft(null);}} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#666"}}>×</button>
            </div>
            <p style={{fontSize:12,color:"#666",margin:"0 0 16px",lineHeight:1.5}}>
              Ce jour-là, les 3 équipes ne tournent pas en 3×8 classique : on décale leurs horaires pour créer un chevauchement. Les affectations et le total d'heures (7h/personne) ne changent pas, mais les <strong>heures de nuit sont recalculées</strong> d'après ces horaires.
            </p>
            {[
              {key:"matin",label:"🌅 Matin",tc:"#1B5E20"},
              {key:"am",   label:"🌆 Après-midi",tc:"#F57F17"},
              {key:"nuit", label:"🌙 Nuit",tc:"#0D47A1"},
            ].map(({key,label,tc})=>(
              <div key={key} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <span style={{width:104,fontWeight:600,color:tc,fontSize:13}}>{label}</span>
                <input type="time" value={amenageDraft[key].s} onChange={e=>setAmenageDraft(d=>({...d,[key]:{...d[key],s:e.target.value}}))} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
                <span style={{color:"#888"}}>→</span>
                <input type="time" value={amenageDraft[key].e} onChange={e=>setAmenageDraft(d=>({...d,[key]:{...d[key],e:e.target.value}}))} style={{padding:"5px 8px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
                <span style={{fontSize:11,color:"#0D47A1"}} title="Heures de nuit (22h–6h) pour ce créneau">→ nuit {fmtHours(nightHoursForWindow(amenageDraft[key].s,amenageDraft[key].e))}</span>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:14,marginBottom:18}}>
              <span style={{fontSize:13,fontWeight:500,color:"#555",whiteSpace:"nowrap"}}>Créneau commun :</span>
              <input value={amenageDraft.commun} onChange={e=>setAmenageDraft(d=>({...d,commun:e.target.value}))} placeholder="ex. 14h–16h tous présents" style={{flex:1,padding:"6px 10px",borderRadius:6,border:"1px solid #ccc",fontSize:13}}/>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"space-between",alignItems:"center"}}>
              <button onClick={removeAmenage} style={{padding:"8px 14px",borderRadius:7,border:"1px solid #ef9a9a",background:"#fff5f5",color:"#c62828",cursor:"pointer",fontSize:13}}>Retirer l'aménagement</button>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>{setAmenageEdit(null);setAmenageDraft(null);}} style={{padding:"8px 16px",borderRadius:7,border:"1px solid #ccc",background:"#fff",cursor:"pointer",fontSize:13}}>Annuler</button>
                <button onClick={saveAmenage} style={{padding:"8px 20px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}>Enregistrer</button>
              </div>
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
          {redoStack.length>0&&(
            <button onClick={redoLast} title={`Rétablir : ${redoStack[0]?.label}`}
              style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",borderRadius:6,cursor:"pointer",padding:"4px 10px",fontSize:12,color:"#fff"}}>
              ↪ Rétablir
            </button>
          )}
          <button onClick={()=>setPublishModal(true)} style={{background:"rgba(255,255,255,.15)",border:"1px solid rgba(255,255,255,.3)",borderRadius:6,cursor:"pointer",padding:"4px 12px",fontSize:12,color:"#fff"}}>
            📢 Publier
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
                  title="Efface les ajustements manuels futurs et repart de l'algorithme">
                  🔄 Recalculer
                </button>
                <button onClick={printPlanning} style={{padding:"6px 14px",borderRadius:7,background:"#fff",color:"#333",border:"1px solid #ccc",cursor:"pointer",fontSize:13}}
                  title="Ouvrir une version imprimable du planning">
                  🖨 Imprimer
                </button>
                <button onClick={exportCSV} style={{padding:"6px 14px",borderRadius:7,background:"#fff",color:"#333",border:"1px solid #ccc",cursor:"pointer",fontSize:13}}
                  title="Exporter S1 → fin de fenêtre en CSV (Excel) : poste par opérateur, absences, congés, samedis — pour la paie">
                  ⬇ CSV paie
                </button>
                {[{k:"liste",l:"📋 Liste"},{k:"colonnes",l:"🗂 Colonnes"},{k:"jours",l:"📆 Jours"}].map(v=>(
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
              🔁 <strong>Échange :</strong> déposez un opérateur <em>sur</em> un autre opérateur pour échanger leurs postes en un geste (arrangement entre ouvriers).<br/>
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
                                      onDropChip={()=>onSwap(sc.s,sh.key,n)}
                                      highlight={!!(highlightOp&&n===highlightOp)}/>
                                  ))}
                                </div>
                              </td>
                            );
                          })}
                          <td style={{padding:"8px",textAlign:"center"}}>
                            {isWeekLocked(sc.s)
                              ? <span style={{fontSize:11,color:"#bbb"}}>🔒 {hasSat?satEndPostes[sc.s]||"N":"—"}</span>
                              : <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                                  <button onClick={()=>toggleSat(sc.s)}
                                    style={{background:hasSat?"#fdecea":"#f5f5f5",border:`1px solid ${hasSat?"#ef9a9a":"#ccc"}`,borderRadius:6,cursor:"pointer",padding:"3px 7px",fontSize:11,color:hasSat?"#b71c1c":"#555"}}>
                                    {hasSat?"✓ Sam":"+ Sam"}
                                  </button>
                                  {hasSat&&(
                                    <select value={satEndPostes[sc.s]||"N"} onChange={e=>setSatEndForWeek(sc.s,e.target.value)}
                                      style={{fontSize:10,padding:"2px 4px",borderRadius:4,border:"1px solid #ccc",background:"#fff",width:60}}>
                                      <option value="M">Matin</option>
                                      <option value="AM">AM</option>
                                      <option value="N">Nuit</option>
                                    </select>
                                  )}
                                </div>
                            }
                          </td>
                          <td style={{padding:"8px 10px"}}>
                            {isWeekLocked(sc.s)
                              ? <span style={{fontSize:11,color:"#bbb"}}>{notes[sc.s]||""}</span>
                              : <input value={notes[sc.s]||""} onChange={e=>saveNotes({...notes,[sc.s]:e.target.value})}
                                  placeholder="Note…" style={{width:"100%",padding:"4px 6px",borderRadius:5,border:"1px solid #e0e0e0",fontSize:12,background:"transparent"}}/>
                            }
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
                          {isWeekLocked(sc.s)&&<span style={{fontSize:10,background:"rgba(255,255,255,.2)",borderRadius:3,padding:"1px 5px"}}>🔒</span>}
                          {isCurrent&&<span style={{fontSize:10,background:"rgba(255,255,255,.25)",borderRadius:3,padding:"1px 4px"}}>● Now</span>}
                          {sc.isOverridden&&<span style={{fontSize:10,background:"rgba(255,165,0,.35)",borderRadius:3,padding:"1px 4px"}}>✏</span>}
                        </div>
                        <div style={{fontSize:11,opacity:.8}}>{fmtDate(m)} – {fmtDate(end)}{hasSat?` · Sam ↳ ${satEndPostes[sc.s]==="M"?"Matin":satEndPostes[sc.s]==="AM"?"AM":"Nuit"}`:""}</div>
                        {isWeekLocked(sc.s)
                          ? <div style={{marginTop:5,fontSize:11,opacity:.7}}>{notes[sc.s]||""}</div>
                          : <input value={notes[sc.s]||""} onChange={e=>saveNotes({...notes,[sc.s]:e.target.value})}
                              placeholder="Note…" style={{marginTop:5,width:"100%",padding:"3px 6px",borderRadius:4,border:"1px solid rgba(255,255,255,.3)",fontSize:11,background:"rgba(255,255,255,.1)",color:"#fff"}}/>
                        }
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
                                  onDropChip={()=>onSwap(sc.s,sh.key,n)}
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

            {/* VUE JOURS */}
            {view==="jours"&&(
              <div style={{overflowX:"auto"}}>
                <div style={{fontSize:12,color:"#4527A0",marginBottom:10,background:"#EDE7F6",border:"1px solid #d1c4e9",borderRadius:7,padding:"8px 12px"}}>
                  ⇄ <strong>Jour aménagé :</strong> dans l'en-tête d'un jour, cliquez « aménager » pour fixer des horaires décalés par équipe ce jour-là (ex. Matin 8h–16h, AM 11h–19h, Nuit 14h–22h) afin de créer un chevauchement. Les affectations et le total d'heures (7h/personne) restent inchangés, mais les <strong>heures de nuit sont recalculées</strong> d'après ces horaires (visibles dans l'onglet Heures et sur le lien équipe).
                </div>
                {schedules.map(sc=>{
                  const hasSat=satWeeks.includes(sc.s);
                  const m=getMondayOfWeek(sc.s,year);
                  const numDays=hasSat?6:5;
                  const weekSatEnd=satEndPostes[sc.s]||"N"; // par défaut Nuit si non défini
                  const satEndIdx={M:0,AM:1,N:2}[weekSatEnd];
                  const shiftIdx={matin:0,am:1,nuit:2};
                  const hasAlert=sc.alerts.some(a=>!a.startsWith("ℹ"));
                  const isCurrent=sc.s===currentWeek;
                  const locked=isWeekLocked(sc.s);

                  // Jours fériés français fixes + Ascension/Pentecôte approx
                  const feriesDates=getFeries(year);

                  // Construction des jours
                  const days=Array.from({length:numDays},(_,d)=>{
                    const date=new Date(m); date.setDate(m.getDate()+d);
                    const dateStr=`${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}`;
                    const isFerie=feriesDates.includes(dateStr);
                    const isSat=d===5;
                    const isChome=!!joursChomes[`${sc.s}-${dateStr}`];
                    const amKey=`${sc.s}-${dateStr}`;
                    const isAmenage=joursAmenages[amKey]!==undefined;
                    return{d,date,dateStr,isFerie,isSat,isChome,isAmenage,amenage:joursAmenages[amKey]};
                  });

                  // Opérateurs groupés par poste
                  const groups=[
                    {key:"matin",label:"🌅 Matin 5h50–14h", bg:"#f0faf1",tc:"#1B5E20"},
                    {key:"am",   label:"🌆 AM 13h50–22h",   bg:"#fffde7",tc:"#F57F17"},
                    {key:"nuit", label:"🌙 Nuit 21h50–6h",  bg:"#e3f2fd",tc:"#0D47A1"},
                  ];

                  // Volants actifs
                  const volantsList=operators.filter(o=>o.active&&o.isVolant);

                  return(
                    <div key={sc.s} style={{background:"#fff",borderRadius:10,border:`1px solid ${hasAlert?"#ef9a9a":isCurrent?BRAND:"#e0e0e0"}`,marginBottom:16,overflow:"hidden"}}>
                      {/* Header semaine */}
                      <div style={{background:hasAlert?"#c62828":isCurrent?"#2d4828":BRAND,color:"#fff",padding:"8px 14px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontWeight:700,fontSize:14}}>S{sc.s}</span>
                        {locked&&<span style={{fontSize:10,background:"rgba(255,255,255,.2)",borderRadius:3,padding:"1px 5px"}}>🔒</span>}
                        {isCurrent&&<span style={{fontSize:10,background:"rgba(255,255,255,.25)",borderRadius:3,padding:"1px 5px"}}>● Now</span>}
                        {sc.isOverridden&&<span style={{fontSize:10,background:"rgba(255,165,0,.35)",borderRadius:3,padding:"1px 5px"}}>✏</span>}
                        <span style={{fontSize:12,opacity:.8}}>{fmtDate(m)} – {fmtDate(new Date(m.getTime()+(numDays-1)*86400000))}</span>
                        {/* Bouton Sam + sélecteur dernier poste par semaine */}
                        {!locked&&(
                          <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:"auto"}}>
                            <button onClick={()=>toggleSat(sc.s)}
                              style={{fontSize:10,padding:"2px 7px",borderRadius:4,border:"1px solid rgba(255,255,255,.4)",background:hasSat?"rgba(255,255,255,.25)":"transparent",color:"#fff",cursor:"pointer"}}>
                              {hasSat?"✓ Sam":"+ Sam"}
                            </button>
                            {hasSat&&(
                              <select value={weekSatEnd} onChange={e=>setSatEndForWeek(sc.s,e.target.value)}
                                style={{fontSize:10,padding:"2px 5px",borderRadius:4,border:"1px solid rgba(255,255,255,.3)",background:"rgba(255,255,255,.1)",color:"#fff",cursor:"pointer"}}>
                                <option value="M">↳ Matin</option>
                                <option value="AM">↳ AM</option>
                                <option value="N">↳ Nuit</option>
                              </select>
                            )}
                          </div>
                        )}
                        {locked&&hasSat&&<span style={{fontSize:11,opacity:.7,marginLeft:"auto"}}>Sam. ↳ {weekSatEnd==="M"?"Matin":weekSatEnd==="AM"?"AM":"Nuit"}</span>}
                        {notes[sc.s]&&<span style={{fontSize:11,opacity:.8}}>{notes[sc.s]}</span>}
                      </div>

                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                        <thead>
                          <tr style={{borderBottom:"1px solid #f0f0f0",background:"#fafafa"}}>
                            <th style={{padding:"6px 10px",textAlign:"left",fontWeight:500,fontSize:11,color:"#666",minWidth:160}}>
                              Opérateur
                              <span style={{display:"block",fontSize:9,color:"#bbb",fontWeight:400}}>clic cellule = absent ce jour</span>
                            </th>
                            {days.map(({d,dateStr,isFerie,isSat,isChome,isAmenage,amenage})=>(
                              <th key={d}
                                onClick={()=>!locked&&toggleJourChome(sc.s,dateStr)}
                                style={{padding:"6px 8px",textAlign:"center",fontWeight:500,fontSize:11,
                                  color:isChome?"#888":isSat?"#e65100":"#666",
                                  background:isChome?"#f5f5f5":isAmenage?"#EDE7F6":isSat?"#fff8f0":"transparent",
                                  minWidth:80,whiteSpace:"nowrap",
                                  cursor:locked?"default":"pointer",
                                  opacity:isChome?0.5:1}}>
                                {["Lun","Mar","Mer","Jeu","Ven","Sam"][d]}
                                <span style={{display:"block",fontSize:10,fontWeight:400,opacity:.8}}>
                                  {dateStr}
                                  {isFerie&&<span style={{fontSize:9,color:"#888",marginLeft:2}}>Férié</span>}
                                </span>
                                {isChome&&<span style={{display:"block",fontSize:9,color:"#888",fontWeight:400}}>Chômé</span>}
                                {isAmenage&&!isChome&&<span style={{display:"block",fontSize:9,color:"#4527A0",fontWeight:600}}>⇄ Aménagé</span>}
                                {isAmenage&&!isChome&&<AmenageSummary entry={amenage}/>}
                                {!locked&&!isChome&&(
                                  <span style={{display:"block",fontSize:8,color:"#ccc",fontWeight:400}}>
                                    clic = chômer · <span onClick={e=>{e.stopPropagation();openAmenage(sc.s,dateStr,["Lun","Mar","Mer","Jeu","Ven","Sam"][d]);}} style={{color:"#7E57C2",cursor:"pointer",textDecoration:"underline"}}>{isAmenage?"modifier horaires":"aménager"}</span>
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map(({key,label,bg,tc})=>{
                            const opsInShift=sc[key]||[];
                            if(!opsInShift.length) return null;
                            return(
                              <React.Fragment key={key}>
                                <tr>
                                  <td colSpan={numDays+1} style={{padding:"3px 10px",background:bg,fontSize:10,fontWeight:600,color:tc,letterSpacing:.3}}>{label}</td>
                                </tr>
                                {opsInShift.map(short=>{
                                  const op=operators.find(o=>o.short===short);
                                  const lv=LEVEL_BADGE[op?.level||"N1"];
                                  return(
                                    <tr key={short} style={{borderBottom:"0.5px solid #f5f5f5"}}>
                                      <td style={{padding:"5px 10px",whiteSpace:"nowrap"}}>
                                        <span style={{fontWeight:500}}>{showFullNames?(op?.full||short):short}</span>
                                        <span style={{background:lv.bg,color:lv.color,borderRadius:3,padding:"1px 4px",fontSize:9,fontWeight:600,marginLeft:4}}>{op?.level||"N1"}</span>
                                      </td>
                                      {days.map(({d,isSat,isChome,dateStr})=>{
                                        const isOff=isSat&&shiftIdx[key]>satEndIdx;
                                        const dayLabel=["Lun","Mar","Mer","Jeu","Ven","Sam"][d];
                                        const absKey=`${short}|${sc.s}|${dayLabel}`;
                                        const isAbsent=(absences[sc.s]||[]).includes(absKey);
                                        const chipBg=isOff||isChome||isAbsent?"#f5f5f5":bg;
                                        const chipTc=isOff||isChome||isAbsent?"#bbb":tc;
                                        const postLabel=key==="matin"?"M":key==="am"?"AM":"N";
                                        return(
                                          <td key={d}
                                            onClick={()=>!isOff&&!isChome&&toggleAbsJour(sc.s,short,dateStr,dayLabel)}
                                            style={{padding:"4px 6px",textAlign:"center",
                                              background:isChome?"#f9f9f9":isSat?"#fffdf5":"transparent",
                                              cursor:isOff||isChome?"default":"pointer"}}>
                                            <span style={{background:chipBg,color:chipTc,borderRadius:3,padding:"2px 6px",fontSize:11,fontWeight:500,display:"inline-block"}}>
                                              {isOff||isChome||isAbsent?"—":postLabel}
                                            </span>
                                            {isAbsent&&!isChome&&!isOff&&<span style={{display:"block",fontSize:8,color:"#bbb"}}>absent</span>}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          })}

                          {/* Volants */}
                          {volantsList.length>0&&(
                            <>
                              <tr>
                                <td colSpan={numDays+1} style={{padding:"3px 10px",background:"#EDE7F6",fontSize:10,fontWeight:600,color:"#4527A0",letterSpacing:.3}}>☀️ Journée</td>
                              </tr>
                              {volantsList.map(op=>{
                                const lv=LEVEL_BADGE[op.level||"N1"];
                                const inPlanning=[...(sc.matin||[]),...(sc.am||[]),...(sc.nuit||[])].includes(op.short);
                                return(
                                  <tr key={op.short} style={{borderBottom:"0.5px solid #f5f5f5"}}>
                                    <td style={{padding:"5px 10px",whiteSpace:"nowrap"}}>
                                      <span style={{fontWeight:500}}>{showFullNames?op.full:op.short}</span>
                                      <span style={{background:lv.bg,color:lv.color,borderRadius:3,padding:"1px 4px",fontSize:9,fontWeight:600,marginLeft:4}}>{op.level}</span>
                                      {inPlanning&&<span style={{background:"#e8f5e9",color:"#2e7d32",borderRadius:3,padding:"1px 4px",fontSize:9,marginLeft:3}}>planning</span>}
                                    </td>
                                    {days.map(({d,isSat,isChome,dateStr})=>{
                                      const dayLabel=["Lun","Mar","Mer","Jeu","Ven","Sam"][d];
                                      const absKey=`${op.short}|${sc.s}|${dayLabel}`;
                                      const isAbsent=(absences[sc.s]||[]).includes(absKey);
                                      if(inPlanning){
                                        return <td key={d} style={{padding:"4px 6px",textAlign:"center"}}><span style={{color:"#bbb",fontSize:11}}>—</span></td>;
                                      }
                                      return(
                                        <td key={d}
                                          onClick={()=>!isChome&&toggleAbsJour(sc.s,op.short,dateStr,dayLabel)}
                                          style={{padding:"4px 6px",textAlign:"center",
                                            background:isChome?"#f9f9f9":isSat?"#fffdf5":"transparent",
                                            cursor:isChome?"default":"pointer"}}>
                                          <span style={{background:isChome||isAbsent?"#f5f5f5":"#EDE7F6",color:isChome||isAbsent?"#bbb":"#4527A0",borderRadius:3,padding:"2px 6px",fontSize:11,fontWeight:500,display:"inline-block"}}>
                                            {isChome||isAbsent?"—":"J"}
                                          </span>
                                          {isAbsent&&!isChome&&<span style={{display:"block",fontSize:8,color:"#bbb"}}>absent</span>}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </>
                          )}
                        </tbody>
                      </table>
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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontWeight:600,fontSize:15}}>Historique absences ponctuelles</div>
              <button onClick={exportCSV} style={{padding:"6px 14px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}
                title="Export complet S1 → fin de fenêtre : poste par opérateur, absences, congés, samedis — pour la paie">
                ⬇ Export CSV paie
              </button>
            </div>
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
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
              <div style={{fontWeight:600,fontSize:15}}>Journal des actions</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={undoLast} disabled={!history.length}
                  style={{padding:"5px 12px",borderRadius:6,border:"1px solid #ccc",background:history.length?"#fff":"#f5f5f5",color:history.length?"#c62828":"#bbb",cursor:history.length?"pointer":"default",fontSize:12,fontWeight:600}}>
                  ↩ Annuler
                </button>
                <button onClick={redoLast} disabled={!redoStack.length}
                  style={{padding:"5px 12px",borderRadius:6,border:"1px solid #ccc",background:redoStack.length?"#fff":"#f5f5f5",color:redoStack.length?"#2e7d32":"#bbb",cursor:redoStack.length?"pointer":"default",fontSize:12,fontWeight:600}}>
                  ↪ Rétablir{redoStack.length?` (${redoStack.length})`:""}
                </button>
              </div>
            </div>
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
            <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>Équité — cumul S1 → S{startWeek+numWeeks-1} ({year})</div>
            <div style={{fontSize:12,color:"#888",marginBottom:14}}>Stats annuelles depuis la semaine 1 — base objective pour l'algorithme de rotation.</div>
            <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0"}}>
                    <th style={{padding:"10px 14px",textAlign:"left"}}>Opérateur</th>
                    <th style={{padding:"10px 14px",textAlign:"left"}}>Niv.</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#1B5E20"}}>Matin</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#F57F17"}}>AM</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#0D47A1"}}>Nuit</th>
                    <th style={{padding:"10px 14px",textAlign:"center",color:"#e65100"}} title="Samedis travaillés (semaines avec samedi activé)">Samedis</th>
                    <th style={{padding:"10px 14px",textAlign:"center"}}>Total</th>
                    <th style={{padding:"10px 14px",textAlign:"center"}} title="Semaines de présence (fenêtre arrivée/départ)">Présence</th>
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
                              <div style={{width:Math.round((op[sh.k]/Math.max(equityWeeks,1))*60),height:8,background:sh.bg,borderRadius:4,minWidth:2}}/>
                              <span style={{color:sh.tc,fontWeight:600}}>{op[sh.k]}</span>
                            </div>
                          </td>
                        ))}
                        <td style={{padding:"8px 14px",textAlign:"center"}}>
                          <span style={{fontWeight:600,color:(satCounts[op.short]||0)>0?"#e65100":"#bbb"}}>{satCounts[op.short]||0}</span>
                        </td>
                        <td style={{padding:"8px 14px",textAlign:"center"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                            <div style={{width:Math.round((op.total/maxEquity)*60),height:8,background:"#ccc",borderRadius:4,minWidth:2}}/>
                            <span style={{fontWeight:600}}>{op.total}</span>
                          </div>
                        </td>
                        <td style={{padding:"8px 14px",textAlign:"center",fontSize:12,color:"#666"}}>
                          {op.present||0} sem.
                          {(op.fromWeek||op.toWeek)&&<span style={{display:"block",fontSize:10,color:"#999"}}>{op.fromWeek?`S${op.fromWeek}`:"S1"} → {op.toWeek?`S${op.toWeek}`:"…"}</span>}
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

        {/* ══ HEURES ══ */}
        {tab==="heures"&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:10}}>
              <div style={{fontWeight:600,fontSize:15}}>Récap mensuel des heures — paie</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>shiftHoursMonth(-1)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid #ccc",background:"#fff",cursor:"pointer",fontSize:15,fontWeight:600}}>‹</button>
                <span style={{fontWeight:600,fontSize:14,minWidth:150,textAlign:"center"}}>{MONTHS_FR[hoursMonth]} {hoursYear}</span>
                <button onClick={()=>shiftHoursMonth(1)} style={{padding:"5px 12px",borderRadius:6,border:"1px solid #ccc",background:"#fff",cursor:"pointer",fontSize:15,fontWeight:600}}>›</button>
                <button onClick={exportHoursCSV} style={{padding:"6px 14px",borderRadius:7,background:BRAND,color:"#fff",border:"none",cursor:"pointer",fontSize:13,fontWeight:600}}>⬇ Export CSV</button>
              </div>
            </div>
            <div style={{fontSize:12,color:"#888",marginBottom:14}}>
              Mois calendaire du 1<sup>er</sup> au {daysInMonth(hoursYear,hoursMonth)} {MONTHS_FR[hoursMonth].toLowerCase()} {hoursYear}.
              Base : {PAID_HOURS_PER_SHIFT}h payées par poste · nuit {NIGHT_WINDOW[0]}h–{NIGHT_WINDOW[1]}h · heures sup au-delà de {WEEKLY_BASE}h/semaine.
            </div>

            {monthHours.length===0
              ? <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",padding:"24px",fontSize:13,color:"#999",textAlign:"center"}}>Aucune heure enregistrée sur ce mois.</div>
              : <div style={{background:"#fff",borderRadius:10,border:"1px solid #e0e0e0",overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:680}}>
                    <thead>
                      <tr style={{background:"#f5f5f5",borderBottom:"1px solid #e0e0e0"}}>
                        <th style={{padding:"10px 14px",textAlign:"left"}}>Opérateur</th>
                        <th style={{padding:"10px 10px",textAlign:"left"}}>Niv.</th>
                        <th style={{padding:"10px 10px",textAlign:"center"}}>Jours</th>
                        <th style={{padding:"10px 10px",textAlign:"center"}}>Effectuées</th>
                        <th style={{padding:"10px 10px",textAlign:"center"}}>Normales</th>
                        <th style={{padding:"10px 10px",textAlign:"center",color:"#0D47A1"}}>Nuit</th>
                        <th style={{padding:"10px 10px",textAlign:"center",color:"#e65100"}}>Heures sup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthHours.map((r,i)=>(
                        <tr key={r.op.id||r.op.short} style={{borderBottom:"1px solid #f0f0f0",background:i%2===0?"#fff":"#fafafa"}}>
                          <td style={{padding:"9px 14px",fontWeight:500}}>{r.op.full}</td>
                          <td style={{padding:"9px 10px"}}><LevelBadge level={r.op.level}/></td>
                          <td style={{padding:"9px 10px",textAlign:"center"}}>
                            {r.days}
                            {r.sat>0&&<span style={{fontSize:10,color:"#e65100",display:"block"}}>dont {r.sat} sam.</span>}
                          </td>
                          <td style={{padding:"9px 10px",textAlign:"center",fontWeight:700}}>{fmtHours(r.total)}</td>
                          <td style={{padding:"9px 10px",textAlign:"center"}}>{fmtHours(r.normal)}</td>
                          <td style={{padding:"9px 10px",textAlign:"center",color:"#0D47A1",fontWeight:r.night>0?600:400}}>{r.night>0?fmtHours(r.night):"—"}</td>
                          <td style={{padding:"9px 10px",textAlign:"center",color:"#e65100",fontWeight:r.sup>0?700:400}}>{r.sup>0?fmtHours(r.sup):"—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{borderTop:"2px solid #e0e0e0",background:"#f1f8e9",fontWeight:700}}>
                        <td style={{padding:"10px 14px"}} colSpan={2}>TOTAL équipe</td>
                        <td style={{padding:"10px 10px",textAlign:"center"}}>{monthTotals.days}</td>
                        <td style={{padding:"10px 10px",textAlign:"center"}}>{fmtHours(monthTotals.total)}</td>
                        <td style={{padding:"10px 10px",textAlign:"center"}}>{fmtHours(monthTotals.normal)}</td>
                        <td style={{padding:"10px 10px",textAlign:"center",color:"#0D47A1"}}>{fmtHours(monthTotals.night)}</td>
                        <td style={{padding:"10px 10px",textAlign:"center",color:"#e65100"}}>{monthTotals.sup>0?fmtHours(monthTotals.sup):"—"}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
            }

            <div style={{fontSize:12,color:"#666",marginTop:12,background:"#f0f4ff",border:"1px solid #c5cae9",borderRadius:7,padding:"10px 14px",lineHeight:1.6}}>
              <strong>Lecture des colonnes :</strong><br/>
              • <strong>Effectuées</strong> = total des heures travaillées ({PAID_HOURS_PER_SHIFT}h par jour posté).<br/>
              • <strong>Normales</strong> = Effectuées − Heures sup.<br/>
              • <strong>Nuit</strong> = heures entre {NIGHT_WINDOW[0]}h et {NIGHT_WINDOW[1]}h — <em>incluses</em> dans les Effectuées (c'est une majoration, pas un ajout). Poste Nuit ≈ {fmtHours(NIGHT_HOURS.nuit)} de nuit, AM {fmtHours(NIGHT_HOURS.am)}, Matin {fmtHours(NIGHT_HOURS.matin)}.<br/>
              • <strong>Heures sup</strong> = au-delà de {WEEKLY_BASE}h sur la semaine ; une semaine à cheval sur deux mois est répartie au prorata des jours.<br/>
              <span style={{color:"#888"}}>Note : un jour férié travaillé est compté comme normal (l'usine tourne 24/7). S'il n'est pas travaillé, marquez-le « chômé » dans la vue Jours. Les majorations de dimanche/férié ne sont pas calculées automatiquement.</span>
            </div>
          </div>
        )}

        {/* ══ TIMELINE ══ */}
        {tab==="timeline"&&(
          <div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:4}}>Timeline par opérateur — S{startWeek} à S{startWeek+numWeeks-1} ({year})</div>
            <div style={{fontSize:12,color:"#888",marginBottom:14}}>Vue synthétique de la rotation : identifiez les séquences, les absences et les déséquilibres d'un coup d'œil.</div>

            {/* Légende */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12,fontSize:11}}>
              {[
                {bg:"#D6EFD8",tc:"#1B5E20",label:"M = Matin"},
                {bg:"#FFF9C4",tc:"#F57F17",label:"AM"},
                {bg:"#BBDEFB",tc:"#0D47A1",label:"N = Nuit"},
                {bg:"#FDECEA",tc:"#B71C1C",label:"ABS = Absent/Congé"},
                {bg:"#f5f5f5",tc:"#bbb",   label:"— = non affecté"},
              ].map(({bg,tc,label})=>(
                <span key={label} style={{background:bg,color:tc,borderRadius:4,padding:"2px 8px",fontWeight:600,border:`1px solid ${bg}`}}>{label}</span>
              ))}
            </div>

            <div style={{overflowX:"auto"}}>
              <table style={{borderCollapse:"collapse",fontSize:12,background:"#fff",borderRadius:10,overflow:"hidden",border:"1px solid #e0e0e0",minWidth:"100%"}}>
                <thead>
                  <tr style={{background:BRAND,color:"#fff"}}>
                    <th style={{padding:"8px 14px",textAlign:"left",minWidth:150,position:"sticky",left:0,background:BRAND,zIndex:2}}>Opérateur</th>
                    {schedules.map(sc=>{
                      const m=getMondayOfWeek(sc.s,year);
                      const isCurrent=sc.s===currentWeek;
                      return(
                        <th key={sc.s} style={{padding:"6px 8px",textAlign:"center",minWidth:56,
                          background:isCurrent?"#2d4828":BRAND,
                          borderLeft:"1px solid rgba(255,255,255,.15)"}}>
                          <div style={{fontWeight:700}}>S{sc.s}</div>
                          <div style={{fontSize:9,opacity:.75,fontWeight:400}}>{fmtDate(m)}</div>
                          {isCurrent&&<div style={{fontSize:8,background:"rgba(255,255,255,.25)",borderRadius:2,padding:"0 3px",marginTop:1}}>Now</div>}
                        </th>
                      );
                    })}
                    <th style={{padding:"8px 10px",textAlign:"center",minWidth:80,borderLeft:"1px solid rgba(255,255,255,.2)"}}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOps.filter(o=>!o.isVolant).map((op,i)=>{
                    const lv=LEVEL_BADGE[op.level];
                    // Compter les postes sur la fenêtre affichée
                    let wMat=0,wAm=0,wNuit=0;
                    schedules.forEach(sc=>{
                      if(sc.matin.includes(op.short))wMat++;
                      else if(sc.am.includes(op.short))wAm++;
                      else if(sc.nuit.includes(op.short))wNuit++;
                    });
                    const rowImb = Math.max(wMat,wAm,wNuit)-Math.min(wMat,wAm,wNuit)>numWeeks*0.4;
                    return(
                      <tr key={op.id} style={{borderBottom:"1px solid #f0f0f0",background:rowImb?"#fffde7":i%2===0?"#fff":"#fafafa"}}>
                        <td style={{padding:"6px 14px",position:"sticky",left:0,background:rowImb?"#fffde7":i%2===0?"#fff":"#fafafa",zIndex:1,borderRight:"2px solid #e0e0e0",whiteSpace:"nowrap"}}>
                          <div style={{fontWeight:500,fontSize:12}}>{op.full}</div>
                          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                            <span style={{background:lv.bg,color:lv.color,borderRadius:3,padding:"0 5px",fontSize:9,fontWeight:700}}>{op.level}</span>
                            <span style={{fontSize:10,color:"#888"}}>M:{wMat} AM:{wAm} N:{wNuit}</span>
                            {rowImb&&<span style={{fontSize:9,color:"#e65100",fontWeight:600}}>⚠</span>}
                          </div>
                        </td>
                        {schedules.map(sc=>{
                          // Déterminer le poste
                          let shiftKey=null;
                          if(sc.matin.includes(op.short))      shiftKey="matin";
                          else if(sc.am.includes(op.short))    shiftKey="am";
                          else if(sc.nuit.includes(op.short))  shiftKey="nuit";

                          // Déterminer l'absence
                          const isFullAbs = (absences[sc.s]||[]).some(e=>!e.includes("|")&&e===op.short);
                          const isFullLeave = (leaves[sc.s]||[]).some(e=>e===op.short||e.startsWith(op.short+":"));
                          const isAbsent = isFullAbs||isFullLeave;
                          const isLocked = isWeekLocked(sc.s);
                          const isCurrent = sc.s===currentWeek;

                          let bg="#f5f5f5",tc="#bbb",label="—";
                          if(isAbsent&&!shiftKey){bg="#FDECEA";tc="#B71C1C";label="ABS";}
                          else if(shiftKey==="matin"){bg="#D6EFD8";tc="#1B5E20";label="M";}
                          else if(shiftKey==="am")   {bg="#FFF9C4";tc="#F57F17";label="AM";}
                          else if(shiftKey==="nuit")  {bg="#BBDEFB";tc="#0D47A1";label="N";}

                          return(
                            <td key={sc.s} style={{padding:"4px 4px",textAlign:"center",
                              borderLeft:"1px solid #f0f0f0",
                              background:isCurrent?"#f9fbf7":isLocked?"#fafafa":"transparent",
                              opacity:isLocked&&!shiftKey&&!isAbsent?.6:1}}>
                              <span style={{display:"inline-block",background:bg,color:tc,
                                borderRadius:4,padding:"3px 5px",fontSize:10,fontWeight:700,
                                minWidth:26,textAlign:"center",
                                outline:isLocked?"none":`1px solid ${bg}`}}>
                                {label}
                              </span>
                            </td>
                          );
                        })}
                        <td style={{padding:"6px 10px",textAlign:"center",borderLeft:"2px solid #e0e0e0",fontSize:11}}>
                          <span style={{fontWeight:600}}>{wMat+wAm+wNuit}</span>
                          <span style={{fontSize:9,color:"#aaa",display:"block"}}>/{numWeeks}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Volants en bas */}
                  {activeOps.filter(o=>o.isVolant).map((op,i)=>{
                    const lv=LEVEL_BADGE[op.level];
                    return(
                      <tr key={op.id} style={{borderBottom:"1px solid #f0f0f0",background:"#fafafa",opacity:.8}}>
                        <td style={{padding:"6px 14px",position:"sticky",left:0,background:"#fafafa",zIndex:1,borderRight:"2px solid #e0e0e0",whiteSpace:"nowrap"}}>
                          <div style={{fontWeight:500,fontSize:12,color:"#888"}}>{op.full}</div>
                          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:2}}>
                            <span style={{background:lv.bg,color:lv.color,borderRadius:3,padding:"0 5px",fontSize:9,fontWeight:700}}>{op.level}</span>
                            <span style={{background:"#e8f5e9",color:"#2e7d32",borderRadius:3,padding:"0 4px",fontSize:9,fontWeight:600}}>✋ Volant</span>
                          </div>
                        </td>
                        {schedules.map(sc=>{
                          let shiftKey=null;
                          if(sc.matin.includes(op.short))     shiftKey="matin";
                          else if(sc.am.includes(op.short))   shiftKey="am";
                          else if(sc.nuit.includes(op.short)) shiftKey="nuit";
                          let bg="#EDE7F6",tc="#4527A0",label="J";
                          if(shiftKey==="matin"){bg="#D6EFD8";tc="#1B5E20";label="M";}
                          else if(shiftKey==="am")  {bg="#FFF9C4";tc="#F57F17";label="AM";}
                          else if(shiftKey==="nuit") {bg="#BBDEFB";tc="#0D47A1";label="N";}
                          return(
                            <td key={sc.s} style={{padding:"4px 4px",textAlign:"center",borderLeft:"1px solid #f0f0f0"}}>
                              <span style={{display:"inline-block",background:bg,color:tc,
                                borderRadius:4,padding:"3px 5px",fontSize:10,fontWeight:700,
                                minWidth:26,textAlign:"center"}}>
                                {label}
                              </span>
                            </td>
                          );
                        })}
                        <td style={{padding:"6px 10px",textAlign:"center",borderLeft:"2px solid #e0e0e0"}}/>
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
              ℹ️ Tout opérateur actif est intégré automatiquement à l'algorithme. Avec 4 N4 actifs, l'algo tourne sur les 4 et laisse l'un d'eux en repos chaque semaine — il prend le relais dès qu'un autre est absent. Utilisez "Passer volant" pour exclure un opérateur du planning auto (glissement manuel uniquement).
              <br/>👋 <strong>Arrivée / Départ</strong> : renseignez la semaine d'embauche ou de fin de contrat — l'opérateur n'est planifié que sur sa période, et sa charge est équilibrée au prorata de sa présence. Les semaines écoulées sont archivées : un départ ne réécrit jamais l'historique (paie fiable). Préférez "Départ S" à la suppression 🗑 pour garder la trace.
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
                      <div style={{fontSize:12,color:"#888",display:"flex",alignItems:"center",gap:6}}>
                        {op.active?"Actif":"Inactif"}
                        {op.isVolant&&<span style={{background:"#e8f5e9",color:"#2e7d32",borderRadius:3,padding:"1px 5px",fontSize:10,fontWeight:600}}>✋ Volant</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {/* Fenêtre de présence : arrivée/départ en cours d'année.
                        Vide = présent toute l'année. L'algo n'affecte l'opérateur
                        que sur ses semaines de présence, et l'équité est calculée
                        au prorata (un arrivant en S40 n'est pas surchargé). */}
                    <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#888"}}>
                      <span title="Première semaine travaillée (vide = depuis S1)">Arrivée S</span>
                      <input type="number" min={1} max={52} value={op.fromWeek||""} placeholder="1"
                        onChange={e=>saveOperators(operators.map(o=>o.id===op.id?{...o,fromWeek:e.target.value?Number(e.target.value):undefined}:o))}
                        style={{width:46,padding:"3px 5px",borderRadius:5,border:"1px solid #ddd",fontSize:11}}/>
                      <span title="Dernière semaine travaillée (vide = jusqu'à S52)">Départ S</span>
                      <input type="number" min={1} max={52} value={op.toWeek||""} placeholder="52"
                        onChange={e=>saveOperators(operators.map(o=>o.id===op.id?{...o,toWeek:e.target.value?Number(e.target.value):undefined}:o))}
                        style={{width:46,padding:"3px 5px",borderRadius:5,border:"1px solid #ddd",fontSize:11}}/>
                    </div>
                    <LevelBadge level={op.level}/>
                    <button onClick={()=>toggleVolant(op.id)}
                      style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${op.isVolant?"#a5d6a7":"#ccc"}`,background:op.isVolant?"#e8f5e9":"#fff",cursor:"pointer",fontSize:12,color:op.isVolant?"#2e7d32":"#555"}}
                      title={op.isVolant?"Retirer du mode volant (réintégrer au planning automatique)":"Passer en volant (exclu du planning auto, glissement manuel uniquement)"}>
                      {op.isVolant?"✋ Volant":"Passer volant"}
                    </button>
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
