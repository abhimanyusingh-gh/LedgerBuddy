export type Box4 = [number, number, number, number];

function validateBox(value: Box4 | undefined): Box4 | undefined {
  if (!value) {
    return undefined;
  }
  const [x1, y1, x2, y2] = value;
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) {
    return undefined;
  }
  return value;
}

export function normalizeUnitBox(value: Box4 | undefined): Box4 | undefined {
  const v = validateBox(value);
  if (!v) {
    return undefined;
  }
  const [x1, y1, x2, y2] = v;
  return x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1 ? undefined : v;
}

export function normalizeModelBox(value: Box4 | undefined): Box4 | undefined {
  const v = validateBox(value);
  if (!v) {
    return undefined;
  }
  const scale = 999;
  return v.map((n) => Math.max(0, Math.min(1, n / scale))) as Box4;
}

export function normalizeAbsoluteBox(value: Box4, pageWidth: number, pageHeight: number): Box4 | undefined {
  if (!validateBox(value)) {
    return undefined;
  }
  const [x1, y1, x2, y2] = value;
  return [
    Math.max(0, Math.min(1, x1 / pageWidth)),
    Math.max(0, Math.min(1, y1 / pageHeight)),
    Math.max(0, Math.min(1, x2 / pageWidth)),
    Math.max(0, Math.min(1, y2 / pageHeight))
  ];
}

export function normalizeBoxTuple(value: unknown): Box4 | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }

  const numbers = value.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return undefined;
  }

  const [x1, y1, x2, y2] = numbers;
  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }

  return [x1, y1, x2, y2];
}
