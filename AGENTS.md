# Instrucciones para Codex

## Principios prioritarios
1. La mejor solución es la más simple.
2. No complejizar problemas simples.
3. Reutilizar primero lo existente; no reinventar la rueda.
4. Antes de modificar código o arquitectura, comprobar necesidad y alternativa más simple.

## Cómo vamos
- Leer `cidef-azure-platform/AGENTS.md` y `docs/COMO-VAMOS-SNAPSHOTS.md` de esa repo antes de trabajar en `/como-vamos`.
- Solo SALES, FORUM, RVM. Una tabla de snapshot por dominio en Azure backend; rankings pertenecen a SALES.
- Front consume snapshots certificados P1/P2/P3 vía API servidor; sin cálculos comerciales ni consultas libres a RAW en el front.
- Firmas por dominio/versión, actualización selectiva, histórico diario bajo demanda. Mes abierto sin recalcular al navegar si no cambia firma.
- **Staging/producción Cómo vamos:** comparten las MISMAS tres tablas de snapshots en PostgreSQL Azure, los mismos motores P1/P2/P3, firmas y mecanismo de regeneración. Solo se separa el código/despliegue del frontend; NO duplicar tablas, DB, esquemas, motores, API, servicios ni crear una arquitectura staging paralela.
- No crear ni montar ahora un staging nuevo para esta vista; esperar versión avanzada y autorización explícita. Si corresponde, reutilizar el staging existente del frontend. No iniciar regeneraciones de prueba que afecten datos comunes.
- `/cierre-mensual` se conserva inmutable. Diseño del front se decide en este chat; no rediseñar sin instrucción.

- Todo desarrollo nuevo de este repositorio se realiza sobre la rama `staging`.
- No modificar ni desplegar `main` sin aprobación explícita.
- Conservar el diseño y la funcionalidad existente; no introducir indicadores nuevos ni cambios no solicitados.
- Reutilizar datos, consultas, contratos y motores ya disponibles. No duplicar cálculos ni fuentes.
- Implementar cambios mínimos, uno a la vez, y verificar solo lo necesario.
- No modificar infraestructura, workflows de producción, bases de datos, tablas ni usuarios sin autorización explícita.
- Staging comparte el PostgreSQL productivo. Evitar escrituras de prueba: los ingresos, ediciones y eliminaciones desde staging pueden afectar datos productivos.
- Antes de proponer o ejecutar cambios en proyecciones, leer `docs/PROYECCIONES-STATE.md` y verificar las rutas y workflows actuales.
