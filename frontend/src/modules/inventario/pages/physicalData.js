export function difference(line) {
  return line.physical_quantity == null ? null : line.physical_quantity - line.reference_stock;
}
export function summarizeCount(lines) {
  return lines.reduce((s, line) => {
    const delta = difference(line);
    if (delta === null) s.pending++; else { s.counted++; if (delta !== 0) s.differences++; }
    return s;
  }, { counted: 0, pending: 0, differences: 0 });
}
