/**
 * Route-level loading skeleton.
 *
 * Appears only while a code-split page chunk is in flight.  It mirrors the
 * real layout (header, KPI rail, chart grid) so the console does not "jump"
 * when the content arrives — perceived latency matters as much as the real
 * one.  Rendered with the same grid/spacing tokens as the pages themselves.
 */
import { Card, Skeleton } from '../ui'

export default function RouteFallback({ variant = 'default' }) {
  if (variant === 'dashboard') {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-[17rem] rounded-3xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-6 w-16" />
              <Skeleton className="mt-2 h-2.5 w-12" />
            </Card>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3 w-80" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-20" />
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-8" style={{ opacity: 1 - index * 0.09 }} />
          ))}
        </div>
      </Card>
    </div>
  )
}
