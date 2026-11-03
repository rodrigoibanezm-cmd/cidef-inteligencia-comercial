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
.mc-product-table th,.mc-product-table td{padding:8px 6px;border-bottom:1px solid #edf0f4;text-align:center;overflow-wrap:anywhere}
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
`;

// Shared styling only: the closed month already has its certified SALES/P1 split.
export function CommercialDetailProvider({ children }) {
  return <><style>{styles}</style>{children}</>;
}

export function FamilyModelTable({ columns, groups, totalLabel, totalValues }) {
  const [open, setOpen] = useState({});
  const firstWidth = columns.length === 2 ? 72 : 40;
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

export default function CommercialProductDetail({ channel, metrics }) {
  const detail = channelDetail(channel, metrics), label = channel === "stores" ? "Tiendas Propias" : "Dealers";
  return <section aria-label={"Detalle comercial por familia y modelo · " + label} style={{marginTop:20}}>
    <h4>Detalle comercial · familia y modelo</h4>
    {!detail && <p role="status">Pendiente: desglose mensual sin conciliación con las ventas P1 del canal.</p>}
    {brands.map(([brand, name, order]) => {
      const models = detail?.models.filter(row => row.brand === brand) || [];
      const families = [...order, ...new Set(models.map(row => row.family).filter(family => !order.includes(family)))];
      const groups = families.map(family => {
        const members = models.filter(row => row.family === family);
        return { label:family, values:[numberText(detail && members.length ? sum(members) : null)], models:members.map(row => ({id:row.modelo_id, label:row.modelo, values:[numberText(row.ventas)]})) };
      });
      return <div key={brand} style={{marginTop:14}}><h4>{name}</h4><FamilyModelTable columns={["Familia / Modelo", "Vendidos mes"]} groups={groups} totalLabel={"Total " + name} totalValues={[numberText(detail ? sum(models) : null)]}/></div>;
    })}
    <div className="mc-product-total"><span>Total {label}</span><span>{numberText(detail?.total)}</span></div>
    <p>Fuente: SALES/P1 · octubre 2026 · ventas por modelo antes de NC.</p>
  </section>;
}

