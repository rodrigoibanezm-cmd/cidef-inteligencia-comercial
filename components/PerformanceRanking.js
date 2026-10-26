"use client";
import { useState } from "react";

const categories = [
  { id: "stores", title: "Tiendas propias" },
  { id: "sellers", title: "Vendedores" },
  { id: "dealers", title: "Dealers" },
  { id: "models", title: "Modelos" }
];

export default function PerformanceRanking({ certification }) {
  const [category, setCategory] = useState("stores");
  const selected = certification?.categories?.[category];
  // September P1 observations do not certify the legacy June–August growth classification.
  return <section className="mc-panel mc-rank-section" aria-label="Ranking de desempeño comercial">
    <div className="mc-panel-head"><div><h2>Ranking de desempeño comercial</h2><p className="rank-subtitle">Septiembre 2026 · SALES</p></div><span>Pendiente de certificación</span></div>
    <div className="rank-controls"><div className="rank-cats" role="group" aria-label="Categoría">{categories.map(item => <button type="button" key={item.id} className={category === item.id ? "selected" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.title}</button>)}</div></div>
    <div className="rank-columns rank-columns-three">{["Mejoran", "Se mantienen", "Retroceden"].map(label => <div className="rank-panel" key={label}><div className="rank-panel-header"><strong>{label}</strong></div><p className="rank-none">Clasificación pendiente. No se publican los resultados del snapshot anterior.</p></div>)}</div>
    <p className="rank-source-note">{selected?.reason || certification?.reason}</p>
    <p className="rank-source-note">Las observaciones P1 de septiembre se conservan con su evidencia. El ranking histórico anterior queda archivado para auditoría y pruebas; no se utiliza como cierre certificado.</p>
  </section>;
}

