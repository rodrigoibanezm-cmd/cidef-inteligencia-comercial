import Link from "next/link";
import ForumClose from "../../components/ForumClose";
import PerformanceRanking from "../../components/PerformanceRanking";
import facts from "../../data/monthly-close/2026-09/facts.json";
import analysis from "../../data/monthly-close/2026-09/analysis.json";

const format = value => Number.isFinite(value)
  ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value) : "—";
const metric = id => facts.indicators[id];
const display = id => {
  const item = metric(id);
  return item?.status === "CERTIFIED" ? format(item.value) + (item.unit === "PERCENT" ? "%" : "") : "—";
};
const palettes = { COMPANY: "#244d7a", FOTON: "#20b34b", DONGFENG: "#ed8726" };

function TrendComparison({ series, label }) {
  const keys = Object.keys(palettes);
  const sets = Object.fromEntries(keys.map(key => [key, facts.series[series?.[key]]?.points || []]));
  if (keys.some(key => sets[key].length !== 4 || sets[key].some(point => !Number.isFinite(point.value)))) {
    return <div className="mc-spark-empty">Trayectoria comparable pendiente de certificación</div>;
  }
  // Geometry only: certified values stay in their original unit; no business index is calculated here.
  const maximum = Math.max(1, ...keys.flatMap(key => sets[key].map(point => point.value)));
  const xs = [18, 126, 234, 342];
  const y = value => 67 - value / maximum * 48;
  return <div className="mc-spark-wrap mc-brand-spark">
    <div className="mc-trend-legend"><span><i style={{ background: palettes.COMPANY }}/>CIDEF</span><div><span><i style={{ background: palettes.FOTON }}/>Foton</span><span><i style={{ background: palettes.DONGFENG }}/>Dongfeng</span></div></div>
    <svg viewBox="0 0 360 93" className="mc-spark" role="img" aria-label={"Evolución mensual de " + label + " en su unidad original"}>
      {keys.map(key => <g key={key}><polyline points={sets[key].map((point, index) => xs[index] + "," + y(point.value)).join(" ")} fill="none" stroke={palettes[key]} strokeWidth={key === "COMPANY" ? "3" : "2.3"} strokeLinejoin="round" strokeLinecap="round"/>{sets[key].map((point, index) => <circle key={point.period} cx={xs[index]} cy={y(point.value)} r="3" fill={palettes[key]}><title>{point.period + ": " + format(point.value)}</title></circle>)}</g>)}
      {xs.map((x, index) => <text key={x} x={x} y="87" textAnchor="middle" fill="#748298" fontSize="11">{["Jun", "Jul", "Ago", "Sep"][index]}</text>)}
    </svg><small className="mc-index-note">Valores certificados · unidad original</small>
  </div>;
}

function Metric({ id, label, brands, series, subtitle }) {
  const item = metric(id);
  return <div className="mc-kpi"><span>{label}</span>
    <div className="mc-kpi-values"><strong>{display(id)}</strong><div className="mc-kpi-brands"><div><span>Foton</span><b>{display(brands?.FOTON)}</b></div><div><span>Dongfeng</span><b>{display(brands?.DONGFENG)}</b></div></div></div>
    <small>{item?.status === "CERTIFIED" ? subtitle : item?.reason || "Pendiente de certificación"}</small>
    <TrendComparison series={series} label={label}/>
    <small className="mc-source-note">{item?.source || "Fuente pendiente"} · corte {item?.cutoff || "pendiente"}</small>
  </div>;
}

export const metadata = { title: "Septiembre 2026 · Cierre mensual | CIDEF" };
export default function CierreMensual() {
  const finance = facts.breakdowns.financial_entities;
  const text = template => template.replace(/\{([a-z0-9_]+)\}/g, (_, id) => display(id));
  return <main className="shell mc">
    <header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">CIERRE HISTÓRICO · SEPTIEMBRE 2026</span></header>
    <section className="mc-intro"><span className="eyebrow">CIERRE MENSUAL</span><h1>Septiembre 2026</h1><p>Ventas, financiamiento y mercado. Cifras verificadas en Azure, con períodos y cortes explícitos.</p></section>
    <div className="mc-warning"><strong>Conciliación de septiembre.</strong> SALES: {display("sales_company")} ventas = {display("sales_own")} propias + {display("sales_dealers")} dealers = {display("sales_foton")} Foton + {display("sales_dongfeng")} Dongfeng. Los datos sin certificación disponible se mantienen pendientes. Los eventos FORUM de septiembre se distinguen de la foto del 30/09.</div>
    <div className="mc-tabs"><span className="mc-active">Compañía</span><span>Tiendas propias</span><span>Dealers</span><span>Foton</span><span>Dongfeng</span></div>
    <section className="mc-kpis">{facts.cards.map(card => <Metric key={card.id} {...card}/>)}</section>
    <ForumClose data={facts}/>
    <PerformanceRanking certification={facts.rankings}/>
    <div className="mc-layout"><section className="mc-panel mc-finance-full">
      <div className="mc-panel-head"><h2>Créditos y financiamiento</h2><span>Tiendas propias · septiembre 2026</span></div>
      <div className="mc-finance-grid"><div className="mc-finance-block"><h3>Financiera registrada en SALES</h3>
        <div className="mc-finance-headline"><div><strong>{display("sales_finance_resolved")}</strong><span>con entidad identificada</span></div><div><strong>{display("sales_finance_unresolved")}</strong><span>sin entidad resuelta</span></div></div>
        <p className="mc-footnote">La falta de entidad no acredita una venta al contado. Los VIN con financiera FORUM en SALES no equivalen a UFIs por fecha de curse.</p>
      </div><div className="mc-finance-block"><h3>Detalle por financiera</h3>
        {finance?.status === "CERTIFIED" ? finance.members.map(entity => <div className="mc-finance-entity" key={entity.member_id}><span>{entity.member_label || entity.member_id}</span><strong>{format(entity.value)} VIN</strong></div>) : <p>Pendiente de certificación.</p>}
        <p className="mc-footnote">SALES P1 · misma base de {display("sales_own")} ventas propias · corte 30/09/2026.</p>
      </div></div>
    </section></div>
    <section className="mc-panel mc-insights"><div className="mc-panel-head"><h2>Lectura ejecutiva</h2><span>SALES · FORUM · RVM</span></div><div className="mc-insightgrid">{analysis.insights.map(insight => <article key={insight.id}><span className="eyebrow">{insight.domain}</span><h3>{insight.title}</h3><p>{text(insight.summary)}</p></article>)}</div></section>
    <section className="mc-panel"><div className="mc-panel-head"><h2>Datos pendientes de certificación</h2><span>Sin estimaciones</span></div>{facts.pending.map(item => <p className="mc-footnote" key={item.id}><strong>{item.label}:</strong> {item.reason}</p>)}</section>
    <details className="mc-panel"><summary>Fuentes y cortes de los indicadores</summary>{Object.entries(facts.indicators).map(([id, item]) => <div key={id} className="mc-row"><span>{item.label}</span><span>{item.source} · {item.period} · {item.cutoff || "sin corte certificado"} · {item.status === "CERTIFIED" ? "Verificado" : "Pendiente"}</span></div>)}</details>
  </main>;
}

