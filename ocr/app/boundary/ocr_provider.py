from abc import ABC, abstractmethod
from typing import Any


class OCRProvider(ABC):
  @abstractmethod
  def startup(self) -> None:
    raise NotImplementedError

  @abstractmethod
  def health(self) -> dict[str, Any]:
    raise NotImplementedError

  @abstractmethod
  def list_models(self) -> list[dict[str, Any]]:
    raise NotImplementedError

  @abstractmethod
  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]:
    raise NotImplementedError
