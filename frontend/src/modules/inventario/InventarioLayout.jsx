import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { DATE_RANGES, limaDate, periodRange, summarizeMovements } from './pages/dashboardData';
import { summarizeSales } from './pages/salesData';
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import InventoryLoading from './components/InventoryLoading';
import { useInventory, useInventoryNotifications } from "./hooks/useInventory";
import s from "./pages/Management.module.css";
import ui from './pages/InventoryUI.module.css';
import { CircleCheck, CircleAlert } from 'lucide-react';

export function InventoryToast({ toast, onDismiss }) {
  const ref = useRef(null);
  useEffect(() => {
    // El popover permite ver errores por encima del dialog nativo sin robar foco.
    const element = ref.current;
    if (toast && element?.showPopover && !element.matches(':popover-open')) element.showPopover();
  }, [toast]);
  useEffect(() => {
    if (!toast?.closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDismiss(); return; }
    const timer = window.setTimeout(onDismiss, 180);
    return () => window.clearTimeout(timer);
  }, [toast?.closing, onDismiss]);
  if (!toast) return null;
  const isError = toast.type === 'error';
  const Icon = isError ? CircleAlert : CircleCheck;
  return <div ref={ref} popover="manual" role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} aria-atomic="true"
    className={`${ui.toast} ${isError ? ui.toastError : ''} ${toast.closing ? ui.toastClosing : ''}`}
    onAnimationEnd={event => { if (toast.closing && event.target === event.currentTarget) onDismiss(); }}>
    <Icon size={21} aria-hidden="true" /><span>{toast.message}</span>
  </div>;
}

export default function InventarioLayout({ userId }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const activePage = pathname.split("/")[2] || "dashboard";
  const inventoryFeedback = ['productos', 'existencias', 'movimientos', 'kardex', 'inventario-fisico', 'alertas', 'reportes'].includes(activePage);
  const contentRef = useRef(null);
  const entranceRef = useRef(null);
  useLayoutEffect(() => {
    // Reinicia la misma animación CSS antes de pintar, sin remontar el contenido.
    const animation = contentRef.current?.getAnimations()[0];
    if (animation) entranceRef.current = animation;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && entranceRef.current) {
      entranceRef.current.currentTime = 0;
      entranceRef.current.play();
    }
  }, [activePage]);

  const setActivePage = (page) => {
    navigate(
      page === "dashboard"
        ? "/dashboard"
        : `/dashboard/${page}`
    );
  };

  const inventory = useInventory(userId);

  const {
    products = [],
    categories = [],
    status,
    error,
    retry,
  } = inventory;

  const [selectedRange, setSelectedRange] = useState('month');
  const today = limaDate(new Date());
  const rangeConfig = DATE_RANGES.find(range => range.id === selectedRange) || DATE_RANGES.find(range => range.id === 'month');
  const activity = useMemo(() => summarizeMovements(inventory.movements, periodRange(selectedRange, today)), [inventory.movements, selectedRange, today]);
  const salesSummary = useMemo(() => summarizeSales(inventory.sales, periodRange(selectedRange, today)), [inventory.sales, selectedRange, today]);

  const { toast, notify, dismissToast } = useInventoryNotifications();

  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem("eagle-dark-mode") === "true";
    } catch {
      return false;
    }
  });

  const [themeError, setThemeError] = useState("");

  const toggleDarkMode = () => {
    const next = !darkMode;

    setDarkMode(next);
    setThemeError("");

    try {
      localStorage.setItem("eagle-dark-mode", String(next));
    } catch {
      setThemeError(
        "El tema se aplicó, pero no pudo guardarse en este navegador."
      );
    }
  };

  const [settings, setSettings] = useState(() => {
    const defaults = {
      company: "Eagle Gaming",
      ruc: "20607787728",
      address: "C.C. Garcilazo de la Vega 1348, Tda. 1B, 133",
      phone: "986638034",
      minStock: 5,
    };

    try {
      const saved = JSON.parse(
        localStorage.getItem("eagle-company-settings")
      );

      for (const key of [
        "company",
        "ruc",
        "address",
        "phone",
        "description",
      ]) {
        if (typeof saved?.[key] === "string") {
          defaults[key] = saved[key];
        }
      }
    } catch {
      // Mantener los valores predeterminados.
    }

    return defaults;
  });

  return (
    <div
      className="inventory-shell"
      data-theme={darkMode ? "dark" : "light"}
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        products={products}
        categories={categories}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          background: "var(--inventory-bg, #F1F5F9)",
        }}
      >
        <Header
          products={products}
          inventoryReady={status === "ready"}
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          activity={activity}
          salesSummary={salesSummary}
          salesEnabled={inventory.salesEnabled}
          historyAvailable={!inventory.readOnly}
        />

        <main
          ref={contentRef}
          className={`inventory-main ${ui.viewEntrance}${inventoryFeedback ? ` ${ui.inventoryFeedback}` : ''}`}
          data-inventory-view={activePage}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {status === "ready" || activePage === "configuracion" ? (
            <Outlet
              context={{
                ...inventory,
                activity,
                salesSummary,
                rangeLabel: rangeConfig.label,
                products,
                categories,
                settings,
                setSettings,
                darkMode,
                toggleDarkMode,
                themeError,
                defaultMinStock: settings.minStock,
                onNavigate: setActivePage,
                notify,
              }}
            />
          ) : status === "loading" ? (
            <InventoryLoading />
          ) : (
            <div className={s.page}>
              <section
                className={s.card}
                aria-busy={status === "loading"}
              >
                    <p className={s.formError} role="alert">
                      {error}
                    </p>

                    <button
                      type="button"
                      className={s.button}
                      onClick={retry}
                    >
                      Reintentar
                    </button>
              </section>
            </div>
          )}
        </main>
      </div>

      <InventoryToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
