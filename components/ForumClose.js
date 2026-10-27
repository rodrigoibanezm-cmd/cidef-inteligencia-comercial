import { dateText, valueText } from "../lib/monthly-close-view";
import { Comparison, FourMonthTrend, SourceNote } from "./MonthlyCloseMetric";

export default function ForumClose({ data }) {
  return <section className="mc-forum-executive" aria-label="FORUM · desempeño del financiamiento">
    <div className="forum-exec-header"><div><h2>FORUM · Desempeño del financiamiento</h2><p>Septiembre 2026 · mes completo</p></div><span>FORUM P1 / P2</span></div>
    <div className="forum-exec-grid">{data.company.forum_cards.map(config => {
      const item = data.indicators[config.id];
      return <article className="forum-exec-card" key={config.id} data-close-card={config.id}>
        <h3>{config.label}</h3><div className="forum-exec-headline">
          <div className="forum-exec-main"><strong>{valueText(item)}</strong><Comparison comparison={data.company.comparisons[config.id]}/></div>
          <div className="forum-exec-split">{[["Propias", config.own], ["Dealers", config.dealers]].map(([label, id]) => <div key={label}><span>{label}</span><strong>{valueText(data.indicators[id])}</strong></div>)}</div>
        </div>
        <FourMonthTrend data={data} series={config.series} label={config.label}/>
        <p className="forum-exec-caption">{config.note}</p><SourceNote item={item}/>
      </article>;
    })}</div>
    <p className="forum-exec-method">Cotizaciones por fecha de cotización y UFIs por fecha de curse. Los estados de cohortes se presentan en el panel de financiamiento con su fecha de observación. Consulta de la actividad: {dateText(data.company.panels.financing.observed_at)}. La penetración pendiente no se calcula provisionalmente.</p>
  </section>;
}

