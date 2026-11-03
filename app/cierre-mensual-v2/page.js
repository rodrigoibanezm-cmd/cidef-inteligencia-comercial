import Link from "next/link";
import MonthlyCloseV2Metric from "../../components/MonthlyCloseV2Metric";
import MonthlyCloseV2Ranking from "../../components/MonthlyCloseV2Ranking";
import ClosingV2Breakdown from "../../components/ClosingV2Breakdown";
import ClosingV2Totals from "../../components/ClosingV2Totals";
import { numberText, valueText } from "../../lib/monthly-close-v2-view";
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
    <StoreCloseTable data={facts.store_close}/>
  </main>;
}

function StoreCloseTrend({ values }) {
  if (!Array.isArray(values) || values.length !== 4) return <span>Pendiente</span>;
  const valid = values.filter(Number.isFinite), min = Math.min(...valid), span = Math.max(...valid) - min || 1;
  const x = i => 16 + i * 50, y = value => 39 - (value - min) / span * 18;
  const months = ["Jul", "Ago", "Sep", "Oct"];
  return <svg className="mc-store-spark" viewBox="0 0 182 62" role="img" aria-label={months.map((month, i) => month + ": " + numberText(values[i])).join("; ")}>
    {values.map((value, i) => <g key={months[i]}>
      {Number.isFinite(value) && Number.isFinite(values[i - 1]) && <line x1={x(i - 1)} y1={y(values[i - 1])} x2={x(i)} y2={y(value)} stroke="#2563eb" strokeWidth="2"/>}
      {Number.isFinite(value) && <circle cx={x(i)} cy={y(value)} r="2.5" fill="#2563eb"/>}
      <text x={x(i)} y="12" textAnchor="middle">{Number.isFinite(value) ? numberText(value) : "—"}</text>
      <text x={x(i)} y="58" textAnchor="middle" fill="#697487">{months[i]}</text>
    </g>)}
  </svg>;
}

function StoreCloseTable({ data }) {
  if (!Array.isArray(data?.rows) || !data.rows.length) return <section className="mc-description"><h2>Cierre por sucursal</h2><p>Pendiente de datos por sucursal.</p></section>;
  const signed = value => Number.isFinite(value) ? (value > 0 ? "+" : "") + numberText(value) : "Pendiente";
  const tone = value => Number.isFinite(value) ? (value < 0 ? "mc-store-negative" : value > 0 ? "mc-store-positive" : "") : "";
  const growth = row => Number.isFinite(row.growth?.relative_delta) ? (row.growth.relative_delta > 0 ? "+" : "") + (row.growth.relative_delta * 100).toLocaleString("es-CL", {maximumFractionDigits:1}) + "%" : "Sin base";
  const row = (item, total = false) => <tr key={item.id || "total"}>
    <th scope="row">{total ? "TOTAL" : item.name}</th>
    <td>{numberText(item.sales)} ({numberText(item.foton)}/{numberText(item.dongfeng)})</td>
    <td className="mc-store-negative">{Number.isFinite(item.credit_notes) ? (item.credit_notes ? "−" : "") + numberText(item.credit_notes) : "Pendiente"}</td>
    <td><strong>{numberText(item.net)}</strong></td><td>{numberText(item.target)}</td>
    <td className={tone(item.gap)}>{signed(item.gap)}</td>
    <td className={tone(item.growth?.relative_delta)}>{growth(item)}</td>
    <td><StoreCloseTrend values={item.history}/></td>
  </tr>;
  return <section className="mc-description mc-store-close" aria-label="Cierre mensual por sucursal">
    <style>{`.mc-store-close .mc-description-table{border:1px solid #e1e5ec;border-radius:14px}.mc-store-close table{min-width:1040px;font-variant-numeric:tabular-nums}.mc-store-close th,.mc-store-close td{text-align:center;padding:10px 8px;border-right:1px solid #e5eaf1}.mc-store-close th:first-child{text-align:left;width:26%;padding-left:16px}.mc-store-close thead th{background:#192f4c;color:#fff;font-weight:600}.mc-store-close tbody tr:nth-child(even){background:#f4f6f9}.mc-store-close tbody th{font-weight:500}.mc-store-close tfoot{background:#eaf0f7;border-top:2px solid #cbd5e1;font-weight:750}.mc-store-negative{color:#dc2626;font-weight:750}.mc-store-positive{color:#2563eb;font-weight:750}.mc-store-spark{display:block;width:182px;height:62px;margin:auto;font-size:10px}`}</style>
    <div className="mc-panel-head"><h2>Tiendas Propias · Cierre por sucursal</h2><span>Octubre 2026 · corte 31/10</span></div>
    <p className="mc-description-note">Total = Ventas − NC. Brecha = Total − Meta. Crecimiento y tendencia: ventas P1 antes de NC, con la misma base en cada mes.</p>
    <div className="mc-description-table"><table>
      <thead><tr>{["Sucursal", "Ventas (F/D)", "Nota de crédito", "Total", "Meta", "Brecha ↑", "Crecimiento vs septiembre", "Tendencia · últimos 4 meses"].map((label, i) => <th key={label} scope="col" aria-sort={i === 5 ? "ascending" : undefined}>{label}</th>)}</tr></thead>
      <tbody>{data.rows.map(item => row(item))}</tbody><tfoot>{row(data.totals, true)}</tfoot>
    </table></div>
    <p className="mc-description-note">F/D: Foton/Dongfeng. Ventas e historia: SALES/P1; crecimiento: P2. Metas y NC: Seguimiento de Cierre existente. Cada tendencia usa su propia escala y muestra los valores. La ausencia histórica se mantiene sin dato; el total histórico incluye las tiendas reconocidas en cada mes.</p>
  </section>;
}


