import { dateText, indexedTrend, isCertified, trendScale, valueText } from '../lib/monthly-close-view';

const colors = { COMPANY: '#244d7a', FOTON: '#20b34b', DONGFENG: '#ed8726' };
export function FourMonthTrend({ data, series, label, perCardScale = false }) {
  const valid = indexedTrend(data, series);
  if (!valid.length) return <div className="mc-spark-empty">Pendiente<small>Trayectoria certificada de cuatro meses</small></div>;
  const scale = perCardScale ? trendScale(data, series) : trendScale(data);
  const xs = [22, 127, 233, 338], y = value => 72 - (value - scale.min) / (scale.max - scale.min) * 48;
  const indexText = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value);
  const labelFor = key => key === 'COMPANY' ? (perCardScale ? 'Compañía' : label) : key === 'FOTON' ? 'Foton' : 'Dongfeng';
  const demonstration = valid.some(({ item }) => item.status === 'DEMONSTRATION');
  return <div className="mc-spark-wrap mc-brand-spark">
    <div className="mc-trend-legend">{valid.map(({ key }) => <span key={key}><i style={{ background: colors[key] }}/>{labelFor(key)}</span>)}</div>
    <svg viewBox="0 0 360 102" className="mc-spark" role="img" data-index-base="100" data-index-min={scale.min} data-index-max={scale.max} aria-label={label + ': junio a septiembre 2026, índice junio = 100; escala ' + (perCardScale ? 'de esta tarjeta' : 'común') + ' de ' + scale.min + ' a ' + scale.max}>
      <path d="M22 74H338" stroke="#e9eef4" fill="none"/>
      <line x1="22" x2="338" y1={y(100)} y2={y(100)} stroke="#d8e0ea" strokeDasharray="3 3"/>
      <text x="18" y={y(100) - 4} fill="#748298" fontSize="9">100</text>
      {valid.map(({ key, item, indices }) => <g key={key}><polyline points={indices.map((index, i) => xs[i] + ',' + y(index)).join(' ')} stroke={colors[key]} strokeWidth="2.7" fill="none"/>{item.points.map((p, i) => <circle key={p.period} cx={xs[i]} cy={y(indices[i])} r="3" fill={colors[key]}><title>{p.period + ': ' + valueText({ status: 'CERTIFIED', value: p.value, unit: item.unit }) + ' · índice ' + indexText(indices[i])}</title></circle>)}</g>)}
      {xs.map((x, i) => <text key={x} x={x} y="95" textAnchor="middle" fill="#748298" fontSize="11">{['Jun', 'Jul', 'Ago', 'Sep'][i]}</text>)}
    </svg><small className="mc-index-note">{demonstration ? 'Trayectoria de demostración' : 'Trayectorias comparables'} · junio = 100</small>
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
    <FourMonthTrend data={data} series={config.series} label={config.label} perCardScale/>
    <SourceNote item={item}/>
  </article>;
}
