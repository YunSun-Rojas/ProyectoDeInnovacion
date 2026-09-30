export const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export async function readBody(req) {
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

export function checkOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Origen no permitido.');
  if (req.headers.origin) {
    let host;
    try { host = new URL(req.headers.origin).host; } catch { throw fail(403, 'Origen no permitido.'); }
    if (host !== req.headers.host) throw fail(403, 'Origen no permitido.');
  }
}

