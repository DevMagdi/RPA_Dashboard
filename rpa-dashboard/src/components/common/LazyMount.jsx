/**
 * Lazy mount + Suspense boundary.
 *
 * Chart libraries and drag-and-drop grids are the heaviest code in the bundle.
 * `LazyMount` keeps them out of the critical path twice over:
 *   1. the child's chunk is only requested when the block scrolls into view
 *      (IntersectionObserver with a 160 px pre-roll), and
 *   2. it renders a layout-stable skeleton until the chunk resolves, so the
 *      dashboard never reflows while the operator is reading it.
 */
import { Suspense, useState } from 'react'

import { useInView, usePrefersReducedMotion } from '../../hooks/ui'
import { Skeleton } from '../ui'

export default function LazyMount({ children, fallback, height = 260, className, eager = false, once = true, delayMs = 0 }) {
  const reduceMotion = usePrefersReducedMotion()
  const [ref, inView] = useInView({ once, enabled: !eager })

  return (
    <div ref={ref} className={className}>
      {inView ? (
        <Suspense fallback={fallback || <Skeleton className="w-full rounded-2xl" style={{ height }} />}>
          <DelayGate delayMs={reduceMotion ? 0 : delayMs}>{children}</DelayGate>
        </Suspense>
      ) : (
        fallback || <Skeleton className="w-full rounded-2xl" style={{ height }} aria-hidden />
      )}
    </div>
  )
}

function DelayGate({ delayMs, children }) {
  const [ready, setReady] = useState(delayMs <= 0)
  if (!ready && typeof window !== 'undefined') {
    window.setTimeout(() => setReady(true), delayMs)
  }
  return ready ? children : <Skeleton className="h-full w-full rounded-2xl" />
}
