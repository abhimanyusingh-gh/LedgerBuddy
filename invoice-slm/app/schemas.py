from typing import Any, Literal
from pydantic import BaseModel, Field


class VerifyInvoiceRequest(BaseModel):
  parsed: dict[str, Any] = Field(default_factory=dict)
  ocrText: str = ""
  ocrBlocks: list[dict[str, Any]] = Field(default_factory=list)
  mode: Literal["strict", "relaxed"] = "strict"
  hints: dict[str, Any] = Field(default_factory=dict)


class VerifyInvoiceResponse(BaseModel):
  parsed: dict[str, Any]
  issues: list[str]
  changedFields: list[str]
  reasonCodes: dict[str, str] = Field(default_factory=dict)
  invoiceType: str = "other"
  usage: dict[str, Any] | None = None
