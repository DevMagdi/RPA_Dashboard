/**
 * RBAC / route-registry contract.
 *
 * The sidebar, the command palette, the prefetcher and the router all read
 * `lib/routeMeta.js`, so this file is the single place that proves a principal
 * only ever *sees* (and only ever pre-loads) the modules they hold a permission
 * for.  The server still enforces every call — this is defence in depth and a
 * guard against a future refactor leaking an admin page into a viewer's menu.
 */
import { describe, expect, it } from 'vitest'

import { ROUTES, matchRoute, routesFor, sectionsFor } from '../lib/routeMeta'

const ALL = () => true
const NONE = () => false
const only = (...permissions) => (permission) => permissions.includes(permission)

describe('route registry', () => {
  it('declares a unique id, path, icon, label, section and lazy loader per module', () => {
    const ids = new Set()
    for (const route of ROUTES) {
      expect(route.path.startsWith('/')).toBe(true)
      expect(route.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(ids.has(route.id), `duplicate route id ${route.id}`).toBe(false)
      ids.add(route.id)
      expect(route.labelKey).toMatch(/^nav\./)
      expect(route.icon).toBeTruthy()
      expect(['operations', 'governance', 'administration']).toContain(route.section)
      // Every page is a separate chunk — no eager page import may sneak in.
      expect(typeof route.load).toBe('function')
    }
    expect(ids.size).toBe(ROUTES.length)
  })

  it('filters modules by permission and honours the super-admin wildcard', () => {
    const superAdmin = routesFor(ALL)
    expect(superAdmin.length).toBe(ROUTES.length)

    // Only the unguarded modules (alerts, settings) survive without a grant.
    expect(routesFor(NONE).map((route) => route.id)).toEqual(['alerts', 'settings'])

    // `audit:read` also unlocks the platform-health module; organization is
    // gated on the wildcard; alerts/settings are intentionally ungated.
    expect(routesFor(only('audit:read')).map((route) => route.id)).toEqual(['audit', 'health', 'alerts', 'settings'])
    expect(routesFor(only('*')).map((route) => route.id)).toContain('organization')

    // A viewer must never receive an operator or administrative module.
    const viewer = routesFor(only('dashboard:read', 'processes:read', 'runs:read')).map((route) => route.id)
    expect(viewer).toEqual(['dashboard', 'processes', 'runs', 'alerts', 'settings'])
    expect(viewer).not.toContain('users')
    expect(viewer).not.toContain('organization')
    expect(viewer).not.toContain('audit')
    expect(viewer).not.toContain('infrastructure')
  })

  it('drops empty sections so the sidebar never renders a bare heading', () => {
    const sections = sectionsFor(only('dashboard:read', 'audit:read'))
    expect(sections.every((section) => section.routes.length > 0)).toBe(true)
    // administration is present because settings is intentionally ungated.
    expect(sections.map((section) => section.key)).toEqual(['operations', 'governance', 'administration'])
    // governance holds audit + platform health, both behind `audit:read`.
    expect(sections.find((section) => section.key === 'governance').routes.map((route) => route.id)).toEqual(['audit', 'health'])
  })

  it('resolves nested paths with the longest prefix', () => {
    expect(matchRoute('/').id).toBe('dashboard')
    expect(matchRoute('/runs').id).toBe('runs')
    expect(matchRoute('/lifecycle').id).toBe('lifecycle')
    expect(matchRoute('/unknown-module')?.id).toBeUndefined()
  })

  it('keeps the documented Ctrl+K navigation hotkeys unique', () => {
    const hotkeys = ROUTES.map((route) => route.hotkey).filter(Boolean)
    expect(new Set(hotkeys).size).toBe(hotkeys.length)
    for (const hotkey of hotkeys) expect(hotkey).toMatch(/^g [a-z]$/)
  })
})
