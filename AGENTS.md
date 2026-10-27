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
