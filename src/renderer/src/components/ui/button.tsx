import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva('ui-button inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none', {
  variants: {
    variant: {
      default: 'ui-button-default',
      destructive: 'ui-button-destructive',
      outline: 'ui-button-outline',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      link: 'ui-button-link',
    },
    size: { default: 'min-h-9 px-4 py-2', sm: 'min-h-8 rounded-md px-3 text-xs', lg: 'min-h-10 rounded-md px-8', icon: 'size-9 p-0' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} data-slot="button" data-variant={variant ?? 'default'} className={cn(buttonVariants({ variant, size }), className)} {...props} />
))
Button.displayName = 'Button'
