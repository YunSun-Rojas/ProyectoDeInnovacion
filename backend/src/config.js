import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function readConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Configura SUPABASE_URL y SUPABASE_ANON_KEY en backend/.env.');
  return { url, key, port: Number(process.env.PORT || 3001), host: process.env.HOST || '127.0.0.1',
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production' };
}
