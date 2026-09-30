import { fail } from '../utils/http.js';

export function createAuthMiddleware({ sessions, sessionId }) {
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

  return authenticate;
}
