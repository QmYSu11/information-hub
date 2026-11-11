# 小红书推荐帖子接入

核实日期：2026 年 11 月 11 日。当前为“适配代码已完成，等待用户的数据服务密钥”，不表示已经拿到实时推荐帖子。

## 采用的方案

首选 SandBase 的小红书首页推荐接口；如果只配置 TikHub 密钥，则使用 TikHub。两者都是第三方数据服务，不是小红书官方对本网站开放的个人推荐接口。返回的是服务提供的推荐快照，不等于你自己小红书账户的个性化首页。

| 服务 | 推荐接口 | 调用与鉴权 | 本次核实 |
| --- | --- | --- | --- |
| SandBase，首选 | POST https://api.sandbase.ai/v1/api/xiaohongshu/web-v3/homefeed | Authorization: Bearer 服务 API Key | 服务文档存在；不带密钥实测 HTTP 401，提示缺少 API Key |
| TikHub，备用 | GET https://api.tikhub.io/api/v1/xiaohongshu/web_v3/fetch_homefeed | 同上 | 官方服务文档存在；不带密钥实测 HTTP 401 |

调用参数为 num=20、category=homefeed_recommend、need_filter_image=false。SandBase 使用 JSON 请求体，TikHub 使用查询参数。最多取一页 20 条，不自动翻页、不隐式重试。

SandBase 产品页在核实时标注：同一组织每天前 100 次调用免费，UTC 00:00 重置，超过后标价 $0.01/次。该额度与组织内其他使用共享，实际免费资格与价格以注册后的账户页面和最新服务规则为准，不能据此承诺永久零费用。本项目默认最多每小时一次成功更新，正常计划约 24 次/天，降低额度消耗；仍建议账户关闭自动充值、设置费用上限，并自行留意共享额度。

本次没有注册任何账户、同意付费协议、创建充值或使用他人的密钥。

## 注册与取得密钥

1. 访问 [SandBase 官方推荐接口页](https://www.sandbase.ai/apis/xiaohongshu/web-v3/homefeed)，从其官方页面进入注册或控制台。
2. 按官方 [API Key 说明](https://www.sandbase.ai/docs/getting-started/api-keys)创建用于本网站的独立密钥。先确认当前账户有该推荐接口的免费额度；不要开启自动充值。
3. 在你的 GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret 添加 SANDBASE_API_KEY，将完整服务密钥放入 Secret 的值。
4. 在 Actions 中手动运行一次 Update information and publish Pages，或等待下一次计划发布。
5. 成功后，小红书区域会显示真实封面、标题、作者、赞数（来源有提供时）与获取时间；源状态才变为已连接。

密钥不要放到网站前端设置、VITE_ 环境变量、公开变量、源码或聊天中。只有任务执行环境会带 Bearer 请求头；公开快照不包含 API Key。

备用服务使用 TIKHUB_API_KEY，需自行确认其账户费用；两个密钥同时存在时，优先使用 SandBase。只需首选服务即可，不要求同时申请。

## 无密钥公开访问的实测

- https://www.xiaohongshu.com/explore 返回 HTTP 200，但 HTML 初始化状态中没有真实笔记卡片或笔记链接，只有待加载的信息流框架，不能据此生成推荐帖子。
- 旧的公开微信网页推荐路径 /fe_api/burdock/weixin/v2/homefeed/personalNotes 返回 HTTP 404。
- 通过通用网页读取工具访问官方探索页时，出现跳转到登录页的情况。
- SandBase 与 TikHub 的推荐接口无密钥均返回 HTTP 401；没有尝试绕过鉴权、复制私人 Cookie、逆向签名、伪造平台设备或规避访问限制。

因此，截至本次验证，没有找到已实测可用、无账户无密钥且适合本项目的推荐帖子接口。服务文档中的示例不是实时数据，未写入网站快照。

## 展示与数据规则

来源为 xiaohongshu-recommendations，类型为 recommendations。条目类型为 post，顺序保持服务返回的推荐顺序，不生成榜单排名或跨平台热度。

另以来源实际的笔记类型保留 mediaType=image 或 video，供界面的图文/视频筛选使用；这不代表本站能够直接播放该视频。

仅保留公开卡片元数据：

- 来源标题，必要时使用来源已有的短描述作标题；
- 作者昵称；
- 来源提供的封面；
- 公开笔记链接；
- 来源提供的赞数；
- 真实发布时间（仅在明确提供完整时间或时间戳时），以及本网站获取时间。

不推断笔记 ID 中的日期，不把抓取时间填成发布时间，不保存账号个人资料或任何原始响应中的用户令牌。原链接已有的公开分享参数可以保留；不从未知 token 字段合成访问签名。

封面只接受小红书/CDN 域名的 HTTPS 地址。平台封面可能有有效期；内容、图片、登录条件或可见范围变化时，用户仍可尝试原站入口。完整正文、评论、互动和受限视频不复制到网站。

## 状态与故障处理

- 未配置密钥：不发送请求，显示连接尚待配置；有历史数据则注明缓存。
- 成功获取：记录真实 lastSuccessAt、fetchedAt，展示推荐快照。
- 一小时内已有成功快照：沿用原获取时间，不多扣一次调用额度。
- 同一服务一小时内已有失败尝试：沿用原状态与 lastAttemptAt，不因为每半小时的发布任务或手动执行重复调用；一小时后可再试。首次填写密钥或切换服务可立即尝试。
- 401、402、403、429、超时或响应结构变化：保留最近成功的条目和时间，显示可理解的失败状态。
- 不将密钥、认证头、原始错误响应或私有记录写入公开 JSON、前端代码或日志。

## 测试范围

tests/xiaohongshu.test.ts 验证推荐卡片规范化、嵌套响应、去重、URL/封面校验、缺失时间、不生成排名、密钥隔离、小时缓存、401/402 回退和 TikHub GET 形式。规则测试使用明确标记的本地样例，不是实时推荐内容。

已实际连接的是未鉴权请求及官方页面，未持有服务密钥，因此尚未完成有权限的成功响应与连续更新验证。配置真实账户密钥后，还需根据实际返回再完成一次接入验收。

## 参考来源

- [SandBase 首页推荐产品与额度](https://www.sandbase.ai/apis/xiaohongshu/web-v3/homefeed)
- [SandBase 鉴权说明](https://www.sandbase.ai/docs/api-reference/authentication)
- [SandBase API Key 设置](https://www.sandbase.ai/docs/getting-started/api-keys)
- [TikHub 首页推荐文档](https://docs.tikhub.io/438852175e0)
- [小红书开放账户 API 文档](https://openaccount.xiaohongshu.com/docs/api-reference)：本次文档目录为账户授权、Token 与基础资料，没有将其冒称为公开首页推荐接口。
