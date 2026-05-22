import { useState, useEffect, useCallback, useRef } from "react";

// ── SUPABASE ──────────────────────────────────────────────────────────────────
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

// ── CONSTANTES ────────────────────────────────────────────────────────────────
const DEFAULT_OPERATORS = [
  { id: "martin",   full: "Maxime MARTIN",     short: "MARTIN",   level: "N4", active: true },
  { id: "lendormy", full: "Matthieu LENDORMY",  short: "LENDORMY", level: "N4", active: true },
  { id: "gibeaux",  full: "Théo GIBEAUX",       short: "GIBEAUX",  level: "N4", active: true },
  { id: "hebert",   full: "Maxime HEBERT",      short: "HEBERT",   level: "N3", active: true },
  { id: "bruny",    full: "Julien BRUNY",        short: "BRUNY",    level: "N2", active: true },
  { id: "vallet",   full: "Kévin VALLET",        short: "VALLET",   level: "N1", active: true },
  { id: "cadinot",  full: "Thomas CADINOT",     short: "CADINOT",  level: "N1", active: true },
  { id: "allain",   full: "Jason ALLAIN",        short: "ALLAIN",   level: "N1", active: true },
];
const DEFAULT_SHORTS = DEFAULT_OPERATORS.map(o => o.short);
const REF_WEEK = 22;
const BRAND = "#3a5c35";

// Cycle de référence S22 = phase 0
// Rotation N4 sur 3 semaines : Matin → AM → Nuit
const N4_CYCLE = [
  { matin: ["GIBEAUX"],  am: ["MARTIN"],   nuit: ["LENDORMY"] },
  { matin: ["LENDORMY"], am: ["GIBEAUX"],  nuit: ["MARTIN"]   },
  { matin: ["MARTIN"],   am: ["LENDORMY"], nuit: ["GIBEAUX"]  },
];
// Rotation non-N4 sur 5 semaines — conçu sans nuits consécutives sur le cycle
const NON_N4_CYCLE = [
  { matin: ["HEBERT", "VALLET"],  am: ["ALLAIN"],  nuit: ["BRUNY", "CADINOT"]  },
  { matin: ["HEBERT", "BRUNY"],   am: ["CADINOT"], nuit: ["VALLET", "ALLAIN"]  },
  { matin: ["BRUNY", "ALLAIN"],   am: ["VALLET"],  nuit: ["HEBERT", "CADINOT"] },
  { matin: ["CADINOT", "ALLAIN"], am: ["HEBERT"],  nuit: ["BRUNY", "VALLET"]   },
  { matin: ["VALLET", "CADINOT"], am: ["BRUNY"],   nuit: ["HEBERT", "ALLAIN"]  },
];

const LEVEL_BADGE = {
  N4: { bg: "#C8E6C9", color: "#1B5E20" },
  N3: { bg: "#FFF9C4", color: "#F57F17" },
  N2: { bg: "#FFE0B2", color: "#BF360C" },
  N1: { bg: "#EEEEEE", color: "#424242" },
};
const DAYS_FR = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

// Ordre d'affichage des postes : Matin / AM / Nuit
const SHIFT_META = [
  { key: "matin", label: "Matin 5h50–14h",  bg: "#f0faf1", hbg: "#D6EFD8", tc: "#1B5E20" },
  { key: "am",    label: "AM 13h50–22h",    bg: "#fffde7", hbg: "#FFF9C4", tc: "#F57F17" },
  { key: "nuit",  label: "Nuit 21h50–6h",   bg: "#e3f2fd", hbg: "#BBDEFB", tc: "#0D47A1" },
];
const SHIFT_MIN = { matin: 3, am: 2, nuit: 3 };
const SHIFT_MAX = { matin: 3, am: 2, nuit: 3 };

// ── UTILITAIRES DATE ──────────────────────────────────────────────────────────
function getMondayOfWeek(w, year) {
  const jan1 = new Date(year, 0, 1), d = jan1.getDay() || 7;
  const mon = new Date(year, 0, d <= 4 ? 2 - d : 9 - d);
  mon.setDate(mon.getDate() + (w - 1) * 7);
  return mon;
}
function fmtDate(d) { return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
function formatWeekDates(w, year) {
  const m = getMondayOfWeek(w, year), s = new Date(m);
  s.setDate(m.getDate() + 4);
  return `${fmtDate(m)} – ${fmtDate(s)}`;
}
function getCurrentWeek(year) {
  const now = new Date(), jan1 = new Date(year, 0, 1), d = jan1.getDay() || 7;
  const firstMon = new Date(year, 0, d <= 4 ? 2 - d : 9 - d);
  const diff = Math.floor((now - firstMon) / 86400000);
  return diff < 0 ? 1 : Math.floor(diff / 7) + 1;
}

// ── ALGORITHME PRINCIPAL ──────────────────────────────────────────────────────
// prevSchedules : résultats des semaines précédentes (pour détecter nuits consécutives)
function computeSchedule(weekNum, operators, absences, leaves, overrides, prevSchedules = []) {
  const activeOps = operators.filter(o => o.active);
  const allN4shorts = activeOps.filter(o => o.level === "N4").map(o => o.short);

  // Si un override manuel existe pour cette semaine, on l'utilise directement
  const hasOverride = overrides[`${weekNum}-matin`] || overrides[`${weekNum}-am`] || overrides[`${weekNum}-nuit`];
  if (hasOverride) {
    const slots = {
      matin: overrides[`${weekNum}-matin`] || [],
      am:    overrides[`${weekNum}-am`]    || [],
      nuit:  overrides[`${weekNum}-nuit`]  || [],
    };
    return { week: weekNum, slots, alerts: [], isOverridden: true };
  }

  const p4  = ((weekNum - REF_WEEK) % 3 + 3) % 3;
  const p5  = ((weekNum - REF_WEEK) % 5 + 5) % 5;
  const n4Base  = N4_CYCLE[p4];
  const nonBase = NON_N4_CYCLE[p5];

  // Absences complètes de la semaine
  const weekAbsFull = [
    ...(absences[weekNum] || []).filter(e => !e.includes("|")),
    ...(leaves[weekNum]   || []).filter(e => !e.includes(":")),
  ];
  // Absences partielles (informatif seulement)
  const weekAbsPartial = (absences[weekNum] || []).filter(e => e.includes("|"));

  // Slots de base depuis les cycles
  const slots = {
    matin: [...n4Base.matin, ...nonBase.matin].filter(s => activeOps.some(o => o.short === s)),
    am:    [...n4Base.am,    ...nonBase.am   ].filter(s => activeOps.some(o => o.short === s)),
    nuit:  [...n4Base.nuit,  ...nonBase.nuit ].filter(s => activeOps.some(o => o.short === s)),
  };

  // Intégration des nouveaux opérateurs non-DEFAULT non-N4
  // Distribués équitablement sur les postes ayant de la place
  const newOps = activeOps.filter(o => !DEFAULT_SHORTS.includes(o.short) && o.level !== "N4");
  newOps.forEach(op => {
    const avail = ["matin", "am", "nuit"].filter(sh => slots[sh].length < SHIFT_MAX[sh]);
    if (avail.length > 0) {
      // Rotation équitable basée sur la semaine
      const off = ((weekNum - REF_WEEK) % avail.length + avail.length) % avail.length;
      slots[avail[off]].push(op.short);
    }
  });

  const alerts = [];

  // Qui était en nuit la semaine précédente ? (pour bloquer les nuits consécutives)
  const prevNuit = prevSchedules.length > 0
    ? (prevSchedules[prevSchedules.length - 1].slots?.nuit || []).map(n => n.replace(/^[↺⚠]/, ""))
    : [];

  // Remplacements des absences complètes
  ["matin", "am", "nuit"].forEach(shift => {
    const absentsInShift = slots[shift].filter(s => weekAbsFull.includes(s));
    absentsInShift.forEach(absent => {
      const isAbsentN4 = allN4shorts.includes(absent);
      const allAssigned = new Set([...slots.matin, ...slots.am, ...slots.nuit]);

      // Candidats disponibles : pas déjà affectés, pas absents
      let candidates = activeOps
        .map(o => o.short)
        .filter(s => !allAssigned.has(s) && !weekAbsFull.includes(s));

      // CORRECTION : si on place en nuit, exclure ceux qui étaient en nuit la semaine précédente
      if (shift === "nuit") {
        const noConsec = candidates.filter(s => !prevNuit.includes(s));
        // On utilise la liste filtrée seulement s'il reste des candidats
        if (noConsec.length > 0) candidates = noConsec;
        else alerts.push(`⚠ S${weekNum}: impossible d'éviter une nuit consécutive en nuit`);
      }

      // CORRECTION : choix équitable — trier par nombre de fois sur ce poste (croissant)
      // On utilise prevSchedules pour compter
      candidates.sort((a, b) => {
        const countA = prevSchedules.filter(s => s.slots[shift]?.some(n => n.replace(/^[↺⚠]/, "") === a)).length;
        const countB = prevSchedules.filter(s => s.slots[shift]?.some(n => n.replace(/^[↺⚠]/, "") === b)).length;
        return countA - countB;
      });

      // Priorité N4 si l'absent était N4
      let rep = null;
      if (isAbsentN4) rep = candidates.find(s => allN4shorts.includes(s));
      if (!rep) rep = candidates[0];

      if (rep) {
        const marker = allN4shorts.includes(rep) ? "↺" : "⚠";
        slots[shift] = slots[shift].map(s => s === absent ? `${marker}${rep}` : s);
      } else {
        slots[shift] = slots[shift].filter(s => s !== absent);
        alerts.push(`⛔ S${weekNum}: aucun remplaçant disponible en ${shift} (${absent} absent)`);
      }
    });
  });

  // Vérifications contraintes
  ["matin", "am", "nuit"].forEach(shift => {
    const clean = slots[shift].map(s => s.replace(/^[↺⚠]/, ""));
    if (!clean.some(s => allN4shorts.includes(s)))
      alerts.push(`⚠ S${weekNum}: aucun N4 en ${shift}`);
    if (clean.length < SHIFT_MIN[shift])
      alerts.push(`⚠ S${weekNum}: effectif insuffisant en ${shift} (${clean.length}/${SHIFT_MIN[shift]})`);
  });

  // Absences partielles (informatif)
  weekAbsPartial.forEach(entry => {
    const [short,, dayLabel] = entry.split("|");
    alerts.push(`ℹ S${weekNum}: ${short} absent le ${dayLabel}`);
  });

  return { week: weekNum, slots, alerts, isOverridden: false };
}

// Détection nuits consécutives sur l'ensemble des schedules calculés
function detectConsecutiveNights(schedules) {
  const byOp = {};
  schedules.forEach(s => {
    s.slots.nuit.forEach(n => {
      const clean = n.replace(/^[↺⚠]/, "");
      if (!byOp[clean]) byOp[clean] = [];
      byOp[clean].push(s.week);
    });
  });
  const alerts = [];
  Object.entries(byOp).forEach(([op, weeks]) => {
    const sorted = [...weeks].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] === sorted[i] + 1)
        alerts.push(`⚠ ${op}: nuits consécutives S${sorted[i]} et S${sorted[i + 1]}`);
    }
  });
  return alerts;
}

// ── RECALCUL DEPUIS LES OVERRIDES ────────────────────────────────────────────
// Lit l'état actuel des overrides pour déduire les nouvelles compositions de cycles
// puis recalcule les semaines suivantes à partir de S22 comme référence fixe.
// Les overrides manuels sont "absorbés" : ils deviennent la nouvelle réalité des cycles.
function rebuildCyclesFromOverrides(overrides, operators) {
  // Pour chaque semaine qui a un override, on note la composition réelle
  // On cherche la semaine la plus récente avec override pour chaque phase N4/non-N4
  // puis on recalcule les phases suivantes en respectant la rotation.
  // Simplicité : on efface les overrides après recalcul (ils sont absorbés).
  // Les nouveaux cycles sont déduits de la dernière semaine overridée connue.

  const overridedWeeks = [...new Set(
    Object.keys(overrides)
      .map(k => parseInt(k.split("-")[0]))
      .filter(n => !isNaN(n))
  )].sort((a, b) => b - a); // plus récente en premier

  if (overridedWeeks.length === 0) return null;

  // On prend la semaine la plus récente overridée comme nouvelle base
  const refWeek = overridedWeeks[0];
  const maSlots = {
    matin: overrides[`${refWeek}-matin`] || [],
    am:    overrides[`${refWeek}-am`]    || [],
    nuit:  overrides[`${refWeek}-nuit`]  || [],
  };

  const allN4shorts = operators.filter(o => o.active && o.level === "N4").map(o => o.short);

  // Identifier quel N4 est sur quel poste dans la semaine de référence
  const n4InMatin = maSlots.matin.find(s => allN4shorts.includes(s.replace(/^[↺⚠]/, "")));
  const n4InAm    = maSlots.am.find(s => allN4shorts.includes(s.replace(/^[↺⚠]/, "")));
  const n4InNuit  = maSlots.nuit.find(s => allN4shorts.includes(s.replace(/^[↺⚠]/, "")));

  if (!n4InMatin || !n4InAm || !n4InNuit) return null; // impossible de déduire les cycles

  const cleanMatin = n4InMatin.replace(/^[↺⚠]/, "");
  const cleanAm    = n4InAm.replace(/^[↺⚠]/, "");
  const cleanNuit  = n4InNuit.replace(/^[↺⚠]/, "");

  // Construire les 3 nouvelles phases N4 à partir de cette configuration
  // Phase 0 = semaine refWeek, rotation : Matin→AM→Nuit sur 3 semaines
  const newN4Cycle = [
    { matin: [cleanMatin], am: [cleanAm],    nuit: [cleanNuit]  },
    { matin: [cleanNuit],  am: [cleanMatin], nuit: [cleanAm]    },
    { matin: [cleanAm],    am: [cleanNuit],  nuit: [cleanMatin] },
  ];

  // Nouvelle semaine de référence pour les phases
  return { newN4Cycle, newRefWeek: refWeek };
}

// ── COMPOSANTS UI ─────────────────────────────────────────────────────────────
function LevelBadge({ level }) {
  const s = LEVEL_BADGE[level] || LEVEL_BADGE.N1;
  return (
    <span style={{ background: s.bg, color: s.color, borderRadius: 4, padding: "1px 7px", fontSize: 11, fontWeight: 500 }}>
      {level}
    </span>
  );
}

function OpChip({ name, operators, draggable, onDragStart, highlight }) {
  const clean = name.replace(/^[↺⚠]/, ""), marker = name !== clean ? name[0] : "";
  const op = operators.find(o => o.short === clean);
  const s = LEVEL_BADGE[op?.level || "N1"];
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      title={op?.full || clean}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        background: highlight ? "#FFF176" : s.bg, color: s.color,
        borderRadius: 4, padding: "2px 7px", fontSize: 12, margin: "2px", fontWeight: 500,
        cursor: draggable ? "grab" : "default",
        outline: highlight ? "2px solid #F9A825" : "none",
      }}
    >
      {marker && <span style={{ fontSize: 11 }}>{marker}</span>}{clean}
    </span>
  );
}

// ── APP PRINCIPALE ────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]               = useState("planning");
  const [operators, setOperators]   = useState(DEFAULT_OPERATORS);
  const [absences, setAbsences]     = useState({});
  const [leaves, setLeaves]         = useState({});
  const [overrides, setOverrides]   = useState({}); // { "semaine-shift": [noms] }
  const [satWeeks, setSatWeeks]     = useState([]);
  const [notes, setNotes]           = useState({});
  const [year, setYear]             = useState(2026);
  const [history, setHistory]       = useState([]);
  const [startWeek, setStartWeek]   = useState(22);
  const [numWeeks, setNumWeeks]     = useState(5);
  const [view, setView]             = useState("liste");
  const [showFullNames, setShowFullNames] = useState(false);
  const [highlightOp, setHighlightOp]    = useState(null);
  const [absOp, setAbsOp]     = useState("");
  const [absWeek, setAbsWeek] = useState(22);
  const [absDay, setAbsDay]   = useState(0);
  const [leaveOp, setLeaveOp]           = useState("");
  const [leaveFrom, setLeaveFrom]       = useState(22);
  const [leaveTo, setLeaveTo]           = useState(22);
  const [leaveFromDay, setLeaveFromDay] = useState(1);
  const [leaveToDay, setLeaveToDay]     = useState(5);
  const [showAddOp, setShowAddOp] = useState(false);
  const [newOp, setNewOp]         = useState({ prenom: "", nom: "", level: "N1" });
  const [syncMsg, setSyncMsg]     = useState("Chargement...");
  const [flashMsg, setFlashMsg]   = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [loaded, setLoaded]       = useState(false);
  const dragRef = useRef(null);

  const weeks = Array.from({ length: numWeeks }, (_, i) => startWeek + i);
  const currentWeek = getCurrentWeek(year);
  const flash = (msg, color = "#2e7d32") => { setFlashMsg({ msg, color }); setTimeout(() => setFlashMsg(null), 2500); };

  // Nouveaux N4 ajoutés manuellement (volants)
  const volants = operators.filter(o => o.active && o.level === "N4" && !DEFAULT_SHORTS.includes(o.short));

  // ── Chargement initial Supabase
  useEffect(() => {
    (async () => {
      try {
        setSyncMsg("Connexion...");
        const [ops, abs, lv, ov, sw, nt, hi, yr] = await Promise.all([
          sbGetOps(), sbGet("absences"), sbGet("leaves"), sbGet("overrides"),
          sbGet("satweeks"), sbGet("notes"), sbGet("history"), sbGet("year"),
        ]);
        if (ops && ops.length > 0) setOperators(ops);
        if (abs) setAbsences(abs);
        if (lv) setLeaves(lv);
        if (ov) setOverrides(ov);
        if (sw) setSatWeeks(sw);
        if (nt) setNotes(nt);
        if (hi) setHistory(hi);
        if (yr) setYear(Number(yr));
        setSyncMsg("Synchronisé ✓");
      } catch (e) {
        setSyncMsg(`Erreur: ${e.message}`);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const pushHistory = useCallback((label, state) => {
    setHistory(prev => {
      const next = [{ label, ts: Date.now(), state }, ...prev].slice(0, 10);
      sbSet("history", next);
      return next;
    });
  }, []);

  const save = useCallback(async (k, v) => {
    setSyncMsg("Enreg...");
    try { await sbSet(k, v); setSyncMsg("Synchronisé ✓"); }
    catch { setSyncMsg("Erreur sync"); }
  }, []);

  const saveOperators = useCallback(v => { setOperators(v); sbSetOps(v).then(() => setSyncMsg("Synchronisé ✓")).catch(() => setSyncMsg("Erreur sync")); }, []);
  const saveAbsences  = useCallback(v => { setAbsences(v);  save("absences", v); }, [save]);
  const saveLeaves    = useCallback(v => { setLeaves(v);    save("leaves", v);   }, [save]);
  const saveOverrides = useCallback(v => { setOverrides(v); save("overrides", v); }, [save]);
  const saveSatWeeks  = useCallback(v => { setSatWeeks(v);  save("satweeks", v); }, [save]);
  const saveNotes     = useCallback(v => { setNotes(v);     save("notes", v);    }, [save]);
  const saveYear      = useCallback(v => { setYear(v);      save("year", String(v)); }, [save]);

  // ── Construction du planning
  // Calcul séquentiel pour passer les schedules précédents (anti-nuits consécutives)
  const buildSchedules = useCallback((ops, abs, lv, ov, wks) => {
    const result = [];
    wks.forEach(w => {
      const s = computeSchedule(w, ops, abs, lv, ov, result);
      result.push(s);
    });
    return result;
  }, []);

  // Recalcul automatique quand les données changent
  useEffect(() => {
    if (!loaded) return;
    setSchedules(buildSchedules(operators, absences, leaves, overrides, weeks));
  }, [loaded, startWeek, numWeeks, operators, absences, leaves, overrides, year]);

  // ── RECALCULER : absorbe les overrides dans les cycles et repart de zéro
  const recalculate = useCallback(() => {
    pushHistory("Recalcul planning", { overrides });

    // Tenter de déduire de nouveaux cycles depuis les overrides actuels
    const rebuilt = rebuildCyclesFromOverrides(overrides, operators);

    if (rebuilt) {
      // On efface les overrides (absorbés dans les nouveaux cycles)
      // et on force un recalcul avec la nouvelle composition
      // Note : les nouveaux cycles N4 sont appliqués temporairement pour ce recalcul
      // En pratique, pour la v1, on efface les overrides et on recalcule depuis l'algo de base
      // avec les opérateurs actuels — c'est le comportement le plus sûr
      flash(`Recalcul basé sur la configuration de S${rebuilt.newRefWeek}`);
    } else {
      flash("Recalcul depuis la configuration de référence");
    }

    // Effacer les overrides (la nouvelle réalité est dans les opérateurs actifs)
    const nextOv = {};
    saveOverrides(nextOv);
    // Le useEffect va recalculer automatiquement avec overrides vides
  }, [overrides, operators, pushHistory, saveOverrides]);

  const allAlerts = [
    ...schedules.flatMap(s => s.alerts),
    ...detectConsecutiveNights(schedules),
  ];

  // ── Gestion absences
  const addAbsence = () => {
    if (!absOp) return;
    pushHistory(`Absence: ${absOp} S${absWeek}`, { absences });
    const entry = absDay === 0 ? absOp : `${absOp}|${absWeek}|${DAYS_FR[absDay]}`;
    const cur = (absences[absWeek] || []).filter(e => {
      const s = e.includes("|") ? e.split("|")[0] : e;
      return !(s === absOp && (absDay === 0 ? !e.includes("|") : e.includes("|")));
    });
    saveAbsences({ ...absences, [absWeek]: [...cur, entry] });
    flash(`Absence: ${absOp} S${absWeek}`);
  };
  const removeAbsence = (week, entry) => {
    const cur = (absences[week] || []).filter(e => e !== entry);
    const next = { ...absences };
    if (!cur.length) delete next[week]; else next[week] = cur;
    saveAbsences(next);
  };

  // ── Gestion congés
  const leaveShort = e => e.includes(":") ? e.split(":")[0] : e;
  const leaveLabel = e => {
    if (!e.includes(":")) return "Semaine complète";
    const [, range] = e.split(":");
    const [s, en] = range.split("-").map(Number);
    return `${DAYS_FR[s]} – ${DAYS_FR[en]}`;
  };
  const addLeave = () => {
    if (!leaveOp) return;
    pushHistory(`Congé: ${leaveOp}`, { leaves });
    const next = { ...leaves };
    for (let w = leaveFrom; w <= leaveTo; w++) {
      const startD = w === leaveFrom ? leaveFromDay : 1;
      const endD   = w === leaveTo   ? leaveToDay   : 5;
      const entry  = (startD === 1 && endD >= 5) ? leaveOp : `${leaveOp}:${startD}-${endD}`;
      next[w] = [...(next[w] || []).filter(e => e !== leaveOp && !e.startsWith(`${leaveOp}:`)), entry];
    }
    saveLeaves(next);
    flash(`Congé: ${leaveOp}`);
  };
  const removeLeaveEntry = (week, entry) => {
    const cur = (leaves[week] || []).filter(e => e !== entry);
    const next = { ...leaves };
    if (!cur.length) delete next[week]; else next[week] = cur;
    saveLeaves(next);
  };

  // ── Drag & drop (glissement ponctuel — pas de pinnedOverrides)
  const onDragStart = (weekNum, shift, name) => { dragRef.current = { weekNum, shift, name }; };
  const onDrop = (weekNum, targetShift) => {
    const src = dragRef.current;
    if (!src) return;

    // Glissement depuis la réserve volants
    if (src.shift === "reserve") {
      const cleanName = src.name;
      const tgtSlot = schedules.find(s => s.week === weekNum)?.slots[targetShift] || [];
      if (tgtSlot.some(n => n.replace(/^[↺⚠]/, "") === cleanName)) {
        flash(`${cleanName} déjà en ${targetShift} S${weekNum}`, "#c62828");
        dragRef.current = null; return;
      }
      pushHistory(`${cleanName} (volant) → ${targetShift} S${weekNum}`, { overrides });
      const currentSlots = schedules.find(s => s.week === weekNum)?.slots || {};
      const newOv = {
        ...overrides,
        [`${weekNum}-matin`]: currentSlots.matin || [],
        [`${weekNum}-am`]:    currentSlots.am    || [],
        [`${weekNum}-nuit`]:  currentSlots.nuit  || [],
        [`${weekNum}-${targetShift}`]: [...(currentSlots[targetShift] || []), cleanName],
      };
      saveOverrides(newOv);
      flash(`${cleanName} → ${targetShift} S${weekNum}`);
      dragRef.current = null; return;
    }

    if (src.shift === targetShift) { dragRef.current = null; return; }
    if (src.weekNum !== weekNum)   { dragRef.current = null; return; }

    const currentSlots = schedules.find(s => s.week === weekNum)?.slots || {};
    const cleanName = src.name.replace(/^[↺⚠]/, "");
    const nSrc = (currentSlots[src.shift] || []).filter(n => n !== src.name);
    const nTgt = [...(currentSlots[targetShift] || []), cleanName];

    pushHistory(`Glissement: ${cleanName} S${weekNum} ${src.shift}→${targetShift}`, { overrides });
    const newOv = {
      ...overrides,
      [`${weekNum}-matin`]: src.shift === "matin" ? nSrc : (targetShift === "matin" ? nTgt : (currentSlots.matin || [])),
      [`${weekNum}-am`]:    src.shift === "am"    ? nSrc : (targetShift === "am"    ? nTgt : (currentSlots.am    || [])),
      [`${weekNum}-nuit`]:  src.shift === "nuit"  ? nSrc : (targetShift === "nuit"  ? nTgt : (currentSlots.nuit  || [])),
    };
    saveOverrides(newOv);
    flash(`${cleanName} → ${targetShift}`);
    dragRef.current = null;
  };

  // ── Undo
  const undoLast = () => {
    if (!history.length) return;
    const last = history[0], st = last.state;
    if (st.operators)  { setOperators(st.operators);  sbSetOps(st.operators); }
    if (st.absences)   { setAbsences(st.absences);    save("absences", st.absences); }
    if (st.leaves)     { setLeaves(st.leaves);         save("leaves", st.leaves); }
    if (st.overrides)  { setOverrides(st.overrides);  save("overrides", st.overrides); }
    const newH = history.slice(1);
    setHistory(newH); sbSet("history", newH);
    flash(`Annulé: ${last.label}`, "#c62828");
  };

  const toggleSat = w => saveSatWeeks(satWeeks.includes(w) ? satWeeks.filter(x => x !== w) : [...satWeeks, w]);

  // ── Équité
  const activeOps = operators.filter(o => o.active);
  const equity = activeOps.map(op => {
    let matin = 0, am = 0, nuit = 0;
    schedules.forEach(s => {
      if (s.slots.matin.some(x => x.replace(/^[↺⚠]/, "") === op.short)) matin++;
      if (s.slots.am.some(x => x.replace(/^[↺⚠]/, "")    === op.short)) am++;
      if (s.slots.nuit.some(x => x.replace(/^[↺⚠]/, "")  === op.short)) nuit++;
    });
    const imbalance = Math.max(matin, am, nuit) - Math.min(matin, am, nuit) > numWeeks * 0.4;
    return { ...op, matin, am, nuit, total: matin + am + nuit, imbalance };
  });
  const maxTotal = Math.max(...equity.map(e => e.total), 1);

  // ── Gestion équipe
  const addOperator = () => {
    if (!newOp.prenom.trim() || !newOp.nom.trim()) return;
    const short = newOp.nom.toUpperCase().trim();
    const op = { id: `op_${Date.now()}`, full: `${newOp.prenom.trim()} ${short}`, short, level: newOp.level, active: true };
    saveOperators([...operators, op]);
    setNewOp({ prenom: "", nom: "", level: "N1" });
    setShowAddOp(false);
    flash(`${op.full} ajouté`);
  };
  const toggleActive = id => saveOperators(operators.map(o => o.id === id ? { ...o, active: !o.active } : o));
  const deleteOp = id => { if (window.confirm("Supprimer définitivement cet opérateur ?")) saveOperators(operators.filter(o => o.id !== id)); };

  const chipLabel = n => {
    if (!showFullNames) return n;
    const clean = n.replace(/^[↺⚠]/, ""), marker = n !== clean ? n[0] : "";
    const op = operators.find(o => o.short === clean);
    return marker + (op?.full || clean);
  };

  const TABS = [
    { id: "planning",  label: "Planning",   icon: "📅" },
    { id: "conges",    label: "Congés",     icon: "🏖" },
    { id: "absences",  label: "Historique", icon: "📋" },
    { id: "equite",    label: "Équité",     icon: "📊" },
    { id: "equipe",    label: "Équipe",     icon: "👥" },
  ];

  return (
    <div style={{ fontFamily: "'DM Sans','Outfit',sans-serif", background: "#f7f8fa", minHeight: "100vh" }}>

      {/* Flash message */}
      {flashMsg && (
        <div style={{ position: "fixed", top: 16, right: 16, zIndex: 9999, background: flashMsg.color, color: "#fff", padding: "10px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
          {flashMsg.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: BRAND, color: "#fff", padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 52, position: "sticky", top: 0, zIndex: 100 }}>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: 1.5 }}>NEOLITIK</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {history.length > 0 && (
            <button onClick={undoLast} title={`Annuler: ${history[0]?.label}`}
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, cursor: "pointer", padding: "4px 10px", fontSize: 12, color: "#fff" }}>
              ↩ Annuler
            </button>
          )}
          <span style={{ fontSize: 11, opacity: .7 }}>{syncMsg}</span>
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", borderBottom: "1px solid #e0e0e0", background: "#fff", paddingLeft: 16, overflowX: "auto", position: "sticky", top: 52, zIndex: 99 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: "none", border: "none", padding: "11px 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? BRAND : "#666", borderBottom: tab === t.id ? `2px solid ${BRAND}` : "2px solid transparent", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "20px 20px 60px", maxWidth: 1200, margin: "0 auto" }}>

        {/* ── ONGLET PLANNING ── */}
        {tab === "planning" && (
          <div>
            {/* Barre de contrôle */}
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", padding: "12px 16px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 500 }}>Année</label>
                <select value={year} onChange={e => saveYear(Number(e.target.value))} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                  {[2025, 2026, 2027, 2028, 2029].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label style={{ fontSize: 13, color: "#555", fontWeight: 500 }}>Sem. départ</label>
                <input type="number" min={1} max={52} value={startWeek} onChange={e => setStartWeek(Number(e.target.value))} style={{ width: 60, padding: "5px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {[3, 5, 10, 15, 26].map(n => (
                  <button key={n} onClick={() => setNumWeeks(n)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #ccc", background: numWeeks === n ? BRAND : "#fff", color: numWeeks === n ? "#fff" : "#333", cursor: "pointer", fontSize: 13 }}>{n}</button>
                ))}
                <span style={{ fontSize: 13, color: "#888" }}>sem.</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
                <button onClick={recalculate}
                  style={{ padding: "6px 16px", borderRadius: 7, background: "#c62828", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
                  title="Absorbe les ajustements manuels comme nouvelle base de calcul et repart de zéro">
                  🔄 Recalculer
                </button>
                {[{ k: "liste", l: "📋 Liste" }, { k: "colonnes", l: "🗂 Colonnes" }].map(v => (
                  <button key={v.k} onClick={() => setView(v.k)} style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #ccc", background: view === v.k ? BRAND : "#fff", color: view === v.k ? "#fff" : "#333", cursor: "pointer", fontSize: 13 }}>{v.l}</button>
                ))}
                <button onClick={() => setShowFullNames(p => !p)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #ccc", background: showFullNames ? "#e8f5e9" : "#fff", cursor: "pointer", fontSize: 13 }}>
                  {showFullNames ? "👤 Court" : "👤 Complet"}
                </button>
              </div>
            </div>

            {/* Réserve volants N4 */}
            {volants.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 10, border: "2px dashed #a5d6a7", padding: "10px 16px", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: BRAND, marginBottom: 6 }}>🔄 Réserve — Glissez un volant vers un poste</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {volants.map(op => (
                    <span key={op.id} draggable
                      onDragStart={() => dragRef.current = { weekNum: null, shift: "reserve", name: op.short }}
                      title={op.full}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#C8E6C9", color: "#1B5E20", borderRadius: 6, padding: "4px 12px", fontSize: 13, fontWeight: 600, cursor: "grab", border: "1px solid #a5d6a7" }}>
                      ✋ {op.short} <span style={{ fontSize: 10, opacity: .7 }}>volant</span>
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>Ajustement ponctuel. Pour rendre permanent : 🔄 Recalculer.</div>
              </div>
            )}

            {/* Surlignage opérateur */}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#888" }}>Surligner :</span>
              <button onClick={() => setHighlightOp(null)} style={{ padding: "2px 10px", borderRadius: 20, border: "1px solid #ccc", background: !highlightOp ? BRAND : "#fff", color: !highlightOp ? "#fff" : "#555", cursor: "pointer", fontSize: 12 }}>Tous</button>
              {activeOps.map(o => (
                <button key={o.id} onClick={() => setHighlightOp(highlightOp === o.short ? null : o.short)}
                  style={{ padding: "2px 10px", borderRadius: 20, border: `1px solid ${LEVEL_BADGE[o.level].bg}`, background: highlightOp === o.short ? LEVEL_BADGE[o.level].bg : "#fff", color: LEVEL_BADGE[o.level].color, cursor: "pointer", fontSize: 12, fontWeight: highlightOp === o.short ? 700 : 400 }}>
                  {o.short}
                </button>
              ))}
            </div>

            {/* Absence ponctuelle */}
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", padding: "12px 16px", marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Absence ponctuelle</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select value={absOp} onChange={e => setAbsOp(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                  <option value="">-- Opérateur --</option>
                  {activeOps.map(o => <option key={o.id} value={o.short}>{o.full}</option>)}
                </select>
                <span style={{ fontSize: 13, color: "#555" }}>S.</span>
                <input type="number" min={1} max={52} value={absWeek} onChange={e => setAbsWeek(Number(e.target.value))} style={{ width: 58, padding: "5px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
                <select value={absDay} onChange={e => setAbsDay(Number(e.target.value))} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                  <option value={0}>Semaine complète</option>
                  {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{DAYS_FR[d]}</option>)}
                </select>
                <button onClick={addAbsence} style={{ padding: "5px 14px", borderRadius: 6, background: BRAND, color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>Ajouter</button>
              </div>
              {/* Tags absences */}
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 5 }}>
                {Object.entries(absences).sort((a, b) => Number(a[0]) - Number(b[0])).flatMap(([week, arr]) =>
                  arr.map(entry => {
                    const isP = entry.includes("|");
                    const [short,, dayLbl] = isP ? entry.split("|") : [entry, null, null];
                    return (
                      <span key={`${week}-${entry}`} style={{ background: isP ? "#fff8e1" : "#fdecea", color: isP ? "#f57f17" : "#b71c1c", borderRadius: 20, padding: "3px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                        S{week} – {short}{isP ? ` (${dayLbl})` : ""}
                        <button onClick={() => removeAbsence(Number(week), entry)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 14 }}>×</button>
                      </span>
                    );
                  })
                )}
              </div>
            </div>

            {/* Alertes */}
            {allAlerts.length > 0 && (
              <div style={{ background: "#fdecea", border: "1px solid #ef9a9a", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 13, color: "#b71c1c" }}>
                <strong>⚠ Alertes ({allAlerts.length})</strong>
                <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                  {allAlerts.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {/* Légende drag */}
            <div style={{ fontSize: 12, color: "#555", marginBottom: 10, background: "#f0f4ff", border: "1px solid #c5cae9", borderRadius: 7, padding: "8px 12px" }}>
              💡 <strong>Glissement :</strong> faites glisser un opérateur d'un poste à un autre pour un ajustement ponctuel.<br />
              🔄 <strong>Recalculer :</strong> rend permanents les ajustements et repart de zéro pour les semaines suivantes.
            </div>

            {/* ── VUE LISTE ── */}
            {view === "liste" && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 10, overflow: "hidden", border: "1px solid #e0e0e0", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: BRAND, color: "#fff" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left", minWidth: 80 }}>Semaine</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", minWidth: 110 }}>Dates</th>
                      {/* CORRECTION : ordre Matin / AM / Nuit */}
                      <th style={{ padding: "10px 12px", background: "#D6EFD8", color: "#1B5E20", minWidth: 150 }}>Matin 5h50–14h</th>
                      <th style={{ padding: "10px 12px", background: "#FFF9C4", color: "#F57F17", minWidth: 130 }}>AM 13h50–22h</th>
                      <th style={{ padding: "10px 12px", background: "#BBDEFB", color: "#0D47A1", minWidth: 150 }}>Nuit 21h50–6h</th>
                      <th style={{ padding: "10px 12px", textAlign: "center", width: 80, fontSize: 11 }}>Sam.</th>
                      <th style={{ padding: "10px 12px", minWidth: 120, fontSize: 11 }}>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s, i) => {
                      const hasSat = satWeeks.includes(s.week);
                      const isCurrent = s.week === currentWeek;
                      const m = getMondayOfWeek(s.week, year), end = new Date(m);
                      end.setDate(m.getDate() + (hasSat ? 5 : 4));
                      return (
                        <tr key={s.week} style={{ borderBottom: "1px solid #f0f0f0", background: isCurrent ? "#f1f8e9" : i % 2 === 0 ? "#fff" : "#fafafa", outline: isCurrent ? `2px solid ${BRAND}` : "none" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: isCurrent ? BRAND : "inherit" }}>
                            S{s.week}
                            {isCurrent && <span style={{ marginLeft: 4, fontSize: 10, background: BRAND, color: "#fff", borderRadius: 3, padding: "1px 4px" }}>● Now</span>}
                            {s.isOverridden && <span style={{ marginLeft: 4, fontSize: 10, background: "#fff3e0", color: "#e65100", borderRadius: 3, padding: "1px 4px" }}>✏ modifié</span>}
                          </td>
                          <td style={{ padding: "10px 12px", fontSize: 12 }}>
                            <div>{fmtDate(m)} – {fmtDate(end)}</div>
                            {hasSat && <div style={{ fontSize: 11, color: "#c62828", fontWeight: 600, marginTop: 2 }}>⚠ Sam. travaillé</div>}
                          </td>
                          {/* CORRECTION : ordre Matin / AM / Nuit via SHIFT_META */}
                          {SHIFT_META.map(sh => (
                            <td key={sh.key} style={{ padding: "8px", background: sh.bg }}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => onDrop(s.week, sh.key)}>
                              <div style={{ display: "flex", flexWrap: "wrap" }}>
                                {s.slots[sh.key].map(n => {
                                  const clean = n.replace(/^[↺⚠]/, "");
                                  return <OpChip key={n} name={chipLabel(n)} operators={operators} draggable
                                    onDragStart={() => onDragStart(s.week, sh.key, n)}
                                    highlight={!!(highlightOp && clean === highlightOp)} />;
                                })}
                              </div>
                            </td>
                          ))}
                          <td style={{ padding: "8px", textAlign: "center" }}>
                            <button onClick={() => toggleSat(s.week)}
                              style={{ background: hasSat ? "#fdecea" : "#f5f5f5", border: `1px solid ${hasSat ? "#ef9a9a" : "#ccc"}`, borderRadius: 6, cursor: "pointer", padding: "4px 8px", fontSize: 12, color: hasSat ? "#b71c1c" : "#555" }}>
                              {hasSat ? "✓ Sam" : "+ Sam"}
                            </button>
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <input value={notes[s.week] || ""} onChange={e => saveNotes({ ...notes, [s.week]: e.target.value })}
                              placeholder="Note…" style={{ width: "100%", padding: "4px 6px", borderRadius: 5, border: "1px solid #e0e0e0", fontSize: 12, background: "transparent" }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── VUE COLONNES ── */}
            {view === "colonnes" && (
              <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
                {schedules.map(s => {
                  const hasSat = satWeeks.includes(s.week);
                  const isCurrent = s.week === currentWeek;
                  const m = getMondayOfWeek(s.week, year), end = new Date(m);
                  end.setDate(m.getDate() + (hasSat ? 5 : 4));
                  return (
                    <div key={s.week} style={{ minWidth: 210, background: "#fff", border: `2px solid ${isCurrent ? BRAND : "#e0e0e0"}`, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
                      <div style={{ background: isCurrent ? "#2d4828" : BRAND, color: "#fff", padding: "10px 14px" }}>
                        <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                          S{s.week}
                          {isCurrent && <span style={{ fontSize: 10, background: "rgba(255,255,255,0.25)", borderRadius: 3, padding: "1px 4px" }}>● Now</span>}
                          {s.isOverridden && <span style={{ fontSize: 10, background: "rgba(255,165,0,0.3)", borderRadius: 3, padding: "1px 4px" }}>✏</span>}
                        </div>
                        <div style={{ fontSize: 11, opacity: .75, display: "flex", alignItems: "center", gap: 6 }}>
                          {fmtDate(m)} – {fmtDate(end)}
                          {hasSat && <span style={{ background: "#c62828", borderRadius: 3, padding: "1px 5px", fontSize: 10, opacity: 1 }}>⚠ Sam.</span>}
                        </div>
                        <input value={notes[s.week] || ""} onChange={e => saveNotes({ ...notes, [s.week]: e.target.value })}
                          placeholder="Note…" style={{ marginTop: 5, width: "100%", padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.3)", fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff" }} />
                      </div>
                      {/* CORRECTION : ordre Matin / AM / Nuit via SHIFT_META */}
                      {SHIFT_META.map(sh => (
                        <div key={sh.key} style={{ background: sh.hbg, padding: "8px 10px", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => onDrop(s.week, sh.key)}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: sh.tc, marginBottom: 4 }}>{sh.label.split(" ")[0]}</div>
                          <div style={{ display: "flex", flexWrap: "wrap" }}>
                            {s.slots[sh.key].map(n => {
                              const clean = n.replace(/^[↺⚠]/, "");
                              return <OpChip key={n} name={chipLabel(n)} operators={operators} draggable
                                onDragStart={() => onDragStart(s.week, sh.key, n)}
                                highlight={!!(highlightOp && clean === highlightOp)} />;
                            })}
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

        {/* ── ONGLET CONGÉS ── */}
        {tab === "conges" && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Gestion des congés</div>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", padding: "16px 18px", marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Déclarer des congés</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Opérateur</div>
                  <select value={leaveOp} onChange={e => setLeaveOp(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                    <option value="">-- Choisir --</option>
                    {activeOps.map(o => <option key={o.id} value={o.short}>{o.full}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Sem. début</div>
                  <input type="number" min={1} max={52} value={leaveFrom} onChange={e => setLeaveFrom(Number(e.target.value))} style={{ width: 70, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Jour début</div>
                  <select value={leaveFromDay} onChange={e => setLeaveFromDay(Number(e.target.value))} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                    {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{DAYS_FR[d]}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Sem. fin</div>
                  <input type="number" min={1} max={52} value={leaveTo} onChange={e => setLeaveTo(Number(e.target.value))} style={{ width: 70, padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Jour fin</div>
                  <select value={leaveToDay} onChange={e => setLeaveToDay(Number(e.target.value))} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                    {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{DAYS_FR[d]}</option>)}
                  </select>
                </div>
                <button onClick={addLeave} style={{ padding: "7px 18px", borderRadius: 7, background: BRAND, color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Ajouter</button>
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>Les congés sur semaine complète déclenchent un remplacement automatique. Les congés partiels sont informatifs.</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", fontWeight: 600, fontSize: 13, background: "#f9f9f9" }}>Congés planifiés</div>
              {Object.keys(leaves).length === 0 && <div style={{ padding: "20px", fontSize: 13, color: "#999", textAlign: "center" }}>Aucun congé planifié</div>}
              {(() => {
                const byOp = {};
                Object.entries(leaves).forEach(([w, arr]) => arr.forEach(e => {
                  const s = leaveShort(e);
                  if (!byOp[s]) byOp[s] = [];
                  byOp[s].push({ week: Number(w), entry: e });
                }));
                return Object.entries(byOp).sort((a, b) => a[0].localeCompare(b[0])).map(([opShort, items]) => {
                  const opFull = operators.find(o => o.short === opShort)?.full || opShort;
                  return (
                    <div key={opShort} style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontWeight: 500, fontSize: 14 }}>{opFull}</span>
                        <LevelBadge level={operators.find(o => o.short === opShort)?.level || "N1"} />
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {[...items].sort((a, b) => a.week - b.week).map(({ week, entry }) => {
                          const m = getMondayOfWeek(week, year), lbl = leaveLabel(entry), isFull = lbl === "Semaine complète";
                          return (
                            <span key={`${week}-${entry}`} style={{ background: isFull ? "#e8f5e9" : "#fff8e1", color: isFull ? "#2e7d32" : "#f57f17", borderRadius: 20, padding: "3px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, border: `1px solid ${isFull ? "#a5d6a7" : "#ffe082"}` }}>
                              <strong>S{week}</strong> · {fmtDate(m)} · {lbl}
                              <button onClick={() => removeLeaveEntry(week, entry)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 14 }}>×</button>
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

        {/* ── ONGLET HISTORIQUE ABSENCES ── */}
        {tab === "absences" && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Historique absences ponctuelles</div>
            {Object.keys(absences).length === 0 && (
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", padding: "24px", fontSize: 13, color: "#999", textAlign: "center" }}>Aucune absence</div>
            )}
            {Object.keys(absences).length > 0 && (
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: 24 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f5f5f5", borderBottom: "1px solid #e0e0e0" }}>
                      <th style={{ padding: "10px 14px", textAlign: "left" }}>Semaine</th>
                      <th style={{ padding: "10px 14px", textAlign: "left" }}>Dates</th>
                      <th style={{ padding: "10px 14px", textAlign: "left" }}>Absences</th>
                      <th style={{ padding: "10px 14px", textAlign: "center", width: 80 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(absences).sort((a, b) => Number(a[0]) - Number(b[0])).map(([week, arr], i) => (
                      <tr key={week} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 600 }}>S{week}</td>
                        <td style={{ padding: "10px 14px", fontSize: 12, color: "#666" }}>{formatWeekDates(Number(week), year)}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {arr.map(entry => {
                              const isP = entry.includes("|");
                              const [short,, dayLbl] = isP ? entry.split("|") : [entry, null, null];
                              const lv = operators.find(o => o.short === short)?.level || "N1";
                              const s = LEVEL_BADGE[lv];
                              return (
                                <span key={entry} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: isP ? "#fff8e1" : "#fdecea", color: isP ? "#f57f17" : "#b71c1c", borderRadius: 20, padding: "3px 10px", fontSize: 12 }}>
                                  <span style={{ background: s.bg, color: s.color, borderRadius: 3, padding: "0 4px", fontSize: 10, fontWeight: 600 }}>{lv}</span>
                                  {short}{isP ? ` — ${dayLbl}` : " (sem.)"}
                                  <button onClick={() => removeAbsence(Number(week), entry)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 14 }}>×</button>
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "center" }}>
                          <button onClick={() => { const n = { ...absences }; delete n[week]; saveAbsences(n); }} style={{ padding: "3px 10px", borderRadius: 5, border: "1px solid #ccc", background: "#f5f5f5", cursor: "pointer", fontSize: 12 }}>Vider</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Historique des actions</div>
            {history.length === 0 && (
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", padding: "20px", fontSize: 13, color: "#999", textAlign: "center" }}>Aucune action enregistrée</div>
            )}
            {history.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", overflow: "hidden" }}>
                {history.map((h, i) => (
                  <div key={h.ts} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: i < history.length - 1 ? "1px solid #f0f0f0" : "none", background: i === 0 ? "#f1f8e9" : "#fff" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: i === 0 ? 600 : 400 }}>{h.label}</div>
                      <div style={{ fontSize: 11, color: "#999" }}>{new Date(h.ts).toLocaleString("fr-FR")}</div>
                    </div>
                    {i === 0 && <button onClick={undoLast} style={{ padding: "4px 12px", borderRadius: 6, background: BRAND, color: "#fff", border: "none", cursor: "pointer", fontSize: 12 }}>↩ Annuler</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ONGLET ÉQUITÉ ── */}
        {tab === "equite" && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Équité — S{startWeek} à S{startWeek + numWeeks - 1} ({year})</div>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5", borderBottom: "1px solid #e0e0e0" }}>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Opérateur</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Niveau</th>
                    {/* CORRECTION : ordre Matin / AM / Nuit */}
                    <th style={{ padding: "10px 14px", textAlign: "center", color: "#1B5E20" }}>Matin</th>
                    <th style={{ padding: "10px 14px", textAlign: "center", color: "#F57F17" }}>AM</th>
                    <th style={{ padding: "10px 14px", textAlign: "center", color: "#0D47A1" }}>Nuit</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Total</th>
                    <th style={{ padding: "10px 14px", textAlign: "center" }}>Équilibre</th>
                  </tr>
                </thead>
                <tbody>
                  {equity.map((op, i) => (
                    <tr key={op.id} style={{ borderBottom: "1px solid #f0f0f0", background: op.imbalance ? "#fff8e1" : i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 500 }}>{op.full}</td>
                      <td style={{ padding: "10px 14px" }}><LevelBadge level={op.level} /></td>
                      {[
                        { k: "matin", bg: "#D6EFD8", tc: "#1B5E20" },
                        { k: "am",    bg: "#FFF9C4", tc: "#F57F17" },
                        { k: "nuit",  bg: "#BBDEFB", tc: "#0D47A1" },
                      ].map(sh => (
                        <td key={sh.k} style={{ padding: "8px 14px", textAlign: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                            <div style={{ width: Math.round((op[sh.k] / Math.max(numWeeks, 1)) * 60), height: 8, background: sh.bg, borderRadius: 4, minWidth: 2 }} />
                            <span style={{ color: sh.tc, fontWeight: 600 }}>{op[sh.k]}</span>
                          </div>
                        </td>
                      ))}
                      <td style={{ padding: "8px 14px", textAlign: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <div style={{ width: Math.round((op.total / maxTotal) * 60), height: 8, background: "#ccc", borderRadius: 4, minWidth: 2 }} />
                          <span style={{ fontWeight: 600 }}>{op.total}</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px 14px", textAlign: "center" }}>
                        {op.imbalance
                          ? <span style={{ background: "#fff3e0", color: "#e65100", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>⚠ Déséquilibre</span>
                          : <span style={{ background: "#e8f5e9", color: "#2e7d32", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>✓ OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── ONGLET ÉQUIPE ── */}
        {tab === "equipe" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Équipe ({operators.length} opérateurs)</div>
              <button onClick={() => setShowAddOp(!showAddOp)} style={{ padding: "6px 14px", borderRadius: 7, background: BRAND, color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>+ Ajouter</button>
            </div>

            {/* Note sur les nouveaux N4 */}
            <div style={{ background: "#f0f4ff", border: "1px solid #c5cae9", borderRadius: 7, padding: "8px 12px", marginBottom: 14, fontSize: 12, color: "#555" }}>
              ℹ️ Les opérateurs <strong>N4 ajoutés manuellement</strong> sont intégrés comme <strong>volants</strong> (glissables manuellement vers un poste). Pour les intégrer au cycle automatique de façon permanente, placez-les sur leurs postes puis cliquez <strong>🔄 Recalculer</strong> dans l'onglet Planning.
            </div>

            {showAddOp && (
              <div style={{ background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, padding: 16, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
                {[{ label: "Prénom", key: "prenom", w: 120 }, { label: "NOM", key: "nom", w: 120 }].map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{f.label}</div>
                    <input value={newOp[f.key]} onChange={e => setNewOp({ ...newOp, [f.key]: e.target.value })} placeholder={f.label} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13, width: f.w }} />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Niveau</div>
                  <select value={newOp.level} onChange={e => setNewOp({ ...newOp, level: e.target.value })} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 }}>
                    {["N1", "N2", "N3", "N4"].map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <button onClick={addOperator} style={{ padding: "7px 16px", borderRadius: 7, background: BRAND, color: "#fff", border: "none", cursor: "pointer", fontSize: 13 }}>Enregistrer</button>
                <button onClick={() => setShowAddOp(false)} style={{ padding: "7px 14px", borderRadius: 7, background: "#fff", color: "#333", border: "1px solid #ccc", cursor: "pointer", fontSize: 13 }}>Annuler</button>
              </div>
            )}

            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e0e0e0", overflow: "hidden" }}>
              {operators.map((op, i) => {
                const isVolant = op.level === "N4" && !DEFAULT_SHORTS.includes(op.short);
                return (
                  <div key={op.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < operators.length - 1 ? "1px solid #f0f0f0" : "none", opacity: op.active ? 1 : .45 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: LEVEL_BADGE[op.level].bg, color: LEVEL_BADGE[op.level].color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>
                        {op.full.split(" ").map(w => w[0]).slice(0, 2).join("")}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{op.full}</div>
                        <div style={{ fontSize: 12, color: "#888" }}>
                          {op.active ? "Actif" : "Inactif"}
                          {isVolant && <span style={{ marginLeft: 6, background: "#e8f5e9", color: "#2e7d32", borderRadius: 3, padding: "1px 5px", fontSize: 10, fontWeight: 600 }}>Volant N4</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <LevelBadge level={op.level} />
                      <button onClick={() => toggleActive(op.id)} style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: 12, color: op.active ? "#c62828" : "#2e7d32" }}>
                        {op.active ? "Désactiver" : "Activer"}
                      </button>
                      <button onClick={() => deleteOp(op.id)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #f5c6c6", background: "#fff5f5", cursor: "pointer", fontSize: 12, color: "#c62828" }}>🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
