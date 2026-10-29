import { Component } from 'react';
import Prediccion from './Prediccion';
import PrediccionConEvidencia from './PrediccionConEvidencia';
import { createPredictionDemo, DEMO_LABEL } from '../../../../tests/prediction-review/demoData.mjs';
import ui from './InventoryUI.module.css';
import styles from './Prediccion.module.css';

// This controller is lazy-loaded only in development on a loopback host.
export default class PrediccionDemoLocal extends Component {
  state = { demo: null };

  render() {
    if (this.state.demo) return <Prediccion key="simulated" {...this.state.demo}
      predictionControls={<button type="button" className={ui.secondary} onClick={() => this.setState({ demo: null })}>Volver a datos reales</button>}
      predictionNotice={<aside role="note" className={styles.demoNotice}><strong>{DEMO_LABEL}</strong></aside>} />;

    // Unmounting this branch aborts its evidence read. Returning mounts a fresh
    // reader; neither real props nor callbacks enter the synthetic branch.
    return <PrediccionConEvidencia key="real" {...this.props}
      predictionControls={<button type="button" className={ui.secondary} onClick={() => this.setState({ demo: createPredictionDemo() })}>Ver demostración</button>} />;
  }
}
