import { withDbTransaction } from './db.js';

/** Read or build one report snapshot per Santiago calendar day and report slice. */
export async function withDailyReportSnapshot({
  reportKey,
  periodStart,
  cutoffDate,
  dimension,
  dimensionId,
  force = false,
  calculate,
  buildDimensions = () => [],
}) {
  return withDbTransaction(async (client) => {
    const lockKey = [reportKey, periodStart, cutoffDate, dimension, dimensionId].join('|');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);

    const lookup = `
      SELECT payload, updated_at
      FROM weekly_projection_admin_snapshots
      WHERE snapshot_day = (now() AT TIME ZONE 'America/Santiago')::date
        AND report_key = $1
        AND period_start = $2::date
        AND cutoff_date = $3::date
        AND dimension = $4
        AND dimension_id = $5
    `;
    if (!force) {
      const cached = await client.query(lookup, [reportKey, periodStart, cutoffDate, dimension, dimensionId]);
      if (cached.rowCount) return { payload: cached.rows[0].payload, updatedAt: cached.rows[0].updated_at, cacheHit: true, calculationMs: 0 };
    }

    const calculateStarted = Date.now();
    const result = await calculate();
    const calculationMs = Date.now() - calculateStarted;
    if (!result || result.status < 200 || result.status >= 300) return { ...result, cacheHit: false };

    const saved = await client.query(`
      INSERT INTO weekly_projection_admin_snapshots
        (snapshot_day, report_key, period_start, cutoff_date, dimension, dimension_id, payload, updated_at)
      VALUES ((now() AT TIME ZONE 'America/Santiago')::date, $1, $2::date, $3::date, $4, $5, $6::jsonb, now())
      ON CONFLICT (snapshot_day, report_key, period_start, cutoff_date, dimension, dimension_id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
      RETURNING updated_at
    `, [reportKey, periodStart, cutoffDate, dimension, dimensionId, JSON.stringify(result.payload)]);

    for (const detail of buildDimensions(result.payload)) {
      await client.query(`
        INSERT INTO weekly_projection_admin_snapshots
          (snapshot_day, report_key, period_start, cutoff_date, dimension, dimension_id, payload, updated_at)
        VALUES ((now() AT TIME ZONE 'America/Santiago')::date, $1, $2::date, $3::date, $4, $5, $6::jsonb, now())
        ON CONFLICT (snapshot_day, report_key, period_start, cutoff_date, dimension, dimension_id)
        DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
      `, [reportKey, periodStart, cutoffDate, detail.dimension, detail.dimensionId, JSON.stringify(detail.payload)]);
    }

    return { payload: result.payload, updatedAt: saved.rows[0].updated_at, cacheHit: false, calculationMs };
  });
}
