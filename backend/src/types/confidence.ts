export const ConfidenceTones = ["red", "yellow", "green"] as const;

export type ConfidenceTone = (typeof ConfidenceTones)[number];
