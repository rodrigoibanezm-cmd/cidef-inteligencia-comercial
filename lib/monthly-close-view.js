// Presentation only. Business values and comparisons must arrive certified in facts.json.
const count = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
export const isCertified = item => item?.status === 'CERTIFIED';
const trendMonths = ['2026-06', '2026-07', '2026-08', '2026-09'];
// Visual coordinates only: certified absolute values remain untouched.
export function indexedTrend(data, series) {
  return Object.entries(series || {}).flatMap(([key, id]) => {
    const item = data.series?.[id];
    if (!isCertified(item) || item.points?.length !== 4 ||
      !item.points.every((point, i) => point.period === trendMonths[i] &&
        Number.isFinite(point.value) && point.value >= 0 &&
        (!point.provenance || isCertified(point.provenance))) || item.points[0].value <= 0) return [];
    const indices = item.points.map(point => point.value / item.points[0].value * 100);
    return indices.every(Number.isFinite) ? [{ key, item, indices }] : [];
  });
}
export function trendScale(data) {
  const cards = [...(data.cards || []), ...(data.company?.forum_cards || [])];
  const values = cards.flatMap(card => indexedTrend(data, card.series).flatMap(series => series.indices));
  return { min: Math.floor((Math.min(100, ...values) - 10) / 10) * 10,
    max: Math.ceil((Math.max(100, ...values) + 10) / 10) * 10 };
}
export function valueText(item, signed = false) {
  if (!isCertified(item)) return 'Pendiente';
  if (item.value === null && item.value_status === 'ZERO_BASELINE') return 'No aplica (base 0)';
  if (!Number.isFinite(item.value)) return 'Pendiente';
  // Converting a certified ratio to its percent display is formatting, not a new metric.
  const value = item.unit === 'RATIO' ? item.value * 100 : item.value;
  const unit = ['RATIO', 'PERCENT'].includes(item.unit) ? '%' : item.unit === 'PP' ? ' pp' : '';
  return (signed && value > 0 ? '+' : '') + (['RATIO', 'PERCENT', 'PP'].includes(item.unit) ? decimal : count).format(value) + unit;
}
export const numberText = value => Number.isFinite(value) ? count.format(value) : 'Pendiente';
export const dateText = value => {
  if (!value) return 'Pendiente';
  if (!value.includes('T')) return value.slice(0, 10).split('-').reverse().join('/');
  const parts = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value;
  return part('day') + '/' + part('month') + '/' + part('year');
};
export const complianceText = item => isCertified(item) ? ({
  ABOVE_REFERENCE: 'Sobre meta', BELOW_REFERENCE: 'Bajo meta', AT_REFERENCE: 'En meta',
  EQUAL: 'En meta', EQUAL_TO_REFERENCE: 'En meta',
}[item.value] || 'Pendiente') : 'Pendiente';
