"use client";

import Link from "next/link";
import LivePerformanceRanking from "../../components/LivePerformanceRanking";
import { useCallback, useEffect, useState } from "react";

const SOURCES = [
  { id: "sales", title: "Ventas", source: "SALES", subtitle: "VIN facturados · corte diario", unit: "units" },
  { id: "quotations", title: "Cotizaciones", source: "FORUM", subtitle: "Cotizaciones registradas", unit: "units" },
  { id: "precurse", title: "Precurse", source: "FORUM", subtitle: "Stock del último snapshot", unit: "units", snapshot: true },
  { id: "ufis", title: "UFIs ejecutadas", source: "FORUM", subtitle: "Unidades financiadas · fecha Curse", unit: "units" },
  { id: "rvm_units", title: "Inscripciones", source: "RVM", subtitle: "Unidades inscritas · corte RVM", unit: "units" },
  { id: "rvm_share", title: "Participación de mercado", source: "RVM / P2", subtitle: "Porcentaje sobre universo comparable", unit: "percent" }
];

function certified(response, id) {
  const item = response?.indicators?.find?.(entry => entry?.id === id);
  return item?.certified === true && item?.cutoff && item?.source && item?.evidence_id ? item : null;
}

function number(value, unit) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: unit === "percent" ? 2 : 0 }).format(value) + (unit === "percent" ? " %" : "");
}

function Metric({ label, value, unit, major }) {
  return <div className={major ? "cv2-number cv2-number-major" : "cv2-number"}>
    <span>{label}</span><strong>{number(value, unit)}</strong>
  </div>;
}

function Provenance({ item, snapshot }) {
  return <div className="cv2-provenance">
    <span>{snapshot ? "Último snapshot" : "Corte de fuente"}: <strong>{item?.cutoff || "Pendiente"}</strong></span>
    <span>{item?.source || "Sin evidencia publicada"}</span>
  </div>;
}

function IndexedChart({ item, compact = false }) {
  // Indexed P2 points only. Do not derive base-100 indices from P1 totals in the browser.
  const series = Array.isArray(item?.indexed_series) ? item.indexed_series : [];
  const valid = series.filter(point => point && typeof point.period === "string");
  const min = 60, max = 160;
  const keys = [{ id: "company", label: "Compañía", css: "cv2-line-company" }, { id: "own_stores", label: "Tiendas propias", css: "cv2-line-own" }, { id: "dealers", label: "Dealers", css: "cv2-line-dealers" }];
  const bounded = (n) => Math.max(0, Math.min(100, (n - min) / (max - min) * 100));
  const hasCertifiedIndex = item?.certification?.index_base === 100 && valid.length >= 2;
  return <div className="cv2-chart">
    <div className="cv2-chart-title"><strong>Evolución base 100</strong><span>6 meses · P2</span></div>
    {hasCertifiedIndex ? <div className="cv2-chart-plot">
      <svg viewBox="0 0 380 135" role="img" aria-label="Índices certificados para Compañía, Tiendas propias y Dealers" preserveAspectRatio="none">
        {[100, 125, 150].map(v => <g key={v}><line x1="28" x2="376" y1={121-bounded(v)*1.02} y2={121-bounded(v)*1.02} stroke="#e5eaf1" strokeDasharray="3 5"/><text x="1" y={125-bounded(v)*1.02} fontSize="10" fill="#8492a5">{v}</text></g>)}
        {keys.map(k => {
          const entries = valid.map((p, i) => ({ i, v: p[k.id] })).filter(p => typeof p.v === "number" && Number.isFinite(p.v));
          if (entries.length !== valid.length) return null;
          const points = entries.map(p => `${28 + p.i * 348 / (valid.length - 1)},${121 - bounded(p.v) * 1.02}`).join(" ");
          return <polyline key={k.id} points={points} className={k.css} fill="none" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>;
        })}
      </svg>
      <div className="cv2-chart-periods"><span>{valid[0]?.period}</span><span>{valid[valid.length-1]?.period}</span></div>
    </div> : <div className={compact ? "cv2-chart-empty cv2-chart-empty-small" : "cv2-chart-empty"}>
      <svg width="80" height="35" viewBox="0 0 80 35" aria-hidden="true"><path d="M3 27 21 20 37 23 52 9 76 5" fill="none" stroke="#a8b7c8" strokeWidth="2.5" strokeLinecap="round"/><path d="M3 27 21 20 37 23 52 9 76 5" fill="none" stroke="#a8b7c8" strokeDasharray="1 7" strokeWidth="4"/></svg>
      <span>Esperando serie indexada certificada</span>
    </div>}
    <div className="cv2-legend"><span><i className="cv2-key-company"/>Compañía</span><span><i className="cv2-key-own"/>Tiendas propias</span><span><i className="cv2-key-dealers"/>Dealers</span></div>
  </div>;
}

function Channels({ item, unit }) {
  const channels = item?.channels;
  return <div className="cv2-channel-table">
    <div className="cv2-table-head"><span>Canal</span><span>FOTON</span><span>DONGFENG</span><span>Total</span></div>
    {[["own_stores", "Tiendas propias"], ["dealers", "Dealers"]].map(([key, label]) => <div className="cv2-table-row" key={key}>
      <strong>{label}</strong><span>{number(channels?.[key]?.foton, unit)}</span><span>{number(channels?.[key]?.dongfeng, unit)}</span><span>{number(channels?.[key]?.company, unit)}</span>
    </div>)}
  </div>;
}

function Summary({ item, unit }) {
  return <div className="cv2-summary">
    <Metric label="Total Compañía" value={item?.values?.company} unit={unit} major/>
    <div className="cv2-brand-totals"><Metric label="FOTON" value={item?.values?.foton} unit={unit}/><Metric label="DONGFENG" value={item?.values?.dongfeng} unit={unit}/></div>
  </div>;
}

function SourceCard({ def, item, loading, rvm = false }) {
  return <article className="cv2-card">
    <header className="cv2-card-head">
      <div><span className="cv2-source-tag">{def.source}</span><h3>{def.title}</h3><p>{def.subtitle}</p></div>
      <span className={item ? "cv2-certified" : "cv2-unavailable"}>{item ? "Certificado" : loading ? "Consultando" : "Pendiente"}</span>
    </header>
    <Summary item={item} unit={def.unit}/>
    {def.snapshot ? <div className="cv2-snapshot"><strong>Stock vigente</strong><p>Fotografía del último snapshot disponible, independiente del mes seleccionado. No corresponde a una serie mensual.</p></div>
      : <IndexedChart item={item} compact/>}
    {!rvm && <div className="cv2-channel-detail"><span>Canales</span><Channels item={item} unit={def.unit}/></div>}
    {rvm && <p className="cv2-rvm-note">Universo RVM. No se presenta apertura por canal comercial sin contrato certificado.</p>}
    <Provenance item={item} snapshot={def.snapshot}/>
  </article>;
}

function SalesDrilldown({ item }) {
  const [expanded, setExpanded] = useState(null);
  const options = [["own_stores", "Tiendas propias"], ["dealers", "Dealers"]];
  return <div className="cv3-sales-drilldown">
    <div className="cv3-sales-actions">
      {options.map(([id, label]) => <button type="button" key={id} aria-expanded={expanded === id} className={expanded === id ? "cv3-active" : ""} onClick={() => setExpanded(expanded === id ? null : id)}>
        <strong>{label}</strong><span>{number(item?.channels?.[id]?.company, "units")} VIN</span><small>{expanded === id ? "Ocultar detalle ↑" : "Ver detalle ↓"}</small>
      </button>)}
    </div>
    {expanded && <div className="cv3-drill-panel">
      <h4>{expanded === "own_stores" ? "Ventas por tienda" : "Ventas por dealer"}</h4>
      {item?.details?.certified === true && item?.details?.evidence_id && Array.isArray(item?.details?.[expanded]) ?
        item.details[expanded].map(row => <div className="cv3-drill-line" key={String(row.id)}><span>{row.name}</span><strong>{number(row.vin, "units")} VIN</strong></div>)
        : <p>Detalle pendiente de contrato certificado.</p>}
    </div>}
  </div>;
}

function SectionTitle({ count, title, subtitle, badge }) {
  return <div className="cv2-section-title"><div className="cv2-section-number">{count}</div><div><h2>{title}</h2><p>{subtitle}</p></div><span>{badge}</span></div>;
}

export default function ComoVamos() {
  const [period, setPeriod] = useState(() => { const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", year: "numeric", month: "2-digit" }).formatToParts(new Date()); return parts.find(p => p.type === "year").value + "-" + parts.find(p => p.type === "month").value; });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal) => {
    setLoading(true); setError(""); setData(null);
    try {
      const response = await fetch("/api/como-vamos?period=" + encodeURIComponent(period), { cache: "no-store", signal });
      if (!response.ok) throw new Error(response.status === 503 ? "La API de indicadores certificados todavía no está conectada." : "Consulta no disponible (" + response.status + ").");
      const payload = await response.json();
      if (payload?.period !== period || !Array.isArray(payload?.indicators)) throw new Error("Respuesta de indicadores no válida.");
      setData(payload);
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message || "No se pudieron recuperar los datos.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [period]);

  useEffect(() => { const c = new AbortController(); refresh(c.signal); return () => c.abort(); }, [refresh]);
  const pick = id => certified(data, id);

  return <main className="shell cv2-page">
    <header className="topbar"><Link className="back" href="/">← CIDEF · Inteligencia Comercial</Link><span className="pill">SEGUIMIENTO VIVO</span></header>
    <div className="cv2-heading"><div><div className="eyebrow">INTELIGENCIA COMERCIAL · COMPAÑÍA</div><h1>¿Cómo vamos?</h1><p>Tres miradas independientes al negocio, con el corte certificado de cada fuente.</p></div>
      <div className="cv2-controls"><label htmlFor="cv2-period">Período</label><input id="cv2-period" type="month" value={period} onChange={event => setPeriod(event.target.value)} aria-label="Período de consulta"/><button disabled={loading} onClick={() => refresh()}>{loading ? "Consultando…" : "Actualizar"}</button></div></div>
    {error && <p className="cv2-alert" role="status">{error} Los indicadores sin evidencia permanecen vacíos.</p>}
    <section className="cv2-section" aria-labelledby="cv2-sales">
      <SectionTitle count="01" title="Ventas" subtitle="¿Cómo estamos vendiendo?" badge="SALES · CORTE DIARIO"/>
      <div className="cv2-sales-layout">
        <div className="cv2-sales-main">
          <h3 id="cv2-sales" className="cv2-block-label">VIN FACTURADOS</h3>
          <Summary item={pick("sales")} unit="units"/>
          <Channels item={pick("sales")} unit="units"/>
          <SalesDrilldown item={pick("sales")}/>
          <Provenance item={pick("sales")}/>
        </div>
        <div className="cv2-sales-chart"><IndexedChart item={pick("sales")}/></div>
      </div>
      <LivePerformanceRanking data={data?.rankings} loading={loading}/>
    </section>
    <section className="cv2-section" aria-labelledby="cv2-forum">
      <SectionTitle count="02" title="FORUM" subtitle="¿Cómo avanza el financiamiento?" badge="CORTES FORUM"/>
      <h3 id="cv2-forum" className="cv2-sr-only">Indicadores FORUM</h3>
      <div className="cv2-three-cols">{SOURCES.slice(1,4).map(d => <SourceCard key={d.id} def={d} item={pick(d.id)} loading={loading}/>)}</div>
    </section>
    <section className="cv2-section" aria-labelledby="cv2-rvm">
      <SectionTitle count="03" title="RVM" subtitle="¿Cómo nos comportamos frente al mercado?" badge="SNAPSHOT RVM"/>
      <h3 id="cv2-rvm" className="cv2-sr-only">Indicadores RVM</h3>
      <div className="cv2-two-cols">{SOURCES.slice(4).map(d => <SourceCard key={d.id} def={d} item={pick(d.id)} loading={loading} rvm/>)}</div>
    </section>
    <p className="cv2-footer-note">Las fuentes no comparten necesariamente fechas ni universos. Los índices base 100 requieren resultados certificados de P2; no se calculan en esta página.</p>
  </main>;
}
