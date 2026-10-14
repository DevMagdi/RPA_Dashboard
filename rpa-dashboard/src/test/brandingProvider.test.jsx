import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import BrandingProvider from '../context/BrandingProvider'
import api from '../lib/api'

vi.mock('../lib/api', () => ({ default: { get: vi.fn() } }))

const BRANDING_VARIABLES = [
  '--brand',
  '--brand-strong',
  '--brand-lighter',
  '--brand-soft',
  '--brand-ring',
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--chart-1',
  '--chart-2',
]

describe('runtime organization branding', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({
      name: 'Bank Control Room',
      primary_color: '#6254E8',
      accent_color: '#0F9F91',
    })
  })

  afterEach(() => {
    BRANDING_VARIABLES.forEach((name) => document.documentElement.style.removeProperty(name))
    api.get.mockReset()
  })

  it('updates semantic, focus and chart colors from the installation branding', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <main>Control Room</main>
        </BrandingProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--brand')).toBe('#6254E8')
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#0F9F91')
    })
    expect(document.documentElement.style.getPropertyValue('--brand-ring')).toBe('rgba(98, 84, 232, 0.38)')
    expect(document.documentElement.style.getPropertyValue('--chart-1')).toBe('#6254E8')
    expect(document.documentElement.style.getPropertyValue('--chart-2')).toBe('#0F9F91')
    expect(document.documentElement.style.getPropertyValue('--accent-strong')).toBe('#0c7f74')
  })
})
