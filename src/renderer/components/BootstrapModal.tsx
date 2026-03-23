// =============================================================================
// Bootstrap Modal — Multi-step AI-guided module creation
// =============================================================================

import { useState, useCallback } from 'react'

interface Question {
  id: string
  question: string
  placeholder?: string
}

type Step = 'scenario' | 'asking' | 'questions' | 'generating' | 'done' | 'error'

interface BootstrapModalProps {
  onClose: () => void
}

const MONO = 'JetBrains Mono, monospace'

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
  },
  card: {
    background: '#0d0d1a',
    border: '1px solid #1a1a3e',
    borderRadius: 8,
    width: 580,
    maxHeight: '88vh',
    overflowY: 'auto' as const,
    padding: 32,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 20,
    fontFamily: MONO,
    color: '#ccc',
  },
  title: {
    fontSize: 14,
    color: '#44aaff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 11,
    color: '#555',
    lineHeight: 1.5,
  },
  label: {
    fontSize: 11,
    color: '#888',
    marginBottom: 6,
    display: 'block' as const,
  },
  input: {
    width: '100%',
    background: '#0a0a18',
    border: '1px solid #1a1a3e',
    borderRadius: 4,
    color: '#ccc',
    fontFamily: MONO,
    fontSize: 11,
    padding: '8px 10px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  textarea: {
    width: '100%',
    background: '#0a0a18',
    border: '1px solid #1a1a3e',
    borderRadius: 4,
    color: '#ccc',
    fontFamily: MONO,
    fontSize: 11,
    padding: '8px 10px',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: 72,
    boxSizing: 'border-box' as const,
  },
  btnPrimary: {
    padding: '8px 20px',
    borderRadius: 4,
    border: '1px solid #44aaff',
    background: 'rgba(68,170,255,0.1)',
    color: '#44aaff',
    fontFamily: MONO,
    fontSize: 11,
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '8px 16px',
    borderRadius: 4,
    border: '1px solid #333',
    background: 'transparent',
    color: '#555',
    fontFamily: MONO,
    fontSize: 11,
    cursor: 'pointer',
  },
  btnDanger: {
    padding: '8px 16px',
    borderRadius: 4,
    border: '1px solid #ff4444',
    background: 'rgba(255,68,68,0.1)',
    color: '#ff4444',
    fontFamily: MONO,
    fontSize: 11,
    cursor: 'pointer',
  },
  divider: {
    height: 1,
    background: '#1a1a2e',
    margin: '4px 0',
  },
  questionBlock: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 6,
  },
  questionLabel: {
    fontSize: 11,
    color: '#aaa',
    lineHeight: 1.5,
  },
  logLine: {
    fontSize: 10,
    color: '#555',
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
}

export default function BootstrapModal({ onClose }: BootstrapModalProps) {
  const [step, setStep] = useState<Step>('scenario')
  const [moduleName, setModuleName] = useState('')
  const [scenario, setScenario] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [log, setLog] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')

  const addLog = (msg: string) => setLog((prev) => [...prev, msg])

  const api = () => window.moduleAPI

  // Step 1 → Step 2: Get AI-generated questions
  const handleGetQuestions = useCallback(async () => {
    if (!moduleName.trim() || !scenario.trim()) return
    setStep('asking')
    setLog(['Analyzing your scenario…'])
    try {
      const result = await api().getBootstrapQuestions(scenario.trim())
      setQuestions(result.questions)
      setAnswers(Object.fromEntries(result.questions.map((q) => [q.id, ''])))
      setStep('questions')
    } catch (err) {
      setErrorMsg(String(err))
      setStep('error')
    }
  }, [moduleName, scenario])

  // Step 2 → Generate: Build module config with answers
  const handleGenerate = useCallback(async () => {
    setStep('generating')
    setLog(['Building module configuration…'])
    try {
      const enriched = questions
        .map((q) => `${q.question}\n→ ${answers[q.id]?.trim() || '(no preference)'}`)
        .join('\n\n')
      const fullPrompt = `Create a module named "${moduleName}" for the following scenario:\n${scenario}\n\nDesign decisions from the creator:\n${enriched}`

      addLog('Calling AI (this may take 20–40 seconds)…')
      const generated = await api().generateModuleConfig(moduleName.trim(), fullPrompt)

      addLog('Saving module files…')
      await api().saveModule(moduleName.trim(), generated as { manifest: unknown; world: unknown; agents: unknown[] })

      addLog(`Module "${moduleName}" created successfully!`)
      setStep('done')
    } catch (err) {
      setErrorMsg(String(err))
      setStep('error')
    }
  }, [moduleName, scenario, questions, answers])

  const isLoading = step === 'asking' || step === 'generating'

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.card}>
        {/* Header */}
        <div>
          <div style={styles.title}>Create Module</div>
          <div style={styles.subtitle}>
            {step === 'scenario' && 'Describe your game scenario. AI will ask clarifying questions before generating.'}
            {step === 'asking' && 'Analyzing your scenario…'}
            {step === 'questions' && 'Answer these questions to shape your module. Skip any you want to leave open.'}
            {step === 'generating' && 'Generating your module…'}
            {step === 'done' && 'Module created! Launch it from the Modules menu.'}
            {step === 'error' && 'Something went wrong.'}
          </div>
        </div>

        <div style={styles.divider} />

        {/* Scenario step */}
        {(step === 'scenario' || step === 'asking') && (
          <>
            <div>
              <label style={styles.label}>Module ID (slug)</label>
              <input
                style={styles.input}
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="e.g. cozy-farm, dungeon-crawl, space-battle"
                disabled={isLoading}
              />
            </div>
            <div>
              <label style={styles.label}>Scenario description</label>
              <textarea
                style={{ ...styles.textarea, minHeight: 100 }}
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                placeholder="Describe the world, the agents, and the vibe. The more detail, the better the result.&#10;&#10;e.g. A cozy farming village where AI villagers tend crops, trade at the market, and chat about their days. No conflict — just peaceful daily life."
                disabled={isLoading}
              />
            </div>
          </>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {log.map((msg, i) => {
              const isLast = i === log.length - 1
              return (
                <div key={i} style={{ ...styles.logLine, color: isLast ? '#44aaff' : '#444' }}>
                  <span style={{ width: 10 }}>{isLast ? '▶' : '✓'}</span>
                  <span>{msg}</span>
                </div>
              )
            })}
            <div style={{ marginTop: 8, width: '100%', height: 2, background: '#1a1a2e', borderRadius: 1, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: '40%',
                background: '#44aaff',
                borderRadius: 1,
                animation: 'bootstrap-pulse 1.2s ease-in-out infinite',
              }} />
            </div>
            <style>{`@keyframes bootstrap-pulse { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
          </div>
        )}

        {/* Questions step */}
        {step === 'questions' && (
          <>
            {questions.map((q, i) => (
              <div key={q.id} style={styles.questionBlock}>
                <label style={styles.questionLabel}>
                  <span style={{ color: '#44aaff', marginRight: 6 }}>{i + 1}.</span>
                  {q.question}
                </label>
                <textarea
                  style={styles.textarea}
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  placeholder={q.placeholder ?? 'Your answer (or leave blank)'}
                />
              </div>
            ))}
          </>
        )}

        {/* Done */}
        {step === 'done' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {log.map((msg, i) => (
              <div key={i} style={{ ...styles.logLine, color: '#44ff44' }}>
                <span style={{ width: 10 }}>✓</span>
                <span>{msg}</span>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div style={{ fontSize: 11, color: '#ff4444', background: 'rgba(255,68,68,0.06)', padding: 12, borderRadius: 4 }}>
            {errorMsg}
            <div style={{ marginTop: 8, color: '#555' }}>Check your API key in Settings, then try again.</div>
          </div>
        )}

        {/* Footer buttons */}
        <div style={styles.divider} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {step === 'scenario' && (
            <>
              <button style={styles.btnSecondary} onClick={onClose}>Cancel</button>
              <button
                style={{ ...styles.btnPrimary, opacity: (!moduleName.trim() || !scenario.trim()) ? 0.4 : 1 }}
                onClick={handleGetQuestions}
                disabled={!moduleName.trim() || !scenario.trim()}
              >
                Next →
              </button>
            </>
          )}
          {step === 'questions' && (
            <>
              <button style={styles.btnSecondary} onClick={() => setStep('scenario')}>← Back</button>
              <button style={styles.btnPrimary} onClick={handleGenerate}>Generate Module</button>
            </>
          )}
          {step === 'done' && (
            <button style={styles.btnPrimary} onClick={onClose}>Close</button>
          )}
          {step === 'error' && (
            <>
              <button style={styles.btnSecondary} onClick={() => setStep('scenario')}>← Start Over</button>
              <button style={styles.btnDanger} onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
