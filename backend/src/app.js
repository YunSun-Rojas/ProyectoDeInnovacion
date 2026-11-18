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
import { createVisionService } from './modules/vision/visionService.js';
import { Readable } from 'node:stream';

export function createApi(config, { clientFactory = () => createSupabaseClient(config), inventory = inventoryService, vision = createVisionService() } = {}) {
  const authService = createAuthService(config, clientFactory);
  const authenticate = createAuthMiddleware(authService);
  const routes = [
    { method: 'GET', path: '/api/vision/model', handler: async ({send}) => send(200,await vision.info()) },
    { method: 'POST', path: '/api/vision/detect', handler: async ({req,res,send}) => { res.setHeader('Connection','close'); send(200,await vision.detect(req)); } },
    { method: 'POST', path: '/api/vision/video', handler: async ({req,res,send}) => {
      const url=new URL(req.url,'http://localhost');
      res.setHeader('Connection','close');send(202,await vision.startVideo(req,{lineRatio:Number(url.searchParams.get('lineRatio')??.5),leftToRight:url.searchParams.get('leftToRight')??'SALIDA',rightToLeft:url.searchParams.get('rightToLeft')??'ENTRADA'}));
    } },
    { method: 'GET', path: '/api/vision/video/status', handler: async ({req,send}) => send(200,await vision.videoStatus(new URL(req.url,'http://localhost').searchParams.get('jobId'))) },
    { method: 'GET', path: '/api/vision/video/result', handler: async ({req,send}) => send(200,await vision.videoResult(new URL(req.url,'http://localhost').searchParams.get('jobId'))) },
    { method: 'POST', path: '/api/vision/video/cancel', handler: async ({req,send}) => send(200,await vision.cancelVideo(new URL(req.url,'http://localhost').searchParams.get('jobId'))) },
    { method: 'GET', path: '/api/vision/video/output', handler: async ({req,res}) => {
      const stream=await vision.videoOutput(new URL(req.url,'http://localhost').searchParams.get('jobId'));
      res.writeHead(200,{'Content-Type':'video/mp4','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      Readable.fromWeb(stream).pipe(res);
    } },
    { method: 'POST', path: '/api/vision/live/reset', handler: async ({req,send}) => {
      const url=new URL(req.url,'http://localhost');
      send(200,await vision.liveReset({lineRatio:Number(url.searchParams.get('lineRatio')??.5),leftToRight:url.searchParams.get('leftToRight')??'SALIDA',rightToLeft:url.searchParams.get('rightToLeft')??'ENTRADA'}));
    } },
    { method: 'POST', path: '/api/vision/live/frame', handler: async ({req,send}) => send(200,await vision.liveFrame(req)) },
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
