import { lazy, Suspense } from 'react';
import InventoryLoading from '../components/InventoryLoading';
import PrediccionConEvidencia from './PrediccionConEvidencia';

// Vite removes the import and its synthetic fixtures from production builds.
const DemoLocal = import.meta.env.DEV ? lazy(() => import('./PrediccionDemoLocal.jsx')) : null;

export default function PrediccionConDemoLocal(props) {
  const local = import.meta.env.DEV && typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  return local ? <Suspense fallback={<InventoryLoading label="Cargando predicción de demanda" />}>
    <DemoLocal {...props} />
  </Suspense> : <PrediccionConEvidencia {...props} />;
}
