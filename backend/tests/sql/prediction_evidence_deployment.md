# Evidencias predictivas: instalación, verificación y recuperación

## Estado y alcance

Según la confirmación del usuario, la migración ya está instalada en Supabase y
GET /api/inventory/prediction-evidence devuelve state: available. No se volvió
a consultar producción durante esta limpieza. La instalación no clasifica ventas,
asigna revisores ni garantiza que exista historial suficiente para predecir.
Las cuatro ventas de desarrollo siguen siendo pruebas.

La instalación conserva tres tablas de evidencia con RLS, dos secuencias identity,
dos índices explícitos, once restricciones PK/FK/CHECK y cuatro funciones.
Tres funciones son SECURITY DEFINER con search_path vacío; cuatro triggers impiden
UPDATE, DELETE y TRUNCATE del historial. Los índices de PK y las dependencias
internas de las FK se crean también. No se escriben filas en productos, ventas,
movimientos ni usuarios existentes; las FK sí añaden dependencias de integridad.
Una venta con evidencia no puede borrarse; eliminar una cuenta elimina su asignación
de revisor, conservando su autoría histórica. El inventario es compartido entre
miembros; esta migración no introduce multitenencia.

No hay respaldo recuperable verificado registrado en este procedimiento. El usuario
decidió evaluar la instalación directa conociendo esa ausencia. Este estado no
equivale a una prueba de recuperación ni certifica JWT/PostgREST o todos los roles
remotos. Los triggers no son protección criptográfica frente al propietario.

## Archivos que deben conservarse

Todos los siguientes archivos están en backend/tests/sql/. Sus nombres históricos
se mantienen aunque estén aplicados; ninguno se ejecuta al iniciar la aplicación.

| Archivo | Uso |
| --- | --- |
| ventas.sql | Contrato SQL de ventas utilizado por salesSql.test.js. |
| 20261013_catalog_products.proposed.sql | Migración de catálogo; pruebas de catálogo, stock y conteos. |
| 20261014_stock_movements.proposed.sql | Migración de stock; pruebas de stock e inventario físico. |
| 20261014_physical_inventory.proposed.sql | Migración de inventario físico y sus pruebas. |
| 20261027_prediction_evidence.proposed.sql | Copia histórica exacta de la migración de evidencias; reproducción y pruebas. |
| 20261027_prediction_evidence.inspect.sql | Inspector de esquema, propietarios, tipos, PK, RLS, políticas, ACL y funciones. |
| 20261027_prediction_evidence.rollback.proposed.sql | Reversión restringida a una instalación vacía. |
| 20261028_prediction_evidence.preinstall.readonly.sql | Ausencia de colisiones y captura de conteos/huellas previos. |
| 20261028_prediction_evidence.postinstall.readonly.sql | Objetos, ACL y comparación con los conteos/huellas previos. |
| prediction_evidence_postgres.mjs | Arnés explícito para un clúster PostgreSQL temporal, nunca para producción. |

backend/tests/fixtures/catalogDatabase.sql aporta contratos mínimos para pruebas
aisladas de catálogo/stock/conteos. Estos archivos no son un respaldo del esquema
remoto completo ni reemplazan la infraestructura auth y las extensiones de Supabase.

SHA-256 de las propuestas ensayadas; detenerse si difieren al preparar otra instalación:

- Migración: C79CAD8F28BE76A15DFFA11855D849FB3B0A0F058E8A2A7C16D046D89798E72C
- Rollback: DA0BA29B815B67D2EDCAD32F5DD937EC2431636B4E29C9397D307E4BB449F094

## Reproducción o instalación futura autorizada

No reinstalar sobre el proyecto actual: la propuesta NO es idempotente. La referencia
configurada durante la preparación fue xuagxobtxsvssifrdknk; comprobar organización,
referencia en la URL /project/<referencia>/ y configuración del entorno de destino.
El nombre del proyecto y current_database() no bastan para identificarlo.

1. Conservar S0–S6 y repetir solo los puntos con cambios de esquema/roles/políticas.
   El inspector no consulta filas comerciales; sus hashes no demuestran por sí solos
   que el predicado de una política sea correcto.
2. Obtener autorización expresa para el destino, SQL exacto, ventana sin escrituras,
   responsable y recuperación. Verificar un respaldo recuperable antes de otra
   instalación; cualquier excepción requiere una decisión explícita del propietario.
3. Ejecutar el preinstall completo como lectura separada: rol postgres, permisos
   true y once objetos ausentes. Guardar resultados privados. No ampliar permisos
   ni cambiar propietarios o defaults para superar un error.
4. Pegar la propuesta COMPLETA, de BEGIN a COMMIT, en una consulta nueva. No ejecutar
   fragmentos ni combinarla con el inspector o rollback. El lock_timeout local
   de cinco segundos evita esperas indefinidas por bloqueos.
5. Tras éxito sin errores, ejecutar el postinstall completo: siete objetos presentes,
   once PK/FK/CHECK (sin contar NOT NULL), cuatro triggers y cero políticas nuevas.
   Deben aparecer cuatro funciones con todos los campos *_ok=true y quince filas
   denied=true. Inmediatamente después de instalar, antes de asignar revisores,
   las tres tablas nuevas deben estar vacías. Los cuatro conteos/huellas originales
   y la huella de seguridad deben coincidir con el preinstall. auth.users se revisa
   por metadatos, sin exigir SELECT de sus filas.
6. Conservar las ACL y defaults ajenos: sin acceso directo de PUBLIC, anon,
   authenticated o service_role a tablas/columnas/secuencias nuevas. Solo authenticated
   ejecuta las tres RPC previstas; la función de inmutabilidad no es ejecutable
   por clientes. Revisar también permisos heredados.

Los conteos/huellas detectan cambios durante una ventana controlada, pero no permiten
restaurar datos. No ensayar ataques DML, TRUNCATE o asignaciones de prueba en producción.

## Lectura autenticada y diagnóstico

El GET usa la sesión HttpOnly de Eagle Gaming y el cliente Supabase de ese usuario.
Invoca inventory_prediction_evidence con p_as_of fijado por el backend y get: true.
No acepta identidad, corte o evidencia del navegador ni crea clientes administrativos.
shared/predictionEvidence.js valida tres listas y campos exactos, fechas cerradas
de Lima, UUID, IDs seguros, referencias, instantes con zona y verificaciones no
posteriores al corte. Filas inválidas, duplicados y conflictos se rechazan completos.

| Situación | Respuesta del backend |
| --- | --- |
| Disponible | 200: state: available, asOf y evidence con classifications, coverage y stockouts. |
| RPC ausente/no publicada en caché | 200: state: migration_missing, asOf: null, evidence: null. |
| Sesión inválida | 401; middleware habitual o PREDICTION_SESSION_REQUIRED desde la RPC. |
| Permisos denegados | 403: PREDICTION_ACCESS_DENIED. |
| Conexión o timeout | 503: PREDICTION_CONNECTION_ERROR. |
| Dependencia rota/fallo de lectura | 503: PREDICTION_READ_ERROR. |
| Evidencia inválida/incompleta | 502: PREDICTION_INVALID_RESPONSE. |

PGRST202 no demuestra que el DDL esté ausente: puede faltar su publicación en caché.
42883 solo se considera ausencia si identifica exactamente la RPC consultada.
Si los objetos existen, no reinstalar para resolver un error de caché o sesión.
auth.uid() puede ser NULL en SQL Editor; PREDICTION_FORBIDDEN ahí no prueba un fallo
de instalación. No simular JWT en producción. Un corte del backend adelantado al
reloj PostgreSQL puede rechazarse: corregir el desfase sin retirar controles SQL.

PrediccionConEvidencia obtiene una instantánea al abrir o refrescar/cambiar ventas,
no al editar stock/nombre o seleccionar horizonte. Cancela lecturas obsoletas y
descarta evidencia anterior ante errores. JSON HTTP ilegible es invalid_evidence.
Con RPC instalada y listas vacías sigue sin haber pronóstico: ventas sin clasificar
producen historial_no_verificado; productos sin historia, historial_insuficiente.
Los algoritmos de 7/30 días y el cálculo de agotamiento no se alteran por instalar.

## Revisores y evidencia real: autorización independiente

El propietario identifica privadamente una cuenta existente y miembro del inventario
y la asigna en inventory_prediction_reviewers. La revocación elimina su asignación,
no el historial. No hay endpoints de clasificación ni administración de revisores
en esta integración de lectura.

Un revisor autorizado usa inventory_prediction_classify_sale e
inventory_prediction_review_day con referencias comprobables. Clasificar ventas de
prueba como test requiere autorización; ninguna venta se vuelve comercial por defecto.
Las correcciones agregan eventos. No retrofechar verified_at: el servidor registra
cuándo se verificó. La cobertura exige registro completo Y disponibilidad comprobada
por día de Lima; no deducirla de la primera venta o del stock actual. Validar con
historial real suficiente antes de esperar pronósticos comerciales.

## Errores y recuperación

- Antes de COMMIT, un error aborta la transacción completa. Si esa misma sesión sigue
  abortada, ejecutar ROLLBACK; no intentar terminar con COMMIT. SQL Editor puede usar
  otra conexión para la siguiente consulta: comprobar el estado sin asumir continuidad.
- Si un timeout/desconexión deja incierto el COMMIT, usar los controles de lectura
  antes de cualquier reintento. Colisiones, PREDICTION_OWNER_REQUIRED, deriva de ACL
  o esquema exigen detenerse y revisar; no retirar DO/REVOKE ni conceder permisos globales.
- Después de COMMIT, ROLLBACK ya no deshace la instalación. El rollback propuesto es
  una operación distinta, con DROP, bloqueo exclusivo y autorización independiente.
  Solo funciona sin revisores ni revisiones y no usa CASCADE.
- Con evidencia presente, detener consumo/administración y preservar la auditoría.
  Cualquier restauración necesita un plan y autorización nuevos. No borrar productos,
  ventas o eventos para satisfacer las precondiciones del rollback.

Para acreditar un respaldo recuperable, registrar origen, fecha, alcance y custodia
restringida fuera de Git; restaurarlo en un destino aislado autorizado y comparar
esquema, funciones, roles/ACL, RLS, secuencias, datos y lectura funcional, con logs sin
errores. Verificar aparte los componentes externos a la base. Un archivo o SHA-256
no basta; no asumir disponibilidad de PITR.

## Pruebas y límites

Las verificaciones históricas fueron 13 grupos en PostgreSQL 17.11 nativo aislado,
30 pruebas PGlite de migración, 116 backend y 148 frontend. La revisión final usó
frontend/HTTP reales con identidad y RPC simuladas: ocho escenarios y horizontes
7/30, sin duplicar peticiones por StrictMode ni por cambios de horizonte.
Las pruebas y fixtures no se importan por la aplicación para sustituir datos reales.
Esto no valida por sí solo firmas/caducidad JWT, PostgREST ni toda la configuración
Supabase. Para esa validación, usar cuentas/datos sintéticos en un destino autorizado:
miembro/no miembro, sin cookie, JWT inválido/caducado, instalación vacía, denegación
y evidencia válida suficiente/insuficiente, sin exponer tokens al frontend.

Desde la raíz: npm run test:backend y npm run test:frontend. Si la compilación SSR
en paralelo falla por resolución de módulos, repetir la batería frontend con
node --test --test-concurrency=1 frontend/tests/*.test.mjs antes de atribuirlo al código.

Para repetir el ensayo nativo, crear un clúster NUEVO y descartable con initdb
(usuario postgres, UTF-8, locale C), directorio cuyo nombre empiece por
.eagle-phase6-pg- y puerto libre. Arrancar con pg_ctl -D <directorio>/data
-l <directorio>/server.log -o "-h 127.0.0.1 -p <puerto>" -w start.
Desde backend, ejecutar explícitamente:

    node tests/sql/prediction_evidence_postgres.mjs "C:\Program Files\PostgreSQL\17\bin" "<directorio>" <puerto>

El arnés verifica dirección/puerto/data_directory y crea una base sintética nueva;
no lee .env y filtra PG*. No reutilizar directorios o bases preexistentes ni
registrar un servicio. trust local es admisible solo durante ese ensayo sintético.
Al terminar, detener únicamente ese clúster con pg_ctl -D <directorio>/data
-m fast -w stop, confirmar su detención y desechar únicamente el directorio verificado.
