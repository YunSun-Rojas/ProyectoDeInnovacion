import { readBody } from '../../utils/http.js';

export function createAuthController(service) {
  return {
    async login({ req, res, send }) {
      const ip = req.socket.remoteAddress;
      service.checkLoginAttempt(ip);
      const body = await readBody(req);
      const { id, user } = await service.login(body, ip, service.sessionId(req));
      res.setHeader('Set-Cookie', service.cookie(id));
      send(200, { session: { user } });
    },
    async logout({ req, res, send }) {
      await readBody(req);
      await service.logout(service.sessionId(req));
      res.setHeader('Set-Cookie', service.cookie('', 0));
      send(200, { ok: true });
    },
    session({ session, send }) { send(200, { session: { user: session.user } }); },
    async reauthenticate({ req, session, send }) {
      await readBody(req);
      await service.reauthenticate(session);
      send(200, { ok: true });
    },
    async updateAccount({ req, session, send }) {
      const user = await service.updateAccount(session, await readBody(req));
      send(200, { session: { user } });
    },
  };
}
