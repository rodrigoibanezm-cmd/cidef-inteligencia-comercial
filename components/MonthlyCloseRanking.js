"use client";
import { useState } from 'react';
import { dateText } from '../lib/monthly-close-view';

const dimensions = {
  SALES: [['stores', 'Tiendas'], ['sellers', 'Vendedores'], ['dealers', 'Dealers'], ['models', 'Modelos']],
  FORUM: [['stores', 'Tiendas'], ['dealers', 'Dealers'], ['sellers', 'Vendedores'], ['models', 'Modelos']],
  RVM: [['brands', 'Marcas'], ['models', 'Modelos'], ['segments', 'Segmentos']]
};
const groups = [
  ['improving', 'IMPROVING', 'Mejoran', '↗', 'rank-up', 'Sin mejoras relevantes.'],
  ['stable', 'STABLE', 'Se mantienen', '→', '', 'Sin casos estables elegibles.'],
  ['declining', 'DECLINING', 'Deterioran', '↘', 'rank-down', 'Sin retrocesos relevantes.']
];
const number = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value);
const signed = value => (value > 0 ? '+' : '') + number(value);

function Trend({ row, months }) {
  const maximum = Math.max(1, ...months.map(month => row.months[month]));
  return <div className="rank-mini-trend" aria-label={'UFIs junio a septiembre de ' + row.name}>
    {months.map((month, i) => <div key={month} title={month + ': ' + number(row.months[month]) + ' UFIs'}>
      <div className="rank-mini-track"><span style={{ height: row.months[month] / maximum * 100 + '%' }}/></div>
      <small>{['Jun', 'Jul', 'Ago', 'Sep'][i]}</small>
    </div>)}
  </div>;
}

function RankingItems({ ranking, group, emptyText }) {
  if (!ranking) return <p className="rank-none">Pendiente de certificación.</p>;
  const items = ranking[group];
  return <div className="rank-items">{items.length ? items.slice(0, 5).map((row, i) => <div className="rank-result" key={row.id}>
    <div className="rank-item-main"><span className="rank-position">{i + 1}.</span><strong title={row.name}>{row.name.replace(/^CIDEF /, '')}</strong><b>{number(row.vin)} UFIs</b></div>
    <div className="rank-item-secondary"><span className={'rank-delta ' + (row.delta_vin >= 0 ? 'positive' : 'negative')}>
      {signed(row.delta_vin)} UFIs vs promedio · {signed(row.change_pct * 100)}%
    </span><Trend row={row} months={ranking.months}/></div>
    <p className="rank-source-note">Promedio junio–agosto: {number(row.prior_avg)} UFIs</p>
  </div>) : <p className="rank-none">{emptyText}</p>}</div>;
}

export default function MonthlyCloseRanking({ categories: sources, forum }) {
  const [domain, setDomain] = useState('SALES');
  const [dimension, setDimension] = useState('stores');
  const category = domain === 'SALES' ? dimension : domain === 'FORUM' && dimension === 'stores' ? 'forum' : null;
  const ranking = category === 'forum' ? forum : null;
  return <section className="mc-panel mc-rank-section" aria-label="Ranking de desempeño comercial" data-close-ranking="commercial">
    <div className="mc-panel-head"><div><h2>Ranking de desempeño comercial</h2><p className="rank-subtitle">Mejoran · Se mantienen · Deterioran · septiembre 2026</p></div>
      <span>{ranking ? 'FORUM P1 · Motor v' + ranking.motor_version + ' · UFIs' : 'Pendiente de certificación'}</span>
    </div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Dominio">{Object.keys(dimensions).map(id => <button type="button" key={id} aria-pressed={domain === id} className={domain === id ? 'selected' : ''} onClick={() => { setDomain(id); setDimension(dimensions[id][0][0]); }}>{id}</button>)}</div></div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Dimensión">{dimensions[domain].map(([id, title]) => <button type="button" key={id} aria-pressed={dimension === id} className={dimension === id ? 'selected' : ''} onClick={() => setDimension(id)}>{title}</button>)}</div></div>
    <div className="rank-columns rank-columns-three">{groups.map(([id, status, title, arrow, tone, empty]) => <div className="rank-panel" key={id}>
      <div className="rank-panel-header"><span className={tone}>{arrow}</span><strong>{title} ({ranking ? ranking.counts[status] : 'Pendiente'})</strong></div>
      <RankingItems ranking={ranking} group={id} emptyText={empty}/>
    </div>)}</div>
    {category !== 'forum' ? <p className="rank-source-note">{sources[category]?.reason || 'Pendiente de recertificación histórica.'}</p> : ranking ? <>
      <p className="rank-source-note">Sucursales propias · UFIs ejecutadas por fecha de curse · meses completos de junio a septiembre. Fuente: FORUM P1, identidad store_v01. Observación: {dateText(ranking.observed_at)}.</p>
      <p className="rank-source-note">Septiembre frente al promedio junio–agosto. Se reutiliza el motor existente: cambio relevante cuando |Δ| ≥{ranking.policy.minimumAbsoluteDeltaVIN} UFIs y |variación| ≥{ranking.policy.minimumRelativeDelta * 100}%; exige actividad en los tres meses previos y promedio ≥{ranking.policy.minimumPriorAverage} UFIs. Orden por impacto absoluto; estables por UFIs de septiembre. Hasta cinco sucursales por grupo; el encabezado cuenta todos los casos.</p>
      <p className="rank-source-note">Sin clasificación por actividad o volumen insuficiente: {ranking.counts.UNCLASSIFIED}. Además, {ranking.incomplete.length} sucursales con meses no observados y {ranking.unresolved.length} identidad sin resolver quedan fuera. Una ausencia no se convierte en cero.</p>
    </> : <p className="rank-source-note">Pendiente de evidencia FORUM P1 completa y compatible por sucursal.</p>}
  </section>;
}
