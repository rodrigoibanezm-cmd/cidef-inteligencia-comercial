import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { complianceText, dateText, valueText } from '../lib/monthly-close-view.js';

const dir = new URL('../data/monthly-close/2026-09/', import.meta.url);
const facts = JSON.parse(fs.readFileSync(new URL('facts.json', dir)));
const evidence = JSON.parse(fs.readFileSync(new URL('certification-evidence.json', dir)));
const company = facts.company;
const get = (object, path) => path.reduce((value, key) => value[key], object);
const sum = values => values.reduce((total, value) => total + value, 0);

test('the approved nine cards and four panels exist without adding another view', () => {
  assert.deepEqual(facts.cards.map(card => card.id), ['sales_company','sales_own','sales_dealers','rvm_portfolio','rvm_share','rvm_ytd_share']);
  assert.deepEqual(company.forum_cards.map(card => card.id), ['forum_quotations','forum_ufis','forum_penetration']);
  assert.deepEqual(Object.keys(company.panels), ['sales','targets','competitive','financing']);
  assert.equal(company.period, '2026-09');
  assert.equal(facts.indicators.forum_penetration.value, null);
  assert.equal(facts.indicators.forum_penetration.status, 'PENDING_CERTIFICATION');
});

test('every normalized panel value and comparison is traceable to the exact P1 or P2 field', () => {
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if ('status' in item && 'value' in item && 'unit' in item) {
      if (item.status === 'CERTIFIED') {
        const source = evidence.records[item.evidence_ref];
        assert.ok(source && !source.transport_error, item.evidence_ref);
        assert.equal(item.value, get(source.result, item.value_path), item.evidence_ref);
        assert.ok(item.contract && item.period && item.cutoff && item.observed_at);
        if (item.authority === 'P2_EXECUTED') {
          assert.equal(source.result.status, 'EXECUTED');
          assert.equal(item.execution_id, source.result.lineage.execution_id);
        } else assert.equal(source.result.authority, 'P1_CERTIFIED');
      } else assert.equal(item.value, null);
    }
    for (const value of Object.values(item)) visit(value);
  };
  visit(company);
});

test('all sales axes reconcile with the same source-corrected August and September totals', () => {
  const axes = company.panels.sales.axes;
  for (const [name, axis] of Object.entries(axes)) {
    assert.equal(sum(axis.rows.map(row => row.baseline.value)), axis.total.baseline.value, name);
    assert.equal(sum(axis.rows.map(row => row.current.value)), axis.total.current.value, name);
    assert.equal(sum(axis.rows.map(row => row.delta.value)), axis.total.delta.value, name);
    assert.equal(axis.total.baseline.value, 1199);
    assert.equal(axis.total.current.value, 1034);
    assert.equal(axis.total.delta.value, -165);
    for (const row of axis.rows) {
      assert.equal(row.delta.authority, 'P2_EXECUTED');
      assert.equal(row.relative.authority, 'P2_EXECUTED');
    }
  }
  assert.equal(axes.channels.rows.find(row => row.id === 'TIENDA_PROPIA').delta.value, -181);
  assert.equal(axes.models.rows.find(row => row.id === '84').baseline.value, 57);
  assert.equal(facts.series.sales_company.points[2].value, 1199);
  assert.equal(facts.series.sales_own.points[2].value, 554);
  assert.equal(facts.series.sales_dongfeng.points[2].value, 341);
});

test('four-month series use fixed certified points and preserve point-level provenance', () => {
  const months = ['2026-06','2026-07','2026-08','2026-09'];
  for (const series of Object.values(facts.series)) {
    assert.deepEqual(series.points.map(point => point.period), months);
    for (const point of series.points) {
      assert.ok(Number.isFinite(point.value));
      if (point.provenance) assert.equal(point.value, get(evidence.records[point.provenance.evidence_ref].result, point.provenance.value_path));
    }
  }
  for (const id of ['forum_quotations','forum_ufis','rvm_dongfeng','rvm_dongfeng_share']) assert.equal(facts.series[id].status, 'CERTIFIED');
});

test('targets show official coverage and never fabricate a target for Amunategui', () => {
  const panel = company.panels.targets;
  assert.equal(panel.coverage.available, 13);
  assert.equal(panel.coverage.stores, 14);
  assert.deepEqual(panel.coverage.missing_store_ids, ['15']);
  const missing = panel.rows.find(row => row.id === '15');
  assert.equal(missing.actual.value, 1);
  assert.equal(valueText(missing.target), 'Pendiente');
  assert.equal(complianceText(missing.compliance), 'Pendiente');
  const bellavista = panel.rows.find(row => row.id === '3');
  assert.equal(bellavista.actual.value, 52);
  assert.equal(bellavista.target.value, 48);
  assert.equal(bellavista.gap.value, 4);
  assert.equal(complianceText(bellavista.compliance), 'Sobre meta');
  assert.ok(panel.rows.filter(row => row.compliance.status === 'CERTIFIED').length === 13);
});

test('market openings use the relevant segment denominator and retain unavailable pp as pending', () => {
  const panel = company.panels.competitive;
  assert.equal(panel.brands.length, 2);
  assert.equal(panel.segments.length, 5);
  assert.equal(sum(panel.brands.map(row => row.september.value)), facts.indicators.rvm_portfolio.value);
  assert.equal(sum(panel.segments.map(row => row.september.value)), facts.indicators.rvm_portfolio.value);
  for (const row of panel.segments) {
    assert.equal(row.monthly_share.status, 'CERTIFIED');
    assert.equal(row.ytd_share.status, 'CERTIFIED');
    const share = evidence.records[row.monthly_share.evidence_ref].result;
    const universeRef = share.lineage.evidence_refs.find(ref => ref.slot === 'universe').evidence_id;
    const universe = Object.values(evidence.records).find(entry => entry.run_id === company.run_id && entry.result.evidence_id === universeRef);
    assert.ok(universe.result.dimensions.segment);
    assert.equal(universe.result.dimensions.brand, undefined);
    assert.equal(row.delta_pp.value, null);
  }
  const zero = panel.segments.find(row => row.label === 'CAMIONETA / DFM');
  assert.equal(zero.august.value, 0);
  assert.equal(valueText(zero.august), '0');
});

test('cohort conversion is separated from monthly UFIs and names its evaluated denominator', () => {
  const panel = company.panels.financing;
  const row = panel.conversion.rows.find(row => row.id === 'COMPANY');
  assert.equal(row.converted.value, 351);
  assert.equal(row.evaluated.value, 4090);
  assert.equal(row.rate.value, 8.581907090464547);
  assert.equal(sum(['converted','approved','expired','rejected'].map(key => row[key].value)), row.evaluated.value);
  assert.notEqual(row.converted.value, facts.indicators.forum_ufis.value);
  assert.notEqual(row.evaluated.value, facts.indicators.forum_quotations.value);
  assert.equal(panel.conversion.historical_snapshot, false);
  assert.equal(panel.conversion.other_statuses_excluded, true);
  assert.ok(panel.conversion.observed_at);
});

test('presentation distinguishes missing data, measured zero and undefined variation from zero baseline', () => {
  assert.equal(valueText({ status: 'PENDING_CERTIFICATION', value: 100 }), 'Pendiente');
  assert.equal(valueText({ status: 'CERTIFIED', value: 0, unit: 'VIN' }), '0');
  assert.equal(valueText({ status: 'CERTIFIED', value: null, unit: 'RATIO', value_status: 'ZERO_BASELINE' }), 'No aplica (base 0)');
  const df6 = company.panels.sales.axes.models.rows.find(row => row.id === '181');
  assert.equal(valueText(df6.relative), 'No aplica (base 0)');
  assert.equal(dateText('2026-10-27T01:00:00Z'), '26/10/2026');
  assert.equal(dateText('2026-09-30'), '30/09/2026');
});

test('the company page has no business arithmetic, raw queries, CRM or developed conclusions', () => {
  const source = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  for (const path of ['app/cierre-mensual/page.js','components/ForumClose.js','components/CompanyClosePanels.js','components/PerformanceRanking.js','components/MonthlyCloseMetric.js']) {
    assert.doesNotMatch(source(path), /CRM|SELECT |ventas_raw|AZURE_DATABASE_URL|executeP2|callP1|fetch\(/);
  }
  const page = source('app/cierre-mensual/page.js');
  assert.doesNotMatch(page, /analysis\.json|PerformanceRanking|type="month"/);
  assert.match(page, /data-close-conclusions="pending"/);
  assert.match(page, /Pendiente de desarrollar/);
  assert.ok(page.indexOf('data-close-conclusions') > page.indexOf('CompanyClosePanels data='));
});
