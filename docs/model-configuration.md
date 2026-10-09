# 模型设置与接入

更新日期：2026-10-09。当前已实现多配置管理、加密凭证、连接测试和多轮文字/图片对话。回复在请求完成后一次性展示；流式输出、工具调用、自动文件修改和计划模式尚未接入。

输入框从单行开始，随内容自动增高，最多显示 8 行，超出后在框内滚动；不支持手动拖动高度。点击「添加图片」、粘贴图片或拖入图片文件，即可在文字上方添加缩略图。悬停或键盘聚焦缩略图可显示删除按钮，点击图片可预览大图；按 Escape、点击关闭按钮或预览外侧即可关闭。

支持 PNG、JPEG 和 WebP，每条消息最多 8 张，每张不超过 5 MiB；对话图片总量上限为 32 MiB。图片可单独发送，也可与文字一起发送；失败或取消后保留草稿，成功后显示在对话记录中。对话及附件仅在本次打开期间保留。图片识别需要选择支持视觉输入的模型；图片会随消息提交给所配置的服务。

## 使用步骤

1. 启动应用，点击「设置 → 模型供应商」。左侧显示已配置供应商，右侧显示该供应商的模型。
2. 点击「添加供应商 → Ollama」，填写本机服务地址（默认 `http://localhost:11434`），点击「连接并获取模型」。应用读取 Ollama 已安装的模型，不会自动下载或运行模型。
3. 若列表为空，请先使用 `ollama pull <模型名称>` 下载模型，再点击「刷新模型」。刷新保留已有模型的独立参数；已从服务移除的模型标记为本地未找到，不能用于对话。
4. 每个模型右侧提供高级设置按钮与启用开关。点击高级设置，可独立保存上下文上限、输出 Token 上限、Temperature、超时，以及支持时的推理模式。右侧能力、参数规模、量化和最大上下文来自 Ollama；缺失信息显示为未提供。
5. 上下文单位为 tokens，包含输入和输出。留空使用服务默认值；Ollama 请求实际发送 `options.num_ctx`，输出上限发送 `options.num_predict`。上下文不能超过服务已提供的模型规格，输出上限不能超过设置的上下文。
6. 「保存并测试连接」会加载本地模型并发送固定短消息，可取消，不携带聊天历史。点击「保存并使用」或列表中的「使用模型」，选择后续对话使用的模型。
7. 停用当前模型时自动选择其他已启用且可用的模型；没有可用模型时停止选择。删除配置只删除应用内参数，不会删除 Ollama 中的模型，刷新后可再次发现。

新增供应商目前只提供 OpenAI 订阅与本地 Ollama。OpenAI 订阅登录尚未接入；已有其他供应商 API 配置可继续管理。通用模型参数结构也适用于未来供应商，各模型独立保存；目前上下文参数实际下发仅实现于 Ollama。

测试不发送项目内容或聊天历史。聊天发送已完成的历史与当前输入，不自动附带文件。失败或取消保留输入；失败轮不加入后续上下文。任务对话和草稿目前只在内存中保存。切换当前模型后，下一次发送会将本任务历史一起发送到新配置。

## 服务商与协议

| 预设 | API 根地址 | 协议 | 默认 Token 参数 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | Chat Completions | `max_completion_tokens` |
| Claude | `https://api.anthropic.com/v1` | Messages | `max_tokens` |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI 兼容 | `max_tokens` |
| Ollama | `http://localhost:11434` | 原生 `/api/chat` | `options.num_predict` |
| vLLM | `http://localhost:8000/v1` | OpenAI 兼容 | `max_tokens` |
| 自定义 | 用户填写 | 可选上述两种协议 | 可配置 |

预设只填地址和协议，不下载或启动本地模型，也不假设账户拥有哪些模型。模型 ID 必须与部署/服务端一致。Base URL 不包含 `/chat/completions` 或 `/messages`，应用自动附加对应路径。自定义网关可保留自己的根路径前缀。

远程 Endpoint 要求 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1`、`[::1]`，远程局域网 HTTP 暂不支持。URL 不允许内嵌凭证、查询参数或片段。请求不自动跟随重定向，避免携带凭证跳转到其他位置。当前使用主进程 Node fetch，没有应用内代理配置。

## 密钥与配置存储

配置保存在 `app.getPath('userData')/model-settings.json`，格式版本为 1，不进入项目影子快照。元数据包括供应商连接、发现的模型规格、名称、地址、模型、独立的上下文和生成参数、启用状态与活动配置；密钥使用 Electron safeStorage 加密后编码为 Base64，绝不是直接将明文 Base64 编码。

Renderer 输入的密钥只经专用 IPC 提交给主进程。保存后清空输入框，配置查询只返回 `hasApiKey`；无读取明文密钥接口。留空保留现有密钥，填写新值替换，勾选删除密钥并保存可移除凭证；删除整个配置也删除其存储密文。改变地址或协议时不允许静默沿用原密钥，必须重新输入或明确移除。

safeStorage 不可用时拒绝保存/解密密钥，无明文降级；Linux `basic_text` 后端被拒绝。无密钥的本地服务仍可用。Windows DPAPI 不防御同一用户身份下的其他应用；macOS 的 Keychain 行为需要实际签名与升级验收。

写入串行化，先写同目录临时文件再替换；损坏/未知格式停止读取，不自动覆盖。最多 200 个配置。配置读取、保存与请求失败均返回固定的可读错误；不记录密钥、请求正文或上游错误正文。服务端回显的已知密钥会被过滤。

## 请求边界与排错

- 超时 5–300 秒；包含网络和响应体读取。用户可取消，关闭窗口/导航离开/Renderer 崩溃会中断请求；一次只运行一个模型请求。
- 每次最多 100 条消息，单条 32,000 字符，总计 128,000 字符；响应读取最多 2 MiB。超出时新建任务或降低输出上限。
- HTTP 400：检查参数支持；可清空 Temperature 或切换 Token 参数。HTTP 401/403：检查密钥和授权。HTTP 404：检查根地址/模型。HTTP 429：检查额度或频率。
- 网络失败：检查服务是否启动、地址是否正确、网络/TLS/代理；不关闭证书校验。
- 无文本或达到输出上限：检查模型是否支持文本对话、调整 Token 上限。当前只读取最终文本，不执行模型返回的工具调用，也不展示内部推理块。
- 配置损坏：备份应用数据目录，检查 `model-settings.json`；不要把含凭证的原始文件公开发到日志或问题追踪系统。

## 验证范围

自动测试使用注入的测试加密器、模拟协议响应、真实本地 HTTP 服务和 jsdom 表单交互。它验证序列化、密钥不回传、请求格式、错误脱敏、取消/超时与交互状态；不等同于真实 DPAPI/Keychain、云账户权限、Ollama/vLLM 实机部署或 Electron 桌面端到端验收。

参考：[OpenAI 官方 Chat Completions 文档](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions/methods/create)、[Claude Messages](https://platform.claude.com/docs/en/api/messages/create)、[DeepSeek API](https://api-docs.deepseek.com/)、[Ollama OpenAI 兼容接口](https://docs.ollama.com/api/openai-compatibility)、[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。
