from __future__ import annotations

import re


def estimate_confidence(text: str, blocks: list[dict[str, object]]) -> float:
  if not text.strip():
    return 0.0
  tokens = [token for token in re.split(r"\s+", text.strip()) if token]
  if not tokens:
    return 0.0
  low_quality = sum(1 for token in tokens if is_low_quality_token(token))
  low_ratio = low_quality / len(tokens)
  block_bonus = min(0.15, len(blocks) * 0.002)
  base = 0.92 - (low_ratio * 0.55) + block_bonus
  return max(0.0, min(0.99, round(base, 4)))


def is_low_quality_token(token: str) -> bool:
  if len(token) == 1 and token not in {"I", "a", "A", "x", "X", "&"}:
    return True
  if re.search(r"[^\w@#&%$,.:/+\-]", token):
    return True
  if token.count("?") >= 1:
    return True
  if len(re.findall(r"\d", token)) > 0 and len(re.findall(r"[A-Za-z]", token)) > 0 and re.search(r"[^\w]", token):
    return True
  return False

