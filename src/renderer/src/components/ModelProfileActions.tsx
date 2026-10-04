import { Button } from '@/components/ui/button'

interface ModelProfileActionsProps {
  hasSavedProfile: boolean
  deletePending: boolean
  onSave: () => void
  onSaveAndActivate: () => void
  onSaveAndTest: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}

export function ModelProfileActions({ hasSavedProfile, deletePending, onSave, onSaveAndActivate, onSaveAndTest, onRequestDelete, onConfirmDelete, onCancelDelete }: ModelProfileActionsProps): React.JSX.Element {
  return <>
    <div className="button-row">
      <Button className="primary" onClick={onSave}>保存配置</Button>
      <Button onClick={onSaveAndActivate}>保存并使用</Button>
      <Button onClick={onSaveAndTest}>保存并测试连接</Button>
    </div>
    <p className="hint">测试将发送一条固定短消息，会产生服务端推理请求及可能的费用；自携带聊天历史。</p>
    {hasSavedProfile && <div className="button-row">
      {deletePending ? <>
        <span>删除此配置和密钥？</span>
        <Button onClick={onConfirmDelete}>确认删除</Button>
        <Button onClick={onCancelDelete}>保留</Button>
      </> : <Button onClick={onRequestDelete}>删除配置</Button>}
    </div>}
  </>
}
