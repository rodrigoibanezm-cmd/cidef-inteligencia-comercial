import { numberText, valueText } from "../lib/monthly-close-v2-view";
import { FamilyModelTable } from "./ClosingV2ProductDetail";

export default function ClosingBreakdown({ facts }) {
  const finance = facts.reconciliation?.finanzas;
  const indicator = id => valueText(facts.indicators[id]);
  const p1 = id => valueText(facts.channel_sales_p1?.metrics?.[id + "_p1"]);
  const brands = finance?.brands || {};
  const rvmRows = facts.rvm_model_detail?.rows?.filter(row => ["FOTON", "DFM"].includes(row.brand)) || [];
  const rvmTotal = (models, key) => models.length && models.every(row => Number.isFinite(row[key])) ? models.reduce((n,row) => n + row[key],0) : null;
  const rows = [
    ["Foton", brands.FOTON],
    ["Dongfeng DFM", brands.DFM],
    ["Dongfeng DFLM", brands.DFLM]
  ];
  const totals = {
    invoices: finance?.invoice_movements,
    credit_notes: finance?.credit_notes,
    net: finance?.net_units
  };
  return <section className="mc-description" aria-label="Detalle descriptivo cierre comercial">
    <div className="mc-panel-head"><h2>Consolidado de ventas · octubre 2026</h2><span>Fuente: Finanzas · unidades netas</span></div>
    <div className="mc-description-totals">
      <article><span>Facturas</span><strong>{numberText(totals.invoices)}</strong></article>
      <article><span>Notas de crédito</span><strong>−{numberText(totals.credit_notes)}</strong></article>
      <article><span>Ventas netas</span><strong>{indicator("sales_company")}</strong></article>
    </div>
    <div className="mc-description-table">
      <table><thead><tr><th>Marca / línea</th><th>Facturas</th><th>Notas de crédito</th><th>Neto</th></tr></thead>
        <tbody>{rows.map(([name, row]) => <tr key={name}><th scope="row">{name}</th><td>{numberText(row?.invoices)}</td><td className="mc-description-negative">−{numberText(row?.credit_notes)}</td><td><strong>{numberText(row?.net)}</strong></td></tr>)}</tbody>
        <tfoot><tr><th scope="row">TOTAL COMPAÑÍA</th><td>{numberText(totals.invoices)}</td><td className="mc-description-negative">−{numberText(totals.credit_notes)}</td><td>{numberText(totals.net)}</td></tr></tfoot>
      </table>
    </div>
    <div className="mc-description-channels">
      <article><h3>Tiendas propias · P1</h3><strong>{p1("sales_own")}</strong><p>Foton {p1("sales_foton_own")} · Dongfeng {p1("sales_dongfeng_own")}. Ventas comerciales antes de NC contables.</p></article>
      <article><h3>Dealers · P1</h3><strong>{p1("sales_dealers")}</strong><p>Foton {p1("sales_foton_dealers")} · Dongfeng {p1("sales_dongfeng_dealers")}. Ventas comerciales antes de NC contables.</p></article>
    </div>
    {facts.rvm_model_detail?.status === "CERTIFIED" && <section aria-label="Detalle RVM por marca familia y modelo" style={{marginTop:24}}>
      <div className="mc-panel-head"><h2>Inscripciones RVM · familia y modelo</h2><span>Octubre 2026 · acumulado enero–octubre</span></div>
      {([["FOTON","Foton"],["DFM","Dongfeng · DFM"]]).map(([brand,title]) => {
        const models = rvmRows.filter(row => row.brand === brand);
        const total = key => rvmTotal(models, key);
        const order = brand === "FOTON" ? ["MINI_TRUCK", "PICKUP", "VP"] : ["AEOLUS", "FORTHING"];
        const families = [...order, ...new Set(models.map(row => row.family).filter(family => !order.includes(family)))];
        const groups = families.map(family => {
          const detail = models.filter(row => row.family === family);
          const familyTotal = key => detail.length && detail.every(row => Number.isFinite(row[key])) ? numberText(detail.reduce((n,row) => n + row[key],0)) : "Pendiente";
          return { label:family, values:[familyTotal("month"), "Pendiente", "Pendiente", familyTotal("ytd")], models:detail.map(row => ({
            id:row.segment + ":" + row.model, label:row.model,
            values:[numberText(row.month), Number.isFinite(row.rank) ? row.rank + "°" : "Pendiente", Number.isFinite(row.participation_percent) ? row.participation_percent.toLocaleString("es-CL", {maximumFractionDigits:2}) + "%" : "Pendiente", numberText(row.ytd)]
          })) };
        });
        return <div key={brand} style={{marginBottom:24}}>
          <h3>{title} · {numberText(total("month"))} inscritos en octubre · {numberText(total("ytd"))} acumulados</h3>
          <FamilyModelTable columns={["Familia / Modelo", "Inscritos mes", "Ranking RVM", "Participación", "Acum. 2026"]} groups={groups} totalLabel={"Total " + title} totalValues={[numberText(total("month")), "Pendiente", "Pendiente", numberText(total("ytd"))]}/>
        </div>;
      })}
      <div className="mc-product-total"><span>Total RVM · Foton + DFM</span><span>Mes: {numberText(rvmTotal(rvmRows, "month"))} · Acumulado: {numberText(rvmTotal(rvmRows, "ytd"))}</span></div>
      <p className="mc-description-note">Ranking y participación de cada modelo: contra su segmento RVM. Los rankings por familia quedan sin calcular porque las familias comerciales no siempre coinciden con los segmentos RVM. Fuente: RVM/P1; inscripciones, no ventas facturadas.</p>
    </section>}
    <p className="mc-description-note">Ventas comerciales: SALES/P1 antes de NC, detalladas arriba por canal. RVM: inscripciones y participación de cada modelo en su segmento; no se suman a las ventas. El desglose contable neto por modelo permanece pendiente.</p>
  </section>;
}


