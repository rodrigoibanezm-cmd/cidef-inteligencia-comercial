"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const DEFINITIONS = [
  { id: "sales", name: "Ventas", note: "VIN facturados · SALES P1" },
  { id: "quotations", name: "Cotizaciones", note: "FORUM · fecha de cotización" },
  { id: "precurse", name: "Precurse", note: "Stock de operaciones · último snapshot" },
  { id: "ufis", name: "UFIs ejecutadas", note: "Unidades financiadas · fecha Curse" },
  { id: "rvm_units", name: "Inscripciones RVM", note: "Unidades inscritas · snapshot RVM" },
  { id: "rvm_share", name: "Participación RVM", note: "Porcentaje · universo comparable P1/P2" }
];

function safeMeasure(response, id) {
  const item = response?.indicators?.find?.(entry => entry?.id === id);
  if (!item || item.certified !== true || !item.cutoff || !item.source || !item.evidence_id) return null;
  return item;
}

function fmt(value, kind) {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: kind === "percent" ? 2 : 0 }).format(value) + (kind === "percent" ? " %" : "");
}

function KPI({ definition, item, loading }) {
  const values = item?.values || {};
  const points = Array.isArray(item?.series) ? item.series.filter(p => p && typeof p.period === "string") : [];
  return <article className="cv-kpi" aria-label={definition.name}>
    <div className="cv-kpi-header"><h2>{definition.name}</h2><span className={item ? "cv-state cv-state-ready" : "cv-state"}>{item ? "Certificado" : loading ? "Consultando" : "Sin evidencia"}</span></div>
    <p className="cv-metric-note">{definition.note}</p>
    <div className="cv-total"><span>Compañía</span><strong>{fmt(values.company, item?.unit)}</strong></div>
    <div className="cv-brand-row"><div><span>FOTON</span><strong>{fmt(values.foton, item?.unit)}</strong></div><div><span>DONGFENG</span><strong>{fmt(values.dongfeng, item?.unit)}</strong></div></div>
    <div className="cv-history">
      <div className="cv-history-header"><strong>Trayectoria mensual</strong><span>{points.length ? points.length + " períodos" : "Pendiente"}</span></div>
      {points.length ? <div className="cv-history-values">{points.map(p => <div key={p.period}><span>{p.period}</span><strong>{fmt(p.company, item?.unit)}</strong></div>)}</div>
        : <p>Serie certificada no disponible.</p>}
    </div>
    <div className="cv-source"><span>Corte: {item?.cutoff || "No disponible"}</span><span>Fuente: {item?.source || "Sin verificar"}</span></div>
  </article>;
}

export default function ComoVamos() {
  const [period, setPeriod] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const response = await fetch("/api/como-vamos?period=" + encodeURIComponent(period), { cache: "no-store", signal });
      if (!response.ok) throw new Error(response.status === 503 ? "La conexión con los motores certificados aún no está habilitada." : "No se pudieron consultar los motores (" + response.status + ").");
      const payload = await response.json();
      if (!payload || payload.period !== period || !Array.isArray(payload.indicators)) throw new Error("Respuesta no válida de los motores.");
      setData(payload);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message || "No se pudo obtener la información.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return <main className="shell cv-page">
    <header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">MES ABIERTO</span></header>
    <section className="cv-heading">
      <div><span className="eyebrow">SEGUIMIENTO COMERCIAL</span><h1>¿Cómo vamos?</h1><p>Indicadores consultados al abrir la vista. Cada fuente conserva su propio corte certificado.</p></div>
      <div className="cv-controls"><label htmlFor="cv-period">Período</label><input id="cv-period" type="month" value={period} onChange={event => setPeriod(event.target.value)} /><button type="button" onClick={() => refresh()} disabled={loading}>{loading ? "Consultando…" : "Actualizar"}</button></div>
    </section>
    {error && <div role="status" className="cv-notice">{error} No se mostrarán cifras sin evidencia certificada.</div>}
    <section className="cv-grid" aria-label="Indicadores de Compañía">
      {DEFINITIONS.map(definition => <KPI key={definition.id} definition={definition} item={safeMeasure(data, definition.id)} loading={loading} />)}
    </section>
    <p className="cv-footer-note">Las cifras provendrán exclusivamente de contratos P1/P2 con trazabilidad P3 cuando aplique. Precurse es stock al snapshot; no representa un flujo mensual. RVM mantiene su propio período de publicación.</p>
  </main>;
}
