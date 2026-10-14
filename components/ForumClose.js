import source from "../data/monthly-close/2026-09/forum-close-source.json";
import { computeForumClose } from "../lib/motors/forum-close-v1";

const result = computeForumClose(source);
const formatNumber = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const formatPercent = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const number = value => formatNumber.format(value);
const percent = value => Number.isFinite(value) ? formatPercent.format(value * 100) + "%" : "—";
const signedPercent = value => Number.isFinite(value)
  ? (value > 0 ? "+" : "") + percent(value) : "—";
const signedPoints = value => Number.isFinite(value)
  ? (value > 0 ? "+" : "") + formatPercent.format(value * 100) + " pp" : "—";
const shortMonth = period => new Date(period + "-01T12:00:00Z")
  .toLocaleDateString("es-CL", { month: "short", timeZone: "UTC" }).replace(".", "");
const changeFromPrevious = (rows, field) => {
  if (rows.length < 2) return null;
  const prior = rows[rows.length - 2][field], current = rows.at(-1)[field];
  return prior > 0 ? current / prior - 1 : null;
};

function MiniTrend({ rows, field, isRate = false, title }) {
  if (!rows?.length) return <div className="forum-mini-empty">Sin serie histórica</div>;
  const values = rows.map(row => row[field]);
  if (values.some(value => !Number.isFinite(value))) return <div className="forum-mini-empty">Serie incompleta</div>;
  const width = 360, left = 19, right = 341, top = 22, bottom = 96;
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const low = Math.max(0, minimum - Math.max((maximum - minimum) * .22, maximum * .08));
  const high = maximum + Math.max((maximum - minimum) * .22, maximum * .08, .001);
  const positionX = i => left + (right - left) * i / Math.max(values.length - 1, 1);
  const positionY = value => bottom - (value - low) * (bottom - top) / (high - low);
  const coordinates = values.map((value, i) => ({ x: positionX(i), y: positionY(value) }));
  const polyline = coordinates.map(({x,y}) => x + "," + y).join(" ");
  return <div className="forum-mini-trend">
    <svg viewBox="0 0 360 133" className="forum-mini-svg" role="img" aria-label={title}>
      <path d="M19 96H341" fill="none" stroke="#e9eef4" strokeWidth="1"/>
      <polyline points={polyline} fill="none" stroke="#315a89" strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round"/>
      {coordinates.map((p,i) => <g key={rows[i].period}>
        <circle cx={p.x} cy={p.y} r={i === coordinates.length - 1 ? "4" : "3"} fill={i === coordinates.length - 1 ? "#244d7a" : "#7897b9"}/>
        <text x={p.x} y={Math.max(13, p.y - 10)} fontSize="10.5" textAnchor="middle" fill="#294767" fontWeight={i === coordinates.length - 1 ? "700" : "500"}>{isRate ? percent(values[i]) : number(values[i])}</text>
        <text x={p.x} y="122" fontSize="10" textAnchor="middle" fill="#748298">{shortMonth(rows[i].period)}</text>
      </g>)}
    </svg>
  </div>;
}

function Card({ label, main, subtitle, subtitleTone, own, dealers, trend, field, isRate, footnote }) {
  return <article className="forum-exec-card">
    <h3>{label}</h3>
    <div className="forum-exec-headline">
      <div className="forum-exec-main"><strong>{number(main)}</strong><span className={subtitleTone === "down" ? "forum-tone-down" : "forum-tone-neutral"}>{subtitle}</span></div>
      <div className="forum-exec-split">
        <div><span>Propias</span><strong>{number(own)}</strong></div>
        <div><span>Dealers</span><strong>{number(dealers)}</strong></div>
      </div>
    </div>
    <div className="forum-exec-chart">
      <MiniTrend rows={trend} field={field} isRate={isRate} title={"Evolución de " + label.toLowerCase() + " de " + shortMonth(trend[0].period) + " a " + shortMonth(trend.at(-1).period)}/>
    </div>
    <p className="forum-exec-caption">{footnote}</p>
  </article>;
}

export default function ForumClose() {
  const own = result.networks.find(row => row.id === "OWN_STORES");
  const dealers = result.networks.find(row => row.id === "DEALERS");
  const company = result.networks.find(row => row.id === "COMPANY");
  const ufiChange = changeFromPrevious(result.event_trend, "ufis");
  return <section className="mc-forum-executive" aria-label="FORUM · desempeño del financiamiento">
    <div className="forum-exec-header">
      <div><h2>FORUM · Desempeño del financiamiento</h2><p>Septiembre 2026 · cierre mensual</p></div>
      <span>Compañía · Motor v{result.version}</span>
    </div>
    <div className="forum-exec-grid">
      <Card label="Solicitudes" main={company.applications}
        subtitle={signedPercent(result.signals?.applications_change) + " vs agosto"}
        subtitleTone={result.signals?.applications_change < 0 ? "down" : "neutral"}
        own={own.applications} dealers={dealers.applications}
        trend={result.cohorts} field="applications"
        footnote="Entrada al embudo · abril–septiembre"/>
      <Card label="Aprobadas sin curse" main={company.approved_pending}
        subtitle={percent(company.approved_pending_share) + " de cotizaciones"}
        own={own.approved_pending} dealers={dealers.approved_pending}
        trend={result.cohorts} field="approved_pending_share" isRate
        footnote={signedPoints(result.signals?.approved_pending_pp) + " vs agosto · estados actuales por cohorte"}/>
      <Card label="UFIs ejecutadas" main={company.ufis}
        subtitle={signedPercent(ufiChange) + " vs agosto · " + percent(company.penetration) + " penetración"}
        subtitleTone={ufiChange < 0 ? "down" : "neutral"}
        own={own.ufis} dealers={dealers.ufis}
        trend={result.event_trend} field="ufis"
        footnote={number(company.curses) + " curses · " + number(company.sales_vin) + " VIN vendidos · junio–septiembre"}/>
    </div>
    <p className="forum-exec-method">Solicitudes: operaciones de cotización que avanzaron de etapa. Aprobadas sin curse: estado actual de cada cohorte; su curva no representa una foto histórica al cierre ni compara cohortes de igual maduración. UFIs: vehículos financiados por Curse en cada mes. Penetración = UFIs / VIN vendidos.</p>
  </section>;
}
