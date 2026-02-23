from __future__ import annotations

import ast
import base64
import io
import json
import re
import time
from pathlib import Path
from threading import Lock
from typing import Any, Protocol
from urllib import error as url_error
from urllib import request as url_request

from fastapi import HTTPException
from huggingface_hub import snapshot_download
from PIL import Image
import pypdfium2 as pdfium
from transformers import AutoTokenizer

from .logging import log_error, log_info
from .settings import settings

GROUNDING_BLOCK_PATTERN = re.compile(
  r"<\|ref\|>(?P<label>.*?)<\|/ref\|><\|det\|>(?P<det>.*?)<\|/det\|>(?P<body>.*?)(?=<\|ref\|>|\Z)",
  re.DOTALL
)
PDF_RENDER_DPI = 300
PDF_RENDER_SCALE = PDF_RENDER_DPI / 72.0


class OcrEngine(Protocol):
  def startup(self) -> None: ...
  def health(self) -> dict[str, Any]: ...
  def list_models(self) -> list[dict[str, Any]]: ...
  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]: ...


class LocalMlxOcrEngine:
  def __init__(self, model_id: str) -> None:
    self.model_id = model_id
    self.lock = Lock()
    self.loaded = False
    self.loading = False
    self.last_error = ""
    self.mode = ""
    self.model: Any = None
    self.tokenizer: Any = None
    self.preprocessor: Any = None
    self.generate_fn: Any = None
    self.generation_config_cls: Any = None

  def startup(self) -> None:
    if settings.load_on_startup:
      self.ensure_loaded()

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
      "modelId": self.model_id,
      "modelLoaded": self.loaded,
      "modelLoading": self.loading,
      "mode": self.mode or "uninitialized",
      "lastError": self.last_error or "",
      "engine": "local_mlx"
    }

  def list_models(self) -> list[dict[str, Any]]:
    return [
      {
        "id": self.model_id,
        "object": "model",
        "created": int(time.time()),
        "owned_by": "local"
      }
    ]

  def ensure_loaded(self) -> None:
    if self.loaded:
      return

    with self.lock:
      if self.loaded:
        return

      self.loading = True
      started_at = time.perf_counter()
      try:
        from deepseek_ocr_mlx.generate import GenerationConfig as LocalGenerationConfig
        from deepseek_ocr_mlx.generate import generate as local_generate
        from deepseek_ocr_mlx.load import load as load_model
        from deepseek_ocr_mlx.processor import DeepSeekOCRPreprocessor as LocalPreprocessor

        model_path = resolve_model_path(self.model_id)
        tokenizer = AutoTokenizer.from_pretrained(str(model_path), trust_remote_code=True)
        model = load_model(model_path, lazy=False)
        preprocessor = LocalPreprocessor(
          tokenizer,
          model.config,
          dynamic_crops=settings.dynamic_crops,
          crop_size=settings.crop_size,
          min_dynamic_crops=settings.min_dynamic_crops,
          max_dynamic_crops=settings.max_dynamic_crops
        )

        self.model = model
        self.tokenizer = tokenizer
        self.preprocessor = preprocessor
        self.generate_fn = local_generate
        self.generation_config_cls = LocalGenerationConfig
        self.mode = "deepseek-mlx"
        self.loaded = True
        self.last_error = ""
        log_info(
          "ocr.model.load.complete",
          modelId=self.model_id,
          modelPath=str(model_path),
          latencyMs=int((time.perf_counter() - started_at) * 1000)
        )
      except Exception as error:
        self.last_error = str(error)
        log_error("ocr.model.load.failed", modelId=self.model_id, error=str(error))
        raise
      finally:
        self.loading = False

  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]:
    self.ensure_loaded()
    if self.model is None or self.tokenizer is None or self.preprocessor is None:
      raise RuntimeError("MLX OCR model is not initialized.")

    resolved_prompt = resolve_prompt(prompt, include_layout)
    token_limit = normalize_token_limit(max_tokens)

    with self.lock:
      if mime_type == "application/pdf":
        return self._extract_pdf(image_bytes, resolved_prompt, include_layout, token_limit)

      image = open_image(image_bytes)
      try:
        raw_text = self._infer_image(image, resolved_prompt, token_limit)
        blocks = parse_grounding_blocks(raw_text, image.width, image.height) if include_layout else []
        return {
          "rawText": raw_text,
          "blocks": blocks,
          "mode": self.mode,
          "model": self.model_id,
          "provider": "deepseek-mlx-local"
        }
      finally:
        image.close()

  def _extract_pdf(self, pdf_bytes: bytes, prompt: str, include_layout: bool, max_tokens: int) -> dict[str, Any]:
    rendered_pages = render_pdf_pages(pdf_bytes, settings.pdf_max_pages)
    if len(rendered_pages) == 0:
      raise RuntimeError("No renderable pages found in PDF.")

    text_chunks: list[str] = []
    blocks: list[dict[str, Any]] = []

    for page_number, page_bytes, page_width, page_height in rendered_pages:
      image = open_image(page_bytes)
      try:
        page_text = self._infer_image(image, prompt, max_tokens)
      finally:
        image.close()

      if page_text:
        text_chunks.append(f"[page {page_number}]\n{page_text}")

      if include_layout:
        page_blocks = parse_grounding_blocks(page_text, page_width, page_height)
        for block in page_blocks:
          block["page"] = page_number
        blocks.extend(page_blocks)

    return {
      "rawText": "\n\n".join(text_chunks).strip(),
      "blocks": blocks,
      "mode": f"{self.mode}-pdf",
      "model": self.model_id,
      "provider": "deepseek-mlx-local"
    }

  def _infer_image(self, image: Image.Image, prompt: str, max_tokens: int) -> str:
    if self.model is None or self.tokenizer is None or self.preprocessor is None:
      raise RuntimeError("MLX OCR model is not initialized.")
    if self.generate_fn is None or self.generation_config_cls is None:
      raise RuntimeError("MLX OCR generation runtime is not initialized.")

    batch = self.preprocessor.prepare_single(prompt, [image.convert("RGB")])
    generation = self.generate_fn(
      self.model,
      self.tokenizer,
      batch,
      self.generation_config_cls(max_new_tokens=max_tokens, temperature=0.0, skip_special_tokens=False)
    )
    return normalize_model_output(generation)


class RemoteHttpOcrEngine:
  def __init__(
    self,
    model_id: str,
    base_url: str,
    api_key: str,
    timeout_ms: int,
    validate_on_startup: bool
  ) -> None:
    self.model_id = model_id
    self.base_url = base_url.rstrip("/")
    self.api_key = api_key.strip()
    self.timeout_ms = timeout_ms
    self.validate_on_startup = validate_on_startup
    self.last_error = ""

  def startup(self) -> None:
    if self.validate_on_startup:
      self._validate_remote()

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok",
      "modelId": self.model_id,
      "modelLoaded": True,
      "modelLoading": False,
      "mode": "remote-http",
      "lastError": self.last_error or "",
      "engine": "remote_http"
    }
    try:
      remote_health = self._request_json("/health")
      if isinstance(remote_health, dict):
        payload["remote"] = remote_health
    except Exception as error:
      payload["status"] = "error"
      payload["lastError"] = str(error)
      self.last_error = str(error)
    return payload

  def list_models(self) -> list[dict[str, Any]]:
    try:
      payload = self._request_json("/models")
      if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        data = [
          entry
          for entry in payload["data"]
          if isinstance(entry, dict) and isinstance(entry.get("id"), str) and entry.get("id", "").strip()
        ]
        if len(data) > 0:
          return data
    except Exception as error:
      self.last_error = str(error)

    return [
      {
        "id": self.model_id,
        "object": "model",
        "created": int(time.time()),
        "owned_by": "remote"
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
    payload = self._request_json(
      "/ocr/document",
      body={
        "model": self.model_id,
        "document": f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}",
        "includeLayout": include_layout,
        "prompt": prompt,
        "maxTokens": max_tokens
      }
    )
    if not isinstance(payload, dict):
      raise RuntimeError("Remote OCR returned invalid payload.")

    raw_text = normalize_text(payload.get("rawText")) or normalize_text(payload.get("raw_text")) or ""
    blocks = normalize_blocks(payload.get("blocks"))
    confidence = normalize_remote_confidence(payload.get("confidence"))

    return {
      "rawText": raw_text,
      "blocks": blocks,
      "confidence": confidence,
      "mode": "remote-http",
      "provider": normalize_text(payload.get("provider")) or "remote-http",
      "model": normalize_text(payload.get("model")) or self.model_id
    }

  def _validate_remote(self) -> None:
    models = self.list_models()
    configured = self.model_id.strip().lower()
    if configured.endswith(":latest"):
      configured = configured[:-7]
    available = {str(entry.get("id", "")).strip().lower().removesuffix(":latest") for entry in models}
    if len(available) > 0 and configured not in available:
      raise RuntimeError(
        f"Configured model '{self.model_id}' is not listed by remote OCR. Available: {sorted(available)}"
      )

  def _request_json(self, path: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{self.base_url}{path}"
    headers = {"Content-Type": "application/json"}
    if self.api_key:
      headers["Authorization"] = f"Bearer {self.api_key}"

    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = url_request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    timeout_seconds = max(1, int(self.timeout_ms / 1000))

    try:
      with url_request.urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))
    except url_error.HTTPError as error:
      detail = error.read().decode("utf-8", errors="replace")
      raise RuntimeError(f"Remote OCR HTTP {error.code}: {detail[:400]}") from error
    except Exception as error:
      raise RuntimeError(f"Remote OCR request failed: {error}") from error


def create_ocr_engine() -> OcrEngine:
  if settings.engine == "remote_http":
    if not settings.remote_base_url:
      raise RuntimeError("OCR_ENGINE=remote_http requires OCR_REMOTE_BASE_URL.")
    return RemoteHttpOcrEngine(
      model_id=settings.model_id,
      base_url=settings.remote_base_url,
      api_key=settings.remote_api_key,
      timeout_ms=settings.remote_timeout_ms,
      validate_on_startup=settings.validate_remote_on_startup
    )

  return LocalMlxOcrEngine(settings.model_id)


def resolve_model_path(model_id: str) -> Path:
  env_path = settings.model_path
  if env_path:
    candidate = Path(env_path).expanduser().resolve()
    if candidate.exists():
      return candidate
    raise RuntimeError(f"OCR_MODEL_PATH '{candidate}' does not exist.")

  direct = Path(model_id)
  if direct.exists():
    return direct.resolve()

  return Path(
    snapshot_download(
      repo_id=model_id,
      local_files_only=not settings.allow_download
    )
  )


def parse_data_url(data_url: str) -> tuple[str, bytes]:
  try:
    header, encoded = data_url.split(",", 1)
  except ValueError as error:
    raise HTTPException(status_code=400, detail="Invalid data URL format.") from error

  if not header.startswith("data:") or ";base64" not in header:
    raise HTTPException(status_code=400, detail="Only base64 data URLs are supported.")

  mime_type = header[5:].split(";")[0].strip() or "application/octet-stream"

  try:
    image_bytes = base64.b64decode(encoded, validate=True)
  except Exception as error:
    raise HTTPException(status_code=400, detail=f"Invalid base64 image payload: {error}") from error

  return mime_type, image_bytes


def normalize_text(value: Any) -> str | None:
  if not isinstance(value, str):
    return None
  trimmed = value.strip()
  return trimmed if trimmed else None


def normalize_blocks(value: Any) -> list[dict[str, Any]]:
  if not isinstance(value, list):
    return []
  blocks: list[dict[str, Any]] = []
  for entry in value:
    if not isinstance(entry, dict):
      continue
    text = normalize_text(entry.get("text")) or normalize_text(entry.get("label"))
    if not text:
      continue
    bbox = entry.get("bbox")
    if not (isinstance(bbox, list) and len(bbox) == 4 and all(isinstance(item, (int, float)) for item in bbox)):
      continue
    normalized: dict[str, Any] = {
      "text": text,
      "page": normalize_page(entry.get("page")),
      "bbox": [int(round(float(item))) for item in bbox]
    }
    bbox_normalized = entry.get("bboxNormalized")
    if isinstance(bbox_normalized, list) and len(bbox_normalized) == 4:
      normalized["bboxNormalized"] = [float(item) for item in bbox_normalized]
    bbox_model = entry.get("bboxModel")
    if isinstance(bbox_model, list) and len(bbox_model) == 4:
      normalized["bboxModel"] = [float(item) for item in bbox_model]
    block_type = normalize_text(entry.get("blockType")) or normalize_text(entry.get("type"))
    if block_type:
      normalized["blockType"] = block_type.lower()
    blocks.append(normalized)
  return blocks


def normalize_page(value: Any) -> int:
  try:
    parsed = int(value)
  except Exception:
    return 1
  return parsed if parsed > 0 else 1


def normalize_remote_confidence(value: Any) -> float | None:
  try:
    parsed = float(value)
  except Exception:
    return None
  if parsed > 1:
    parsed = parsed / 100.0
  if parsed < 0:
    return 0.0
  if parsed > 1:
    return 1.0
  return round(parsed, 4)


def resolve_prompt(prompt: str, include_layout: bool) -> str:
  trimmed = prompt.strip()
  if trimmed:
    return trimmed
  return settings.layout_prompt if include_layout else settings.text_prompt


def normalize_token_limit(value: int) -> int:
  if not isinstance(value, int):
    return max(64, settings.max_new_tokens)
  return max(64, min(4096, value))


def normalize_model_output(response: Any) -> str:
  if isinstance(response, str):
    return cleanup_generated_text(response)

  text = getattr(response, "text", None)
  if isinstance(text, str):
    return cleanup_generated_text(text)

  if isinstance(response, dict):
    for key in ("text", "rawText", "raw_text", "result", "output"):
      value = response.get(key)
      if isinstance(value, str) and value.strip():
        return cleanup_generated_text(value)
    return json.dumps(response, ensure_ascii=True)

  if isinstance(response, list):
    values = [entry.strip() for entry in response if isinstance(entry, str) and entry.strip()]
    return cleanup_generated_text("\n".join(values).strip())

  return cleanup_generated_text(str(response).strip())


def cleanup_generated_text(text: str) -> str:
  cleaned = text.replace("<｜end of sentence｜>", "")
  cleaned = cleaned.replace("<｜end▁of▁sentence｜>", "")
  cleaned = cleaned.replace("Ġ", "")
  cleaned = cleaned.replace("▁", " ")
  cleaned = cleaned.replace("Ċ", "\n")
  return cleaned.strip()


def open_image(image_bytes: bytes) -> Image.Image:
  image = Image.open(io.BytesIO(image_bytes))
  return image.convert("RGB")


def render_pdf_pages(pdf_bytes: bytes, max_pages: int) -> list[tuple[int, bytes, int, int]]:
  rendered_pages: list[tuple[int, bytes, int, int]] = []
  document = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
  try:
    page_count = len(document)
    if page_count <= 0:
      return []

    final_page_limit = min(page_count, max(1, max_pages))
    for page_index in range(final_page_limit):
      page = document[page_index]
      try:
        bitmap = page.render(scale=PDF_RENDER_SCALE, rotation=0)
        pil_image = bitmap.to_pil()
      finally:
        page.close()

      try:
        rgb_image = pil_image.convert("RGB")
      finally:
        pil_image.close()

      try:
        width, height = rgb_image.size
        with io.BytesIO() as output:
          rgb_image.save(output, format="PNG")
          rendered_pages.append((page_index + 1, output.getvalue(), width, height))
      finally:
        rgb_image.close()
  finally:
    document.close()

  return rendered_pages


def parse_grounding_blocks(raw_text: str, image_width: int, image_height: int) -> list[dict[str, Any]]:
  if image_width <= 0 or image_height <= 0:
    return []

  blocks: list[dict[str, Any]] = []
  for match in GROUNDING_BLOCK_PATTERN.finditer(raw_text):
    label = normalize_block_label(match.group("label"))
    coordinates = parse_det_coordinates(match.group("det"))
    block_text = normalize_block_payload(match.group("body")) or label or "text-block"

    for coordinate in coordinates:
      x1, y1, x2, y2 = coordinate
      model_bbox = [x1, y1, x2, y2]
      model_clamped = [clamp_model_coordinate(entry) for entry in model_bbox]
      absolute = model_bbox_to_pixels(model_clamped, image_width, image_height)
      if absolute[2] <= absolute[0] or absolute[3] <= absolute[1]:
        continue

      blocks.append(
        {
          "text": block_text,
          "page": 1,
          "bbox": absolute,
          "bboxNormalized": [
            round(model_clamped[0] / 999.0, 6),
            round(model_clamped[1] / 999.0, 6),
            round(model_clamped[2] / 999.0, 6),
            round(model_clamped[3] / 999.0, 6)
          ],
          "bboxModel": model_clamped,
          "blockType": classify_block_type(label)
        }
      )

  return blocks


def parse_det_coordinates(raw_coordinates: str) -> list[list[float]]:
  cleaned_for_eval = sanitize_coordinate_string(raw_coordinates)
  parsed_candidates: list[list[float]] = []

  for candidate in (raw_coordinates, cleaned_for_eval):
    parsed = parse_det_with_ast(candidate)
    if len(parsed) > 0:
      parsed_candidates.extend(parsed)
      break

  if len(parsed_candidates) > 0:
    return parsed_candidates

  numbers = [float(entry) for entry in re.findall(r"-?\d+(?:\.\d+)?", cleaned_for_eval)]
  output: list[list[float]] = []
  for index in range(0, len(numbers) - 3, 4):
    output.append([numbers[index], numbers[index + 1], numbers[index + 2], numbers[index + 3]])
  return output


def sanitize_coordinate_string(value: str) -> str:
  cleaned = value.replace("Ġ", "").replace("▁", "")
  cleaned = cleaned.replace("\n", " ")
  cleaned = re.sub(r"[^0-9,\.\-\[\] ]", "", cleaned)
  cleaned = re.sub(r"\s+", " ", cleaned)
  return cleaned.strip()


def parse_det_with_ast(value: str) -> list[list[float]]:
  try:
    parsed = ast.literal_eval(value)
  except Exception:
    return []
  if not isinstance(parsed, list):
    return []

  output: list[list[float]] = []
  for entry in parsed:
    if not isinstance(entry, list) or len(entry) != 4:
      continue
    try:
      output.append([float(entry[0]), float(entry[1]), float(entry[2]), float(entry[3])])
    except (TypeError, ValueError):
      continue
  return output


def clamp_model_coordinate(value: float) -> float:
  if value < 0:
    return 0.0
  if value > 999:
    return 999.0
  return float(value)


def model_bbox_to_pixels(bbox: list[float], width: int, height: int) -> list[int]:
  return [
    int(round(bbox[0] / 999.0 * width)),
    int(round(bbox[1] / 999.0 * height)),
    int(round(bbox[2] / 999.0 * width)),
    int(round(bbox[3] / 999.0 * height))
  ]


def classify_block_type(label: str) -> str:
  normalized = label.strip().lower()
  if "title" in normalized:
    return "title"
  if "table" in normalized:
    return "table"
  if "image" in normalized:
    return "image"
  if "line" in normalized:
    return "line"
  return "text"


def normalize_block_payload(value: str) -> str:
  text = cleanup_generated_text(value)
  if not text:
    return ""

  text = re.sub(r"</?(table|thead|tbody|tr)>", "\n", text, flags=re.IGNORECASE)
  text = re.sub(r"</?td>", " | ", text, flags=re.IGNORECASE)
  text = re.sub(r"<[^>]+>", " ", text)
  text = text.replace("**", " ").replace("__", " ")
  text = re.sub(r"\s+", " ", text)
  return text.strip()


def normalize_block_label(value: str) -> str:
  return cleanup_generated_text(value).strip().lower()


def estimate_confidence(text: str, blocks: list[dict[str, Any]]) -> float:
  if not text.strip():
    return 0.0

  length_score = min(1.0, len(text) / 1800)
  printable_score = sum(1 for char in text if 31 < ord(char) < 127 or char == "\n") / max(1, len(text))
  tokens = [token for token in re.split(r"\s+", text) if token]
  low_quality_tokens = sum(1 for token in tokens if is_low_quality_token(token))
  low_quality_ratio = low_quality_tokens / max(1, len(tokens))
  block_score = min(1.0, len(blocks) / 24)
  confidence = 0.50 + (0.18 * length_score) + (0.22 * printable_score) + (0.18 * block_score) - (0.18 * low_quality_ratio)
  return max(0.0, min(0.99, round(confidence, 4)))


def is_low_quality_token(token: str) -> bool:
  if len(token) <= 1:
    return True
  alpha_num = sum(1 for char in token if char.isalnum())
  alpha_ratio = alpha_num / max(1, len(token))
  if alpha_ratio < 0.5:
    return True
  if re.search(r"([A-Za-z])\1\1", token):
    return True
  return bool(re.search(r"[^\w.,:/\-₹$€£]", token))
