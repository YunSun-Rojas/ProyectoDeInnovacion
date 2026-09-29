import { Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import { LoginPage } from "./modules/auth/pages/LoginPage";
import InventarioLayout from "./modules/inventario/InventarioLayout";
import Dashboard from "./modules/inventario/pages/Dashboard";
import Productos from "./modules/inventario/pages/Productos";
import Prediccion from "./modules/inventario/pages/Prediccion";
import Vision from "./modules/inventario/pages/Vision";
import Historial from "./modules/inventario/pages/Historial";
import Config from "./modules/inventario/pages/Config";
import { useAuthSession } from "./modules/auth/hooks/useAuthSession";

function RequireSession({ session }) {
  return session ? <InventarioLayout key={session.user.id} userId={session.user.id} /> : <Navigate to="/login" replace />;
}

function LoginRoute({ session }) {
  return session ? <Navigate to="/dashboard" replace /> : <LoginPage />;
}

function DashboardRoute() {
  return <Dashboard {...useOutletContext()} />;
}
function ProductosRoute() {
  return <Productos {...useOutletContext()} />;
}
function PrediccionRoute() {
  return <Prediccion {...useOutletContext()} />;
}

export default function App() {
  const { session, loading } = useAuthSession();
  if (loading) return <div role="status" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#F1F5F9', color: '#1F2937' }}>Cargando sesión…</div>;
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute session={session} />} />
      <Route path="/dashboard" element={<RequireSession session={session} />}>
        <Route index element={<DashboardRoute />} />
        <Route path="productos" element={<ProductosRoute />} />
        <Route path="prediccion" element={<PrediccionRoute />} />
        <Route path="vision" element={<Vision />} />
        <Route path="historial" element={<Historial />} />
        <Route path="configuracion" element={<Config />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
