import { randomUUID } from 'node:crypto';
import { db as defaultDb, withDbTransaction as defaultTransaction } from './db.js';

const DIMENSIONS = ['COMPANY', 'DEALERS', 'STORE'];
const TIMEZONE = 'America/Santiago';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
function memberKey(row) {
  if (!DIMENSIONS.includes(row?.dimension) || typeof row.dimension_id !== 'string' ||
      !row.dimension_id.trim() || row.dimension_id !== row.dimension_id.trim()) fail('INVALID_MEMBER');
  return JSON.stringify([row.dimension, row.dimension_id]);
}
function scope({ environment, period, cutoff_date }) {
  if (!['staging', 'production'].includes(environment)) fail('INVALID_ENVIRONMENT');
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(period)) fail('INVALID_PERIOD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff_date) ||
      !Number.isFinite(Date.parse(cutoff_date)) ||
      new Date(cutoff_date).toISOString().slice(0, 10) !== cutoff_date) fail('INVALID_CUTOFF_DATE');
}

// expected_members: [{ dimension, dimension_id }]; rows add an object payload.
// All persisted generations are validated here; direct SQL writes bypass this contract.
export function createMonthlyCloseTrackingStore({ db = defaultDb, withDbTransaction = defaultTransaction } = {}) {
  async function publish(input) {
    // Freeze the batch before waiting for the lock; callers cannot mutate pending rows.
    const batch = JSON.parse(JSON.stringify({ environment: 'staging', cutoff_timezone: TIMEZONE, ...input }));
    const { environment, period, cutoff_date, cutoff_at, cutoff_timezone,
      sources, engine_version, expected_members, rows } = batch;
    scope(batch);
    if (environment !== 'staging') fail('STAGING_ONLY');
    const instant = new Date(cutoff_at);
    if (typeof cutoff_at !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(cutoff_at) ||
        !Number.isFinite(instant.getTime()) || cutoff_timezone !== TIMEZONE ||
        new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit',
          day: '2-digit' }).format(instant) !== cutoff_date) fail('INVALID_CUTOFF');
    if (!object(sources) || typeof engine_version !== 'string' || !engine_version.trim()) fail('INVALID_METADATA');
    if (!Array.isArray(expected_members) || !Array.isArray(rows)) fail('INCOMPLETE_GENERATION');
    const expected = new Set(expected_members.map(memberKey)), actual = new Set(rows.map(memberKey));
    if (expected.size !== expected_members.length || actual.size !== rows.length ||
        expected.size !== actual.size || [...actual].some(key => !expected.has(key)) ||
        DIMENSIONS.some(dimension => !expected_members.some(row => row.dimension === dimension)) ||
        rows.some(row => !object(row.payload))) fail('INCOMPLETE_GENERATION');
    const generation_id = randomUUID();
    return withDbTransaction(async client => {
      // Same transaction-scoped advisory-lock mechanism as weekly projections.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`monthly_close_tracking_snapshots:${environment}:${period}`]);
      const { rows: [stamp] } = await client.query('SELECT clock_timestamp() AS generated_at');
      for (const row of rows) {
        await client.query(`INSERT INTO monthly_close_tracking_snapshots
          (environment,period,cutoff_date,cutoff_at,cutoff_timezone,generation_id,
           dimension,dimension_id,payload,sources,engine_version,generated_at)
          VALUES ($1,$2::date,$3::date,$4::timestamptz,$5,$6::uuid,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
        [environment, period, cutoff_date, cutoff_at, cutoff_timezone, generation_id,
          row.dimension, row.dimension_id, JSON.stringify(row.payload), JSON.stringify(sources),
          engine_version, stamp.generated_at]);
      }
      return { generation_id, generated_at: stamp.generated_at, rows: rows.length };
    });
  }

  async function latest({ environment = 'staging', period, cutoff_date }) {
    scope({ environment, period, cutoff_date });
    // One MVCC statement chooses and reads the entire generation, never per-member maxima.
    return db().query(`WITH latest AS (
      SELECT cutoff_date,generation_id FROM monthly_close_tracking_snapshots
      WHERE environment=$1 AND period=$2::date AND cutoff_date<=$3::date
      ORDER BY cutoff_date DESC,cutoff_at DESC,generated_at DESC,generation_id DESC LIMIT 1
    ) SELECT r.environment,r.period::text,r.cutoff_date::text,r.cutoff_at,r.cutoff_timezone,
      r.generation_id,r.dimension,r.dimension_id,r.payload,r.sources,r.engine_version,r.generated_at
      FROM monthly_close_tracking_snapshots r JOIN latest l
        ON r.cutoff_date=l.cutoff_date AND r.generation_id=l.generation_id
      WHERE r.environment=$1 AND r.period=$2::date
      ORDER BY r.dimension,r.dimension_id`, [environment, period, cutoff_date]);
  }
  return { publish, latest };
}
