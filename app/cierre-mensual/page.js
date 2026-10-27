import Link from "next/link";
import ForumClose from "../../components/ForumClose";
import MonthlyCloseMetric from "../../components/MonthlyCloseMetric";
import CompanyClosePanels from "../../components/CompanyClosePanels";
import MonthlyCloseRanking from "../../components/MonthlyCloseRanking";
import { buildForumRanking } from "../../lib/monthly-close-ranking";
import { dateText, valueText } from "../../lib/monthly-close-view";
import facts from "../../data/monthly-close/2026-09/facts.json";
import styles from "../../components/CompanyClosePanels.module.css";

export const metadata = { title: "Septiembre 2026 · Cierre mensual | CIDEF" };

export default function CierreMensual() {
  const display = id => valueText(facts.indicators[id]);
  return <main className="shell mc">
    <header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">CIERRE HISTÓRICO · SEPTIEMBRE 2026</span></header>
    <section className="mc-intro"><span className="eyebrow">CIERRE MENSUAL · COMPAÑÍA</span><h1>Septiembre 2026</h1><p>Ventas, financiamiento y posición competitiva. Períodos, comparaciones y cortes certificados por fuente.</p></section>
    <div className="mc-warning"><strong>Base conciliada.</strong> SALES: {display("sales_company")} ventas = {display("sales_own")} propias + {display("sales_dealers")} dealers = {display("sales_foton")} Foton + {display("sales_dongfeng")} Dongfeng. Los faltantes se muestran como Pendiente; septiembre permanece fijo.</div>
    <div className="mc-tabs" aria-label="Vistas del cierre"><span className="mc-active" aria-current="page">Compañía</span>{["Sucursales", "Foton", "Dongfeng", "Dealers"].map(label => <span key={label} aria-disabled="true">{label}</span>)}</div>
    <section className="mc-kpis" aria-label="Indicadores SALES y RVM">{facts.cards.map(config => <MonthlyCloseMetric key={config.id} data={facts} config={config}/>)}</section>
    <ForumClose data={facts}/>
    <MonthlyCloseRanking categories={facts.rankings.categories} forum={buildForumRanking(facts.rankings.categories.forum)}/>
    <CompanyClosePanels data={facts}/>
    <details className={"mc-panel " + styles.panel}><summary>Indicadores pendientes de certificación</summary>{facts.company.pending.map(item => <p key={item.id} className={styles.note}><strong>{item.label}:</strong> {item.reason}</p>)}</details>
    <details className={"mc-panel " + styles.panel + " " + styles.sources}><summary>Fuentes y cortes</summary>
      <p>Fuente única: cierre de septiembre 2026. Observación de la implementación: {dateText(facts.company.observed_at)}.</p>
      {Object.entries(facts.indicators).map(([id, item]) => <p key={id}><strong>{item.label}</strong> · {item.source} · período {item.period} · corte {dateText(item.cutoff)} · {item.status === "CERTIFIED" ? "Certificado" : "Pendiente"}.</p>)}
    </details>
    <section className="mc-panel mc-insights" data-close-conclusions="pending"><div className="mc-panel-head"><h2>Conclusiones ejecutivas</h2><span>Pendiente</span></div><p className="mc-footnote">Pendiente de desarrollar.</p></section>
  </main>;
}

