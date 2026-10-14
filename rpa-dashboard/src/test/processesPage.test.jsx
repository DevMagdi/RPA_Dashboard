import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProcessesPage from '../pages/ProcessesPage'
import en from '../i18n/locales/en.json'

const mocks = vi.hoisted(() => ({
  useProcesses: vi.fn(),
  useRoiSummary: vi.fn(),
  useDepartments: vi.fn(),
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../hooks/api', () => ({
  useProcesses: mocks.useProcesses,
  useRoiSummary: mocks.useRoiSummary,
  useDepartments: mocks.useDepartments,
  useDeleteProcess: () => ({ mutateAsync: mocks.mutate }),
  useSetProcessActive: () => ({ mutateAsync: mocks.mutate }),
  useUpdateRoi: () => ({ mutateAsync: mocks.mutate }),
  useUpdateSla: () => ({ mutateAsync: mocks.mutate }),
}))
vi.mock('../context/AuthProvider', () => ({ useAuth: () => ({ has: () => true }) }))
vi.mock('../context/ToastProvider', () => ({
  useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
}))

describe('Processes page presentation modes', () => {
  beforeEach(() => {
    mocks.useProcesses.mockReturnValue({
      data: {
        items: [{
          ConfigID: 18,
          ProcessName: 'Invoice reconciliation',
          Provider: 'UiPath',
          Department: 'Finance',
          Criticality: 'High',
          ExpectedRunsPerDay: 1200,
          SLATargetMinutes: 45,
          IsActive: true,
        }],
        total: 1,
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    })
    mocks.useRoiSummary.mockReturnValue({
      data: [{
        process_name: 'Invoice reconciliation',
        actual_runs_per_day: 1080,
        target_attainment_percent: 90,
        cost_saved: 1250,
      }],
    })
    mocks.useDepartments.mockReturnValue({ data: ['Finance'] })
    mocks.mutate.mockResolvedValue({})
  })

  function renderPage(path = '/processes') {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <ProcessesPage />
      </MemoryRouter>,
    )
  }

  it('renders the card view and switches back to the sortable table', async () => {
    const user = userEvent.setup()
    localStorage.setItem('rpa.processes.view', JSON.stringify('cards'))
    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: 'Invoice reconciliation' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: en.processes.targetAttainment })).toBeInTheDocument()
    expect(container.querySelector('table')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: en.processes.tableView }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByText(en.processes.cardsView)).toBeInTheDocument()
  })

  it('loads the process selected in the command palette search result', () => {
    renderPage('/processes?process=Invoice%20reconciliation')

    expect(screen.getByRole('textbox', { name: en.actions.search })).toHaveValue('Invoice reconciliation')
  })
})
