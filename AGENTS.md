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
