// FORUM month-close analytics: deterministic transformations of certified source observations.
export const FORUM_CLOSE_VERSION="1.0.0";
const required=["quotations","applications","curses","ufis","approved_pending","sales_vin"];
const check=(v,label)=>{if(!Number.isInteger(v)||v<0)throw new Error("FORUM_INVALID_SOURCE:"+label);return v;};
const ratio=(n,d)=>d>0?n/d:null;
const diff=(current,previous)=>previous>0?(current-previous)/previous:null;
const add=(a,b)=>a+b;
export function computeForumClose(source){
 if(!source||!/^\d{4}-\d{2}$/.test(source.period)||!Array.isArray(source.cohorts)||!Array.isArray(source.event_trend))throw new Error("FORUM_CLOSE_INPUT_INVALID");
 const own=source.network?.OWN_STORES,dealer=source.network?.DEALERS;
 if(!own||!dealer)throw new Error("FORUM_NETWORK_MISSING");
 for(const [key,obj] of [["OWN_STORES",own],["DEALERS",dealer]])for(const k of required)check(obj[k],key+":"+k);
 const total=Object.fromEntries(required.map(k=>[k,add(own[k],dealer[k])]));
 for(const row of source.cohorts)for(const key of ["quotations","applications","approved_pending","converted"])check(row[key],"COHORT:"+row.period+":"+key);
 for(const row of source.event_trend)for(const key of ["curses","ufis"])check(row[key],"EVENT:"+row.period+":"+key);
 if(source.cohorts.length!==new Set(source.cohorts.map(x=>x.period)).size)throw new Error("FORUM_DUPLICATE_COHORT");
 if(source.event_trend.length!==new Set(source.event_trend.map(x=>x.period)).size)throw new Error("FORUM_DUPLICATE_EVENT_MONTH");
 const end=source.cohorts.find(r=>r.period===source.period);
 const eventEnd=source.event_trend.find(r=>r.period===source.period);
 if(!end||!eventEnd||["quotations","applications","approved_pending"].some(k=>end[k]!==total[k])||eventEnd.curses!==total.curses||eventEnd.ufis!==total.ufis)throw new Error("FORUM_CLOSE_RECONCILIATION_FAILED");
 const networks=[["OWN_STORES","Tiendas propias",own],["DEALERS","Dealers",dealer],["COMPANY","CIDEF total",total]].map(([id,label,x])=>({...x,id,label,penetration:ratio(x.ufis,x.sales_vin),approved_pending_share:ratio(x.approved_pending,x.quotations)}));
 const cohortRows=source.cohorts.map(x=>({...x,approved_pending_share:ratio(x.approved_pending,x.quotations),converted_share:ratio(x.converted,x.quotations),application_share:ratio(x.applications,x.quotations)}));
 const previous=cohortRows[cohortRows.findIndex(x=>x.period===source.period)-1]??null;
 const signals=previous?{
  quotations_change:diff(end.quotations,previous.quotations),
  applications_change:diff(end.applications,previous.applications),
  approved_pending_change:diff(end.approved_pending,previous.approved_pending),
  approved_pending_pp:ratio(end.approved_pending,end.quotations)-ratio(previous.approved_pending,previous.quotations),
  converted_change:diff(end.converted,previous.converted)
 }:null;
 return {version:FORUM_CLOSE_VERSION,period:source.period,event_cutoff:source.event_cutoff,observed_at:source.observed_at,
  semantics:source.semantics,networks,cohorts:cohortRows,event_trend:source.event_trend,signals};
}
