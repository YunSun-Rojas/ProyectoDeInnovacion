# SQL de Supabase

Los archivos `sql/tablas.sql`, `sql/funciones.sql` y `sql/politicas.sql`
reservan las ubicaciones de tablas, funciones y políticas.
Solo contienen comentarios: no son migraciones ni permiten recrear la base.
El repositorio no incluía las definiciones SQL del proyecto existente.
Incorporar las definiciones exportadas y revisadas antes de utilizarlos para un despliegue.
La reorganización no ejecuta SQL ni modifica Supabase.

## Activar el registro de ventas

`sql/ventas.sql` es una ampliación del inventario existente. Requiere las tablas
`products`, `categories`, `inventory_members` y las funciones
`inventory_write_enabled` e `inventory_mutate` utilizadas por la API actual.
No recrea ni sustituye esas estructuras.

1. Revisar el archivo contra las definiciones del proyecto real: el repositorio
   no incluye el SQL original de `inventory_mutate`. La ampliación usa su contrato
   de edición y exige que devuelva el producto actualizado y su movimiento.
2. Ejecutar el archivo completo una sola vez en el SQL Editor del mismo proyecto
   Supabase, con una cuenta propietaria. La transacción revierte si falla un paso.
3. Reiniciar el backend actualizado, iniciar sesión y recargar el inventario.
   En Productos estará disponible **Registrar venta** para usuarios con escritura.

Mientras no se instale, el dashboard muestra ventas pendientes de habilitación;
no interpreta la ausencia de esta función como ventas de importe cero.

Cada venta guarda cantidad, precio aplicado, total, fecha, producto y responsable.
Descuenta stock y registra el movimiento en una sola transacción. Editar después
el precio o eliminar el producto no modifica las ventas ya registradas. Un
reintento con el mismo identificador devuelve la misma venta sin duplicarla.
Las salidas antiguas y los ajustes no se convierten en ventas porque no contienen
un precio de venta histórico confirmado.

Los indicadores y gráficos usan Hoy, Últimos 7 días, Este mes y Trimestre actual
según `America/Lima`. El valor del inventario sigue representando el stock actual.

La prueba `backend/tests/salesSql.test.js` ejecuta esta ampliación en PostgreSQL
local en memoria (PGlite) con una implementación de referencia del contrato
existente. Comprueba atomicidad, permisos, precios históricos y reintentos;
no valida ni modifica el esquema del proyecto Supabase real.
