from __future__ import annotations

import base64
import tempfile
import time
from threading import Lock, Thread
from typing import Any

from PIL import Image
from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config

from ..boundary import OCRProvider
from ..engine import normalize_model_output, open_image, parse_grounding_blocks, render_pdf_pages, resolve_prompt
from ..logging import log_error, log_info
from ..settings import settings


class LocalMlxOCRProvider(OCRProvider):
  def __init__(self) -> None:
    self.lock = Lock()
    self.loaded = False
    self.loading = False
    self.last_error = ""
    self.model: Any = None
    self.processor: Any = None
    self.config: Any = None

  def startup(self) -> None:
    if settings.load_on_startup:
      Thread(target=self._preload, daemon=True, name="ocr-preload").start()

  def health(self) -> dict[str, Any]:
    status = "ok"
    if self.loading:
      status = "loading"
    elif settings.load_on_startup and not self.loaded:
      status = "starting"
    elif self.last_error:
      status = "error"
    return {
      "status": status,
      "modelId": settings.model_id,
      "modelLoaded": self.loaded,
      "modelLoading": self.loading,
      "mode": "mlx_vlm",
      "lastError": self.last_error,
      "provider": "local_mlx"
    }

  def list_models(self) -> list[dict[str, Any]]:
    return [
      {
        "id": settings.model_id,
        "object": "model",
        "created": int(time.time()),
        "owned_by": "local"
      }
    ]

  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]:
    self._ensure_loaded()
    if self.model is None or self.processor is None or self.config is None:
      raise RuntimeError("OCR model is not initialized.")

    resolved_prompt = resolve_prompt(prompt, include_layout)
    with self.lock:
      if mime_type == "application/pdf":
        return self._extract_pdf(image_bytes, resolved_prompt, include_layout, max_tokens)
      image = open_image(image_bytes)
      try:
        raw_text, completion_tokens = self._infer_image(image, resolved_prompt, max_tokens)
      finally:
        image.close()

    blocks = parse_grounding_blocks(raw_text) if include_layout else []
    return {
      "rawText": raw_text,
      "blocks": blocks,
      "mode": "mlx_vlm",
      "model": settings.model_id,
      "provider": "deepseek-mlx-local",
      "usage": {"completionTokens": completion_tokens}
    }

  def _extract_pdf(self, pdf_bytes: bytes, prompt: str, include_layout: bool, max_tokens: int) -> dict[str, Any]:
    pages = render_pdf_pages(pdf_bytes, settings.pdf_max_pages)
    if not pages:
      raise RuntimeError("No renderable pages found in PDF.")

    chunks: list[str] = []
    blocks: list[dict[str, Any]] = []
    page_images: list[dict[str, Any]] = []
    total_completion_tokens = 0
    for page_number, page_bytes, page_width, page_height in pages:
      page_images.append(
        {
          "page": page_number,
          "mimeType": "image/png",
          "width": page_width,
          "height": page_height,
          "dpi": 300,
          "dataUrl": f"data:image/png;base64,{base64.b64encode(page_bytes).decode('ascii')}"
        }
      )

      image = open_image(page_bytes)
      try:
        page_text, page_tokens = self._infer_image(image, prompt, max_tokens)
      finally:
        image.close()

      total_completion_tokens += page_tokens

      if page_text:
        chunks.append(f"[page {page_number}]\n{page_text}")

      if include_layout:
        for block in parse_grounding_blocks(page_text, page_width, page_height):
          block["page"] = page_number
          blocks.append(block)

    return {
      "rawText": "\n\n".join(chunks).strip(),
      "blocks": blocks,
      "pageImages": page_images,
      "mode": "mlx_vlm_pdf",
      "model": settings.model_id,
      "provider": "deepseek-mlx-local",
      "usage": {"completionTokens": total_completion_tokens}
    }

  def _preload(self) -> None:
    try:
      self._ensure_loaded()
    except Exception:
      pass

  def _ensure_loaded(self) -> None:
    if self.loaded:
      return

    with self.lock:
      if self.loaded:
        return

      self.loading = True
      started_at = time.perf_counter()
      try:
        model_ref = settings.model_path if settings.model_path else settings.model_id
        model, processor = load(model_ref)
        self.model = model
        self.processor = processor
        self.config = load_config(model_ref)
        self.loaded = True
        self.last_error = ""
        log_info("ocr.model.load.complete", modelId=settings.model_id, latencyMs=int((time.perf_counter() - started_at) * 1000))
      except Exception as error:
        self.last_error = str(error)
        log_error("ocr.model.load.failed", modelId=settings.model_id, error=str(error))
        raise
      finally:
        self.loading = False

  def _infer_image(self, image: Image.Image, prompt: str, max_tokens: int) -> tuple[str, int]:
    if self.model is None or self.processor is None or self.config is None:
      raise RuntimeError("OCR model is not initialized.")

    formatted_prompt = apply_chat_template(self.processor, self.config, prompt, num_images=1)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as tmp:
      image.convert("RGB").save(tmp.name, format="PNG")
      output = generate(
        self.model,
        self.processor,
        formatted_prompt,
        [tmp.name],
        verbose=False,
        max_tokens=max_tokens
      )
    text = normalize_model_output(output)
    completion_tokens = len(text.split())
    return text, completion_tokens
