// Legacy motor regression fixture only; current Azure certification is tested separately.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {calculateAllRankings,evaluateRanking,rankPerformance,MONTHS} from "../lib/motors/ranking-performance-v1.js";
const dataset=JSON.parse(fs.readFileSync(new URL("./fixtures/legacy-performance-ranking.json",import.meta.url)));
test("legacy dealer fixture monthly totals reconcile",()=>{
 const result=calculateAllRankings(dataset);
 const totals=Object.fromEntries(MONTHS.map(m=>[m,result.category_results.dealers.observations.reduce((n,r)=>n+r.months[m],0)]));
 assert.deepEqual(totals,{"2026-06":514,"2026-07":491,"2026-08":646,"2026-09":666});
});
test("CURIFOR is down relative to three-month average, never +305% Q3/Q2",()=>{
 const result=calculateAllRankings(dataset).category_results.dealers;
 const curifor=result.observations.find(r=>r.name==="CURIFOR");
 assert.equal(curifor.vin,8);
 assert.ok(Math.abs(curifor.prior_avg-74/3)<1e-9);
 assert.ok(Math.abs(curifor.delta_vin+50/3)<1e-9);
 assert.ok(result.declining.some(r=>r.name==="CURIFOR"));
 assert.ok(!result.improving.some(r=>r.name==="CURIFOR"));
});
test("positive ranking orders by absolute VIN contribution, not percentage",()=>{
 const result=calculateAllRankings(dataset).category_results.dealers;
 assert.equal(result.positive[0].name,"ROSSELOT");
 assert.equal(result.positive[1].name,"CARMONA Y CIA");
});
test("low-volume, new, and partial histories do not generate false highlights",()=>{
 const result=calculateAllRankings(dataset);
 assert.equal(result.category_results.dealers.positive.some(r=>r.name==="SOCIEDAD REAL Y CIA"),false);
 assert.equal(result.category_results.dealers.positive.some(r=>r.name==="CURIFOR"),false);
 assert.ok(result.category_results.sellers.observations.every(r=>r.identity==="ACTIVE_PERSONA_ID"));
});
test("missing months and negative VIN must fail closed",()=>{
 assert.throws(()=>evaluateRanking([{id:"a",name:"A",months:{"2026-06":2,"2026-07":5,"2026-08":2}}]),/RANKING_MONTHLY_VIN_INVALID/);
 assert.throws(()=>evaluateRanking([{id:"a",name:"A",months:Object.fromEntries(MONTHS.map(m=>[m,-1]))}]),/RANKING_MONTHLY_VIN_INVALID/);
 assert.throws(()=>evaluateRanking([{id:"a",name:"A",months:Object.fromEntries(MONTHS.map(m=>[m,3]))},{id:"a",name:"B",months:Object.fromEntries(MONTHS.map(m=>[m,4]))}]),/RANKING_DUPLICATE/);
});
test("tampered dealer source must not be published",()=>{
 const altered=structuredClone(dataset);
 altered.categories.dealers[0].months["2026-09"]++;
 assert.throws(()=>calculateAllRankings(altered),/RANKING_VIN_RECONCILIATION_FAILED:dealers/);
});

test("Alameda +3 VIN is stable while Bellavista materially improves",()=>{
 const rows=calculateAllRankings(dataset).category_results.stores.observations;
 assert.equal(rows.find(r=>r.name==="CIDEF Mall Alameda").performance_status,"STABLE");
 assert.equal(rows.find(r=>r.name==="CIDEF Bellavista").performance_status,"IMPROVING");
});
test("minimum absolute AND relative thresholds must both hold",()=>{
 const rows=[
  {id:"a",name:"Low absolute",months:{"2026-06":20,"2026-07":20,"2026-08":20,"2026-09":24}},
  {id:"b",name:"Low relative",months:{"2026-06":100,"2026-07":100,"2026-08":100,"2026-09":107}},
  {id:"c",name:"Material",months:{"2026-06":20,"2026-07":20,"2026-08":20,"2026-09":26}},
  {id:"d",name:"Declining to zero",months:{"2026-06":20,"2026-07":20,"2026-08":20,"2026-09":0}}
 ];
 const results=rankPerformance(rows);
 assert.deepEqual(results.observations.map(r=>r.performance_status),["STABLE","STABLE","IMPROVING","DECLINING"]);
 assert.equal(results.declining[0].vin,0);
 assert.equal(results.stable.length,2);
});
test("stable is ordered by September VIN, classifications are exhaustive",()=>{
 for(const key of ["stores","dealers","models"]){
  const r=calculateAllRankings(dataset).category_results[key];
  assert.equal(Object.values(r.counts).reduce((a,b)=>a+b,0),r.observations.length);
  assert.ok(r.stable.every((x,i)=>i===0||r.stable[i-1].vin>=x.vin));
 }
});

test("only active roster is present with linked first-sale evidence",()=>{
 const r=calculateAllRankings(dataset).category_results.sellers;
 assert.equal(r.observations.length,dataset.method.active_sellers_expected_count);
 assert.equal(new Set(r.observations.map(x=>x.id)).size,r.observations.length);
 assert.ok(r.observations.every(x=>x.identity==="ACTIVE_PERSONA_ID"));
});
test("seller source VIN totals reconcile for each month",()=>{
 const r=calculateAllRankings(dataset).category_results.sellers;
 for(const m of MONTHS){
  assert.equal(r.observations.reduce((sum,x)=>sum+x.months[m],0),dataset.method.sellers_expected_monthly_totals[m]);
 }
});
test("new sellers cannot be published as dramatic improvement",()=>{
 const r=calculateAllRankings(dataset).category_results.sellers;
 for(const x of r.observations.filter(x=>!x.first_sale_observed || x.first_sale_observed >= MONTHS[0]+"-01")){
  assert.equal(x.performance_status,"UNCLASSIFIED");
  assert.ok(!r.improving.some(y=>y.id===x.id));
 }
});
test("seller 5 VIN monthly baseline is separate from company-wide 10 VIN minimum",()=>{
 const records=[{id:"new",name:"New",first_sale_observed:"2026-07-01",months:{"2026-06":6,"2026-07":6,"2026-08":6,"2026-09":20}},
  {id:"old",name:"Old",first_sale_observed:"2025-01-10",months:{"2026-06":6,"2026-07":6,"2026-08":6,"2026-09":20}}];
 const r=rankPerformance(records,{policy:{...calculateAllRankings(dataset).policy,minimumPriorAverage:5,requireFirstSaleBeforeHistory:true}});
 assert.equal(r.observations[0].performance_status,"UNCLASSIFIED");
 assert.equal(r.observations[0].excluded_reason,"INSUFFICIENT_OBSERVED_TENURE");
 assert.equal(r.observations[1].performance_status,"IMPROVING");
});
test("altered active seller totals must fail reconciliation",()=>{
 const altered=structuredClone(dataset);
 altered.categories.sellers[0].months["2026-09"]++;
 assert.throws(()=>calculateAllRankings(altered),/RANKING_VIN_RECONCILIATION_FAILED:sellers/);
});

