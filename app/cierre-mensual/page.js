import Link from "next/link";
import facts from "../../data/monthly-close/2026-09/facts.json";
import analysis from "../../data/monthly-close/2026-09/analysis.json";
import executive from "../../data/monthly-close/2026-09/executive-close.json";
import financing from "../../data/monthly-close/2026-09/financing-sales-observed.json";
import trendData from "../../data/monthly-close/2026-09/kpi-trends.json";

const f=facts.domains;
const format=n=>new Intl.NumberFormat("es-CL",{maximumFractionDigits:1}).format(n);
const pct=n=>(n>0?"+":"")+format(n)+"%";
const monthName={"2026-06":"Junio","2026-07":"Julio","2026-08":"Agosto","2026-09":"Septiembre"};
const insight=analysis.insights.filter(x=>["SALES","RVM","FORUM"].includes(x.domain)).slice(0,7);
function Sparkline({points=[],unit="VIN"}) {
 const fourPoints=points.filter(p=>Number.isFinite(p.value)).slice(-4);
 if(fourPoints.length<2) return <div className="mc-spark-empty"><span>Trayectoria pendiente</span><small>Faltan cortes históricos comparables</small></div>;
 const vals=fourPoints.map(p=>p.value),min=Math.min(...vals),max=Math.max(...vals),spread=max-min||1;
 const xs=fourPoints.map((_,i)=>18+(i*324)/(fourPoints.length-1)),ys=vals.map(v=>65-(v-min)/spread*29);
 const numbers=vals.map(v=>unit==="PERCENT"?format(v)+"%":format(v));
 const avgPrior=vals.slice(0,-1).reduce((acc,v)=>acc+v,0)/(vals.length-1);
 const diff=avgPrior?(vals[vals.length-1]/avgPrior-1)*100:null;
 const tone=diff===null?"neutral":diff>=5?"up":diff<=-5?"down":"steady";
 return <div className="mc-spark-wrap">
 <div className={"mc-spark-note "+tone}>{diff===null?"Sin referencia":(diff>=0?"+":"")+format(diff)+"% vs promedio "+(vals.length-1)+" meses previos"}</div>
 <svg viewBox="0 0 360 104" className="mc-spark" role="img" aria-label={"Trayectoria histórica: "+fourPoints.map((p,i)=>p.period+" "+numbers[i]).join("; ")}>
 <polyline points={xs.map((x,i)=>x+","+ys[i]).join(" ")} fill="none" stroke="#244d7a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
 {xs.map((x,i)=><g key={fourPoints[i].period}><circle cx={x} cy={ys[i]} r="4" fill="#244d7a"/><text x={x} y={Math.max(13,ys[i]-12)} textAnchor="middle" fill="#21334b" fontSize="12" fontWeight="700">{numbers[i]}</text><text x={x} y="98" textAnchor="middle" fill="#748298" fontSize="11">{monthName[fourPoints[i].period]?.slice(0,3)||fourPoints[i].period}</text></g>)}
 </svg></div>;
}
function Metric({label,value,sub,series,unit="VIN",sourceNote}){return <div className="mc-kpi"><span>{label}</span><strong>{value}</strong><small>{sub}</small><Sparkline points={series?.points} unit={unit}/>{sourceNote&&<small className="mc-source-note">{sourceNote}</small>}</div>}
export const metadata={title:"Septiembre 2026 · Cierre mensual | CIDEF"};
export default function CierreMensual(){
const sales=f.sales.metrics.vin_sales;
const rvm=f.rvm.metrics;
const ytd=f.rvm.scopes.ytd.metrics;
const u=f.forum.scopes.own_stores.metrics;
const stores=f.sales.rankings.stores;
const brands=f.sales.breakdowns.brand;
const network=f.sales.breakdowns.network;
const pctFinance=n=>format(financing.sales_denominator?n/financing.sales_denominator*100:0)+"%";
return <main className="shell mc">
<header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">CIERRE HISTÓRICO · SEPTIEMBRE 2026</span></header>
<section className="mc-intro"><span className="eyebrow">CIERRE MENSUAL · PRIMERA VERSIÓN</span><h1>Septiembre 2026</h1><p>Ventas como resultado. Mercado, CRM y Forum como explicación. Una lectura del mes, su trayectoria y las señales del negocio.</p></section>
<div className="mc-warning"><strong>Conciliación pendiente.</strong> Este tablero reproduce el snapshot histórico existente, sin modificarlo. SALES registra {format(sales.value)} VIN, mientras una observación posterior del motor reportó 1.043 VIN. El desglose de marcas tampoco reconcilia exactamente con el total. Estas cifras aún no deben considerarse un cierre nuevamente certificado.</div>
<div className="mc-tabs"><span className="mc-active">Compañía</span><span>Tiendas propias</span><span>Dealers</span><span>Foton</span><span>Dongfeng</span></div>
<section className="mc-kpis">
<Metric label="Ventas · VIN" value={format(sales.value)} sub={"YoY "+pct(sales.delta_pct)+" · snapshot"} series={trendData.series.company}/>
<Metric label="Ventas propias" value={format(network.find(x=>x.id==="OWN_STORES")?.value)} sub="VIN · canal propio" series={trendData.series.own_stores} sourceNote="Serie histórica en conciliación"/>
<Metric label="Ventas dealers" value={format(network.find(x=>x.id==="DEALERS")?.value)} sub="VIN · canal dealer" series={trendData.series.dealers} sourceNote="Serie histórica en conciliación"/>
<Metric label="RVM · Share mensual" value={format(rvm.portfolio_share.value)+"%"} sub={format(rvm.portfolio_share.delta_pp)+" pp YoY"} series={trendData.series.rvm_monthly} unit="PERCENT"/>
<Metric label="RVM · Share YTD" value={format(ytd.portfolio_share.value)+"%"} sub="Acumulado enero–septiembre" series={trendData.series.rvm_ytd} unit="PERCENT"/>
<Metric label="Ventas financiadas" value={format(financing.with_financing)} sub={pctFinance(financing.with_financing)+" · propias"} series={trendData.series.financed} sourceNote="Corte de /ventas; pendiente conciliación"/>
</section>
<div className="mc-layout">

<section className="mc-panel"><div className="mc-panel-head"><h2>Ventas por marca</h2><span>Snapshot histórico · revisar conciliación</span></div>{brands.map(b=><div className="mc-row" key={b.id}><span>{b.label}</span><strong>{format(b.value)} VIN</strong></div>)}<div className="mc-panel-head mc-space"><h2>RVM · Mercado</h2></div><div className="mc-row"><span>Inscripciones del mercado</span><strong>{format(rvm.market_units.value)}</strong></div><div className="mc-row"><span>Inscripciones Foton + DFM</span><strong>{format(rvm.portfolio_units.value)}</strong></div><p className="mc-footnote">RVM mide inscripciones de mercado, no facturas. DFM conserva su identidad de fuente hasta validar el puente con SALES.</p></section>
<section className="mc-panel"><div className="mc-panel-head"><h2>Tiendas propias · ventas</h2><span>Ranking disponible</span></div>{stores.map(s=><div className="mc-row" key={s.id}><span>{s.label.replace("CIDEF ","")}</span><strong>{format(s.value)} VIN</strong></div>)}<p className="mc-footnote">Vista parcial. El desglose completo por tienda y vendedor se incorporará con su identidad de SALES certificada; CRM SOLD no reemplaza ventas ERP.</p></section>
<section className="mc-panel mc-finance-full">
<div className="mc-panel-head"><h2>Créditos y financiamiento</h2><span>Tiendas propias · septiembre 2026</span></div>
<div className="mc-finance-grid">
<div className="mc-finance-block">
<h3>Financiamiento en ventas</h3>
<div className="mc-finance-headline"><div><strong>{format(financing.with_financing)}</strong><span>con financiamiento · {pctFinance(financing.with_financing)}</span></div><div><strong>{format(financing.without_financing)}</strong><span>sin financiamiento · {pctFinance(financing.without_financing)}</span></div></div>
<p className="mc-footnote">Fuente: financiera registrada en SALES. Valores conservados de la captura del módulo /ventas; pendientes de conciliación con el cierre mensual.</p>
</div>
<div className="mc-finance-block"><h3>Participación por financiera</h3>
{financing.entities.map(e=><div className="mc-finance-entity" key={e.entity}><span>{e.entity}</span><strong>{format(e.vins)} VIN</strong><span>{pctFinance(e.vins)}</span></div>)}
<p className="mc-footnote">Porcentajes sobre {format(financing.sales_denominator)} VIN del corte observado de /ventas, no sobre UFIs.</p></div>
</div>
<div className="mc-forum-separate"><div><span className="eyebrow">FORUM · CRÉDITOS EJECUTADOS</span><div className="mc-forum-number">{format(u.ufis.value)} <small>UFIs</small></div></div><div><span className="eyebrow">PENETRACIÓN FORUM</span><div className="mc-forum-number">{format(u.ufi_penetration.value)}%</div></div><p>174 unidades financiadas por Curse sobre 377 VIN de ventas propias del snapshot de cierre. No son equivalentes a los 159 VIN facturados con financiera Forum.</p></div>
<div className="mc-warning-inline">Conciliación pendiente: el módulo /ventas observado registra 375 VIN (198 financiados y 177 no financiados); el cierre mensual registra 377. Estas bases no se fusionan ni se suman.</div>
</section>
<section className="mc-panel mc-crm-separate"><div className="mc-panel-head"><h2>CRM · Gestión comercial</h2><span>Leads y actividad · tiendas propias</span></div><div className="mc-row"><span>Leads creados</span><strong>{format(executive.company.crm.total_leads)}</strong></div><div className="mc-row"><span>Leads gestionados</span><strong>{format(executive.company.crm.total_managed)}</strong></div><div className="mc-row"><span>Cobertura de gestión</span><strong>{format(executive.company.crm.total_management_rate*100)}%</strong></div><p className="mc-footnote">CRM mide generación y gestión de prospectos. SOLD en CRM no sustituye las ventas VIN certificadas de SALES.</p></section>
</div>
<section className="mc-panel mc-insights"><div className="mc-panel-head"><h2>Lectura ejecutiva</h2><span>Hallazgos preservados del cierre anterior</span></div><div className="mc-insightgrid">{insight.map(x=><article key={x.id}><span className="eyebrow">{x.domain} · {x.type}</span><h3>{x.title}</h3><p>{x.summary}</p></article>)}</div><p className="mc-footnote">Los textos históricos pueden mencionar totales anteriores y no deben utilizarse para reconciliar cifras. La siguiente etapa actualizará la lectura con los contratos definitivos.</p></section>
<div className="mc-next"><strong>Próxima incorporación:</strong> navegación por canal → tienda → vendedor y marca → línea → modelo → versión; CRM por vendedor, financiamiento por financiera, RVM acumulado de 12 meses y comparaciones YoY completas.</div>
</main>
}
