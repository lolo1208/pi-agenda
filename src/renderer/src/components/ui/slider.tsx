import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '../../lib/utils'

type SliderOwnProps = {
  /** 滑块无障碍名称，会作用在每个可聚焦的滑块手柄上。 */
  label?: string
  trackClassName?: string
  thumbClassName?: string
}

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & SliderOwnProps>(({ className, label, value, defaultValue, min = 0, max = 100, trackClassName, thumbClassName, 'aria-label': ariaLabel, ...props }, ref) => {
  const thumbs = React.useMemo(() => value ?? defaultValue ?? [min], [value, defaultValue, min])
  const thumbName = ariaLabel ?? label
  return (
    <SliderPrimitive.Root ref={ref} data-slot="slider" value={thumbs} min={min} max={max} {...props} className={cn('relative flex w-full touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col', className)}>
      <SliderPrimitive.Track data-slot="slider-track" className={cn('relative grow overflow-hidden rounded-full bg-[var(--hover)] data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5', trackClassName)}>
        <SliderPrimitive.Range data-slot="slider-range" className={cn('absolute bg-[var(--accent)] data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full')} />
      </SliderPrimitive.Track>
      {thumbs.map((thumb, index) => (
        <SliderPrimitive.Thumb key={index} data-slot="slider-thumb" aria-label={thumbName} className={cn('block size-3.5 shrink-0 rounded-full border border-[var(--accent)] bg-[var(--surface)] shadow-sm transition-[color,box-shadow] hover:ring-4 hover:ring-[var(--accent)]/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent)]/30 data-[disabled]:pointer-events-none data-[disabled]:opacity-50', thumbClassName)} />
      ))}
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName
