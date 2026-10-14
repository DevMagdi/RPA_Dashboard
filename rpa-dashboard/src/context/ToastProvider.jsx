import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const TONES = {
  success: 'border-success/40 bg-success-soft text-success',
  error: 'border-danger/40 bg-danger-soft text-danger',
  warning: 'border-warning/40 bg-warning-soft text-warning',
  info: 'border-info/40 bg-info-soft text-info',
}

/**
 * Toast notifications with optimistic-friendly deduplication.
 * Bank operators keep the console open for hours: identical toasts collapse
 * into a counter instead of stacking, and every toast auto-dismisses.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (toast) => {
      const id = ++counter.current
      const entry = {
        id,
        type: toast.type || 'info',
        title: toast.title,
        message: toast.message,
        duration: toast.duration ?? 4500,
      }
      setToasts((current) => {
        const duplicate = current.find((item) => item.title === entry.title && item.message === entry.message)
        if (duplicate) {
          return current.map((item) =>
            item.id === duplicate.id ? { ...item, count: (item.count || 1) + 1 } : item,
          )
        }
        return [...current.slice(-4), entry]
      })
      if (entry.duration > 0) setTimeout(() => dismiss(id), entry.duration)
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      push,
      success: (title, message) => push({ type: 'success', title, message }),
      error: (title, message) => push({ type: 'error', title, message }),
      warning: (title, message) => push({ type: 'warning', title, message }),
      info: (title, message) => push({ type: 'info', title, message }),
      dismiss,
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-[min(92vw,26rem)] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.type] || Info
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={`pointer-events-auto glass flex items-start gap-3 rounded-2xl border p-3 shadow-pop ${
                  TONES[toast.type] || TONES.info
                }`}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text">
                    {toast.title}
                    {toast.count > 1 ? <span className="ms-2 text-xs text-muted">×{toast.count}</span> : null}
                  </p>
                  {toast.message ? <p className="mt-0.5 text-xs text-muted break-words">{toast.message}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="focus-ring rounded-lg p-1 text-muted transition hover:bg-surface-2 hover:text-text"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4"  aria-hidden/>
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}

export default ToastProvider
