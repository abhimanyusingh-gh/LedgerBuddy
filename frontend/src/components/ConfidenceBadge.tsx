import { getConfidenceLabel, getConfidenceTone } from "../confidence";

interface ConfidenceBadgeProps {
  score: number;
}

export function ConfidenceBadge({ score }: ConfidenceBadgeProps) {
  const tone = getConfidenceTone(score);

  return <span className={`confidence confidence-${tone}`}>{getConfidenceLabel(score)}</span>;
}
