# Inventario en Supabase: creación e importación inicial

Los scripts preparan el mismo proyecto de Supabase que usa el login. La
aplicación ya consulta `products` y `categories` mediante la sesión del usuario.
`src/modules/inventario/data/inventarioReal.js` se conserva como referencia de
la importación, pero no se usa para cargar ni sustituir los datos del servidor.

## Orden de ejecución

Abre el proyecto del login en Supabase. En **SQL Editor**, crea una consulta,
pega el contenido completo de cada archivo y pulsa **Run**. Usa una consulta
separada por archivo y continúa solo si el anterior terminó sin errores.

1. `01_crear_tablas.sql`: crea `categories`, `products` e `inventory_members`.
   Al finalizar deben aparecer las tres tablas con `rowsecurity = true`.
2. `02_importar_productos.sql`: importa los datos actuales de la aplicación.
   Debe mostrar 20 categorías, 173 productos, 1.169 unidades y un valor de
   inventario de S/ 618.895,00 (suma de cantidad por precio mostrado).
3. `03_autorizar_cuenta.sql`: reemplaza `TU_CORREO_DEL_LOGIN` por tu correo real
   del login antes de ejecutarlo. El resultado debe incluir ese correo.

Los dos primeros archivos se ejecutan una sola vez. Si ya existen tablas o
datos, los scripts se detienen en lugar de borrarlos o sobrescribirlos. No
ejecutes fragmentos sueltos. Si aparece un error, conserva el mensaje para
revisarlo antes de continuar. El tercer archivo se puede repetir para la misma
cuenta sin duplicarla.

En **Table Editor** podrás revisar las filas importadas. El SQL Editor y el
Table Editor operan con permisos de administración: ver filas allí no prueba
por sí solo que una sesión de la aplicación tenga acceso.

## Qué se conserva

- Los 173 identificadores de producto, SKU, nombres, categorías, cantidades,
  precios y mínimos de stock que usa actualmente la aplicación.
- Marca, modelo, características y estado de revisión de la copia local.
- Los nombres repetidos se mantienen como registros separados por SKU.
- Los cinco precios cero de CPU-29, RAM-14, RAM-18, RAM-22 y RAM-25 se conservan
  por decisión de migrar la copia actual. No representan precios confirmados
  por la empresa y quedan pendientes de revisión.
- Los códigos de categoría `c1` a `c20` se representan en la base como números
  del 1 al 20. El identificador se adaptará al formato de React al conectar.

No se importan ventas ficticias ni se crean movimientos históricos a partir
del stock inicial. `source_status` conserva el estado de revisión de origen;
la disponibilidad se sigue calculando con `stock` y `min_stock`. `created_at`
indica cuándo se importó el registro, no cuándo se compró o vendió el producto.

## Acceso

Las tablas tienen seguridad por fila (RLS). Una sesión autenticada puede leer
el inventario solo si su usuario está en `inventory_members`. Una cuenta no
puede autorizarse a sí misma. La autorización se realiza desde SQL Editor.
No se cambian usuarios, contraseñas ni la configuración del login.

Los pasos 01 a 03 habilitan únicamente lectura. El paso 04 permite guardar
desde la aplicación mediante funciones que validan cada cambio y su historial.

## Fase 4: guardado e historial

Después de completar 01, 02 y 03, ejecutar **una vez** el contenido completo de
`04_habilitar_escritura.sql` en una consulta nueva del SQL Editor. No repetir
los scripts de creación o importación. El resultado esperado es
`Fase 4 preparada`, 173 productos y 0 movimientos si no hubo cambios previos.

Este script agrega la versión de cada producto, la tabla `inventory_movements`
y dos funciones. Conserva los productos, cantidades y precios existentes.
Recargar la aplicación después de ejecutarlo. Antes de instalar este script,
la aplicación conserva el acceso de solo lectura. Después, habilita agregar,
editar, eliminar y ajustar existencias para las cuentas autorizadas.

Cada escritura usa `inventory_mutate`: verifica al usuario de la sesión y
registra el producto y su movimiento en una única transacción. La aplicación
no tiene permisos de escritura directa sobre las tablas ni sobre el historial.
El autor y la fecha se obtienen en el servidor. La eliminación conserva los
datos anteriores en el historial. Las ediciones guardan una foto antes y otra
después, incluso si no cambió la cantidad.

Los ajustes de stock bloquean la fila y aplican el incremento a la cantidad
actual del servidor. Editar o eliminar exige la versión que se abrió en la
pantalla: si otra persona ya la cambió, se pide recargar. No se permite stock
negativo, fraccionario, SKU duplicado, categoría inexistente ni precio negativo.

Durante el guardado se bloquean nuevas acciones y el formulario solo se cierra
cuando se confirma el éxito. Si se pierde la respuesta, usar **Reintentar
guardado** sin recargar ni cerrar sesión. Se reutiliza el identificador del
intento y el servidor devuelve el resultado anterior sin repetir el movimiento.
Si se cerró la página antes de confirmar, revisar el historial y los productos
antes de volver a enviar el cambio: el intento pendiente se conserva en memoria.

Ante fallos se muestra un mensaje con Reintentar; una consulta fallida no se
sustituye por la copia local. Una cuenta que no está en `inventory_members`
recibe un mensaje de acceso no autorizado. Configuración y Cerrar sesión
siguen accesibles. Las lecturas se cancelan al desmontar la pantalla y al
cambiar de cuenta se descartan los datos de la sesión anterior.

Para verificar en el proyecto real: crear un producto de prueba con un SKU
nuevo, editarlo, usar + y -, y revisar Historial. Recargar debe conservar cada
cambio. Eliminar el producto de prueba y confirmar que su historial permanece.
No modificar productos reales para hacer estas pruebas. También comprobar con
una cuenta no autorizada que no puede consultar ni modificar el inventario.

Las métricas de ventas aún no están conectadas a ventas reales; esta fase no
cambia sus cálculos existentes ni inventa movimientos históricos. Los cambios
de otras sesiones se consultan al recargar; no se habilitó Realtime.

## Verificación local

- `node --test src/modules/inventario/services/inventory.test.js`: lectura,
  paginación, adaptación del historial, validación y respuestas de escritura.
- `node supabase/phase4.test.mjs`: ejecuta 01, 02 y 04 en PostgreSQL temporal
  (PGlite) y comprueba permisos, altas, cambios, eliminación, historial,
  conflictos de versión y reintentos. No utiliza credenciales de Supabase.
  Requiere el paquete `@electric-sql/pglite` instalado en
  `%TEMP%/codex-inventory-sql-test/node_modules`, o `PGLITE_MODULE` apuntando a
  su archivo `dist/index.js`. No es una dependencia de la aplicación.

Referencias oficiales:
- https://supabase.com/docs/guides/database/tables
- https://supabase.com/docs/guides/database/postgres/row-level-security
