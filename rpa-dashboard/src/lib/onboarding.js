/**
 * Onboarding progress — per workstation, no server round-trip.
 *
 * A step is marked done when the operator actually opens the module (each page
 * calls `markOnboardingStep`), which is a far better signal than a click on a
 * "next" button.  A tiny subscriber list keeps the dashboard checklist in sync
 * without pulling in another context provider.
 */
import { useEffect, useState } from 'react'

import storage from './storage'

export const ONBOARDING_STEPS = ['stepConnect', 'stepProcesses', 'stepCapacity', 'stepReview']

const prefix = (key) => `onboarding.step.${key}`
const listeners = new Set()

export function readProgress() {
  return Object.fromEntries(ONBOARDING_STEPS.map((key) => [key, Boolean(storage.get(prefix(key), false))]))
}

export function markOnboardingStep(key) {
  if (!ONBOARDING_STEPS.includes(key)) return
  if (storage.get(prefix(key), false)) return
  storage.set(prefix(key), true)
  listeners.forEach((listener) => listener())
}

export function resetOnboardingProgress() {
  ONBOARDING_STEPS.forEach((key) => storage.remove(prefix(key)))
  listeners.forEach((listener) => listener())
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Live progress map; re-renders the checklist as steps complete. */
export function useOnboardingProgress(overrides = {}) {
  const [state, setState] = useState(readProgress)
  useEffect(() => subscribe(() => setState(readProgress())), [])
  return { ...state, ...overrides }
}
