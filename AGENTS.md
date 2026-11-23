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
