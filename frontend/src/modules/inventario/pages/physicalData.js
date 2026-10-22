export function difference(line) {
  return !validQuantity(line.physical_quantity) ? null : line.physical_quantity - line.reference_stock;
}
export function validQuantity(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647;
}
export function countIssue(lines, complete = false) {
  if (!lines.length) return 'La sesión no contiene productos para contar.';
  const invalid = lines.filter(l => l.physical_quantity != null && l.physical_quantity !== '' && !validQuantity(l.physical_quantity)).length;
  if (invalid) return `Revisa la cantidad física de ${invalid} productos.`;
  if (lines.some(l => typeof l.reason !== 'string' || l.reason.length > 400)) return 'Revisa los motivos: deben tener como máximo 400 caracteres.';
  if (!complete) return '';
  const pending = lines.filter(l => !validQuantity(l.physical_quantity)).length;
  if (pending) return pending === 1 ? 'Falta 1 producto por contar' : `Faltan ${pending} productos por contar`;
  const reasons = lines.filter(l => difference(l) !== 0 && !l.reason.trim()).length;
  return reasons === 1 ? 'Falta el motivo en 1 producto con diferencia' : reasons ? `Faltan motivos en ${reasons} productos con diferencias` : '';
}
export function reviewIssue({ current, lines, readOnly, pending, busy, dirty, conflicts = [] }) {
  if (!current || current.status !== 'borrador' || readOnly) return 'Selecciona una sesión editable.';
  if (busy || pending) return 'Espera la confirmación de la operación pendiente.';
  if (conflicts.length) return 'Actualiza las referencias antes de continuar.';
  const issue = countIssue(lines, true);
  if (issue) return issue;
  return dirty ? 'Guarda el avance antes de enviar a revisión.' : '';
}
export function summarizeCount(lines) {
  return lines.reduce((s, line) => {
    const delta = difference(line);
    if (delta === null) s.pending++; else { s.counted++; if (delta !== 0) s.differences++; }
    return s;
  }, { counted: 0, pending: 0, differences: 0 });
}
