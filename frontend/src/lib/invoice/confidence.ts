type ConfidenceTone = "red" | "yellow" | "green";

export function getConfidenceTone(score: number): ConfidenceTone {
  if (score >= 91) {
    return "green";
  }

  if (score >= 80) {
    return "yellow";
  }

  return "red";
}

export function getConfidenceLabel(score: number): string {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return `${bounded}%`;
}
