# Conciliación de septiembre 2026 — Azure

## Implementación de Compañía — diseño aprobado

La vista `/cierre-mensual` implementa las nueve cards aprobadas: ventas compañía/propias/dealers; inscripciones CIDEF/share mensual/share YTD; cotizaciones/UFIs/penetración FORUM. Penetración se mantiene **Pendiente**, sin fórmula provisional. Las series certificadas disponibles se muestran aunque falte otra apertura.

Los cuatro paneles están implementados: variaciones agosto–septiembre por canal, marca y modelo; metas oficiales por sucursal; RVM por marca y segmento; entidades SALES, actividad FORUM por canal y conversión de cohortes. Las conclusiones quedan al final como placeholder, sin desarrollar.

La implementación se apoya en `facts.json#company`. Las nuevas observaciones y ejecuciones se conservan bajo el prefijo `company_` de `certification-evidence.json`, con run `implement-company-sep2026-20261026`, entrada, período, corte, fecha de observación y ruta exacta del valor. Las celdas se materializan desde esos resultados; no se añaden fórmulas comerciales en el navegador, rutas ni motores.

**Corrección de origen posterior al corte descrito debajo:** agosto ahora devuelve **1.199** ventas P1 (554 propias + 645 dealers; Foton 858 + Dongfeng 341). Septiembre conserva 1.034. La comparación P2 resulta **−165 VIN**: propias −181 y dealers +16. AEOLUS Y3 de agosto pasa de 58 a 57 en la fuente. Las cards, trayectorias y paneles usan estas nuevas observaciones, sin ajustes manuales para cuadrar. Las tablas posteriores de este documento describen la conciliación inicial y no sustituyen `facts.json` vigente.

Metas: 13 referencias oficiales y 14 sucursales con ventas; Amunátegui conserva su venta y muestra meta/cumplimiento/brecha **Pendiente**. Cumplimiento muestra el estado P2 respecto de la meta; la desviación porcentual es la devuelta por P2, sin fabricar un porcentaje de cumplimiento. No se suman metas para inventar una referencia de compañía, dealers o marcas.

La posición competitiva incluye las dos marcas y cinco aperturas marca/segmento, con cantidades y shares mensuales/YTD certificados. Cada share de segmento utiliza su mercado contenedor correspondiente. Las variaciones de share en puntos porcentuales siguen **Pendiente**: las unidades disponibles no devuelven ese resultado entre proporciones P2. No se calcula su resta localmente.

Conversión FORUM: 351 operaciones convertidas de 4.090 casos evaluables; 8,581907090464547% de P2. Se indica la cohorte 01–30/09 y la fecha de observación por separado. Quedan fuera del denominador los otros estados. Esto no equivale a UFIs mensuales ni a conversión histórica al 30/09.

Pendientes visibles: penetración FORUM; variaciones RVM en pp; referencias/comparaciones 2025; trayectoria de cuatro cierres acumulados del share YTD; estados/PRECURSE históricos. Los faltantes no se convierten en cero. Una variación porcentual indefinida por base cero se muestra como «No aplica (base 0)».

Alcance limitado a Compañía. Sin cambios en otras vistas, estilos globales, motores, tablas ni infraestructura. Sin automatizaciones ni nuevas consultas al navegar. El commit debe llevar `[skip ci]` para impedir el despliegue automático de staging; publicación pendiente de autorización.

Validación: `node --test test/company-close-view.test.js test/monthly-close-certification.test.js test/ranking-performance.test.js test/forum-close.test.js`; `npm run build`; inspección del HTML generado para las nueve cards, los cuatro paneles, denominadores, fuentes y placeholder final. La instalación del navegador de pruebas falló por una descarga inválida; no se declara una revisión visual de navegador.

## Conciliación inicial — antecedente de la base 75860ee

Estado: **parcialmente certificado**, reconstruido con fuentes consultadas el 26/10/2026. No representa una foto publicada originalmente el 30/09. Solo SALES, FORUM y RVM. Sin despliegue ni cambios de motores, tablas, infraestructura u otras páginas.

## Fuente y trazabilidad

- Fuente única de cifras publicables: `data/monthly-close/2026-09/facts.json`.
- `certification-evidence.json` conserva los resultados P1/P2, identificadores y errores recibidos. Se omiten las 5.675 operaciones individuales del snapshot FORUM; se conserva su cobertura y el identificador de la evidencia original.
- Cada indicador certificado conserva `evidence_ref`, `value_path`, contrato, versión, período, corte y fecha de observación. Los resultados P2 conservan su `execution_id` y las evidencias P1 de entrada.
- Run: `reconcile-cierre-202609-20261026`. La consulta posterior `run_trace` agotó el tiempo de conexión; no se declara una validación independiente de la lectura P3.
- Tendencias, marcas, executive-close, forum-close-source y performance-ranking son referencias a `facts.json`, sin copias numéricas activas. La lectura ejecutiva usa plantillas que se resuelven contra sus indicadores.

## Conciliación

| Indicador | Anterior | Verificado Azure |
|---|---:|---:|
| SALES compañía | 1.041 / 1.044 / 1.045 | 1.034 |
| SALES propias | 375 / 377 | 373 |
| SALES dealers | 666 / 667 | 661 |
| SALES Foton | 837 / 840 | 831 |
| SALES Dongfeng | 204 / 205 | 203 |
| Suma de sucursales en ranking | 374 | 373, 14 sucursales P1 |
| Ventas con entidad financiera identificada | 198, captura no certificada | 196 |
| Sin entidad resuelta | 177, rotuladas sin financiamiento | 177; no se infiere contado |
| FORUM cotizaciones septiembre, consolidado consultado | 5.675 en portada / 5.890 consolidado | 5.890 |
| FORUM solicitudes de cohorte septiembre, consolidado consultado | 4.674 foto / 4.846 consolidado | 4.847 |
| FORUM cursados, fecha de curse septiembre | 381 | 381 |
| FORUM UFIs, fecha de curse septiembre | 383 | 383 |
| FORUM operaciones en snapshot exacto 30/09 | 5.675 | 5.675 |
| RVM mercado septiembre | 30.989 | 30.989 |
| RVM CIDEF septiembre | 1.037 | 1.037 = Foton 787 + DFM 250 |
| Share RVM mensual | 3,3463% | 3,346348704378973%, P2 |
| RVM YTD CIDEF / mercado | 7.271 / 237.181 | 7.271 / 237.181 |
| Share RVM YTD | 3,0656% | 3,0655912573098183%, P2 |

Los anteriores 5.675 y 5.890 no son dos conteos intercambiables: el primero es la foto exacta al 30/09 y el segundo es la cohorte mensual consolidada observada posteriormente. Lo mismo aplica a solicitudes y estados. CURSES son operaciones; UFIS son vehículos financiados. RVM conserva DFM como identidad de la marca CIDEF y suma cantidades, no filas ni VIN distintos.

## Series SALES recertificadas

| Serie | Junio | Julio | Agosto | Septiembre |
|---|---:|---:|---:|---:|
| Compañía | 878 | 899 | 1.200 | 1.034 |
| Propias | 364 | 409 | 555 | 373 |
| Dealers | 514 | 490 | 645 | 661 |
| Foton | 703 | 720 | 858 | 831 |
| Dongfeng | 175 | 179 | 342 | 203 |

Se conserva la geometría y el estilo de los gráficos, representando valores certificados en su unidad original. No se fabrica un índice base 100 en el navegador. Los gráficos cuya apertura falta permanecen pendientes.

## Pendientes reales

1. **Rankings:** existen observaciones P1 de septiembre por sucursal, vendedor y modelo. No se recertificó la clasificación histórica junio–agosto, el padrón activo histórico, primeras ventas ni vigencias de grupos dealer. El ranking antiguo y su agrupación heurística por modelo salen de producción y se conservan únicamente como fixtures de regresión.
2. **PRECURSE al 30/09:** el contrato solo permite el último snapshot. Respondió 118 al 21/10; no se usa ese valor como septiembre.
3. **Estados y solicitudes de la foto del 30/09:** la foto completa está recuperada. La consulta P1 filtrada por `status=PRE CURSADA` falla con `column "estado_actual" does not exist`. Los agregados anteriores de estado se preservan como antecedentes, sin publicarlos como recertificados. No se modifica P1 para resolverlo en este trabajo.
4. **DFM histórico:** la serie junio–septiembre agotó el tiempo de consulta. Septiembre y su share sí están certificados. No se completan meses mediante restas de otras series.
5. **RVM YTD por marca:** Foton agotó el tiempo de conexión; DFM devolvió error interno. El YTD conjunto y su share están certificados; las aperturas quedan vacías.
6. **Comparaciones y derivados:** YoY sin evidencia 2025 nueva; aperturas de trayectorias por canal/marca y financiamiento sin recertificar; penetración UFIs/SALES sin resultado P2 compatible. No se utilizan los valores previos ni el divisor fijo 924.
7. **P3:** pendiente recuperar la traza completa, conservando mientras tanto las evidencias e identificadores devueltos por las ejecuciones.

Los intentos de `sales_observe_many` agotaron el tiempo de respuesta. Las consultas unitarias más acotadas sí devolvieron las evidencias certificadas conservadas. No se interpretan los timeouts como cero ni se sustituyen por estimaciones.

## Validación y publicación

`node --test test/monthly-close-certification.test.js test/ranking-performance.test.js test/forum-close.test.js` valida conciliaciones, evidencia por indicador, períodos, P2, referencias únicas, ausencia de CRM y tratamiento de faltantes. Los tests de motores antiguos son regresiones con fixtures históricos, no una certificación de los datos actuales.

El workflow de staging despliega en cada push. El commit lleva `[skip ci]` para evitar ese despliegue. No ejecutar Actions ni desplegar como parte de esta entrega. Las otras cuatro vistas continúan sin implementar.
