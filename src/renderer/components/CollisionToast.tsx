import { useEffect, useRef } from 'react'
import { useHabitatCommsStore } from '../store/useHabitatCommsStore'
import type { CollisionResult } from '../../shared/habitatCommsTypes'
import './CollisionToast.css'

function Toast({ result, onDismiss }: { result: CollisionResult; onDismiss: () => void }) {
  const fileName = result.editingCreatures[0]?.id ?? 'unknown'
  return (
    <div className="collision-toast">
      <div className="collision-toast-icon">⚠</div>
      <div className="collision-toast-body">
        <div className="collision-toast-title">File Edit Collision</div>
        <div className="collision-toast-desc">
          {result.editingCreatures.map((c) => c.name).join(', ')} are editing the same file.
        </div>
      </div>
      <button className="collision-toast-dismiss" onClick={onDismiss}>×</button>
    </div>
  )
}

export default function CollisionToast() {
  const { collisions, clearCollisions } = useHabitatCommsStore()
  const dismissed = useRef(new Set<string>())

  // Auto-dismiss after 8 seconds unless there are new collisions
  useEffect(() => {
    if (collisions.length === 0) return
    const timer = setTimeout(() => {
      const latest = collisions[collisions.length - 1]
      if (latest) dismissed.current.add(latest.editingCreatures[0]?.id ?? '')
      clearCollisions()
    }, 8000)
    return () => clearTimeout(timer)
  }, [collisions])

  const visible = collisions.filter(
    (c) => !dismissed.current.has(c.editingCreatures[0]?.id ?? '')
  )

  if (visible.length === 0) return null

  return (
    <div className="collision-toast-container">
      {visible.slice(-3).map((result, i) => (
        <Toast
          key={i}
          result={result}
          onDismiss={() => {
            dismissed.current.add(result.editingCreatures[0]?.id ?? '')
          }}
        />
      ))}
    </div>
  )
}
