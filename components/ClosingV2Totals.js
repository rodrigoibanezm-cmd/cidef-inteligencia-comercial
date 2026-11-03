import { valueText } from "../lib/monthly-close-v2-view";
import { FourMonthTrend } from "./MonthlyCloseV2Metric";

// All numbers and series originate in the period snapshot, never calculated here.
export default function ExecutiveTotals({ facts }) {
  const value = id => valueText(facts.indicators[id]);
  const adjustments = facts.financial_adjustments;
  const p1 = facts.channel_sales_p1?.metrics || {};
  const count = x => typeof x === "number" ? x.toLocaleString("es-CL") : "Pendiente";
  const channelValue = (section, id) => section.id === "sales_company" ? value(id) : valueText(p1[id + "_p1"]);
  const sections = [
    { label: "Compañía", id: "sales_company", foton: "sales_foton", dongfeng: "sales_dongfeng" },
    { label: "Tiendas propias", id: "sales_own", foton: "sales_foton_own", dongfeng: "sales_dongfeng_own", p1: true },
    { label: "Dealers", id: "sales_dealers", foton: "sales_foton_dealers", dongfeng: "sales_dongfeng_dealers", p1: true }
  ];
  return <section className="mc-executive" aria-label="Grandes totales de ventas">
    <div className="mc-executive-heading"><div><span className="eyebrow">RESULTADO COMERCIAL</span><h2>Grandes totales</h2></div><small>Octubre 2026 · Compañía Finanzas neto / canales P1 antes de NC</small></div>
    <div className="mc-executive-grid">{sections.map(section => {
      const yoy = facts.company?.yoy?.[section.id];
      return <article className="mc-executive-card" key={section.id}>
        <h3>{section.label}</h3>
        <div className="mc-executive-value">{channelValue(section, section.id)}<span>{section.p1 ? " ventas P1 · antes de NC" : " unidades netas"}</span></div>
        {section.id === "sales_company" && adjustments && <div className="mc-executive-adjustment">
          <div><span>Vendido neto del mes</span><strong>{value("sales_company")}</strong></div>
          <div className="mc-executive-nc"><span>NC de meses anteriores</span><strong>{count(adjustments.prior_period_credit_notes?.value)}</strong></div>
          <div className="mc-executive-adjusted"><span>Total financiero ajustado</span><strong>{count(adjustments.adjusted_total?.value)}</strong></div>
        </div>}
        <div className="mc-executive-brands">
          <div><span>Foton</span><strong>{channelValue(section, section.foton)}</strong></div>
          <div><span>Dongfeng</span><strong>{channelValue(section, section.dongfeng)}</strong></div>
        </div>
        <div className="mc-executive-yoy"><span>Crecimiento YoY · vs octubre 2025</span><strong>{valueText(yoy)}</strong></div>
        {section.id === "sales_own" && <section className="mc-executive-financing" aria-label="Financiamiento tiendas propias">
          <h4>Financiamiento · SALES/P1</h4>
          <div className="mc-executive-finance-head"><span>Entidad</span><span>Unidades</span><span>Penetración</span></div>
          {["FORUM", "TANNER", "GLOBAL SOLUCIONES", "AUTOFIN", "Sin financiera identificada"].map(name => {
            const breakdown = facts.breakdowns?.financial_entities;
            const member = breakdown?.status === "CERTIFIED" ? breakdown.members?.find(row => name === "Sin financiera identificada" ? row.member_id === "UNRESOLVED" : row.member_id === name) : null;
            const metric = facts.company?.financing?.find(row => row.name === name);
            return <div className="mc-executive-finance-row" key={name}>
              <span>{name === "GLOBAL SOLUCIONES" ? "Global Soluciones" : name === "Sin financiera identificada" ? name : name.charAt(0) + name.slice(1).toLowerCase()}</span>
              <strong>{member ? member.value.toLocaleString("es-CL") : "Pendiente"}</strong>
              <strong>{valueText(metric?.penetration)}</strong>
            </div>;
          })}
          <div className="mc-executive-finance-row mc-executive-finance-total"><span>Total tiendas propias · P1</span><strong>{channelValue(section, "sales_own")}</strong><strong>{facts.breakdowns?.financial_entities?.status === "CERTIFIED" ? "100%" : "Pendiente"}</strong></div>
        </section>}

      </article>;
    })}</div>
    {facts.rvm_yoy_comparison && <section className="mc-executive-card" aria-label="Crecimiento interanual RVM" style={{marginTop:20}}>
      <h3>Mercado vs. CIDEF · inscripciones RVM</h3>
      <p>Octubre 2026 frente a octubre 2025 · misma fuente y período</p>
      <div className="mc-description-totals">
        <article><span>Mercado total</span><strong>+{facts.rvm_yoy_comparison.market.variation_percent.toLocaleString("es-CL")}%</strong><small>{count(facts.rvm_yoy_comparison.market.previous)} → {count(facts.rvm_yoy_comparison.market.current)} inscritos</small></article>
        <article><span>CIDEF · Foton + DFM</span><strong>+{facts.rvm_yoy_comparison.cidef.variation_percent.toLocaleString("es-CL")}%</strong><small>{count(facts.rvm_yoy_comparison.cidef.previous)} → {count(facts.rvm_yoy_comparison.cidef.current)} inscritos</small></article>
        <article><span>Diferencia CIDEF vs. mercado</span><strong>+{facts.rvm_yoy_comparison.difference_pp.toLocaleString("es-CL")} pp</strong><small>Variación interanual</small></article>
      </div>
      <small>Fuente: RVM/P1 · Inscripciones, no ventas facturadas.</small>
    </section>}
    <div className="mc-executive-heading mc-trends-heading"><div><span className="eyebrow">EVOLUCIÓN COMERCIAL</span><h2>Últimos cuatro meses · base julio = 100</h2></div></div>
    <div className="mc-executive-grid mc-executive-trends">
      {sections.map(section => <article className="mc-executive-card mc-trend-card" key={section.id}>
        <h3>{section.label}</h3>
        <div className="mc-executive-trend">
          <FourMonthTrend data={facts} series={section.p1 ? {COMPANY: section.id + "_p1", FOTON: section.foton + "_p1", DONGFENG: section.dongfeng + "_p1"} : facts.cards.find(card => card.id === section.id)?.series} label={section.label} perCardScale/>
        </div>
        <small>{section.p1 ? "Fuente SALES/P1 · antes de NC contables" : "Julio–septiembre SALES/P1 · octubre Finanzas"}</small>
      </article>)}
    </div>
    <p className="mc-executive-foot">Compañía: 910 unidades netas Finanzas. Tiendas Propias (458) y Dealers (507): 965 ventas P1 antes de descontar NC; no son el desglose neto contable. Sin asignación de NC por canal.</p>
  </section>;
}
