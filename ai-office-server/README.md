# 私密 AI 办公室服务

这是 GitHub Pages 网站的独立服务端。必须部署为仅拥有者可访问的私密站点，不能匿名公开这些模型调用端点。网页端不保存模型 API Key，也不接收 GitHub PAT。

所有 `/api/` 请求必须具有 Sites 网关注入的 `oai-authenticated-user-id`，缺失时返回 401；任务记录按该 Site 内的用户 ID 授权，其他登录账号不能读取或继续任务。不要在公网边缘自行信任客户端伪造此头；必须经过 Sites 的认证网关。服务访问 bypass token 不等于用户身份，因此不用于代替用户发起模型工作。

## 运行与绑定

`worker.mjs` 默认导出 `{ fetch(request, env) }`，也导出 `createOfficeWorker(fetchImpl)` 供本地规则测试。它只处理 API 路由；部署方应将其与同源办公室前端打包。前端 `AiOffice` 组件在 `standalone=true` 时调用同源 API；GitHub Pages 上 `standalone=false`，通过 `privateOfficeUrl` 打开私密站点。

D1 绑定命名 `OFFICE_DB` 或 `DB`，部署时应用 `migrations/0001_office.sql`。不要在请求中临时建表。服务临时保留任务及勾选材料一小时，过期记录在后续任务开始时清理；未选择的个人笔记不发送、不存储。

模型连接配置另应用 `migrations/0002_provider_keys.sql`。私密页面的“连接模型”支持逐个提交 password 输入，或选择用户本机的 `.env` 文件；文件只解析三种明确的模型密钥名，预览仅显示检测到的服务，用户点击保存后才提交选中的值。整个文件、其他配置字段与未选中的模型密钥不会上传，保存完成后清空输入和文件选择，不写入 localStorage/sessionStorage。

`POST /api/providers/configure-intent` 创建绑定当前用户和所选模型的短期一次性确认票据；`POST /api/providers/configure` 接受明确提交的密钥并原子消费该票据。D1 `office_provider_keys` 只保存 AES-GCM 密文；加密密钥用 HKDF 从 `OFFICE_SESSION_SECRET` 按用户派生，AAD 绑定用户、模型和版本，密文不能移给其他用户或品牌。用户保存的连接优先于部署环境的同品牌配置。状态接口只返回是否配置，不返回密钥或前缀；保存不会隐式进行收费模型测试。

请保持 `OFFICE_SESSION_SECRET` 稳定。更换此主密钥后，旧连接密文和会话票据失效，需要由用户重新保存模型连接；不能仅替换主密钥后期待旧密文仍可读取。

服务端配置：

| 配置名 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 官方服务密钥 |
| `OPENAI_API_KEY` | OpenAI 官方服务密钥 |
| `GEMINI_API_KEY` | Gemini 官方服务密钥 |
| `OFFICE_SESSION_SECRET` | 至少 32 字符的随机会话签名密钥 |
| `OFFICE_DAILY_CALL_LIMIT` | 默认每天北京时间 30 次调用预留，可设 1–300；次数限制不是金额限额 |
| `DEEPSEEK_MODEL` | 默认 `deepseek-flash` |
| `OPENAI_MODEL` | 默认 `gpt-4.1-mini` |
| `GEMINI_MODEL` | 默认 `gemini-3.5-flash-lite` |

至少配置一个模型即可使用；只使用本次勾选且已配置的模型。服务不替未接入的品牌生成假回复，不在失败时切换供应商。实际账户是否有额度、可用地区、模型权限与费用，应在各服务商账户中核实。

## 协作协议

1. `GET /api/status` 只返回模型配置布尔值、模型名和调用次数上限，不返回密钥。
2. `GET /api/feed` 获取固定来源的公开信息快照，不向模型发送账号信息。
3. `POST /api/office/plan` 接受任务、可用成员、召集人、3/4/6 次预算、最多 40 条短材料，以及明确同意的文字/笔记片段。召集人进行一次真实模型调用，动态提出分工。
4. 前端展示可修改的任务分配。`POST /api/office/approve` 校验用户编辑后的分工，确认后才开始工作。
5. `POST /api/office/run` 一次只执行一个工作、审阅或汇总步骤。最多 3 个工作任务、1 次审阅、1 次汇总；加上拟定分工不超过所选上限。
6. `POST /api/office/resume` 恢复已有工作状态，不调用模型。`POST /api/office/cancel` 停止后续工作；已发送给模型的请求仍可能计费。

任务 ticket 使用 HMAC 签名，D1 原子预留阻止同一步重放和超出调用次数。接口拒绝跨站表单，客户端不自动重试模型请求。金额硬预算应另在供应商账户设置；每次最大输出 1500 tokens，输入材料、用户任务、笔记和前序回复均限长。

供应商请求失败时，界面和 `diagnostic` 仅返回固定分类、HTTP 状态及白名单内的错误码、类型和参数名。`insufficient_quota` 与 `rate_limit_exceeded` 分别处理；没有明确错误码的 429 保持“额度或限速未区分”，不会武断要求充值。认证、模型权限、地区限制、请求参数、服务异常与尚未收到 HTTP 响应的网络失败分别标识。服务端 `office_provider_error` 日志只含这组固定安全字段，不输出供应商原始 message、响应体、请求头、密钥或未知错误字段。

OpenAI 分工请求保留 `text.format.type=json_object`，并在实际 `input` 中明确要求返回 JSON 对象，不依赖仅在 instructions 中出现 JSON 字样；默认模型未因此变更。只有后续真实请求结果才能确认某次运行失败的具体原因。

引用仅支持用户本次选入材料的 `[来源:ID]`；服务拒绝将未知 ID 转成来源，界面只把本次真实材料映射为链接。不会访问模型生成的任意 URL、执行代码、发送外部消息、进行交易或承诺网页关闭后的盯盘。

## 连续聊天

`migrations/0003_chat.sql` 只新增聊天会话、消息与请求幂等表，不修改旧任务、模型密钥和日调用预算表。所有聊天 API 仍要求 Sites 登录身份与同源访问：

- `GET /api/chat/conversations`：当前账号最近 50 个会话的 ID、标题、固定模型、更新时间。
- `GET /api/chat/conversations/:id`：完整会话、ISO 时间、用户与助手消息、消息交付状态和持久引用。刷新读取不会调用模型。
- `POST /api/chat/send`：接受 `conversationId?`、`provider`、`message`、UUID `requestId`，以及显式选择的 `intent`、`materials`、`watchSymbols`。同一会话固定同一品牌，切品牌需要新会话，旧历史不会转发给新品牌。

每条消息只调用模型一次；历史按 DeepSeek messages、OpenAI Responses input、Gemini contents 的真实 user/assistant(model) 角色传入。只取最近 20 条、合计 24000 字以内的有效历史（包含附件元数据）；返回 `contextMessageCount` 表示最近一次提交给模型的消息数，`contextLimited` 表示上下文已裁剪。完整存档不会随上下文裁剪而删除，上限 200 条消息或 24 万字，接近上限时拒绝新发送、请用户新建会话；材料及可能重复的引用体积均纳入预留。

每轮请求由 D1 原子会话锁与 UUID 内容指纹保护。成功的重复请求只读结果；相同编号更改内容会被拒绝，失败的相同编号不会再次调用模型。失败返回已创建或已授权的 `conversationId`，用户消息标为 failed；新编号可以继续，失败尝试不会反复放进模型历史。120 秒租约过期后可恢复，但旧请求迟到时不能写入或清除新锁。所有轮次与旧协作任务共用北京时间每日次数上限，不自动重试。

对话保存 30 天，过期后在该账号访问聊天时清理。普通聊天没有自动新闻、自选或实时价格附件。仅当用户明确选择资料 ID 时，服务端从本站公开快照映射真实材料及原链接，不接受客户端任意 URL 作为引用；模型不读取这些链接。用户附件和助手合法引用持久保存，后续追问可以按实际送入的上下文继续引用。`market` 仅整理给定财经新闻和自选代码，不代表获得实时价格、K 线或后台持续盯盘能力。

## 验证命令

Node.js 24：`npm test`。测试使用内存 SQLite 与明确标识的模型响应样例，验证三家官方协议、真实流程状态、确认前不工作、同一步不重复调用、日次数上限、笔记选择、引用隔离及失败不泄露密钥；测试不产生 API 消费。

实际密钥接通后，需要在私密页面完成一项小任务，才能将在线模型协作标记为已验证。

## 核实的官方文档（2026-11-12）

- [DeepSeek 模型及当前名称](https://api-docs.deepseek.com/quick_start/pricing/)
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
- [Gemini 3.5 Flash-Lite](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite)
- [Gemini generateContent](https://aistudio.google.com/api-reference/generate-content)
