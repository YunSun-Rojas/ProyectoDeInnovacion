// Wire contract of inventory_prediction_evidence; no model or authorization policy.
const fields = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && value >= '0001-01-01' && value <= '9998-12-31'
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function isPredictionInstant(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value)
    && day(value.slice(0, 10)) && Number(value.slice(11, 13)) <= 23
    && Number(value.slice(14, 16)) <= 59 && Number(value.slice(17, 19)) <= 59
    && (value.endsWith('Z') || (Number(value.slice(-5, -3)) <= 15 && Number(value.slice(-2)) <= 59))
    && Number.isFinite(Date.parse(value));
}
const limaDay = instant => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
const uuid = value => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(value);
const reference = (value, prefix) => typeof value === 'string'
  && new RegExp(`^${prefix}:[1-9]\\d{0,18}$`).test(value)
  && BigInt(value.split(':')[1]) <= 9223372036854775807n;
const invalid = () => { throw new TypeError('Formato de evidencia predictiva inválido.'); };

export function validatePredictionEvidence(value, asOf) {
  if (!isPredictionInstant(asOf) || !fields(value, ['classifications', 'coverage', 'stockouts'])
    || !['classifications', 'coverage', 'stockouts'].every(key => Array.isArray(value[key]))) invalid();
  const verified = row => isPredictionInstant(row.verifiedAt) && Date.parse(row.verifiedAt) <= Date.parse(asOf);
  const sales = new Set(), days = new Set(), references = new Set();
  const uniqueReference = (value, prefix) => {
    if (!reference(value, prefix) || references.has(value)) invalid();
    references.add(value);
  };
  const classifications = value.classifications.map(row => {
    if (!fields(row, ['saleId', 'kind', 'evidence', 'verifiedAt']) || !uuid(row.saleId)
      || !['commercial', 'test', 'unclassified'].includes(row.kind) || !verified(row) || sales.has(row.saleId)) invalid();
    sales.add(row.saleId);
    uniqueReference(row.evidence, 'sale-review');
    return { saleId: row.saleId, kind: row.kind, evidence: row.evidence, verifiedAt: row.verifiedAt };
  });
  const ranges = rows => rows.map(row => {
    if (!fields(row, ['productId', 'from', 'to', 'evidence', 'verifiedAt'])
      || !Number.isSafeInteger(row.productId) || row.productId <= 0 || !day(row.from)
      || row.to !== row.from || row.to >= limaDay(asOf) || !verified(row)) invalid();
    const key = `${row.productId}:${row.from}`;
    if (days.has(key)) invalid(); // SQL returns one latest decision per product/day, across both lists.
    days.add(key);
    uniqueReference(row.evidence, 'day-review');
    return { productId: row.productId, from: row.from, to: row.to, evidence: row.evidence, verifiedAt: row.verifiedAt };
  });
  return { classifications, coverage: ranges(value.coverage), stockouts: ranges(value.stockouts) };
}

export function validatePredictionEvidenceResponse(value) {
  if (!fields(value, ['state', 'asOf', 'evidence'])) invalid();
  if (value.state === 'migration_missing' && value.asOf === null && value.evidence === null) return value;
  if (value.state !== 'available') invalid();
  return { state: 'available', asOf: value.asOf, evidence: validatePredictionEvidence(value.evidence, value.asOf) };
}
