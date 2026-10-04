import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input ref={ref} data-slot="input" type={type} className={cn('flex h-9 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-[var(--muted)] focus-visible:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-50', type === 'range' && 'h-auto border-0 px-0 shadow-none accent-[var(--accent)]', type === 'checkbox' && 'size-4 accent-[var(--accent)]', className)} {...props} />
))
Input.displayName = 'Input'
