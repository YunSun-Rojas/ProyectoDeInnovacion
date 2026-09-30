import { createServer } from 'node:http';
import { createSupabaseClient } from './database/supabaseClient.js';
import * as inventoryService from './modules/inventory/inventoryService.js';
import { createAuthService } from './modules/auth/authService.js';
import { createAuthController } from './modules/auth/authController.js';
import { createAuthRoutes } from './modules/auth/authRoutes.js';
import { createInventoryController } from './modules/inventory/inventoryController.js';
import { createInventoryRoutes } from './modules/inventory/inventoryRoutes.js';
import { createAuthMiddleware } from './middleware/authMiddleware.js';
import { checkOrigin, fail } from './utils/http.js';

export function createApi(config, { clientFactory = () => createSupabaseClient(config), inventory = inventoryService } = {}) {
  const authService = createAuthService(config, clientFactory);
  const authenticate = createAuthMiddleware(authService);
  const routes = [
    ...createAuthRoutes(createAuthController(authService)),
    ...createInventoryRoutes(createInventoryController(inventory)),
  ];
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost:5173').pathname;
      if (req.method === 'GET' && path === '/') return send(200, {
        message: 'Eagle Gaming Inventario API funcionando',
      });
      if (req.method === 'GET' && path === '/api/health') return send(200, { ok: true });
      checkOrigin(req);
      const route = routes.find(route => route.method === req.method && route.path === path);
      const session = route?.public ? undefined : await authenticate(req);
      if (route) return await route.handler({ req, res, send, session });
      throw fail(404, 'Ruta no encontrada.');
    } catch (error) {
      const status = error.status || (error.uncertain ? 503 : 400);
      send(status, { error: error.message || 'No se pudo completar la operación.', code: error.code, uncertain: Boolean(error.uncertain) });
    }
  });
  server.on('close', () => authService.dispose());
  return server;
}
