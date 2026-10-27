"use client";
import { useState } from "react";
import { dateText, isCertified, valueText } from "../lib/monthly-close-view";
import styles from "./CompanyClosePanels.module.css";

function Contributions({ rows, label }) {
  const plotted = rows.filter(row => isCertified(row.delta) && Number.isFinite(row.delta.value))
    .slice().sort((a, b) => Math.abs(b.delta.value) - Math.abs(a.delta.value));
  if (!plotted.length) return <p className={styles.pending}>Pendiente: contribuciones certificadas P2.</p>;
  const maximum = Math.max(1, ...plotted.map(row => Math.abs(row.delta.value)));
  const zero = 320, half = 115, height = plotted.length * 30 + 40;
  return <svg className={styles.graph} viewBox={"0 0 520 " + height} role="img" aria-label={"Contribuciones " + label + " a la variación de ventas, agosto contra septiembre 2026"}>
    <line x1={zero} x2={zero} y1="10" y2={height - 23} stroke="#b8c4d3"/>
    {plotted.map((row, index) => {
      const width = Math.abs(row.delta.value) / maximum * half;
      const y = 17 + index * 30, negative = row.delta.value < 0;
      return <g key={row.id}><text x="3" y={y + 12} fontSize="11" fill="#52647a">{row.label}</text>
        <rect x={negative ? zero - width : zero} y={y} width={width} height="17" rx="3" fill={negative ? "#b85a55" : "#315a89"}/>
        <text x={negative ? zero - width - 6 : zero + width + 6} y={y + 12} textAnchor={negative ? "end" : "start"} fontSize="11" fill="#31445f">{valueText(row.delta, true)}</text>
      </g>;
    })}
    <text x={zero} y={height - 5} textAnchor="middle" fontSize="10" fill="#748195">0 VIN</text>
  </svg>;
}

export default function PerformanceRanking({ variations }) {
  const [axis, setAxis] = useState("channels");
  const options = [["channels", "Canal"], ["brands", "Marca"], ["models", "Modelo"]];
  const selected = variations?.axes?.[axis] || { rows: [] };
  const rows = selected.rows || [];
  const total = selected.total;
  return <section className={"mc-panel mc-rank-section " + styles.panel} data-close-panel="sales">
    <div className="mc-panel-head"><div><h2>Variaciones de ventas</h2><p className="rank-subtitle">Agosto vs. septiembre 2026 · aporte aritmético en VIN</p></div><span>SALES P1 / P2</span></div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Descomposición de ventas">{options.map(([id, label]) => <button key={id} type="button" aria-pressed={axis === id} className={axis === id ? "selected" : ""} onClick={() => setAxis(id)}>{label}</button>)}</div></div>
    <Contributions rows={rows} label={options.find(([id]) => id === axis)[1]}/>
    <div className={styles.scroll} tabIndex="0" role="region" aria-label="Tabla de variaciones de ventas">
      <table className={styles.table}><caption>Ventas reconocidas por fecha de factura. Diferencias y variaciones provenientes de P2.</caption>
        <thead><tr><th scope="col">Detalle</th><th scope="col">Agosto</th><th scope="col">Septiembre</th><th scope="col">Δ VIN</th><th scope="col">Δ %</th></tr></thead>
        <tbody>{rows.length ? rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{valueText(row.baseline)}</td><td>{valueText(row.current)}</td><td>{valueText(row.delta, true)}</td><td>{valueText(row.relative, true)}</td></tr>) : <tr><td colSpan="5">Pendiente: descomposición certificada.</td></tr>}</tbody>
        {total && <tfoot><tr><th scope="row">Compañía</th><td>{valueText(total.baseline)}</td><td>{valueText(total.current)}</td><td>{valueText(total.delta, true)}</td><td>{valueText(total.relative, true)}</td></tr></tfoot>}
      </table>
    </div>
    <p className={styles.note}>Corte agosto: 31/08/2026 · corte septiembre: 30/09/2026. Las contribuciones explican la diferencia aritmética; no atribuyen causas ni mérito.</p>
    <p className={styles.note}>{selected.reconciliation === "RECONCILED" ? "Descomposición conciliada por P2 con el total de compañía." : selected.reason || "Conciliación por P2: Pendiente."} {selected.observed_at ? "Observación: " + dateText(selected.observed_at) + "." : ""}</p>
  </section>;
}

