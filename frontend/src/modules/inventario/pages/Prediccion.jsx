import { TrendingUp, AlertCircle } from "lucide-react";
import s from './Management.module.css';
import ui from './InventoryUI.module.css';
import styles from './Vision.module.css';

export default function Prediccion({ products = [] }) {
  return (
    <div className={`${s.page} ${ui.workspace} ${styles.workspace}`}>
      <header className={`${s.header} ${ui.heading} ${styles.heading}`}><div><h1>Predicción de demanda</h1></div></header>

      <section className={styles.predictionGrid} aria-label="Estimaciones ilustrativas por producto">
        {products.slice(0, 4).map((p) => {
          const estimatedDays = Math.floor(p.stock * 1.5) + 2; // Simulación de predicción
          return (
            <article key={p.id} className={`${s.card} ${styles.predictionCard}`}>
              <div className={styles.predictionHeading}><div><h2>{p.name}</h2><p>SKU: {p.sku}</p></div><TrendingUp size={20} aria-hidden="true" /></div>
              <div className={styles.estimate}><span>Agotamiento estimado</span><strong data-urgent={estimatedDays <= 5}>≈ {estimatedDays} días</strong></div>
              <p className={styles.recommendation}><AlertCircle size={15} aria-hidden="true" /><span>Reponer {p.minStock * 2} unidades pronto.</span></p>
            </article>
          );
        })}
      </section>
      <p className={styles.disclaimer}>Estimaciones ilustrativas basadas en el stock actual. No utilizan un modelo entrenado ni analizan ventas históricas.</p>
    </div>
  );
}
