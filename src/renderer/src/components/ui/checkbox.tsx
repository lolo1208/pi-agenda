import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root ref={ref} data-slot="checkbox" className={cn('peer size-4 shrink-0 rounded-[4px] border border-[var(--border)] bg-[var(--surface)] text-[var(--selected-text)] shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent)]', className)} {...props}>
    <CheckboxPrimitive.Indicator className="flex items-center justify-center"><Check size={14} /></CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName
