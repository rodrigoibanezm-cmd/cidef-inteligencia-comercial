import Link from "next/link";
import MonthlyCloseV2Metric from "../../components/MonthlyCloseV2Metric";
import MonthlyCloseV2Ranking from "../../components/MonthlyCloseV2Ranking";
import ClosingV2Totals from "../../components/ClosingV2Totals";
import { numberText, valueText } from "../../lib/monthly-close-v2-view";
import facts from "../../data/monthly-close/2026-10/facts.json";

export const metadata = { title: "Octubre 2026 · Cierre mensual | CIDEF" };

export default function CierreMensual() {
  const display = id => valueText(facts.indicators[id]);
  return <main className="shell mc mc-close-clean">
    <style>{`.mc-close-clean .mc-executive-heading>small,.mc-close-clean .mc-executive-foot,.mc-close-clean .mc-commercial-detail>p:last-child,.mc-close-clean .mc-description-note,.mc-close-clean .mc-source-note,.mc-close-clean .mc-index-note,.mc-close-clean .mc-trend-card>small,.mc-close-clean [aria-label="Inscripciones RVM, variación mensual e interanual"]>small,.mc-close-clean .forum-exec-header p{display:none}`}</style>
    <header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">CIERRE CONTABLE · OCTUBRE 2026</span></header>
    <section className="mc-intro"><span className="eyebrow">CIERRE MENSUAL · COMPAÑÍA</span><h1>Octubre 2026</h1><p>Ventas, financiamiento y posición competitiva. Finanzas tiene prioridad por mes; los meses anteriores utilizan SALES/P1 cuando no hay cierre de Finanzas.</p></section>
    <div className="mc-warning"><strong>Ventas contables de octubre.</strong> {display("sales_company")} unidades netas = {display("sales_foton")} Foton + {display("sales_dongfeng")} Dongfeng (DFM + DFLM). Facturas 965 · Notas de crédito 55. Canales SALES/P1 y RVM disponibles; cifras por conciliar.</div>
    <div className="mc-tabs" aria-label="Vistas del cierre"><span className="mc-active" aria-current="page">Compañía</span></div>
    <ClosingV2Totals facts={facts}/>
    <section className="mc-forum-executive" aria-label="FORUM · desempeño del financiamiento">
      <div className="forum-exec-header"><div><h2>FORUM · Desempeño del financiamiento</h2><p>Octubre 2026 · observaciones P1 y comparativos P2</p></div><span>FORUM</span></div>
      <div className="forum-exec-grid">{facts.company.forum_cards.map(config => <MonthlyCloseV2Metric key={config.id} data={facts} config={config}/>)}</div>
    </section>
    <StoreCloseTable data={facts.store_close}/>
    <DealerCloseTable data={facts.dealer_close}/>
    <MonthlyCloseV2Ranking period="2026-10" categories={facts.rankings.categories} forum={null}/>
  </main>;
}

function StoreCloseTrend({ values, compact = false }) {
  if (!Array.isArray(values) || values.length !== 4) return <span>Pendiente</span>;
  const valid = values.filter(Number.isFinite), min = Math.min(...valid), span = Math.max(...valid) - min || 1;
  const x = i => 14 + i * 44, y = value => (compact ? 18 : 24) - (value - min) / span * (compact ? 6 : 10);
  const months = ["Jul", "Ago", "Sep", "Oct"];
  return <svg className="mc-store-spark" viewBox={compact ? "0 0 160 20" : "0 0 160 26"} style={compact ? {height:20} : undefined} role="img" aria-label={months.map((month, i) => month + ": " + numberText(values[i])).join("; ")}>
    {values.map((value, i) => <g key={months[i]}>
      {Number.isFinite(value) && Number.isFinite(values[i - 1]) && <line x1={x(i - 1)} y1={y(values[i - 1])} x2={x(i)} y2={y(value)} stroke="#2563eb" strokeWidth="2"/>}
      {Number.isFinite(value) && <circle cx={x(i)} cy={y(value)} r="2" fill="#2563eb"/>}
      <text x={x(i)} y="9" textAnchor="middle">{Number.isFinite(value) ? numberText(value) : "—"}</text>
    </g>)}
  </svg>;
}

function StoreSellerDetail({ store }) {
  const detail = store.seller_detail;
  if (detail?.status !== "RECONCILED" || !Array.isArray(detail.rows)) return <p role="status">Detalle por vendedor pendiente.</p>;
  return <table className="mc-store-seller-table" aria-label={"Vendedores · " + store.name}>
    <colgroup>{[44,10,10,10,26].map((width, i) => <col key={i} style={{width:width + "%"}}/>)}</colgroup>
    <thead><tr>{["Vendedor", "Total mes", "Foton", "Dongfeng", "Tendencia · jul–oct"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{detail.rows.map(seller => <tr key={seller.id} className={seller.kind === "OUTSIDE_ROSTER" ? "mc-seller-unassigned" : undefined}>
      <th scope="row" title={seller.kind === "OUTSIDE_ROSTER" ? "Ventas de la tienda con vendedor fuera de la nómina actual de Proyecciones o sin identidad resuelta" : undefined}>{seller.name}</th>
      <td><strong>{numberText(seller.sales)}</strong></td><td>{numberText(seller.foton)}</td><td>{numberText(seller.dongfeng)}</td>
      <td><StoreCloseTrend values={seller.history}/></td>
    </tr>)}</tbody>
    <tfoot><tr><th scope="row">Total tienda · antes de NC</th><td>{numberText(store.sales)}</td><td>{numberText(store.foton)}</td><td>{numberText(store.dongfeng)}</td><td><StoreCloseTrend values={store.history}/></td></tr></tfoot>
  </table>;
}

function StoreCloseTable({ data }) {
  if (!Array.isArray(data?.rows) || !data.rows.length) return <section className="mc-description"><h2>Cierre por sucursal</h2><p>Pendiente de datos por sucursal.</p></section>;
  const signed = value => Number.isFinite(value) ? (value > 0 ? "+" : "") + numberText(value) : "Pendiente";
  const tone = value => Number.isFinite(value) ? (value < 0 ? "mc-store-negative" : value > 0 ? "mc-store-positive" : "") : "";
  const growth = row => Number.isFinite(row.growth?.relative_delta) ? (row.growth.relative_delta > 0 ? "+" : "") + (row.growth.relative_delta * 100).toLocaleString("es-CL", {maximumFractionDigits:1}) + "%" : "Sin base";
  const yoy = item => Number.isFinite(item.yoy?.relative_delta) ? (item.yoy.relative_delta > 0 ? "+" : "") + (item.yoy.relative_delta * 100).toLocaleString("es-CL", {maximumFractionDigits:1}) + "%" : item.yoy?.status === "NO_BASELINE" ? "Sin base" : "Pendiente";
  const row = (item, total = false) => <tr key={item.id || "total"}>
    <th scope="row">{total ? "TOTAL" : <details className="mc-store-disclosure"><summary id={"store-name-" + item.id} aria-controls={"store-sellers-" + item.id}>{item.name}</summary><span className="mc-store-sr">Detalle por vendedor en la fila siguiente.</span></details>}</th>
    <td>{numberText(item.sales)} ({numberText(item.foton)}/{numberText(item.dongfeng)})</td>
    <td className="mc-store-negative">{Number.isFinite(item.credit_notes) ? (item.credit_notes ? "−" : "") + numberText(item.credit_notes) : "Pendiente"}</td>
    <td><strong>{numberText(item.net)}</strong></td><td>{numberText(item.target)}</td>
    <td className={tone(item.gap)}>{signed(item.gap)}</td>
    <td className={tone(item.growth?.relative_delta)}>{growth(item)}</td>
    <td className={tone(item.yoy?.relative_delta)} title={Number.isFinite(item.yoy?.baseline_value) ? "Octubre 2025: " + numberText(item.yoy.baseline_value) + " ventas antes de NC" : undefined}>{yoy(item)}</td>
    <td><StoreCloseTrend values={item.history}/></td>
  </tr>;
  return <section className="mc-description mc-store-close" aria-label="Cierre mensual por sucursal">
    <style>{`.mc-store-close .mc-description-table{border:1px solid #e1e5ec;border-radius:14px}.mc-store-close{padding:16px}.mc-store-close .mc-panel-head{margin-bottom:8px}.mc-store-close .mc-description-note{margin:6px 0;font-size:10px;line-height:1.35}.mc-store-close table{min-width:900px;width:100%;table-layout:fixed;font-size:12px;font-variant-numeric:tabular-nums}.mc-store-close th,.mc-store-close td{text-align:center;padding:2px 6px;line-height:1.2;border-right:1px solid #e5eaf1}.mc-store-close th:first-child{text-align:left;width:25%;padding-left:10px}.mc-store-close thead th{background:#192f4c;color:#fff;font-weight:600;height:32px;padding:6px}.mc-store-close .mc-store-group:nth-of-type(even)>tr:first-child{background:#f4f6f9}.mc-store-close tbody th{font-weight:500}.mc-store-close tfoot{background:#eaf0f7;border-top:2px solid #cbd5e1;font-weight:750}.mc-store-negative{color:#dc2626;font-weight:750}.mc-store-positive{color:#2563eb;font-weight:750}.mc-store-spark{display:block;width:160px;max-width:100%;height:26px;margin:auto;font-size:10px}.mc-store-disclosure summary{cursor:pointer;list-style:disclosure-closed inside;font-weight:500}.mc-store-disclosure[open] summary{list-style:disclosure-open inside;font-weight:750}.mc-store-disclosure summary:focus-visible{outline:2px solid #2563eb;outline-offset:3px}.mc-store-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.mc-store-group:not(:has(.mc-store-disclosure[open]))>.mc-store-seller-detail{display:none}.mc-store-close .mc-store-seller-detail>td{padding:10px 16px 14px;background:#f8fafc}.mc-store-close .mc-store-seller-table{min-width:0;border:1px solid #dce4ef;border-radius:8px;background:white}.mc-store-close .mc-store-seller-table th:first-child{width:44%;padding-left:10px}.mc-store-close .mc-store-seller-table thead th{background:#e5edf8;color:#192f4c;height:30px}.mc-store-close .mc-store-seller-table tbody th{font-weight:500}.mc-store-close .mc-store-seller-table tbody tr:nth-child(even){background:#f4f6f9}.mc-store-close .mc-seller-unassigned th{color:#697487}.mc-store-close .mc-store-seller-table tfoot,.mc-store-close .mc-store-seller-table tfoot th{font-weight:750}`}</style>
    <div className="mc-panel-head"><h2>Tiendas Propias · Cierre por sucursal</h2><span>Octubre 2026 · corte 31/10</span></div>
    <p className="mc-description-note">Total = Ventas − NC. Brecha = Total − Meta. Crecimiento y tendencia: ventas P1 antes de NC, con la misma base en cada mes.</p>
    <div className="mc-description-table"><table>
      <colgroup>{[25,11,5,6,6,6,10,10,21].map((width, i) => <col key={i} style={{width:width + "%"}}/>)}</colgroup>
      <thead><tr>{["Sucursal", "Ventas (F/D)", "NC", "Total", "Meta", "Brecha ↑", "Crec. vs sep.", "YoY · oct. 25", "Tendencia · jul–oct"].map((label, i) => <th key={label} scope="col" title={i === 2 ? "Nota de crédito" : i === 6 ? "Crecimiento vs septiembre" : i === 7 ? "Crecimiento vs octubre de 2025 · ventas P1 antes de NC" : undefined} aria-sort={i === 5 ? "ascending" : undefined}>{label}</th>)}</tr></thead>
      {data.rows.map(item => <tbody className="mc-store-group" key={item.id}>{row(item)}
        <tr className="mc-store-seller-detail" id={"store-sellers-" + item.id}><td colSpan={9}><StoreSellerDetail store={item}/></td></tr>
      </tbody>)}<tfoot>{row(data.totals, true)}</tfoot>
    </table></div>
    <p className="mc-description-note">F/D: Foton/Dongfeng. NC: notas de crédito. Tendencia: julio, agosto, septiembre y octubre. Ventas e historia: SALES/P1; crecimiento: P2. Metas y NC: Seguimiento de Cierre existente. Cada tendencia usa su propia escala y muestra los valores. La ausencia histórica se mantiene sin dato; el total histórico incluye las tiendas reconocidas en cada mes.</p>
  </section>;
}


function DealerCloseTable({ data }) {
  if (data?.status !== "RECONCILED" || !Array.isArray(data.rows)) return null;
  const row = (item, total = false) => <tr key={item.id || "total"}>
    <th scope="row">{total ? "TOTAL DEALERS" : item.name}</th>
    <td><strong>{numberText(item.sales)}</strong></td><td>{numberText(item.foton)}</td><td>{numberText(item.dongfeng)}</td>
    <td>{numberText(item.previous_year_sales)}</td><td>{numberText(item.previous_month_sales)}</td>
    <td><StoreCloseTrend values={item.history} compact/></td>
  </tr>;
  return <section className="mc-description mc-store-close mc-dealer-close" aria-label="Cierre mensual por dealer">
    <style>{`.mc-dealer-close th:first-child{width:30%}.mc-dealer-close tbody tr:nth-child(even){background:#f4f6f9}.mc-dealer-close tfoot th{font-weight:750}`}</style>
    <div className="mc-panel-head"><h2>Dealers · Cierre por dealer</h2><span>Octubre 2026 · corte 31/10</span></div>
    <div className="mc-description-table"><table>
      <colgroup>{[30,10,9,9,11,11,20].map((width, i) => <col key={i} style={{width:width + "%"}}/>)}</colgroup>
      <thead><tr>{["Dealer", "Total octubre", "Foton", "Dongfeng", "Octubre 2025", "Septiembre 2026", "Tendencia · jul–oct"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data.rows.map(item => row(item))}</tbody><tfoot>{row(data.totals, true)}</tfoot>
    </table></div>
  </section>;
}
