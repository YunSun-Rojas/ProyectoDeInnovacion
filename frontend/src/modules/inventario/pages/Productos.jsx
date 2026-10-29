import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import SaleDialog from "../components/SaleDialog";
import ProductDetailsDialog from "../components/catalog/ProductDetailsDialog";
import ProductForm from "../components/catalog/ProductForm";
import catalogStyles from "../components/catalog/ProductCatalog.module.css";
import ui from './InventoryUI.module.css';

import {
  Search,
  Eye,
  Plus,
  Pencil,
  Trash2,
  X,
  Package,
  Boxes,
  AlertTriangle,
  CircleDollarSign,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ─── Utilidades ─────────────────────────────────────────────

const numeric = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const money = (value) =>
  new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
  }).format(numeric(value));

const integer = (value) =>
  new Intl.NumberFormat("es-PE").format(numeric(value));

const minimum = (product, fallback = 5) =>
  Math.max(0, numeric(product.minStock ?? fallback));

function stockStatus(product, fallback = 5) {
  const stock = numeric(product.stock);

  if (stock <= 0) return "sin-stock";
  if (stock <= minimum(product, fallback)) return "bajo";
  return "normal";
}

const STATUS_LABELS = {
  "sin-stock": "Sin stock",
  bajo: "Stock bajo",
  normal: "Disponible",
};

function matchesStockFilter(product, filter, fallback) {
  const state = stockStatus(product, fallback);
  if (["sin-stock", "bajo", "normal"].includes(filter)) return state === filter;
  if (filter === "alertas") return state !== "normal";
  if (filter === "disponible") return numeric(product.stock) > 0;
  if (filter === "vendidos") return numeric(product.unitsSoldThisMonth) > 0;
  return true;
}

function recentlyAdded(a, b) {
  const left = Date.parse(a.createdAt), right = Date.parse(b.createdAt);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
  if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
  return String(b.id ?? '').localeCompare(String(a.id ?? ''), 'es', { numeric: true })
    || String(a.sku ?? '').localeCompare(String(b.sku ?? ''), 'es');
}

function summarize(products, fallback = 5) {
  return products.reduce(
    (result, product) => ({
      products: result.products + 1,
      units: result.units + numeric(product.stock),
      value:
        result.value + numeric(product.stock) * numeric(product.price),
      low:
        result.low + (numeric(product.stock) > 0 && numeric(product.stock) <= minimum(product, fallback) ? 1 : 0),
    }),
    { products: 0, units: 0, value: 0, low: 0 }
  );
}

function defaultAuthor(product) {
  return (
    product.createdByName ||
    product.createdByEmail ||
    product.created_by_name ||
    product.created_by_email ||
    "No registrado"
  );
}

function csvCell(value) {
  let text = String(value ?? "");

  // Evita interpretar valores de texto como fórmulas.
  if (/^[\s]*[=+@-]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}


const STYLES = `
.inv-page {
  --inv-bg: var(--inventory-bg, #f5f6f8);
  --inv-card: var(--inventory-surface, #fff);
  --inv-ink: var(--inventory-ink, #182230);
  --inv-muted: var(--inventory-muted, #667085);
  --inv-border: var(--inventory-border, #e5e7eb);
  box-sizing: border-box;
  min-height: 100%;
  padding: 24px 28px 32px;
  background: var(--inv-bg);
  color: var(--inv-ink);
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
}

.inv-page *, .inv-dialog * { box-sizing: border-box; }

.inv-page button, .inv-page input, .inv-page select,
.inv-dialog button, .inv-dialog input, .inv-dialog select {
  font: inherit;
}

.inv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 22px;
}

.inv-eyebrow {
  color: var(--inventory-muted, #667085);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.3px;
}

.inv-header h1 {
  margin: 5px 0 7px;
  font-size: 27px;
  font-weight: 750;
  letter-spacing: -.8px;
  line-height: 1.25;
}

.inv-header p {
  margin: 0;
  font-size: 12px;
  color: var(--inv-muted);
}

.inv-actions { display: flex; gap: 8px; }

.inv-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 9px 12px;
  border: 1px solid var(--inventory-border, #e5e7eb);
  border-radius: 7px;
  background: var(--inventory-surface, #fff);
  color: var(--inventory-ink, #182230);
  font-size: 12px !important;
  font-weight: 600 !important;
  cursor: pointer;
}

.inv-button:hover:not(:disabled) {
  border-color: #b4bac3;
  background: var(--inventory-bg, #f5f6f8);
}

.inv-primary {
  background: #e32636;
  border-color: #e32636;
  color: #fff;
}

.inv-primary:hover:not(:disabled) {
  background: #c91e2d;
  border-color: #c91e2d;
}

.inv-page button:disabled, .inv-dialog button:disabled {
  opacity: .45;
  cursor: not-allowed;
}

.inv-page :focus-visible, .inv-dialog :focus-visible {
  outline: 3px solid #f19aa2;
  outline-offset: 2px;
}

.inv-summary { margin-bottom: 20px; }

.inv-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.inv-section-heading h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}

.inv-section-heading > span {
  color: var(--inv-muted);
  font-size: 11px;
}

.inv-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.inv-stat {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 142px;
  padding: 20px;
  background: var(--inv-card);
  border: 1px solid var(--inv-border);
  border-radius: 10px;
}

.inv-stat > div:first-child {
  flex: 1;
  min-width: 0;
}

.inv-stat > div:first-child > span {
  display: block;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .35px;
  text-transform: uppercase;
  color: var(--inv-muted);
}

.inv-stat strong {
  display: block;
  margin: 23px 0 4px;
  font-size: 24px;
  letter-spacing: -.5px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.inv-stat small { font-size: 10px; color: var(--inv-muted); }

.inv-stat-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--inventory-accent-tint, #fff0f1);
  color: #e32636;
}

.inv-value-note {
  margin: 8px 0 0;
  font-size: 10px;
  color: var(--inv-muted);
}

.inv-panel {
  overflow: hidden;
  border: 1px solid var(--inv-border);
  border-radius: 10px;
  background: var(--inv-card);
}

.inv-toolbar {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px;
}

.inv-search {
  display: flex;
  align-items: center;
  flex: 1 1 230px;
  gap: 8px;
  height: 37px;
  padding: 0 10px;
  border: 1px solid var(--inv-border);
  border-radius: 7px;
  color: var(--inv-muted);
}

.inv-search input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--inv-ink);
  font-size: 11px;
}

.inv-search:focus-within {
  outline: 2px solid #f19aa2;
  outline-offset: 1px;
}

.inv-search button {
  display: flex;
  padding: 3px;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}

.inv-select {
  display: flex;
  flex-direction: column;
  flex: 0 1 180px;
  gap: 5px;
  color: var(--inv-muted);
  font-size: 10px;
  font-weight: 600;
}

.inv-select select {
  width: 100%;
  height: 37px;
  padding: 0 9px;
  border: 1px solid var(--inv-border);
  border-radius: 7px;
  background: var(--inv-card);
  color: var(--inv-ink);
  font-size: 12px;
}

.inv-results {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 0 16px 13px;
  font-size: 11px;
  color: var(--inv-muted);
}

.inv-results strong { color: var(--inv-ink); }

.inv-results button {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: none;
  color: #d72333;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.inv-table-scroll { overflow-x: auto; }

.inv-table {
  width: 100%;
  min-width: 950px;
  border-collapse: collapse;
}

.inv-table th {
  padding: 12px 14px;
  border-top: 1px solid var(--inv-border);
  border-bottom: 1px solid var(--inv-border);
  background: var(--inv-bg);
  color: var(--inv-muted);
  font-size: 10px;
  font-weight: 650;
  text-align: left;
  white-space: nowrap;
}

.inv-table td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--inv-border);
  font-size: 12px;
  vertical-align: middle;
}

.inv-table tbody tr:hover {
  background: var(--inventory-bg, #fafbfc);
}

.inv-table tbody tr:last-child td { border-bottom: 0; }

.inv-product-name {
  display: block;
  max-width: 330px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
}

.inv-sku {
  display: block;
  margin-top: 3px;
  color: var(--inv-muted);
  font-size: 10px;
  font-weight: 400;
}

.inv-table .inv-number {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.inv-nowrap { white-space: nowrap; }

.inv-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.inv-badge i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
}

.inv-normal {
  background: var(--inventory-success-tint, #eaf6ef);
  color: var(--inventory-success, #16704a);
}

.inv-bajo {
  background: var(--inventory-warning-tint, #fff4df);
  color: var(--inventory-warning, #9c6509);
}

.inv-sin-stock {
  background: var(--inventory-accent-tint, #ffedef);
  color: var(--inventory-danger, #b42335);
}

.inv-author {
  display: block;
  max-width: 145px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--inv-muted);
  font-size: 11px;
}

.inv-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.inv-row-actions button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--inv-muted);
  cursor: pointer;
}

.inv-row-actions button:hover:not(:disabled) {
  border-color: var(--inv-border);
  background: var(--inv-card);
}

.inv-row-actions .inv-delete { color: #ba2536; }

.inv-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--inv-border);
  font-size: 11px;
  color: var(--inv-muted);
}

.inv-pagination > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.inv-pagination label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-right: 8px;
}

.inv-pagination select {
  padding: 5px;
  border: 1px solid var(--inv-border);
  border-radius: 5px;
  background: var(--inv-card);
  color: var(--inv-ink);
}

.inv-icon { width: 34px; min-height: 32px; padding: 6px; }

.inv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 16px;
  color: var(--inv-muted);
}

.inv-empty strong { color: var(--inv-ink); }

.inv-error {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border: 1px solid #f4c8ce;
  border-radius: 7px;
  background: var(--inventory-accent-tint, #fff1f2);
  color: var(--inventory-danger, #b42335);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.inv-error button { display: flex; margin-top: 8px; }

.inv-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 24, 40, .48);
}

.inv-dialog {
  width: 480px;
  max-width: 100%;
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  border-radius: 12px;
  outline: none;
  background: var(--inventory-surface, #fff);
  color: var(--inventory-ink, #182230);
  box-shadow: 0 20px 60px #0003;
  font-family: Inter, system-ui, sans-serif;
}

.inv-dialog > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--inventory-border, #e5e7eb);
}

.inv-dialog h2 {
  margin: 4px 0 0;
  font-size: 20px;
  letter-spacing: -.4px;
}

.inv-dialog form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 22px;
}

.inv-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
}

.inv-field input, .inv-field select {
  width: 100%;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--inventory-border, #d9dde4);
  border-radius: 7px;
  background: var(--inventory-surface, #fff);
  color: var(--inventory-ink, #182230);
  font-size: 12px;
}

.inv-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.inv-registration {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--inventory-border, #e5e7eb);
  border-radius: 7px;
  background: var(--inventory-bg, #f8f9fb);
  color: var(--inventory-muted, #667085);
}

.inv-registration small {
  display: block;
  margin-bottom: 3px;
  font-size: 10px;
}

.inv-registration strong {
  display: block;
  color: var(--inventory-ink, #182230);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.inv-form-note {
  margin: 0;
  color: var(--inventory-muted, #667085);
  font-size: 10px;
  line-height: 1.5;
}

.inv-dialog .inv-error { margin: 0; }

.inv-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--inventory-border, #e5e7eb);
}

@media (max-width: 1000px) {
  .inv-page { padding: 20px; }
  .inv-select { flex: 1 1 150px; }
  .inv-search { flex-basis: 100%; }
  .inv-stat { min-height: 125px; padding: 14px; }
  .inv-stat strong { margin-top: 20px; font-size: 20px; }
  .inv-stat-icon { width: 32px; height: 32px; }
}

@media (max-width: 600px) {
  .inv-page { padding: 16px 12px; }
  .inv-summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .inv-stat { min-height: 112px; gap: 4px; padding: 9px 7px; }
  .inv-stat > div:first-child > span { font-size: 8px; letter-spacing: 0; }
  .inv-stat strong { margin-top: 17px; font-size: 14px; letter-spacing: -.3px; }
  .inv-stat small { font-size: 8px; }
  .inv-stat-icon { width: 24px; height: 24px; border-radius: 7px; }
  .inv-stat-icon svg { width: 14px; height: 14px; }
  .inv-header h1 { font-size: 24px; }
  .inv-actions { width: 100%; }
  .inv-actions > button { flex: 1; }
  .inv-pagination > div { gap: 7px; }
  .inv-overlay { padding: 12px; }
  .inv-dialog { max-height: calc(100dvh - 24px); }
  .inv-dialog form { padding: 16px; }
  .inv-form-grid { grid-template-columns: 1fr; }
}
`;

// ─── Vista de inventario ────────────────────────────────────

export default function Productos({
  products = [],
  categories = [],
  onAdd,
  onEdit,
  onDelete,
  onSale,
  readOnly = true,
  saving = false,
  writeError = "",
  uncertain = false,
  retryWrite,
  defaultMinStock = 5,
  notify = () => {},
  currentUser = null,
  getCreatedBy = defaultAuthor,
  getConfirmedChange,
}) {
  const [params, setParams] = useSearchParams();

  const query = params.get("q") || "";
  const category = params.get("categoria") || "Todas";
  const status = params.get("estado") || "";

  const [sort, setSort] = useState("recent");
  const [createdProduct, setCreatedProduct] = useState(null);
  const creationDraft = useRef(null);
  const [pageSize, setPageSize] = useState(15);
  const [modal, setModal] = useState(() => params.get("accion") === "nuevo" && !readOnly ? { product: null, trigger: null } : null);
  const [saleOpen, setSaleOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [deletion, setDeletion] = useState(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");

  const busyRef = useRef(false);
  const newButton = useRef(null);

  const busy = saving || pending;

  useEffect(() => {
    if (((modal && !modal.closing) || (deletion && !deletion.closing)) && !busy && (writeError || actionError)) {
      notify(writeError || actionError, 'error');
    }
  }, [modal, deletion, busy, writeError, actionError, notify]);

  const canCreate =
    !readOnly && !busy && !uncertain && typeof onAdd === "function";

  const canEdit =
    !readOnly && !busy && !uncertain && typeof onEdit === "function";

  const canDelete =
    !readOnly && !busy && !uncertain && typeof onDelete === "function";

  const categoryNames = useMemo(() => {
    const names = [
      ...categories.map((item) =>
        typeof item === "string" ? item : item.name
      ),
      ...products.map((item) => item.category),
    ];

    return [...new Set(names.filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "es")
    );
  }, [categories, products]);

  const summary = useMemo(() => summarize(products, defaultMinStock), [products, defaultMinStock]);

  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("es");

    const result = products.filter((product) => {
      const matchesQuery = [product.name, product.sku].some((value) =>
        String(value ?? "").toLocaleLowerCase("es").includes(text)
      );

      const matchesCategory =
        category === "Todas" || product.category === category;

      const matchesStatus = matchesStockFilter(product, status, defaultMinStock);

      return matchesQuery && matchesCategory && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sort === "recent") {
        const isCreated = item => createdProduct && (createdProduct.id != null ? String(item.id) === String(createdProduct.id) : item.sku === createdProduct.sku);
        if (Boolean(isCreated(a)) !== Boolean(isCreated(b))) return isCreated(a) ? -1 : 1;
        return recentlyAdded(a, b);
      }
      if (sort === "stock-asc") {
        return numeric(a.stock) - numeric(b.stock);
      }

      if (sort === "stock-desc") {
        return numeric(b.stock) - numeric(a.stock);
      }

      if (sort === "value-desc") {
        return (
          numeric(b.stock) * numeric(b.price) -
          numeric(a.stock) * numeric(a.price)
        );
      }

      return String(a.name ?? "").localeCompare(
        String(b.name ?? ""),
        "es"
      );
    });
  }, [products, query, category, status, defaultMinStock, sort, createdProduct]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const requestedPage = Number(params.get("pagina") || 1);

  const page = Math.min(
    pages,
    Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1)
  );

  const rows = filtered.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const filteredSummary = useMemo(
    () => summarize(filtered),
    [filtered]
  );

  const hasFilters = Boolean(
    query || category !== "Todas" || status
  );

  function setFilter(key, value) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);

        if (value) next.set(key, value);
        else next.delete(key);

        if (key !== "pagina") next.delete("pagina");

        return next;
      },
      { replace: true }
    );
  }

  function clearFilters() {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);

        ["q", "categoria", "estado", "pagina"].forEach((key) =>
          next.delete(key)
        );

        return next;
      },
      { replace: true }
    );
  }

  function openModal(product, event) {
    setActionError("");

    setModal({
      product,
      trigger: event?.currentTarget || newButton.current,
    });
  }

  function clearCreateAction() {
    if (params.get("accion") === "nuevo") {
      setParams(previous => { const next = new URLSearchParams(previous); next.delete("accion"); return next; }, { replace: true });
    }
  }

  function closeModal() {
    if (busyRef.current || saving || uncertain) return;

    setModal(previous => previous ? { ...previous, closing: true } : null);
  }

  function finishCloseModal() {
    const trigger = modal?.trigger || newButton.current;
    setModal(null);
    clearCreateAction();

    requestAnimationFrame(() => trigger?.focus());
  }

  async function runWrite(action, message, close = false) {
    if (busyRef.current || saving) return false;

    busyRef.current = true;
    setPending(true);
    setActionError("");

    try {
      const result = await action();

      // Conserva el contrato de tus callbacks originales.
      if (result) {
        if (close === true && modal && !modal.product) {
          const receipt = getConfirmedChange?.();
          const created = receipt?.action === 'add' && receipt.product ? receipt.product : creationDraft.current;
          setCreatedProduct(created);
          setSort('recent');
          setParams(previous => {
            const next = new URLSearchParams(previous);
            next.delete('pagina');
            if (!created || ![created.name, created.sku].some(value => String(value ?? '').toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')))) next.delete('q');
            if (!created || (category !== 'Todas' && created.category !== category)) next.delete('categoria');
            if (!created || !matchesStockFilter(created, status, defaultMinStock)) next.delete('estado');
            return next;
          }, { replace: true });
        }
        if (close === 'delete') {
          setDeletion(previous => previous ? { ...previous, closing: true } : null);
        } else if (close) {
          setModal(previous => previous ? { ...previous, closing: true } : null);
        }

        notify(message);
        return true;
      }

      setActionError(
        "La operación no se confirmó. Revisa el mensaje del servidor."
      );

      return false;
    } catch (error) {
      setActionError(
        error?.message || "No se pudo completar la operación."
      );

      return false;
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  }

  function exportCsv() {
    const headers = [
      "Producto",
      "SKU",
      "Categoría",
      "Stock",
      "Stock mínimo",
      "Precio unitario PEN",
      "Valorizado a precio registrado PEN",
      "Estado",
      "Registrado por",
    ];

    const lines = filtered.map((product) => [
      product.name,
      product.sku,
      product.category,
      numeric(product.stock),
      minimum(product, defaultMinStock),
      numeric(product.price).toFixed(2),
      (numeric(product.stock) * numeric(product.price)).toFixed(2),
      STATUS_LABELS[stockStatus(product, defaultMinStock)],
      getCreatedBy(product),
    ]);

    const content =
      "\uFEFF" +
      [headers, ...lines]
        .map((line) => line.map(csvCell).join(";"))
        .join("\r\n");

    const blob = new Blob([content], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `inventario-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const cards = [
    {
      title: "Productos registrados",
      value: integer(summary.products),
      detail: "Referencias / SKU",
      icon: Package,
    },
    {
      title: "Unidades totales",
      value: integer(summary.units),
      detail: "Suma del stock registrado",
      icon: Boxes,
    },
    {
      title: "Stock bajo",
      value: integer(summary.low),
      detail: "Productos bajo su mínimo",
      icon: AlertTriangle,
    },
    {
      title: "Valorizado",
      value: money(summary.value),
      detail: "Stock × precio unitario",
      icon: CircleDollarSign,
    },
  ];

  return (
    <main className={`inv-page ${ui.workspace} ${ui.productsPage}`}>
      <style>{STYLES}</style>
      <header className="inv-header">
        <div>
          <h1>Catálogo de productos</h1>
        </div>

        <div className="inv-actions">
          <button
            type="button"
            className="inv-button"
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            <Download size={16} />
            Exportar CSV
          </button>

          <button
            ref={newButton}
            type="button"
            className="inv-button inv-primary"
            disabled={!canCreate}
            onClick={(event) => openModal(null, event)}
          >
            <Plus size={17} />
            Nuevo producto
          </button>
        </div>
      </header>

      <section
        className="inv-summary"
        aria-label="Resumen de productos"
      >

        <div className="inv-summary-grid">
          {cards.map(({ title, value, detail, icon: Icon }) => (
            <article className="inv-stat" key={title}>
              <div>
                <span>{title}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>

              <div className="inv-stat-icon">
                <Icon size={20} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="inv-panel" aria-label="Listado de productos">
        <div className={`inv-toolbar ${ui.productFilters}`}>
          <div className="inv-search">
            <Search size={17} aria-hidden="true" />
            
            <input
              aria-label="Buscar producto por nombre o SKU"
              placeholder="Buscar producto o SKU…"
              value={query}
              onChange={(event) => setFilter("q", event.target.value)}
            />

            {query && (
              <button
                type="button"
                aria-label="Borrar búsqueda"
                onClick={() => setFilter("q", "")}
              >
                <X size={15} />
              </button>
            )}
          </div>

          <label className="inv-select">
            <span>Categoría</span>
            <select
              value={category}
              onChange={(event) =>
                setFilter(
                  "categoria",
                  event.target.value === "Todas"
                    ? ""
                    : event.target.value
                )
              }
            >
              <option value="Todas">Todas las categorías</option>

              {!categoryNames.includes(category) &&
                category !== "Todas" && (
                  <option value={category}>{category}</option>
                )}

              {categoryNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="inv-select">
            <span>Stock</span>
            <select
              value={status}
              onChange={(event) =>
                setFilter("estado", event.target.value)
              }
            >
              <option value="">Todos los estados</option>
              <option value="disponible">Con stock</option>
              <option value="sin-stock">Sin stock</option>
              <option value="bajo">Stock bajo</option>
              <option value="normal">Sobre el mínimo</option>
              <option value="alertas">Bajo o agotado</option>
              <option value="vendidos">Con ventas este mes</option>
            </select>
          </label>

          <label className="inv-select">
            <span>Ordenar por</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setFilter("pagina", "");
              }}
            >
              <option value="recent">Agregados recientemente</option>
              <option value="name">Nombre A–Z</option>
              <option value="stock-asc">Menor stock</option>
              <option value="stock-desc">Mayor stock</option>
              <option value="value-desc">Mayor valorización</option>
            </select>
          </label>
        </div>

        <div className="inv-results" aria-live="polite">
          <span>
            <strong>{integer(filtered.length)}</strong> productos
            {category !== "Todas" && ` · ${category}`}

            {hasFilters && (
              <>
                {" · "}
                {integer(filteredSummary.units)} unidades
                {" · "}
                {money(filteredSummary.value)}
              </>
            )}
          </span>

          {hasFilters && (
            <button type="button" onClick={clearFilters}>
              <X size={14} />
              Limpiar filtros
            </button>
          )}
        </div>

        {!modal && !deletion && (writeError || actionError) && (
          <div role="alert" className="inv-error">
            {writeError || actionError}

            {uncertain &&
              typeof retryWrite === "function" &&
              !modal && (
                <button
                  type="button"
                  className="inv-button"
                  disabled={busy}
                  onClick={() =>
                    runWrite(retryWrite, "Operación confirmada.")
                  }
                >
                  Verificar / reintentar operación
                </button>
              )}
          </div>
        )}

        <p className={ui.tableHint}>Desliza la tabla para consultar todas las columnas.</p>
        <div className="inv-table-scroll" role="region" aria-label="Tabla de productos" tabIndex={0}>
          <table className="inv-table">
            <thead>
              <tr>
                <th scope="col">Producto / SKU</th>
                <th scope="col">Categoría</th>
                <th scope="col" className="inv-number">Stock</th>
                <th scope="col" className="inv-number">Precio unit.</th>
                <th scope="col" className="inv-number">Valorizado</th>
                <th scope="col">Estado</th>
                <th scope="col" className="inv-number">Acciones</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((product) => {
                const state = stockStatus(product, defaultMinStock);

                return (
                  <tr key={product.id}>
                    <td>
                      <strong className="inv-product-name">
                        {product.name}
                      </strong>
                      <small className="inv-sku">{product.sku}</small>
                    </td>

                    <td>{product.category}</td>

                    <td className="inv-number">
                      <strong>{integer(product.stock)}</strong>
                      <small className="inv-sku">
                        Mín. {integer(minimum(product, defaultMinStock))}
                      </small>
                    </td>

                    <td className="inv-number inv-nowrap">
                      {money(product.price)}
                    </td>

                    <td className="inv-number inv-nowrap">
                      {money(
                        numeric(product.stock) * numeric(product.price)
                      )}
                    </td>

                    <td>
                      <span className={`inv-badge inv-${state}`}>
                        <i aria-hidden="true" />
                        {STATUS_LABELS[state]}
                      </span>
                    </td>

                    <td className="inv-number">
                      <div className="inv-row-actions">
                        <button type="button" aria-label={`Ver ficha de ${product.name}`} title="Ver ficha del producto"
                          onClick={() => setDetailId(product.id)}>
                          <Eye size={15} />
                        </button>
                        <button
                          type="button"
                          disabled={!canEdit}
                          aria-label={`Editar ${product.name}`}
                          title="Editar producto"
                          onClick={(event) => openModal(product, event)}
                        >
                          <Pencil size={15} />
                        </button>

                        <button
                          type="button"
                          disabled={!canDelete}
                          className="inv-delete"
                          aria-label={`Eliminar ${product.name}`}
                          title="Eliminar producto"
                          onClick={event => { setActionError(''); setDeletion({ product, trigger: event.currentTarget }); }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="inv-empty">
                      <Package size={28} />
                      <strong>
                        {products.length
                          ? "No encontramos productos"
                          : "Todavía no hay productos"}
                      </strong>
                      <span>
                        {products.length
                          ? "Prueba otra búsqueda o limpia los filtros."
                          : "Registra tu primer producto para comenzar."}
                      </span>

                      {hasFilters && (
                        <button
                          type="button"
                          className="inv-button"
                          onClick={clearFilters}
                        >
                          Limpiar filtros
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="inv-pagination">
          <span>
            {filtered.length
              ? `${(page - 1) * pageSize + 1}–${Math.min(
                  page * pageSize,
                  filtered.length
                )}`
              : "0"}
            {" de "}
            {integer(filtered.length)} productos
          </span>

          <div>
            <label>
              Filas
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setFilter("pagina", "");
                }}
              >
                {[15, 30, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="inv-button"
              aria-label="Página anterior"
              disabled={page === 1}
              onClick={() => setFilter("pagina", String(page - 1))}
            >
              <ChevronLeft size={16} aria-hidden="true" /> Anterior
            </button>

            <span aria-live="polite">Página {page} de {pages}</span>

            <button
              type="button"
              className="inv-button"
              aria-label="Página siguiente"
              disabled={page === pages}
              onClick={() => setFilter("pagina", String(page + 1))}
            >
              Siguiente <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </footer>
      </section>

      {saleOpen && <SaleDialog className={ui.compactDialog} products={products} saving={saving} uncertain={uncertain} error={writeError}
        onSave={onSale} onRetry={retryWrite} onClose={() => setSaleOpen(false)}
        onSuccess={() => { setSaleOpen(false); notify('Venta registrada. El precio aplicado queda guardado en el historial.'); }} />}

      {detailId !== null && <ProductDetailsDialog product={products.find(product => product.id === detailId)}
        onClose={() => setDetailId(null)} />}

      {deletion && <DeleteProductDialog product={deletion.product} busy={busy} uncertain={uncertain}
        closing={Boolean(deletion.closing)} error={writeError || actionError}
        onDismiss={() => { if (!busyRef.current && !saving && !uncertain) setDeletion(previous => ({ ...previous, closing: true })); }}
        onClosed={() => {
          const trigger = deletion.trigger?.isConnected ? deletion.trigger : newButton.current;
          setDeletion(null); requestAnimationFrame(() => trigger?.focus());
        }}
        onConfirm={() => runWrite(() => onDelete(deletion.product), 'Producto eliminado con éxito', 'delete')}
        onRetry={typeof retryWrite === 'function' ? () => runWrite(retryWrite, 'Producto eliminado con éxito', 'delete') : null} />}

      {modal && !readOnly && (
        <ProductModal
          product={modal.product}
          categories={categoryNames}
          products={products}
          defaultMinStock={defaultMinStock}
          currentUser={currentUser}
          getCreatedBy={getCreatedBy}
          busy={busy || modal.closing}
          closing={Boolean(modal.closing)}
          uncertain={uncertain}
          error={writeError || actionError}
          onClose={closeModal}
          onClosed={finishCloseModal}
          onRetry={
            typeof retryWrite === "function"
              ? () =>
                  runWrite(
                    retryWrite,
                    modal.product ? "Producto actualizado correctamente." : "El producto fue creado con éxito",
                    true
                  )
              : null
          }
          onSave={(data) => {
            if (!modal.product) creationDraft.current = data;
            return runWrite(
              () =>
                modal.product
                  ? onEdit(modal.product, data)
                  : onAdd(data),
              modal.product
                ? "Producto actualizado correctamente."
                : "El producto fue creado con éxito",
              true
            );
          }}
        />
      )}
    </main>
  );
}

export function DeleteProductDialog({ product, busy, uncertain, closing, error, onConfirm, onRetry, onDismiss, onClosed }) {
  const dialog = useRef(null);
  const cancel = useRef(null);
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState('');
  const id = useId();
  const waiting = busy || pending;
  const disabled = waiting || uncertain || closing;
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    const overflow = document.body.style.overflow;
    element.showModal(); cancel.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClosed(); return; }
    const timer = window.setTimeout(onClosed, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);
  async function confirm(retry = false) {
    if (locked.current || waiting || closing || (uncertain && !retry)) return;
    locked.current = true; setPending(true); setLocalError('');
    try { await (retry ? onRetry() : onConfirm()); }
    catch (reason) { setLocalError(reason?.message || 'No se pudo confirmar la eliminación.'); }
    finally { locked.current = false; setPending(false); }
  }
  return <dialog ref={dialog} className={`${catalogStyles.dialog} ${catalogStyles.deleteDialog}${closing ? ` ${catalogStyles.formClosing}` : ''}`}
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-question ${id}-consequence`} aria-busy={Boolean(waiting)}
    onCancel={event => { event.preventDefault(); if (!disabled) onDismiss(); }}
    onClick={event => {
      if (event.target !== event.currentTarget || disabled) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss();
    }}
    onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClosed(); }}>
    <button type="button" className={catalogStyles.deleteClose} aria-label="Cerrar confirmación" disabled={disabled} onClick={onDismiss}><X size={18} aria-hidden="true" /></button>
    <div className={catalogStyles.deleteIcon}><Trash2 size={24} aria-hidden="true" /></div>
    <h2 id={`${id}-title`}>Eliminar producto</h2>
    <p id={`${id}-question`}>¿Estás seguro de que deseas eliminar el producto <strong>{product.name}</strong>?</p>
    <p id={`${id}-consequence`} className={catalogStyles.deleteHint}></p>
    {(error || localError) && <p role="alert" className={ui.alert}>{error || localError}</p>}
    {uncertain && <p className={catalogStyles.deleteHint}>Confirmación pendiente. Reintenta la misma operación para comprobarla sin duplicarla.</p>}
    <div className={catalogStyles.deleteActions}>
      <button ref={cancel} type="button" className={ui.secondary} disabled={disabled} onClick={onDismiss}>Cancelar</button>
      <button type="button" className={`${ui.primary} ${ui.savingButton}`} aria-busy={Boolean(waiting)} disabled={waiting || closing || (uncertain && !onRetry)}
        onClick={() => confirm(Boolean(uncertain))}>{waiting ? 'Eliminando…' : uncertain ? 'Reintentar eliminación' : 'Eliminar producto'}</button>
    </div>
  </dialog>;
}

// ─── Formulario de registro / edición ────────────────────────

function ProductModal({
  product,
  currentUser,
  categories,
  products,
  defaultMinStock,
  busy,
  uncertain,
  error,
  onClose,
  onSave,
  onRetry,
  closing,
  onClosed,
}) {
  const dialog = useRef(null);
  const disabled = busy || uncertain;

  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClosed(); return; }
    // Respaldo si el navegador desactiva las animaciones.
    const timer = window.setTimeout(onClosed, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;

    element.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;

      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={`${catalogStyles.dialog} ${catalogStyles.formDialog}${closing ? ` ${catalogStyles.formClosing}` : ''}`}
      onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClosed(); }}
      aria-label={product ? "Editar producto" : "Nuevo producto"}
      onCancel={(event) => {
        event.preventDefault();

        if (!disabled) {
          onClose();
        }
      }}
    >
      <div className={catalogStyles.dialogToolbar}>
        <button
          type="button"
          aria-label="Cerrar formulario"
          disabled={disabled}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      <ProductForm
        product={product}
        currentUser={currentUser}
        products={products}
        categories={categories}
        defaultMinStock={defaultMinStock}
        onSave={onSave}
        onRetry={onRetry}
        busy={busy}
        uncertain={uncertain}
        error={error}
      />
    </dialog>
  );
}
