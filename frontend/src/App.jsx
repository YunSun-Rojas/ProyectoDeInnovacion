import InventarioFisico from './modules/inventario/pages/InventarioFisico';
import Alertas from './modules/inventario/pages/Alertas';
import Reportes from './modules/inventario/pages/Reportes';
import { Routes, Route, Navigate, useOutletContext, useLocation } from "react-router-dom";
import { LoginPage } from "./modules/auth/pages/LoginPage";
import InventarioLayout from "./modules/inventario/InventarioLayout";
import Dashboard from "./modules/inventario/pages/Dashboard";
import Productos from "./modules/inventario/pages/Productos";
import Prediccion from "./modules/inventario/pages/Prediccion";
import Vision from "./modules/inventario/pages/Vision";
import Historial from "./modules/inventario/pages/Historial";
import Existencias from "./modules/inventario/pages/Existencias";
import Kardex from "./modules/inventario/pages/Kardex";
import Config from "./modules/inventario/pages/Config";
import Operations from "./modules/inventario/pages/Operations";
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
function ProductosRoute({ currentUser }) {
  return <Productos {...useOutletContext()} currentUser={currentUser} />;
}
function PrediccionRoute() {
  return <Prediccion {...useOutletContext()} />;
}

function HistorialRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/dashboard/movimientos', search, hash }} replace />;
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
        <Route path="productos" element={<ProductosRoute currentUser={session?.user} />} />
        <Route path="compras" element={<Operations kind="purchase" />} />
        <Route path="ventas" element={<Operations kind="sale" />} />
        <Route path="prediccion" element={<PrediccionRoute />} />
        <Route path="vision" element={<Vision />} />
        <Route path="existencias" element={<Existencias />} />
        <Route path="movimientos" element={<Historial />} />
        <Route path="inventario-fisico" element={<InventarioFisico />} />
        <Route path="alertas" element={<Alertas />} />
        <Route path="reportes" element={<Reportes />} />
        <Route path="kardex" element={<Kardex />} />
        <Route path="historial" element={<HistorialRedirect />} />
        <Route path="configuracion" element={<Config />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
