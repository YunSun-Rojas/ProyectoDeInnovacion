# Frontend: interfaz del usuario

Esta carpeta contiene la aplicación React que se ejecuta en el navegador.
No contiene conexiones a Supabase, SQL ni validaciones de permisos del servidor.

| Ubicación | Responsabilidad |
|---|---|
| `src/App.jsx` | Rutas de las pantallas |
| `src/api/httpClient.js` | Enviar peticiones HTTP a `/api` y leer las respuestas |
| `src/modules/auth/api/authApi.js` | Solicitar login, logout y cambios de perfil al backend |
| `src/modules/auth/hooks/useAuthSession.js` | Mantener el estado de sesión mostrado en la interfaz |
| `src/modules/inventario/api/inventoryApi.js` | Solicitar la consulta y el guardado de productos al backend |
| `src/modules/inventario/hooks/useInventory.js` | Mostrar productos, carga, errores y resultados de guardado |
| `src/modules/*/pages/` | Pantallas |
| `src/modules/*/components/` | Elementos de la interfaz |
| `src/assets/` y `public/` | Imágenes y archivos públicos |
| `src/shared/components/` y `src/shared/utils/` | Espacios reservados para código compartido entre módulos; contienen `.gitkeep` mientras estén vacíos |

Los archivos `api/` son clientes HTTP: solicitan acciones al servidor.
Los archivos `hooks/` coordinan el estado de React; no consultan la base de datos.
El backend valida las solicitudes y ejecuta las operaciones reales.

Ejecuta `npm run dev` desde la raíz del proyecto para iniciar ambas partes.
