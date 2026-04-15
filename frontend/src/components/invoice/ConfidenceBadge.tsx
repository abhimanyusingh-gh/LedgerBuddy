import { getConfidenceLabel, getConfidenceTone } from "@/lib/invoice/confidence";

type ConfidenceTone = "red" | "yellow" | "green";

interface ConfidenceBadgeProps {
  score: number;
  tone?: ConfidenceTone;
}

export function ConfidenceBadge({ score, tone }: ConfidenceBadgeProps) {
  const resolvedTone = tone ?? getConfidenceTone(score);

  return <span className={`confidence confidence-${resolvedTone}`}>{getConfidenceLabel(score)}</span>;
}
