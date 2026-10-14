import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {computeForumClose,computeForumOperationSnapshot} from "../lib/motors/forum-close-v1.js";
const input=JSON.parse(fs.readFileSync(new URL("../data/monthly-close/2026-09/forum-close-source.json",import.meta.url)));
test("Forum network totals reconcile to September certified evidence",()=>{
 const x=computeForumClose(input);
 const total=x.networks.find(n=>n.id==="COMPANY");
 assert.deepEqual({quotations:total.quotations,applications:total.applications,curses:total.curses,ufis:total.ufis,approved_pending:total.approved_pending,sales_vin:total.sales_vin},{quotations:5890,applications:4846,curses:381,ufis:383,approved_pending:1826,sales_vin:1041});
});
test("network sales and UFI penetration are computed, not copied",()=>{
 const x=computeForumClose(input);
 assert.equal(x.networks[0].penetration,174/375);
 assert.equal(x.networks[1].penetration,209/666);
 assert.equal(x.networks[2].penetration,383/1041);
});
test("cohort approvals represent current cohort states, not monthly curses",()=>{
 const x=computeForumClose(input);
 const sept=x.cohorts.find(c=>c.period==="2026-09");
 assert.equal(sept.approved_pending,1826);
 assert.equal(sept.converted,339);
 assert.equal(sept.approved_pending_share,1826/5890);
 assert.notEqual(sept.converted,x.networks[2].curses);
});
test("period trend is calculated from observed counts, without false same-age comparison",()=>{
 const x=computeForumClose(input);
 assert.equal(x.signals.quotations_change,5890/7891-1);
 assert.equal(x.signals.approved_pending_pp,1826/5890-2426/7891);
 assert.equal(x.semantics.cohort_states.includes("NOT historical"),true);
});
test("fails closed on tampered sources or missing values",()=>{
 let v=structuredClone(input);v.network.OWN_STORES.ufis=175;
 assert.throws(()=>computeForumClose(v),/FORUM_CLOSE_RECONCILIATION_FAILED/);
 v=structuredClone(input);delete v.network.DEALERS.curses;
 assert.throws(()=>computeForumClose(v),/FORUM_INVALID_SOURCE/);
});

const snapshot=JSON.parse(fs.readFileSync(new URL("../data/monthly-close/2026-09/forum-operation-state-sep30.json",import.meta.url)));
test("exact September 30 operational snapshot reconciles without October cohort states",()=>{
 const x=computeForumOperationSnapshot(snapshot,"2026-09-30");
 const total=x.networks.find(n=>n.id==="COMPANY");
 assert.equal(total.operations,5675);
 assert.equal(total.applications,4674);
 assert.equal(total.approved_pending,1815);
 assert.equal(total.cursada_state,202);
 assert.equal(x.networks.find(n=>n.id==="OWN_STORES").approved_pending,773);
 assert.equal(x.networks.find(n=>n.id==="DEALERS").approved_pending,1042);
 assert.notEqual(total.approved_pending,computeForumClose(input).networks.find(n=>n.id==="COMPANY").approved_pending);
});
test("snapshot dates must match the requested cutoff and fail on tampering",()=>{
 assert.throws(()=>computeForumOperationSnapshot(snapshot,"2026-10-13"),/FORUM_EXACT_SNAPSHOT_REQUIRED/);
 const altered=structuredClone(snapshot);altered.network.OWN_STORES.states.APROBADA++;
 assert.throws(()=>computeForumOperationSnapshot(altered,"2026-09-30"),/FORUM_DAILY_OPERATION_COUNT_RECONCILIATION_FAILED/);
});

test("January through September quotation volumes and executed UFIs are exhaustive",()=>{
 const result=computeForumClose(input);
 assert.deepEqual(result.quotation_volume_history.map(x=>x.period),["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"]);
 assert.deepEqual(result.event_trend.map(x=>x.period),result.quotation_volume_history.map(x=>x.period));
 assert.equal(result.quotation_volume_history[0].quotations,4510);
 assert.equal(result.quotation_volume_history.at(-1).quotations,5675);
 assert.equal(result.event_trend[0].ufis,266);
 assert.equal(result.event_trend.at(-1).ufis,383);
 assert.equal(result.quotation_volume_history.at(-1).quotations,computeForumOperationSnapshot(snapshot,"2026-09-30").networks.find(x=>x.id==="COMPANY").operations);
});
test("rejects tampered history, avoids inventing historical approval snapshots",()=>{
 const bad=structuredClone(input);bad.quotation_volume_history.pop();
 assert.throws(()=>computeForumClose(bad),/FORUM_QUOTATION_HISTORY_INCOMPLETE/);
 assert.equal(input.history_semantics.month_end_state.includes("Only 2026-09-30"),true);
});
