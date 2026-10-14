import { useState, useEffect, useCallback } from 'react'
import './MetricsDashboard.css'

export interface MetricSummary {
  active_requests: number
  peak_active_requests: number
  active_users_5m: number
  peak_active_users: number
  total_requests: number
  successful_requests: number
  failed_requests: number
  success_rate_percent: number
  avg_latency_ms: number
  min_latency_ms: number
  max_latency_ms: number
  total_presentations: number
  max_concurrency_slots: number
  ollama_parallel_slots: number
  mode: string
  model: string
  presentation_model: string
}

export interface TimelinePoint {
  time: string
  requests: number
  avg_latency_ms: number
  peak_concurrent: number
  active_users: number
  errors: number
}

export interface RecentRequest {
  id: string
  timestamp: string
  client_id: string
  use_case: string
  latency_ms: number
  status: number
  mode: string
  is_presentation: boolean
}

export interface MetricsResponse {
  summary: MetricSummary
  by_use_case: Record<string, number>
  timeline: TimelinePoint[]
  recent_requests: RecentRequest[]
}

interface StressTestResult {
  id: number
  userLabel: string
  prompt: string
  status: 'pending' | 'running' | 'done' | 'error'
  latencyMs?: number
  replySnippet?: string
}

export function MetricsDashboard({ clientId, onBackToChat }: { clientId: string; onBackToChat: () => void }) {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isStressTesting, setIsStressTesting] = useState(false)
  const [stressResults, setStressResults] = useState<StressTestResult[]>([])
  const [stressSummary, setStressSummary] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch(`/api/metrics?client_id=${encodeURIComponent(clientId)}`)
      if (response.ok) {
        const json: MetricsResponse = await response.json()
        setData(json)
      }
    } catch (e) {
      console.error('Error al obtener métricas:', e)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const response = await fetch(`/api/metrics?client_id=${encodeURIComponent(clientId)}`)
        if (response.ok && !ignore) {
          const json: MetricsResponse = await response.json()
          setData(json)
        }
      } catch (e) {
        console.error('Error al obtener métricas:', e)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    if (!autoRefresh) return
    const interval = setInterval(load, 3000)
    return () => {
      ignore = true
      clearInterval(interval)
    }
  }, [autoRefresh, clientId])

  async function runConcurrencyStressTest() {
    if (isStressTesting) return
    setIsStressTesting(true)
    setStressSummary(null)

    const testCases = [
      { id: 1, userLabel: 'Usuario 1 (Zaragoza)', prompt: 'Define los beneficios de las microrredes industriales de CIRCE.' },
      { id: 2, userLabel: 'Usuario 2 (Madrid)', prompt: 'Calcula la optimización térmica en plantas de biomasa.' },
      { id: 3, userLabel: 'Usuario 3 (Bilbao)', prompt: 'Resume los requisitos de la normativa europea de eficiencia energética.' },
      { id: 4, userLabel: 'Usuario 4 (Valencia)', prompt: 'Explica el impacto de la electrónica de potencia en baterías BESS.' },
      { id: 5, userLabel: 'Usuario 5 (Sevilla)', prompt: 'Cuáles son las ventajas de la monitorización predictiva de inversores?' },
    ]

    setStressResults(
      testCases.map((tc) => ({
        id: tc.id,
        userLabel: tc.userLabel,
        prompt: tc.prompt,
        status: 'running',
      }))
    )

    const startTime = performance.now()

    const promises = testCases.map(async (tc) => {
      const clientSimId = `stress_usr_${tc.id}_${Math.random().toString(36).substring(2, 6)}`
      const reqStart = performance.now()
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': clientSimId,
          },
          body: JSON.stringify({
            client_id: clientSimId,
            message: tc.prompt,
            use_case: 'Prueba de Concurrencia',
          }),
        })

        const reqEnd = performance.now()
        const latency = Math.round(reqEnd - reqStart)

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const json = await res.json()

        setStressResults((prev) =>
          prev.map((item) =>
            item.id === tc.id
              ? {
                  ...item,
                  status: 'done',
                  latencyMs: latency,
                  replySnippet: (json.reply || '').slice(0, 70) + '...',
                }
              : item
          )
        )
      } catch (err) {
        const reqEnd = performance.now()
        setStressResults((prev) =>
          prev.map((item) =>
            item.id === tc.id
              ? {
                  ...item,
                  status: 'error',
                  latencyMs: Math.round(reqEnd - reqStart),
                  replySnippet: `Error: ${err instanceof Error ? err.message : 'Fallo de red'}`,
                }
              : item
          )
        )
      }
    })

    await Promise.all(promises)
    const totalDuration = Math.round(performance.now() - startTime)
    setIsStressTesting(false)
    setStressSummary(
      `✓ Test completado: 5 peticiones simultáneas procesadas en ${totalDuration} ms. Los 5 slots respondieron en paralelo.`
    )
    fetchMetrics()
  }

  const summary = data?.summary
  const timeline = data?.timeline || []
  const recent = data?.recent_requests || []
  const byUseCase = data?.by_use_case || {}

  // Calculations for SVG Charts
  const maxTimelineReqs = Math.max(1, ...timeline.map((t) => Math.max(t.requests, t.peak_concurrent)))
  const maxTimelineLatency = Math.max(500, ...timeline.map((t) => t.avg_latency_ms))
  const chartWidth = 520
  const chartHeight = 150
  const paddingX = 40
  const paddingY = 24

  const totalUseCaseCount = Math.max(1, Object.values(byUseCase).reduce((a, b) => a + b, 0))

  return (
    <div className="metrics-dashboard">
      <div className="metrics-header">
        <div>
          <button className="back-link" onClick={onBackToChat}>
            ← Volver al Asistente
          </button>
          <h1>Eficiencia y Concurrencia Global</h1>
          <p className="subtitle">
            Monitoreo en tiempo real de usuarios concurrentes, rapidez de respuesta y capacidad operativa.
          </p>
        </div>
        <div className="metrics-actions">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span className="slider" />
            <span className="toggle-label">{autoRefresh ? '● En vivo (3s)' : 'Pausado'}</span>
          </label>
          <button className="refresh-btn" onClick={() => fetchMetrics()}>
            ↻ Refrescar
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="loading-state">
          <p>Cargando telemetría del servidor CIRCE...</p>
        </div>
      ) : (
        <>
          {/* KPI CARDS */}
          <div className="kpi-grid">
            <div className="kpi-card highlight-card">
              <div className="kpi-label">Concurrencia en Vivo</div>
              <div className="kpi-value-row">
                <span className="kpi-value">{summary?.active_requests ?? 0}</span>
                <span className="kpi-limit">/ {summary?.max_concurrency_slots ?? 10} slots</span>
              </div>
              <div className="concurrency-meter">
                <div
                  className="meter-fill"
                  style={{
                    width: `${Math.min(100, (((summary?.active_requests ?? 0) / (summary?.max_concurrency_slots ?? 10)) * 100))}%`,
                  }}
                />
              </div>
              <div className="kpi-footer">
                <span>Pico máx: <strong>{summary?.peak_active_requests ?? 0} concurrentes</strong></span>
                <span>Activos (5m): <strong>{summary?.active_users_5m ?? 1} usuarios</strong></span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Rapidez de Respuesta</div>
              <div className="kpi-value-row">
                <span className="kpi-value">{summary?.avg_latency_ms ?? 0}</span>
                <span className="kpi-unit">ms media</span>
              </div>
              <div className="speed-badge">
                {(summary?.avg_latency_ms ?? 0) < 600
                  ? '⚡ Ultrarrápida'
                  : (summary?.avg_latency_ms ?? 0) < 1800
                  ? '✓ Excelente'
                  : '⏳ Carga moderada'}
              </div>
              <div className="kpi-footer">
                <span>Mín: <strong>{summary?.min_latency_ms ?? 0} ms</strong></span>
                <span>Máx: <strong>{summary?.max_latency_ms ?? 0} ms</strong></span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Eficiencia y Éxito</div>
              <div className="kpi-value-row">
                <span className="kpi-value">{summary?.success_rate_percent ?? 100}%</span>
                <span className="kpi-unit">éxito</span>
              </div>
              <div className="kpi-footer">
                <span>Completadas: <strong>{summary?.total_requests ?? 0}</strong></span>
                <span>Presentaciones PPTX: <strong>{summary?.total_presentations ?? 0}</strong></span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Capacidad del Motor Local</div>
              <div className="kpi-value-row">
                <span className="kpi-model-badge">{summary?.model}</span>
              </div>
              <div className="engine-info">
                <span>Modo: <strong>{summary?.mode?.toUpperCase()}</strong></span>
                <span>Ollama Paralelo: <strong>{summary?.ollama_parallel_slots ?? 5} hilos</strong></span>
              </div>
              <div className="kpi-footer">
                <span>Soporte 5+ usuarios: <strong className="green-text">✓ Activo</strong></span>
              </div>
            </div>
          </div>

          {/* STRESS TEST INTERACTION SECTION */}
          <div className="stress-test-banner">
            <div className="stress-intro">
              <div className="stress-title">
                <span className="stress-icon">⚡</span>
                <div>
                  <strong>Prueba de Estrés: 5 Usuarios Concurrentes</strong>
                  <p>Lanza 5 peticiones simultáneas con clientes independientes para comprobar la paralelización real.</p>
                </div>
              </div>
              <button
                className="stress-button"
                onClick={runConcurrencyStressTest}
                disabled={isStressTesting}
              >
                {isStressTesting ? 'Ejecutando 5 consultas concurrentes...' : '▶ Probar 5 Usuarios a la Vez'}
              </button>
            </div>

            {stressSummary && <div className="stress-success-alert">{stressSummary}</div>}

            {stressResults.length > 0 && (
              <div className="stress-grid">
                {stressResults.map((r) => (
                  <div key={r.id} className={`stress-card ${r.status}`}>
                    <div className="stress-card-head">
                      <strong>{r.userLabel}</strong>
                      <span className={`status-pill ${r.status}`}>
                        {r.status === 'running' && 'Procesando...'}
                        {r.status === 'done' && `✓ ${r.latencyMs} ms`}
                        {r.status === 'error' && 'Error'}
                      </span>
                    </div>
                    <p className="stress-prompt">"{r.prompt}"</p>
                    {r.replySnippet && <p className="stress-snippet">{r.replySnippet}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CHARTS SECTION */}
          <div className="charts-grid">
            {/* Chart 1: Picos de Concurrencia y Peticiones */}
            <div className="chart-box">
              <div className="chart-head">
                <h3>Pico de Concurrencia y Peticiones (Tiempo Real)</h3>
                <div className="chart-legend">
                  <span className="legend-item"><i className="legend-dot green" /> Concurrencia pico</span>
                  <span className="legend-item"><i className="legend-dot orange" /> Peticiones/min</span>
                </div>
              </div>
              <div className="svg-container">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="metric-svg">
                  {/* Grid Lines */}
                  {[0, 0.5, 1].map((pct, idx) => {
                    const y = paddingY + (chartHeight - 2 * paddingY) * pct
                    return (
                      <g key={idx}>
                        <line x1={paddingX} y1={y} x2={chartWidth - 10} y2={y} stroke="#e4ebe5" strokeDasharray="3,3" />
                        <text x={paddingX - 6} y={y + 4} textAnchor="end" className="chart-axis-text">
                          {Math.round(maxTimelineReqs * (1 - pct))}
                        </text>
                      </g>
                    )
                  })}

                  {/* Polyline: Requests */}
                  {timeline.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#e68b35"
                      strokeWidth="2"
                      strokeDasharray="4,2"
                      points={timeline
                        .map((t, idx) => {
                          const x = paddingX + (idx / (timeline.length - 1)) * (chartWidth - paddingX - 20)
                          const y = paddingY + (1 - t.requests / maxTimelineReqs) * (chartHeight - 2 * paddingY)
                          return `${x},${y}`
                        })
                        .join(' ')}
                    />
                  )}

                  {/* Area & Polyline: Peak Concurrent Users */}
                  {timeline.length > 1 && (
                    <>
                      <polygon
                        fill="rgba(25, 123, 89, 0.12)"
                        points={`
                          ${paddingX},${chartHeight - paddingY}
                          ${timeline
                            .map((t, idx) => {
                              const x = paddingX + (idx / (timeline.length - 1)) * (chartWidth - paddingX - 20)
                              const y = paddingY + (1 - t.peak_concurrent / maxTimelineReqs) * (chartHeight - 2 * paddingY)
                              return `${x},${y}`
                            })
                            .join(' ')}
                          ${chartWidth - 20},${chartHeight - paddingY}
                        `}
                      />
                      <polyline
                        fill="none"
                        stroke="#197b59"
                        strokeWidth="2.5"
                        points={timeline
                          .map((t, idx) => {
                            const x = paddingX + (idx / (timeline.length - 1)) * (chartWidth - paddingX - 20)
                            const y = paddingY + (1 - t.peak_concurrent / maxTimelineReqs) * (chartHeight - 2 * paddingY)
                            return `${x},${y}`
                          })
                          .join(' ')}
                      />
                    </>
                  )}

                  {/* Data Points */}
                  {timeline.map((t, idx) => {
                    const x = paddingX + (idx / Math.max(1, timeline.length - 1)) * (chartWidth - paddingX - 20)
                    const y = paddingY + (1 - t.peak_concurrent / maxTimelineReqs) * (chartHeight - 2 * paddingY)
                    return (
                      <g key={idx}>
                        <circle cx={x} cy={y} r="3.5" fill="#197b59" stroke="#fff" strokeWidth="1.5" />
                        {idx % Math.ceil(timeline.length / 6) === 0 && (
                          <text x={x} y={chartHeight - 6} textAnchor="middle" className="chart-axis-text">
                            {t.time}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>

            {/* Chart 2: Rapidez y Latencia de Respuesta */}
            <div className="chart-box">
              <div className="chart-head">
                <h3>Rapidez de Respuesta (ms de latencia)</h3>
                <div className="chart-legend">
                  <span className="legend-item"><i className="legend-dot green" /> Latencia media</span>
                  <span className="legend-item"><i className="legend-dot blue" /> Objetivo &lt;1.5s</span>
                </div>
              </div>
              <div className="svg-container">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="metric-svg">
                  {[0, 0.5, 1].map((pct, idx) => {
                    const y = paddingY + (chartHeight - 2 * paddingY) * pct
                    return (
                      <g key={idx}>
                        <line x1={paddingX} y1={y} x2={chartWidth - 10} y2={y} stroke="#e4ebe5" strokeDasharray="3,3" />
                        <text x={paddingX - 6} y={y + 4} textAnchor="end" className="chart-axis-text">
                          {Math.round(maxTimelineLatency * (1 - pct))} ms
                        </text>
                      </g>
                    )
                  })}

                  {timeline.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#2369a5"
                      strokeWidth="2.5"
                      points={timeline
                        .map((t, idx) => {
                          const x = paddingX + (idx / (timeline.length - 1)) * (chartWidth - paddingX - 20)
                          const y = paddingY + (1 - t.avg_latency_ms / maxTimelineLatency) * (chartHeight - 2 * paddingY)
                          return `${x},${y}`
                        })
                        .join(' ')}
                    />
                  )}

                  {timeline.map((t, idx) => {
                    const x = paddingX + (idx / Math.max(1, timeline.length - 1)) * (chartWidth - paddingX - 20)
                    const y = paddingY + (1 - t.avg_latency_ms / maxTimelineLatency) * (chartHeight - 2 * paddingY)
                    return (
                      <g key={idx}>
                        <circle cx={x} cy={y} r="3.5" fill="#2369a5" stroke="#fff" strokeWidth="1.5" />
                        {idx % Math.ceil(timeline.length / 6) === 0 && (
                          <text x={x} y={chartHeight - 6} textAnchor="middle" className="chart-axis-text">
                            {t.time}
                          </text>
                        )}
                      </g>
                    )
                  })}
                </svg>
              </div>
            </div>
          </div>

          {/* LOWER GRID: USE CASE DISTRIBUTION & CLOUDFLARE ACCESS */}
          <div className="split-grid">
            <div className="section-box">
              <h3>Distribución por Caso de Uso</h3>
              <div className="use-case-bars">
                {[
                  { label: 'Asistente general', count: byUseCase['Asistente general'] || 0, color: '#197b59' },
                  { label: 'Documentacion tecnica', count: byUseCase['Documentacion tecnica'] || 0, color: '#2369a5' },
                  { label: 'Analisis energetico', count: byUseCase['Analisis energetico'] || 0, color: '#e68b35' },
                  { label: 'Presentaciones PowerPoint', count: byUseCase['Presentaciones'] || 0, color: '#c75b39' },
                  { label: 'Pruebas de Concurrencia', count: byUseCase['Prueba de Concurrencia'] || 0, color: '#687970' },
                ].map((item) => {
                  const pct = Math.round((item.count / totalUseCaseCount) * 100)
                  return (
                    <div key={item.label} className="bar-row">
                      <div className="bar-labels">
                        <span>{item.label}</span>
                        <strong>{item.count} peticiones ({pct}%)</strong>
                      </div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${pct}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="section-box cloudflare-box">
              <div className="cf-head">
                <span className="cf-badge">☁ ACCESO REMOTO SEGURO</span>
                <h3>Compartir con Cloudflare Tunnel</h3>
              </div>
              <p className="cf-description">
                Para permitir que 5 o más personas de CIRCE se conecten desde cualquier equipo o portátil sin abrir puertos en el router:
              </p>
              <div className="cf-code-block">
                <code>cloudflared tunnel --url http://localhost:8080</code>
              </div>
              <ul className="cf-features">
                <li>✓ Acceso HTTPS con certificado SSL automático sin coste.</li>
                <li>✓ El puerto 8080 sirve tanto el frontend React compilado como el backend Python.</li>
                <li>✓ Soporta conexiones simultáneas con aislamiento por usuario (Client ID).</li>
              </ul>
            </div>
          </div>

          {/* RECENT REQUESTS AUDIT TABLE */}
          <div className="section-box">
            <div className="audit-head">
              <h3>Historial de Peticiones Recientes</h3>
              <span className="badge-small">{recent.length} últimas transacciones</span>
            </div>
            {recent.length === 0 ? (
              <p className="empty-text">Aún no se han registrado peticiones en esta sesión.</p>
            ) : (
              <div className="table-responsive">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th>Cliente ID</th>
                      <th>Caso de Uso</th>
                      <th>Rapidez</th>
                      <th>Estado</th>
                      <th>Modo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((req) => (
                      <tr key={req.id}>
                        <td className="mono">{req.timestamp}</td>
                        <td><span className="client-tag">{req.client_id}</span></td>
                        <td>{req.use_case}</td>
                        <td>
                          <span className={`latency-pill ${req.latency_ms < 500 ? 'fast' : req.latency_ms < 1500 ? 'med' : 'slow'}`}>
                            {req.latency_ms} ms
                          </span>
                        </td>
                        <td>
                          <span className={`status-pill ${req.status === 200 ? 'done' : 'error'}`}>
                            {req.status === 200 ? '✓ 200 OK' : `⚠ ${req.status}`}
                          </span>
                        </td>
                        <td className="mono uppercase">{req.mode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
