export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value <= 1) return Number(value.toFixed(4));
  if (value <= 100) return Number((value / 100).toFixed(4));
  return 1;
}
