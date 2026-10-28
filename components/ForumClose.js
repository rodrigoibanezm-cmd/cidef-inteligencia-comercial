import { dateText, valueText } from "../lib/monthly-close-view";
import { Comparison, FourMonthTrend, SourceNote } from "./MonthlyCloseMetric";

export default function ForumClose({ data }) {
  const display = item => item?.status === 'PROVIDED'
    ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(item.value) + '%'
    : valueText(item);
  return <section className="mc-forum-executive" aria-label="FORUM · desempeño del financiamiento">
    <div className="forum-exec-header"><div><h2>FORUM · Desempeño del financiamiento</h2><p>Septiembre 2026 · mes completo</p></div><span>FORUM P1 / P2</span></div>
    <div className="forum-exec-grid">{data.company.forum_cards.map(config => {
      const item = data.indicators[config.id];
      return <article className="mc-kpi" key={config.id} data-close-card={config.id}>
        <span>{config.label}</span><div className="mc-kpi-values"><strong>{display(item)}</strong>
          <div className="mc-kpi-brands">{Object.entries(config.brands).map(([brand, id]) => <div key={brand}><span>{brand === 'FOTON' ? 'Foton' : 'Dongfeng'}</span><b>{display(data.indicators[id])}</b></div>)}</div>
        </div>
        <Comparison comparison={data.company.comparisons[config.id]}/>
        {config.id === 'forum_penetration'
          ? <div className="mc-spark-empty">Trayectoria pendiente<small>Sin historia por marca del universo 264 / 581</small></div>
          : <FourMonthTrend data={data} series={config.series} label={config.label} perCardScale/>}
        <p className="forum-exec-caption">{config.note}</p>
        {item.networks && <small className="mc-source-note">{item.networks.map(row => row.label + ': ' + row.ufi + ' / ' + row.sales_vin + ' = ' + display({ status: 'PROVIDED', value: row.ufi / row.sales_vin * 100 })).join(' · ')}</small>}
        <SourceNote item={item}/>
      </article>;
    })}</div>
    <p className="forum-exec-method">Cotizaciones por fecha de cotización y UFIs por fecha de curse. Penetración: UFI / ventas VIN × 100, exclusivamente sobre la tabla proporcionada (264 / 581). Consulta de la actividad: {dateText(data.company.panels.financing.observed_at)}.</p>
  </section>;
}

