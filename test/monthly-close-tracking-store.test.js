import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createMonthlyCloseTrackingStore } from '../lib/monthly-close-tracking-store.js';

const expected_members = [
  { dimension: 'COMPANY', dimension_id: 'ALL' }, { dimension: 'DEALERS', dimension_id: 'ALL' },
  { dimension: 'STORE', dimension_id: '8' }, { dimension: 'STORE', dimension_id: '22' },
];
const cut = { period: '2026-10-01', cutoff_date: '2026-10-29' };
function batch(value = 10, date = cut.cutoff_date) {
  return { ...cut, cutoff_date: date, cutoff_at: `${date}T18:00:00-03:00`,
    sources: { sales: { signature: `source-${value}`, evidence_ids: [`e-${value}`] } },
    engine_version: 'tracking-v1', expected_members,
    rows: expected_members.map(member => ({ ...member, payload: { sales: value, target: 20 } })) };
}
async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(await readFile(new URL('../scripts/create-monthly-close-tracking-snapshots.sql', import.meta.url), 'utf8'));
  const state = { failAt: 0, reads: 0, afterRead: null };
  const store = createMonthlyCloseTrackingStore({
    db: () => ({ query: async (sql, args) => {
      state.reads++;
      const result = await pg.query(sql, args), hook = state.afterRead;
      state.afterRead = null;
      if (hook) await hook();
      return result.rows;
    } }),
    withDbTransaction: work => pg.transaction(tx => {
      let inserts = 0;
      return work({ query: (sql, args) => {
        // One-connection PGlite serializes transactions; retain the production lock SQL.
        if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
        if (sql.startsWith('INSERT') && ++inserts === state.failAt) throw new Error('simulated insert failure');
        return tx.query(sql, args);
      } });
    }),
  });
  return { pg, store, state };
}

test('only an exact complete member set publishes, with shared metadata', async t => {
  const { store } = await fixture(t), input = batch();
  await assert.rejects(store.publish({ ...input, rows: input.rows.slice(1) }), /INCOMPLETE_GENERATION/);
  await assert.rejects(store.publish({ ...input, rows: [...input.rows, input.rows[0]] }), /INCOMPLETE_GENERATION/);
  await assert.rejects(store.publish({ ...input, expected_members: [...expected_members, expected_members[0]] }), /INCOMPLETE_GENERATION/);
  await assert.rejects(store.publish({ ...input, rows: [...input.rows.slice(0, 3),
    { dimension: 'STORE', dimension_id: '99', payload: {} }] }), /INCOMPLETE_GENERATION/);
  assert.deepEqual(await store.latest(cut), []);
  const publication = await store.publish(input), rows = await store.latest(cut);
  assert.equal(rows.length, expected_members.length);
  assert.equal(new Set(rows.map(row => row.generation_id)).size, 1);
  assert.ok(rows.every(row => row.generation_id === publication.generation_id &&
    row.cutoff_timezone === 'America/Santiago' && row.engine_version === input.engine_version &&
    new Date(row.cutoff_at).toISOString() === '2026-10-29T21:00:00.000Z'));
  assert.deepEqual(rows[0].sources, input.sources);
  assert.deepEqual(rows[0].payload, { sales: 10, target: 20 });
  assert.equal(new Set(rows.map(row => new Date(row.generated_at).toISOString())).size, 1);
});

test('a failure after the first insert rolls back the entire new generation', async t => {
  const { pg, store, state } = await fixture(t), original = await store.publish(batch());
  state.failAt = 2;
  await assert.rejects(store.publish(batch(12)), /simulated insert failure/);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM monthly_close_tracking_snapshots')).rows[0].n, 4);
  assert.ok((await store.latest(cut)).every(row => row.generation_id === original.generation_id && row.payload.sales === 10));
});

test('new generations preserve previous publications and previous cutoff days', async t => {
  const { pg, store } = await fixture(t), old = await store.publish(batch(5, '2026-10-28'));
  const first = await store.publish(batch(10)), newest = await store.publish(batch(12));
  assert.equal((await pg.query('SELECT count(DISTINCT generation_id)::int AS n FROM monthly_close_tracking_snapshots')).rows[0].n, 3);
  assert.equal((await store.latest({ ...cut, cutoff_date: '2026-10-28' }))[0].generation_id, old.generation_id);
  assert.equal((await store.latest(cut))[0].generation_id, newest.generation_id);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM monthly_close_tracking_snapshots WHERE generation_id=$1', [first.generation_id])).rows[0].n, 4);
});

test('one SQL read returns one generation even if a new publication completes before delivery', async t => {
  const { store, state } = await fixture(t), previous = await store.publish(batch());
  let next;
  state.afterRead = async () => { next = await store.publish(batch(15)); };
  const rows = await store.latest(cut);
  assert.equal(state.reads, 1);
  assert.equal(rows.length, expected_members.length);
  assert.ok(rows.every(row => row.generation_id === previous.generation_id && row.payload.sales === 10));
  assert.ok((await store.latest(cut)).every(row => row.generation_id === next.generation_id && row.payload.sales === 15));
});
