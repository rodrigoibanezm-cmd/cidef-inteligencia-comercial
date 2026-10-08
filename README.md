# CIDEF · Inteligencia Comercial

Aplicación Next.js preparada para despliegue en Vercel.

## Rutas

- `/`: entrada a la plataforma.
- `/cierre-mensual`: cierre de período certificado (estructura inicial).
- `/como-vamos`: mes en curso (estructura inicial).

## Desarrollo y despliegue

- Node.js 20 o superior.
- `npm install`
- `npm run dev` para desarrollo local.
- `npm run build` para compilar.
- En Vercel: importar repositorio, Framework Preset **Next.js**, Root Directory **./**. Build Command `npm run build`; output automático de Next.js.

## Reglas de producto

- SALES y VIN certificados como eje central; RVM, CRM, FORUM y financiamiento como dimensiones explicativas.
- YoY, trayectoria de cuatro meses y acumulado YTD. RVM incluye share mensual, YTD y doce meses móviles.
- Dimensiones: compañía, canal, tienda, vendedor, marca, línea, modelo, versión.
- FOTON: Pickups y Comerciales; DONGFENG: Aeolus, Forthing y categorías adicionales según maestro validado.
- Financiamiento de ventas por entidad separado de UFIs Forum por fecha Curse.
- Cierre mensual inmutable una vez certificado; mes abierto con corte explícito.
- No inventar cifras ni cruzar universos sin contrato certificado.

## Estado

Este primer commit configura una aplicación **desplegable**, sin conexión a datos aún. El contenido visible indica explícitamente qué indicadores faltan por integrar. Para integrar los análisis existentes, el repositorio de origen es `rodrigoibanezm-cmd/Cidef_bonos_dealers`, con documentación en `docs/ESTADO-CIERRE-MENSUAL.md`; motor compartido en `rodrigoibanezm-cmd/cidef-data-loader`.
