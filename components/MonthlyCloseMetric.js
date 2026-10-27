import { dateText, isCertified, valueText } from '../lib/monthly-close-view';

const colors = { COMPANY: '#244d7a', FOTON: '#20b34b', DONGFENG: '#ed8726' };
const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
export function FourMonthTrend({ data, series, label }) {
  const valid = Object.entries(series || {}).map(([key, id]) => ({ key, item: data.series[id] }))
    .filter(({ item }) => isCertified(item) && item.points?.length === 4 &&
      item.points.every((p, i) => p.period === months[i] && Number.isFinite(p.value)));
  if (!valid.length) return <div className="mc-spark-empty">Pendiente<small>Trayectoria certificada de cuatro meses</small></div>;
  const maximum = Math.max(1, ...valid.flatMap(({ item }) => item.points.map(p => p.value)));
  const xs = [22, 127, 233, 338], y = value => 72 - value / maximum * 48;
  const labelFor = key => key === 'COMPANY' ? label : key === 'FOTON' ? 'Foton' : 'Dongfeng';
  return <div className="mc-spark-wrap mc-brand-spark">
    <div className="mc-trend-legend">{valid.map(({ key }) => <span key={key}><i style={{ background: colors[key] }}/>{labelFor(key)}</span>)}</div>
    <svg viewBox="0 0 360 102" className="mc-spark" role="img" aria-label={label + ': junio a septiembre 2026, valores certificados en su unidad original'}>
      <path d="M22 74H338" stroke="#e9eef4" fill="none"/>
      {valid.map(({ key, item }) => <g key={key}><polyline points={item.points.map((p, i) => xs[i] + ',' + y(p.value)).join(' ')} stroke={colors[key]} strokeWidth="2.7" fill="none"/>{item.points.map((p, i) => <circle key={p.period} cx={xs[i]} cy={y(p.value)} r="3" fill={colors[key]}><title>{p.period + ': ' + valueText({ status: 'CERTIFIED', value: p.value, unit: item.unit })}</title></circle>)}</g>)}
      {xs.map((x, i) => <text key={x} x={x} y="95" textAnchor="middle" fill="#748298" fontSize="11">{['Jun', 'Jul', 'Ago', 'Sep'][i]}</text>)}
    </svg><small className="mc-index-note">Junio–septiembre · unidad original</small>
  </div>;
}

export function Comparison({ comparison }) {
  if (comparison?.delta) return <small>{comparison.label}: {valueText(comparison.delta, true)}{comparison.delta.unit === 'VIN' ? ' VIN' : ''} · {valueText(comparison.relative, true)}</small>;
  if (isCertified(comparison?.baseline)) return <small>{comparison.label}: {valueText(comparison.baseline)} · Δ pp: Pendiente</small>;
  return <small>{comparison?.label || 'Comparación'}: Pendiente</small>;
}

export function SourceNote({ item }) {
  return <small className="mc-source-note">{item?.source || 'Fuente pendiente'} · {item?.period || '2026-09'} · corte {dateText(item?.cutoff)}</small>;
}

export default function MonthlyCloseMetric({ data, config }) {
  const item = data.indicators[config.id];
  return <article className="mc-kpi" data-close-card={config.id}>
    <span>{config.label}</span><div className="mc-kpi-values"><strong>{valueText(item)}</strong>
      {config.brands && <div className="mc-kpi-brands">{Object.entries(config.brands).map(([brand, id]) => <div key={brand}><span>{brand === 'FOTON' ? 'Foton' : 'Dongfeng'}</span><b>{valueText(data.indicators[id])}</b></div>)}</div>}
    </div>
    <Comparison comparison={data.company.comparisons[config.id]}/>
    <FourMonthTrend data={data} series={config.series} label={config.label}/>
    <SourceNote item={item}/>
  </article>;
}
