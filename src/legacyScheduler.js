// Ancien moteur conservé uniquement pour la migration des semaines déjà écoulées.
const DAYS_FR = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
export function buildSchedules(operators, startWeek, numWeeks, absences, leaves, overrides, archive={}) {
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
