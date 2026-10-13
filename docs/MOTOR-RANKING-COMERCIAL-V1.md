# Motor de ranking comercial · v1.1.0

**Propietario:** repositorio `cidef-inteligencia-comercial`. No vive en `cidef-data-loader` ni modifica sus motores P1.

## Objetivo y alcance

Producir de forma **determinista y auditable** los rankings de mejor trayectoria y alertas del cierre mensual. No pedir a un LLM que calcule, ordene o rellene valores. Los gráficos y tarjetas consumen exclusivamente la salida del motor `lib/motors/ranking-performance-v1.js`.

**Período de la versión inicial:** septiembre 2026. Foto: VIN de septiembre. Película: junio, julio y agosto de 2026.

## Contrato de entrada

`data/monthly-close/2026-09/performance-ranking.json` mantiene el snapshot versionado de observaciones de ventas por entidad. El motor lee de `categories.stores`, `categories.dealers` y `categories.models` únicamente `id`, `name`, `months` (y metadatos descriptivos), **ignora los antiguos campos de ranking ya calculados** (`prior_avg`, `quarter_change`, `q2`, `q3`, etc.) y recalcula las métricas desde VIN mensuales. Fechas permitidas en v1: `2026-06`, `2026-07`, `2026-08`, `2026-09`. Un mes omitido o VIN no entero/no positivo o cero invalida la entrada (el cero sí es válido). El sistema falla si hay IDs duplicados.

**Reconstrucción de fuente (fuera del motor):** SALES `ventas_raw`, última `fecha_factura` por VIN anterior o igual a 2026-09-30, clasificación de canal por `categoria_cliente`: `Cliente General` propia, `Concesionaria` dealer. Para dealer: grupo comercial vía RUT normalizado en `dealers_master` y respaldo `vehiculo_canonico.dealer_group_id`. Esta atribución histórica usa el maestro actual y permanece **provisional** hasta homologar vigencias. Modelos usan agrupación provisional por alias, no una dimensión producto completamente certificada. Vendedores solo tenían cobertura parcial (274 VIN) y **no se ranquean**.

## Fórmulas y elegibilidad

```text
promedio_3_meses = (VIN_junio + VIN_julio + VIN_agosto) / 3
delta_vin = VIN_septiembre - promedio_3_meses
variacion_pct = 100 * delta_vin / promedio_3_meses
```

Una entidad entra en evaluación si registra **ventas positivas en cada uno** de junio, julio y agosto y su promedio histórico es **al menos 10 VIN/mes**. Las entidades con historial incompleto o bajo volumen quedan en estado **UNCLASSIFIED**, no se etiquetan erróneamente como estables.

### Clasificación determinista v1.1

Dos umbrales se cumplen **simultáneamente**: diferencia absoluta **≥5 VIN** y magnitud relativa **≥10%** del promedio histórico. Se aplican a todas las categorías elegibles, sin ajustes ocultos por tienda, dealer o modelo.

- **IMPROVING / Mejoran:** Δ VIN ≥5 **y** variación ≥+10%.
- **DECLINING / Retroceden:** Δ VIN ≤−5 **y** variación ≤−10%. Incluye venta de 0 en septiembre.
- **STABLE / Se mantienen:** elegible que no supera ambos umbrales en alguna dirección (puede crecer o caer levemente).
- **UNCLASSIFIED / Sin clasificación:** tres meses previos insuficientes o promedio anterior menor a 10 VIN.
- **UNAVAILABLE / Vendedores:** histórico incompleto; no hay listas publicables.

Para mejorar y retroceder, se ordena por **magnitud absoluta de Δ VIN**, no porcentaje; para estables se ordena por VIN vendidos en septiembre (con desempate por menor |Δ VIN|). Se muestran máximo cinco por columna, **pero los conteos del encabezado comprenden todas las entidades elegibles**. Desempate por volumen de septiembre y nombre en las variaciones.

**Ejemplo Alameda:** promedio 21 VIN, septiembre 24, diferencia +3 VIN (14,3%). Se mantiene porque **no cumple los 5 VIN absolutos**. Bellavista mejora materialmente.

**Ejemplo CURIFOR:** junio 5, julio 32, agosto 37, septiembre 8. Promedio previo = 74/3 = 24,67 VIN/mes. Delta = -16,67 VIN, variación = -67,57%. El anterior +305,3% comparaba Q3 con Q2 y no es un indicador de desempeño *mensual*.

## Contrato de salida

`calculateAllRankings(snapshot)` emite `{ schema_version, motor_version, period, months, policy, category_results }`. Cada categoría contiene `observations` con evidencia mensual, promedio, delta, porcentaje, elegibilidad, `performance_status` y causa de exclusión; los grupos `improving`, `stable`, `declining`, sus contadores `counts` y alias de compatibilidad `positive`/`negative`. Vendedores retorna estado `UNAVAILABLE` sin clasificación.

El frontend `components/PerformanceRanking.js` **no implementa fórmulas ni ordenamiento**; consume este contrato. La fuente versionada sigue siendo un snapshot; **no afirmar que un nuevo valor de Neon se sincroniza automáticamente** sin un proceso de extracción/publicación de observaciones.

## Invariantes y pruebas

- **Conciliación dealers:** junio 514, julio 491, agosto 646 y septiembre 666 VIN. Cualquier diferencia lanza `DEALER_VIN_RECONCILIATION_FAILED`.
- Los conteos mensuales son enteros >=0, explícitos por mes; un histórico incompleto no se rellena.
- La cobertura de vendedor es insuficiente y permanece oculta.
- Pruebas de regresión CURIFOR (8 VIN, retrocede), Bellavista mejora, Alameda estable, Rosselot destaca por impacto, umbrales simultáneos, caídas a cero, exclusión por historial y categorías exhaustivas.
- Ejecutar en esta repo: `npm run test:ranking`. En nuevas versiones actualizar snapshot, contrato, tests y control de cierre antes de publicar.

## Limitaciones y gobernanza

La reconstrucción histórica de dealers y la agrupación por modelos siguen provisionales. La fuente comercial histórica `performance-ranking.json` y otros snapshots del cierre son evidencia guardada, no autoridad P1 por sí solos. Cuando haya nueva certificación, primero reemplazar los conteos mensuales con fuente rastreable; el motor y sus fórmulas no deben cambiar por intervención del asistente.

**Versionado:** v1.1.0 incorpora tres estados y umbrales absolutos+relativos. Cambiar fórmulas, umbrales, universos o criterio requiere nueva versión y prueba de conciliación. La clasificación no significa causalidad o cumplimiento de metas comerciales.
