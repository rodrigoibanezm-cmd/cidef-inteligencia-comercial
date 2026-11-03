import Link from "next/link";
import MonthlyCloseV2Metric from "../../components/MonthlyCloseV2Metric";
import MonthlyCloseV2Ranking from "../../components/MonthlyCloseV2Ranking";
import ClosingV2Breakdown from "../../components/ClosingV2Breakdown";
import ClosingV2Totals from "../../components/ClosingV2Totals";
import { valueText } from "../../lib/monthly-close-v2-view";
import facts from "../../data/monthly-close/2026-10/facts.json";

export const metadata = { title: "Octubre 2026 · Cierre mensual | CIDEF" };

export default function CierreMensual() {
  const display = id => valueText(facts.indicators[id]);
  return <main className="shell mc">
    <header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">CIERRE CONTABLE · OCTUBRE 2026</span></header>
    <section className="mc-intro"><span className="eyebrow">CIERRE MENSUAL · COMPAÑÍA</span><h1>Octubre 2026</h1><p>Ventas, financiamiento y posición competitiva. Finanzas tiene prioridad por mes; los meses anteriores utilizan SALES/P1 cuando no hay cierre de Finanzas.</p></section>
    <div className="mc-warning"><strong>Ventas contables de octubre.</strong> {display("sales_company")} unidades netas = {display("sales_foton")} Foton + {display("sales_dongfeng")} Dongfeng (DFM + DFLM). Facturas 965 · Notas de crédito 55. Canales SALES/P1 y RVM disponibles; cifras por conciliar.</div>
    <div className="mc-tabs" aria-label="Vistas del cierre"><span className="mc-active" aria-current="page">Compañía</span>{["Sucursales", "Foton", "Dongfeng", "Dealers"].map(label => <span key={label} aria-disabled="true">{label}</span>)}</div>
    <ClosingV2Totals facts={facts}/>
    <div className="mc-executive-heading mc-analysis-heading"><div><span className="eyebrow">ANÁLISIS Y TENDENCIAS</span><h2>Indicadores y evolución</h2></div></div>
    <section className="mc-kpis" aria-label="Indicadores de ventas">{facts.cards.filter(config => config.id.startsWith("sales_")).map(config => <MonthlyCloseV2Metric key={config.id} data={facts} config={config}/>)}</section>
    <ClosingV2Breakdown facts={facts}/>
    <section className="mc-forum-executive" aria-label="FORUM · desempeño del financiamiento">
      <div className="forum-exec-header"><div><h2>FORUM · Desempeño del financiamiento</h2><p>Octubre 2026 · observaciones P1 y comparativos P2</p></div><span>FORUM</span></div>
      <div className="forum-exec-grid">{facts.company.forum_cards.map(config => <MonthlyCloseV2Metric key={config.id} data={facts} config={config}/>)}</div>
    </section>
    <section className="mc-kpis" aria-label="Indicadores RVM">{facts.cards.filter(config => config.id.startsWith("rvm_")).map(config => <MonthlyCloseV2Metric key={config.id} data={facts} config={config}/>)}</section>
    <MonthlyCloseV2Ranking period="2026-10" categories={facts.rankings.categories} forum={null}/>
  </main>;
}

