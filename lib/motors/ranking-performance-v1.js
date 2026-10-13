// Ranking motor v1.1: deterministic classifications, never computed by LLM.
export const VERSION = "1.1.0";
export const MONTHS = ["2026-06", "2026-07", "2026-08", "2026-09"];
export const POLICY = Object.freeze({
 minimumPriorAverage:10, minimumAbsoluteDeltaVIN:5,
 minimumRelativeDelta:0.10, topN:5
});

export function evaluateRanking(records, {months=MONTHS,policy=POLICY}={}) {
 if(!Array.isArray(records)) throw new TypeError("RANKING_INPUT_NOT_ARRAY");
 if(months.length!==4||new Set(months).size!==4) throw new Error("RANKING_MONTHS_INVALID");
 const [june,july,august,september]=months;
 const ids=new Set();
 return records.map(row=>{
  if(!row?.id||!row.name||ids.has(String(row.id))) throw new Error("RANKING_DUPLICATE_OR_MISSING_ID");
  ids.add(String(row.id));
  if(!row.months||months.some(m=>!Number.isInteger(row.months[m])||row.months[m]<0)) throw new Error("RANKING_MONTHLY_VIN_INVALID:"+row.id);
  const avg=(row.months[june]+row.months[july]+row.months[august])/3;
  const vin=row.months[september];
  const active=[june,july,august].filter(m=>row.months[m]>0).length;
  const eligible=active===3&&avg>=policy.minimumPriorAverage;
  const delta=eligible?vin-avg:null;
  const pct=eligible&&avg>0?delta/avg:null;
  const material=eligible&&Math.abs(delta)>=policy.minimumAbsoluteDeltaVIN&&Math.abs(pct)>=policy.minimumRelativeDelta;
  const status=!eligible?"UNCLASSIFIED":!material?"STABLE":delta>0?"IMPROVING":"DECLINING";
  return {...row,vin,prior_avg:avg,active_prior_months:active,eligible,
   delta_vin:delta,change_pct:pct,performance_status:status,
   excluded_reason:eligible?null:active!==3?"INSUFFICIENT_PRIOR_MONTHS":"LOW_PRIOR_VOLUME"};
 });
}

export function rankPerformance(records,opts={}) {
 const observations=evaluateRanking(records,opts);
 const policy=opts.policy??POLICY;
 const sortUp=(a,b)=>b.delta_vin-a.delta_vin||b.vin-a.vin||a.name.localeCompare(b.name,"es");
 const sortDown=(a,b)=>a.delta_vin-b.delta_vin||b.vin-a.vin||a.name.localeCompare(b.name,"es");
 const improving=observations.filter(r=>r.performance_status==="IMPROVING").sort(sortUp).slice(0,policy.topN);
 const stable=observations.filter(r=>r.performance_status==="STABLE")
  .sort((a,b)=>b.vin-a.vin||Math.abs(a.delta_vin)-Math.abs(b.delta_vin)||a.name.localeCompare(b.name,"es"))
  .slice(0,policy.topN);
 const declining=observations.filter(r=>r.performance_status==="DECLINING").sort(sortDown).slice(0,policy.topN);
 return {observations,improving,stable,declining,positive:improving,negative:declining,
  counts:Object.fromEntries(["IMPROVING","STABLE","DECLINING","UNCLASSIFIED"].map(k=>[k,observations.filter(r=>r.performance_status===k).length]))};
}

export function calculateAllRankings(snapshot,{months=MONTHS,policy=POLICY}={}) {
 if(!snapshot?.categories) throw new Error("RANKING_SOURCE_MISSING");
 const result={schema_version:"1.1",motor_version:VERSION,period:snapshot.period,months,policy,category_results:{}};
 for(const key of ["stores","dealers","models"]){
  const rows=snapshot.categories[key];
  if(!Array.isArray(rows)) throw new Error("RANKING_CATEGORY_MISSING:"+key);
  result.category_results[key]=rankPerformance(rows,{months,policy});
 }
 result.category_results.sellers={status:"UNAVAILABLE",reason:"SELLER_HISTORY_INCOMPLETE",observations:[],
  improving:[],stable:[],declining:[],positive:[],negative:[],counts:null};
 const expected=snapshot.method?.dealers_expected_totals??{"2026-06":514,"2026-07":491,"2026-08":646,"2026-09":666};
 for(const month of months){
  const sum=result.category_results.dealers.observations.reduce((n,row)=>n+row.months[month],0);
  if(sum!==expected[month]) throw new Error("DEALER_VIN_RECONCILIATION_FAILED:"+month+":"+sum+"!="+expected[month]);
 }
 return result;
}
