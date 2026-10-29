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

---

**Visión:** convertir los últimos días del mes en un proceso comercial medible, comparable y gestionable, no solamente en una revisión de resultados.
