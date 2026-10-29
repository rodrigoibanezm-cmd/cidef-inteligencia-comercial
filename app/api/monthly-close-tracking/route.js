import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createMonthlyCloseTrackingStore } from '../../../lib/monthly-close-tracking-store.js';
import { createMonthlyCloseTrackingGenerator } from '../../../lib/monthly-close-tracking-generator.js';
import { GET as getBranches } from '../weekly-projections/sucursales/route.js';

export const dynamic = 'force-dynamic';
const store = createMonthlyCloseTrackingStore();
const generate = createMonthlyCloseTrackingGenerator({ store });
const TIMEZONE = 'America/Santiago', VERSION = 'monthly-close-tracking-v1';
// Same access model as Proyecciones Admin. Per-user authorization is not implemented;
// resolve it before enabling broader access. No new authentication mechanism here.
const bad = (error, status = 400) => NextResponse.json({ ok: false, error }, { status });
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
function environment() {
  const value = String(process.env.PROJECTIONS_ENVIRONMENT || 'staging').trim().toLowerCase();
  if (!['staging', 'production'].includes(value)) throw new Error('INVALID_ENVIRONMENT');
  return value;
}
function dates({ period, cutoff_date }) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) invalid('INVALID_PERIOD');
  if (typeof cutoff_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cutoff_date) ||
      !Number.isFinite(Date.parse(cutoff_date)) || new Date(cutoff_date).toISOString().slice(0, 10) !== cutoff_date)
    invalid('INVALID_CUTOFF_DATE');
  return { period, cutoff_date };
}

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(k => !['period', 'cutoff_date'].includes(k) || params.getAll(k).length !== 1))
      invalid('INVALID_PARAMETERS');
    const { period, cutoff_date } = dates(Object.fromEntries(params));
    const env = environment();
    const rows = await store.latest({ environment: env, period: period + '-01', cutoff_date });
    if (!rows.length) return bad('SNAPSHOT_NOT_FOUND', 404);
    const first = rows[0];
    if (rows.some(row => row.generation_id !== first.generation_id || row.period !== first.period ||
        row.cutoff_date !== first.cutoff_date || row.environment !== env)) throw new Error('INCONSISTENT_GENERATION');
    const { generation_id, generated_at, cutoff_at, cutoff_timezone, sources, engine_version } = first;
    return NextResponse.json({ ok: true, environment: env, period: first.period,
      requested_cutoff_date: cutoff_date, cutoff_date: first.cutoff_date, cutoff_at, cutoff_timezone,
      generation_id, generated_at, sources, engine_version,
      rows: rows.map(({ dimension, dimension_id, payload }) => ({ dimension, dimension_id, payload })) });
  } catch (error) {
    return bad(error?.message || 'Internal server error', error?.status || 500);
  }
}

export async function POST(request) {
  try {
    const env = environment();
    if (env !== 'staging') return bad('STAGING_ONLY', 403);
    let body;
    try { body = await request.json(); } catch { invalid('INVALID_JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(k => !['period', 'cutoff_date', 'cutoff_at'].includes(k))) invalid('INVALID_PARAMETERS');
    const { period, cutoff_date } = dates(body);
    const instant = new Date(body.cutoff_at);
    if (typeof body.cutoff_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(body.cutoff_at) ||
        !Number.isFinite(instant.getTime()) ||
        new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
          .format(instant) !== cutoff_date) invalid('INVALID_CUTOFF');
    const response = await getBranches();
    const branches = await response.json();
    if (!response.ok || branches?.ok !== true || !Array.isArray(branches.sucursales) || !branches.sucursales.length)
      throw new Error('INCOMPLETE_STORE_CATALOG');
    const store_ids = branches.sucursales.map(row => String(row.sucursal_id));
    if (store_ids.some(id => !/^\d+$/.test(id)) || new Set(store_ids).size !== store_ids.length)
      throw new Error('INVALID_STORE_CATALOG');
    // Date-only SALES evidence does not certify historical intraday sales.
    const { publication } = await generate({ run_id: randomUUID(), period, cutoff_date, store_ids,
      cutoff_at: body.cutoff_at, cutoff_timezone: TIMEZONE, engine_version: VERSION, environment: env });
    return NextResponse.json({ ok: true, environment: env, period: period + '-01', cutoff_date, ...publication });
  } catch (error) {
    return bad(error?.message || 'Internal server error', error?.status || 500);
  }
}
