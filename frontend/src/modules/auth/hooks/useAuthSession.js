import { useEffect, useState } from 'react';
import { api } from '../../../api/httpClient';

export function useAuthSession() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const onSession = event => {
      receivedEvent = true;
      if (active) setSession(event.detail);
    };
    window.addEventListener('session-changed', onSession);
    const load = () => api('/auth/session').then(data => {
      if (active && !receivedEvent) setSession(data.session);
    }).catch(() => { if (active && !receivedEvent) setSession(null); });
    load();
    const onFocus = () => { receivedEvent = false; load(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('session-changed', onSession);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  return { session, loading: session === undefined };
}
