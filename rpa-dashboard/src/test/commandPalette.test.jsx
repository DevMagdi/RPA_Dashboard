import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CommandPalette from '../components/layout/CommandPalette'
import { applyLanguage } from '../i18n'

const mocks = vi.hoisted(() => ({
  openAlerts: [],
  acknowledgeAlert: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../hooks/api', () => ({
  useAlerts: () => ({ data: mocks.openAlerts }),
  useSetAlertStatus: () => ({ mutateAsync: mocks.acknowledgeAlert }),
}))
vi.mock('../context/AuthProvider', () => ({ useAuth: () => ({ has: () => true }) }))
vi.mock('../context/BrandingProvider', () => ({ useBranding: () => ({ companyName: 'Control Room' }) }))
vi.mock('../context/ThemeProvider', () => ({ useTheme: () => ({ toggleTheme: vi.fn(), isDark: false }) }))
vi.mock('../context/ToastProvider', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}))

describe('command palette operational actions', () => {
  beforeEach(() => {
    mocks.openAlerts = [{ AlertID: 42, Title: 'Agent offline', Severity: 'Critical' }]
    mocks.acknowledgeAlert.mockResolvedValue({ status: 'success' })
    mocks.toastSuccess.mockClear()
    mocks.toastError.mockClear()
  })

  function renderPalette() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette open onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('acknowledges an open alert from the keyboard command list', async () => {
    await applyLanguage('en')
    const user = userEvent.setup()
    renderPalette()

    const alertOption = await screen.findByRole('option', { name: /Acknowledge alert: Agent offline/i })
    await user.click(within(alertOption).getByRole('button'))

    await waitFor(() => {
      expect(mocks.acknowledgeAlert).toHaveBeenCalledWith({ id: 42, status: 'Acknowledged' })
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Acknowledge', 'Agent offline')
  })

  it('localizes the alert action for Arabic operators', async () => {
    await applyLanguage('ar')
    renderPalette()

    expect(await screen.findByRole('option', { name: /الإقرار بالتنبيه: Agent offline/ })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
  })
})
