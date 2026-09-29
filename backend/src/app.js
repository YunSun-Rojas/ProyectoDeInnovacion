import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createSupabaseClient } from './database/supabaseClient.js';
import { loadInventory, saveInventoryChange, productPayload, mapProduct, mapMovement } from './services/inventoryService.js';

const COOKIE = 'eagle_session';
const MAX_AGE = 12 * 60 * 60;
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'Se requiere JSON.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 32768) throw fail(413, 'Solicitud demasiado grande.');
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error();
    return parsed;
  } catch { throw fail(400, 'JSON inválido.'); }
}

function checkOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Origen no permitido.');
  if (req.headers.origin) {
    let host;
    try { host = new URL(req.headers.origin).host; } catch { throw fail(403, 'Origen no permitido.'); }
    if (host !== req.headers.host) throw fail(403, 'Origen no permitido.');
  }
}

export function createApi(config, { clientFactory = () => createSupabaseClient(config),
  inventory = { loadInventory, saveInventoryChange, productPayload, mapProduct, mapMovement } } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const cookie = (id, age = MAX_AGE) => `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
  const sessionId = req => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, value] of sessions) if (value.expires <= now) sessions.delete(id);
    for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
  }, 60000).unref();

  async function authenticate(req) {
    const id = sessionId(req);
    const session = sessions.get(id);
    if (!session || session.expires <= Date.now()) {
      sessions.delete(id);
      throw fail(401, 'Inicia sesión nuevamente.');
    }
    // getUser valida el token en Supabase; el SDK renueva la sesión si vence.
    const { data, error } = await session.client.auth.getUser();
    if (error || !data.user) {
      if (error && ![400, 401, 403].includes(error.status)) throw fail(503, 'No se pudo validar la sesión. Reintenta.');
      sessions.delete(id);
      throw fail(401, 'Tu sesión venció. Inicia sesión nuevamente.');
    }
    return { ...session, id, user: data.user };
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') return send(200, { ok: true });
      checkOrigin(req);
      if (req.method === 'POST' && path === '/api/auth/login') {
        const ip = req.socket.remoteAddress;
        let limit = attempts.get(ip);
        if (!limit || limit.until <= Date.now()) attempts.set(ip, limit = { count: 0, until: Date.now() + 15 * 60000 });
        if (++limit.count > 30) throw fail(429, 'Demasiados intentos. Espera 15 minutos.');
        const body = await readBody(req);
        if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.password) throw fail(400, 'Ingresa correo y contraseña.');
        if (sessions.size >= 1000) throw fail(503, 'Servidor ocupado. Intenta más tarde.');
        const client = clientFactory();
        const { data, error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
        if (error || !data.session) throw fail(error?.status >= 500 ? 503 : 401, error?.message || 'No se pudo iniciar sesión.', error?.code);
        sessions.delete(sessionId(req));
        const id = randomBytes(32).toString('hex');
        sessions.set(id, { client, expires: Date.now() + MAX_AGE * 1000 });
        attempts.delete(ip);
        res.setHeader('Set-Cookie', cookie(id));
        return send(200, { session: { user: data.user } });
      }
      if (req.method === 'POST' && path === '/api/auth/logout') {
        await readBody(req);
        const id = sessionId(req);
        const session = sessions.get(id);
        // Si falla la revocación, conservar la sesión para permitir reintentar.
        if (session) {
          const { error } = await session.client.auth.signOut({ scope: 'local' });
          if (error && ![401, 403, 404].includes(error.status)) throw fail(503, 'No se pudo cerrar sesión. Reintenta.');
        }
        sessions.delete(id);
        res.setHeader('Set-Cookie', cookie('', 0));
        return send(200, { ok: true });
      }
      const { client, user } = await authenticate(req);
      if (req.method === 'GET' && path === '/api/auth/session') return send(200, { session: { user } });
      if (req.method === 'POST' && path === '/api/auth/reauthenticate') {
        await readBody(req);
        const { error } = await client.auth.reauthenticate();
        if (error) throw fail(400, error.message, error.code);
        return send(200, { ok: true });
      }
      if (req.method === 'PATCH' && path === '/api/auth/account') {
        const body = await readBody(req);
        let attributes;
        if (body.mode === 'profile') {
          if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) throw fail(400, 'Nombre inválido.');
          attributes = { data: { full_name: body.name.trim() } };
        } else if (body.mode === 'password') {
          if (typeof body.password !== 'string' || body.password.length < 8 || typeof body.currentPassword !== 'string') throw fail(400, 'Contraseña inválida.');
          const verifier = clientFactory();
          const { data, error } = await verifier.auth.signInWithPassword({ email: user.email, password: body.currentPassword });
          if (error || data.user?.id !== user.id) throw fail(400, 'La contraseña actual no es correcta.', 'invalid_credentials');
          await verifier.auth.signOut({ scope: 'local' });
          attributes = { password: body.password, current_password: body.currentPassword,
            ...(typeof body.nonce === 'string' && body.nonce.trim() ? { nonce: body.nonce.trim() } : {}) };
        } else throw fail(400, 'Operación inválida.');
        const { data, error } = await client.auth.updateUser(attributes);
        if (error) throw fail(400, error.message, error.code);
        return send(200, { session: { user: data.user } });
      }
      if (req.method === 'GET' && path === '/api/inventory') {
        return send(200, await inventory.loadInventory(client, user.id));
      }
      if (req.method === 'POST' && path === '/api/inventory/changes') {
        const body = await readBody(req);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
          || !['add', 'edit', 'delete', 'adjust'].includes(body.action)) throw fail(400, 'Operación inválida.');
        if (body.action !== 'add' && (!Number.isSafeInteger(body.productId) || body.productId <= 0)) throw fail(400, 'Producto inválido.');
        if (['edit', 'delete'].includes(body.action) && (!Number.isSafeInteger(body.version) || body.version <= 0)) throw fail(400, 'Versión inválida.');
        if (!body.data || Array.isArray(body.data) || typeof body.data !== 'object') throw fail(400, 'Datos inválidos.');
        if (body.action === 'adjust' && ![-1, 1].includes(body.data.delta)) throw fail(400, 'Ajuste inválido.');
        const payload = ['add', 'edit'].includes(body.action) ? inventory.productPayload(body.data)
          : body.action === 'adjust' ? { delta: body.data.delta } : {};
        // Leer permisos y categorías ANTES de escribir, para no perder una confirmación.
        const current = await inventory.loadInventory(client, user.id);
        if (current.readOnly) throw fail(403, 'Tu cuenta no tiene habilitado el guardado.');
        const result = await inventory.saveInventoryChange(client, { p_request_id: body.requestId, p_action: body.action,
          p_product_id: body.action === 'add' ? null : body.productId,
          p_expected_version: body.version ?? null, p_data: payload });
        try {
          return send(200, { product: result.product ? inventory.mapProduct(result.product, current.categories) : null,
            movement: inventory.mapMovement(result.movement) });
        } catch { throw Object.assign(fail(503, 'Cambio enviado. Reintenta para confirmar sin duplicarlo.'), { uncertain: true }); }
      }
      throw fail(404, 'Ruta no encontrada.');
    } catch (error) {
      const status = error.status || (error.uncertain ? 503 : 400);
      send(status, { error: error.message || 'No se pudo completar la operación.', code: error.code, uncertain: Boolean(error.uncertain) });
    }
  });
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); attempts.clear(); });
  return server;
}
