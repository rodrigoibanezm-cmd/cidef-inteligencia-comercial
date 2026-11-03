"use client";

import { Fragment, useState } from "react";
import { numberText } from "../lib/monthly-close-v2-view";
import facts from "../data/monthly-close/2026-10/facts.json";

const brands = [["FOTON", "Foton", ["MINI_TRUCK", "PICKUP", "VP"]], ["DFM", "Dongfeng", ["AEOLUS", "FORTHING"]]];
const units = value => Number.isSafeInteger(value) && value >= 0;
const sum = rows => rows.reduce((n, row) => n + row.ventas, 0);
const styles = `
.mc-product-table{overflow:auto;border:1px solid #e1e5ec;border-radius:14px;margin-top:6px}
.mc-product-table table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;font-variant-numeric:tabular-nums}
.mc-product-table th,.mc-product-table td{height:36px;padding:8px 6px;border-bottom:1px solid #edf0f4;text-align:center;overflow-wrap:anywhere}.mc-product-table thead th{height:44px}
.mc-product-table th:first-child{text-align:left}
.mc-product-table thead{background:#fafbfc;color:#697487}
.mc-product-table .mc-product-family{background:#eef2f8;font-weight:750}
.mc-product-table .mc-product-model th{padding-left:24px;color:#596579;font-weight:500}
.mc-product-table .mc-product-model[hidden]{display:none}
.mc-product-table tfoot{background:#eaf0f7;font-weight:750}
.mc-product-table tfoot th,.mc-product-table tfoot td{border-bottom:0}
.mc-family-toggle{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;font-weight:750;cursor:pointer}
.mc-family-toggle:hover{text-decoration:underline}
.mc-family-toggle:focus-visible{outline:2px solid #2563eb;outline-offset:3px}
.mc-family-toggle span{flex-shrink:0;width:10px}
.mc-product-total{display:flex;justify-content:space-between;gap:16px;padding:12px 6px;margin-top:12px;background:#eaf0f7;border-radius:10px;font-size:13px;font-weight:750}
.mc-close-summary-grid>.mc-executive-card{display:grid;grid-template-rows:subgrid;grid-row:span 6;row-gap:0}
.mc-commercial-detail{min-width:0;border-top:1px solid #e5eaf1;padding-top:16px;margin-top:4px}
.mc-commercial-detail>h4{font-size:13px;margin:0 0 16px;min-height:32px}
.mc-company-models table{font-size:12px}.mc-company-models th,.mc-company-models td{padding:8px 3px}
@media(min-width:851px){.mc-close-summary-grid{grid-template-columns:minmax(0,4fr) repeat(2,minmax(0,3fr))}}
@media(max-width:850px){.mc-close-summary-grid>.mc-executive-card{display:block;grid-row:auto}.mc-commercial-detail{margin-top:16px}}
`;

export function CommercialDetailProvider({ children }) {
  return <><style>{styles}</style>{children}</>;
}

export function FamilyModelTable({ columns, groups, totalLabel, totalValues }) {
  const [open, setOpen] = useState({});
  const firstWidth = columns.length === 2 ? 72 : columns.length === 6 ? 30 : 40;
  const cells = values => values.map((value, index) => <td key={index}>{value}</td>);
  return <div className="mc-product-table"><table>
    <colgroup>{columns.map((column, index) => <col key={column} style={{width:(index ? (100 - firstWidth) / (columns.length - 1) : firstWidth) + "%"}}/>)}</colgroup>
    <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{groups.map(group => <Fragment key={group.label}>
      <tr className="mc-product-family"><th scope="row"><button type="button" className="mc-family-toggle" aria-expanded={!!open[group.label]} onClick={() => setOpen(previous => ({...previous, [group.label]:!previous[group.label]}))}><span aria-hidden="true">{open[group.label] ? "▾" : "▸"}</span>{group.label}</button></th>{cells(group.values)}</tr>
      {group.models.length ? group.models.map(model => <tr className="mc-product-model" key={model.id} hidden={!open[group.label]}><th scope="row">{model.label}</th>{cells(model.values)}</tr>) : <tr className="mc-product-model" hidden={!open[group.label]}><td colSpan={columns.length}>Modelos pendientes en el snapshot.</td></tr>}
    </Fragment>)}</tbody>
    <tfoot><tr><th scope="row">{totalLabel}</th>{cells(totalValues)}</tr></tfoot>
  </table></div>;
}

export function channelDetail(channel, metrics, saved = facts.commercial_model_sales_p1) {
  const split = saved?.channels?.[channel], suffix = channel === "stores" ? "own" : "dealers";
  if (saved?.status !== "CERTIFIED" || saved.period !== facts.period || !split || !Array.isArray(split.models) ||
    [["sales_" + suffix + "_p1", split.total], ["sales_foton_" + suffix + "_p1", split.foton], ["sales_dongfeng_" + suffix + "_p1", split.dongfeng]].some(([id, n]) => !units(n) || metrics[id]?.status !== "CERTIFIED" || metrics[id].value !== n)) return null;
  const models = split.models;
  if (models.some(row => !row || !units(row.ventas) || !row.modelo_id || !row.modelo || !row.family || !brands.some(([brand]) => brand === row.brand)) ||
    new Set(models.map(row => String(row.modelo_id))).size !== models.length || sum(models) !== split.total ||
    sum(models.filter(row => row.brand === "FOTON")) !== split.foton || sum(models.filter(row => row.brand === "DFM")) !== split.dongfeng) return null;
  return { models, total: split.total };
}

export function companyDetail(metrics) {
  const channels = [channelDetail("stores", metrics), channelDetail("dealers", metrics)];
  if (channels.some(detail => !detail)) return null;
  const models = new Map();
  channels.flatMap(detail => detail.models).forEach(row => models.set(row.modelo_id, {...row, ventas:(models.get(row.modelo_id)?.ventas || 0) + row.ventas}));
  return {models:[...models.values()], total:channels.reduce((n, detail) => n + detail.total, 0)};
}

export default function CommercialProductDetail({ channel, metrics }) {
  const company = channel === "company", detail = company ? companyDetail(metrics) : channelDetail(channel, metrics);
  const label = company ? "Compañía" : channel === "stores" ? "Tiendas Propias" : "Dealers";
  const pending = <span title="Pendiente" aria-label="Pendiente">—</span>;
  const rvm = facts.rvm_model_detail, rvmRows = company && rvm?.status === "CERTIFIED" && rvm.period === facts.period ? rvm.rows : [];
  const key = row => [row.brand, row.family, (row.modelo || row.model).replace(/^FOTON /i, "").replace(/\s/g, "").toUpperCase()].join(":");
  const extra = (members, total = false) => {
    const totalFor = field => members.length && members.every(row => units(row[field])) ? numberText(members.reduce((n, row) => n + row[field], 0)) : pending;
    const row = !total && members.length === 1 ? members[0] : null;
    return [totalFor("month"), row?.rank ? row.rank + "°" : pending, Number.isFinite(row?.participation_percent) ? row.participation_percent.toLocaleString("es-CL", {maximumFractionDigits:2}) + "%" : pending, totalFor("ytd")];
  };
  return <section className={"mc-commercial-detail" + (company ? " mc-company-models" : "")} aria-label={"Detalle comercial por familia y modelo · " + label}>
    <h4>Detalle comercial · familia y modelo</h4>
    {!detail && <p role="status">Pendiente: desglose mensual sin conciliación con las ventas P1 del canal.</p>}
    {brands.map(([brand, name, order]) => {
      const models = detail?.models.filter(row => row.brand === brand) || [], registrations = rvmRows.filter(row => row.brand === brand);
      const families = [...order, ...new Set([...models, ...registrations].map(row => row.family).filter(family => !order.includes(family)))];
      const groups = families.map(family => {
        const members = models.filter(row => row.family === family), registered = registrations.filter(row => row.family === family);
        const entries = [...members, ...registered.filter(row => !members.some(member => key(member) === key(row))).map(row => ({...row, modelo_id:key(row), modelo:row.model, ventas:null}))];
        return {label:family, values:[numberText(detail && (company || members.length) ? sum(members) : null), ...(company ? extra(registered, true) : [])], models:entries.map(row => ({id:row.modelo_id, label:row.modelo, values:[Number.isFinite(row.ventas) ? numberText(row.ventas) : pending, ...(company ? extra(registered.filter(item => key(item) === key(row))) : [])]}))};
      });
      return <div key={brand} style={{marginTop:14}}><h4>{name}</h4><FamilyModelTable columns={["Familia / Modelo", company ? "Ventas mes" : "Vendidos mes", ...(company ? ["RVM mes", "Rank. RVM", "Part. %", "Acum. RVM"] : [])]} groups={groups} totalLabel={"Total " + name} totalValues={[numberText(detail ? sum(models) : null), ...(company ? extra(registrations, true) : [])]}/></div>;
    })}
    <div className="mc-product-total"><span>Total {label}</span><span>{numberText(detail?.total)}</span></div>
    <p>Fuente: SALES/P1 · octubre 2026 · ventas por modelo antes de NC.{company && " Total P1 distinto del neto de Finanzas. RVM: inscripciones del mes y enero–octubre; ranking y participación contra el segmento. Nombres sin equivalencia confirmada se mantienen separados; —: pendiente; no hay equivalencia o ranking agregado comparable."}</p>
  </section>;
}


