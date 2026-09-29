# Backend de inventario

Esta API Node conecta la aplicación con las tablas y funciones existentes en
Supabase. Iniciarla no crea tablas, no importa productos y no ejecuta pruebas.

## Archivos del servidor

| Archivo o carpeta | Responsabilidad |
|---|---|
| `src/server.js` | Iniciar y detener el servidor HTTP |
| `src/app.js` | Recibir solicitudes, gestionar sesiones y comprobar el acceso |
| `src/config.js` | Leer la configuración del backend desde `.env` |
| `src/database/supabaseClient.js` | Crear la conexión de cada sesión con Supabase |
| `src/services/inventoryService.js` | Consultar datos, validar productos y ejecutar el guardado |
| `scripts/check-connection.js` | Comprobar manualmente la conexión con Supabase |
| `tests/` | Verificar el código de forma aislada |

Aquí no hay componentes React, pantallas ni estilos. La interfaz solicita
operaciones a esta API; las consultas a Supabase se realizan en el servidor.

## Responsabilidades

- Validar el inicio de sesión con Supabase Auth.
- Mantener los tokens en el servidor y enviar al navegador una cookie HttpOnly.
- Consultar productos, categorías e historial con los permisos del usuario.
- Validar las entradas y guardar mediante `inventory_mutate`.
- Conservar los identificadores de reintento y versiones para evitar duplicados
  y detectar ediciones simultáneas.
- Actualizar perfil, contraseña y gestionar la verificación de la cuenta.

## Configuración

`backend/.env` contiene `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
Se utiliza una clave pública, no una clave service_role: las reglas RLS y RPC
siguen aplicándose a cada usuario. PORT es 3001 y HOST es 127.0.0.1 por defecto.

Las sesiones duran como máximo 12 horas y se almacenan en memoria. Reiniciar
el backend requiere iniciar sesión de nuevo. El SDK renueva el token cuando
es necesario y cada petición protegida verifica el usuario en Supabase.
No se guardan contraseñas ni se envían tokens al frontend.

## Endpoints

| Método | Ruta | Función |
|---|---|---|
| GET | /api/health | Estado del proceso |
| POST | /api/auth/login | Iniciar sesión |
| GET | /api/auth/session | Consultar usuario autenticado |
| POST | /api/auth/logout | Cerrar sesión |
| PATCH | /api/auth/account | Actualizar perfil o contraseña |
| POST | /api/auth/reauthenticate | Solicitar código de verificación |
| GET | /api/inventory | Consultar productos, categorías e historial |
| POST | /api/inventory/changes | Agregar, editar, eliminar o ajustar stock |

El usuario de una operación se obtiene de la sesión verificada; no se acepta
un identificador de usuario enviado por el navegador. Una cuenta debe estar
autorizada en `inventory_members`. El guardado requiere las funciones
`inventory_write_enabled` e `inventory_mutate` ya instaladas en Supabase.
La API mantiene modo de lectura si el proyecto aún no habilita escrituras.

## Pruebas

Desde la raíz, `npm test` ejecuta los tests de API y servicios sin datos reales.
Estas pruebas simulan respuestas para comprobar el código; no crean bases
de datos. `tests/fixtures/inventarioReal.js` proporciona datos de referencia
para esas comprobaciones. La aplicación consulta el proyecto real de Supabase.

`npm run check:connection --workspace backend` comprueba Auth y consultas
anónimas sin devolver filas ni modificar datos. Un acceso anónimo restringido
no verifica los permisos de una cuenta: para eso hay que iniciar sesión.
La comprobación completa de guardado se hace con una cuenta autorizada y un
producto de prueba identificado, nunca alterando productos existentes.

## Despliegue

El frontend compilado y la API deben publicarse en el mismo origen: servir
`frontend/dist`, redirigir rutas de la SPA a index.html y enviar `/api` a la
API. El proxy debe conservar el encabezado Host original para la verificación
de origen. Usar HTTPS y `COOKIE_SECURE=true` (también se activa con
`NODE_ENV=production`). Vite preview sirve para revisión local.

Este servidor mantiene sesiones en memoria y está preparado para una sola
instancia. Para varias réplicas o sesiones que sobrevivan reinicios se necesita
un almacén compartido de sesiones. No habilita actualización automática entre
navegadores: las lecturas se actualizan al entrar o recargar y las escrituras
confirmadas actualizan inmediatamente la pantalla que las realizó.
