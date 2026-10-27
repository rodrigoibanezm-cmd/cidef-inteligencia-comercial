import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base = new URL('../data/monthly-close/2026-09/', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, base)));
const facts = read('facts.json');
const evidence = read('certification-evidence.json');
const indicators = facts.indicators;
const at = (value, path) => path.reduce((item, key) => item[key], value);
const sum = values => values.reduce((total, value) => total + value, 0);

test('every published number matches its preserved P1 or P2 evidence and temporal bounds', () => {
  for (const [id, item] of Object.entries(indicators)) {
    if (item.status !== 'CERTIFIED') {
      assert.equal(item.value, null, id);
      continue;
    }
    const entry = evidence.records[item.evidence_ref];
    assert.ok(entry && !entry.transport_error, id);
    assert.equal(item.value, at(entry.result, item.value_path), id);
    assert.ok(item.contract && item.contract_version && item.period && item.cutoff && item.observed_at, id);
    if (item.authority === 'P1_CERTIFIED') {
      assert.equal(entry.result.authority, 'P1_CERTIFIED', id);
      assert.equal(item.evidence_id, entry.result.evidence_id, id);
    } else {
      assert.equal(item.authority, 'P2_EXECUTED', id);
      assert.equal(entry.result.status, 'EXECUTED', id);
      assert.equal(item.execution_id, entry.result.lineage.execution_id, id);
      assert.ok(item.evidence_ids.length >= 2, id);
    }
    assert.ok(item.cutoff <= '2026-09-30', id);
  }
});

test('SALES totals, brands, channels and September dimensional observations reconcile', () => {
  const value = id => indicators[id].value;
  assert.equal(value('sales_company'), value('sales_own') + value('sales_dealers'));
  assert.equal(value('sales_company'), value('sales_foton') + value('sales_dongfeng'));
  for (const channel of ['own', 'dealers']) {
    assert.equal(value('sales_' + channel), value('sales_foton_' + channel) + value('sales_dongfeng_' + channel));
  }
  for (const dimension of ['stores', 'sellers', 'financial_entities', 'models']) {
    const block = facts.breakdowns[dimension];
    assert.equal(sum(block.members.map(row => row.value)), block.total, dimension);
    assert.equal(block.total, value(dimension === 'models' ? 'sales_company' : 'sales_own'), dimension);
    assert.equal(block.cutoff, '2026-09-30');
  }
});

test('all four SALES months reconcile independently by channel and brand', () => {
  for (let index = 0; index < 4; index++) {
    const rows = Object.fromEntries(['sales_company', 'sales_own', 'sales_dealers', 'sales_foton', 'sales_dongfeng']
      .map(id => [id, facts.series[id].points[index]]));
    assert.equal(rows.sales_company.value, rows.sales_own.value + rows.sales_dealers.value);
    assert.equal(rows.sales_company.value, rows.sales_foton.value + rows.sales_dongfeng.value);
    for (const row of Object.values(rows)) assert.equal(row.period, rows.sales_company.period);
  }
});

test('unresolved financing remains explicit and never becomes certified cash sales', () => {
  const raw = evidence.records.sales_finance.result;
  assert.equal(indicators.sales_finance_resolved.value, raw.coverage.dimension_resolved_n);
  assert.equal(indicators.sales_finance_unresolved.value, raw.coverage.dimension_unresolved_n);
  assert.equal(indicators.sales_finance_resolved.value + indicators.sales_finance_unresolved.value, indicators.sales_own.value);
  assert.ok(facts.breakdowns.financial_entities.members.some(row => row.member_id === 'UNRESOLVED'));
  assert.equal(fs.existsSync(new URL('financing-sales-observed.json', base)), false);
});

test('FORUM September events, consolidated applications and exact snapshot remain distinct', () => {
  for (const id of ['forum_quotations', 'forum_applications', 'forum_curses', 'forum_ufis']) {
    assert.equal(indicators[id].value, indicators[id + '_own'].value + indicators[id + '_dealers'].value);
    assert.equal(indicators[id].cutoff, '2026-09-30');
  }
  assert.equal(indicators.forum_snapshot_operations.value, evidence.records.forum_snapshot.result.coverage.operation_count);
  assert.notEqual(indicators.forum_snapshot_operations.value, indicators.forum_quotations.value);
  assert.match(indicators.forum_applications.semantics, /NO es foto histórica/);
  assert.equal(indicators.forum_precurse_september.value, null);
  assert.equal(indicators.forum_snapshot_states.value, null);
  assert.equal(evidence.records.forum_latest_precurse.result.temporal.snapshot_date, '2026-10-21');
});

test('RVM uses source quantities, exact DFM identity and executed P2 shares', () => {
  const ytdMarket = evidence.records.rvm_market_ytd.result;
  assert.equal(indicators.rvm_market_ytd.value, ytdMarket.coverage.units);
  assert.notEqual(ytdMarket.coverage.units, ytdMarket.coverage.filtered_n);
  assert.equal(evidence.records.rvm_dongfeng_sep.result.dimensions.brand, 'DFM');
  assert.equal(indicators.rvm_portfolio.value, indicators.rvm_foton.value + indicators.rvm_dongfeng.value);
  const result = evidence.records.p2_rvm_ytd_share.result.result;
  assert.equal(result.part_value, indicators.rvm_portfolio_ytd.value);
  assert.equal(result.universe_value, indicators.rvm_market_ytd.value);
  assert.equal(indicators.rvm_ytd_share.value, result.percentage);
  assert.ok(Math.abs(indicators.rvm_share.value - indicators.rvm_foton_share.value - indicators.rvm_dongfeng_share.value) < 1e-10);
});

test('trends and executive compatibility files reference the canonical source', () => {
  const checkRefs = value => {
    if (typeof value === 'string' && /^(series|indicators|breakdowns)\./.test(value)) assert.notEqual(at(facts, value.split('.')), undefined, value);
    else if (value && typeof value === 'object') Object.values(value).forEach(checkRefs);
  };
  for (const filename of ['kpi-trends.json', 'kpi-brand-trends.json', 'executive-close.json', 'performance-ranking.json', 'forum-close-source.json']) {
    const file = read(filename);
    assert.equal(file.source_file, 'facts.json');
    checkRefs(file);
  }
  for (const insight of read('analysis.json').insights) {
    for (const [, id] of insight.summary.matchAll(/\{([a-z0-9_]+)\}/g)) assert.equal(indicators[id]?.status, 'CERTIFIED', id);
  }
});

test('production close excludes legacy inputs and unsupported ranking classifications', () => {
  assert.equal(facts.rankings.status, 'PENDING_CERTIFICATION');
  const paths = ['../app/cierre-mensual/page.js', '../components/ForumClose.js', '../components/PerformanceRanking.js'];
  for (const path of paths) {
    const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /CRM|OBSERVED_NOT_CERTIFIED|legacy-performance|legacy-forum|computeForumClose|calculateAllRankings/);
    assert.doesNotMatch(source, /\/924|junio igual a 100/);
  }
  assert.doesNotMatch(JSON.stringify(read('executive-close.json')), /CRM/);
});
