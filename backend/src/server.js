import { createApi } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const server = createApi(config);
server.listen(config.port, config.host, () => console.log(`Backend disponible en http://${config.host}:${config.port}`));
server.on('error', error => { console.error(`No se pudo iniciar el backend: ${error.code}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });
