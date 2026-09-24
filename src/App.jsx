import { Routes, Route, Navigate, useOutletContext } from "react-router-dom";
import { LoginPage } from "./modules/auth/pages/LoginPage";
import InventarioLayout from "./modules/inventario/InventarioLayout";
import Dashboard from "./modules/inventario/pages/Dashboard";
import Productos from "./modules/inventario/pages/Productos";
import Prediccion from "./modules/inventario/pages/Prediccion";
import Vision from "./modules/inventario/pages/Vision";
import Historial from "./modules/inventario/pages/Historial";
import Config from "./modules/inventario/pages/Config";
import { hasDemoSession } from "./modules/auth/services/demoSession";

function RequireDemoSession() {
  return hasDemoSession() ? <InventarioLayout /> : <Navigate to="/login" replace />;
}

function LoginRoute() {
  return hasDemoSession() ? <Navigate to="/dashboard" replace /> : <LoginPage />;
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
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/dashboard" element={<RequireDemoSession />}>
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
