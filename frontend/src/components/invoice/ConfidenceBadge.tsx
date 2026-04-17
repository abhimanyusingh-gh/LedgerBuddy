import { getConfidenceLabel, getConfidenceTone } from "@/lib/invoice/confidence";

interface ConfidenceBadgeProps {
  score: number;
  tone?: ReturnType<typeof getConfidenceTone>;
}

export function ConfidenceBadge({ score, tone }: ConfidenceBadgeProps) {
  const resolvedTone = tone ?? getConfidenceTone(score);

  return <span className={`confidence confidence-${resolvedTone}`}>{getConfidenceLabel(score)}</span>;
}
