"use client";
import { useState } from 'react';
import snapshot from '../data/monthly-close/2026-10/ranking-p2.json';

const dimensions = { SALES: [['stores','Tiendas'],['sellers','Vendedores'],['dealers','Dealers'],['models','Modelos']], FORUM: [['stores','Tiendas'],['dealers','Dealers'],['sellers','Vendedores'],['models','Modelos']], RVM: [['brands','Marcas'],['models','Modelos'],['segments','Segmentos']] };
const performanceGroups = [['IMPROVING','Mejoran','↗'],['STABLE','Se mantienen','→'],['DETERIORATING','Deterioran','↘']];
const monthlyGroups = [['INCREASE','Suben','↗'],['UNCHANGED','Sin variación','→'],['DECREASE','Bajan','↘']];
const formatter = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const number = value => Number.isFinite(value) ? formatter.format(value) : '—';
const signed = value => Number.isFinite(value) ? (value > 0 ? '+' : '') + number(value) : '—';
const monthName = month => ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][Number(month.slice(5,7))-1];
const reasons = { BASELINE_UNAVAILABLE:'Sin MA12 suficiente', DEVIATION_UNAVAILABLE:'Desviación histórica no evaluable', P1_HISTORY_COVERAGE_INCOMPLETE:'Historia incompleta en la fuente', P1_IDENTITY_COVERAGE_INCOMPLETE:'Identidades sin resolver en la historia', P1_MEMBER_IDENTITY_UNCONFIRMED:'Identidad histórica no confirmada', UNRESOLVED_IDENTITY:'Identidad sin resolver', OUTSIDE_ROSTER:'Fuera de la nómina activa', HISTORY_UNAVAILABLE:'Historia estadística no disponible' };

function Trend({ row, unit }) {
  const max = Math.max(1, ...snapshot.months.map(m => Number.isFinite(row.months[m]) ? row.months[m] : 0));
  return <div className="rank-mini-trend" aria-label={row.name+': '+snapshot.months.map(m=>monthName(m)+' '+number(row.months[m])+' '+unit).join(', ')}>{snapshot.months.map(month => {
    const value = row.months[month];
    return <div key={month} title={monthName(month) + ': ' + number(value) + ' ' + unit}><div className="rank-mini-track">{Number.isFinite(value) ? <span style={{height:value/max*100+'%'}}/> : <small>—</small>}</div><small>{monthName(month)}</small></div>;
  })}</div>;
}

function RankingItems({ rows, ranking }) {
  const [expanded,setExpanded] = useState(false);
  if (!rows.length) return <p className="rank-none">Sin casos.</p>;
  return <div className="rank-items">{(expanded ? rows : rows.slice(0,5)).map((row,i) => <div className="rank-result" key={row.id} title={row.execution_id ? 'P2 · '+row.execution_id : undefined}>
    <div className="rank-item-main"><span className="rank-position">{i+1}.</span><strong title={row.name}>{row.name.replace(/^CIDEF /,'')}</strong><b>{number(row.value)} {ranking.unit}</b></div>
    <div className="rank-item-secondary"><span className={'rank-delta '+(Number.isFinite(row.delta) ? row.delta>=0 ? 'positive':'negative':'rank-neutral')}>{row.state==='UNKNOWN' ? reasons[row.reason] || 'Evidencia insuficiente' : <>{signed(row.delta)} {ranking.unit} {ranking.mode==='PERFORMANCE' ? 'vs MA12':'vs septiembre'}{ranking.mode!=='PERFORMANCE' && Number.isFinite(row.relative_delta) ? ' · '+signed(row.relative_delta*100)+'%':''}</>}</span><Trend row={row} unit={ranking.unit}/></div>
    {ranking.mode==='PERFORMANCE' && Number.isFinite(row.baseline) && <p className="rank-baseline">MA12: {number(row.baseline)} {ranking.unit}</p>}
    {row.manual_assignment && <p className="rank-baseline">Asignación manual del cierre</p>}
  </div>)}{rows.length>5 && <button type="button" className="rank-show-all" aria-expanded={expanded} onClick={() => setExpanded(v=>!v)}>{expanded ? 'Ver menos':'Ver todos ('+rows.length+')'}</button>}</div>;
}

function ObservedRows({ ranking }) {
  const [expanded,setExpanded] = useState(false);
  return <div className="rank-observed"><p className="rank-method">{ranking.coverage_note}</p><div className="rank-table-scroll"><table><thead><tr><th>{ranking.member_label}</th>{snapshot.months.map(m=><th key={m}>{monthName(m)}</th>)}</tr></thead><tbody>{(expanded ? ranking.observations:ranking.observations.slice(0,10)).map(row=><tr key={row.id}><th scope="row">{row.name.replace(/^CIDEF /,'')}</th>{snapshot.months.map(m=><td key={m}>{number(row.months[m])}</td>)}</tr>)}</tbody></table></div>{ranking.observations.length>10 && <button type="button" className="rank-show-all" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded ? 'Ver menos':'Ver todos ('+ranking.observations.length+')'}</button>}</div>;
}

export default function MonthlyCloseRanking({ period='2026-10' }) {
  const [brand,setBrand] = useState('COMPANY'), [domain,setDomain] = useState('SALES'), [dimension,setDimension] = useState('stores');
  const ranking = period===snapshot.period ? snapshot.views[brand]?.[domain]?.[dimension] : null;
  const groups = ranking?.mode==='MONTHLY_DELTA' ? monthlyGroups:performanceGroups;
  const unknown = ranking?.observations.filter(row=>row.state==='UNKNOWN') || [];
  const classified = ranking?.observations.length-unknown.length, selection=[brand,domain,dimension].join(':');
  return <section className="mc-panel mc-rank-section" aria-label="Ranking de desempeño comercial" data-close-ranking="commercial">
    <style>{`
      .mc-rank-section .rank-columns{align-items:start}.mc-rank-section .rank-controls{margin-bottom:14px}
      .mc-rank-section .rank-item-main,.mc-rank-section .rank-item-main b{font-size:14px}.mc-rank-section .rank-panel-header{font-size:15px}.mc-rank-section .rank-item-main strong{white-space:normal;overflow-wrap:anywhere}.mc-rank-section .rank-item-secondary{gap:12px;margin-top:6px;min-height:40px}
      .mc-rank-section .rank-delta{font-size:12px;line-height:1.4}.mc-rank-section .rank-mini-trend{flex-shrink:0;height:40px;gap:5px}
      .mc-rank-section .rank-mini-track{height:27px;width:15px}.mc-rank-section .rank-mini-trend small{font-size:10px}
      .mc-rank-section .rank-baseline,.mc-rank-section .rank-method{margin:6px 0;font-size:12px;line-height:1.5;color:#65758b}
      .mc-rank-section .rank-baseline{margin-left:28px}.mc-rank-section .rank-show-all{display:block;margin:12px 0 0;padding:8px 12px;border:1px solid #dce4ef;border-radius:8px;background:#fff;color:#234267;font:inherit;font-size:12px;cursor:pointer}
      .mc-rank-section .rank-unknown{margin-top:16px;border:1px solid #e0e7f0;border-radius:12px;padding:14px 18px}.mc-rank-section .rank-unknown>summary{cursor:pointer;font-size:14px;font-weight:650;color:#52657f}
      .mc-rank-section .rank-unknown .rank-items{margin-top:10px}.mc-rank-section .rank-table-scroll{overflow-x:auto}.mc-rank-section .rank-observed table{width:100%;border-collapse:collapse;font-size:13px}
      .mc-rank-section .rank-observed th,.mc-rank-section .rank-observed td{padding:10px 12px;border-bottom:1px solid #e5ebf3;text-align:right}.mc-rank-section .rank-observed th:first-child{text-align:left}.mc-rank-section .rank-observed thead{background:#edf2f8}
      @media(min-width:1041px){.mc-rank-section .rank-unknown .rank-items{grid-template-columns:repeat(3,minmax(0,1fr));column-gap:24px;align-items:start}.mc-rank-section .rank-unknown .rank-show-all{grid-column:1/-1;justify-self:start}}
      @media(max-width:450px){.mc-rank-section .rank-panel,.mc-rank-section .rank-unknown{padding:14px 12px}.mc-rank-section .rank-item-main{font-size:12px;gap:5px}.mc-rank-section .rank-item-main b{font-size:12px}.mc-rank-section .rank-item-secondary{margin-left:0}.mc-rank-section .rank-observed th,.mc-rank-section .rank-observed td{padding:9px 7px;font-size:12px}}
    `}</style>
    <div className="mc-panel-head"><div><h2>Ranking de desempeño comercial</h2><p className="rank-subtitle">{ranking?.mode==='MONTHLY_DELTA' ? 'Variación mensual · octubre vs septiembre 2026':ranking?.mode==='OBSERVED' ? 'Detalle mensual · julio a octubre 2026':'Mejoran · Se mantienen · Deterioran · octubre 2026'}</p></div><span>{ranking ? domain+' · '+(ranking.authority_label || (ranking.mode==='OBSERVED' ? 'P1':'P1/P2'))+' · octubre 2026 · '+ranking.unit:'Sin resultados para este período'}</span></div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Marca">{[['COMPANY','Compañía'],['FOTON','Foton'],['DONGFENG','Dongfeng']].map(([id,title])=><button type="button" key={id} aria-pressed={brand===id} className={brand===id ? 'selected':''} onClick={()=>setBrand(id)}>{title}</button>)}</div></div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Dominio">{Object.keys(dimensions).map(id=><button type="button" key={id} aria-pressed={domain===id} className={domain===id ? 'selected':''} onClick={()=>{setDomain(id);setDimension(dimensions[id][0][0]);}}>{id}</button>)}</div></div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Dimensión">{dimensions[domain].map(([id,title])=><button type="button" key={id} aria-pressed={dimension===id} className={dimension===id ? 'selected':''} onClick={()=>setDimension(id)}>{title}</button>)}</div></div>
    {!ranking ? <p className="rank-none">Sin evidencia disponible para este período.</p>:ranking.mode==='OBSERVED' ? <ObservedRows key={selection} ranking={ranking}/>:<>
      {classified>0 && <div className="rank-columns rank-columns-three">{groups.map(([state,title,arrow],i)=><div className="rank-panel" key={state}><div className="rank-panel-header"><span className={i===0 ? 'rank-up':i===2 ? 'rank-down':''}>{arrow}</span><strong>{title} ({ranking.counts[state] || 0})</strong></div><RankingItems key={selection+state} rows={ranking.observations.filter(row=>row.state===state)} ranking={ranking}/></div>)}</div>}
      {unknown.length>0 && <details className="rank-unknown" key={selection} open={!classified ? true:undefined}><summary>Sin clasificación ({unknown.length})</summary><RankingItems key={selection+'UNKNOWN'} rows={unknown} ranking={ranking}/></details>}
      {ranking.coverage_note && <p className="rank-method">{ranking.coverage_note}</p>}
    </>}
  </section>;
}
