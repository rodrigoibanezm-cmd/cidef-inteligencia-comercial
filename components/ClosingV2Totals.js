import { valueText } from "../lib/monthly-close-v2-view";
import { FourMonthTrend } from "./MonthlyCloseV2Metric";
import CommercialProductDetail, { CommercialDetailProvider } from "./ClosingV2ProductDetail";

// All numbers and series originate in the period snapshot, never calculated here.
export default function ExecutiveTotals({ facts }) {
  const value = id => valueText(facts.indicators[id]);
  const creditNotes = facts.financial_adjustments?.credit_notes;
  const p1 = facts.channel_sales_p1?.metrics || {};
  const count = x => Number.isFinite(x) ? x.toLocaleString("es-CL") : "Pendiente";
  const channelValue = (section, id) => section.id === "sales_company" ? value(id) : valueText(p1[id + "_p1"]);
  const history = facts.rvm_yoy_comparison?.monthly_history;
  const rvmTrend = {period:facts.period, series:Object.fromEntries(Object.entries(history?.series || {}).map(([id, values]) => [id, {
    status:history.status, unit:"VEHICLE", points:(history.periods || []).map((period, i) => ({period, value:values[i]}))
  }]))};
  const rvmChart = {data:rvmTrend, series:{MARKET:"market", COMPANY:"cidef", FOTON:"foton", DONGFENG:"dfm"}, labels:{MARKET:"Mercado total", DONGFENG:"DFM"}, label:"Inscripciones RVM", perCardScale:true};
  const sections = [
    { label: "Compañía", id: "sales_company", foton: "sales_foton", dongfeng: "sales_dongfeng" },
    { label: "Tiendas propias", id: "sales_own", foton: "sales_foton_own", dongfeng: "sales_dongfeng_own", p1: true },
    { label: "Dealers", id: "sales_dealers", foton: "sales_foton_dealers", dongfeng: "sales_dongfeng_dealers", p1: true }
  ];
  return <CommercialDetailProvider period={facts.period}><section className="mc-executive" aria-label="Grandes totales de ventas">
    <div className="mc-executive-heading"><div><span className="eyebrow">RESULTADO COMERCIAL</span><h2>Grandes totales</h2></div><small>Octubre 2026 · Compañía Finanzas neto / canales P1 antes de NC</small></div>
    <div className="mc-executive-grid mc-close-summary-grid">{sections.map(section => {
      const yoy = facts.company?.yoy?.[section.id];
      const commercialYoy = facts.channel_sales_p1?.yoy?.[section.id];
      const rvmYoy = facts.rvm_yoy_comparison?.cidef?.variation_percent;
      const nc = creditNotes?.[section.id === "sales_company" ? "company" : section.id === "sales_own" ? "own_stores" : "dealers"];
      return <article className="mc-executive-card" key={section.id}>
        <h3>{section.label}</h3>
        <div className="mc-executive-value">{channelValue(section, section.id)}<span>{section.p1 ? " ventas P1 · antes de NC" : " unidades netas"}</span></div>
        <div className="mc-executive-adjustment"><div className="mc-executive-nc"><span>Notas de crédito del mes</span><strong>{Number.isFinite(nc) ? "−" + count(nc) : "Pendiente"}</strong></div></div>
        <div className="mc-executive-brands">
          <div><span>Foton</span><strong>{channelValue(section, section.foton)}</strong></div>
          <div><span>Dongfeng</span><strong>{channelValue(section, section.dongfeng)}</strong></div>
        </div>
        <div className="mc-executive-yoy"><span>{section.p1 ? "Crecimiento YoY · SALES/P1 antes de NC" : "Crecimiento YoY · inscripciones RVM (Foton + DFM)"}</span><strong>{section.p1 ? valueText(commercialYoy) : typeof rvmYoy === "number" ? "+" + rvmYoy.toLocaleString("es-CL") + "%" : valueText(yoy)}</strong></div>
        <CommercialProductDetail channel={section.id === "sales_company" ? "company" : section.id === "sales_own" ? "stores" : "dealers"} metrics={p1}/>

      </article>;
    })}</div>
    <section className="mc-executive-card mc-executive-financing" aria-label="Financiamiento tiendas propias">
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
          <div className="mc-executive-finance-row mc-executive-finance-total"><span>Total tiendas propias · P1</span><strong>{valueText(p1.sales_own_p1)}</strong><strong>{facts.breakdowns?.financial_entities?.status === "CERTIFIED" ? "100%" : "Pendiente"}</strong></div>
        </section>
    {facts.rvm_yoy_comparison && <section className="mc-executive-card" aria-label="Inscripciones RVM, variación mensual e interanual" style={{marginTop:20}}>
      <h3>Mercado vs. CIDEF · inscripciones RVM</h3>
      <p>Octubre 2026 · variación interanual vs. octubre 2025 y mensual vs. septiembre 2026</p>
      <div className="mc-description-totals" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))",gap:16}}>
        {[["Mercado total","market"],["Compañía · Foton + DFM","cidef"],["DFM","dfm"],["Foton","foton"]].map(([label,key]) => {
          const item = facts.rvm_yoy_comparison[key];
          const percent = value => (value > 0 ? "+" : "") + value.toLocaleString("es-CL") + "%";
          return <article key={key}>
            <span>{label}</span>
            <strong>{count(item.current)}</strong>
            <div><strong style={{fontSize:"1.15rem"}}>{percent(item.variation_percent)}</strong><small> interanual</small></div>
            <div><strong style={{fontSize:"1.15rem"}}>{percent(item.variation_mom_percent)}</strong><small> vs. septiembre</small></div>
          </article>;
        })}
      </div>
      <section aria-label="Evolución de inscripciones RVM · base julio 2026 = 100" style={{marginTop:20}}>
        <h4>Evolución de inscripciones · base julio 2026 = 100</h4>
        <style>{`.mc-rvm-index-mobile{display:none}@media(max-width:600px){.mc-rvm-index-desktop{display:none}.mc-rvm-index-mobile{display:block}}`}</style>
        <div className="mc-rvm-index-desktop"><FourMonthTrend {...rvmChart} wide/></div>
        <div className="mc-rvm-index-mobile"><FourMonthTrend {...rvmChart}/></div>
      </section>
      <small>Fuente: RVM/P1 · Inscripciones, no ventas facturadas. Compañía = Foton + DFM.</small>
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
    <p className="mc-executive-foot">Compañía: 910 unidades netas Finanzas, con 55 NC ya descontadas. Distribución informada: 9 de Tiendas Propias y 46 de Dealers por diferencia. Las ventas P1 de Tiendas Propias (458) y Dealers (507) se muestran antes de NC; no se aplica una resta adicional a compañía.</p>
  </section></CommercialDetailProvider>;
}


