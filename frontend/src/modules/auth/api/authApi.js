import { api } from '../../../api/httpClient';

function publish(session) {
  window.dispatchEvent(new CustomEvent('session-changed', { detail: session }));
}

export async function login(username, password) {
  try {
    const { session } = await api('/auth/login', { method: 'POST', body: { email: username.trim(), password } });
    publish(session);
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
    publish(null);
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
}

export async function updateAccount(body) {
  try {
    const { session } = await api('/auth/account', { method: 'PATCH', body });
    publish(session);
    return { error: null };
  } catch (error) { return { error }; }
}

export async function sendVerificationCode() {
  await api('/auth/reauthenticate', { method: 'POST', body: {} });
}
