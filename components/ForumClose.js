const number = value => Number.isFinite(value)
  ? new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value) : "—";

function Card({ title, item, own, dealers, subtitle, note }) {
  const available = item?.status === "CERTIFIED";
  return <article className="forum-exec-card">
    <h3>{title}</h3>
    <div className="forum-exec-headline">
      <div className="forum-exec-main"><strong>{available ? number(item.value) : "—"}</strong><span>{subtitle}</span></div>
      <div className="forum-exec-split"><div><span>Propias</span><strong>{number(own)}</strong></div><div><span>Dealers</span><strong>{number(dealers)}</strong></div></div>
    </div>
    <div className="forum-mini-empty">{note}</div>
    <p className="forum-exec-caption">{item?.source} · corte {item?.cutoff || "pendiente"}</p>
  </article>;
}

export default function ForumClose({ data }) {
  const item = id => data.indicators[id];
  return <section className="mc-forum-executive" aria-label="FORUM · desempeño del financiamiento">
    <div className="forum-exec-header"><div><h2>FORUM · Desempeño del financiamiento</h2><p>Septiembre 2026 · eventos y foto de cierre separados</p></div><span>FORUM P1 · Azure</span></div>
    <div className="forum-exec-grid">
      <Card title="Cotizaciones de septiembre" item={item("forum_quotations")} own={item("forum_quotations_own")?.value} dealers={item("forum_quotations_dealers")?.value}
        subtitle={number(item("forum_applications")?.value) + " solicitudes de la cohorte"}
        note="Mes de cotización completo. Las solicitudes reflejan el estado consolidado de esa cohorte en la fecha de consulta."/>
      <Card title="Operaciones al 30/09" item={item("forum_snapshot_operations")}
        subtitle="Foto exacta de cierre"
        note="Los estados de esta foto no equivalen a eventos cursados durante septiembre. Las aperturas por estado pendientes no se sustituyen por estados actuales."/>
      <Card title="UFIs ejecutadas" item={item("forum_ufis")} own={item("forum_ufis_own")?.value} dealers={item("forum_ufis_dealers")?.value}
        subtitle={number(item("forum_curses")?.value) + " operaciones cursadas"}
        note="Ejecuciones por fecha de curse del 01 al 30/09. Las unidades financiadas pueden superar el número de operaciones."/>
    </div>
    <p className="forum-exec-method">Cotizaciones y solicitudes de septiembre: universo consolidado observado al publicar esta conciliación. Foto del 30/09: snapshot histórico exacto, independiente del consolidado posterior. PRECURSE solo certifica el último stock disponible; no se incorpora el stock de octubre como si fuera septiembre.</p>
  </section>;
}

