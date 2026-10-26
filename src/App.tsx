import { useState, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { MetricsDashboard } from './components/MetricsDashboard'
import './App.css'

type Message = {
  role: 'user' | 'assistant'
  content: string
  meta?: string
  downloadUrl?: string
  docxDownloadUrl?: string
  attachedDocName?: string
}

type AttachedDocument = {
  filename: string
  extension: string
  page_count: number
  word_count: number
  char_count: number
  preview: string
  text: string
}

const useCases = [
  { label: 'Asistente general', icon: '01', description: 'Consultas y soporte diario CIRCE' },
  { label: 'Documentación e Informes', icon: '02', description: 'Análisis de PDF/Word, actas y redacción técnica' },
  { label: 'Presentaciones Ejecutivas', icon: '03', description: 'Generación de PowerPoint PPTX corporativo' },
  { label: 'Análisis energético y datos', icon: '04', description: 'Cálculos, normativas y modelos' },
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
  const [isUploadingDoc, setIsUploadingDoc] = useState(false)
  const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null)
  const [copiedMessage, setCopiedMessage] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
        '**Bienvenido a CIRCE Local AI Lab**.\n\nSoy tu asistente privado optimizado para trabajar con **documentos técnicos** (PDF, Word, TXT) y **presentaciones ejecutivas** (PowerPoint .pptx) con máxima confidencialidad local.\n\n### ¿Cómo trabajar conmigo de forma natural?\n- 📎 **Adjunta documentos** con el botón `+` para analizarlos o compararlos.\n- 📝 **Pídeme un documento o exportación**: simplemente di *"Expórtalo a Word"* o *"Redacta un informe sobre esto en Word"* y te facilitaré el archivo `.docx` formal listo para descargar.\n- 📊 **Pídeme una presentación**: escribe *"Conviértelo en presentación"*, *"Haz unas diapositivas sobre esto"* o *"Crea una presentación ejecutiva de 5 slides"* y diseñaré el PowerPoint con métricas e infografías CIRCE.',
      meta: 'Modelo listo · Procesamiento privado local',
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

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setIsUploadingDoc(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string) || ''
          const res = await fetch('/api/upload-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              mime_type: file.type,
              content_base64: base64Data,
            }),
          })
          if (!res.ok) throw new Error('Error al procesar el archivo')
          const docData: AttachedDocument = await res.json()
          setAttachedDoc(docData)
          setSelectedCase(1)
        } catch {
          alert('No se pudo procesar el documento en el servidor.')
        } finally {
          setIsUploadingDoc(false)
        }
      }
      reader.readAsDataURL(file)
    } catch {
      setIsUploadingDoc(false)
      alert('Error al leer el archivo en el navegador.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>, overridePrompt?: string) {
    if (event) event.preventDefault()
    const prompt = (overridePrompt ?? input).trim()
    if (!prompt || isSending) return

    const currentDoc = attachedDoc
    const nextUserMessage: Message = {
      role: 'user',
      content: prompt,
      attachedDocName: currentDoc?.filename,
    }

    const updatedMessages = [...messages, nextUserMessage]
    setMessages(updatedMessages)
    if (!overridePrompt) setInput('')
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
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          use_case: useCases[selectedCase].label,
          document_context: currentDoc
            ? {
                filename: currentDoc.filename,
                text: currentDoc.text,
                page_count: currentDoc.page_count,
                word_count: currentDoc.word_count,
              }
            : null,
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
          docxDownloadUrl: data.docx_download_url,
        },
      ])
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content:
            'La interfaz está lista, pero la API local no responde todavía. Arranca el servidor con `python server.py` para conectar el modelo de Hugging Face mediante Ollama.',
          meta: 'Modo preparación · API pendiente',
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
      {/* Hidden file input for uploading PDF, DOCX, TXT */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.docx,.doc,.txt,.md,.csv,.json"
        style={{ display: 'none' }}
      />

      <aside className="sidebar">
        <div className="brand-mark">C</div>
        <div className="brand-copy">
          <strong>CIRCE</strong>
          <span>LOCAL AI LAB</span>
        </div>
        <div className="status-chip">
          <span className="status-dot" /> Sistema privado
        </div>
        <nav className="nav-list" aria-label="Navegación principal">
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
            <span className="workspace-icon green">D</span>
            <span>Documentos e Informes</span>
            <b>14</b>
          </button>
          <button className="workspace-row">
            <span className="workspace-icon orange">P</span>
            <span>Presentaciones PPTX</span>
            <b>09</b>
          </button>
          <button className="workspace-row">
            <span className="workspace-icon blue">E</span>
            <span>Energía e Industria</span>
            <b>22</b>
          </button>
        </section>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setCurrentView('metrics')}>
            <span>⚡</span> Monitor de Rendimiento
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
              Workspace / <strong>{useCases[selectedCase].label}</strong>
            </p>
            <h1>{currentView === 'chat' ? 'Asistente de Documentos y Presentaciones' : 'Panel de Rendimiento'}</h1>
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
                  <p className="eyebrow">SESIÓN ACTIVA</p>
                  <h2>Trabajo con Documentos & Diapositivas</h2>
                </div>
                <div className="quick-actions-bar">
                  <button
                    className="outline-button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Subir documento PDF, Word o TXT"
                  >
                    📎 Adjuntar Documento
                  </button>
                </div>
              </div>

              <div className="messages" aria-live="polite">
                {messages.map((message, index) => (
                  <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                    <div className="message-avatar">{message.role === 'assistant' ? 'C' : 'AS'}</div>
                    <div className="message-body">
                      <div className="message-author">
                        {message.role === 'assistant' ? 'CIRCE Local' : 'Tú'}{' '}
                        {message.role === 'assistant' && <span className="verified">✓ confidencial</span>}
                      </div>

                      {message.attachedDocName && (
                        <div className="message-attachment-tag">
                          <span>📄 Archivo adjunto:</span> <strong>{message.attachedDocName}</strong>
                        </div>
                      )}

                      {message.role === 'assistant' ? (
                        <MarkdownMessage content={message.content} />
                      ) : (
                        <p className="user-message">{message.content}</p>
                      )}

                      {/* Download cards if files were generated conversationally */}
                      {message.downloadUrl && (
                        <div className="download-card pptx">
                          <div className="download-card-icon">PPTX</div>
                          <div className="download-card-info">
                            <strong>Presentación PowerPoint generada</strong>
                            <small>Diseño ejecutivo de consultoría con infografías, métricas y portada CIRCE</small>
                          </div>
                          <a className="download-action-btn" href={message.downloadUrl} download>
                            Descargar PPTX <span>↓</span>
                          </a>
                        </div>
                      )}

                      {message.docxDownloadUrl && (
                        <div className="download-card docx">
                          <div className="download-card-icon">DOCX</div>
                          <div className="download-card-info">
                            <strong>Informe Word (.docx) preparado</strong>
                            <small>Estructura ejecutiva formal con plantilla institucional CIRCE</small>
                          </div>
                          <a className="download-action-btn" href={message.docxDownloadUrl} download>
                            Descargar Word <span>↓</span>
                          </a>
                        </div>
                      )}

                      {/* Toolbar action on assistant responses */}
                      {message.role === 'assistant' && (
                        <div className="message-action-toolbar">
                          <button
                            className="toolbar-btn"
                            type="button"
                            onClick={() => copyMessage(message.content, index)}
                          >
                            {copiedMessage === index ? '✓ Copiado' : '📋 Copiar respuesta'}
                          </button>
                        </div>
                      )}

                      {message.meta && <small className="message-meta-tag">{message.meta}</small>}
                    </div>
                  </article>
                ))}

                {isSending && (
                  <article className="message assistant">
                    <div className="message-avatar">C</div>
                    <div className="message-body">
                      <div className="message-author">CIRCE Local</div>
                      <div className="typing-indicator">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-label">Procesando consulta y generando entregables...</span>
                      </div>
                    </div>
                  </article>
                )}
              </div>

              {/* Composer */}
              <div className="composer-wrapper">
                {/* Attached file status banner */}
                {attachedDoc && (
                  <div className="attached-doc-banner">
                    <div className="doc-icon">
                      {attachedDoc.extension.toUpperCase().replace('.', '') || 'DOC'}
                    </div>
                    <div className="doc-info">
                      <strong>{attachedDoc.filename}</strong>
                      <small>
                        {attachedDoc.page_count} {attachedDoc.page_count === 1 ? 'página' : 'páginas'} ·{' '}
                        {attachedDoc.word_count.toLocaleString()} palabras · Listo para consultas y exportación
                      </small>
                    </div>
                    <button
                      className="remove-doc-btn"
                      onClick={() => setAttachedDoc(null)}
                      title="Quitar archivo adjunto"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Quick prompt suggestions when document is attached */}
                {attachedDoc && (
                  <div className="doc-quick-prompts">
                    <span className="quick-label">Sugerencias:</span>
                    <button
                      type="button"
                      className="quick-prompt-pill"
                      onClick={() =>
                        handleSubmit(
                          undefined,
                          'Elabora un resumen ejecutivo de este documento destacando los hallazgos principales, datos clave y conclusiones.'
                        )
                      }
                    >
                      📋 Resumir puntos clave
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-pill"
                      onClick={() =>
                        handleSubmit(
                          undefined,
                          'Realiza un análisis técnico exhaustivo del documento adjunto, identificando fortalezas, riesgos y metodología.'
                        )
                      }
                    >
                      🔍 Análisis técnico y riesgos
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-pill"
                      onClick={() =>
                        handleSubmit(
                          undefined,
                          'Redacta un informe formal estructurado para CIRCE basado en este documento y expórtalo a Word.'
                        )
                      }
                    >
                      📝 Redactar informe en Word
                    </button>
                    <button
                      type="button"
                      className="quick-prompt-pill"
                      onClick={() =>
                        handleSubmit(
                          undefined,
                          'Crea una presentación ejecutiva en diapositivas PowerPoint sobre este documento con métricas y conclusiones.'
                        )
                      }
                    >
                      📊 Crear presentación PPTX
                    </button>
                  </div>
                )}

                <form className="composer" onSubmit={(e) => handleSubmit(e)}>
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                    placeholder={
                      attachedDoc
                        ? `Pregunta sobre '${attachedDoc.filename}', pide "expórtalo a Word" o "haz una presentación"...`
                        : "Escribe tu consulta. Pide 'expórtalo a Word' o 'crea una presentación sobre...' para generar archivos."
                    }
                    rows={2}
                  />
                  <div className="composer-footer">
                    <div className="composer-tools">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploadingDoc}
                        title="Adjuntar documento (PDF, DOCX, TXT)"
                      >
                        {isUploadingDoc ? '⏳' : '+'}
                      </button>
                      <span>
                        {isUploadingDoc
                          ? 'Extrayendo contenido del documento...'
                          : 'Enter: enviar · Pide por chat "expórtalo a Word" o "haz una presentación de esto"'}
                      </span>
                    </div>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={isSending || (!input.trim() && !attachedDoc)}
                    >
                      Enviar <span>↗</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <aside className="context-panel">
              <div className="panel-heading">
                <span className="eyebrow">CONFIGURACIÓN</span>
                <span className="live-pill">
                  <span className="status-dot" /> LOCAL
                </span>
              </div>
              <h2>Capacidades IA</h2>

              <div className="model-card">
                <div className="model-icon">HF</div>
                <div>
                  <strong>{serverHealth.model}</strong>
                  <small>Motor de Inferencia Local</small>
                </div>
                <span className="check">✓</span>
              </div>

              <div className="feature-badges-card">
                <div className="badge-item">
                  <span className="badge-bullet green" />
                  <span>Procesador Documental (PDF, Word & TXT)</span>
                </div>
                <div className="badge-item">
                  <span className="badge-bullet orange" />
                  <span>Presentaciones Ejecutivas (7 layouts PPTX)</span>
                </div>
                <div className="badge-item">
                  <span className="badge-bullet blue" />
                  <span>Exportación conversacional a Word (.docx)</span>
                </div>
              </div>

              <div className="panel-divider" />
              <p className="eyebrow">MODO DE TRABAJO</p>
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
            <span className="status-dot" /> CIRCE Local AI Lab · Soporte integral para documentos PDF/DOCX y presentaciones ejecutivas
          </span>
          <span>v0.3.5 · Fundación CIRCE</span>
        </footer>
      </section>
    </main>
  )
}

export default App
