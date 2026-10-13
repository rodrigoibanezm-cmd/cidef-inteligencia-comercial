# Motor FORUM · cierre mensual · v1.0

Propietario: `cidef-inteligencia-comercial`. Fuente certificada: FORUM P1; denominador VIN: SALES P1. Sin cálculos delegados al LLM.

## Datos de entrada

`data/monthly-close/2026-09/forum-close-source.json` guarda observaciones de septiembre 2026 (mes completo 1–30) y cohortes abril–septiembre, separadas por semántica:

- `QUOTATIONS`: operaciones de cotización del mes, por `fecha_cotizacion`.
- `APPLICATIONS`: operaciones con proceso distinto de cotización, atribuidas al mes de cotización.
- `CURSES`: operaciones cursadas con fecha válida de `fecha_curse` en septiembre.
- `UFIS`: unidades financiadas en operaciones Curse de septiembre. Por ello `CURSES` y `UFIS` pueden diferir.
- `COHORT_APPROVED`: cotizaciones del mes hoy en estado APROBADA, sin curse; stock de esa cohorte observado en la fecha `observed_at`.
- `COHORT_CONVERTED`: cotizaciones de esa cohorte con curse certificado al `observed_at`; diferente a `CURSES` ejecutados durante un mes.
- `sales_vin`: SALES certificado por red y compañía para el mismo mes completo. No usar valores históricos archivados de 377 propias o 667 dealers: septiembre SALES reconocido es 375 propias, 666 dealers, 1041 compañía.

La primera tabla es un **cierre de eventos de septiembre**, acompañado por los estados de su cohorte observados a 2026-10-13. Las tasas de aprobación y conversión de cohortes anteriores NO reconstruyen estados al final de esos meses; se necesitarían snapshots diarios certificados para comparación a igual maduración. Está prohibido presentar esas tasas como series históricas de estados al día 29 o 30.

## Contrato y fórmulas

`lib/motors/forum-close-v1.js` exporta `computeForumClose(source)`, que valida recuentos enteros no negativos y produce una salida reproducible.

- `network.COMPANY[k] = network.OWN_STORES[k] + network.DEALERS[k]`.
- `penetration = UFIS / sales_vin` por canal, con ambas fuentes expresamente identificadas.
- `approved_pending_share = COHORT_APPROVED / QUOTATIONS` dentro de la misma cohorte y fecha de observación.
- `converted_share = COHORT_CONVERTED / QUOTATIONS` (cohortes de distinta edad; no inferir deterioro sin igualdad de maduración).
- `signals.*_change`: cambio aritmético de observaciones mensuales completas. Para estados de cohorte, NO se infiere una comparación a igual edad.

**Controles fail-closed**: validar suma de redes contra cotizaciones, solicitudes y aprobadas sin curse de cohorte septiembre; validar curses y UFIs del evento septiembre. Fuente inconsistente causa error; no se ajustan valores para cuadrar.

## Frontend y pruebas

`components/ForumClose.js` presenta tabla por red, gráfico de aprobadas sin curse/cotizaciones, curva mensual UFIs, tabla de cohortes y tres indicadores de variación. `app/cierre-mensual/page.js` lo muestra inmediatamente después de KPIs y antes del ranking. La sección antigua con 174 UFIs/377 VIN fue eliminada. Financiamiento ERP se conserva separado, pues un VIN con financiera no equivale a UFI FORUM.

Tests: `node --test test/forum-close.test.js`. La CI ejecuta estos tests y los de ranking. Cambios de períodos o fuentes requieren materialización versionada, validación y nueva versión contractual.
