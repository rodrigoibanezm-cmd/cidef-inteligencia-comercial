"use client";
import { useState } from "react";

// UI migrated from legacy ranking: categories and 3 performance groups.
// Only precomputed, certified P1/P2/P3 results are accepted; no local ranking algorithm.
const CATEGORIES = [
  ["stores", "Tiendas propias"],
  ["sellers", "Vendedores"],
  ["dealers", "Dealers"],
  ["models", "Modelos"]
];
const STATES = [
  ["improving", "Mejoran", "up"],
  ["stable", "Se mantienen", "steady"],
  ["declining", "Retroceden", "down"]
];
const format = value => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value) : "—";
function VerifiedRank({ ranking }) {
  return ranking?.certified === true && ranking?.cutoff && ranking?.evidence_id && ranking?.source && ranking?.categories
    ? ranking : null;
}
function RankingGroup({ title, tone, rows }) {
  return <div className="cv3-rank-column">
    <div className={"cv3-rank-head cv3-tone-" + tone}><span aria-hidden="true">{tone === "up" ? "↗" : tone === "down" ? "↘" : "→"}</span><strong>{title}</strong></div>
    {Array.isArray(rows) && rows.length ? rows.slice(0, 5).map((row, i) => <div className="cv3-rank-row" key={String(row.id || i)}>
      <div className="cv3-rank-primary"><span>{i + 1}.</span><strong>{row.name || "—"}</strong><b>{format(row.vin)} VIN</b></div>
      <div className="cv3-rank-secondary">
        <span>{typeof row.delta_vin === "number" ? (row.delta_vin > 0 ? "+" : "") + format(row.delta_vin) + " VIN vs referencia" : "Variación pendiente"}</span>
        <span>{typeof row.change_pct === "number" ? (row.change_pct > 0 ? "+" : "") + format(row.change_pct * 100) + "%" : ""}</span>
      </div>
    </div>) : <p className="cv3-rank-empty">Sin resultados certificados.</p>}
  </div>;
}
export default function LivePerformanceRanking({ data, loading }) {
  const [category, setCategory] = useState("stores");
  const verified = VerifiedRank(data);
  const selected = verified?.categories?.[category];
  return <section className="cv3-ranking" aria-label="Ranking de desempeño comercial">
    <div className="cv3-ranking-top">
      <div><h3>Ranking de desempeño comercial</h3><p>Tiendas, vendedores, dealers y modelos · comparación certificada al corte disponible</p></div>
      <span className={verified ? "cv2-certified" : "cv2-unavailable"}>{verified ? "Certificado" : loading ? "Consultando" : "Pendiente"}</span>
    </div>
    <div className="cv3-rank-tabs" role="group" aria-label="Tipo de ranking">
      {CATEGORIES.map(([id, label]) => <button key={id} type="button" aria-pressed={category === id} className={category === id ? "cv3-selected" : ""} onClick={() => setCategory(id)}>{label}</button>)}
    </div>
    <div className="cv3-rank-columns">
      {STATES.map(([id, title, tone]) => <RankingGroup key={id} title={title} tone={tone} rows={selected?.[id]}/>)}
    </div>
    <div className="cv3-rank-footer">
      <span>{verified ? "Corte: " + verified.cutoff + " · " + verified.source : "Pendiente de contrato P1/P2/P3 para el mes abierto"}</span>
      <span>Hasta cinco resultados por grupo</span>
    </div>
  </section>;
}
