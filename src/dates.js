export function getMondayOfWeek(w,year){
  const jan1=new Date(year,0,1),d=jan1.getDay()||7;
  const mon=new Date(year,0,d<=4?2-d:9-d);
  mon.setDate(mon.getDate()+(w-1)*7); return mon;
}
export function fmtDate(d){return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;}
export function formatWeekDates(w,year){
  const m=getMondayOfWeek(w,year),s=new Date(m); s.setDate(m.getDate()+4);
  return `${fmtDate(m)} – ${fmtDate(s)}`;
}
export function getCurrentWeek(year){
  const current=isoWeek(new Date());
  return current.year<year?1:current.year>year?weeksInYear(year)+1:current.week;
}

export function isoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function dateOfDay(year,week,day){const date=getMondayOfWeek(week,year);date.setDate(date.getDate()+day-1);return date;}
export function isoWeek(date){
  const utc=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  utc.setUTCDate(utc.getUTCDate()+4-(utc.getUTCDay()||7));
  const year=utc.getUTCFullYear();
  return {year,week:Math.ceil((((utc-new Date(Date.UTC(year,0,1)))/86400000)+1)/7)};
}
export function weeksInYear(year){return isoWeek(new Date(year,11,28)).week;}
