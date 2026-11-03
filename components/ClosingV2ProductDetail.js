"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { numberText } from "../lib/monthly-close-v2-view";
import facts from "../data/monthly-close/2026-10/facts.json";

const Snapshot = createContext(null);
const keys = ["total", "ventas", "proyeccion", "enviado_no_facturado"];
const brands = [["89", "Foton", ["MINI_TRUCK", "PICKUP", "VP"]], ["71", "Dongfeng", ["AEOLUS", "FORTHING"]]];
const units = value => Number.isSafeInteger(value) && value >= 0;
const sum = rows => Object.fromEntries(keys.map(key => [key, rows.every(row => units(row[key])) ? rows.reduce((n, row) => n + row[key], 0) : null]));
const equal = (a, b) => keys.every(key => a[key] === b[key]);
const valid = row => keys.every(key => units(row[key])) && row.total === row.ventas + row.proyeccion + row.enviado_no_facturado;

export function CommercialDetailProvider({ period, children }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const cutoff = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
    setSnapshot(null);
    fetch("/api/monthly-close-tracking?" + new URLSearchParams({ period, cutoff_date: cutoff, view: "daily" }),
      { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || data?.ok !== true || data.period !== period || data.cutoff_date !== cutoff) return;
        if (!controller.signal.aborted) setSnapshot(data);
      }).catch(() => {});
    return () => controller.abort();
  }, [period]);
  return <Snapshot.Provider value={snapshot}>{children}</Snapshot.Provider>;
}

// Reuse productDetail's channel/brand/family grouping; never substitute RVM rows.
function snapshotChannelDetail(snapshot, channel, metrics) {
  const summary = snapshot?.summary, scope = channel === "stores" ? "OWN_STORES" : "DEALERS";
  if (!Array.isArray(summary?.product_models) || !Array.isArray(summary?.product_families) ||
    ![...summary.product_models, ...summary.product_families].every(row => row && typeof row === "object")) return null;
  const models = summary.product_models.filter(row => row.channel === scope);
  const families = summary.product_families.filter(row => row.channel === scope);
  const expected = summary[channel], suffix = channel === "stores" ? "own" : "dealers";
  if (!expected || ![expected.total, expected.foton, expected.dongfeng, expected.unidentified].every(units) ||
    expected.unidentified !== 0 || expected.total !== expected.foton + expected.dongfeng ||
    !models.every(row => valid(row) && ["89", "71"].includes(String(row.marca_id)) && row.modelo_id != null && row.modelo && row.familia) ||
    !families.every(row => valid(row) && ["89", "71"].includes(String(row.marca_id)) && row.familia) ||
    new Set(models.map(row => String(row.modelo_id))).size !== models.length ||
    new Set(families.map(row => row.marca_id + ":" + row.familia)).size !== families.length) return null;
  if (models.some(row => !families.some(family => String(family.marca_id) === String(row.marca_id) && family.familia === row.familia)) ||
    families.some(family => !equal(family, sum(models.filter(row => String(row.marca_id) === String(family.marca_id) && row.familia === family.familia))))) return null;
  const total = sum(models);
  if (total.ventas !== expected.total || brands.some(([id], i) => sum(models.filter(row => String(row.marca_id) === id)).ventas !== expected[i ? "dongfeng" : "foton"])) return null;
  const references = [["sales_" + suffix + "_p1", expected.total], ["sales_foton_" + suffix + "_p1", expected.foton], ["sales_dongfeng_" + suffix + "_p1", expected.dongfeng]];
  if (references.some(([id, value]) => metrics[id]?.status !== "CERTIFIED" || metrics[id].value !== value)) return null;
  if (channel === "stores" && (total.proyeccion !== expected.projected_units || total.enviado_no_facturado !== expected.sent_not_invoiced_units || total.total !== expected.expected_total)) return null;
  return { models, families, total };
}

// The daily tracking snapshot covers a narrower commercial universe.
// When it cannot reconcile with P1, show the certified monthly P1 model split
// without mixing in projections or sent-not-invoiced from another universe.
function certifiedP1Detail(channel, metrics) {
  const saved = facts.commercial_model_sales_p1;
  const split = saved?.channels?.[channel];
  const suffix = channel === "stores" ? "own" : "dealers";
  if (saved?.status !== "CERTIFIED" || saved.period !== facts.period ||
      !split || !Array.isArray(split.models) ||
      [["sales_" + suffix + "_p1", split.total], ["sales_foton_" + suffix + "_p1", split.foton],
       ["sales_dongfeng_" + suffix + "_p1", split.dongfeng]].some(([id,n]) =>
        metrics[id]?.status !== "CERTIFIED" || metrics[id].value !== n)) return null;
  const models = split.models.map(row => ({
    ...row, marca_id: row.brand === "FOTON" ? "89" : "71", familia: row.family,
    total: row.ventas, proyeccion: null, enviado_no_facturado: null
  }));
  if (models.some(row => !units(row.ventas) || !row.modelo || !row.familia) ||
      models.reduce((n,row) => n + row.ventas, 0) !== split.total ||
      models.filter(row => row.marca_id === "89").reduce((n,row) => n + row.ventas, 0) !== split.foton ||
      models.filter(row => row.marca_id === "71").reduce((n,row) => n + row.ventas, 0) !== split.dongfeng) return null;
  const keys = [...new Set(models.map(row => row.marca_id + ":" + row.familia))];
  const families = keys.map(key => {
    const [marca_id, familia] = key.split(":");
    const rows = models.filter(row => row.marca_id === marca_id && row.familia === familia);
    return { marca_id, familia, ...sum(rows) };
  });
  return { models, families, total: sum(models), source: "P1" };
}
export function channelDetail(snapshot, channel, metrics) {
  return snapshotChannelDetail(snapshot, channel, metrics) || certifiedP1Detail(channel, metrics);
}

export default function CommercialProductDetail({ channel, metrics }) {
  const snapshot = useContext(Snapshot), detail = channelDetail(snapshot, channel, metrics);
  const cells = row => keys.map(key => <td key={key} style={{textAlign:"center", padding:"7px 6px"}}>{row?.[key] === null ? "—" : numberText(row?.[key])}</td>);
  return <section aria-label={"Detalle comercial por familia y modelo · " + (channel === "stores" ? "Tiendas propias" : "Dealers")} style={{marginTop:20}}>
    <h4>Detalle comercial · familia y modelo</h4>
    {!detail && <p role="status">Pendiente: snapshot sin desglose completo o sin conciliación con las ventas P1 de este canal.</p>}
    {brands.map(([id, name, order]) => {
      const families = detail?.families.filter(row => String(row.marca_id) === id) || [];
      const models = detail?.models.filter(row => String(row.marca_id) === id) || [];
      const names = [...order, ...families.map(row => row.familia).filter(family => !order.includes(family))];
      return <div key={id} style={{marginTop:14}}><h4>{name}</h4><div className="mc-description-table">
        <table style={{minWidth:490, tableLayout:"fixed"}}><colgroup><col style={{width:"32%"}}/>{keys.map(key => <col key={key} style={{width:"17%"}}/>)}</colgroup>
          <thead><tr>{["Familia / Modelo", "Total", "Ventas", "Proyección", "Enviado no facturado"].map(label => <th key={label} style={{padding:"7px 6px", textAlign:label === "Familia / Modelo" ? "left" : "center"}}>{label}</th>)}</tr></thead>
          <tbody>{names.map(family => {
            const row = families.find(item => item.familia === family), members = models.filter(item => item.familia === family);
            return <tr key={family}><td colSpan={5} style={{padding:0}}><details>
              <summary style={{cursor:"pointer", padding:"7px 6px", background:"#eef2f8", fontWeight:750}}>
                <span style={{display:"inline-grid", width:"96%", gridTemplateColumns:"32% repeat(4, 17%)"}}><span>{family}</span>{keys.map(key => <span key={key} style={{textAlign:"center"}}>{row?.[key] === null ? "—" : numberText(row?.[key])}</span>)}</span>
              </summary>
              {members.length ? <table style={{width:"100%", tableLayout:"fixed"}}><colgroup><col style={{width:"32%"}}/>{keys.map(key => <col key={key} style={{width:"17%"}}/>)}</colgroup><tbody>{members.map(model => <tr key={model.modelo_id}><th scope="row" style={{padding:"7px 6px 7px 18px", color:"#596579"}}>{model.modelo}</th>{cells(model)}</tr>)}</tbody></table> : <p>Modelos pendientes en el snapshot.</p>}
            </details></td></tr>;
          })}</tbody><tfoot><tr><th scope="row">Total {name}</th>{cells(detail ? sum(models) : null)}</tr></tfoot>
        </table>
      </div></div>;
    })}
    <div className="mc-description-table" style={{marginTop:12}}><table><tbody><tr><th scope="row">Total canal</th>{cells(detail?.total)}</tr></tbody></table></div>
    <p>{detail?.source === "P1" ? "Fuente: SALES/P1 certificado · ventas por modelo antes de NC. Proyecciones y enviado no facturado: no comparables con este universo; no se suman." : "Fuente: snapshot de Seguimiento de Cierre · ventas comerciales antes de NC. Total = Ventas + Proyección + Enviado no facturado."}</p>
    {detail && detail.source !== "P1" && <p>Corte de ventas: {snapshot.cutoff_date}. {channel === "dealers" ? "Dealers con sell-in positivo en septiembre 2026." : "Enviado no facturado: pendientes ingresados el " + (snapshot.sources?.stores?.sent_not_invoiced_date || "día del snapshot") + "."} No se suma al cierre contable.</p>}
  </section>;
}
