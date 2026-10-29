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
│   ├── src/app.js            # Composición de módulos y despacho HTTP
│   ├── src/modules/
│   │   ├── auth/            # authRoutes, authController y authService
│   │   └── inventory/       # inventoryRoutes, inventoryController,
│   │                       # inventoryService e inventoryRepository
│   ├── src/middleware/      # Validación de sesiones
│   ├── src/utils/           # JSON, origen y errores HTTP
│   ├── src/config.js         # Configuración privada del servidor
│   ├── src/database/         # Cliente de Supabase
│   ├── scripts/              # Comprobación de conexión real
│   ├── tests/                # Pruebas aisladas; no intervienen en la aplicación
│   ├── .env                  # URL y clave de Supabase (no se versiona)
│   └── package.json
├── backend/yolo/            # Servicio Python, data/, runs/, pruebas/ y yolov8n.pt
├── backend/tests/sql/       # SQL conservado para pruebas aisladas
├── shared/                  # Contratos y validaciones usados por frontend y backend
├── scripts/dev.mjs          # Inicia frontend y backend juntos
├── package.json
└── package-lock.json
```

Flujo: **pantalla → /api → backend → Supabase**.
En el backend: **ruta → middleware de sesión → controlador → servicio → repositorio → Supabase**.
Los archivos de `backend/tests/sql/` se utilizan en pruebas aisladas con PGlite;
no son un respaldo completo del esquema remoto ni se aplican al iniciar la aplicación.
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

La configuración existente está en `backend/.env`. Para una copia nueva,
crea `backend/.env` con `SUPABASE_URL` y `SUPABASE_ANON_KEY` del proyecto.
No se necesitan credenciales de Supabase en el frontend. El proxy de Vite dirige
`/api` a `http://127.0.0.1:3001`; si cambias PORT, ajusta también ese destino.

## Comandos

- `npm run dev`: ambos servidores.
- `npm run dev:frontend` / `npm run dev:backend`: cada servidor por separado.
- `npm run build`: compila el frontend en `frontend/dist/`.
- `npm run preview`: inicia la API y la vista previa de la compilación.
- `npm start`: inicia únicamente la API.
- `npm run lint`: revisa React.
- `npm test`: todas las pruebas backend y frontend, sin conectar a Supabase real.
- `npm run test:backend` / `npm run test:frontend`: cada batería por separado.
- `npm run check:connection --workspace backend`: verifica conexión real con lecturas anónimas, sin modificar productos.

La aplicación usa la base real. Los datos dentro de `backend/tests/fixtures/`
solo se utilizan al ejecutar pruebas, nunca para reemplazar datos del servidor.
El reconocimiento visual utiliza el servicio local `backend/yolo/service.py` y el
modelo `backend/yolo/runs/detect/monitores_v1/weights/best.pt`. Con las dependencias
de `backend/yolo/requirements.txt` ya instaladas, iniciar desde la raíz con
`python backend/yolo/service.py`; `npm run dev` no inicia Python.
El servicio resuelve el modelo desde su propia carpeta, independientemente del directorio actual.
El dataset, las muestras y los resultados históricos están dentro de `backend/yolo/`.
Los `args.yaml` conservan las rutas originales como registro histórico; para futuros
comandos de entrenamiento con `data/imagenes/labeled/data.yaml` y `yolov8n.pt`,
el directorio de trabajo es `backend/yolo/`. Esta reorganización no reentrena el modelo.

La navegación se define en `frontend/src/App.jsx`. En cada módulo del frontend,
`api/` usa el cliente HTTP común, `hooks/` mantiene sesión/carga/errores y
`pages/` y `components/` contienen la interfaz. `useAuthSession` y `useInventory`
coordinan las lecturas de sesión e inventario; no conectan directamente a Supabase.
Los recursos visuales viven en `frontend/src/assets/` y `frontend/public/`.

Ver [backend/README.md](backend/README.md) para los contratos del servidor y despliegue,
y [el procedimiento de evidencias](backend/tests/sql/prediction_evidence_deployment.md)
para la migración histórica, su verificación y recuperación.

## Herramientas de revisión aislada

Estas herramientas no forman parte del bundle de producción y no sustituyen las
pruebas automatizadas. Sus configuraciones interceptan `/api` con respuestas locales:

- `frontend/tests/catalog-review/`: laboratorio de formularios, diálogos y flujos
  de inventario. `renderEntry.jsx` también es entrada SSR de las pruebas de catálogo
  y reconocimiento visual. Desde `frontend`, ejecutar
  `npm run dev -- --config tests/catalog-review/vite.config.mjs --host 127.0.0.1 --port 5177 --strictPort`.
- `frontend/tests/review/vite.config.mjs`: aplicación completa con sesión y API
  simuladas para revisar navegación e integración. Desde `frontend`, ejecutar
  `npm run dev -- --config tests/review/vite.config.mjs --host 127.0.0.1 --port 5176 --strictPort`.
- `frontend/tests/prediction-review/vite.config.mjs`: lectura de evidencia con el
  frontend y servidor HTTP reales, pero identidad/RPC sintéticas y sin cargar `.env`.
  Desde `frontend`, ejecutar
  `npm run dev -- --config tests/prediction-review/vite.config.mjs --host 127.0.0.1 --port 5187 --strictPort`.
  Las credenciales locales y escenarios se describen en esa configuración.
- `kardex-review/fixtures.mjs` y `prediction-review/fixtures.mjs`: fixtures compartidos
  con revisiones y pruebas. No eliminarlos aunque no tengan una página HTML propia.

### Demostración de predicción para la tesis

Iniciar Eagle Gaming normalmente con `npm run dev`, abrir http://localhost:5173/,
iniciar sesión y entrar a **Predicción de demanda**. Los datos reales se muestran
por defecto. Pulsar **Ver demostración** para ver Mouse ficticio Aurora y Teclado
ficticio Nebula en la misma ruta, con el selector de 7/30 días y el aviso permanente
**DEMOSTRACIÓN — DATOS SIMULADOS**.

Los cálculos usan los algoritmos reales sobre 240 días ficticios completos por
producto, con corte fijo 01/10/2026. La demostración no consulta API ni Supabase:
desmonta el lector de evidencias y cancela su petición pendiente. **Volver a datos
reales** descarta el estado simulado y monta una nueva lectura real. No se guarda
el modo en URL ni almacenamiento. Solo se ofrece con Vite en desarrollo y en un
host de loopback; el build de producción excluye el controlador y sus fixtures.
Los datos y pruebas se conservan en `frontend/tests/prediction-review/`; ya no se
necesita una página ni un servidor separado para la demostración.
