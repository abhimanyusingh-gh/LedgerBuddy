from contextvars import ContextVar, Token
from datetime import datetime, timezone
import json
import logging
import sys

SERVICE_NAME = "ocr"
_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


class JsonFormatter(logging.Formatter):
  def format(self, record: logging.LogRecord) -> str:
    payload: dict[str, object] = {
      "time": datetime.now(timezone.utc).isoformat(),
      "level": record.levelname.lower(),
      "service": SERVICE_NAME,
      "message": record.getMessage()
    }
    correlation_id = get_correlation_id()
    if correlation_id:
      payload["correlationId"] = correlation_id
    fields = getattr(record, "fields", None)
    if isinstance(fields, dict) and len(fields) > 0:
      payload["context"] = fields
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


LOGGER = logging.getLogger(SERVICE_NAME)
if not LOGGER.handlers:
  handler = logging.StreamHandler(sys.stdout)
  handler.setFormatter(JsonFormatter())
  LOGGER.addHandler(handler)
LOGGER.setLevel(logging.INFO)
LOGGER.propagate = False


def set_correlation_id(correlation_id: str) -> Token[str]:
  return _correlation_id.set(correlation_id.strip())


def reset_correlation_id(token: Token[str]) -> None:
  _correlation_id.reset(token)


def get_correlation_id() -> str:
  return _correlation_id.get().strip()


def log_info(message: str, **fields: object) -> None:
  LOGGER.info(message, extra={"fields": fields})


def log_error(message: str, **fields: object) -> None:
  LOGGER.error(message, extra={"fields": fields})
