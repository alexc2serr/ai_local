# CIRCE Local AI Lab

MVP de una interfaz privada para que los equipos de CIRCE consulten un modelo local. La interfaz React no conoce el proveedor: siempre llama a `POST /api/chat`.

## Arranque rapido

En una terminal:

```powershell
python server.py
```

En otra:

```powershell
npm run dev
```

Abre `http://localhost:5173`. Sin Ollama, la API funciona en modo demo y sirve para validar el flujo.

## Modelo local en el portatil

Instala Ollama y descarga un modelo pequeno. Ollama puede gestionar modelos publicados en Hugging Face en formato GGUF; para este hardware conviene empezar con 3B o 4B cuantizado:

```powershell
ollama pull llama3.2:3b
$env:DEMO_MODE="false"
python server.py
```

Para cambiar de modelo, define `MODEL_NAME` antes de arrancar. La UI ya muestra el proveedor y el modelo como parte de la configuracion.

## Concurrencia real (mínimo 5 usuarios simultáneos)

El backend incorpora un gestor multihilo con semáforos de capacidad (`MAX_CONCURRENT_REQUESTS=10`) y telemetría en tiempo real:

1. **Configuración de Ollama para paralelismo**:
   Para que Ollama procese consultas de varios usuarios sin encolarlas secuencialmente, define la variable de entorno antes de iniciar el servicio Ollama:
   ```powershell
   $env:OLLAMA_NUM_PARALLEL="5"
   $env:OLLAMA_MAX_LOADED_MODELS="2"
   ```
2. **Panel de Eficiencia y Métricas Globales**:
   Haz clic en la pestaña **"📊 Eficiencia y Métricas"** en la barra lateral para ver:
   - Gráfico de **pico de usuarios concurrentes** y peticiones por minuto en tiempo real.
   - Gráfico de **rapidez y latencia** media (ms).
   - Tasa de éxito y disponibilidad global.
   - Desglose de carga por casos de uso y generación de PowerPoint.
   - **Prueba de estrés integrada**: lanza 5 peticiones simultáneas con clientes independientes con un solo clic para validar el comportamiento paralelo.

## Acceso remoto con Cloudflare Tunnel

Para compartir la herramienta de forma segura con compañeros de CIRCE (o acceder desde otros portátiles/móviles) sin abrir puertos:

```powershell
# 1. Compilar el frontend para que lo sirva el backend Python
npm run build

# 2. Iniciar el servidor backend
python server.py

# 3. En otra terminal, lanzar el túnel (o ejecutar ./start-cloudflare-tunnel.ps1):
cloudflared tunnel --url http://localhost:8080
```

Cloudflare generará un enlace público HTTPS seguro (`https://xxxx.trycloudflare.com`) con el que hasta 10 usuarios pueden conectarse y trabajar en paralelo.

## Arquitectura

`React/Vite (o dist/ estático) -> server.py (ThreadingHTTPServer + Semaphore + Telemetría) -> Ollama (OLLAMA_NUM_PARALLEL=5) -> Hugging Face GGUF`


El modo demo es intencional: permite validar interfaz, permisos y despliegue antes de consumir memoria del modelo.

## Trabajo Avanzado con Documentos y Presentaciones

### 1. Procesamiento y Análisis de Documentos (PDF, Word DOCX, TXT)

- **Adjuntar documentos locales**: Pulsa el botón `+` o el botón `📎 Adjuntar Documento` en la barra superior para cargar archivos PDF, Word (`.docx`) o de texto plano (`.txt`, `.md`).
- **Extracción local privada**: El backend procesa el documento en memoria mediante `pypdf` y `python-docx` sin enviar información a ningún servicio externo ni salir de la red local.
- **Acciones rápidas en un clic**:
  - `📋 Resumen Ejecutivo`: Estructura un resumen con puntos clave, datos cuantitativos y conclusiones accionables.
  - `🔍 Análisis Técnico`: Evaluación crítica de requisitos, fortalezas, riesgos y metodología.
  - `📊 Convertir en Presentación PPTX`: Genera automáticamente una presentación PowerPoint basada en los contenidos y conclusiones del documento.
  - `📝 Redactar Informe Word`: Genera un informe formal estructurado listo para exportar a `.docx`.

### 2. Exportación Conversacional a Microsoft Word (.docx)

- **Comandos conversacionales naturales**: En cualquier momento de la conversación, pídele al asistente:
  - *"Expórtalo a Word"* o *"Pásalo a Word"*
  - *"Redacta un informe formal sobre esto en Word"*
  El asistente toma el contenido previo o genera el informe técnico y adjunta la tarjeta de descarga del archivo `.docx` directamente en el chat.
- **Plantilla corporativa CIRCE**: Encabezados institucionales (*Fundación CIRCE · Centro Tecnológico*), caja de metadatos, tipografía calibrada, colores corporativos (Verde CIRCE `#108554`, Azul técnico `#2369A5`), listas con viñetas y pie de página de confidencialidad.

### 3. Crear Presentaciones PowerPoint (.pptx) de Nivel Consultoría Ejecutiva

- **Generación conversacional sin modales rígidos**:
  Pídele al chat de forma fluida:
  - *"Conviértelo en presentación"* o *"Haz unas diapositivas sobre esto"*
  - *"Crea una presentación ejecutiva de 5 diapositivas en azul sobre descarbonización"*
  El modelo detectará automáticamente la paleta, el número de diapositivas y el contenido a transformar.
- **Diseño visual avanzado con 7 tipos de diapositivas de consultoría**:
  1. `Portada Hero`: composición asimétrica con panel oscuro contrastado, marca CIRCE, título de alto impacto, subtítulo y tarjeta de índice lateral.
  2. `Agenda Ejecutiva`: pipeline horizontal o tarjetas numeradas con badges de sección.
  3. `Métricas de Impacto (Estilo McKinsey/BCG)`: tarjetas con números gigantes (`48pt`), pestañas de color superior, nombres de métricas en mayúsculas y descripción de impacto.
  4. `Comparativa de Escenarios (Reto vs Solución)`: 2 columnas contrastadas con indicadores de alerta y checkmarks de solución tecnológica CIRCE.
  5. `Pilares Estratégicos`: 3 columnas con bandas de cabecera coloreadas y viñetas estructuradas.
  6. `Hoja de Ruta y Fases`: línea de progresión continua con hitos numerados (`01`, `02`, `03`) y entregables.
  7. `Cierre y Plan de Acción`: panel de identidad corporativa CIRCE con 3 pasos de acción inmediatos y contacto.
- **Personalización interactiva**:
  - **Paletas de color**: `Verde CIRCE`, `Azul técnico`, `Cálida / Energía`, `Púrpura Innovación` y `Monocroma`.
  - **Número de diapositivas**: `Breve (5)`, `Estándar (7)` o `Detallada (10)`.
  - **Tono y densidad**: Ajustable entre profesional, técnico, divulgativo y sintético.

Para mejorar la precisión en presentaciones y documentos complejos en local, se recomienda el modelo instruct:

```powershell
ollama pull qwen2.5:7b
```

Añade `PRESENTATION_MODEL=qwen2.5:7b` en `.env` y reinicia `server.py`.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
