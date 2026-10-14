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

## Crear presentaciones automaticamente

Escribe en el chat, por ejemplo: `Crea una presentación sobre la tecnología y su impacto en la industria`. La API detecta la intención, pide al modelo un esquema estructurado y genera un archivo `.pptx` descargable. No hay que cambiar de modelo manualmente.

Antes de generarla, la interfaz pregunta por la paleta (`Verde CIRCE`, `Azul técnico`, `Cálida` o `Monocroma`) y el tono (`Profesional`, `Divulgativo`, `Creativo` o `Sarcástico`). El PowerPoint aplica una composición visual con portada, color de marca, tarjetas de contenido, numeración, jerarquía tipográfica y pie de página.

Para el portátil, `llama3.2:3b` sirve para probar el flujo. Para mejorar la generación de JSON y contenido de diapositivas, usa un modelo instruct de 7B cuantizado:

```powershell
ollama pull qwen2.5:7b
```

Añade `PRESENTATION_MODEL=qwen2.5:7b` en `.env` y reinicia `server.py`. La aplicación seleccionará ese modelo automáticamente solo para presentaciones. En el rack se puede sustituir por un modelo mayor sin cambiar la interfaz.

La generación PowerPoint es local. Google Slides requiere añadir OAuth y la API de Google, porque el documento se crea en la cuenta de Google y no puede hacerse completamente offline. El mismo esquema de diapositivas puede reutilizarse para ese adaptador.

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
