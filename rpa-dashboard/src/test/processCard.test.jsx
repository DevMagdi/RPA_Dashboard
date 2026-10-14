import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ProcessCard from '../components/processes/ProcessCard'
import en from '../i18n/locales/en.json'

const process = {
  ConfigID: 18,
  ProcessName: 'Invoice reconciliation',
  Provider: 'UiPath',
  Department: 'Finance',
  Criticality: 'High',
  ExpectedRunsPerDay: 1200,
  SLATargetMinutes: 45,
  IsActive: true,
}

const stats = {
  actual_runs_per_day: 1080,
  target_attainment_percent: 90,
  cost_saved: 1250,
}

describe('process card view', () => {
  it('shows process identity, operational metrics and an accessible attainment bar', () => {
    render(<ProcessCard process={process} stats={stats} canWrite={false} />)

    expect(screen.getByRole('heading', { name: process.ProcessName })).toBeInTheDocument()
    expect(screen.getByText(en.processes.expectedRuns)).toBeInTheDocument()
    expect(screen.getByText(en.processes.actualRuns)).toBeInTheDocument()
    expect(screen.getByText(en.processes.costSaved)).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: en.processes.targetAttainment })).toHaveAttribute('aria-valuenow', '90')
    expect(screen.getByText(en.processes.active)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.processes.editRoi })).not.toBeInTheDocument()
  })

  it('exposes process actions only to operators with write permission', async () => {
    const user = userEvent.setup()
    const onEditRoi = vi.fn()
    const onEditSla = vi.fn()
    const onToggleActive = vi.fn()
    const onDelete = vi.fn()

    render(
      <ProcessCard
        process={process}
        stats={stats}
        canWrite
        onEditRoi={onEditRoi}
        onEditSla={onEditSla}
        onToggleActive={onToggleActive}
        onDelete={onDelete}
      />,
    )

    await user.click(screen.getByRole('button', { name: en.processes.editRoi }))
    await user.click(screen.getByRole('button', { name: en.processes.editSla }))
    await user.click(screen.getByRole('button', { name: en.processes.deactivate }))
    await user.click(screen.getByRole('button', { name: en.processes.delete }))

    expect(onEditRoi).toHaveBeenCalledWith(process)
    expect(onEditSla).toHaveBeenCalledWith(process)
    expect(onToggleActive).toHaveBeenCalledWith(process)
    expect(onDelete).toHaveBeenCalledWith(process)
  })
})
