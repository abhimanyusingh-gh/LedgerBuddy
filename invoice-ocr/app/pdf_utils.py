from __future__ import annotations

import io
import re
from typing import Any

from PIL import Image
import pypdfium2 as pdfium

from .document_utils import normalize_bbox, normalize_page, normalize_text

PDF_RENDER_DPI = 300
PDF_RENDER_SCALE = PDF_RENDER_DPI / 72.0


def open_image(image_bytes: bytes) -> Image.Image:
  image = Image.open(io.BytesIO(image_bytes))
  image.load()
  return image


def render_pdf_pages(pdf_bytes: bytes, max_pages: int) -> list[tuple[int, bytes, int, int]]:
  pages: list[tuple[int, bytes, int, int]] = []
  document = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
  try:
    total_pages = len(document)
    for page_index in range(min(total_pages, max_pages)):
      page = document.get_page(page_index)
      try:
        bitmap = page.render(scale=PDF_RENDER_SCALE)
        pil_image = bitmap.to_pil()
      finally:
        page.close()

      image_buffer = io.BytesIO()
      pil_image.save(image_buffer, format="PNG")
      pages.append((page_index + 1, image_buffer.getvalue(), pil_image.width, pil_image.height))
      pil_image.close()
  finally:
    document.close()
  return pages


def extract_pdf_text_blocks(pdf_bytes: bytes, max_pages: int) -> list[dict[str, Any]]:
  blocks: list[dict[str, Any]] = []
  document = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
  try:
    total_pages = len(document)
    for page_index in range(min(total_pages, max_pages)):
      page = document.get_page(page_index)
      try:
        text_page = page.get_textpage()
        page_width, page_height = document.get_page_size(page_index)
        blocks.extend(_extract_pdf_text_page_blocks(text_page, page_index + 1, page_width, page_height))
      finally:
        page.close()
  finally:
    document.close()
  return blocks


def reconcile_blocks_with_pdf_text(
  ocr_blocks: list[dict[str, Any]],
  pdf_text_blocks: list[dict[str, Any]]
) -> list[dict[str, Any]]:
  if not ocr_blocks or not pdf_text_blocks:
    return ocr_blocks

  corrected = [dict(block) for block in ocr_blocks]
  used_pdf_indexes: set[int] = set()
  for index, block in enumerate(corrected):
    bbox_normalized = normalize_bbox(block.get("bboxNormalized"))
    page = normalize_page(block.get("page"))
    if not bbox_normalized:
      continue

    best_match_index = -1
    best_score = 0.0
    for pdf_index, pdf_block in enumerate(pdf_text_blocks):
      if pdf_index in used_pdf_indexes:
        continue
      if normalize_page(pdf_block.get("page")) != page:
        continue
      pdf_bbox = normalize_bbox(pdf_block.get("bboxNormalized"))
      if not pdf_bbox:
        continue
      score = _bbox_overlap_score(bbox_normalized, pdf_bbox)
      if score > best_score:
        best_score = score
        best_match_index = pdf_index

    if best_match_index < 0 or best_score < 0.55:
      continue

    pdf_text = normalize_text(pdf_text_blocks[best_match_index].get("text"))
    if not pdf_text:
      continue
    corrected[index]["text"] = pdf_text
    used_pdf_indexes.add(best_match_index)

  return corrected


def blocks_to_text(blocks: list[dict[str, Any]]) -> str:
  if not blocks:
    return ""

  def sort_key(entry: dict[str, Any]) -> tuple[int, float, float]:
    bbox = normalize_bbox(entry.get("bboxNormalized"))
    return (
      normalize_page(entry.get("page")),
      bbox[1] if bbox else 0.0,
      bbox[0] if bbox else 0.0
    )

  lines: list[str] = []
  current_page: int | None = None
  for block in sorted(blocks, key=sort_key):
    page = normalize_page(block.get("page"))
    text = normalize_text(block.get("text"))
    if not text:
      continue
    if page != current_page:
      if current_page is not None:
        lines.append("")
      lines.append(f"[page {page}]")
      current_page = page
    lines.append(text)
  return "\n".join(lines).strip()


def _extract_pdf_text_page_blocks(
  text_page: Any,
  page_number: int,
  page_width: float,
  page_height: float
) -> list[dict[str, Any]]:
  blocks: list[dict[str, Any]] = []
  char_count = text_page.count_chars()
  line_chars: list[str] = []
  line_boxes: list[tuple[float, float, float, float]] = []

  def flush_line() -> None:
    nonlocal line_chars, line_boxes
    text = re.sub(r"\s+", " ", "".join(line_chars)).strip()
    if text and line_boxes:
      left = min(box[0] for box in line_boxes)
      bottom = min(box[1] for box in line_boxes)
      right = max(box[2] for box in line_boxes)
      top = max(box[3] for box in line_boxes)
      blocks.append(
        {
          "text": text,
          "bboxNormalized": [
            round(max(0.0, min(1.0, left / max(1.0, page_width))), 6),
            round(max(0.0, min(1.0, (page_height - top) / max(1.0, page_height))), 6),
            round(max(0.0, min(1.0, right / max(1.0, page_width))), 6),
            round(max(0.0, min(1.0, (page_height - bottom) / max(1.0, page_height))), 6)
          ],
          "page": page_number,
          "blockType": "text"
        }
      )
    line_chars = []
    line_boxes = []

  for char_index in range(char_count):
    char = text_page.get_text_range(char_index, 1, errors="ignore")
    if not char:
      continue
    if char in {"\r", "\n"}:
      flush_line()
      continue
    line_chars.append(char)
    if char.strip():
      left, bottom, right, top = text_page.get_charbox(char_index)
      if right > left and top > bottom:
        line_boxes.append((left, bottom, right, top))
  flush_line()

  return blocks


def _bbox_overlap_score(left: list[float], right: list[float]) -> float:
  overlap_left = max(left[0], right[0])
  overlap_top = max(left[1], right[1])
  overlap_right = min(left[2], right[2])
  overlap_bottom = min(left[3], right[3])
  if overlap_right <= overlap_left or overlap_bottom <= overlap_top:
    return 0.0

  overlap_area = (overlap_right - overlap_left) * (overlap_bottom - overlap_top)
  left_area = max(1e-6, (left[2] - left[0]) * (left[3] - left[1]))
  right_area = max(1e-6, (right[2] - right[0]) * (right[3] - right[1]))
  return overlap_area / max(left_area, right_area)

