import { useEffect, useMemo, useState } from 'react';
import { predictionEvidenceState } from '../api/predictionApi.js';
import Prediccion from './Prediccion';

export default function PrediccionConEvidencia(props) {
  const { status, salesEnabled, sales, refreshing } = props;
  // Stock and catalog labels do not change historical evidence.
  const source = useMemo(() => ({ status, salesEnabled, sales, refreshing }),
    [status, salesEnabled, sales, refreshing]);
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    if (source.status !== 'ready' || source.salesEnabled !== true || source.refreshing) return;
    const controller = new AbortController();
    // StrictMode's setup/cleanup rehearsal cancels before any HTTP request starts.
    Promise.resolve().then(() => predictionEvidenceState(controller.signal)).then(result => {
      if (result && !controller.signal.aborted) setLoaded({ source, result });
    });
    return () => controller.abort();
  }, [source]);
  const result = loaded?.source === source ? loaded.result : { evidenceState: 'loading', predictionEvidence: undefined };
  return <Prediccion {...props} {...result} />;
}
