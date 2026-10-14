import { ContextMenu as Primitive } from 'radix-ui'
import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'

export const ContextMenu = Primitive.Root
export const ContextMenuTrigger = Primitive.Trigger

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof Primitive.Content>): React.JSX.Element {
  return <Primitive.Portal><Primitive.Content className={cn('file-context-menu', className)} collisionPadding={8} {...props} /></Primitive.Portal>
}

export function ContextMenuItem({ className, ...props }: ComponentProps<typeof Primitive.Item>): React.JSX.Element {
  return <Primitive.Item className={cn('file-context-menu-item', className)} {...props} />
}

export function ContextMenuSeparator(): React.JSX.Element {
  return <Primitive.Separator className="file-context-menu-separator" />
}
