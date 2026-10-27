import PerformanceRanking from './PerformanceRanking';
import { complianceText, dateText, numberText, valueText } from '../lib/monthly-close-view';
import styles from './CompanyClosePanels.module.css';

function ScrollTable({ label, caption, headings, children }) {
  return <div className={styles.scroll} role="region" aria-label={label} tabIndex="0"><table className={styles.table}>
    <caption>{caption}</caption><thead><tr>{headings.map(heading => <th scope="col" key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody>
  </table></div>;
}

function Targets({ data }) {
  const panel = data.company.panels.targets;
  return <section className={'mc-panel ' + styles.panel} data-close-panel="targets">
    <div className="mc-panel-head"><h2>Cumplimiento de metas</h2><span>SALES P1 · TARGETS oficial · P2</span></div>
    <p className={styles.note}>Cobertura: {numberText(panel.coverage.available)} de {numberText(panel.coverage.stores)} sucursales con ventas tienen meta disponible. Sin meta agregada de compañía, dealers o marca.</p>
    <ScrollTable label="Cumplimiento de metas por sucursal" caption="Septiembre 2026 · ventas al 30/09. Cumplimiento indica el estado certificado respecto de la meta; la brecha se presenta en VIN y porcentaje." headings={['Sucursal', 'Ventas', 'Meta oficial', 'Cumplimiento', 'Brecha VIN', 'Brecha %']}>
      {panel.rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{valueText(row.actual)}</td><td>{valueText(row.target)}</td><td>{complianceText(row.compliance)}</td><td>{valueText(row.gap, true)}</td><td>{valueText(row.relative_gap, true)}</td></tr>)}
    </ScrollTable>
    <p className={styles.note}>Las metas corresponden exclusivamente a las sucursales que cuentan con referencia oficial. Una meta ausente se muestra como Pendiente.</p>
    <p className={styles.note}>Observación: {dateText(panel.observed_at)}.</p>
  </section>;
}

function Competitive({ data }) {
  const panel = data.company.panels.competitive;
  const fields = ['august', 'september', 'ytd', 'monthly_share', 'ytd_share', 'delta_pp'];
  const rows = (items, prefix) => items.map(row => <tr key={prefix + row.id}><th scope="row">{row.label}</th>{fields.map(field => <td key={field}>{valueText(row[field], field === 'delta_pp')}</td>)}</tr>);
  return <section className={'mc-panel ' + styles.panel} data-close-panel="competitive">
    <div className="mc-panel-head"><h2>Posición competitiva</h2><span>RVM consolidado · P1 / P2</span></div>
    <ScrollTable label="RVM por marca" caption="Participación por marca sobre el mercado total. YTD: enero–septiembre 2026." headings={['Marca', 'Inscr. agosto', 'Inscr. septiembre', 'Inscr. YTD', 'Share mensual', 'Share YTD', 'Δ pp vs agosto']}>
      {rows(panel.brands, 'brand')}
    </ScrollTable>
    <h3 className={styles.subheading}>Marca y segmento</h3>
    <ScrollTable label="RVM por marca y segmento" caption="Participación dentro del mismo segmento: el denominador es el mercado completo de ese segmento, no el total de CIDEF." headings={['Marca / segmento', 'Inscr. agosto', 'Inscr. septiembre', 'Inscr. YTD', 'Share segmento', 'Share segmento YTD', 'Δ pp vs agosto']}>
      {panel.segments.length ? rows(panel.segments, 'segment') : <tr><td colSpan="7">Pendiente: apertura certificada por segmento.</td></tr>}
    </ScrollTable>
    <p className={styles.note}>Dongfeng corresponde a la etiqueta RVM DFM. Inscripciones y ventas ERP representan hechos y fechas diferentes.</p>
    <p className={styles.note}>{panel.delta_pp_reason} Comparaciones interanuales: Pendiente. Período mensual: septiembre 2026 · corte 30/09/2026 · observación {dateText(panel.observed_at)}.</p>
  </section>;
}

function Financing({ data }) {
  const panel = data.company.panels.financing;
  const conversion = panel.conversion;
  return <section className={'mc-panel ' + styles.panel} data-close-panel="financing">
    <div className="mc-panel-head"><h2>Financiamiento</h2><span>SALES y FORUM · universos separados</span></div>
    <div className={styles.grid}>
      <div className={styles.box}><h3 className={styles.subheading}>Financiera identificada en SALES</h3>
        <ScrollTable label="Entidades financieras en SALES" caption={'Tiendas propias · denominador: ' + valueText(data.indicators.sales_own) + ' ventas · septiembre al 30/09.'} headings={['Entidad', 'VIN']}>
          {data.breakdowns.financial_entities.members.map(row => <tr key={row.member_id}><th scope="row">{row.member_label || row.member_id}</th><td>{numberText(row.value)}</td></tr>)}
        </ScrollTable>
        <p className={styles.note}>Sin entidad resuelta no acredita contado. La entidad FORUM registrada en SALES no equivale a UFIs por fecha de curse.</p>
      </div>
      <div className={styles.box}><h3 className={styles.subheading}>Actividad FORUM por canal</h3>
        <ScrollTable label="FORUM por canal" caption="Septiembre, mes completo: cotizaciones y solicitudes por cohorte; cursados y UFIs por fecha de curse." headings={['Canal', 'Cotizaciones', 'Solicitudes', 'Cursados', 'UFIs']}>
          {panel.networks.map(row => <tr key={row.id}><th scope="row">{row.label}</th>{['quotations', 'applications', 'curses', 'ufis'].map(field => <td key={field}>{valueText(data.indicators[row[field]])}</td>)}</tr>)}
        </ScrollTable>
        <p className={styles.note}>Las solicitudes reflejan el estado consolidado de la cohorte en la fecha de observación; no reconstruyen la foto del 30/09.</p>
      </div>
    </div>
    <h3 className={styles.subheading}>Conversión de cohortes · análisis separado</h3>
    <p className={styles.note}>Cohorte de cotización: 01–30/09/2026 · fecha de observación: {dateText(conversion.observed_at)}. Los resultados son los observados al consultar la fuente, no los existentes necesariamente al cierre de septiembre.</p>
    <ScrollTable label="Conversión FORUM de la cohorte septiembre" caption="Denominador evaluable = convertidas + aprobadas sin curse + caducadas sin curse + rechazadas sin curse. Otros estados quedan fuera del denominador." headings={['Canal', 'Convertidas', 'Aprobadas', 'Caducadas', 'Rechazadas', 'Evaluables', 'Conversión']}>
      {conversion.rows.length ? conversion.rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th>{['converted', 'approved', 'expired', 'rejected', 'evaluated', 'rate'].map(field => <td key={field}>{valueText(row[field])}</td>)}</tr>) : <tr><td colSpan="7">Pendiente: ejecución certificada de conversión.</td></tr>}
    </ScrollTable>
    <p className={styles.note}>Esta conversión no usa todas las cotizaciones como denominador y no sustituye UFIs mensuales ni penetración FORUM. Observación de la actividad: {dateText(panel.observed_at)}.</p>
  </section>;
}

export default function CompanyClosePanels({ data }) {
  return <><PerformanceRanking variations={data.company.panels.sales}/><Targets data={data}/><Competitive data={data}/><Financing data={data}/></>;
}
