import { api } from '../../../api/httpClient.js';
import { validatePredictionEvidenceResponse } from '../../../../../shared/predictionEvidence.js';

export async function loadPredictionEvidence(signal) {
  const response = await api('/inventory/prediction-evidence', { signal });
  try { return validatePredictionEvidenceResponse(response); }
  catch { throw Object.assign(new Error('La respuesta de evidencias es inválida.'), { code: 'PREDICTION_INVALID_RESPONSE' }); }
}

// No stale evidence fallback after an error or abort. This loader is prediction-only.
export async function predictionEvidenceState(signal, read = loadPredictionEvidence) {
  if (signal.aborted) return null;
  try {
    const result = await read(signal);
    if (signal.aborted) return null;
    return { evidenceState: result.state, predictionEvidence: result.evidence, asOf: result.asOf ?? undefined };
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') return null;
    const evidenceState = [401, 403].includes(error.status) ? 'access_denied'
      : ['PREDICTION_INVALID_RESPONSE', 'INVALID_RESPONSE'].includes(error.code) ? 'invalid_evidence'
        : error.code === 'PREDICTION_CONNECTION_ERROR' || error.status == null ? 'connection_error' : 'evidence_error';
    return { evidenceState, predictionEvidence: undefined };
  }
}
