import { catalogAvailability } from '../../../../../../shared/catalogProduct.js';
import styles from './ProductCatalog.module.css';

const currency = value => value == null ? 'No registrado' : new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);
const date = value => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value)) : 'No registrado';
function Item({ label, children }) { return <div><dt>{label}</dt><dd>{children == null || children === '' ? 'No registrado' : children}</dd></div>; }

// Recibe un DTO autorizado, sin lecturas propias ni cambios sobre el estado compartido.
export default function ProductDetails({ product }) {
  if (!product) return <section className={styles.panel}><h2>Producto no disponible</h2><p>Selecciona un producto del catálogo.</p></section>;
  return <article className={`${styles.panel} ${styles.productDetails}`}>
    <header><p className={styles.eyebrow}>FICHA DE PRODUCTO</p><h2>{product.name}</h2></header>
    <section><h3>Datos del producto</h3><dl className={styles.grid}>
      <Item label="SKU">{product.sku}</Item><Item label="Categoría">{product.category}</Item>
      {product.brand && <Item label="Marca">{product.brand}</Item>}{product.model && <Item label="Modelo">{product.model}</Item>}
      <Item label="Estado administrativo">{product.isActive === false ? 'Inactivo' : product.isActive === true ? 'Activo' : 'No disponible'}</Item>
    </dl></section>
    <section><h3>Características</h3><p className={product.characteristics ? styles.description : undefined}>{product.characteristics || 'Características no registradas.'}</p></section>
    <section><h3>Precio y existencias</h3><dl className={styles.grid}>
      <Item label="Precio de venta">{currency(product.price)}</Item>
      <Item label="Stock actual">{product.stock}</Item><Item label="Stock mínimo">{product.minStock}</Item>
      <Item label="Disponibilidad">{product.stock == null ? 'No registrado' : catalogAvailability(product)}</Item></dl></section>
    <section><h3>Información del registro</h3><dl className={styles.grid}>
      <Item label="Fecha de creación (Perú)">{date(product.createdAt)}</Item>
      <Item label="Última actualización (Perú)">{date(product.updatedAt)}</Item>
      <Item label="Registrado por">{product.createdByName || product.createdByEmail || product.created_by_name || product.created_by_email || 'No registrado'}</Item>
    </dl></section>
  </article>;
}
