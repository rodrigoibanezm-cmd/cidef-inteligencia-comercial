import source from "../data/monthly-close/2026-09/forum-close-source.json";
import {computeForumClose} from "../lib/motors/forum-close-v1";
const d=computeForumClose(source);
const n=x=>new Intl.NumberFormat("es-CL",{maximumFractionDigits:1}).format(x);
const pct=x=>Number.isFinite(x)?n(x*100)+"%":"—";
const change=x=>Number.isFinite(x)?(x>0?"+":"")+n(x*100)+"%":"—";
const months={"2026-04":"Abril","2026-05":"Mayo","2026-06":"Junio","2026-07":"Julio","2026-08":"Agosto","2026-09":"Septiembre"};
function Series({rows,keyName,rate=false}){
 const vals=rows.map(x=>rate?x[keyName]:x[keyName]??0);
 const max=Math.max(...vals.filter(Number.isFinite),1);
 const xs=rows.map((_,i)=>28+i*(480/(rows.length-1)));
 const ys=vals.map(v=>94-60*(v||0)/max);
 return <svg className="forum-trend-svg" viewBox="0 0 540 140" role="img" aria-label={"Tendencia mensual "+keyName}>
 <line x1="28" x2="508" y1="95" y2="95" stroke="#dce5ef"/>
 <polyline points={xs.map((x,i)=>x+","+ys[i]).join(" ")} fill="none" stroke="#244d7a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
 {xs.map((x,i)=><g key={i}><circle cx={x} cy={ys[i]} r="4" fill="#244d7a"/><text x={x} y={ys[i]-10} fill="#203e61" textAnchor="middle" fontSize="12" fontWeight="700">{rate?pct(vals[i]):n(vals[i])}</text><text x={x} y="121" textAnchor="middle" fill="#64748b" fontSize="11">{months[rows[i].period]?.slice(0,3)}</text></g>)}
 </svg>;
}
export default function ForumClose(){
 return <section className="mc-panel mc-forum-close" aria-label="FORUM cierre mensual">
 <div className="mc-panel-head"><div><h2>FORUM · Financiamiento y funnel comercial</h2><p className="mc-footnote">Septiembre 2026 · mes completo · curse y UFIs certificados</p></div><span>Motor FORUM v{d.version}</span></div>
 <h3 className="forum-block-title">Resultado por red</h3>
 <div className="forum-scroll"><table className="forum-table"><thead><tr><th>Red</th><th>Cotizaciones</th><th>Solicitudes</th><th>Ventas VIN</th><th>Curse</th><th>UFIs</th><th>Penetración UFI</th><th>Aprobadas sin curse</th></tr></thead><tbody>
 {d.networks.map(x=><tr key={x.id} className={x.id==="COMPANY"?"forum-total":""}><td>{x.label}</td><td>{n(x.quotations)}</td><td>{n(x.applications)}</td><td>{n(x.sales_vin)}</td><td>{n(x.curses)}</td><td>{n(x.ufis)}</td><td>{pct(x.penetration)}</td><td>{n(x.approved_pending)}</td></tr>)}
 </tbody></table></div>
 <p className="mc-footnote">Cotizaciones y solicitudes: operaciones originadas en septiembre. Curse y UFIs: ejecuciones de septiembre. Penetración = UFIs / ventas VIN de la red. Aprobadas sin curse: estado observado de la cohorte de septiembre al {d.observed_at}, no créditos ejecutados.</p>
 <div className="forum-cohort-header"><div><h3 className="forum-block-title">Tendencia por cohortes · abril–septiembre</h3><p className="mc-footnote">Meses completos de cotización. Aprobadas sin curse y convertidas reflejan el estado actual de cada cohorte; no son snapshots históricos de cierre.</p></div></div>
 <div className="forum-chart-grid"><div className="forum-chart"><strong>Aprobadas sin curse / cotizaciones</strong><Series rows={d.cohorts} keyName="approved_pending_share" rate/></div><div className="forum-chart"><strong>UFIs ejecutadas por mes</strong><Series rows={d.event_trend} keyName="ufis"/></div></div>
 <div className="forum-scroll"><table className="forum-table"><thead><tr><th>Cohorte</th><th>Cotizaciones</th><th>Solicitudes</th><th>Aprobadas sin curse</th><th>% cotizaciones</th><th>Convertidas</th><th>% convertidas</th></tr></thead><tbody>
 {d.cohorts.map(x=><tr key={x.period} className={x.period===d.period?"forum-total":""}><td>{months[x.period]}</td><td>{n(x.quotations)}</td><td>{n(x.applications)}</td><td>{n(x.approved_pending)}</td><td>{pct(x.approved_pending_share)}</td><td>{n(x.converted)}</td><td>{pct(x.converted_share)}</td></tr>)}
 </tbody></table></div>
 <p className="mc-footnote">Convertidas = cotizaciones de cada cohorte con Curse certificado hasta la observación actual. No equivalen a las operaciones cursadas durante ese mismo mes. Las cohortes recientes tienen menos tiempo para convertirse: sus tasas no son una comparación a igual maduración.</p>
 {d.signals&&<div className="forum-signals"><div><span>Variación cotizaciones vs agosto</span><strong>{change(d.signals.quotations_change)}</strong></div><div><span>Variación solicitudes vs agosto</span><strong>{change(d.signals.applications_change)}</strong></div><div><span>Aprobadas sin curse / cotizaciones</span><strong>{(d.signals.approved_pending_pp>=0?"+":"")+n(d.signals.approved_pending_pp*100)} pp</strong></div></div>}
 </section>;
}
