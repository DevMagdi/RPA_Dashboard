/**
 * Keyboard-shortcut cheatsheet (opens with `?` or from the account menu).
 *
 * The console is built for operators who keep their hands on the keyboard; the
 * sheet is the discoverability layer for everything that is not visible in the
 * UI, and it is translated like any other screen (including the Arabic
 * right-to-left key labels).
 */
import { Keyboard } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Kbd, Modal } from '../ui'

const GROUPS = [
  {
    key: 'global',
    items: [
      { keys: ['Mod', 'K'], labelKey: 'shortcuts.palette' },
      { keys: ['Mod', 'F'], labelKey: 'shortcuts.search' },
      { keys: ['?'], labelKey: 'shortcuts.help' },
      { keys: ['Esc'], labelKey: 'shortcuts.close' },
      { keys: ['Mod', 'Shift', 'L'], labelKey: 'shortcuts.language' },
      { keys: ['Mod', 'J'], labelKey: 'shortcuts.theme' },
      { keys: ['Mod', 'R'], labelKey: 'shortcuts.refresh' },
    ],
  },
]

export default function ShortcutsDialog({ open, onClose }) {
  const { t } = useTranslation()
  const modifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
  const symbols = { Mod: modifier }

  return (
    <Modal open={open} onClose={onClose} title={t('shortcuts.title')} description={t('shortcuts.subtitle')} size="sm">
      <div className="space-y-5">
        {GROUPS.map((group) => (
          <div key={group.key}>
            <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
              {t('shortcuts.title')}
            </p>
            <ul className="space-y-1.5">
              {group.items.map((item) => (
                <li key={item.labelKey} className="flex items-center justify-between gap-4 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2">
                  <span className="text-sm text-text-soft">{t(item.labelKey)}</span>
                  <span className="flex items-center gap-1">
                    {item.keys.map((key) => (
                      <Kbd key={key}>{symbols[key] || key}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}
