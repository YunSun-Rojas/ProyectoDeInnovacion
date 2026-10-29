import { fail } from '../../utils/http.js';
import { validatePredictionEvidence } from '../../../../shared/predictionEvidence.js';

// Only the authenticated session client is accepted. Never creates another client.
export async function readPredictionEvidence(client, userId) {
  if (!client || !userId) throw fail(401, 'Inicia sesión para consultar las evidencias.', 'PREDICTION_SESSION_REQUIRED');
  const asOf = new Date().toISOString();
  let response;
  try {
    response = await client.rpc('inventory_prediction_evidence', { p_as_of: asOf }, { get: true });
  } catch (error) {
    response = { error, status: error?.status ?? (error?.code ? undefined : 0) };
  }
  const error = response?.error;
  if (response?.status === 403 || error?.code === '42501' || error?.message === 'PREDICTION_FORBIDDEN') {
    throw fail(403, 'Tu cuenta no tiene permiso para consultar las evidencias.', 'PREDICTION_ACCESS_DENIED');
  }
  if (response?.status === 401 || ['PGRST301', 'PGRST302'].includes(error?.code)) {
    throw fail(401, 'Inicia sesión nuevamente.', 'PREDICTION_SESSION_REQUIRED');
  }
  if (error) {
    // Do not label missing dependencies inside an installed function as an absent migration.
    if (error.code === 'PGRST202' || (error.code === '42883'
      && /^function (public\.)?inventory_prediction_evidence\([^)]*\) does not exist$/i.test(error.message ?? ''))) {
      return { state: 'migration_missing', asOf: null, evidence: null };
    }
    if (response.status === 0 || ['PGRST000', 'PGRST001', 'PGRST002', '08000', '08001', '08006', '57014'].includes(error.code)
      || /fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT/i.test(error.message ?? '')) {
      throw fail(503, 'No se pudo conectar con el servicio de evidencias. Reintenta.', 'PREDICTION_CONNECTION_ERROR');
    }
    throw fail(503, 'No se pudieron consultar las evidencias. Reintenta.', 'PREDICTION_READ_ERROR');
  }
  try {
    if (!response || (response.status != null && (response.status < 200 || response.status >= 300))) throw new TypeError();
    return { state: 'available', asOf, evidence: validatePredictionEvidence(response.data, asOf) };
  } catch {
    throw fail(502, 'La respuesta de evidencias está incompleta o es inválida.', 'PREDICTION_INVALID_RESPONSE');
  }
}
