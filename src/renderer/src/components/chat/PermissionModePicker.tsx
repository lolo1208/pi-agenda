import { useState } from 'react'
import { DropdownMenu, Tooltip } from 'radix-ui'
import { Check, ChevronDown, ShieldQuestion, ShieldCheck, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PermissionMode } from '../../../../shared/models'

const modes = [
  { value: 'default' as const, label: '默认权限', icon: ShieldQuestion, description: '项目内只读工具直接执行；写文件、终端命令和项目外访问需要逐次确认。' },
  { value: 'auto' as const, label: '自动审批', icon: ShieldCheck, description: '项目内文件和目录操作及系统沙箱中的终端命令自动执行；项目外访问、联网或沙箱不可用时需要确认。' },
  { value: 'full' as const, label: '完全访问', icon: ShieldAlert, description: '允许访问项目外文件和执行普通命令。高风险或无法确定安全的操作仍需确认。' }
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
