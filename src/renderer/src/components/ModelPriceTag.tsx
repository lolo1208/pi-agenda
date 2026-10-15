import { Tooltip } from 'radix-ui'
import { BadgeDollarSign } from 'lucide-react'
import type { ModelDescriptor } from '../../../shared/models'
import { modelPriceTier, parseModelPricing } from '../../../shared/model-pricing'

const tierLabels = ['零调用费', '很便宜', '便宜', '适中', '较贵', '昂贵']
const formatPrice = (value: number): string => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`

function PriceDetails({ descriptor }: { descriptor?: ModelDescriptor }): React.JSX.Element {
  const pricing = parseModelPricing(descriptor?.pricing)
  const tier = modelPriceTier(pricing)
  if (!pricing || tier === null) return <>
    <strong className="model-price-tooltip-heading">价格未知</strong>
    <p className="model-price-tooltip-note">暂无可准确匹配的单价，暂不评级。</p>
  </>
  const local = pricing.kind === 'local'
  const reference = pricing.kind === 'api-reference'
  const source = local ? 'Ollama 本地' : reference ? 'OpenAI 官方' : pricing.kind === 'cloud' ? 'Ollama 官方' : 'OpenRouter 目录'
  return <>
    <div className="model-price-tooltip-heading"><strong>{local ? '本地运行' : reference ? 'API 参考价' : '模型单价'}</strong><span>{tierLabels[tier]}</span></div>
    {local ? <p className="model-price-tooltip-note">零平台调用费，不含硬件和电费。</p> : <>
      <div className="model-price-tooltip-unit">美元 / 百万 Token</div>
      <dl className="model-price-tooltip-rates">
        <div><dt>输入</dt><dd>{formatPrice(pricing.input)}</dd></div>
        <div><dt>输出</dt><dd>{formatPrice(pricing.output)}</dd></div>
      </dl>
      <div className="model-price-tooltip-rating"><span>价格等级 <b>{tier} / 5</b></span><span>参考成本 {formatPrice(pricing.input * 0.75 + pricing.output * 0.25)}</span></div>
      <p className="model-price-tooltip-note">按输入 / 输出 3:1 评级，不含缓存折扣和附加费用。</p>
      {reference && <p className="model-price-tooltip-note">标准模式、短上下文参考价，不代表订阅实际费用。</p>}
      {pricing.kind === 'cloud' && <p className="model-price-tooltip-note">采用常规时段单价。</p>}
    </>}
    <div className="model-price-tooltip-footer"><span>{source}</span><time dateTime={pricing.checkedAt}>{pricing.checkedAt.slice(0, 10)}</time></div>
  </>
}

export function ModelPriceTag({ descriptor }: { descriptor?: ModelDescriptor }): React.JSX.Element {
  const tier = modelPriceTier(descriptor?.pricing)
  return <Tooltip.Provider delayDuration={250}><Tooltip.Root>
    <Tooltip.Trigger asChild><span className="model-price-tag" role="img" title="" aria-label={tier === null ? '价格未知' : `价格等级 ${tier}${tier ? '，共 5 档' : '，零平台调用费'}`}><BadgeDollarSign size={13} aria-hidden="true" /><span>{tier === null ? '?' : tier}</span></span></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="model-price-tooltip" side="top" sideOffset={8} collisionPadding={12}>
      <PriceDetails descriptor={descriptor} />
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>
}
