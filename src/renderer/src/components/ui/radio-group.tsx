import * as React from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { Circle } from 'lucide-react'
import { cn } from '../../lib/utils'

export const RadioGroup = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Root>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} data-slot="radio-group" className={cn('grid gap-2', className)} {...props} />
))
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName

export const RadioGroupItem = React.forwardRef<React.ElementRef<typeof RadioGroupPrimitive.Item>, React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item> & { variant?: 'default' | 'segmented' }>(({ className, children, variant = 'default', ...props }, ref) => (
  <RadioGroupPrimitive.Item ref={ref} data-slot="radio-group-item" data-variant={variant} className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50', variant === 'default' && 'aspect-square size-4 rounded-full border border-[var(--border)] text-[var(--accent)]', className)} {...props}>
    {variant === 'default' && <RadioGroupPrimitive.Indicator className="flex items-center justify-center"><Circle className="size-2 fill-current" /></RadioGroupPrimitive.Indicator>}
    {children}
  </RadioGroupPrimitive.Item>
))
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName
