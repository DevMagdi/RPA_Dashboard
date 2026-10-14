/**
 * TopNav — the primary, centred pill navigation (Hybrid control-room plan).
 *
 * The top bar is the operator's first choice for moving around: five
 * high-traffic modules sit in a white pill, the active one lights up with the
 * brand gradient, and every other module the user may open lives under the
 * "More" menu. The sidebar stays available as a collapsible rail for those who
 * prefer it, and on narrow screens the drawer takes over entirely (this bar is
 * hidden below `lg`).
 *
 * Permissions come from the same `sectionsFor(has)` source the sidebar uses,
 * so nothing appears here that the signed-in user cannot open.
 */
import { MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../context/AuthProvider'
import { useHoverIntent } from '../../hooks/ui'
import { matchRoute, prefetchRoute, sectionsFor } from '../../lib/routeMeta'
import { cn } from '../../lib/utils'
import { DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator } from '../ui'

/** Ordered high-traffic modules shown inline; everything else goes under "More". */
export const PRIMARY_NAV_IDS = ['dashboard', 'processes', 'runs', 'alerts', 'capacity']

/** Pure selector — exported so the split between inline and overflow is testable. */
export function splitTopNav(sections, primaryIds = PRIMARY_NAV_IDS) {
  const allowed = sections.flatMap((section) => section.routes)
  const primary = primaryIds.map((id) => allowed.find((route) => route.id === id)).filter(Boolean)
  const primaryIdSet = new Set(primary.map((route) => route.id))
  const overflow = sections
    .map((section) => ({
      ...section,
      routes: section.routes.filter((route) => !primaryIdSet.has(route.id)),
    }))
    .filter((section) => section.routes.length > 0)
  return { primary, overflow }
}

function TopNavItem({ route, label }) {
  const hover = useHoverIntent(() => prefetchRoute(route))
  const Icon = route.icon
  return (
    <NavLink
      to={route.path}
      end={route.path === '/'}
      title={label}
      {...hover}
      className={({ isActive }) =>
        cn(
          'focus-ring top-nav__item relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-200 ease-premium',
          isActive ? 'nav-pill-active' : 'text-muted hover:bg-surface-2 hover:text-text',
        )
      }
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      <span className="sr-only xl:not-sr-only">{label}</span>
    </NavLink>
  )
}

function OverflowMenu({ sections, activeRoute }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const active = Boolean(activeRoute)
  const count = sections.reduce((total, section) => total + section.routes.length, 0)

  if (count === 0) return null

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="start"
      contentClassName="max-h-[70vh] w-64 overflow-y-auto"
      trigger={
        <button
          type="button"
          aria-label={t('nav.moreModules', { count })}
          aria-haspopup="menu"
          data-active={active ? 'true' : undefined}
          className={cn(
            'focus-ring top-nav__item inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-premium',
            active ? 'nav-pill-active' : 'text-muted hover:bg-surface-2 hover:text-text',
          )}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
          <span className="sr-only xl:not-sr-only">{active ? t(activeRoute.labelKey) : t('nav.more')}</span>
        </button>
      }
    >
      {sections.map((section, index) => (
        <div key={section.key}>
          {index > 0 ? <DropdownSeparator /> : null}
          <DropdownLabel>{t(section.labelKey)}</DropdownLabel>
          {section.routes.map((route) => (
            <DropdownItem
              key={route.id}
              icon={route.icon}
              onSelect={() => {
                setOpen(false)
                navigate(route.path)
              }}
            >
              {t(route.labelKey)}
            </DropdownItem>
          ))}
        </div>
      ))}
    </DropdownMenu>
  )
}

export default function TopNav() {
  const { t } = useTranslation()
  const { has } = useAuth()
  const location = useLocation()
  const sections = useMemo(() => sectionsFor(has), [has])
  const { primary, overflow } = useMemo(() => splitTopNav(sections), [sections])
  const activeRoute = useMemo(() => matchRoute(location.pathname), [location.pathname])
  const inlineActive = primary.some((route) => route.id === activeRoute?.id)
  const overflowActive = Boolean(activeRoute) && !inlineActive ? activeRoute : null

  if (primary.length === 0 && overflow.length === 0) return null

  return (
    <nav aria-label={t('a11y.mainNavigation')} className="top-nav flex min-w-0 max-w-full">
      <div className="top-nav__pill flex min-w-0 items-center gap-0.5 rounded-[18px] border border-border/80 bg-surface p-1 shadow-xs">
        {primary.map((route) => (
          <TopNavItem key={route.id} route={route} label={t(route.labelKey)} />
        ))}
        <OverflowMenu sections={overflow} activeRoute={overflowActive} />
      </div>
    </nav>
  )
}
