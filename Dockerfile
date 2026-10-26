# ========================================================
# CIRCE Local AI Lab - Multi-stage Dockerfile para Render
# ========================================================

# Fase 1: Compilar la aplicación frontend en React + Vite
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Fase 2: Entorno de ejecución en Python 3.11
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    DEMO_MODE=true \
    MODEL_NAME=llama3.2:3b \
    PRESENTATION_MODEL=qwen2.5:7b

# Instalar dependencias de Python (python-pptx, python-docx, pypdf)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el servidor backend
COPY server.py .

# Copiar el frontend compilado desde la fase 1
COPY --from=frontend-builder /app/dist ./dist

# Carpeta para almacenar los archivos generados (.pptx y .docx)
RUN mkdir -p generated

EXPOSE 8080

CMD ["python", "server.py"]

