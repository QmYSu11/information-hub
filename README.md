# 信息书房

采用苹果式清透毛玻璃与原创二次元海边书房插画的个人信息桌面：新闻、热榜、推荐帖子、自选看盘、专注阅读、视频影院、本地笔记、提醒，以及独立的挂机肉鸽“信号远征”。

网站已首次发布：[打开信息书房](https://qmysu11.github.io/information-hub/) · [GitHub 源码](https://github.com/QmYSu11/information-hub)。本次看盘与小红书扩展已完成本地构建和规则检查，更新的发布验收见 [验证记录](docs/verification.md)。

## 先在电脑上看

交付包包含已经构建好的 dist。解压后双击 start-preview.cmd，会在本机启动并打开网站。电脑需要 Node.js 24；本次开发使用的电脑已安装。关闭预览窗口即可停止。

也可以在本目录打开终端，执行：

    node scripts/preview.mjs --open

个人资料保存在浏览器中。本机预览和 GitHub 网址属于不同站点，迁移时请先在“偏好设置 → 本地资料”导出备份，再到新网址导入。源码和发布包不含你的个人笔记。

## GitHub 发布与更新

当前仓库已配置 GitHub Pages。修改默认分支后会自动运行发布任务，也可在 [Actions](https://github.com/QmYSu11/information-hub/actions) 手动运行。以下步骤供迁移到新仓库时使用：

1. 在 GitHub 新建一个公开仓库，例如 information-hub。免费方案使用公开源码仓库。
2. 把本目录内的文件放在仓库根目录。根目录应直接看到 package.json、src、public、scripts，以及 .github/workflows/pages.yml；不要再套一层 information-hub 文件夹。请确认隐藏的 .github 文件夹也上传了。node_modules 和本机 artifacts 不需要上传。
3. 打开仓库 Settings → Pages，将 Build and deployment 的 Source 选择为 GitHub Actions。
4. 打开 Actions，选择“Update information and publish Pages”，点击 Run workflow。之后修改 main 或 master 分支会自动发布；工作流实际读取仓库默认分支的最新代码。
5. 首次成功后，Pages 页面会显示访问地址，通常是 https://你的用户名.github.io/仓库名/。工作流会自动匹配仓库子路径，无需修改源码。

仓库名为“用户名.github.io”时使用根路径。当前工作流按 GitHub 默认网址设计；如以后绑定自定义域名，应同时调整 BASE_PATH 为 / 并配置域名。

默认每小时第 7、37 分钟计划采集更新。GitHub 定时任务可能延迟；来源失败会保留最近成功内容。公开仓库长期没有活动时，GitHub 可能停用计划任务，可在 Actions 中重新启用。

如果部署失败，先查看 Actions 红色步骤。常见原因是没有启用 Pages 的 GitHub Actions 发布方式，或所在运行环境暂时无法连接所有来源。不要把服务私钥上传到仓库。

## 已经可以使用

- 今日信息桌面、新闻频道、来源筛选、关键词搜索、屏蔽来源和关键词。
- 国内、国际、科技、财经、社会内容，真实来源与发布时间。
- B 站综合排行榜，保留排名、UP 主、播放数和 BV 号。
- 自选标的添加、切换、删除和排序；中文名/代码搜索、交易所选择和自定义完整代码。
- 官方 K 线与价格曲线、可用的分钟/日/周/月周期、成交量、均线、画线和指标工具，以及行情摘要、技术指标、财务数据、公司资料。具体数据与周期受来源权限限制，A 股日终数据不提供盘中分钟线。
- 专注阅读、原文入口、B 站官方播放器影院、收藏、稍后读与阅读位置。
- 深浅主题、跟随系统、紧凑密度、阅读字号/宽度、减少动效，手机布局。
- 笔记自动保存、Markdown 安全预览、文件夹、标签、置顶、回收站、关联新闻。
- 单次、每日、每周、周一至周五提醒，延后、关联笔记、日历导出和遗漏汇总。
- 完整 JSON 备份预览、合并与恢复，笔记单篇 Markdown 导出。
- “信号远征”自动战斗、12 种强化、三条路线、三选一、Boss、永久成长、续档和最多 8 小时离线资源。
- GitHub Pages 自动构建、公开快照持久化、来源失败回退。

## 当前数据能力

首份真实快照包含 190 条内容，来自中新网 4 个频道、NPR 国际、IT之家和 B 站综合排行榜；更新时数量会随来源变化。

微博热搜在本次环境返回访问限制，保留清楚标记的原站入口。B 站的自动榜单已经接通。

小红书已完成推荐帖子页面与 SandBase 免费额度优先的采集适配，目前等待用户注册服务并配置密钥，尚未获得有权限的真实推荐流。页面会显示待连接状态，不填充示例帖子或伪造榜单。操作步骤见 [小红书接入说明](docs/xiaohongshu.md)：注册后把密钥保存为 GitHub Actions Secret `SANDBASE_API_KEY`，再运行发布任务。服务当前标注的免费额度与账户条件需在注册时确认；本站默认每小时最多尝试一次同一服务，不自动翻页或重试。

财经图表采用 TradingView 官方嵌入组件，按本站当前选中标的同步加载主图与研究面板。已实际验证 NVDA 的一分钟价格曲线、均线、成交量、数据延迟标记及行情摘要；AAPL 在此前版本也已验证。股票通常为延迟行情，分钟周期仅表示图形粒度，不承诺交易所级秒级实时。A 股样例格力电器的来源只支持日/周/月与日终数据，不能承诺所有 A 股盘中分钟。其他标的能否嵌入、字段、更新频率与延迟以组件内状态为准。使用说明见 [自选看盘](docs/market-desk.md)。

标普 500 参考采用指数跟踪 CFD，现货黄金为场外参考，WTI 为来源参考代码；连续期货单独注明，并非固定月份合约。默认不将未核实再分发许可的行情写入公开 JSON，腾讯报价采集为可选且默认关闭。

社会来源有时包含严肃新闻，不应把所有条目理解为轻松趣闻。国际内容保留来源语言；暂未加入机器翻译或 AI 摘要。

完整来源记录见 docs/sources.md。本站展示摘要，不保存新闻全文；完整报道、评论和平台互动在原站。

## 个人资料与提醒

笔记、提醒、收藏、自选和游戏进度保存于当前浏览器的 IndexedDB，暂不提供账户或多设备自动同步。更换浏览器、清理站点数据或更改域名之前，请导出备份。备份文件默认未加密。

资料修改会立即安排本机写入，界面显示保存状态。跨标签页笔记冲突保留副本；游戏存档在另一页面更新时，旧游戏页面暂停写入，等待你载入最新存档。

网页前台运行时支持到期提醒。系统通知需要你在设置中主动开启并允许；关闭网页后不保证准点提醒。需要更可靠的提醒时，导出 ICS 并导入常用日历，检查日历自身的通知设置。周一至周五规则不包含中国法定调休。

## 修改与开发

使用 Node.js 24，安装依赖后运行：

    npm install
    npm run dev

其他命令：

    npm run collect
    npm test
    node scripts/verify-snapshot-state.mjs
    npm run build
    npm run preview

collect 需要联网；单元测试使用本地样例，不会反复访问来源。快照保存恢复检查只操作自动创建的临时测试仓库，需要环境允许 Git 写入。Windows 若当前执行环境不允许构建工具读取路径，请在普通本机终端运行构建。

技术结构：React + TypeScript + Vite；原生 IndexedDB；独立的采集脚本和静态快照；游戏及财经组件延迟加载。package-lock.json 固定依赖版本。脚本内不使用私人登录 Cookie，也不需要 GitHub 账户密钥放入前端。

## 文件索引

| 文件 | 用途 |
| --- | --- |
| src/App.tsx、src/styles.css、src/glass.css | 主界面、新闻、热榜、阅读影院与玻璃主题 |
| public/art/sky-library.webp、docs/art-direction.md | 原创插画、界面视觉与素材说明 |
| src/features/Personal.tsx | 笔记、提醒、设置与备份 |
| src/lib/personal-store.ts | 本地持久化与跨标签页保护 |
| src/features/Game.tsx、src/lib/game-engine.ts | 游戏界面与独立模拟引擎 |
| src/features/MarketWidget.tsx、src/lib/market-model.ts | 自选管理、标的规范化与官方财经组件 |
| src/features/Recommendations.tsx、scripts/xiaohongshu.mjs | 推荐帖子页面与服务密钥采集适配 |
| scripts/collect.mjs | 真实来源采集 |
| scripts/snapshot-state.mjs | Actions 中保存和恢复公开快照 |
| .github/workflows/pages.yml | 自动采集、验证与 Pages 发布 |
| docs/sources.md | 数据来源实测及限制 |
| docs/market-desk.md、docs/xiaohongshu.md | 看盘使用与小红书免费优先接入步骤 |
| docs/verification.md | 本次构建、规则和浏览器验收记录 |

公开数据快照与网页构建会随发布任务更新；个人资料继续保存在浏览器中。
