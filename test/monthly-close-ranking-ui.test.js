import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexedTrend, trendScale } from '../lib/monthly-close-view.js';
import { buildForumRanking } from '../lib/monthly-close-ranking.js';
import { POLICY, MONTHS, rankPerformance } from '../lib/motors/ranking-performance-v1.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const facts = JSON.parse(read('data/monthly-close/2026-09/facts.json'));
const evidence = JSON.parse(read('data/monthly-close/2026-09/certification-evidence.json'));
const source = facts.rankings.categories.forum;
const series = values => ({status:'CERTIFIED', points:values.map((value, i) => ({period:MONTHS[i], value}))});

test('card indices compare relative trajectories without changing certified absolute values', () => {
  const data = {series:{large:series([1000,1200,800,1500]), small:series([10,12,8,15])}};
  const before = JSON.stringify(data);
  const result = indexedTrend(data, {COMPANY:'large', FOTON:'small'});
  assert.deepEqual(result.map(row => row.indices), [[100,120,80,150],[100,120,80,150]]);
  assert.equal(JSON.stringify(data), before);
  assert.equal(result[0].item.points[3].value, 1500);
});

test('missing, uncertified and zero-base series do not hide an available trajectory or invent indices', () => {
  const data = {series:{good:series([10,0,20,15]), zero:series([0,1,2,3]), partial:series([1,2,3]),
    pending:{...series([10,20,30,40]),status:'PENDING_CERTIFICATION'}, overflow:series([Number.MIN_VALUE,1,1,1])}};
  const selection = {COMPANY:'good',FOTON:'zero',DONGFENG:'missing', partial:'partial',pending:'pending',overflow:'overflow'};
  assert.deepEqual(indexedTrend(data, selection).map(row => [row.key,row.indices]), [['COMPANY',[100,0,200,150]]]);
  const bad = series([1,2,3,4]); bad.points[1].provenance={status:'PENDING_CERTIFICATION'};
  assert.deepEqual(indexedTrend({series:{bad}}, {COMPANY:'bad'}), []);
  bad.points[1].provenance={status:'CERTIFIED'}; bad.points[1].period='2026-08';
  assert.deepEqual(indexedTrend({series:{bad}}, {COMPANY:'bad'}), []);
});

test('all nine cards share one vertical index domain including every available series', () => {
  const cards = [...facts.cards,...facts.company.forum_cards];
  assert.equal(cards.length, 9);
  const scale = trendScale(facts);
  assert.ok(scale.min < 100 && scale.max > 100);
  let shown = 0;
  for (const card of cards) for (const row of indexedTrend(facts, card.series)) {
    shown++;
    assert.equal(row.indices[0],100);
    for (const index of row.indices) assert.ok(index >= scale.min && index <= scale.max);
  }
  assert.ok(shown > 9);
  const component = read('components/MonthlyCloseMetric.js');
  assert.match(component,/trendScale\(data\)/);
  assert.match(component,/data-index-base="100"/);
  assert.match(component,/junio = 100/);
});

test('FORUM observations preserve exact P1 member values, identity, event axis and full month cutoffs', () => {
  assert.equal(source.date_axis,'fecha_curse');
  for (const month of MONTHS) {
    const data = source.datasets[month], entry = evidence.records[data.evidence_ref];
    assert.equal(entry.result.authority,'P1_CERTIFIED');
    assert.equal(entry.result.status,'COMPLETE');
    assert.equal(entry.result.coverage.complete,true);
    assert.equal(entry.request.source,'FORUM'); assert.equal(entry.request.measure,'UFIS');
    assert.equal(entry.request.dimension,'STORE'); assert.equal(entry.request.cutoff,data.cutoff);
    assert.deepEqual(entry.request.filters,{network:'OWN_STORES'});
    assert.equal(entry.result.payload.dimension.identity_contract,'store_v01');
    assert.equal(entry.result.payload.rule,'CURSE_VEHICLE_UNITS_BY_FECHA_CURSE');
    assert.deepEqual(data.members,entry.result.payload.members);
    assert.equal(data.total_value,entry.result.coverage.total_value);
    assert.equal(data.members.reduce((sum,row) => sum+row.value,0),data.total_value);
  }
  assert.deepEqual(MONTHS.map(month=>source.datasets[month].total_value),[158,195,286,174]);
  assert.equal(source.datasets['2026-09'].total_value,facts.indicators.forum_ufis_own.value);
});

test('FORUM uses the existing unmodified ranking policy and limits each group to five stores', () => {
  const ranking = buildForumRanking(source);
  assert.equal(ranking.policy,POLICY);
  assert.deepEqual(ranking.counts,{IMPROVING:0,STABLE:4,DECLINING:6,UNCLASSIFIED:1});
  assert.deepEqual(rankPerformance(ranking.observations).declining,ranking.declining);
  assert.equal(ranking.declining.length,5);
  assert.equal(ranking.stable[0].name,'CIDEF Mall Plaza Norte');
  const row = ranking.observations.find(row=>row.id==='19');
  assert.equal(row.prior_avg,10); assert.equal(row.vin,14); assert.equal(row.delta_vin,4);
  assert.equal(row.performance_status,'STABLE'); // Relative gain alone cannot override the absolute threshold.
  assert.equal(ranking.observations.find(row=>row.id==='3').performance_status,'UNCLASSIFIED');
});

test('missing store months and unresolved identities are disclosed and never converted to zero', () => {
  const ranking = buildForumRanking(source);
  assert.deepEqual(ranking.incomplete.map(row=>row.id).sort(),['21','22']);
  assert.deepEqual(ranking.incomplete[0].missing_months,['2026-06']);
  assert.deepEqual(ranking.unresolved.map(row=>row.id),['UNRESOLVED:CIDEF ACTIVACION']);
  for (const group of ['observations','improving','stable','declining']) {
    assert.ok(ranking[group].every(row=>!['21','22','UNRESOLVED:CIDEF ACTIVACION'].includes(row.id)));
  }
});

test('FORUM ranking fails closed on incomplete, incompatible or uncertified inputs', () => {
  for (const mutate of [
    x=>{x.status='OBSERVED_NOT_CERTIFIED';}, x=>{x.measure='PRECURSE';},
    x=>{x.date_axis='fecha_cotizacion';}, x=>{delete x.datasets['2026-08'];},
    x=>{x.datasets['2026-08'].cutoff='2026-08-20';},
    x=>{x.datasets['2026-09'].unit='OPERATION';},
    x=>{x.datasets['2026-09'].members.push(x.datasets['2026-09'].members[0]);},
    x=>{x.datasets['2026-09'].members[0].value=null;}
  ]) {
    const changed=structuredClone(source); mutate(changed); assert.equal(buildForumRanking(changed),null);
  }
});

test('five pills retain the four pending SALES categories and do not reuse uncertified legacy figures', () => {
  for (const id of ['stores','sellers','dealers','models']) {
    assert.ok(facts.rankings.categories[id].reason);
    assert.equal(facts.rankings.categories[id].months,undefined);
    assert.equal(facts.rankings.categories[id].observations,undefined);
  }
  const component=read('components/MonthlyCloseRanking.js');
  for(const label of ['Tiendas propias','Vendedores activos','Dealers','Modelos','FORUM']) assert.ok(component.includes(label));
  assert.match(component,/useState\('stores'\)/);
  assert.match(component,/rank-columns-three/);
  assert.doesNotMatch(component,/legacy-|performance-ranking\.json|calculateAllRankings|rankPerformance|fetch\(/);
  assert.match(read('app/cierre-mensual/page.js'),/buildForumRanking\(facts.rankings.categories.forum\)/);
});
