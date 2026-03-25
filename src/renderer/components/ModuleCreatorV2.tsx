// =============================================================================
// ModuleCreatorV2 — Card-based rapid module creation
//
// Replaces the terminal-style BootstrapTerminal with a visual card UI.
// Each design question presents 5 clickable cards:
//   3 AI-generated suggestions (click to select, auto-advance)
//   1 "Other" card (click to type a custom answer)
//   1 "More" card (fetch fresh suggestions)
//
// Flow:
//   1. Module ID + Scenario
//   2. AI generates 10-12 targeted questions
//   3. For each question: 5-card selection with rapid-fire navigation
//   4. Generate + save
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '../store/useSettingsStore'

interface BootstrapQuestion {
  id: string
  question: string
  placeholder?: string
}

interface Props {
  onClose: () => void
}

// ── Card ───────────────────────────────────────────────────────────────────

type CardType = 'suggestion' | 'other' | 'more'

interface Card {
  id: string
  type: CardType
  label: string
  loading?: boolean
}

// ── Phases ─────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'scenario' | 'questions' | 'generating' | 'done' | 'error'

// ── Styles ─────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9000,
    fontFamily: 'JetBrains Mono, monospace',
  },
  panel: {
    width: 860,
    maxHeight: '92vh',
    background: '#09091a',
    border: '1px solid #1a1a3e',
    borderRadius: 12,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
  },
  titleBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    background: '#0d0d24',
    borderBottom: '1px solid #1a1a3e',
    flexShrink: 0,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
    color: '#8888aa',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#44aaff',
    boxShadow: '0 0 6px #44aaff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#44445a',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 4px',
    lineHeight: 1,
    transition: 'color 0.15s',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '28px 32px',
  },
  // Progress bar
  progressWrap: {
    marginBottom: 24,
  },
  progressLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: '#5a5a7a',
    marginBottom: 6,
  },
  progressTrack: {
    height: 4,
    background: '#1a1a3e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: (pct: number) => ({
    height: '100%',
    width: `${pct}%`,
    background: 'linear-gradient(90deg, #5b90f0, #44aaff)',
    borderRadius: 2,
    transition: 'width 0.4s ease',
  }),
  // Section title
  sectionTitle: {
    fontSize: 13,
    color: '#c8cce4',
    marginBottom: 6,
  },
  sectionSub: {
    fontSize: 11,
    color: '#5a5a7a',
    marginBottom: 20,
  },
  // Input
  input: {
    width: '100%',
    padding: '10px 12px',
    background: '#0d0d24',
    border: '1px solid #2a2a4e',
    borderRadius: 6,
    color: '#c8cce4',
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    background: '#0d0d24',
    border: '1px solid #2a2a4e',
    borderRadius: 6,
    color: '#c8cce4',
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: 120,
    boxSizing: 'border-box' as const,
    lineHeight: 1.6,
    transition: 'border-color 0.15s',
  },
  // Cards grid
  questionText: {
    fontSize: 15,
    color: '#e0e0f0',
    marginBottom: 18,
    fontWeight: 600,
    lineHeight: 1.4,
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
    marginBottom: 10,
  },
  cardsRow2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10,
    marginBottom: 0,
  },
  card: (selected: boolean, type: CardType) => ({
    padding: '14px 12px',
    background: type === 'suggestion'
      ? selected ? '#0d2a1a' : '#0d1a2a'
      : type === 'other' ? '#1a0d2a' : '#1a1a2e',
    border: selected
      ? '2px solid #44ff88'
      : type === 'more'
        ? '2px solid #5b90f0'
        : '2px solid #2a2a4e',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    color: selected ? '#44ff88' : '#c0c0d8',
    textAlign: 'center' as const,
    lineHeight: 1.4,
    transition: 'all 0.15s',
    userSelect: 'none' as const,
    minHeight: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  cardLabel: (type: CardType) => ({
    fontSize: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em' as const,
    color: type === 'suggestion' ? '#5b90f0' : type === 'other' ? '#aa55ff' : '#5b90f0',
    marginBottom: 4,
  }),
  cardText: {
    fontWeight: 500,
    fontSize: 12,
  },
  // Other input expand
  otherInputWrap: {
    marginTop: 10,
    animation: 'fadeIn 0.2s ease',
  },
  otherInput: {
    width: '100%',
    padding: '10px 12px',
    background: '#0d0d24',
    border: '2px solid #aa55ff',
    borderRadius: 6,
    color: '#c8cce4',
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  otherHint: {
    fontSize: 10,
    color: '#5a5a7a',
    marginTop: 4,
  },
  // Navigation
  nav: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
  },
  btn: (primary?: boolean) => ({
    padding: '10px 20px',
    background: primary ? '#5b90f0' : 'transparent',
    border: primary ? 'none' : '1px solid #2a2a4e',
    borderRadius: 6,
    color: primary ? '#ffffff' : '#8888aa',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    transition: 'all 0.15s',
  }),
  btnDisabled: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    color: '#3a3a5a',
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    cursor: 'not-allowed',
  },
  // Scenario phase
  scenarioPhase: {
    maxWidth: 600,
    margin: '0 auto',
  },
  // Spinner
  spinner: {
    display: 'inline-block',
    width: 14,
    height: 14,
    border: '2px solid #2a2a4e',
    borderTopColor: '#5b90f0',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
    marginRight: 8,
    verticalAlign: 'middle',
  },
  // Done screen
  doneTitle: {
    fontSize: 18,
    color: '#44ff88',
    textAlign: 'center' as const,
    marginBottom: 12,
  },
  doneSub: {
    fontSize: 13,
    color: '#8888aa',
    textAlign: 'center' as const,
    marginBottom: 24,
  },
  // Error
  errorBox: {
    padding: '12px 16px',
    background: '#2a0d0d',
    border: '1px solid #ff4444',
    borderRadius: 6,
    color: '#ff8888',
    fontSize: 12,
    marginBottom: 16,
  },
  // Generating
  genBox: {
    textAlign: 'center' as const,
    padding: '40px 0',
  },
  genSpinner: {
    display: 'inline-block',
    width: 32,
    height: 32,
    border: '3px solid #1a1a3e',
    borderTopColor: '#5b90f0',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: 16,
  },
  genText: {
    fontSize: 13,
    color: '#8888aa',
  },
} as const

// ── Spinner keyframes (injected once) ──────────────────────────────────────

let spinnerKeyframesInjected = false

function injectKeyframes() {
  if (spinnerKeyframesInjected) return
  spinnerKeyframesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  `
  document.head.appendChild(style)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ModuleCreatorV2({ onClose }: Props) {
  injectKeyframes()

  // Phase: 'scenario' → 'questions' → 'generating' → 'done'
  const [phase, setPhase] = useState<Phase>('scenario')
  const [error, setError] = useState<string | null>(null)

  // Scenario phase
  const [moduleId, setModuleId] = useState('')
  const [scenario, setScenario] = useState('')
  const [moduleIdError, setModuleIdError] = useState('')

  // Questions phase
  const [questions, setQuestions] = useState<BootstrapQuestion[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [suggestionCache, setSuggestionCache] = useState<Record<string, string[]>>({})
  const [currentSuggestions, setCurrentSuggestions] = useState<string[]>([])
  const [suggestionLoading, setSuggestionLoading] = useState(false)
  const [otherValue, setOtherValue] = useState('')
  const [showOther, setShowOther] = useState(false)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [loadingQuestions, setLoadingQuestions] = useState(false)

  const otherInputRef = useRef<HTMLInputElement>(null)
  const { defaultModel, defaultBaseURL, defaultApiKey } = useSettingsStore()

  const modelOpts = {
    model: defaultModel || undefined,
    baseURL: defaultBaseURL || undefined,
    apiKey: defaultApiKey || undefined,
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  const currentQuestion = questions[currentIdx]
  const progress = questions.length > 0 ? ((currentIdx) / questions.length) * 100 : 0

  // Track previous question index to detect ACTUAL question changes (not just re-renders)
  const prevIdxRef = useRef<number>(currentIdx)
  const prevPhaseRef = useRef<string>(phase)

  // ── Prefetch all suggestions in parallel ───────────────────────────

  const prefetchAllSuggestions = useCallback(async (qs: BootstrapQuestion[], scen: string) => {
    if (qs.length === 0) return
    // Kick off all fetches in parallel
    const fetches = qs.map(async (q) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 800))
        try {
          const result = await window.moduleAPI.getQuestionSuggestions(q.question, scen, modelOpts) as { suggestions: string[] }
          return { id: q.id, suggestions: result.suggestions ?? [] }
        } catch {
          // swallow per-question errors — cache stays empty for that question
        }
      }
      return { id: q.id, suggestions: [] as string[] }
    })
    const results = await Promise.all(fetches)
    const cache: Record<string, string[]> = {}
    for (const r of results) cache[r.id] = r.suggestions
    setSuggestionCache(prev => ({ ...prev, ...cache }))
    // Sync current suggestions to Q0 (always starts at index 0)
    setCurrentSuggestions(cache[qs[0]?.id] ?? [])
  }, [modelOpts])

  // When navigating, sync currentSuggestions from cache (instant — no loading)
  useEffect(() => {
    if (phase !== 'questions' || !currentQuestion) return

    const prevPhase = prevPhaseRef.current
    prevPhaseRef.current = phase
    const prevIdx = prevIdxRef.current
    prevIdxRef.current = currentIdx

    if (prevPhase !== 'questions' || currentIdx !== prevIdx) {
      setSelectedCard(null)
      setShowOther(false)
      setOtherValue('')
      const cached = suggestionCache[currentQuestion.id]
      if (cached) {
        setCurrentSuggestions(cached)
      } else {
        // Not yet cached — show loading and fetch now
        const qId = currentQuestion.id
        const qText = currentQuestion.question
        setSuggestionLoading(true)
        window.moduleAPI.getQuestionSuggestions(qText, scenario, modelOpts)
          .then((result: any) => {
            const s = result.suggestions ?? []
            setSuggestionCache(prev => ({ ...prev, [qId]: s }))
            setCurrentSuggestions(s)
          })
          .catch(() => setCurrentSuggestions([]))
          .finally(() => setSuggestionLoading(false))
      }
    }
  }, [phase, currentIdx, suggestionCache, currentQuestion, scenario, modelOpts])

  // ── Submit scenario → load questions ──────────────────────────────────

  const handleStartQuestions = async () => {
    // Validate module ID
    const slug = moduleId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '')
    if (slug.length < 2) {
      setModuleIdError('Module ID must be at least 2 characters (letters, numbers, hyphens)')
      return
    }
    setModuleIdError('')
    if (scenario.trim().length < 10) {
      setError('Please write at least a sentence describing your scenario')
      return
    }
    setError(null)
    setLoadingQuestions(true)
    setPhase('questions')

    try {
      const result = await window.moduleAPI.getBootstrapQuestions(scenario.trim(), modelOpts) as { questions: BootstrapQuestion[] }
      const qs = result.questions ?? []
      setQuestions(qs)
      setCurrentIdx(0)
      // Kick off all suggestion fetches in parallel — they'll cache as they complete
      prefetchAllSuggestions(qs, scenario)
    } catch (err) {
      setError(`Failed to generate questions: ${String(err)}`)
      setPhase('error')
    } finally {
      setLoadingQuestions(false)
    }
  }

  // ── Select a card ──────────────────────────────────────────────────────

  const handleSelectCard = (cardId: string, value: string) => {
    setSelectedCard(cardId)
    const newAnswers = { ...answers, [currentQuestion.id]: value }
    setAnswers(newAnswers)

    // Auto-advance after 300ms
    setTimeout(() => {
      if (currentIdx < questions.length - 1) {
        setCurrentIdx(i => i + 1)
      } else {
        // All done — generate
        handleGenerate(newAnswers)
      }
    }, 300)
  }

  // ── Handle Other submit ───────────────────────────────────────────────

  const handleOtherSubmit = () => {
    if (!otherValue.trim()) return
    handleSelectCard('other', otherValue.trim())
  }

  // ── More suggestions ──────────────────────────────────────────────────

  const handleMoreSuggestions = () => {
    if (!currentQuestion) return
    const qId = currentQuestion.id
    setSuggestionLoading(true)
    window.moduleAPI.getQuestionSuggestions(currentQuestion.question, scenario, modelOpts)
      .then((result: any) => {
        const s = result.suggestions ?? []
        setSuggestionCache(prev => ({ ...prev, [qId]: s }))
        setCurrentSuggestions(s)
      })
      .catch(() => {})
      .finally(() => setSuggestionLoading(false))
  }

  // ── Generate ──────────────────────────────────────────────────────────

  const handleGenerate = async (finalAnswers: Record<string, string>) => {
    setPhase('generating')

    const enriched = questions
      .map(q => `${q.question}\n-> ${finalAnswers[q.id] || '(no preference)'}`)
      .join('\n\n')

    const fullPrompt = `Create a module named "${moduleId}" for the following scenario:\n${scenario}\n\nDesign decisions:\n${enriched}`

    try {
      const generated = await window.moduleAPI.generateModuleConfig(moduleId, fullPrompt, modelOpts) as { manifest: unknown; world: unknown; agents: unknown[] }
      await window.moduleAPI.saveModule(moduleId, generated)
      setPhase('done')
    } catch (err) {
      setError(`Generation failed: ${String(err)}`)
      setPhase('error')
    }
  }

  // ── Back ─────────────────────────────────────────────────────────────

  const handleBack = () => {
    if (currentIdx > 0) {
      setCurrentIdx(i => i - 1)
    } else {
      setPhase('scenario')
    }
  }

  // ── Retry questions ───────────────────────────────────────────────────

  const handleRetry = () => {
    setError(null)
    setPhase('scenario')
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        .mc2-btn:hover { filter: brightness(1.15); }
        .mc2-btn:active { transform: scale(0.97); }
        .mc2-card:hover { border-color: #5b90f0 !important; filter: brightness(1.1); }
        .mc2-input:focus { border-color: #5b90f0 !important; }
      `}</style>

      <div style={S.panel}>

        {/* Title bar */}
        <div style={S.titleBar}>
          <div style={S.title}>
            <span style={S.dot} />
            <span>module-creator <span style={{ color: '#5b90f0' }}>v2</span></span>
          </div>
          <button
            style={S.closeBtn}
            onClick={onClose}
            onMouseEnter={e => ((e.target as HTMLButtonElement).style.color = '#ff4455')}
            onMouseLeave={e => ((e.target as HTMLButtonElement).style.color = '#44445a')}
          >
            x
          </button>
        </div>

        {/* Body */}
        <div style={S.body}>

          {/* ── SCENARIO PHASE ── */}
          {phase === 'scenario' && (
            <div style={S.scenarioPhase}>
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, color: '#5b90f0', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>New Module</div>
                <h2 style={{ fontSize: 18, color: '#e0e0f0', margin: '0 0 6px' }}>Rapid Design</h2>
                <p style={{ fontSize: 12, color: '#6a6a8a', margin: 0, lineHeight: 1.5 }}>
                  Answer a few quick questions to bootstrap your module. Click cards, don't type.
                </p>
              </div>

              {error && <div style={S.errorBox}>{error}</div>}

              {/* Module ID */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8888aa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Module ID
                </label>
                <input
                  className="mc2-input"
                  style={{ ...S.input, borderColor: moduleIdError ? '#ff4444' : '#2a2a4e' }}
                  placeholder="e.g. dungeon-crawl, space-pirates"
                  value={moduleId}
                  onChange={e => { setModuleId(e.target.value); setModuleIdError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleStartQuestions()}
                />
                {moduleIdError && <div style={{ fontSize: 11, color: '#ff6666', marginTop: 4 }}>{moduleIdError}</div>}
              </div>

              {/* Scenario */}
              <div style={{ marginBottom: 28 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#8888aa', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  What&apos;s your scenario?
                </label>
                <textarea
                  className="mc2-input"
                  style={{ ...S.textarea, resize: 'vertical' }}
                  placeholder={'e.g. "AI pirates raid a space station, fighting zero-gravity battles and looting alien tech"\n\nThe more detail, the better the module.'}
                  value={scenario}
                  onChange={e => setScenario(e.target.value)}
                />
              </div>

              {/* Start */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="mc2-btn"
                  style={S.btn(true)}
                  onClick={handleStartQuestions}
                >
                  Start Design →
                </button>
              </div>
            </div>
          )}

          {/* ── QUESTIONS PHASE ── */}
          {(phase === 'questions' || loadingQuestions) && (
            <div>
              {/* Progress */}
              <div style={S.progressWrap}>
                <div style={S.progressLabel}>
                  <span>Question {currentIdx + 1} of {questions.length}</span>
                  <span style={{ color: '#5b90f0' }}>{Math.round(progress)}%</span>
                </div>
                <div style={S.progressTrack}>
                  <div style={S.progressFill(progress)} />
                </div>
              </div>

              {loadingQuestions ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <div style={S.genSpinner} />
                  <div style={{ ...S.genText, color: '#8888aa' }}>Generating {questions.length || 10} design questions…</div>
                </div>
              ) : (
                <>
                  {/* Question text */}
                  <div style={S.questionText}>{currentQuestion?.question}</div>

                  {/* Cards row 1 — 3 suggestions */}
                  <div style={S.cardsGrid}>
                    {suggestionLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} style={{ ...S.card(false, 'suggestion'), opacity: 0.4 }}>
                          <div style={{ ...S.spinner, width: 12, height: 12, borderWidth: 1, borderTopColor: '#5b90f0', margin: '0 auto' }} />
                        </div>
                      ))
                    ) : (
                      currentSuggestions.slice(0, 3).map((s, i) => (
                        <div
                          key={s}
                          className="mc2-card"
                          style={S.card(selectedCard === s, 'suggestion')}
                          onClick={() => handleSelectCard(s, s)}
                        >
                          <div style={S.cardLabel('suggestion')}>Suggestion {i + 1}</div>
                          <div style={S.cardText}>{s}</div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Cards row 2 — Other + More */}
                  <div style={S.cardsRow2}>
                    <div
                      className="mc2-card"
                      style={{ ...S.card(false, 'other'), borderColor: showOther ? '#aa55ff' : '#2a2a4e' }}
                      onClick={() => {
                        setShowOther(v => !v)
                        if (!showOther) setTimeout(() => otherInputRef.current?.focus(), 50)
                      }}
                    >
                      <div style={S.cardLabel('other')}>Other</div>
                      <div style={S.cardText}>{showOther ? '— type below —' : 'Custom answer…'}</div>
                    </div>

                    <div
                      className="mc2-card"
                      style={S.card(false, 'more')}
                      onClick={handleMoreSuggestions}
                    >
                      <div style={S.cardLabel('more')}>More</div>
                      <div style={S.cardText}>
                        {suggestionLoading ? 'Loading…' : 'Fresh suggestions'}
                      </div>
                    </div>
                  </div>

                  {/* Other input */}
                  {showOther && (
                    <div style={{ ...S.otherInputWrap, animation: 'fadeIn 0.2s ease' }}>
                      <input
                        ref={otherInputRef}
                        className="mc2-input"
                        style={S.otherInput}
                        placeholder="Type your custom answer…"
                        value={otherValue}
                        onChange={e => setOtherValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleOtherSubmit()
                          if (e.key === 'Escape') { setShowOther(false); setOtherValue('') }
                        }}
                      />
                      <div style={S.otherHint}>Press Enter to submit · Escape to cancel</div>
                    </div>
                  )}
                </>
              )}

              {/* Navigation */}
              {!loadingQuestions && (
                <div style={S.nav}>
                  <button
                    className="mc2-btn"
                    style={currentIdx > 0 ? S.btn() : S.btnDisabled}
                    onClick={handleBack}
                    disabled={currentIdx === 0}
                  >
                    ← Back
                  </button>

                  {!showOther && (
                    <button
                      className="mc2-btn"
                      style={S.btn()}
                      onClick={() => {
                        if (currentIdx < questions.length - 1) {
                          setCurrentIdx(i => i + 1)
                        } else {
                          handleGenerate(answers)
                        }
                      }}
                    >
                      {currentIdx < questions.length - 1 ? 'Skip & Next →' : 'Generate Module →'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── GENERATING ── */}
          {phase === 'generating' && (
            <div style={S.genBox}>
              <div style={S.genSpinner} />
              <div style={S.genText}>Crafting your module… this takes 20-40 seconds</div>
            </div>
          )}

          {/* ── DONE ── */}
          {phase === 'done' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={S.doneTitle}>Module Created!</div>
              <div style={S.doneSub}>
                <span style={{ color: '#5b90f0' }}>{moduleId}</span> is ready to launch.
              </div>
              <button
                className="mc2-btn"
                style={S.btn(true)}
                onClick={onClose}
              >
                Close & Launch
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {phase === 'error' && (
            <div>
              <div style={S.errorBox}>{error}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="mc2-btn" style={S.btn()} onClick={handleRetry}>← Try Again</button>
                <button className="mc2-btn" style={S.btn()} onClick={onClose}>Close</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
