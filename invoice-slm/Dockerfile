FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV SLM_ENGINE=prod_http

WORKDIR /app

COPY invoice-slm/requirements.base.txt /app/requirements.base.txt
COPY invoice-slm/requirements.prod.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r /app/requirements.txt

COPY invoice-slm/server.py /app/server.py
COPY invoice-slm/app /app/app

EXPOSE 8100

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8100"]
