import { useCallback } from 'react'
import './ResizeHandle.css'

interface Props {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}

export default function ResizeHandle({ direction, onResize }: Props) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let prevX = e.clientX
      let prevY = e.clientY

      const onMove = (ev: MouseEvent) => {
        const delta = direction === 'horizontal'
          ? ev.clientY - prevY
          : ev.clientX - prevX
        prevX = ev.clientX
        prevY = ev.clientY
        onResize(delta)
      }

      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = direction === 'horizontal' ? 'row-resize' : 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [direction, onResize]
  )

  return (
    <div
      className={`resize-handle resize-handle--${direction}`}
      onMouseDown={onMouseDown}
    />
  )
}
