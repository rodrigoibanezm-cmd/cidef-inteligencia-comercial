// Snapshot coordination only. Commercial calculations remain in the existing routes.
import { randomUUID } from 'node:crypto';

export const SNAPSHOT_VERSION = 'daily-projections-v1';
export const STATUS_SCOPE = 'REFRESH_STATUS';
const LEASE_MS = 5 * 60_000;
const MAX_RUN_MS = 110 * 60_000;

export function reportingDates(now = new Date()) {
  const cutoffDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const monday = new Date(`${cutoffDate}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { weekStart: monday.toISOString().slice(0, 10), cutoffDate };
}

export function liveLease(job, updatedAt, now = Date.now()) {
  const expires = job?.lease_until ? Date.parse(job.lease_until) : Date.parse(updatedAt) + LEASE_MS;
  return job?.status === 'running' &&
    now < expires &&
    now < Date.parse(job.started_at) + MAX_RUN_MS;
}

export function sameSources(snapshot, source) {
  return snapshot?.version === SNAPSHOT_VERSION && source?.status === 'READY' &&
    snapshot.sources?.source_signature === source.source_signature;
}

export function createSnapshotStore({ db, withDbTransaction, now = () => Date.now() }) {
  const query = (client, text, values = []) => client
    ? client.query(text, values).then(result => result.rows)
    : db().query(text, values);
  const lock = client => client.query("SELECT pg_advisory_xact_lock(hashtextextended('weekly_projection_results:staging',0))");
  function assertStaging(env) { if (env !== 'staging') throw new Error('STAGING_ONLY'); }

  async function sources(client) {
    try {
      // Both existing load workflows publish READY atomically after certification.
      // Read metadata only: never scan RAW or run a commercial motor on a GET.
      const [row] = await query(client, `SELECT payload, generation_id, sales_cutoff::text,
        forum_cutoff::text, updated_at::text FROM public.forum_ventas_snapshot_v01
        WHERE period='STATE' AND network='ALL' AND dimension='STATUS'`);
      const value = row?.payload;
      if (!row || value?.status !== 'READY' || !value.source_signature ||
          !row.sales_cutoff || !row.forum_cutoff) return { status: value?.status || 'UNAVAILABLE' };
      return { status: 'READY', source_signature: value.source_signature,
        generation_id: row.generation_id, sales_cutoff: row.sales_cutoff,
        forum_cutoff: row.forum_cutoff, published_at: row.updated_at };
    } catch (error) {
      if (error?.code === '42P01') return { status: 'UNAVAILABLE' };
      throw error;
    }
  }

  async function status(weekStart, cutoffDate, env) {
    const [row] = await query(null, `SELECT payload, updated_at::text FROM weekly_projection_results
      WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3 AND scope_key=$4`,
    [weekStart, cutoffDate, env, STATUS_SCOPE]);
    if (!row) return { status: 'idle' };
    return { ...row.payload, ...(row.payload.status === 'running' && !liveLease(row.payload, row.updated_at, now())
      ? { status: 'expired', recoverable: true } : {}) };
  }

  async function latest(weekStart, cutoffDate, env, storeId) {
    // All dimensions come from one MVCC statement, including during a publication.
    return query(null, `WITH latest AS (
      SELECT cutoff_date FROM weekly_projection_results
      WHERE week_start=$1::date AND cutoff_date<=$2::date AND environment=$3
        AND scope_key='COMPANY' AND payload ? 'admin' AND payload ? 'companyFinance'
      ORDER BY cutoff_date DESC LIMIT 1
    ) SELECT r.dimension,r.scope_key,
      r.sucursal_id::text,r.persona_id::text,r.payload,r.updated_at::text,r.cutoff_date::text
      FROM weekly_projection_results r JOIN latest l ON r.cutoff_date=l.cutoff_date
      WHERE r.week_start=$1::date AND r.environment=$3
        AND (r.scope_key=$4 OR ($5::bigint IS NULL AND r.dimension='STORE')
          OR ($5::bigint IS NOT NULL AND r.dimension='SELLER' AND r.sucursal_id=$5::bigint))
      ORDER BY r.scope_key`,
    [weekStart, cutoffDate, env, storeId ? `STORE:${storeId}` : 'COMPANY', storeId]);
  }

  async function claim(weekStart, cutoffDate, env, source) {
    assertStaging(env);
    return withDbTransaction(async client => {
      await lock(client);
      const running = await query(client, `SELECT payload,updated_at::text FROM weekly_projection_results
        WHERE environment=$1 AND scope_key=$2 AND payload->>'status'='running'
        ORDER BY updated_at DESC FOR UPDATE`, [env, STATUS_SCOPE]);
      const busy = running.find(row => liveLease(row.payload, row.updated_at, now()));
      if (busy) return { ...busy.payload, claimed: false };
      const [previous] = await query(client, `SELECT payload FROM weekly_projection_results
        WHERE week_start=$1::date AND environment=$2 AND scope_key='COMPANY'
        ORDER BY cutoff_date DESC LIMIT 1`, [weekStart, env]);
      const skipped = sameSources(previous?.payload?.snapshot, source);
      const job = { status: skipped ? 'completed' : 'running', job_id: randomUUID(),
        week_start: weekStart, cutoff_date: cutoffDate, completedStores: 0, totalStores: 0,
        sources: source, version: SNAPSHOT_VERSION, skipped, started_at: new Date(now()).toISOString(),
        lease_until: new Date(now() + LEASE_MS).toISOString(),
        ...(skipped ? { finished_at: new Date(now()).toISOString(), reason: 'SOURCES_UNCHANGED' } : {}) };
      await client.query(`INSERT INTO weekly_projection_results
        (week_start,cutoff_date,environment,dimension,scope_key,payload,updated_at)
        VALUES ($1::date,$2::date,$3,'COMPANY',$4,$5::jsonb,now())
        ON CONFLICT (week_start,cutoff_date,environment,scope_key)
        DO UPDATE SET payload=excluded.payload,updated_at=now()`,
      [weekStart, cutoffDate, env, STATUS_SCOPE, JSON.stringify(job)]);
      return { claimed: !skipped, ...job };
    });
  }

  async function update(weekStart, cutoffDate, env, job) {
    assertStaging(env);
    if (job.status === 'running' && now() >= Date.parse(job.started_at) + MAX_RUN_MS) throw new Error('REFRESH_DEADLINE_EXCEEDED');
    const { claimed: _claimed, ...record } = job;
    const next = { ...record, lease_until: new Date(now() + LEASE_MS).toISOString() };
    const rows = await query(null, `UPDATE weekly_projection_results SET payload=$5::jsonb,updated_at=now()
      WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3 AND scope_key=$4
        AND payload->>'job_id'=$6 AND payload->>'status'='running'
        AND (payload->>'lease_until')::timestamptz > now() RETURNING payload`,
    [weekStart, cutoffDate, env, STATUS_SCOPE, JSON.stringify(next), job.job_id]);
    if (!rows.length) throw new Error('REFRESH_LEASE_LOST');
  }

  async function publish(weekStart, cutoffDate, env, job, rows) {
    assertStaging(env);
    return withDbTransaction(async client => {
      await lock(client);
      const [owner] = await query(client, `SELECT payload,updated_at::text FROM weekly_projection_results
        WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3 AND scope_key=$4 FOR UPDATE`,
      [weekStart, cutoffDate, env, STATUS_SCOPE]);
      if (owner?.payload?.job_id !== job.job_id || !liveLease(owner.payload, owner.updated_at, now())) throw new Error('REFRESH_LEASE_LOST');
      const currentSources = await sources(client);
      if (currentSources.status !== 'READY' || currentSources.source_signature !== job.sources.source_signature ||
          currentSources.generation_id !== job.sources.generation_id) throw new Error('SOURCES_CHANGED_DURING_REFRESH');
      if (!rows.some(row => row.scopeKey === 'COMPANY') || rows.filter(row => row.dimension === 'STORE').length !== job.totalStores) throw new Error('INCOMPLETE_SNAPSHOT');
      const finishedAt = new Date(now()).toISOString();
      const snapshot = { version: SNAPSHOT_VERSION, generation_id: job.job_id, snapshot_day: cutoffDate,
        week_start: weekStart, cutoff_date: cutoffDate, sources: job.sources, generated_at: finishedAt };
      await client.query('DELETE FROM weekly_projection_results WHERE week_start=$1::date AND cutoff_date=$2::date AND environment=$3', [weekStart, cutoffDate, env]);
      for (const row of rows) {
        await client.query(`INSERT INTO weekly_projection_results
          (week_start,cutoff_date,environment,dimension,scope_key,sucursal_id,persona_id,payload,updated_at)
          VALUES ($1::date,$2::date,$3,$4,$5,$6::bigint,$7::bigint,$8::jsonb,now())`,
        [weekStart, cutoffDate, env, row.dimension, row.scopeKey, row.storeId, row.personId, JSON.stringify({ ...row.payload, snapshot })]);
      }
      const { claimed: _claimed, ...record } = job;
      const completed = { ...record, status: 'completed', finished_at: finishedAt,
        duration_ms: now() - Date.parse(job.started_at), results: rows.length };
      await client.query(`INSERT INTO weekly_projection_results
        (week_start,cutoff_date,environment,dimension,scope_key,payload,updated_at)
        VALUES ($1::date,$2::date,$3,'COMPANY',$4,$5::jsonb,now())`,
      [weekStart, cutoffDate, env, STATUS_SCOPE, JSON.stringify(completed)]);
      return { ok: true, ...completed, environment: env, updated_at: finishedAt };
    });
  }

  return { sources, status, latest, claim, update, publish };
}
