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
    {facts.rvm_model_detail?.status === "CERTIFIED" && <section aria-label="Detalle RVM por marca familia y modelo" style={{marginTop:24}}>
      <div className="mc-panel-head"><h2>Inscripciones RVM · familia y modelo</h2><span>Octubre 2026 · acumulado enero–octubre</span></div>
      {([["FOTON","Foton"],["DFM","Dongfeng · DFM"]]).map(([brand,title]) => {
        const models = facts.rvm_model_detail.rows.filter(row => row.brand === brand);
        const total = key => models.reduce((n,row) => n + row[key],0);
        const families = [...new Set(models.map(row => row.family))];
        return <div key={brand} style={{marginBottom:24}}>
          <h3>{title} · {numberText(total("month"))} inscritos en octubre · {numberText(total("ytd"))} acumulados</h3>
          <div className="mc-description-table" style={{overflowX:"auto"}}>
            <table>
              <thead><tr><th>Familia / Modelo</th><th>Ranking RVM</th><th>Participación</th><th>Octubre</th><th>Acum. 2026</th></tr></thead>
              <tbody>{families.map(family => {
                const detail = models.filter(row => row.family === family);
                const familyMonth = detail.reduce((n,row) => n + row.month,0);
                const familyYtd = detail.reduce((n,row) => n + row.ytd,0);
                return <tr key={family}><td colSpan={5} style={{padding:0}}>
                  <details>
                    <summary style={{cursor:"pointer",padding:"10px 12px",background:"#eaf0f7",fontWeight:750,display:"grid",gridTemplateColumns:"minmax(160px, 2fr) repeat(4,minmax(80px, 1fr))",gap:8}}>
                      <span>{family}</span><span style={{textAlign:"center"}}>—</span><span style={{textAlign:"center"}}>—</span>
                      <span style={{textAlign:"center"}}>{numberText(familyMonth)}</span>
                      <span style={{textAlign:"center"}}>{numberText(familyYtd)}</span>
                    </summary>
                    <table style={{width:"100%"}}><tbody>{detail.map(row => <tr key={row.segment + row.model}>
                      <th scope="row" style={{paddingLeft:24}}>{row.model}</th>
                      <td>{row.rank == null ? "—" : row.rank + "°"}</td>
                      <td>{row.month ? row.participation_percent.toLocaleString("es-CL", {maximumFractionDigits:2}) + "%" : "—"}</td>
                      <td>{numberText(row.month)}</td><td>{numberText(row.ytd)}</td>
                    </tr>)}</tbody></table>
                  </details>
                </td></tr>;
              })}</tbody>
              <tfoot><tr><th>Total {title}</th><td>—</td><td>—</td><td>{numberText(total("month"))}</td><td>{numberText(total("ytd"))}</td></tr></tfoot>
            </table>
          </div>
        </div>;
      })}
      <p className="mc-description-note">Ranking y participación de cada modelo: contra su segmento RVM. Los rankings por familia quedan sin calcular porque las familias comerciales no siempre coinciden con los segmentos RVM. Fuente: RVM/P1; inscripciones, no ventas facturadas.</p>
    </section>}
    <p className="mc-description-note">El seguimiento comercial incluye proyecciones, enviados no facturados, metas y brechas; esos indicadores operativos no se suman a las ventas contables de un mes cerrado. Detalle RVM por familia y modelo incorporado; el desglose contable de ventas por modelo permanece pendiente.</p>
  </section>;
}

