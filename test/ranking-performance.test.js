import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {calculateAllRankings,evaluateRanking,rankPerformance,MONTHS} from "../lib/motors/ranking-performance-v1.js";
const dataset=JSON.parse(fs.readFileSync(new URL("../data/monthly-close/2026-09/performance-ranking.json",import.meta.url)));
test("four-month dealer universe reconciles to certified SALES totals",()=>{
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
 assert.deepEqual(result.category_results.sellers.positive,[]);
});
test("missing months and negative VIN must fail closed",()=>{
 assert.throws(()=>evaluateRanking([{id:"a",name:"A",months:{"2026-06":2,"2026-07":5,"2026-08":2}}]),/RANKING_MONTHLY_VIN_INVALID/);
 assert.throws(()=>evaluateRanking([{id:"a",name:"A",months:Object.fromEntries(MONTHS.map(m=>[m,-1]))}]),/RANKING_MONTHLY_VIN_INVALID/);
 assert.throws(()=>evaluateRanking([{id:"a",name:"A",months:Object.fromEntries(MONTHS.map(m=>[m,3]))},{id:"a",name:"B",months:Object.fromEntries(MONTHS.map(m=>[m,4]))}]),/RANKING_DUPLICATE/);
});
test("tampered dealer source must not be published",()=>{
 const altered=structuredClone(dataset);
 altered.categories.dealers[0].months["2026-09"]++;
 assert.throws(()=>calculateAllRankings(altered),/DEALER_VIN_RECONCILIATION_FAILED/);
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
