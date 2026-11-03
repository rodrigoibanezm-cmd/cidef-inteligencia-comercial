import { numberText, valueText } from "../lib/monthly-close-v2-view";

export default function ClosingBreakdown({ facts }) {
  const finance = facts.reconciliation?.finanzas;
  const indicator = id => valueText(facts.indicators[id]);
  const p1 = id => valueText(facts.channel_sales_p1?.metrics?.[id + "_p1"]);
  const brands = finance?.brands || {};
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
    <p className="mc-description-note">Ventas comerciales: SALES/P1 antes de NC, detalladas arriba por canal. RVM: inscripciones y participación de cada modelo en su segmento; no se suman a las ventas. El desglose contable neto por modelo permanece pendiente.</p>
  </section>;
}


