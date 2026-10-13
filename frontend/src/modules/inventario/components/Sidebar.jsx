import { useNavigate, useSearchParams } from "react-router-dom";
import { useMemo, useRef, useState } from "react";
import { logout } from "../../auth/api/authApi";
import LogoutDialog from "./LogoutDialog";

import {
  LayoutGrid,
  Boxes,
  TrendingUp,
  Eye,
  History,
  Settings,
  LogOut,
  ChevronDown,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "dashboard", label: "Panel de control", icon: LayoutGrid },
  { id: "productos", label: "Inventario", icon: Boxes },
  { id: "prediccion", label: "Predicción IA", icon: TrendingUp },
  { id: "vision", label: "Reconocimiento Visión", icon: Eye },
  { id: "historial", label: "Historial", icon: History },
  { id: "configuracion", label: "Configuración", icon: Settings },
];

export default function Sidebar({
  activePage,
  setActivePage,
  categories = [],
  products = [],
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [inventoryOpen, setInventoryOpen] = useState(
    activePage === "productos"
  );
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const logoutLock = useRef(false);

  const selectedCategory = searchParams.get("categoria") || "";
  const inventoryActive = activePage === "productos";

  const categoryItems = useMemo(() => {
    const names = [
      ...categories.map((category) =>
        typeof category === "string" ? category : category.name
      ),
      ...products.map((product) => product.category),
    ];

    const counts = new Map();

    products.forEach((product) => {
      counts.set(
        product.category,
        (counts.get(product.category) || 0) + 1
      );
    });

    return [...new Set(names.filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"))
      .map((name) => ({
        name,
        count: counts.get(name) || 0,
      }));
  }, [categories, products]);

  const selectCategory = (category = "") => {
  setInventoryOpen(true);

  const next = new URLSearchParams(
    inventoryActive ? searchParams : undefined
  );

  if (category) {
    next.set("categoria", category);
  } else {
    next.delete("categoria");
  }

  next.delete("pagina");

  navigate({
    pathname: "/dashboard/productos",
    search: next.toString() ? `?${next.toString()}` : "",
  });
};

  const handleNavigation = (page) => {
    if (page === "productos") {
      selectCategory("");
      return;
    }

    setActivePage(page);
  };

  const handleLogout = async () => {
    if (logoutLock.current) return;

    logoutLock.current = true;
    setLoggingOut(true);
    setLogoutError("");

    try {
      const result = await logout();

      if (!result.ok) {
        setLogoutError(
          result.error || "No se pudo cerrar la sesión."
        );
        return;
      }

      navigate("/login", { replace: true });
    } catch {
      setLogoutError(
        "No se pudo cerrar la sesión. Inténtalo nuevamente."
      );
    } finally {
      logoutLock.current = false;
      setLoggingOut(false);
    }
  };

  const navigationStyle = (isActive) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "11px 12px",
    borderRadius: 8,
    border: "none",
    background: isActive ? "#FFFFFF" : "transparent",
    color: isActive ? "#E71950" : "#FFFFFF",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 13,
    fontWeight: isActive ? 650 : 500,
    cursor: "pointer",
    transition: "background 0.2s ease",
    textAlign: "left",
  });

  const categoryStyle = (isSelected) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "none",
    background: isSelected
      ? "rgba(255, 255, 255, 0.96)"
      : "transparent",
    color: isSelected ? "#D51C48" : "#FFFFFF",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 12,
    fontWeight: isSelected ? 600 : 400,
    cursor: "pointer",
    textAlign: "left",
  });

  const countStyle = {
    minWidth: 23,
    padding: "2px 5px",
    borderRadius: 4,
    background: "rgba(255, 255, 255, 0.15)",
    fontSize: 10,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <>
      <aside
        className="inventory-sidebar"
        style={{
          width: 220,
          background: "#E71950",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          padding: "22px 12px 16px",
          flexShrink: 0,
          minHeight: 0,
          boxSizing: "border-box",
        }}
      >
        {/* Logo y nombre */}
        <div
          className="sidebar-brand"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "0 5px 26px",
            flexShrink: 0,
          }}
        >
          <img
            src="/logo-Eagle.png"
            alt="Logo de Eagle Gaming"
            style={{
              width: 42,
              height: 42,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />

          <div>
            <h2
              style={{
                margin: 0,
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: 18,
                fontWeight: 800,
                lineHeight: 1.3,
                color: "#FFFFFF",
                letterSpacing: "-0.4px",
              }}
            >
              Eagle Gaming
            </h2>

            <span
              style={{
                display: "block",
                marginTop: 3,
                fontSize: 10,
                color: "rgba(255, 255, 255, 0.85)",
              }}
            >
              Inventario inteligente
            </span>
          </div>
        </div>

        {/* Navegación */}
        <nav
          aria-label="Navegación principal"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            paddingBottom: 16,
            scrollbarWidth: "thin",
          }}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;

            if (item.id === "productos") {
              return (
                <div key={item.id}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      borderRadius: 8,
                      background: isActive
                        ? "#FFFFFF"
                        : "transparent",
                      color: isActive ? "#E71950" : "#FFFFFF",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleNavigation("productos")}
                      aria-current={isActive ? "page" : undefined}
                      style={{
                        ...navigationStyle(isActive),
                        flex: 1,
                        width: "auto",
                        background: "transparent",
                      }}
                    >
                      <Boxes size={17} />
                      <span className="sidebar-label">
                        Inventario
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-label={
                        inventoryOpen
                          ? "Cerrar categorías"
                          : "Abrir categorías"
                      }
                      aria-expanded={inventoryOpen}
                      aria-controls="sidebar-inventory-categories"
                      onClick={() =>
                        setInventoryOpen((previous) => !previous)
                      }
                      style={{
                        display: "grid",
                        placeItems: "center",
                        width: 36,
                        height: 38,
                        padding: 0,
                        border: "none",
                        borderRadius: 7,
                        background: "transparent",
                        color: "inherit",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <ChevronDown
                        size={17}
                        style={{
                          transform: inventoryOpen
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                          transition: "transform 0.2s ease",
                        }}
                      />
                    </button>
                  </div>

                  {inventoryOpen && (
                    <div
                      id="sidebar-inventory-categories"
                      role="group"
                      aria-label="Categorías del inventario"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        margin: "8px 4px 10px 20px",
                        paddingLeft: 10,
                        borderLeft:
                          "1px solid rgba(255, 255, 255, 0.3)",
                        maxHeight: 300,
                        overflowY: "auto",
                        scrollbarWidth: "thin",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => selectCategory("")}
                        aria-current={
                          inventoryActive && !selectedCategory
                            ? "true"
                            : undefined
                        }
                        style={categoryStyle(
                          inventoryActive && !selectedCategory
                        )}
                      >
                        <span>Todos los productos</span>
                        <span style={countStyle}>
                          {products.length}
                        </span>
                      </button>

                      {categoryItems.map((category) => {
                        const isSelected =
                          inventoryActive &&
                          selectedCategory === category.name;

                        return (
                          <button
                            key={category.name}
                            type="button"
                            onClick={() =>
                              selectCategory(category.name)
                            }
                            aria-current={
                              isSelected ? "true" : undefined
                            }
                            style={categoryStyle(isSelected)}
                          >
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflowWrap: "anywhere",
                              }}
                            >
                              {category.name}
                            </span>

                            <span style={countStyle}>
                              {category.count}
                            </span>
                          </button>
                        );
                      })}

                      {categoryItems.length === 0 && (
                        <span
                          style={{
                            padding: "8px 10px",
                            fontSize: 11,
                            color: "rgba(255, 255, 255, 0.75)",
                          }}
                        >
                          No hay categorías cargadas.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => handleNavigation(item.id)}
                style={navigationStyle(isActive)}
              >
                <Icon size={17} />
                <span className="sidebar-label">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Cerrar sesión */}
        <div
          className="sidebar-footer"
          style={{
            borderTop: "1px solid rgba(255, 255, 255, 0.25)",
            paddingTop: 12,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            disabled={loggingOut}
            aria-busy={loggingOut}
            aria-haspopup="dialog"
            aria-expanded={showLogoutDialog}
            aria-controls={
              showLogoutDialog ? "logout-dialog" : undefined
            }
            onClick={() => {
              setLogoutError("");
              setShowLogoutDialog(true);
            }}
            style={{
              ...navigationStyle(false),
              opacity: loggingOut ? 0.6 : 1,
              cursor: loggingOut ? "wait" : "pointer",
            }}
          >
            <LogOut size={17} />
            <span className="sidebar-label">
              {loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}
            </span>
          </button>
        </div>
      </aside>

      {showLogoutDialog && (
        <LogoutDialog
          onDismiss={() => {
            if (!logoutLock.current) {
              setShowLogoutDialog(false);
            }
          }}
          onConfirm={handleLogout}
          busy={loggingOut}
          error={logoutError}
        />
      )}
    </>
  );
}