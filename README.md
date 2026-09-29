# Proyecto de innovación

Aplicación de inventario con frontend React y API Node conectada al proyecto real de Supabase.

## Estructura

```text
ProyectoDeInnovacion/
├── frontend/
│   ├── src/api/httpClient.js # Peticiones HTTP al backend
│   ├── src/modules/          # Módulos auth e inventario
│   │   └── cada módulo/
│   │       ├── api/          # Solicitudes al backend
│   │       ├── hooks/        # Estado de React: carga, sesión y errores
│   │       ├── pages/        # Pantallas
│   │       └── components/   # Componentes visuales
│   ├── public/
│   └── package.json
├── backend/
│   ├── src/server.js         # Inicio del servidor
│   ├── src/app.js            # Endpoints, autenticación y autorización
│   ├── src/config.js         # Configuración privada del servidor
│   ├── src/database/         # Cliente de Supabase
│   ├── scripts/              # Comprobación de conexión real
│   ├── tests/                # Pruebas aisladas; no intervienen en la aplicación
│   ├── .env                  # URL y clave de Supabase (no se versiona)
│   └── package.json
├── scripts/dev.mjs          # Inicia frontend y backend juntos
├── package.json
└── package-lock.json
```

Flujo: **pantalla → /api → backend → Supabase**.
El navegador no importa el SDK de Supabase ni realiza consultas a sus tablas.
El backend utiliza los permisos de la cuenta autenticada; no usa una clave de administrador.

## Ejecutar

Desde la carpeta principal, con Node.js 22.12 o posterior:

```powershell
npm install
npm run dev
```

Esto inicia la API en el puerto 3001 y Vite en el puerto indicado en la terminal.
Al detener el comando se detienen ambos procesos. Tras cambiar esta estructura,
detén el servidor anterior e inicia sesión nuevamente.

La configuración existente fue trasladada a `backend/.env`. Para una copia nueva,
copia `backend/.env.example` a `backend/.env` y completa los valores.
No se necesitan credenciales de Supabase en el frontend. El proxy de Vite dirige
`/api` a `http://127.0.0.1:3001`; si cambias PORT, ajusta también ese destino.

## Comandos

- `npm run dev`: ambos servidores.
- `npm run dev:frontend` / `npm run dev:backend`: cada servidor por separado.
- `npm run build`: compila el frontend en `frontend/dist/`.
- `npm run preview`: inicia la API y la vista previa de la compilación.
- `npm start`: inicia únicamente la API.
- `npm run lint`: revisa React.
- `npm test`: pruebas de servicios y endpoints del backend.
- `npm run check:connection --workspace backend`: verifica conexión real con lecturas anónimas, sin modificar productos.

La aplicación usa la base real. Los datos dentro de `backend/tests/fixtures/`
solo se utilizan al ejecutar pruebas, nunca para reemplazar datos del servidor.
Las estimaciones de ventas y reconocimiento visual conservan su alcance anterior;
esta separación no incorpora un sistema de ventas ni reconocimiento real.

Ver [frontend/README.md](frontend/README.md) para los archivos de interfaz y
[backend/README.md](backend/README.md) para los archivos del servidor, endpoints y despliegue.
