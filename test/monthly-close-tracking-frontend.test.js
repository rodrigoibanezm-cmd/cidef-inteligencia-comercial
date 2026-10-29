import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const html = await readFile(new URL('../public/seguimiento-cierre.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function snapshot() {
  const yoy = { percentage_delta: 12.5, absolute_delta: 5, baseline: { period: '2025-10', cutoff_date: '2025-10-29' } };
  const point = (period, n) => ({ period, cutoff_date: period + '-29', attainment_percent: n,
    comparison_status: n === null ? 'EXCLUDED' : 'COMPARABLE', difference_pp: n === null ? null : 10 });
  return { ok: true, environment: 'staging', period: '2026-10-01', requested_cutoff_date: '2026-10-29',
    cutoff_date: '2026-10-29', generation_id: 'original-generation', sources: { sales: { evidence_ids: ['p1-original'] } },
    rows: [['COMPANY', 'ALL', 100], ['DEALERS', 'ALL', 40], ['STORE', '8', 60], ['STORE', '22', null]].map(([dimension, dimension_id, value]) => ({
      dimension, dimension_id, payload: { date_from: '2026-10-01', cutoff_date: '2026-10-29', sales_mtd: { value },
        yoy: dimension_id === '22' ? null : yoy, attainment: { target_vin: dimension_id === '8' ? 100 : null,
          attainment_percent: dimension_id === '8' ? 60 : null, gap_vin: dimension_id === '8' ? -40 : null },
        daily: [{ date: '2026-10-26', status: 'OBSERVED', value: 0 }, { date: '2026-10-27', status: 'OBSERVED', value: null },
          { date: '2026-10-30', status: 'AFTER_CUTOFF', value: null }],
        rhythm: dimension === 'STORE' ? { current: { attainment_percent: dimension_id === '8' ? 60 : null },
          previous_4_months: ['2026-06', '2026-07', '2026-08', '2026-09'].map((p, i) => point(p, i === 2 ? null : 50)),
          yoy: point('2025-10', 50) } : null,
      },
    })) };
}
async function fixture() {
  const elements = new Map(), calls = [], state = { data: snapshot(), error: null, failPost: false, failReadAfterPost: false };
  const element = id => {
    if (!elements.has(id)) {
      let content = '';
      elements.set(id, { value: '', disabled: false, textContent: '', handlers: {}, dataset: {},
        classList: { toggle() {} }, setAttribute() {}, scrollIntoView() {}, checkValidity() { return Boolean(this.value); },
        addEventListener(event, callback) { this.handlers[event] = callback; }, querySelectorAll() { return []; },
        get innerHTML() { return content; }, set innerHTML(value) {
          content = value;
          if (id === '#results' && value.includes('id="rhythmStore"')) element('#rhythmStore').value = value.match(/<option value="([^"]*)"/)[1];
        },
      });
    }
    return elements.get(id);
  };
  const context = createContext({ Intl, Date, URLSearchParams, document: { querySelector: element },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/api/weekly-projections/sucursales') return { ok: true, json: async () => ({ ok: true,
        sucursales: [{ sucursal_id: 8, nombre_canonico: 'Plaza Sur' }, { sucursal_id: 22, nombre_canonico: '<Otra>' }] }) };
      if (options.method === 'POST') {
        if (state.failPost) return { ok: false, json: async () => ({ ok: false, error: 'GENERATION_FAILED' }) };
        state.data.generation_id = 'published-generation';
        if (state.failReadAfterPost) state.error = 'READ_FAILED';
        return { ok: true, json: async () => ({ ok: true, generation_id: state.data.generation_id, rows: 4 }) };
      }
      return { ok: !state.error, json: async () => state.error ? { ok: false, error: state.error } : structuredClone(state.data) };
    },
  });
  runInContext(script, context);
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
  return { element, calls, state, run: expression => runInContext(expression, context) };
}

test('renders the actual API shape with separate dimensions and four-month/YoY rhythm, without initial POST', async () => {
  const f = await fixture(), content = f.element('#results').innerHTML;
  assert.equal((content.match(/class="hero"/g) || []).length, 2);
  assert.equal((content.match(/data-store="8"/g) || []).length, 1);
  assert.equal((content.match(/data-store="22"/g) || []).length, 1);
  assert.match(content, /Plaza Sur/); assert.match(content, /&lt;Otra&gt;/); assert.match(content, /12,5%/);
  assert.match(f.element('#snapshotMeta').innerHTML, /original-generation/);
  const rhythm = f.element('#rhythmDetail').innerHTML;
  for (const month of ['2026-06', '2026-07', '2026-08', '2026-09', '2025-10']) assert.match(rhythm, new RegExp(month));
  assert.match(rhythm, /\+10 pp/); assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
  assert.match(html, /@media\(max-width:800px\)/); assert.match(html, /table-wrap\{overflow:auto/);
});

test('null values remain unavailable and observed zero remains zero', async () => {
  const f = await fixture(), missingRow = f.element('#results').innerHTML.match(/<tr data-store="22">([\s\S]*?)<\/tr>/)[1];
  assert.equal((missingRow.match(/No disponible/g) || []).length, 5);
  assert.equal(f.run('fmt(null)'), 'No disponible'); assert.equal(f.run('fmt(0)'), '0');
  assert.match(f.element('#results').innerHTML, /<td>0<\/td><td>No disponible<\/td>/);
  f.element('#rhythmStore').value = '22'; f.run('renderRhythm()');
  assert.match(f.element('#rhythmDetail').innerHTML, /Cumplimiento actual<strong>No disponible/);
});

test('Actualizar posts the exact contract, then reads the published snapshot', async () => {
  const f = await fixture(); f.element('#period').value = '2026-10'; f.element('#cutoff').value = '2026-10-29';
  await f.element('#refresh').handlers.click();
  const post = f.calls.find(c => c.options.method === 'POST'), sent = JSON.parse(post.options.body);
  assert.equal(post.url, '/api/monthly-close-tracking');
  assert.deepEqual(Object.keys(sent).sort(), ['cutoff_at', 'cutoff_date', 'period']);
  assert.equal(sent.period, '2026-10'); assert.equal(sent.cutoff_date, '2026-10-29');
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date(sent.cutoff_at)), sent.cutoff_date);
  assert.match(f.calls.at(-1).url, /period=2026-10&cutoff_date=2026-10-29/);
  assert.match(f.element('#snapshotMeta').innerHTML, /published-generation/);
  assert.equal(f.element('#refresh').disabled, false);
});

test('GET/POST errors retain previous visible results and report publication/read failure separately', async () => {
  for (const kind of ['error', 'failPost', 'failReadAfterPost']) {
    const f = await fixture(), previous = f.element('#results').innerHTML;
    f.state[kind] = kind === 'error' ? 'SNAPSHOT_NOT_FOUND' : true;
    await f.run(kind === 'error' ? 'load()' : 'refresh()');
    assert.equal(f.element('#results').innerHTML, previous);
    assert.match(f.element('#message').textContent, /Se conservan los datos anteriores/);
    if (kind === 'failReadAfterPost') assert.match(f.element('#message').textContent, /La publicación terminó/);
    assert.equal(f.element('#refresh').disabled, false);
  }
});

test('invalid selection and duplicated snapshot rows do not replace existing results', async () => {
  const f = await fixture(), previous = f.element('#results').innerHTML, n = f.calls.length;
  f.element('#period').value = ''; await f.run('refresh()'); assert.equal(f.calls.length, n);
  f.element('#period').value = '2026-10'; f.state.data.rows.push(f.state.data.rows[0]); await f.run('load()');
  assert.equal(f.element('#results').innerHTML, previous); assert.match(f.element('#message').textContent, /duplicadas/);
});
