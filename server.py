import collections
import json
import mimetypes
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt


def load_env_file() -> None:
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file()

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
MODEL_NAME = os.getenv("MODEL_NAME", "llama3.2:3b")
PRESENTATION_MODEL = os.getenv("PRESENTATION_MODEL", "qwen2.5:7b")
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
MAX_CONCURRENT_REQUESTS = int(os.getenv("MAX_CONCURRENT_REQUESTS", "10"))
OLLAMA_NUM_PARALLEL = int(os.getenv("OLLAMA_NUM_PARALLEL", "5"))

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "generated")
DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
os.makedirs(OUTPUT_DIR, exist_ok=True)


class MetricsTracker:
    def __init__(self, max_history: int = 50, max_buckets: int = 15):
        self.lock = threading.Lock()
        self.active_requests = 0
        self.peak_active_requests = 0
        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0
        self.total_latency_ms = 0
        self.min_latency_ms: int | None = None
        self.max_latency_ms = 0
        self.total_presentations = 0
        self.active_users: dict[str, float] = {}
        self.peak_active_users = 0
        self.use_case_counts: dict[str, int] = collections.defaultdict(int)
        self.recent_requests: collections.deque = collections.deque(maxlen=max_history)
        self.minute_buckets: collections.OrderedDict[str, dict] = collections.OrderedDict()
        self.max_buckets = max_buckets
        self.req_id_counter = 0

        # Pre-seed with a few baseline timeline points so charts are meaningful upon launch
        now = time.time()
        for i in range(5, -1, -1):
            t_str = time.strftime("%H:%M", time.localtime(now - i * 60))
            self.minute_buckets[t_str] = {
                "time": t_str,
                "requests": 0,
                "total_latency": 0,
                "errors": 0,
                "peak_concurrent": 0,
                "active_users": 1,
            }

    def touch_user(self, client_id: str) -> None:
        if not client_id:
            return
        now = time.time()
        with self.lock:
            self.active_users[client_id] = now
            self._clean_users_locked(now)

    def _clean_users_locked(self, now: float) -> None:
        cutoff = now - 300  # 5 minutes
        self.active_users = {k: v for k, v in self.active_users.items() if v >= cutoff}
        count = len(self.active_users)
        if count > self.peak_active_users:
            self.peak_active_users = count

    def start_request(self, client_id: str) -> tuple[int, float]:
        now = time.time()
        with self.lock:
            self.active_requests += 1
            if self.active_requests > self.peak_active_requests:
                self.peak_active_requests = self.active_requests
            if client_id:
                self.active_users[client_id] = now
            self._clean_users_locked(now)
            self.req_id_counter += 1
            req_id = self.req_id_counter
        return req_id, now

    def end_request(
        self,
        req_id: int,
        client_id: str,
        use_case: str,
        latency_ms: int,
        status_code: int,
        mode: str,
        is_presentation: bool,
    ) -> None:
        now = time.time()
        minute_key = time.strftime("%H:%M", time.localtime(now))
        is_success = 200 <= status_code < 400

        with self.lock:
            self.active_requests = max(0, self.active_requests - 1)
            self.total_requests += 1
            if is_success:
                self.successful_requests += 1
            else:
                self.failed_requests += 1

            self.total_latency_ms += latency_ms
            if self.min_latency_ms is None or latency_ms < self.min_latency_ms:
                self.min_latency_ms = latency_ms
            if latency_ms > self.max_latency_ms:
                self.max_latency_ms = latency_ms

            if is_presentation:
                self.total_presentations += 1
                self.use_case_counts["Presentaciones"] += 1
            elif use_case:
                self.use_case_counts[use_case] += 1

            if client_id:
                self.active_users[client_id] = now
            self._clean_users_locked(now)

            self.recent_requests.appendleft(
                {
                    "id": f"req-{req_id}",
                    "timestamp": time.strftime("%H:%M:%S", time.localtime(now)),
                    "client_id": client_id[-6:] if client_id else "anon",
                    "use_case": "Presentación" if is_presentation else use_case,
                    "latency_ms": latency_ms,
                    "status": status_code,
                    "mode": mode,
                    "is_presentation": is_presentation,
                }
            )

            bucket = self.minute_buckets.get(minute_key)
            if not bucket:
                if len(self.minute_buckets) >= self.max_buckets:
                    self.minute_buckets.popitem(last=False)
                bucket = {
                    "time": minute_key,
                    "requests": 0,
                    "total_latency": 0,
                    "errors": 0,
                    "peak_concurrent": self.active_requests + 1,
                    "active_users": max(1, len(self.active_users)),
                }
                self.minute_buckets[minute_key] = bucket

            bucket["requests"] += 1
            bucket["total_latency"] += latency_ms
            if not is_success:
                bucket["errors"] += 1
            bucket["peak_concurrent"] = max(bucket["peak_concurrent"], self.active_requests + 1)
            bucket["active_users"] = max(bucket["active_users"], len(self.active_users))

    def get_summary(self) -> dict:
        now = time.time()
        with self.lock:
            self._clean_users_locked(now)
            avg_latency = (
                round(self.total_latency_ms / self.total_requests)
                if self.total_requests > 0
                else 0
            )
            success_rate = (
                round((self.successful_requests / self.total_requests) * 100, 1)
                if self.total_requests > 0
                else 100.0
            )

            timeline = []
            for minute_key, bucket in self.minute_buckets.items():
                reqs = bucket["requests"]
                avg_l = round(bucket["total_latency"] / reqs) if reqs > 0 else 0
                timeline.append(
                    {
                        "time": bucket["time"],
                        "requests": reqs,
                        "avg_latency_ms": avg_l,
                        "peak_concurrent": bucket["peak_concurrent"],
                        "active_users": bucket["active_users"],
                        "errors": bucket["errors"],
                    }
                )

            active_users_count = max(len(self.active_users), 1 if self.active_requests > 0 else 0)
            peak_users_count = max(self.peak_active_users, active_users_count)

            return {
                "summary": {
                    "active_requests": self.active_requests,
                    "peak_active_requests": self.peak_active_requests,
                    "active_users_5m": active_users_count,
                    "peak_active_users": peak_users_count,
                    "total_requests": self.total_requests,
                    "successful_requests": self.successful_requests,
                    "failed_requests": self.failed_requests,
                    "success_rate_percent": success_rate,
                    "avg_latency_ms": avg_latency,
                    "min_latency_ms": self.min_latency_ms if self.min_latency_ms is not None else 0,
                    "max_latency_ms": self.max_latency_ms,
                    "total_presentations": self.total_presentations,
                    "max_concurrency_slots": MAX_CONCURRENT_REQUESTS,
                    "ollama_parallel_slots": OLLAMA_NUM_PARALLEL,
                    "mode": "demo" if DEMO_MODE else "ollama",
                    "model": MODEL_NAME,
                    "presentation_model": PRESENTATION_MODEL,
                },
                "by_use_case": dict(self.use_case_counts),
                "timeline": timeline,
                "recent_requests": list(self.recent_requests),
            }


metrics_tracker = MetricsTracker()
concurrency_semaphore = threading.BoundedSemaphore(MAX_CONCURRENT_REQUESTS)


def ollama_chat(message: str, use_case: str, model: str = MODEL_NAME) -> str:
    payload = json.dumps(
        {
            "model": model,
            "stream": False,
            "messages": [
                {
                    "role": "system",
                    "content": f"Eres CIRCE Local. Contexto: {use_case}. Responde en espanol, con precision y brevedad.",
                },
                {"role": "user", "content": message},
            ],
        }
    ).encode("utf-8")
    request = Request(f"{OLLAMA_URL}/api/chat", data=payload, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))["message"]["content"]


def is_presentation_request(message: str) -> bool:
    terms = ("presentación", "presentacion", "powerpoint", "diapositivas", "slides", "pptx")
    return any(term in message.lower() for term in terms)


THEMES = {
    "circe": {"background": "F3F7F2", "ink": "17352B", "accent": "16805C", "secondary": "D8EBDD", "highlight": "E99645"},
    "azul": {"background": "F1F5FA", "ink": "142B45", "accent": "2369A5", "secondary": "D9E8F5", "highlight": "E5A93D"},
    "calida": {"background": "FFF7EE", "ink": "442C25", "accent": "C75B39", "secondary": "F5D9C8", "highlight": "E3A52F"},
    "monocroma": {"background": "F4F4F2", "ink": "202522", "accent": "353B38", "secondary": "D9DDDA", "highlight": "8A948E"},
}


def color(value: str) -> RGBColor:
    return RGBColor.from_string(value)


def add_text(
    slide,
    text: str,
    left: float,
    top: float,
    width: float,
    height: float,
    size: int,
    fill: str,
    bold: bool = False,
    font: str = "Aptos",
    align=PP_ALIGN.LEFT,
):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    frame = box.text_frame
    frame.clear()
    frame.word_wrap = True
    paragraph = frame.paragraphs[0]
    paragraph.text = text
    paragraph.alignment = align
    paragraph.font.name = font
    paragraph.font.size = Pt(size)
    paragraph.font.bold = bold
    paragraph.font.color.rgb = color(fill)
    return box


def create_presentation(topic: str, slides: list[dict], preferences: dict) -> str:
    presentation = Presentation()
    presentation.slide_width = Inches(13.333)
    presentation.slide_height = Inches(7.5)
    theme = THEMES.get(preferences.get("palette", "circe"), THEMES["circe"])
    density = preferences.get("density", "medio")
    bullet_limit = {"poco": 2, "medio": 3, "mucho": 5}.get(density, 3)
    bullet_size = {"poco": 20, "medio": 16, "mucho": 12}.get(density, 16)
    for index, slide_data in enumerate(slides):
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        background = slide.background.fill
        background.solid()
        background.fore_color.rgb = color(theme["background"])
        if index == 0:
            shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(4.1), Inches(7.5))
            shape.fill.solid()
            shape.fill.fore_color.rgb = color(theme["accent"])
            shape.line.fill.background()
            circle = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(10.6), Inches(-0.9), Inches(3.7), Inches(3.7))
            circle.fill.solid()
            circle.fill.fore_color.rgb = color(theme["secondary"])
            circle.line.fill.background()
            add_text(slide, "CIRCE / LOCAL AI LAB", 0.65, 0.8, 2.8, 0.4, 11, "FFFFFF", True)
            add_text(slide, str(slide_data.get("title", topic)), 4.8, 2.1, 7.6, 1.7, 34, theme["ink"], True)
            add_text(slide, str(slide_data.get("subtitle", "Presentación generada para CIRCE")), 4.85, 4.25, 6.8, 0.8, 19, theme["accent"])
            add_text(slide, str(preferences.get("tone", "profesional")).capitalize(), 4.85, 6.45, 3, 0.3, 10, theme["highlight"], True)
        elif slide_data.get("kind") == "closing" or index == len(slides) - 1:
            band = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(3.2), Inches(7.5))
            band.fill.solid()
            band.fill.fore_color.rgb = color(theme["accent"])
            band.line.fill.background()
            add_text(slide, "CIRCE / LOCAL AI LAB", 0.65, 0.85, 2.1, 0.4, 11, "FFFFFF", True)
            add_text(slide, "Gracias", 4.25, 2.05, 7.6, 0.8, 40, theme["ink"], True)
            add_text(slide, str(slide_data.get("subtitle", "Preguntas y próximos pasos")), 4.3, 3.25, 7.2, 0.8, 22, theme["accent"])
            add_text(slide, "Conocimiento que se convierte en acción.", 4.3, 5.7, 6.5, 0.4, 15, theme["highlight"], True)
        else:
            layout_type = (index - 1) % 3
            slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.18)).fill.solid()
            top_bar = slide.shapes[-1]
            top_bar.fill.fore_color.rgb = color(theme["accent"])
            top_bar.line.fill.background()
            add_text(slide, str(slide_data.get("title", "Idea principal")), 0.75, 0.62, 10.8, 0.7, 25, theme["ink"], True)
            add_text(slide, f"{index:02d}  /  CIRCE LOCAL AI LAB", 10.7, 0.72, 1.8, 0.3, 8, theme["accent"], True, align=PP_ALIGN.RIGHT)
            bullets = slide_data.get("bullets", [])[:bullet_limit]
            if layout_type == 0:
                quote = "\n\n".join(str(bullet) for bullet in bullets)
                add_text(slide, quote, 1.05, 2.0, 10.9, 2.8, bullet_size + 8, theme["accent"], True, font="Georgia")
                add_text(slide, "Una idea central para recordar", 1.08, 5.55, 5.5, 0.35, 11, theme["highlight"], True)
            elif layout_type == 1:
                panel = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.85), Inches(1.7), Inches(4.0), Inches(4.25))
                panel.fill.solid()
                panel.fill.fore_color.rgb = color(theme["accent"])
                panel.line.fill.background()
                add_text(slide, "EN RESUMEN", 1.2, 2.15, 2.4, 0.35, 11, "FFFFFF", True)
                add_text(slide, str(slide_data.get("subtitle", "La oportunidad")), 1.2, 2.75, 2.9, 1.7, 25, "FFFFFF", True, font="Georgia")
                for bullet_index, bullet in enumerate(bullets):
                    top = 1.9 + bullet_index * 1.22
                    add_text(slide, f"0{bullet_index + 1}", 5.55, top, 0.5, 0.35, 11, theme["highlight"], True)
                    add_text(slide, str(bullet), 6.2, top, 5.65, 0.75, bullet_size, theme["ink"], True)
            else:
                for bullet_index, bullet in enumerate(bullets):
                    left = 0.85 + (bullet_index % 2) * 6.05
                    top = 1.75 + (bullet_index // 2) * 2.05
                    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(5.25), Inches(1.45))
                    card.fill.solid()
                    card.fill.fore_color.rgb = color("FFFFFF")
                    card.line.color.rgb = color(theme["secondary"])
                    marker = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(left + 0.25), Inches(top + 0.28), Inches(0.42), Inches(0.42))
                    marker.fill.solid()
                    marker.fill.fore_color.rgb = color(theme["highlight"])
                    marker.line.fill.background()
                    add_text(slide, str(bullet), left + 0.85, top + 0.25, 4.05, 0.85, bullet_size, theme["ink"], True)
            add_text(slide, "CIRCE  ·  Conocimiento que se convierte en acción", 0.85, 6.85, 6.5, 0.25, 8, theme["accent"])
    safe_topic = re.sub(r"[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ_-]+", "-", topic).strip("-").lower()[:50] or "presentacion"
    filename = f"{safe_topic}-{int(time.time())}.pptx"
    presentation.save(os.path.join(OUTPUT_DIR, filename))
    return filename


def presentation_plan(message: str, preferences: dict) -> list[dict]:
    fallback = [
        {"title": message[:70], "subtitle": "Una mirada clara para tomar mejores decisiones"},
        {"title": "Contexto y oportunidad", "bullets": ["Situación actual y retos principales", "Datos y tendencias relevantes", "Por qué es importante actuar ahora"]},
        {"title": "Propuesta tecnológica", "bullets": ["Arquitectura y componentes principales", "Integración con los sistemas existentes", "Seguridad y privacidad de los datos"]},
        {"title": "Plan de implementación", "bullets": ["Piloto inicial y validación", "Escalado progresivo a los equipos", "Medición de resultados y mejora continua"]},
        {"title": "Próximos pasos", "bullets": ["Definir alcance y responsables", "Seleccionar datos de prueba", "Acordar calendario del piloto"]},
        {"kind": "closing", "title": "Cierre", "subtitle": "Preguntas y próximos pasos"},
    ]
    if DEMO_MODE:
        return fallback
    prompt = (
        "Devuelve SOLO JSON valido, sin markdown, con este formato: "
        '{"slides":[{"title":"...","subtitle":"...","bullets":["..."]}]}. '
        "Crea 5-7 diapositivas para esta solicitud. La primera usa subtitle y las siguientes bullets. "
        'La última debe ser {"kind":"closing","title":"Cierre","subtitle":"Preguntas y próximos pasos"}. '
        f"Tono: {preferences.get('tone', 'profesional')}. Densidad de texto: {preferences.get('density', 'medio')}. Solicitud: {message}"
    )
    try:
        raw = ollama_chat(prompt, "Generación de presentaciones", PRESENTATION_MODEL)
        start, end = raw.find("{"), raw.rfind("}")
        parsed = json.loads(raw[start : end + 1])
        slides = parsed.get("slides", [])
        if slides and all(isinstance(slide, dict) for slide in slides):
            if slides[-1].get("kind") != "closing":
                slides.append({"kind": "closing", "title": "Cierre", "subtitle": "Preguntas y próximos pasos"})
            return slides
    except Exception:
        pass
    return fallback


def generate_presentation(message: str, preferences: dict) -> tuple[str, str]:
    slides = presentation_plan(message, preferences)
    filename = create_presentation(message, slides, preferences)
    return (
        filename,
        f"He creado una presentación PowerPoint con {len(slides)} diapositivas, estilo {preferences.get('tone', 'profesional')}, densidad {preferences.get('density', 'medio')} y paleta {preferences.get('palette', 'circe')}.",
    )


class Handler(BaseHTTPRequestHandler):
    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Client-Id")

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        client_id = self.headers.get("X-Client-Id") or (query.get("client_id", [None])[0])
        if client_id:
            metrics_tracker.touch_user(client_id)

        if path == "/api/health":
            summary = metrics_tracker.get_summary()["summary"]
            self.send_json(
                200,
                {
                    "status": "ok",
                    "model": MODEL_NAME,
                    "mode": "demo" if DEMO_MODE else "ollama",
                    "active_users": summary["active_users_5m"],
                    "active_requests": summary["active_requests"],
                    "max_concurrency_slots": MAX_CONCURRENT_REQUESTS,
                    "ollama_parallel_slots": OLLAMA_NUM_PARALLEL,
                },
            )
            return

        if path == "/api/metrics":
            data = metrics_tracker.get_summary()
            self.send_json(200, data)
            return

        if path.startswith("/generated/"):
            filename = os.path.basename(path.removeprefix("/generated/"))
            file_path = os.path.join(OUTPUT_DIR, filename)
            if os.path.isfile(file_path):
                with open(file_path, "rb") as generated_file:
                    body = generated_file.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(body)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(body)
                return
            self.send_json(404, {"error": "file not found"})
            return

        # Serve static assets from Vite dist/ build if available
        if os.path.isdir(DIST_DIR):
            relative_path = path.lstrip("/")
            file_path = os.path.join(DIST_DIR, relative_path)
            if not os.path.isfile(file_path):
                file_path = os.path.join(DIST_DIR, "index.html")

            if os.path.isfile(file_path):
                mime_type, _ = mimetypes.guess_type(file_path)
                if not mime_type:
                    mime_type = "application/octet-stream"
                try:
                    with open(file_path, "rb") as static_file:
                        content = static_file.read()
                    self.send_response(200)
                    self.send_header("Content-Type", mime_type)
                    self.send_header("Content-Length", str(len(content)))
                    self.send_cors_headers()
                    self.end_headers()
                    self.wfile.write(content)
                    return
                except Exception as e:
                    self.send_json(500, {"error": "Error reading static file", "detail": str(e)})
                    return

        self.send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path == "/api/heartbeat":
            size = int(self.headers.get("Content-Length", "0"))
            client_id = None
            if size > 0:
                try:
                    body = json.loads(self.rfile.read(size))
                    client_id = body.get("client_id")
                except Exception:
                    pass
            client_id = client_id or self.headers.get("X-Client-Id")
            if client_id:
                metrics_tracker.touch_user(client_id)
            self.send_json(200, {"status": "ok", "client_id": client_id})
            return

        if self.path != "/api/chat":
            self.send_json(404, {"error": "not found"})
            return

        # Check concurrency capacity
        acquired = concurrency_semaphore.acquire(timeout=25)
        if not acquired:
            self.send_json(
                429,
                {
                    "error": "Capacidad máxima de concurrencia alcanzada",
                    "detail": f"Hay {MAX_CONCURRENT_REQUESTS} peticiones procesándose en paralelo. Por favor, reintenta en unos instantes.",
                },
            )
            return

        client_id = self.headers.get("X-Client-Id", "anon")
        started = time.perf_counter()
        req_id = 0
        use_case = "Asistente general"
        is_presentation = False
        mode = "demo" if DEMO_MODE else "ollama"

        try:
            size = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(size))
            client_id = str(data.get("client_id") or client_id)
            req_id, _ = metrics_tracker.start_request(client_id)

            message = str(data.get("message", "")).strip()
            presentation_topic = str(data.get("presentation_topic", "")).strip()
            presentation_preferences = data.get("presentation_preferences") or {}
            use_case = str(data.get("use_case", "Asistente general"))

            if not message:
                latency_ms = round((time.perf_counter() - started) * 1000)
                metrics_tracker.end_request(req_id, client_id, use_case, latency_ms, 400, mode, False)
                self.send_json(400, {"error": "message is required"})
                return

            if is_presentation_request(message) and not presentation_preferences:
                reply = "Antes de crearla, elige el estilo visual y el tono. Puedes cambiar estas opciones y después pulsar Crear presentación."
                download_url = None
                presentation_setup = {
                    "topic": message,
                    "palettes": list(THEMES.keys()),
                    "tones": ["profesional", "divulgativo", "creativo", "sarcástico"],
                }
            elif presentation_topic:
                is_presentation = True
                filename, reply = generate_presentation(presentation_topic, presentation_preferences)
                download_url = f"/generated/{filename}"
                presentation_setup = None
            elif is_presentation_request(message):
                is_presentation = True
                filename, reply = generate_presentation(message, presentation_preferences)
                download_url = f"/generated/{filename}"
                presentation_setup = None
            elif DEMO_MODE:
                reply = f"He recibido tu consulta sobre {use_case.lower()}. Este es el modo demo: conecta Ollama y cambia DEMO_MODE=false para obtener una respuesta del modelo local."
                download_url = None
                presentation_setup = None
            else:
                reply = ollama_chat(message, use_case)
                download_url = None
                presentation_setup = None

            latency_ms = round((time.perf_counter() - started) * 1000)
            metrics_tracker.end_request(req_id, client_id, use_case, latency_ms, 200, mode, is_presentation)

            response = {
                "reply": reply,
                "model": MODEL_NAME,
                "mode": mode,
                "latency_ms": latency_ms,
                "client_id": client_id,
            }
            if download_url:
                response["download_url"] = download_url
            if presentation_setup:
                response["presentation_setup"] = presentation_setup
            self.send_json(200, response)

        except Exception as error:
            latency_ms = round((time.perf_counter() - started) * 1000)
            if req_id > 0:
                metrics_tracker.end_request(req_id, client_id, use_case, latency_ms, 502, mode, is_presentation)
            self.send_json(502, {"error": "model unavailable", "detail": str(error)})

        finally:
            concurrency_semaphore.release()


if __name__ == "__main__":
    print("=" * 60)
    print(" CIRCE Local AI Lab - Servidor Concurrente")
    print(f" URL local:        http://{HOST}:{PORT}")
    print(f" Modo:             {'DEMO' if DEMO_MODE else 'OLLAMA LOCAL'}")
    print(f" Modelo Chat:      {MODEL_NAME}")
    print(f" Modelo Slides:    {PRESENTATION_MODEL}")
    print(f" Concurrencia Max: {MAX_CONCURRENT_REQUESTS} slots paralelos")
    print(f" Ollama Parallel:  {OLLAMA_NUM_PARALLEL} workers")
    if os.path.isdir(DIST_DIR):
        print(f" Frontend:         Servido automáticamente desde dist/")
    print("=" * 60)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()