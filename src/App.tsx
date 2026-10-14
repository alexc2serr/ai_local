import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { MetricsDashboard } from './components/MetricsDashboard'
import './App.css'

type Message = { role: 'user' | 'assistant'; content: string; meta?: string; downloadUrl?: string }
type PresentationSetup = { topic: string; palette: string; tone: string; density: string }

const useCases = [
  { label: 'Asistente general', icon: '01', description: 'Preguntas y trabajo diario' },
  { label: 'Documentacion tecnica', icon: '02', description: 'Normas, informes y proyectos' },
  { label: 'Analisis energetico', icon: '03', description: 'Datos, hipotesis y calculos' },
]

function getOrCreateClientId(): string {
  let id = localStorage.getItem('circe_client_id')
  if (!id) {
    id = 'usr_' + Math.random().toString(36).substring(2, 8)
    localStorage.setItem('circe_client_id', id)
  }
  return id
}

function MarkdownMessage({ content }: { content: string }) {
  const html = DOMPurify.sanitize(marked.parse(content, { breaks: true }) as string)
  return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
}

function App() {
  const [clientId] = useState<string>(() => getOrCreateClientId())
  const [currentView, setCurrentView] = useState<'chat' | 'metrics'>('chat')
  const [input, setInput] = useState('')
  const [selectedCase, setSelectedCase] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null)
  const [presentationSetup, setPresentationSetup] = useState<PresentationSetup | null>(null)
  const [serverHealth, setServerHealth] = useState<{
    active_users: number
    active_requests: number
    max_slots: number
    model: string
  }>({
    active_users: 1,
    active_requests: 0,
    max_slots: 10,
    model: 'llama3.2:3b',
  })

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hola. Soy CIRCE Local, tu asistente privado para trabajar con conocimiento interno sin sacar los datos de la organizacion. Que necesitas resolver hoy?',
      meta: 'Modelo listo · respuesta local',
    },
  ])

  // Periodic health check for capacity indicator
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`/api/health?client_id=${encodeURIComponent(clientId)}`)
        if (res.ok) {
          const data = await res.json()
          setServerHealth({
            active_users: data.active_users || 1,
            active_requests: data.active_requests || 0,
            max_slots: data.max_concurrency_slots || 10,
            model: data.model || 'llama3.2:3b',
          })
        }
      } catch {
        // server might be offline
      }
    }
    checkHealth()
    const timer = setInterval(checkHealth, 5000)
    return () => clearInterval(timer)
  }, [clientId])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const prompt = input.trim()
    if (!prompt || isSending) return
    setMessages((current) => [...current, { role: 'user', content: prompt }])
    setInput('')
    setIsSending(true)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientId,
        },
        body: JSON.stringify({
          client_id: clientId,
          message: prompt,
          use_case: useCases[selectedCase].label,
        }),
      })
      if (!response.ok) throw new Error('API unavailable')
      const data = await response.json()
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: data.reply,
          meta: `${data.model} · ${data.latency_ms} ms`,
          downloadUrl: data.download_url,
        },
      ])
      if (data.presentation_setup) {
        setPresentationSetup({
          topic: data.presentation_setup.topic,
          palette: 'circe',
          tone: 'profesional',
          density: 'medio',
        })
      }
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content:
            'La interfaz esta lista, pero la API local no responde todavia. Arranca el servidor con `python server.py` para conectar el modelo de Hugging Face mediante Ollama.',
          meta: 'Modo preparacion · API pendiente',
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  async function createPresentation() {
    if (!presentationSetup || isSending) return
    const setup = presentationSetup
    const prompt = `Crear presentación: ${setup.topic} · Paleta: ${setup.palette} · Tono: ${setup.tone} · Texto: ${setup.density}`
    setMessages((current) => [...current, { role: 'user', content: prompt }])
    setPresentationSetup(null)
    setIsSending(true)
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': clientId,
        },
        body: JSON.stringify({
          client_id: clientId,
          message: 'Crear presentación',
          presentation_topic: setup.topic,
          presentation_preferences: {
            palette: setup.palette,
            tone: setup.tone,
            density: setup.density,
          },
          use_case: useCases[selectedCase].label,
        }),
      })
      if (!response.ok) throw new Error('API unavailable')
      const data = await response.json()
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: data.reply,
          meta: `${data.model} · ${data.latency_ms} ms`,
          downloadUrl: data.download_url,
        },
      ])
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'No he podido generar el archivo. Comprueba que el servidor local sigue activo.',
          meta: 'Error de generación',
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  async function copyMessage(content: string, index: number) {
    await navigator.clipboard.writeText(content)
    setCopiedMessage(index)
    window.setTimeout(() => setCopiedMessage(null), 1800)
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">C</div>
        <div className="brand-copy">
          <strong>CIRCE</strong>
          <span>LOCAL AI LAB</span>
        </div>
        <div className="status-chip">
          <span className="status-dot" /> Sistema concurrente
        </div>
        <nav className="nav-list" aria-label="Navegacion principal">
          <button
            className={`nav-item ${currentView === 'chat' ? 'active' : ''}`}
            onClick={() => setCurrentView('chat')}
          >
            <span>💬</span> Asistente IA
          </button>
          <button
            className={`nav-item ${currentView === 'metrics' ? 'active' : ''}`}
            onClick={() => setCurrentView('metrics')}
          >
            <span>📊</span> Eficiencia y Métricas
          </button>
        </nav>
        <section className="sidebar-section">
          <p className="eyebrow">Espacios de trabajo</p>
          <button className="workspace-row selected">
            <span className="workspace-icon orange">E</span>
            <span>Energia y clima</span>
            <b>12</b>
          </button>
          <button className="workspace-row">
            <span className="workspace-icon green">I</span>
            <span>Innovacion</span>
            <b>08</b>
          </button>
          <button className="workspace-row">
            <span className="workspace-icon blue">G</span>
            <span>General CIRCE</span>
            <b>24</b>
          </button>
        </section>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setCurrentView('metrics')}>
            <span>⚡</span> Monitor de Concurrencia
          </button>
          <div className="user-row">
            <div className="avatar">AS</div>
            <div>
              <strong>Alejandro Serrano</strong>
              <small>ID: {clientId.slice(0, 8)}</small>
            </div>
            <span className="more">...</span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div>
            <p className="breadcrumb">
              Workspace / <strong>Energia y clima</strong>
            </p>
            <h1>{currentView === 'chat' ? 'Asistente CIRCE' : 'Panel de Rendimiento'}</h1>
          </div>
          <div className="top-actions">
            <div className="concurrency-badge">
              <span className="status-dot" />
              <span>{serverHealth.active_users} usuarios activos</span>
            </div>
            <button
              className="outline-button"
              onClick={() => setCurrentView('metrics')}
              title="Ver configuración de Cloudflare Tunnel y métricas"
            >
              Compartir acceso Cloudflare <span>↗</span>
            </button>
          </div>
        </header>

        {currentView === 'metrics' ? (
          <MetricsDashboard clientId={clientId} onBackToChat={() => setCurrentView('chat')} />
        ) : (
          <div className="content-wrap">
            <div className="conversation-column">
              <div className="conversation-head">
                <div>
                  <p className="eyebrow">CONVERSACION ACTUAL</p>
                  <h2>Consulta tecnica</h2>
                </div>
                <button className="quiet-button">•••</button>
              </div>

              <div className="messages" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    <div className="message-avatar">{message.role === 'assistant' ? 'C' : 'AS'}</div>
                    <div className="message-body">
                      <div className="message-author">
                        {message.role === 'assistant' ? 'CIRCE Local' : 'Tu'}{' '}
                        {message.role === 'assistant' && <span className="verified">✓ verificado</span>}
                      </div>
                      {message.role === 'assistant' ? (
                        <MarkdownMessage content={message.content} />
                      ) : (
                        <p className="user-message">{message.content}</p>
                      )}
                      {message.role === 'assistant' && (
                        <button
                          className="copy-button"
                          type="button"
                          onClick={() => copyMessage(message.content, index)}
                        >
                          {copiedMessage === index ? '✓ Copiado' : 'Copiar respuesta'}
                        </button>
                      )}
                      {message.downloadUrl && (
                        <a className="download-button" href={message.downloadUrl}>
                          Descargar PowerPoint <span>↓</span>
                        </a>
                      )}
                      {message.meta && <small>{message.meta}</small>}
                    </div>
                  </article>
                ))}

                {isSending && (
                  <article className="message assistant">
                    <div className="message-avatar">C</div>
                    <div className="message-body">
                      <div className="message-author">CIRCE Local</div>
                      <p className="typing">
                        <i />
                        <i />
                        <i />
                      </p>
                    </div>
                  </article>
                )}
              </div>

              {presentationSetup && (
                <div className="presentation-setup">
                  <p className="eyebrow">DISEÑO DE LA PRESENTACIÓN</p>
                  <strong>Elige una paleta</strong>
                  <div className="option-row">
                    {[
                      ['circe', 'Verde CIRCE'],
                      ['azul', 'Azul técnico'],
                      ['calida', 'Cálida'],
                      ['monocroma', 'Monocroma'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={presentationSetup.palette === value ? 'option selected' : 'option'}
                        onClick={() => setPresentationSetup({ ...presentationSetup, palette: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <strong>Tono</strong>
                  <div className="option-row">
                    {['profesional', 'divulgativo', 'creativo', 'sarcástico'].map((tone) => (
                      <button
                        key={tone}
                        className={presentationSetup.tone === tone ? 'option selected' : 'option'}
                        onClick={() => setPresentationSetup({ ...presentationSetup, tone })}
                      >
                        {tone}
                      </button>
                    ))}
                  </div>
                  <strong>Cantidad de texto</strong>
                  <div className="option-row">
                    {[
                      ['poco', 'Poco'],
                      ['medio', 'Medio'],
                      ['mucho', 'Mucho'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className={presentationSetup.density === value ? 'option selected' : 'option'}
                        onClick={() => setPresentationSetup({ ...presentationSetup, density: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button className="create-presentation" onClick={createPresentation}>
                    Crear presentación <span>↗</span>
                  </button>
                </div>
              )}

              <form className="composer" onSubmit={handleSubmit}>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  placeholder="Escribe una consulta para CIRCE Local..."
                  rows={2}
                />
                <div className="composer-footer">
                  <div className="composer-tools">
                    <button type="button" aria-label="Adjuntar archivo">
                      +
                    </button>
                    <span>Enter: nueva linea · Shift+Enter: enviar</span>
                  </div>
                  <button className="send-button" type="submit" disabled={isSending || !input.trim()}>
                    Enviar <span>↗</span>
                  </button>
                </div>
              </form>
            </div>

            <aside className="context-panel">
              <div className="panel-heading">
                <span className="eyebrow">CONFIGURACION</span>
                <span className="live-pill">
                  <span className="status-dot" /> LIVE
                </span>
              </div>
              <h2>Modelo activo</h2>
              <div className="model-card">
                <div className="model-icon">HF</div>
                <div>
                  <strong>{serverHealth.model}</strong>
                  <small>Ollama / Hugging Face</small>
                </div>
                <span className="check">✓</span>
              </div>
              <div className="panel-divider" />
              <p className="eyebrow">CASO DE USO</p>
              <div className="use-case-list">
                {useCases.map((item, index) => (
                  <button
                    key={item.label}
                    className={`use-case ${index === selectedCase ? 'selected' : ''}`}
                    onClick={() => setSelectedCase(index)}
                  >
                    <span className="case-number">{item.icon}</span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    {index === selectedCase && <span className="check">✓</span>}
                  </button>
                ))}
              </div>
              <div className="capacity-card">
                <div>
                  <span>Capacidad Concurrente</span>
                  <strong>
                    {serverHealth.active_requests} / {serverHealth.max_slots} slots en uso
                  </strong>
                </div>
                <div className="capacity-bar">
                  <span
                    style={{
                      width: `${Math.max(
                        10,
                        Math.min(100, (serverHealth.active_requests / serverHealth.max_slots) * 100)
                      )}%`,
                    }}
                  />
                </div>
                <small>
                  {serverHealth.active_users} usuarios conectados simultáneamente
                </small>
              </div>
              <button className="details-button" onClick={() => setCurrentView('metrics')}>
                Ver panel de eficiencia y concurrencia <span>↗</span>
              </button>
            </aside>
          </div>
        )}

        <footer className="main-footer">
          <span>
            <span className="status-dot" /> Concurrencia multiusuario activa · Soporte Cloudflare Tunnel
          </span>
          <span>v0.2.0 · CIRCE AI Lab</span>
        </footer>
      </section>
    </main>
  )
}

export default App
