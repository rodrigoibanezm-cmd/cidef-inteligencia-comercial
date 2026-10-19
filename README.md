# CIDEF · Inteligencia Comercial

Aplicación Next.js desplegada en Azure Container Apps y conectada exclusivamente a PostgreSQL Azure.

## Rutas

- `/`: entrada a la plataforma.
- `/cierre-mensual`: cierre de período certificado.
- `/como-vamos`: mes en curso.
- `/proyeccion-semanal.html`: ingreso, edición y consulta de proyecciones semanales.
- `/proyeccion-admin.html`: tablero de ventas y administración de proyecciones.
- `/api/health/database`: comprobación de conectividad de solo lectura con PostgreSQL Azure.

## Desarrollo local

- Node.js 20 o superior.
- Definir `AZURE_DATABASE_URL` con la cadena de conexión del PostgreSQL Azure existente.
- `npm install`
- `npm run dev` para desarrollo local.
- `npm run build` para compilar.

La aplicación no usa Neon ni requiere una conexión a Vercel.

## Azure y despliegue

La imagen se construye en el Azure Container Registry existente y se publica en el Container App `cidef-inteligencia-comercial`, dentro de `rg-cidef-prod` / `cidef-prod-env`. El workflow reutilizable está en `rodrigoibanezm-cmd/cidef-azure-platform`, workflow **Deploy Inteligencia Comercial to Azure**. La autenticación es OIDC desde el environment Production del repositorio de plataforma.

- Producción: https://cidef-inteligencia-comercial.calmforest-1c67ab46.chilecentral.azurecontainerapps.io/
- El runtime recibe `AZURE_DATABASE_URL`; no se configura fallback a otro proveedor.
- Las páginas de proyecciones usan las tablas `weekly_projection_sellers`, `weekly_sales_projection` y `sales_sent_not_invoiced`, además de los maestros y fuentes comerciales existentes en PostgreSQL Azure. Cada vehículo se guarda como una fila independiente; un mismo CRM puede asociarse a varias filas. El despliegue aplica una migración de esquema acotada que retira solo reglas de unicidad basadas en `crm_opportunity_id`, sin modificar filas.

## Reglas de producto existentes

- SALES y VIN certificados como eje central; RVM, CRM, FORUM y financiamiento como dimensiones explicativas.
- YoY, trayectoria de cuatro meses y acumulado YTD. RVM incluye share mensual, YTD y doce meses móviles.
- Dimensiones: compañía, canal, tienda, vendedor, marca, línea, modelo, versión.
- FOTON: Pickups y Comerciales; DONGFENG: Aeolus, Forthing y categorías adicionales según maestro validado.
- Financiamiento de ventas por entidad separado de UFIs Forum por fecha Curse.
- Cierre mensual inmutable una vez certificado; mes abierto con corte explícito.
- No inventar cifras ni cruzar universos sin contrato certificado.
