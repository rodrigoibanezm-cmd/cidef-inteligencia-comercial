# Instrucciones para Codex

- Todo desarrollo nuevo de este repositorio se realiza sobre la rama `staging`.
- No modificar ni desplegar `main` sin aprobación explícita.
- Conservar el diseño y la funcionalidad existente; no introducir indicadores nuevos ni cambios no solicitados.
- Reutilizar datos, consultas, contratos y motores ya disponibles. No duplicar cálculos ni fuentes.
- Implementar cambios mínimos, uno a la vez, y verificar solo lo necesario.
- No modificar infraestructura, workflows de producción, bases de datos, tablas ni usuarios sin autorización explícita.
- Staging comparte el PostgreSQL productivo. Evitar escrituras de prueba: los ingresos, ediciones y eliminaciones desde staging pueden afectar datos productivos.
- Antes de proponer o ejecutar cambios en proyecciones, leer `docs/PROYECCIONES-STATE.md` y verificar las rutas y workflows actuales.

## Control obligatorio previo a implementar (Codex)

**Codex debe revisar críticamente la solución solicitada; no debe obedecer una propuesta técnica solo porque aparezca en el prompt.** Antes de editar, crear archivos o ejecutar comandos con efectos, debe:

1. Leer este `AGENTS.md` y los documentos específicos de la tarea.
2. Comprobar en el código y la configuración vigentes qué existe y qué funciona; citar archivos o líneas concretas.
3. Verificar si el objetivo puede alcanzarse **sin cambios** o reutilizando el mecanismo existente. Comparar esa alternativa con la solución pedida.
4. Justificar que cada archivo, script, dependencia, recurso o paso nuevo es indispensable. Elegir la opción con menos piezas y menor riesgo.
5. Delimitar un único cambio funcional, máximo dos archivos, pruebas mínimas y riesgos reales.

**Regla de rechazo:** si la solución solicitada es innecesaria, duplica una capacidad existente, introduce complejidad evitable, no está respaldada por evidencia o requiere decisiones técnicas pendientes, **DETENERSE SIN IMPLEMENTAR**. Informar: (a) qué requisito se busca cubrir, (b) evidencia que contradice la propuesta, (c) alternativa más simple y (d) decisión concreta que necesita aprobación. No sustituir silenciosamente por otra implementación.

Si pasa el control, informar brevemente el resultado de esas cinco comprobaciones **antes de implementar** y ejecutar solo el alcance autorizado. La instrucción del usuario de «implementar» no elimina este control. Nunca desplegar sin autorización explícita.

## Nota de venta opcional — Proyecciones, staging (2026-11-23)
- Implementado en `staging`, sin despliegue ni escrituras de prueba. Dos archivos funcionales: `app/api/weekly-projections/not-invoiced/route.js` y `public/proyeccion-semanal.html`.
- `GET /api/weekly-projections/not-invoiced?nota_de_venta=N` consulta exclusivamente `notas_venta_raw`, devuelve marca y `modelo_comercial`, deduplica notas repetidas por marca/modelo; si una nota contiene distintos modelos solicita selección manual.
- Botón Buscar opcional en línea `Enviado no facturado`: intenta resolver el modelo activo del catálogo; evita selección automática si el resultado no es único. Guardar sin nota sigue disponible.
- **Limitación deliberada:** el número de nota se usa solo para búsqueda, no queda persistido en `sales_sent_not_invoiced` (no existe contrato de almacenamiento verificado). No inventar columna ni migración sin estudiar el esquema. Si se requiere persistencia, tratarla como tarea distinta.
- Validación realizada: análisis de sintaxis de scripts API y frontend, comprobación estática de endpoint/deduplicación. Pendiente validación de búsqueda real contra Azure, publicación a staging y posible eliminación de fecha de proyección (alcance separado).

## Metodología de ejecución autorizada (2026-11-23)
- El usuario define un objetivo completo y autoriza una vez: auditar, implementar, hacer pruebas mínimas, corregir y documentar autónomamente, sin solicitar permisos por archivo, commit o test.
- Mantener un único objetivo y preferir una modificación funcional pequeña por ejecución, hasta 2 archivos salvo autorización explícita para un alcance mayor. Si el usuario autoriza varios cambios relacionados, no fraccionarlos artificialmente en solicitudes de aprobación.
- Nunca desplegar ni modificar `main` sin autorización específica. No tocar componentes existentes sanos, datos de producción ni infraestructura.
- GitHub Actions: reutilizar los workflows existentes; build y validaciones proporcionales al cambio, sin controles superfluos. No introducir workflows ni despliegues automáticos sin necesidad y autorización.
- Detenerse únicamente ante riesgo crítico, decisiones comerciales pendientes o cambios irreversibles.

## Tarjetas de proyecciones — histórico y composición (2026-11-23)
- En `staging`, `public/proyeccion-admin.html`: tarjeta mes titulada **Facturados del mes**; flujo del siguiente corte ordenado **Facturados + Enviado no facturado + Proyección** (mismos totales, sin alterar fuentes).
- Los gráficos históricos de ventas, proyección, semana y Forum/financiamiento muestran **cuatro meses anteriores al mes del corte**, sin incluir el mes actual; noviembre 2026 implica julio–octubre 2026. El valor actual o proyectado solo se usa para contrastar contra promedio de esos 4 meses.
- `app/api/weekly-projections/admin/route.js` aporta M-4…M-1 + CURRENT, tanto en compañía como por sucursal y en próximo corte. Referencia `historical_context.recent_4m`.
- `app/api/weekly-projections/company-finance/route.js` aporta M-4…M-1 + CURRENT para gráficos Forum/financiamiento.
- Pruebas mínimas: sintaxis JS de frontend y endpoints, y comprobaciones estáticas de fechas, orden y meses. Sin cambios de base de datos ni despliegue. Las vistas que consumen snapshots necesitan **Actualizar** luego de desplegar staging para regenerar resultados con M-4.

## Evolución semanal de noviembre 2026 — corrección (2026-11-23)
- Cortes comerciales **invariables**: S1 01–09, S2 10–16, S3 17–23 y S4 24–30. **No** usar lunes 2 como primer cierre. Primer cierre = lunes en o después del día 7; cierres siguientes cada 7 días.
- La tabla semanal presenta únicamente **Facturados**, **Total**, **Proyectados semana**, **Brecha**. Eliminar la fila independiente «Enviados no facturados», pero mantenerlos como componente del Total.
- Facturados = ventas del intervalo según fechas SALES certificadas P1; Total semanal = facturados del intervalo + registros enviados en ese intervalo que permanecían no facturados al corte de la semana (reconstrucción `sent_at`/`resolved_at`, sin sumar saldos de otras semanas). Brecha semanal = Total − proyección correspondiente al corte. S1 no tiene proyección de referencia.
- La consulta histórica se limita al mes del corte; **no** tratar el saldo histórico total como enviados de una semana ni confundir enviados con proyectados. El total mes usa facturados del período + pendientes vigentes al corte de la vista.
- Fuente actual verificada antes de desplegar: facturados S1=46, S2=92, S3=85, total 223 (al 22-nov); proyecciones S2=90, S3=94, S4=52; pendientes vigentes 7 (23-nov). Los pendientes históricos por semana **requieren regenerar y comprobar el resultado en staging**, no inferir de las cifras anteriores 67/90/105.
- Cambios aplicados solamente en rama `staging`, sin deploy ni cambios en `main`. Validar sintaxis y períodos; al desplegar staging regenerar snapshot con «Actualizar» y verificar que Totales/Brechas coincidan.

## Legibilidad tabla semanal (2026-11-23)
- Tabla «Evolución semanal del mes» debe ocupar las dos columnas completas de `projection-grid` (no apretarse junto a «Unidades última semana»).
- Mostrar solamente S1–S4 para noviembre 2026, en 4 filas: Facturados, Total, Proyectados semana, Brecha. **Sin columna «Total mes»** ni suma de brechas; no aporta y confunde.
- Celdas y fechas centradas y legibles, encabezados amplios, primera columna de indicadores visible, resaltar fila Total, y scroll horizontal solo en pantallas estrechas.
- Implementación exclusivamente de presentación en `public/proyeccion-admin.html`; no tocar API ni datos. El frontend de staging requiere nuevo despliegue después de este commit.

## Saldo inicial de cada semana: definición corregida (2026-11-23)
- S1 = 1–9 nov; S2 = 10–16; S3 = 17–23; S4 = 24–30. No cambiar cortes.
- Visualizar cinco filas en ese orden: Facturados al inicio, + Enviados no facturados, = Total inicial, Proyectados semana, Facturados de la semana. Sin columna total mes. Proyección S1 no aplica: no mostrar 10 VIN históricos del 02-nov.
- «Enviados no facturados» representa únicamente los registros asignados al **corte anterior inmediato** mediante `sales_sent_not_invoiced.week_start`, creados hasta ese corte y no resueltos a ese día. No sumar pendientes de semanas previas aunque sigan con status=PENDING, ni contar envíos posteriores al corte, ni deducirlos de la suma de proyecciones.
- `invoiced_start_units` = VIN certificados SALES facturados antes de comenzar la semana; `sold_units` = ese saldo facturado inicial + enviados no facturados del corte inmediatamente anterior; `weekly_sales` = VIN facturados durante esa semana; `projection` S1 = null.
- Auditoría de registros compartidos por usuario: enviados válidos por `week_start` y fechas a corte: S2 (09-nov)=5; S3 (16-nov)=10; S4 (23-nov)=14. Se excluyen registros asignados a semanas anteriores, así como cancelaciones anteriores al corte. Estos números proceden del extracto aportado por el usuario, no de un snapshot actualizado.
- Los cambios están en `staging` (API de resultados + front), con comprobación estática de sintaxis; **no desplegar automáticamente** ni modificar producción. Para ver cifras reales es necesario desplegar staging y regenerar snapshot desde «Actualizar».

## Histórico de meses completos — consistencia VIN (2026-11-23)
- `app/api/weekly-projections/admin/route.js`: preservar la deduplicación global de VIN para métricas existentes (`all`), pero generar `full_month_units` desde `monthlySales` deduplicado por (mes de factura, VIN). Una factura de noviembre no debe hacer desaparecer un VIN del total completo de octubre.
- Octubre 2026 completo debe coincidir entre la card «octubre de 2026 · mes completo» y el último punto del gráfico «4 meses anteriores · mes completo» (referencia comprobada antes de corregir: 451 card vs 450 gráfico).
- Cambios en `staging`; ejecutar deploy separado y comprobar respuesta read-only del API por el corte 2026-11-22. No desplegar producción.

## Tabla comparativa compacta (2026-11-23)
- Solo `staging`: `public/proyeccion-admin.html` agrupa Mes anterior y Año anterior (Al corte / Total mes), elimina las dos columnas redundantes del bloque comparativo y conserva los dos totales fijos de la izquierda según mockup aprobado.
- Colores azul/verde, separadores y cifras centradas; encabezados fijos de dos líneas. No cambia API, fuentes ni datos.
- Validación estática: cuatro columnas comparativas, correspondencia de grupos y visibilidad por pestaña. Pendiente build y verificación visual tras deploy staging.

## Dotación de vendedores — regla permanente (2026-11-23)
- La matriz de `proyeccion-admin.html` debe mostrar exclusivamente los vendedores devueltos por `GET /api/weekly-projections/vendedores?sucursal_id=...`, exactamente como `proyeccion-semanal.html` de producción. Mantener nombres, persona_id y orden del catálogo activo; no inventar filas, nombres, alias ni incorporar vendedores de SALES, Forum o históricos a la dotación visible.
- Los movimientos se atribuyen por sucursal y persona_id; los no asociados siguen incluidos en los totales de sucursal, nunca crean vendedores visibles. La diferencia entre total y filas visibles puede corresponder a personas fuera de dotación.
- Validación estática y sintaxis JS correctas en staging; pendiente despliegue y comprobación visual. No modificar producción ni datos.

## Enviados no facturados vigentes del corte (2026-11-24)
- En `staging`, `app/api/weekly-projections/results/route.js` conserva todos los registros PENDING de la semana seleccionada devueltos por el endpoint existente `not-invoiced`. No filtrar por día de ingreso: el cambio de medianoche no debe ocultar pendientes.
- No modificar la lógica histórica de saldos semanales, ni el alcance por week_start, ni los datos. Validación de sintaxis y prueba mínima con registros de dos días: ambos se incluyen. Pendiente deploy staging y comprobación de datos reales.


## Contrato P1 unificado — 2026-11-24
- `app/api/weekly-projections/results/route.js`: el transporte usa exclusivamente `data_query`. FORUM usa request declarativo; SALES batch y detalle conservan sus contratos mediante `action=sales_observe_many` y `action=data_fetch`.
- No reactivar herramientas legacy ni alterar P1. Azure es la única fuente oficial; nunca consultar Neon.
- Sintaxis validada; consulta real FORUM PRECURSE por `data_query` devolvió evidencia COMPLETE, 13 miembros. SALES batch requiere confirmar ejecución integral; una llamada de verificación falló internamente. Pendiente deploy staging y regenerar snapshot. Producción intacta.


## Identidad vendedores Salesforce — 2026-11-24
- Snapshot CRM resuelve únicamente contra dotación activa Azure y alias validados existentes. Prioridad: coincidencia exacta, normalización de tildes y separadores, firma de todos los tokens ordenados. No usar coincidencias parciales ni incorporar vendedores. Ambigüedad sigue sin resolver.
- Prueba mínima: cinco casos (apellidos invertidos, nombre parcial rechazado, prioridad exacta, vendedor fuera de dotación rechazado, variante exacta sin tilde). Sintaxis OK. Pendiente deploy staging y nuevo snapshot para medir cobertura real; no atribuir automáticamente la diferencia de Won al cruce.
