# 新增社区榜单

核实日期：2026 年 11 月 12 日（北京时间）。当前适配模块为 `scripts/social-trends.mjs`，公开来源 ID 为 `tieba-hot`、`zhihu-hot`、`twitter-trends`；平台分别为 `tieba`、`zhihu`、`twitter`。

## 贴吧：原站当前热议

原站公开端点：`GET https://tieba.baidu.com/hottopic/browse/topicList`。本次无登录、无密钥请求 HTTP 200，返回 `data.bang_topic.topic_list`，内容包含话题、原始序号、讨论数、短摘要与贴吧原链接。首个话题与 UAPI 缓存仍相同，但后续话题与顺序已经变化，不能把第三方缓存的旧顺序当作原站当前列表。

只保留原站公共话题元数据，不保存用户资料或完整帖子。来源未提供榜单更新时间，因此不从话题创建时间推断榜单时间，也不生成发布时间；获取时间明确由本站单独记录。

原站失败时仅尝试一次 UAPI 免费备用榜单。UAPI 的贴吧榜本次 HTTP 200、30 条，但其上游时间为北京时间 11 月 12 日 07:05，检查时已滞后约四小时。备用数据超过两小时不发布为新榜；有本站旧缓存则保留原条目及时间，无缓存则显示暂不可更新。正常原站路径不受该旧缓存影响。

## 知乎：免费聚合热榜

端点：`GET https://uapis.cn/api/v1/misc/hotboard?type=zhihu`。本次 HTTP 200、30 条，`update_time` 为 `2026-11-12T03:21:56.987Z`，对应北京时间 11:21。条目提供原序号、热度、知乎问题链接及部分短摘要。

[UAPI 官方文档](https://uapis.cn/docs/api-reference/get-misc-hotboard)声明当前热榜无需注册或 API Key。本站仅用当前列表模式，不使用收费历史检索参数；明确标注第三方聚合，不冒称知乎官方接口。必须带有效且不超过两小时的上游时间；失败保持旧缓存和时间。

仅接受 `zhihu.com/question/...` 的问题或答案链接。上游部分图片字段为相对路径，未确认其公共媒体根地址，因此不把这些路径拼造成封面 URL。

## X / Twitter：美国地区趋势

采用现有 SandBase 数据服务：`POST https://api.sandbase.ai/v1/api/twitter/web/trending`，请求体为 `{"country":"UnitedStates"}`。服务密钥继续由 GitHub Actions Secret `SANDBASE_API_KEY` 提供，不需要新增 X OAuth 或开发者账户。

依据[SandBase 参数文档](https://www.sandbase.ai/model/twitter/web/trending/docs)和[产品页](https://www.sandbase.ai/apis/twitter/web/trending)，默认地区是美国；文档列出的地区是具体国家，未将其当作全球榜。可选 GitHub 仓库变量 `TWITTER_TRENDS_COUNTRY` 改为已支持的 `Japan`、`UnitedKingdom`、`India`、`China`、`SouthKorea`、`Germany`、`France`、`Canada`、`Australia` 或 `Brazil`。界面来源名称与消息都注明地区；切换地区不会沿用另一地区的榜单缓存。

成功结果位于 `outputs[0].data.trends[]`，条目只有 `name`、`context`、可选 `description`。**服务不提供官方排名、推文量或榜单更新时间**，所以本站按服务原顺序展示，不写入虚构的 `rank`、`heat` 或 `publishedAt`。前往原站时使用对应词语的 X 搜索链接。顺序编号仅供浏览，不代表官方位次。分类说明和描述来自服务，不是 AI 生成。

X 成功和失败尝试都最多每小时一次，不隐式重试或翻页。SandBase 当前标注同一组织每日前 100 次数据 API 调用共享免费额度；正常 X 与小红书各每小时一次，合计约 48 次/天，仍与组织其他用途共用额度，服务规则与账户设置为准。不创建充值或自动付费订阅。

本次已经核实该产品和响应文档，未在此子任务取得服务密钥，因而不把文档样例当作实时趋势。最终连接状态必须以带权限的实际采集及发布后快照检查为准；无密钥时保留明确的待连接/原站入口。

也检查了 Trends24 公开网页，能读取全球趋势，但其[使用条款](https://trends24.in/terms)明确限制抓取、缓存及转发，故没有将其接入采集或发布，研究临时 HTML 已删除。

## 故障与验证

- 所有来源独立请求，一个来源失败不抹去其他来源。
- 原排名与公开元数据不重新编造；非法链接、未知主机、账号凭证及脚本内容不进入快照。
- API Key 仅在服务请求头中使用，失败消息不包含认证头或原始服务错误。
- `tests/social-trends.test.ts` 覆盖贴吧原站字段、HTML 实体链接、知乎聚合与上游时间、X 地区/密钥隔离/小时缓存、不生成推文量和排名，以及跨来源失败隔离。测试数据为本地样例，不是实时新闻。
