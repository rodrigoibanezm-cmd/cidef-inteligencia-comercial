// Ranking motor v1.1: deterministic classifications, never computed by LLM.
export const VERSION = "1.2.0";
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
  const hasFirstSale = !policy.requireFirstSaleBeforeHistory || (typeof row.first_sale_observed==="string" && /^\d{4}-\d{2}-\d{2}$/.test(row.first_sale_observed) && row.first_sale_observed < june+"-01");
  const eligible=active===3&&avg>=policy.minimumPriorAverage&&hasFirstSale;
  const delta=eligible?vin-avg:null;
  const pct=eligible&&avg>0?delta/avg:null;
  const material=eligible&&Math.abs(delta)>=policy.minimumAbsoluteDeltaVIN&&Math.abs(pct)>=policy.minimumRelativeDelta;
  const status=!eligible?"UNCLASSIFIED":!material?"STABLE":delta>0?"IMPROVING":"DECLINING";
  return {...row,vin,prior_avg:avg,active_prior_months:active,eligible,
   delta_vin:delta,change_pct:pct,performance_status:status,
   excluded_reason:eligible?null:active!==3?"INSUFFICIENT_PRIOR_MONTHS":avg<policy.minimumPriorAverage?"LOW_PRIOR_VOLUME":"INSUFFICIENT_OBSERVED_TENURE"};
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
 if(!snapshot?.categories||!snapshot?.method) throw new Error("RANKING_SOURCE_MISSING");
 const result={schema_version:"1.2",motor_version:VERSION,period:snapshot.period,months,policy,category_results:{}};
 const perCategoryPolicy={
  stores:policy,dealers:policy,models:policy,
  sellers:{...policy,minimumPriorAverage:5,requireFirstSaleBeforeHistory:true}
 };
 for(const key of Object.keys(perCategoryPolicy)){
  const rows=snapshot.categories[key];
  if(!Array.isArray(rows)) throw new Error("RANKING_CATEGORY_MISSING:"+key);
  result.category_results[key]=rankPerformance(rows,{months,policy:perCategoryPolicy[key]});
 }
 const checks=[
  ["dealers",snapshot.method.dealers_expected_totals],
  ["sellers",snapshot.method.sellers_expected_monthly_totals]
 ];
 for(const [category,expected] of checks){
  if(!expected||months.some(month=>!Number.isInteger(expected[month]))) throw new Error("RANKING_EXPECTED_TOTALS_MISSING:"+category);
  for(const month of months){
   const sum=result.category_results[category].observations.reduce((n,row)=>n+row.months[month],0);
   if(sum!==expected[month]) throw new Error("RANKING_VIN_RECONCILIATION_FAILED:"+category+":"+month+":"+sum+"!="+expected[month]);
  }
 }
 const activeExpected=snapshot.method.active_sellers_expected_count;
 if(!Number.isInteger(activeExpected)||result.category_results.sellers.observations.length!==activeExpected)
  throw new Error("ACTIVE_SELLER_UNIVERSE_RECONCILIATION_FAILED");
 return result;
}
