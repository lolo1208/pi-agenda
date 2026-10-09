import { Button } from '@/components/ui/button'

interface ModelProfileActionsProps {
  hasSavedProfile: boolean
  deletePending: boolean
  onSave: () => void
  onSaveAndTest: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  isLocal?: boolean
}

export function ModelProfileActions({ hasSavedProfile, deletePending, onSave, onSaveAndTest, onRequestDelete, onConfirmDelete, onCancelDelete, isLocal }: ModelProfileActionsProps): React.JSX.Element {
  return <>
    <div className="button-row">
      <Button className="primary" onClick={onSave}>保存配置</Button>
      <Button onClick={onSaveAndTest}>保存并测试连接</Button>
    </div>
    <p className="hint">{isLocal ? '测试将发送一条短消息，加载本地模型并占用计算资源，不携带聊天历史。' : '测试将发送一条固定短消息，可能产生服务端费用，不携带聊天历史。'}</p>
    {hasSavedProfile && <div className="button-row">
      {deletePending ? <>
        <span>删除此配置和密钥？</span>
        <Button onClick={onConfirmDelete}>确认删除</Button>
        <Button onClick={onCancelDelete}>保留</Button>
      </> : <Button onClick={onRequestDelete}>删除配置</Button>}
    </div>}
  </>
}
