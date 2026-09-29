import { createClient } from '@supabase/supabase-js';
import { readConfig } from '../src/config.js';

const { url, key } = readConfig();
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
// Solo consultas de lectura con la clave pública: nunca se imprime la configuración.
const auth = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
if (!auth.ok) throw new Error(`La conexión de autenticación respondió ${auth.status}.`);
console.log('Conexión con Supabase Auth correcta.');
for (const table of ['products', 'categories', 'inventory_members', 'inventory_movements']) {
  const { error, status } = await client.from(table).select('*').limit(0);
  if (error && !['42501'].includes(error.code)) throw new Error(`No se pudo verificar ${table}: HTTP ${status}, ${error.code || error.message}`);
  console.log(`${table}: ${error ? 'acceso anónimo restringido' : 'consulta disponible'}.`);
}
console.log('Comprobación de lectura terminada. Las escrituras requieren iniciar sesión con una cuenta autorizada.');
