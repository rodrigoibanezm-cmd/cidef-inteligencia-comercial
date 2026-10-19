import Link from "next/link";

const areas = [
  {
    href: "/cierre-mensual",
    title: "Cierre mensual",
    eyebrow: "MES CERTIFICADO",
    body: "Resultados definitivos, evolución interanual, trayectoria de cuatro meses y análisis comercial integrado.",
    status: "Base habilitada · datos por conectar",
  },
  {
    href: "/como-vamos",
    title: "¿Cómo vamos?",
    eyebrow: "MES EN CURSO",
    body: "Ventas a la fecha, ritmo comercial, señales tempranas y proyección diferenciada de ventas efectivas.",
    status: "Base habilitada · datos por conectar",
  },
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandmark">C</span>
          <div><strong>CIDEF</strong><small>INTELIGENCIA COMERCIAL</small></div>
        </div>
        <span className="topnote">Plataforma comercial</span>
      </header>
      <section className="hero">
        <div className="eyebrow">ANÁLISIS INTEGRADO</div>
        <h1>Una mirada completa al negocio.</h1>
        <p>Ventas como eje central. RVM, CRM, Forum y financiamiento para explicar los resultados, entender la trayectoria y anticipar decisiones.</p>
      </section>
      <section className="cards">
        {areas.map((area) => (
          <Link href={area.href} className="feature" key={area.href}>
            <span className="eyebrow">{area.eyebrow}</span>
            <h2>{area.title}<span aria-hidden="true"> ↗</span></h2>
            <p>{area.body}</p>
            <span className="status">{area.status}</span>
          </Link>
        ))}
        <article className="feature">
          <span className="eyebrow">PLANIFICACIÓN COMERCIAL</span>
          <h2>Proyecciones</h2>
          <p>Ingreso semanal de proyecciones y administración del tablero de ventas.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: "auto" }}>
            <Link href="/proyeccion-semanal.html" className="back">Ingreso semanal ↗</Link>
            <Link href="/proyeccion-admin.html" className="back">Administración ↗</Link>
          </div>
        </article>
      </section>
      <footer>SALES · RVM · CRM · FORUM · FINANCIAMIENTO</footer>
    </main>
  );
}
