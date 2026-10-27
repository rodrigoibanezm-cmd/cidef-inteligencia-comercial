# Motor de ranking comercial · v1.2.0

> Estado desde la conciliación Azure del 26/10/2026: el motor local permanece sin cambios y sus pruebas usan `test/fixtures/legacy-performance-ranking.json`. La página no publica sus clasificaciones anteriores como certificadas. Las observaciones actuales y las brechas de certificación están en `data/monthly-close/2026-09/facts.json` y `docs/CIERRE-2026-09-CONCILIACION.md`; el detalle histórico de este documento no sustituye esa fuente.

**Propietario:** repositorio `cidef-inteligencia-comercial`. No vive en `cidef-data-loader` ni modifica sus motores P1.

## Objetivo y alcance

Producir de forma **determinista y auditable** los rankings de mejor trayectoria y alertas del cierre mensual. No pedir a un LLM que calcule, ordene o rellene valores. Los gráficos y tarjetas consumen exclusivamente la salida del motor `lib/motors/ranking-performance-v1.js`.

**Período de la versión inicial:** septiembre 2026. Foto: VIN de septiembre. Película: junio, julio y agosto de 2026.

## Contrato de entrada

`data/monthly-close/2026-09/performance-ranking.json` mantiene el snapshot versionado de observaciones de ventas por entidad. El motor lee de `categories.stores`, `categories.dealers`, `categories.models` y `categories.sellers` únicamente `id`, `name`, `months` (y metadatos descriptivos), **ignora los antiguos campos de ranking ya calculados** (`prior_avg`, `quarter_change`, `q2`, `q3`, etc.) y recalcula las métricas desde VIN mensuales. Fechas permitidas en v1: `2026-06`, `2026-07`, `2026-08`, `2026-09`. Un mes omitido o VIN no entero/no positivo o cero invalida la entrada (el cero sí es válido). El sistema falla si hay IDs duplicados.

**Reconstrucción de fuente (fuera del motor):** SALES `ventas_raw`, última `fecha_factura` por VIN anterior o igual a 2026-09-30, clasificación de canal por `categoria_cliente`: `Cliente General` propia, `Concesionaria` dealer. Para dealer: grupo comercial vía RUT normalizado en `dealers_master` y respaldo `vehiculo_canonico.dealer_group_id`. Esta atribución histórica usa el maestro actual y permanece **provisional** hasta homologar vigencias. Modelos usan agrupación provisional por alias, no una dimensión producto completamente certificada. Vendedores: exclusivamente los activos y habilitados en `weekly_projection_sellers` con `persona_id` identificada; las series mensuales se vinculan por login canónico, `ombu_id` o alias login validado y no ambiguo. Se publica únicamente historia comparable.

## Fórmulas y elegibilidad

```text
promedio_3_meses = (VIN_junio + VIN_julio + VIN_agosto) / 3
delta_vin = VIN_septiembre - promedio_3_meses
variacion_pct = 100 * delta_vin / promedio_3_meses
```

Una entidad entra en evaluación si registra **ventas positivas en cada uno** de junio, julio y agosto y su promedio histórico es **al menos 10 VIN/mes** para tiendas, dealers y modelos, o **5 VIN/mes** para vendedores activos. En vendedores, además, `primera_venta_observada` debe ser anterior al primer mes histórico utilizado (junio 2026 en este corte). Las entidades con historial incompleto o bajo volumen quedan en estado **UNCLASSIFIED**, no se etiquetan erróneamente como estables.

### Clasificación determinista v1.1

Dos umbrales se cumplen **simultáneamente**: diferencia absoluta **≥5 VIN** y magnitud relativa **≥10%** del promedio histórico. Se aplican a todas las categorías elegibles, sin ajustes ocultos por tienda, dealer o modelo.

- **IMPROVING / Mejoran:** Δ VIN ≥5 **y** variación ≥+10%.
- **DECLINING / Retroceden:** Δ VIN ≤−5 **y** variación ≤−10%. Incluye venta de 0 en septiembre.
- **STABLE / Se mantienen:** elegible que no supera ambos umbrales en alguna dirección (puede crecer o caer levemente).
- **UNCLASSIFIED / Sin clasificación:** tres meses previos insuficientes, volumen histórico inferior al mínimo por categoría o vendedor cuya primera venta observada no es anterior a junio.

Para mejorar y retroceder, se ordena por **magnitud absoluta de Δ VIN**, no porcentaje; para estables se ordena por VIN vendidos en septiembre (con desempate por menor |Δ VIN|). Se muestran máximo cinco por columna, **pero los conteos del encabezado comprenden todas las entidades elegibles**. Desempate por volumen de septiembre y nombre en las variaciones.

**Ejemplo Alameda:** promedio 21 VIN, septiembre 24, diferencia +3 VIN (14,3%). Se mantiene porque **no cumple los 5 VIN absolutos**. Bellavista mejora materialmente.

**Ejemplo CURIFOR:** junio 5, julio 32, agosto 37, septiembre 8. Promedio previo = 74/3 = 24,67 VIN/mes. Delta = -16,67 VIN, variación = -67,57%. El anterior +305,3% comparaba Q3 con Q2 y no es un indicador de desempeño *mensual*.

## Contrato de salida

`calculateAllRankings(snapshot)` emite `{ schema_version, motor_version, period, months, policy, category_results }`. Cada categoría contiene `observations` con evidencia mensual, promedio, delta, porcentaje, elegibilidad, `performance_status` y causa de exclusión; los grupos `improving`, `stable`, `declining`, sus contadores `counts` y alias de compatibilidad `positive`/`negative`. Vendedores tiene las mismas listas y contadores que las otras categorías; su elegibilidad requiere `first_sale_observed` previo al inicio del histórico y el mínimo de 5 VIN.

El frontend `components/PerformanceRanking.js` **no implementa fórmulas ni ordenamiento**; consume este contrato. La fuente versionada sigue siendo un snapshot; **no afirmar que un nuevo valor de Neon se sincroniza automáticamente** sin un proceso de extracción/publicación de observaciones.

## Invariantes y pruebas

- **Conciliación dealers:** junio 514, julio 491, agosto 646 y septiembre 666 VIN. Cualquier diferencia lanza `RANKING_VIN_RECONCILIATION_FAILED`.
- Los conteos mensuales son enteros >=0, explícitos por mes; un histórico incompleto no se rellena.
- **Conciliación vendedores activos:** junio 322, julio 373, agosto 494 y septiembre 364 VIN, distribuidos entre 73 `persona_id` únicos. Todos los cuatro totales y tamaño del padrón se validan contra metadatos del snapshot, no contra constantes codificadas en el motor.
- Pruebas de regresión CURIFOR (8 VIN, retrocede), Bellavista mejora, Alameda estable, Rosselot destaca por impacto, umbrales simultáneos, caídas a cero, exclusión por historial y categorías exhaustivas.
- Ejecutar en esta repo: `npm run test:ranking`. En nuevas versiones actualizar snapshot, contrato, tests y control de cierre antes de publicar.

## Limitaciones y gobernanza

La reconstrucción histórica de dealers y la agrupación por modelos siguen provisionales. La fuente comercial histórica `performance-ranking.json` y otros snapshots del cierre son evidencia guardada, no autoridad P1 por sí solos. Cuando haya nueva certificación, primero reemplazar los conteos mensuales con fuente rastreable; el motor y sus fórmulas no deben cambiar por intervención del asistente.

**Versionado:** v1.2.0 incluye vendedores activos y elegibilidad por primera venta observada y volumen histórico; v1.1.0 incorporó tres estados y umbrales absolutos+relativos. Cambiar fórmulas, umbrales, universos o criterio requiere nueva versión y prueba de conciliación. La clasificación no significa causalidad o cumplimiento de metas comerciales.

## Vendedores activos · registro de primera venta observada

**Snapshot de evidencia:** `data/monthly-close/2026-09/active-sellers-first-sale.json` (corte de observación 2026-10-13). Registra 73 personas con estado `ACTIVO`, `habilitado=true` y `persona_id` presente en `weekly_projection_sellers`. De ellas, 66 tienen una venta histórica identificada y 7 quedan explícitamente como `NO_HISTORICAL_SALE`.

**Fuente:** `ventas_raw` filtrada a `categoria_cliente='Cliente General'`, VIN no nulo, última factura válida por VIN con corte `2026-10-13`. Vinculación por `persona_id` mediante `personas_master.usuario_canonico`, `weekly_projection_sellers.ombu_id` y `persona_aliases` validados de tipo login, solo si cada token resuelve inequívocamente a una persona. La primera fecha observada es el mínimo `fecha_factura` por vendedor en el histórico disponible; en empates se guarda el VIN lexicográficamente menor para evidencia.

**Interpretación:** `primera_venta_observada` **no es fecha de contratación ni fecha de inicio de vigencia laboral**. Puede variar si se incorpora historia anterior, se corrigen facturas o se modifica la resolución de identidades. Un vendedor sin ventas históricas puede estar recién incorporado o carecer de cobertura. Nunca convertir una fecha nula en cero o antigüedad inventada. La vigencia comercial seguirá gobernada por la fuente de activos. El registro de primeras ventas, junto con `categories.sellers` (series de junio a septiembre por persona_id) y las conciliaciones que ejecuta el motor, permite clasificar únicamente vendedores activos elegibles. Se excluyen los nuevos y los que no tengan historia o volumen mínimos, sin inferir fecha de contratación. Estas observaciones son un snapshot: no se actualizan automáticamente al cambiar Neon o la nómina.

