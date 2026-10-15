# OpenRouter 厂商国家映射核对

核对日期：2026-10-14。国家标识按模型厂商总部、官方运营主体或研发组织来源填写，不表示服务器或请求处理地区。目录来源为 [OpenRouter 模型接口](https://openrouter.ai/api/v1/models)。

新增和易混淆的厂商依据如下。地址与招聘地点仅作为组织来源的辅助证据，不用于推断数据路由。

| 厂商标识 | 国家 | 官方核对依据 |
| --- | --- | --- |
| `openrouter` | 美国 | [服务条款](https://openrouter.ai/terms)：OpenRouter, Inc. 的联系地址位于美国纽约。聚合及路由模型显示平台自身所属国家。 |
| `xiaomi` | 中国 | [小米官方介绍](https://www.mi.com/mea/about/index.html)：总部位于中国北京。 |
| `dots-studio` | 中国 | [Dots Studio 官网](https://studio.dots.ai/)：由小红书内部大模型团队发展而来，团队位于北京、上海等地。 |
| `nex-agi` | 中国 | [上海创智学院发布说明](https://www.sii.edu.cn/_s3/2026/0130/c27a671/page.psp)：由上海创智学院和合作团队联合开发。 |
| `aion-labs` | 波兰 | [Aion Labs 当前服务条款](https://www.aionlabs.ai/pl/terms/)：运营主体为波兰 Deep Forge sp. z o.o.，与以色列生物科技孵化机构 AION Labs 同名但并非同一组织。 |
| `sakana` | 日本 | [Sakana AI 官方介绍](https://sakana.ai/company-info-old/)：总部位于东京。 |
| `upstage` | 韩国 | [Upstage 官网](https://www.upstage.ai/)：公开首尔办公地址；按韩国创立的模型研发组织来源标识。 |
| `typesafe` | 美国 | [TypeSafe AI 服务条款](https://typesafe.ai/legal/terms)：TypeSafe AI, Inc. 的联系地址位于旧金山。 |
| `unbiased` | 美国 | [Unbiased 服务条款及隐私政策](https://unbiased.ai/terms/)：运营主体 Circuit & Chisel, Inc.，总部在美国。 |
| `relace` | 美国 | [Relace 隐私政策](https://relace.ai/legal/privacy-policy)：联系地址位于旧金山。 |
| `prism-ml` | 美国 | [PrismML 官方招聘页](https://prismml.com/careers)：团队位于 Pasadena、San Francisco。 |
| `perceptron` | 美国 | [Perceptron 官方介绍](https://www.perceptron.inc/about)：模型研发团队和岗位位于 Bellevue, WA；不与同名测量设备公司或法律服务公司混淆。 |
| `rekaai` | 美国 | [Reka 官方联系页](https://reka.ai/contact)：公司地址位于加州 Sunnyvale。 |
| `poolside` | 美国 | [Poolside 官方说明](https://www.poolside.ai/government)：明确自述为美国公司；其巴黎办公室不代表厂商所属国家为法国。 |
| `fireworks` | 美国 | [Fireworks 官方招聘页](https://fireworks.ai/careers)：团队位于 San Mateo 等美国城市。 |
| `inception` | 美国 | [Inception 官方公司动态](https://www.inceptionlabs.ai/blog/categories/company)：公司位于 Palo Alto。 |
| `thinkingmachines` | 美国 | [公司官方 LinkedIn](https://www.linkedin.com/company/thinkingmachinesai/)：总部位于旧金山。 |
| `arcee-ai` | 美国 | [Arcee 官方介绍](https://www.arcee.ai/about)：明确自述为美国模型实验室。 |
| `liquid` | 美国 | [Liquid AI 官方平台](https://platform.liquid.ai/)：公开 Cambridge, Massachusetts 地址。 |
| `mistralai` | 法国 | [Mistral 法律声明](https://mistral.ai/fr/legal/)：公司注册及办公地点位于法国巴黎。 |
| `cohere` | 加拿大 | [Cohere 官方介绍](https://cohere.com/about)：在加拿大 Toronto 创立。 |
| `ai21` | 以色列 | [AI21 隐私政策](https://www.ai21.com/terms-policies/privacy-policy/)：主体 AI21 Labs Ltd. 位于以色列 Tel Aviv。 |

别名在分组和国家查询前统一处理：移除开头的 `~`，忽略厂商标识大小写，`x-ai` → `xai`、`meta-llama` → `meta`、`ibm-granite` → `ibm`。模型 ID 保留原值。

尚无充分组织来源证据的厂商保留地球图标加 `?`。此次移除 `cognitivecomputations` 缺少来源依据的美国映射，避免将个人或社区成员所在地当作组织所属国家。
