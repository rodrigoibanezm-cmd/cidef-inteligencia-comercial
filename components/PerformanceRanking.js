"use client";
import { useState } from "react";
import rankings from "../data/monthly-close/2026-09/performance-ranking.json";
import { calculateAllRankings, MONTHS, VERSION } from "../lib/motors/ranking-performance-v1";

const computed=calculateAllRankings(rankings);

const categories=[
 {id:"stores",title:"Tiendas propias",unit:"VIN",basis:"4 meses"},
 {id:"sellers",title:"Vendedores",unit:"VIN",basis:"Corte parcial"},
 {id:"dealers",title:"Dealers",unit:"VIN",basis:"4 meses"},
 {id:"models",title:"Modelos",unit:"VIN",basis:"4 meses"}
];
const number=v=>new Intl.NumberFormat("es-CL",{maximumFractionDigits:1}).format(v);
const percent=v=>(v>0?"+":"")+number(v*100)+"%";
const recent=MONTHS;
const labels=["Jun","Jul","Ago","Sep"];
const signed=n=>(n>0?"+":"")+number(n);
function Trend({months}){if(!months)return null;const max=Math.max(1,...recent.map(k=>months[k]||0));return <div className="rank-mini-trend" aria-label="Ventas junio a septiembre">{recent.map((k,i)=><div key={k} title={labels[i]+": "+number(months[k]||0)+" VIN"}><div className="rank-mini-track"><span style={{height:(Math.max(2,(months[k]||0)/max*100))+"%"}}/></div><small>{labels[i]}</small></div>)}</div>;}
function RankingItems({items}){
 return <div className="rank-items">{items.length?items.map((r,i)=><div className="rank-result" key={r.id}>
  <div className="rank-item-main"><span className="rank-position">{i+1}.</span><strong title={r.name}>{r.name.replace(/^CIDEF /,"")}</strong><b>{number(r.vin)} VIN</b></div>
  <div className="rank-item-secondary"><span className={"rank-delta "+(r.delta_vin>=0?"positive":"negative")}>{signed(r.delta_vin)} VIN vs promedio · {percent(r.change_pct)}</span><Trend months={r.months}/></div>
 </div>):<p className="rank-none">Sin casos elegibles con historia completa.</p>}</div>;
}
export default function PerformanceRanking(){
 const [category,setCategory]=useState("stores");
 const ranking=computed.category_results[category];
 const info=category==="sellers"
 ?"Vendedores: fuente parcial de 274 VIN. Sin historial completo ni cobertura certificada, no se publica ranking."
 :category==="dealers"
 ?"Dealers: reconstrucción junio–septiembre por VIN y grupo comercial (514/514, 491/491, 646/646 y 666/666). Agrupación histórica con identidad canónica actual: comparación provisional hasta validar vigencias de grupos. Ya no se utiliza Q3/Q2."
 :category==="models"
 ?"Modelos: agrupación orientativa a partir de nombre/modelo de VIN; pendiente de homologación con maestro canónico. No equiparar este ranking con cierre de producto certificado."
 :"Tiendas: VIN desde ventas_raw para junio–septiembre. Fuente septiembre: 375 VIN; se excluyen tiendas nuevas/sin tres meses previos con ventas.";
 return <section className="mc-panel mc-rank-section" aria-label="Ranking de desempeño comercial">
 <div className="mc-panel-head"><div><h2>Ranking de desempeño comercial</h2><p className="rank-subtitle">Destacados y señales de alerta · septiembre 2026 · fuente SALES</p></div><span>Top 5 · motor v{VERSION} · Δ VIN</span></div>
 <div className="rank-controls">
 <div className="rank-cats" role="group" aria-label="Categoría">{categories.map(c=><button type="button" key={c.id} className={category===c.id?"selected":""} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.title}</button>)}</div>
 </div>
 {category==="sellers"?<div className="rank-unavailable"><strong>Trayectoria de vendedores no disponible</strong><p>Falta completar y conciliar el histórico de ventas por vendedor para ordenar destacados y alertas. El ranking no se construirá usando solo el volumen de septiembre.</p></div>:
 <div className="rank-columns"><div className="rank-panel"><div className="rank-panel-header"><span className="rank-up">↗</span><strong>Top 5 · Mejor trayectoria</strong></div><RankingItems items={ranking.positive}/></div>
 <div className="rank-panel"><div className="rank-panel-header"><span className="rank-down">↘</span><strong>Top 5 · En alerta</strong></div><RankingItems items={ranking.negative}/></div></div>}
 <p className="rank-source-note">{info}</p>
 <p className="rank-source-note">Mismo criterio para tiendas, dealers y modelos: diferencia de VIN entre septiembre y promedio mensual junio–agosto; orden por impacto absoluto, porcentaje complementario. Solo entidades con ventas en los tres meses previos y promedio ≥10 VIN; para destacar al alza se exigen además ≥10 VIN en septiembre. Los cambios a la baja incluyen caídas a cero. Vendedores sin ranking hasta completar historial.</p>
 </section>;
}
