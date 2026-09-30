import { randomBytes } from 'node:crypto';
import { fail } from '../../utils/http.js';

const COOKIE = 'eagle_session';
const MAX_AGE = 12 * 60 * 60;

export function createAuthService(config, clientFactory) {
  const sessions = new Map();
  const attempts = new Map();
  const cookie = (id, age = MAX_AGE) => `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
  const sessionId = req => req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, value] of sessions) if (value.expires <= now) sessions.delete(id);
    for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
  }, 60000).unref();

  function checkLoginAttempt(ip) {
    let limit = attempts.get(ip);
    if (!limit || limit.until <= Date.now()) attempts.set(ip, limit = { count: 0, until: Date.now() + 15 * 60000 });
    if (++limit.count > 30) throw fail(429, 'Demasiados intentos. Espera 15 minutos.');
  }
  async function login(body, ip, previousId) {
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.password) throw fail(400, 'Ingresa correo y contraseña.');
    if (sessions.size >= 1000) throw fail(503, 'Servidor ocupado. Intenta más tarde.');
    const client = clientFactory();
    const { data, error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error || !data.session) throw fail(error?.status >= 500 ? 503 : 401, error?.message || 'No se pudo iniciar sesión.', error?.code);
    sessions.delete(previousId);
    const id = randomBytes(32).toString('hex');
    sessions.set(id, { client, expires: Date.now() + MAX_AGE * 1000 });
    attempts.delete(ip);
    return { id, user: data.user };
  }
  async function logout(id) {
    const session = sessions.get(id);
    // Si falla la revocación, conservar la sesión para permitir reintentar.
    if (session) {
      const { error } = await session.client.auth.signOut({ scope: 'local' });
      if (error && ![401, 403, 404].includes(error.status)) throw fail(503, 'No se pudo cerrar sesión. Reintenta.');
    }
    sessions.delete(id);
  }
  async function updateAccount({ client, user }, body) {
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
    return data.user;
  }
  async function reauthenticate({ client }) {
    const { error } = await client.auth.reauthenticate();
    if (error) throw fail(400, error.message, error.code);
  }
  function dispose() { clearInterval(cleanup); sessions.clear(); attempts.clear(); }
  return { sessions, sessionId, cookie, checkLoginAttempt, login, logout, updateAccount, reauthenticate, dispose };
}
