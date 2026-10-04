# 模型设置与接入

更新日期：2026-10-04。当前已实现多配置管理、加密凭证、连接测试和多轮文本对话。回复在请求完成后一次性展示；流式输出、工具调用、自动文件修改和计划模式尚未接入。

## 使用步骤

1. 启动应用，点击左侧「设置 → 模型供应商」。
2. 选择「新建配置」，选择服务商。可创建多个同服务商配置，分别使用不同模型或 Endpoint。
3. 填写配置名称、API 根地址、准确的模型 ID。填写 API Key；本地无认证服务可以留空。
4. 可配置 Temperature、输出 Token 上限和超时。Temperature 留空时不传该参数；不保证所有模型支持相同参数和 Token 上限。
5. 点击「保存并测试连接」。应用保存配置后发送固定短消息，成功显示完整请求耗时（含推理时间）。这是实际推理请求，可能计费；支持取消，失败不代表配置没有保存。
6. 点击「保存并使用」，再「返回对话」。输入消息后发送，模型接收当前对话历史并返回文本。

测试不发送项目内容或聊天历史。聊天只发送本界面已成功完成的历史和当前输入，不自动附带文件。失败或取消保留输入；失败轮不加入后续上下文。任务对话和草稿目前只在内存中保存，任务切换、设置往返和修改模型配置会保留原对话。切换当前模型后，下一次发送会将本任务历史一起发送到新配置；输入区显示当前模型。打开项目会新建任务，旧任务仍可查看；重启后任务不保留。

## 服务商与协议

| 预设 | API 根地址 | 协议 | 默认 Token 参数 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | Chat Completions | `max_completion_tokens` |
| Claude | `https://api.anthropic.com/v1` | Messages | `max_tokens` |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI 兼容 | `max_tokens` |
| Ollama | `http://localhost:11434/v1` | OpenAI 兼容 | `max_tokens` |
| vLLM | `http://localhost:8000/v1` | OpenAI 兼容 | `max_tokens` |
| 自定义 | 用户填写 | 可选上述两种协议 | 可配置 |

预设只填地址和协议，不下载或启动本地模型，也不假设账户拥有哪些模型。模型 ID 必须与部署/服务端一致。Base URL 不包含 `/chat/completions` 或 `/messages`，应用自动附加对应路径。自定义网关可保留自己的根路径前缀。

远程 Endpoint 要求 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1`、`[::1]`，远程局域网 HTTP 暂不支持。URL 不允许内嵌凭证、查询参数或片段。请求不自动跟随重定向，避免携带凭证跳转到其他位置。当前使用主进程 Node fetch，没有应用内代理配置。

## 密钥与配置存储

配置保存在 `app.getPath('userData')/model-settings.json`，格式版本为 1，不进入项目影子快照。元数据包括名称、地址、模型、生成参数与活动配置；密钥使用 Electron safeStorage 加密后编码为 Base64，绝不是直接将明文 Base64 编码。

Renderer 输入的密钥只经专用 IPC 提交给主进程。保存后清空输入框，配置查询只返回 `hasApiKey`；无读取明文密钥接口。留空保留现有密钥，填写新值替换，勾选删除密钥并保存可移除凭证；删除整个配置也删除其存储密文。改变地址或协议时不允许静默沿用原密钥，必须重新输入或明确移除。

safeStorage 不可用时拒绝保存/解密密钥，无明文降级；Linux `basic_text` 后端被拒绝。无密钥的本地服务仍可用。Windows DPAPI 不防御同一用户身份下的其他应用；macOS 的 Keychain 行为需要实际签名与升级验收。

写入串行化，先写同目录临时文件再替换；损坏/未知格式停止读取，不自动覆盖。最多 20 个配置。配置读取、保存与请求失败均返回固定的可读错误；不记录密钥、请求正文或上游错误正文。服务端回显的已知密钥会被过滤。

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
