import { DropdownMenu as Primitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger
export const DropdownMenuSub = Primitive.Sub
export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof Primitive.Content>): React.JSX.Element {
  return <Primitive.Portal><Primitive.Content className={cn('file-context-menu', className)} collisionPadding={8} {...props} /></Primitive.Portal>
}
export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>): React.JSX.Element {
  return <Primitive.Item className={cn('file-context-menu-item', className)} {...props} />
}
export function DropdownMenuSubTrigger({ className, ...props }: ComponentProps<typeof Primitive.SubTrigger>): React.JSX.Element {
  return <Primitive.SubTrigger className={cn('file-context-menu-item', className)} {...props} />
}
export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Primitive.SubContent>): React.JSX.Element {
  return <Primitive.Portal><Primitive.SubContent className={cn('file-context-menu', className)} collisionPadding={8} {...props} /></Primitive.Portal>
}
