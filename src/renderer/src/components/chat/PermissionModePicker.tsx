import { useState } from 'react'
import { DropdownMenu, Tooltip } from 'radix-ui'
import { Check, ChevronDown, ShieldQuestion, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PermissionMode } from '../../../../shared/models'

const modes = [
  { value: 'default' as const, label: '每次询问', icon: ShieldQuestion, description: '项目内读取和搜索直接执行；每次修改文件、执行终端命令或访问项目外内容前，都会询问你是否允许。' },
  { value: 'auto' as const, label: '受限自动', icon: ShieldCheck, description: '项目内文件和目录操作自动允许；终端命令在隔离环境中运行，限制项目外访问和联网。隔离失败时停止终端执行，可排查或切换完全访问。' },
  { value: 'full' as const, label: '完全访问', icon: ShieldAlert, description: '使用当前用户的本机权限访问文件、执行命令与联网，不再逐项请求批准。' }
]

export function PermissionModePicker({ mode, disabled, onChange }: { mode: PermissionMode; disabled?: boolean; onChange(mode: PermissionMode): Promise<void> }): React.JSX.Element {
  const [changing, setChanging] = useState(false)
  const selected = modes.find(item => item.value === mode) ?? modes[0]
  const Icon = selected.icon
  return <Tooltip.Provider delayDuration={300}><DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" className={`permission-mode-trigger permission-${mode}`} disabled={disabled || changing} aria-label={`权限模式：${selected.label}`} title={selected.description}>
      <Icon size={14} /><span>{changing ? '正在切换…' : selected.label}</span><ChevronDown size={12} />
    </Button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="permission-mode-menu" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="选择权限模式">
      <DropdownMenu.RadioGroup value={mode} onValueChange={value => {
        if (value === mode || changing || disabled) return
        setChanging(true)
        void onChange(value as PermissionMode).finally(() => setChanging(false))
      }}>
        {modes.map(item => { const ItemIcon = item.icon; return <Tooltip.Root key={item.value}>
          <Tooltip.Trigger asChild><DropdownMenu.RadioItem value={item.value} className={`permission-mode-option permission-${item.value}`}>
            <ItemIcon size={17} /><span>{item.label}</span><DropdownMenu.ItemIndicator><Check size={16} /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem></Tooltip.Trigger>
          <Tooltip.Portal><Tooltip.Content className="permission-mode-tooltip" side="right" sideOffset={10} collisionPadding={12}>{item.description}</Tooltip.Content></Tooltip.Portal>
        </Tooltip.Root> })}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root></Tooltip.Provider>
}
