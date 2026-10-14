import { catalogAvailability } from '../../../../../../shared/catalogProduct.js';
import ProductImage from './ProductImage';
import styles from './ProductCatalog.module.css';

const currency = value => value == null ? 'No registrado' : new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value);
const date = value => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value)) : 'No registrado';
function Item({ label, children }) { return <div><dt>{label}</dt><dd>{children ?? 'No registrado'}</dd></div>; }

// Recibe un DTO autorizado, sin lecturas propias ni cambios sobre el estado compartido.
export default function ProductDetails({ product, canReadPurchaseCost = false }) {
  if (!product) return <section className={styles.panel}><h2>Producto no disponible</h2><p>Selecciona un producto del catálogo.</p></section>;
  return <article className={styles.panel}>
    <header><p className={styles.eyebrow}>FICHA DE PRODUCTO</p><h2>{product.name}</h2><p>{product.sku} · {product.category}</p></header>
    <section><h3>Información general</h3><div className={styles.identity}><ProductImage name={product.name} />
      <dl className={styles.grid}><Item label="Marca">{product.brand}</Item><Item label="Modelo">{product.model}</Item>
        <Item label="Código de barras">{product.barcode}</Item><Item label="Estado administrativo">{product.isActive === false ? 'Inactivo' : product.isActive === true ? 'Activo' : 'No disponible'}</Item></dl></div>
      <p className={styles.description}>{product.characteristics || 'Características no registradas.'}</p></section>
    <section><h3>Información comercial</h3><dl className={styles.grid}>
      <Item label="Precio de venta">{currency(product.price)}</Item>
      {canReadPurchaseCost && <Item label="Costo de compra referencial">{currency(product.purchaseCost)}</Item>}
      <Item label="Unidad de medida">{product.unitOfMeasure || 'Unidad'}</Item></dl></section>
    <section><h3>Inventario</h3><dl className={styles.grid}>
      <Item label="Stock actual">{product.stock}</Item><Item label="Stock mínimo">{product.minStock}</Item>
      <Item label="Disponibilidad">{catalogAvailability(product)}</Item></dl>
      <p>Consulta de existencias. La ficha no modifica cantidades.</p></section>
    <details><summary>Información del registro</summary><dl className={styles.grid}>
      <Item label="ID interno">{product.id}</Item><Item label="Creado (Perú)">{date(product.createdAt)}</Item>
      <Item label="Actualizado (Perú)">{date(product.updatedAt)}</Item><Item label="Nombre registrado (no verificado)">{product.createdByName}</Item>
    </dl></details>
  </article>;
}
