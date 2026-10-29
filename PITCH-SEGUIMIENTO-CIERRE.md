# CIDEF | Seguimiento de Cierre Comercial

**Pitch de proyecto · Octubre 2026**

## 1. El problema

Durante los últimos días del mes se concentra una parte importante de las ventas. Sin embargo, falta una herramienta que permita visualizar diariamente cuánto llevamos vendido, cuánto falta para cumplir las metas y qué unidades comerciales requieren atención.

Hoy tenemos los datos, pero no una vista específica para gestionar el cierre.

## 2. ¿Qué vamos a construir?

Un **Tablero de Seguimiento de Cierre Comercial**, con tres niveles:

- **Compañía:** visión consolidada del negocio.
- **Dealers:** seguimiento de ventas sell-in.
- **Sucursales:** desempeño individual y alertas.

El tablero mostrará ventas acumuladas, metas, cumplimiento, variación YoY y evolución diaria desde el cierre del lunes hasta el sábado.

Incorporaremos un **Indicador de Ritmo de Cierre** que compare el cumplimiento actual con el alcanzado al mismo punto de los últimos cuatro meses y del año anterior.

## 3. ¿Para qué?

Pasar de **observar resultados a gestionar el cumplimiento**.

- Detectar anticipadamente brechas comerciales.
- Identificar sucursales que requieren apoyo.
- Priorizar acciones durante los últimos días.
- Evaluar el ritmo actual contra el comportamiento histórico.
- Dar seguimiento objetivo a las metas.

## 4. Impacto esperado

| Dimensión | Impacto |
|---|---|
| Gerencia Comercial | Visibilidad consolidada y oportuna |
| Supervisores | Priorización de sucursales |
| Sucursales | Claridad sobre metas y brechas |
| Gestión | Decisiones basadas en datos diarios |
| Tecnología | Reutilización de infraestructura existente |

## 5. ¿Cómo lo construiremos?

**Metodología ágil, incremental y de bajo riesgo.**

1. **Base:** clonar la arquitectura de Proyecciones Admin.
2. **Datos:** construir snapshots diarios utilizando SALES P1 y capacidades P2 existentes.
3. **Inteligencia:** desarrollar helpers específicos para cumplimiento, trayectoria y alertas.
4. **Visualización:** adaptar el tablero existente.
5. **Validación:** probar en Staging antes de habilitar Producción.

Cada etapa entregará una capacidad verificable.

## 6. ¿Qué no vamos a hacer?

**El proyecto tiene un alcance deliberadamente limitado.**

- **No reemplazaremos Proyecciones Admin.** Continuará funcionando de forma independiente.
- **No construiremos un nuevo motor comercial.** Reutilizaremos P1/P2 y desarrollaremos únicamente helpers específicos.
- **No modificaremos los motores centrales P1/P2.** Cualquier incorporación futura se evaluará por separado.
- **No desarrollaremos pronósticos de ventas ni nuevas proyecciones.** El foco estará en ventas reales, metas y comparación histórica.
- **No integraremos CRM ni gestionaremos oportunidades comerciales.**
- **No crearemos nueva infraestructura, servicios ni mecanismos de despliegue.**
- **No automatizaremos decisiones comerciales.** Las alertas serán señales de apoyo para supervisores y gerencia.

## 7. Principios del proyecto

- No duplicar fuentes ni motores certificados.
- Reutilizar la infraestructura y los componentes existentes.
- Conservar trazabilidad e historial de cada corte.
- No afectar el funcionamiento de Proyecciones Admin.
- Desplegar utilizando el mecanismo actual de Inteligencia Comercial Staging.
- Implementar cambios pequeños y controlados.

## 8. Resultado esperado

Una herramienta de seguimiento diario que responda tres preguntas:

**¿Cuánto llevamos vendido?**

**¿Qué tan lejos estamos de la meta?**

**¿Vamos mejor o peor que en cierres anteriores?**

## 9. Contrato funcional

- **Ámbitos:** COMPANY representa las ventas totales de la compañía; DEALERS, las ventas sell-in; STORE, las ventas de cada sucursal propia. Son vistas del negocio: no se suman COMPANY y sus desgloses. Cada venta se contabiliza una sola vez dentro de su ámbito, según la clasificación certificada de SALES P1.
- **Metas:** utilizar exclusivamente metas mensuales oficiales y certificadas para el período y ámbito consultados. Identificar las metas faltantes o no certificadas; no inventarlas ni distribuirlas artificialmente. En esos casos, el cumplimiento y las comparaciones dependientes de la meta quedan no disponibles. Una meta cero no permite calcular el porcentaje.
- **Ritmo de Cierre:** cumplimiento = ventas acumuladas / meta mensual, expresado como porcentaje. Comparar con el mismo día del mes comercial de cada uno de los cuatro meses anteriores y del año anterior (YoY), utilizando la meta oficial de cada período. Comparar únicamente períodos y universos equivalentes, con evidencia certificada; señalar las comparaciones no disponibles. No sustituir cumplimiento de meta por proporción del cierre vendido.
- **Corte temporal:** utilizar el calendario comercial certificado de SALES P1. La comparación horaria queda pendiente hasta disponer de evidencia histórica certificada; registrar una hora de publicación no acredita el estado histórico del negocio a esa hora.
- **Alertas:** identificar unidades comerciales cuyo cumplimiento esté por debajo de su trayectoria histórica comparable. Queda pendiente definir el criterio cuantitativo de alerta, incluida la referencia histórica y la regla de activación; no fijar umbrales arbitrarios ni activar alertas cuantitativas antes de acordarlo. No calcular pronósticos ni probabilidades nuevas.

---

**Visión:** convertir los últimos días del mes en un proceso comercial medible, comparable y gestionable, no solamente en una revisión de resultados.
