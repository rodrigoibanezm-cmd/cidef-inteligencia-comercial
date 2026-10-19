# Estado del módulo de proyecciones

Última verificación: 2026-10-19.

## Baseline y ramas

- Baseline funcional restaurado del frontend: `ab7fe2d5f2faa0bdc1b49e2332f89f50a26c6614` (`ab7fe2d`).
- Origen certificado de la migración original a Azure: `313265d7ab7ab075b957caf8c288086035bb0532`.
- El despliegue de esa migración fue validado por el [Action 39263184302](https://github.com/rodrigoibanezm-cmd/cidef-azure-platform/actions/runs/39263184302), con resultado exitoso.
- En la verificación inicial, `main` y `staging` apuntaban a `ab7fe2d`. `main` es producción; todo desarrollo nuevo se hace en `staging`.

## Aplicaciones y despliegue

| Entorno | Rama fuente | Aplicación Azure | URL |
|---|---|---|---|
| Producción | `main` | `cidef-inteligencia-comercial` | [Abrir producción](https://cidef-inteligencia-comercial.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/) |
| Pruebas | `staging` | `cidef-intel-comercial-staging` | [Abrir staging](https://cidef-intel-comercial-staging.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/) |

Ambas aplicaciones usan el Container Apps Environment `cidef-prod-env`, el grupo `rg-cidef-prod` y el ACR existente `cidefprodacr`. El nombre solicitado inicialmente para la aplicación staging excedía el límite de longitud aceptado por Azure; el nombre real es `cidef-intel-comercial-staging`.

Los workflows están en [`cidef-azure-platform`](https://github.com/rodrigoibanezm-cmd/cidef-azure-platform):

- [Producción: `deploy-inteligencia-comercial.yml`](https://github.com/rodrigoibanezm-cmd/cidef-azure-platform/blob/main/.github/workflows/deploy-inteligencia-comercial.yml). Obtiene el frontend desde `main` y actualiza solo `cidef-inteligencia-comercial`.
- [Staging: `deploy-inteligencia-comercial-staging.yml`](https://github.com/rodrigoibanezm-cmd/cidef-azure-platform/blob/main/.github/workflows/deploy-inteligencia-comercial-staging.yml). Obtiene el frontend desde `staging` y despliega solo `cidef-intel-comercial-staging`.
- El Action de staging [39316940442](https://github.com/rodrigoibanezm-cmd/cidef-azure-platform/actions/runs/39316940442) terminó exitosamente y verificó páginas y endpoints de lectura.

## PostgreSQL Azure

Las dos aplicaciones usan `AZURE_DATABASE_URL` del environment `Production` del repositorio de plataforma. Apuntan al mismo PostgreSQL Azure y al mismo conjunto de datos; no existe una base de datos ni un juego duplicado de tablas para staging.

Las proyecciones usan las tablas compartidas existentes:

- `weekly_projection_sellers`: catálogo de vendedores habilitados para el ingreso.
- `weekly_sales_projection`: proyecciones ingresadas y editadas.
- `sales_sent_not_invoiced`: vehículos enviados que aún no se facturan.

También consultan datos y maestros existentes, entre ellos `ventas_raw`, `forum_funnel_universe_v01`, `sucursales_master`, `persona_aliases` y maestros de producto. No ejecutar pruebas de escritura en staging: sus altas, ediciones y eliminaciones afectan las mismas tablas productivas.

La conexión se implementa en `lib/db.js` y requiere `AZURE_DATABASE_URL`; no hay fallback a Neon.

## Funcionalidad y fuentes verificadas

Páginas estáticas servidas desde `public/`:

- `public/proyeccion-semanal.html` (`/proyeccion-semanal.html`): ingreso, listado, edición y eliminación de proyecciones por tienda y semana. Permite asociar varias filas a un CRM y seleccionar modelo/versión.
- `public/proyeccion-admin.html` (`/proyeccion-admin.html`): ventas e históricos, proyecciones, análisis por compañía o tienda y detalle de vendedores.

Rutas reales bajo `app/api/weekly-projections/`:

- `sucursales`, `vendedores`, `modelos`, `projections`, `not-invoiced`, `admin`, `company-finance` y `forum-sellers`.

El selector de tienda se llena desde `/api/weekly-projections/sucursales`; la opción `Red CIDEF` representa la vista de compañía. El selector de semana conserva la fecha elegida en el navegador.

Fuentes actuales de indicadores:

- **Ventas:** `/admin` consulta `ventas_raw`, filtra `categoria_cliente = 'Cliente General'` y VIN válido, resuelve tienda y producto con maestros, y conserva la fecha de factura más reciente por VIN.
- **Cotizaciones y aprobados FORUM:** `/company-finance` y `/forum-sellers` leen `forum_funnel_universe_v01`; aprobados se identifican con `estado_actual = 'APROBADA'`.
- **UFI ejecutadas:** la tarjeta de compañía y el desglose por tienda las cuentan desde ventas de `ventas_raw` cuyo `entidad_financiera = 'FORUM'`. El detalle por vendedor además consume `ufi_curse` de `forum_funnel_universe_v01`, por fecha de curse. Las fuentes no son idénticas entre vistas; validar cualquier cambio antes de unificarlas.
- **Otros créditos:** ventas distintas por VIN en `ventas_raw` con entidad financiera informada y distinta de FORUM.
- **Pre-cursadas:** no aparecen como indicador en las rutas actuales de proyecciones. No confundirlas con cotizaciones, aprobados ni UFI.

## Rendimiento y pendientes

Problema conocido: al cambiar semana o tienda, el tablero vuelve a pedir `/admin` y `/company-finance` (y, en una tienda, vendedores y datos FORUM). `/admin` vuelve a leer y agrupar ventas históricas desde `ventas_raw`; `/company-finance` hace consultas adicionales sobre ventas para UFI y otros créditos. No se observa reutilización de snapshots en el flujo actual del tablero. Esto explica parte de la demora reportada.

Pendientes acordados:

1. Reducir tiempos de carga sin duplicar cálculos ni cambiar reglas comerciales.
2. Revisar qué columnas de Ventas deben mostrarse y cómo se presentan.
3. Definir e incorporar la columna de Pre-cursadas con una fuente FORUM certificada.

No están autorizados cambios de diseño, indicadores o lógica hasta recibir instrucciones explícitas.
