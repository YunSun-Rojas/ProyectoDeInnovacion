import { ImageOff } from 'lucide-react';
import styles from './ProductCatalog.module.css';

// Storage pendiente: no interpreta image_path como URL pública ni permite cargas.
export default function ProductImage({ name = 'Producto' }) {
  return <div className={styles.image} role="img" aria-label={`${name}: fotografía no disponible`}>
    <ImageOff size={32} aria-hidden="true" />
    <span>Fotografía pendiente</span>
  </div>;
}
