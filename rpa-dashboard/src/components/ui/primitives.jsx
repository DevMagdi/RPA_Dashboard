/**
 * UI primitives — shadcn/ui architecture, product branding.
 *
 * These are *source* components (not a runtime dependency): Radix UI for
 * behaviour and accessibility, `class-variance-authority` for the variant
 * matrix, `tailwind-merge` for predictable class overrides and the design
 * tokens from `src/index.css` for the visual language.  A component pulled
 * from the shadcn registry can be dropped next to these and will inherit the
 * same theme (the conventional `background/foreground/card/primary/ring`
 * tokens are mapped in `tailwind.config.js`).
 *
 * Rules every component here follows:
 *  • logical CSS properties only (`ps-/pe-/ms-/me-/start-/end-`) — never `left`
 *    or `right` — so Arabic (RTL) mirrors perfectly;
 *  • a visible focus ring (`focus-ring`) and `aria-*` state for keyboard users;
 *  • `prefers-reduced-motion` respected through CSS, not JS branches.
 */
import * as cvaModule from 'class-variance-authority'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import * as SlotPrimitive from '@radix-ui/react-slot'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { forwardRef, useEffect, useRef } from 'react'

import { useDirection } from '../../lib/direction'
import { cn } from '../../lib/utils'

const cva = cvaModule.cva
export { cva }

/* ------------------------------------------------------------------ Button */

export const buttonVariants = cva(
  'focus-ring relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-[background-color,color,box-shadow,transform,border-color] duration-200 ease-premium active:scale-[.975] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-brand-fg shadow-soft hover:bg-brand-strong hover:shadow-glow',
        secondary:
          'border border-border bg-surface text-text shadow-xs hover:border-brand/30 hover:bg-surface-2 hover:text-brand',
        outline:
          'border border-brand/40 bg-brand-soft text-brand hover:border-brand/70 hover:bg-brand-soft/80',
        ghost: 'text-muted hover:bg-surface-2 hover:text-text',
        subtle: 'bg-surface-2 text-text hover:bg-surface-3',
        danger: 'bg-danger text-white shadow-soft hover:brightness-108 hover:shadow-[0_10px_30px_-12px_var(--danger)]',
        success: 'bg-success text-white shadow-soft hover:brightness-108',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-7 rounded-lg px-2 text-2xs gap-1.5',
        sm: 'h-8 px-3 text-xs gap-1.5',
        md: 'h-9.5 px-4 text-sm',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9',
        'icon-sm': 'h-8 w-8 rounded-lg',
        'icon-lg': 'h-11 w-11',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
)

export const Button = forwardRef(function Button(
  { className, variant, size, block, loading = false, icon: Icon, iconEnd: IconEnd, asChild = false, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? SlotPrimitive.Slot : 'button'
  const content = (
    <>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin-slow" aria-hidden />
      ) : Icon ? (
        <Icon className={cn(size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4', 'shrink-0')} aria-hidden />
      ) : null}
      {children}
      {IconEnd && !loading ? <IconEnd className="h-4 w-4 shrink-0" aria-hidden /> : null}
    </>
  )
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : props.type || 'button'}
      aria-busy={loading || undefined}
      disabled={asChild ? undefined : disabled || loading}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    >
      {content}
    </Comp>
  )
})

/* -------------------------------------------------------------------- Card */

export const Card = forwardRef(function Card(
  { className, as: Tag = 'section', interactive = false, glass = false, hover = false, children, ...props },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cn(
        'rounded-2xl border border-border/90 shadow-card transition-[border-color,box-shadow,transform] duration-300 ease-premium',
        glass ? 'glass' : 'bg-surface',
        (hover || interactive) && 'card-hover',
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  )
})

export function CardHeader({ className, title, subtitle, description, actions, icon: Icon, children, compact = false }) {
  const label = title ?? children
  const caption = subtitle ?? description
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-border/80',
        compact ? 'px-4 py-2.5' : 'px-4 py-3.5',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid h-8.5 w-8.5 shrink-0 place-items-center rounded-xl border border-brand/12 bg-brand-soft text-brand">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text">{label}</h2>
          {caption ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{caption}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function CardTitle({ className, children, as: Tag = 'h3' }) {
  return <Tag className={cn('text-sm font-semibold text-text', className)}>{children}</Tag>
}

export function CardDescription({ className, children }) {
  return <p className={cn('text-xs leading-relaxed text-muted', className)}>{children}</p>
}

export function CardContent({ className, children }) {
  return <div className={cn('p-4', className)}>{children}</div>
}

export function CardFooter({ className, children }) {
  return <footer className={cn('flex flex-wrap items-center gap-2 border-t border-border/80 px-4 py-3', className)}>{children}</footer>
}

/* -------------------------------------------------------------------- Badge */

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-2xs font-semibold transition-colors',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface-2 text-muted',
        brand: 'border-transparent bg-brand-soft text-brand',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        danger: 'border-transparent bg-danger-soft text-danger',
        info: 'border-transparent bg-info-soft text-info',
        accent: 'border-transparent bg-accent-soft text-accent',
        outline: 'border-border text-text',
      },
      size: { sm: 'px-2 py-0 text-[10px]', md: '', lg: 'px-3 py-1 text-xs' },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
)

export function Badge({ className, tone, size, dot = false, children, ...props }) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ Inputs */

const controlBase =
  'focus-ring w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text shadow-xs transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted/80 hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60'

export const Input = forwardRef(function Input({ className, invalid, icon: Icon, suffix, ...props }, ref) {
  const control = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, Icon && 'ps-9', suffix && 'pe-9', invalid && 'border-danger focus-visible:ring-danger/50', className)}
      {...props}
    />
  )
  if (!Icon && !suffix) return control
  return (
    <span className="relative block">
      {Icon ? <Icon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden /> : null}
      {control}
      {suffix ? <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span> : null}
    </span>
  )
})

export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(controlBase, 'resize-y leading-relaxed', className)} {...props} />
})

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <span className="relative block">
      <select ref={ref} className={cn(controlBase, 'cursor-pointer appearance-none pe-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
    </span>
  )
})

export function Label({ className, required = false, children, ...props }) {
  return (
    <label className={cn('block text-xs font-medium text-text-soft', className)} {...props}>
      {children}
      {required ? <span className="ms-1 text-danger" aria-hidden>*</span> : null}
    </label>
  )
}

export const Checkbox = forwardRef(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'focus-ring peer h-4.5 w-4.5 shrink-0 rounded-[6px] border border-border-strong bg-surface shadow-xs transition-colors data-[state=checked]:border-brand data-[state=checked]:bg-brand',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center text-brand-fg">
        <Check className="h-3.5 w-3.5" strokeWidth={3}  aria-hidden/>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
})

/**
 * Radix switch.  Exported as `SwitchControl` so the product keeps its own
 * legacy `Switch({ checked, onChange, label })` signature in `./index.jsx`
 * (page code written against the old kit keeps working unchanged).
 */
export const SwitchControl = forwardRef(function SwitchControl({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'focus-ring peer inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border-strong transition-colors duration-200 data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4.5 w-4.5 rounded-full bg-white shadow-soft transition-transform duration-200 ease-premium data-[state=checked]:translate-x-[1.15rem] rtl:data-[state=checked]:-translate-x-[1.15rem]" />
    </SwitchPrimitive.Root>
  )
})

/* --------------------------------------------------------------- Separator */

export function Separator({ className, orientation = 'horizontal', ...props }) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}

/* ---------------------------------------------------------------- Progress */

export function Progress({ value = 0, max = 100, tone = 'brand', className, indicatorClassName, showValue = false }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (Number(value) / max) * 100)) : 0
  const tones = {
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
    accent: 'bg-accent',
  }
  return (
    <ProgressPrimitive.Root
      value={percent}
      max={100}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full transition-[width] duration-500 ease-premium', tones[tone] || tones.brand, indicatorClassName)}
        style={{ width: `${percent}%` }}
      />
      {showValue ? <span className="sr-only">{`${Math.round(percent)}%`}</span> : null}
    </ProgressPrimitive.Root>
  )
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className, style, ...props }) {
  return <div aria-hidden className={cn('skeleton', className)} style={style} {...props} />
}

export function SkeletonText({ lines = 3, className, lineClassName }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={cn('h-3', lineClassName)} style={{ width: `${100 - index * 11}%` }} />
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- Tabs */

export function TabsRoot({ className, dir, ...props }) {
  const direction = useDirection()
  return <TabsPrimitive.Root dir={dir || direction} className={cn('w-full', className)} {...props} />
}

export function TabsList({ className, children, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/80 bg-surface-2/80 p-1 shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
}

export function TabsTrigger({ className, children, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'focus-ring relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted transition-[color,background-color,box-shadow] duration-200 hover:text-text data-[state=active]:bg-surface data-[state=active]:text-brand data-[state=active]:shadow-soft',
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content className={cn('mt-4 focus-visible:outline-none', className)} {...props} />
}

/* ---------------------------------------------------------------- Segmented */

export function SegmentedControl({ value, onValueChange, items = [], className, size = 'md' }) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange?.(next)}
      className={cn('inline-flex items-center gap-0.5 rounded-xl border border-border/80 bg-surface-2/80 p-1', className)}
    >
      {items.map((item) => (
        <ToggleGroupPrimitive.Item
          key={item.value}
          value={item.value}
          className={cn(
            'focus-ring inline-flex items-center gap-1.5 rounded-lg font-medium text-muted transition-all duration-200 hover:text-text data-[state=on]:bg-surface data-[state=on]:text-brand data-[state=on]:shadow-soft',
            size === 'sm' ? 'px-2.5 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
          )}
        >
          {item.icon ? <item.icon className="h-3.5 w-3.5" aria-hidden /> : null}
          {item.label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  )
}

/* ------------------------------------------------------------------- Kbd */

export function Kbd({ className, children }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] border border-border bg-surface px-1.5 font-mono text-[10px] font-medium text-muted shadow-xs',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/* ----------------------------------------------------------------- Tooltip */

export function TooltipProvider({ children, delayDuration = 240, ...props }) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={120} {...props}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export function TooltipRoot({ content, children, side = 'top', align = 'center', className, delayDuration, disabled = false }) {
  const direction = useDirection()
  if (!content || disabled) return children
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          dir={direction}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={10}
          className={cn(
            'z-[80] max-w-xs rounded-xl border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-pop',
            'data-[state=delayed-open]:animate-scale-in',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

export const Tooltip = TooltipRoot

/* ------------------------------------------------------------ DropdownMenu */

export function DropdownMenu({ open, onOpenChange, trigger, children, align = 'end', side = 'bottom', contentClassName, modal = false }) {
  const direction = useDirection()
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal} dir={direction}>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={10}
          className={cn(
            'z-[75] min-w-[12rem] overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-pop',
            'data-[state=open]:animate-scale-in data-[state=closed]:animate-fade-out',
            contentClassName,
          )}
        >
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

export function DropdownItem({ className, icon: Icon, endIcon: EndIcon, destructive = false, children, ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors duration-150',
        'data-[highlighted]:bg-surface-2 data-[highlighted]:text-text [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
        destructive ? 'text-danger data-[highlighted]:bg-danger-soft' : 'text-text-soft',
        props.disabled && 'pointer-events-none opacity-50',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden className="text-muted" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {EndIcon ? <EndIcon className="text-muted" aria-hidden /> : null}
    </DropdownMenuPrimitive.Item>
  )
}

export function DropdownCheckboxItem({ className, children, ...props }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-text-soft outline-none transition-colors data-[highlighted]:bg-surface-2',
        className,
      )}
      {...props}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border border-border-strong">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-3 w-3 text-brand" strokeWidth={3}  aria-hidden/>
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

export function DropdownLabel({ className, children }) {
  return (
    <DropdownMenuPrimitive.Label className={cn('px-2.5 py-1.5 text-2xs font-semibold tracking-[0.12em] text-muted uppercase', className)}>
      {children}
    </DropdownMenuPrimitive.Label>
  )
}

export function DropdownSeparator({ className }) {
  return <DropdownMenuPrimitive.Separator className={cn('my-1.5 h-px bg-border', className)} />
}

/* ------------------------------------------------------------------ Dialog */

export function Dialog({ open, onOpenChange, children, dir }) {
  const direction = useDirection()
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} dir={dir || direction}>
      {children}
    </DialogPrimitive.Root>
  )
}

export function DialogContent({
  className,
  children,
  title,
  description,
  footer,
  size = 'md',
  closeLabel = 'Close',
  hideClose = false,
  onCloseAutoFocus,
  initialFocus,
}) {
  const contentRef = useRef(null)
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-[min(96vw,90rem)]' }

  useEffect(() => {
    if (!initialFocus) return undefined
    const timer = setTimeout(() => {
      const node = contentRef.current?.querySelector(initialFocus)
      node?.focus?.()
    }, 60)
    return () => clearTimeout(timer)
  }, [initialFocus])

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--bg-deep)_62%,transparent)] backdrop-blur-[3px] data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <DialogPrimitive.Content
        ref={contentRef}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          'fixed left-1/2 top-1/2 z-[72] w-[min(94vw,var(--dialog-w))] -translate-x-1/2 -translate-y-1/2',
          'overflow-hidden rounded-3xl border border-border bg-surface shadow-modal',
          'data-[state=open]:animate-scale-in data-[state=closed]:animate-fade-out',
          widths[size] || widths.md,
          className,
        )}
        style={{ '--dialog-w': size === 'xl' ? '72rem' : size === 'lg' ? '56rem' : size === 'md' ? '42rem' : '28rem' }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />
        {title || !hideClose ? (
          <header className="flex items-start justify-between gap-4 border-b border-border/80 px-5 py-4">
            <div className="min-w-0">
              {title ? (
                <DialogPrimitive.Title className="text-base font-semibold tracking-[-0.01em] text-text">{title}</DialogPrimitive.Title>
              ) : null}
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-xs leading-relaxed text-muted">{description}</DialogPrimitive.Description>
              ) : null}
            </div>
            {hideClose ? null : (
              <DialogPrimitive.Close
                aria-label={closeLabel}
                className="focus-ring -me-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <X className="h-4 w-4"  aria-hidden/>
              </DialogPrimitive.Close>
            )}
          </header>
        ) : null}
        <div className="max-h-[min(72vh,44rem)] overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/80 bg-surface-2/60 px-5 py-3">{footer}</footer> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTrigger({ children, asChild = true }) {
  return <DialogPrimitive.Trigger asChild={asChild}>{children}</DialogPrimitive.Trigger>
}

/* ----------------------------------------------------------------- Popover */

export function Popover({ open, onOpenChange, trigger, children, align = 'end', side = 'bottom', contentClassName }) {
  const direction = useDirection()
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          dir={direction}
          align={align}
          side={side}
          sideOffset={8}
          collisionPadding={10}
          className={cn(
            'z-[75] w-auto overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-pop',
            'data-[state=open]:animate-scale-in data-[state=closed]:animate-fade-out',
            contentClassName,
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/* --------------------------------------------------------------- ScrollArea */

export function ScrollArea({ className, viewportClassName, children, ...props }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className={cn('h-full w-full rounded-[inherit]', viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-2 touch-none select-none p-0.5 transition-opacity duration-200"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border-strong/70" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  )
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({ name, src, size = 36, className }) {
  const initials = String(name || '?')
    .trim()
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <AvatarPrimitive.Root
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-gradient-to-br from-brand-soft to-surface-2 text-xs font-semibold text-brand',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="h-full w-full object-cover" /> : null}
      <AvatarPrimitive.Fallback className="grid h-full w-full place-items-center">{initials}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

/* --------------------------------------------------------------- Overlay fx */

/** Animated presence wrapper: keeps exit animations honest without extra deps. */
export function Presence({ show, children }) {
  return <AnimatePresence>{show ? children : null}</AnimatePresence>
}

export { motion }
