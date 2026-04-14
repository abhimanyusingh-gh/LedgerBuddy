import { getConfidenceLabel, getConfidenceTone } from "@/lib/invoice/confidence";

interface ConfidenceBadgeProps {
  score: number;
}

export function ConfidenceBadge({ score }: ConfidenceBadgeProps) {
  const tone = getConfidenceTone(score);

  return <span className={`confidence confidence-${tone}`}>{getConfidenceLabel(score)}</span>;
}
