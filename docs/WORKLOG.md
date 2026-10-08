# 工程记录 · WORKLOG

赛事跟踪台从一句需求做到可运行、可发布、可交接的完整过程记录。
按时间倒序读没有意义,这里按**阶段**组织,每一段写清:要解决什么、做了什么决策、踩了什么坑、怎么验证的。

> 最后更新:2026-10-08

---

## 0. 一句话

**不做代报名,只做指挥中心。** 盯住每场赛事的报名开放 / 截止 / 抽签公布 / 缴费截止,
在真正需要人行动的那一刻推一条提醒。收录 24 场马拉松 / 路跑 + 36 场全球越野赛 = 60 场。

---

## 1. 时间线总览

| 时间 | 阶段 | 产出 |
|---|---|---|
| 10-06 晚 | 赛历整理 | `legacy/marathon_calendar_2026.html`(162 场全球路跑赛历) |
| 10-07 上午 | 从「一键报名」转向「指挥中心」 | `legacy/marathon_registrar.html`(单文件版,9 态状态机) |
| 10-07 上午 | 邮件链路打通 | `tools/digest.js` + `tools/notify.js` + 每日 09:00 自动化 |
| 10-07 下午 | 邮件订阅身份问题排查 | 授权、改名、两个地址的根因 |
| 10-07 下午 | 平台化(多用户网站) | `marathon-platform/`,发布上线 |
| 10-07 16:20 | **接入全球越野赛** | 引擎扩到 60 场,新增 `opendeadline` 态 |
| 10-07 16:30 | **分类显示** | 赛事库分区 / 我的关注筛选 / 看板速览 |
| 10-07 16:45 | **开源到 GitHub** | `github.com/xinster/marathonforall` |
| 10-07 17:00 | **仓库结构整理 + 文档** | `tests/` `docs/` `legacy/`,数据模板化 |
| 10-07 17:25 | **交接可独立性审计** | `LICENSE` + 自检脚本 + `MAIL_SETUP`/`OPERATIONS`,修掉 6 个移交阻断项 |
| 10-08 13:20 | **UI 动感改版** | 全站换成「跑道 / 田径」风,新增 `assets/motion.js`,样式表整体重写 |
| 10-08 15:10 | **P1 云端同步** | 真实云账号(手机/邮箱 OTP)+ 单表 `user_state` + RLS;换设备同步关注/勾选/设置,证件类字段仍留本机 |

---

## 2. 阶段一:赛历整理(10-06)

**需求:** 罗列全球到今年底的马拉松比赛的名字和地点。

**产出:** 162 场自包含单文件赛历,分十月 / 十一月 / 十二月三张表,带地区筛选。

**留下的关键事实锚点**(后续所有工作复用):

- 2026 赛季剩余两场世界马拉松大满贯:芝加哥(10/11)、纽约(11/01)
- 中国 10 月「超级周日」:10/18(北京、西安、东营、郑州、烟台、丽江、嘉兴)、10/25(成都、长沙、宝鸡、怀柔长城)
- 12/06 全球同日大战:上海、瓦伦西亚、加州国际、圣安东尼奥、新加坡
- 12/20 广州马拉松(3 万人)、12/27 福州 / 海口

> ⚠️ 这份文件里的日期是**整理时的检索结果**,不是活数据。它已归档到 `legacy/`,不要再当数据源用。

---

## 3. 阶段二:从「一键报名」转向「指挥中心」(10-07 上午)

### 用户原始需求

> 开发一个马拉松赛事的一键报名系统?管理好一个人的 profile,了解他想要报名的赛事,
> 监控相应赛事的报名放开情况,一旦可以报名,就自动帮助报名提交。

### 关键决策:不做代报名

逐条论证后判定「自动提交」在技术与合规上都不成立:

| 障碍 | 说明 |
|---|---|
| 实名核验 | 报名要姓名 + 身份证号 + 手机号,且多数赛事要做人脸或证件核验 |
| 验证码与风控 | 报名站点普遍有人机校验,自动化提交会触发风控甚至封号 |
| **抽签制下抢时间无意义** | 顶级赛事都是抽签,**报名先后完全不影响中签率** —— 抢跑不产生任何收益 |
| 合规 | 代人提交实名信息涉及个人信息处理授权问题 |

### 真正的痛点

不是「没抢到报名」,而是 **中签后忘记缴费**。中签名额的缴费期通常只有 3–7 天,
逾期**立即释放且不可恢复**。绝大多数流掉的名额死于这条死线。

**结论:改做「指挥中心」** —— 替用户盯窗口,把该做的那件事在最该做的时间点推到他面前。

这个决策重塑了整个产品的形态:核心从「提交表单」变成「状态机 + 提醒」,
也直接决定了后来「状态判断只能写一遍」这条架构不变量。

### 产出

`marathon_registrar.html` —— 单文件指挥中心,含 9 态状态机 + 个人档案 + 材料清单 + ICS 导出。

---

## 4. 阶段三:邮件链路(10-07 上午)

**目标:** 每天 09:00 自动巡检,有紧急事项就发一封中文摘要邮件。

**链路:** `tools/digest.js` 算状态 → 生成 Markdown / HTML 邮件 / 紧急清单 JSON
→ `tools/notify.js` 判断有无紧急项 → 经 Agent Mail CLI 投递。

### 发现并修复的真实缺陷

**「抽签结果公布」的警报被埋掉了。** 结果公布后,赛事状态会走完窗口变成「已截止」,
系统于是显示「已截止」—— 而此刻恰恰是最关键的时刻:用户中签了、缴费期只有 3–7 天。
原来的状态机把最要命的警报藏在了最平静的标签后面。

修法:新增 `drawdone`「结果已公布·待确认」态,明确提示去官网查结果并催缴费。

### 邮件订阅身份的坑(耗时最长的一段)

排查了三个层次,结论逐层加深:

1. CLI **不能**改名,只能走管理端网页
2. 改名后发现「一个微信登录绑定的地址」与「一个手机号短信绑定的地址」并存
3. **根因:两个地址挂在两个独立的登录身份下**,平台**没有**跨身份合并能力 → 两个地址合不到一起

**教训:** 这类「看起来是配置问题、实际是身份模型问题」的坑,先查官方 FAQ 确认能力边界,
不要在配置层反复试。

---

## 5. 阶段四:平台化(10-07 下午)

**需求:** 做成网站 + 微信小程序,人们用微信号登录,各自订阅跟踪自己的赛事。

**决策:先做网站,小程序暂缓**(需要 AppID 与资质)。

### 架构不变量:状态判断只写一遍

`marathon-platform/assets/engine.js` 是**唯一一份**状态判断逻辑与赛事目录,被
网站、`tools/digest.js`、`tools/notify.js`(以及将来的小程序)共用。

**为什么这是硬约束:** 状态判断写两遍**必然漂移**,会出现「网页说待缴费、提醒邮件说已截止」
这种最要命的错误。共用一份文件,从结构上就不可能漂移。

配套的数据分工:

- 赛事**事实字段**(报名窗口 / 抽签日 / 缴费截止 / 比赛日 / 官网 / 组别距离)→ 取自引擎 `SEED_ALL`
- `data/marathon_watchlist.json` → **只承载「我的进度」**(`userStatus`)与个人档案
- 赛历更新只改引擎,网页与邮件自动跟随

`assets/store.js` 里 `read()` / `write()` 打了 `[SEAM]` 标记 —— 将来接后端只有这一个改动点。

### 硬约束结论(后续复用)

网站是**纯静态、零构建**的,浏览器端用 `localStorage` 存个人数据。所以:

- 网站与小程序是**两个独立应用 → 两个独立云环境,数据默认不共享**
- 要真正做小程序,得在「代码开发」里选「小程序」应用类型**重新构建** ——
  小程序是另一套代码(WXML/WXSS/JS + `app.json`),**不能**从 HTML/DOM 转换或重组

### 发布

`https://marathon-tracker.app.workbuddy.host/`

---

## 6. 阶段五:接入全球越野赛(10-07 16:20)

**需求:** 「也加上全球的越野赛」。

### 收录规模

24 场路跑 + **36 场越野赛** = 60 场。越野覆盖:

- UTMB 总决赛与世界系列赛(11)
- 世界越野大满贯 WTM(9)
- 经典超长越野(10):西部州 100、硬石 100、Tor des Géants、Barkley、Leadville、Badwater…
- 世界山地与越野跑锦标赛(1)

地区:欧洲 10 / 北美 9 / 中国 7 / 亚洲 5 / 大洋洲 2 / 非洲 2 / 南美 1。

### 越野与路跑在三处本质不同(已落到引擎分支)

| 维度 | 马拉松 / 路跑 | 越野赛 |
|---|---|---|
| **赛制** | 抽签 / 先到先得 / 成绩达标 | ITRA 表现分门槛 / **跑石 + UTMB 指数双门槛** / 资格赛制 / 黄金门票 |
| **资格** | 24 个月内的全马或半马成绩 | **同类距离的山地完赛记录**(路跑成绩通常不被接受) |
| **材料** | 体检报告、完赛证明 | 追加强制装备、夜间行进、换装包 |

**已核实的真实门槛**(不是编的):

- 柴古唐斯括苍:105K ≥ 410 / 50K ≥ 360 / 25K ≥ 260 分
- 熊猫蜀道山:160K ≥ 500 / 105K ≥ 400 / 60K ≥ 350 / 25K ≥ 249 分
- 崇礼 168:不设 ITRA 分,按距离阶梯要完赛证书

### 新增第 15 个状态:`opendeadline`「报名中·未设截止日」

这是**修掉一个真实缺陷**,不是加功能:

> 越野赛和国内先到先得赛事极常见 —— 公告了开放日,却**永不公布截止日**,名额售罄即止。
> 旧逻辑要求开放日与截止日**同时存在**才判「报名中」,于是这类赛事全掉进「窗口待公布」,
> **把正在开放的窗口写成了还没开放**。60 场里有 4 场命中。

### 顺带修掉的第二个缺陷:邮件永远无法安静

上述状态长期挂着(某场已开放数月)。若把它计入「紧急」,每天都会为同一场赛事报警,
反而**把真正的截止日淹没**。

修法:把「紧急」重新定义为**有明确时间窗**的四类 —— `待缴费` / `结果待确认` / `即将截止` / `即将开放`。
未设截止日仍照常出现在摘要小节、邮件正文与窗口概览里,**只是不单独触发发信**。

采样未来 26 个时间点验证:19 天为「无紧急事项」→ 该分支真正可达。

### 结构性防漂移:巡检脚本收口到唯一引擎

`tools/digest.js` 原先**还在从旧的 `marathon_registrar.html` 里抽取 JS** ——
这意味着越野赛对每日邮件**完全不可见**,而且随时可能悄悄分叉。
现在直接 `require` 引擎,事实字段全部取自引擎。

### 验证

- 运行时回归 82 项断言全绿(Node DOM 存根,跑真实断言)
- **防漂移复测:路跑 1152 组对照零真实漂移**,仅 2 组差异全部来自新增的 `opendeadline`(即修正旧误判)
- 原 24 场 id 与顺序完全一致

---

## 7. 阶段六:分类显示(10-07 16:30)

**需求:** 「马拉松和越野要分类显示」。

### 做法:分类不是筛选器,而是贯穿全站的呈现方式

| 位置 | 改动 |
|---|---|
| **赛事库** | 顶部类型切换条(全部 60 / 路跑 24 / 越野 36)。选「全部」时列表**真的分成两个区块**,每区带图标、场次数与**一句话说明差异** |
| **我的关注** | 同一套切换条可按类筛选;分组标题在两类混合时多标一行两类占比 |
| **看板** | 新增类别速览:两类各关注几场、其中几场正在窗口里 |
| **提醒预览 / 时间线** | 每条加类型标签与色点 |
| **每日邮件** | 每行 `[越]` 前缀 + 「路跑 X 场 / 越野赛 Y 场」分类统计 |

分区表头**不只写标题,还写清差异** —— 这是分类真正的价值所在。

### 取舍

1. **删掉原来那个类型下拉框**,换成切换条 —— 下拉是「筛选」,切换条是「分类」
2. **分类判定只走引擎的 `kindOf()`**,界面一行硬编码都没有。以后要加 Skyrunning、
   山径徒步,只需在引擎里加一个 `kind`,界面自动多出一个分区
3. 类型按钮走**既有的全局点击代理**(`data-act="kindfilter"` / `"minekind"`),没新增事件绑定 ——
   这样 DOM 存根回归测试能直接覆盖到点击路径

### 顺带修掉的第三个缺陷:「我的关注」会漏赛事

分组没覆盖 `未开放` / `窗口未记录` / `已报名待结果` 三态,用户明明关注了却看不到,
得回赛事库再搜一次。越野赛大量处于「窗口未公布」,这个漏洞会被放大。已补分组。

---

## 8. 阶段七:开源到 GitHub(10-07 16:45)

**需求:** 「推到github上去」。

### 环境探测结论(重要,省得重复排查)

- 本机**没有任何可用的 GitHub 凭据**:`gh` CLI 不存在、`~/.gitconfig` 不存在、
  钥匙串无 github.com 记录、环境变量无 token
- **网络是通的**:`git ls-remote` 拉公开仓库成功、`api.github.com` 200
- GitHub connector 虽显示已连接,但本会话**没有暴露任何可用工具**;
  其授权头是运行时注入的密文 —— **不去解密挪用,那超出授权边界**

→ 结论:**推送这一步必须由用户提供凭据。**

### 凭据处理方式

- token 只经 `/tmp/gh_token`(`chmod 600`)读取,**未写入任何仓库文件**
- 推送时临时把 token 拼进 remote URL,脚本 `trap` + 显式还原双保险;
  推完核对 `.git/config` 中 remote 是干净的 HTTPS 地址
- 用完 `shred -u` 抹除 token 文件

### 结果

`https://github.com/xinster/marathonforall`(公开),首次提交 `5959659`,
线上 commit 与本地 HEAD **sha 完全一致**(逐字节同一次提交)。

### 坑:代理隧道 502

首次 `git push` 报 `CONNECT tunnel failed, response 502`。
但**同一时刻** `git ls-remote` 成功、`curl api.github.com` 返回 200 ——
说明既不是凭据问题也不是网络不通,只是沙箱出网代理的 CONNECT 隧道**偶发失败**。

**原样重试一次即成功。** 以后遇到这个错误直接重试,不要去查 token、重配 proxy 或用 REST 兜底。

---

## 9. 阶段八:仓库结构整理 + 文档(10-07 17:00)

**需求:** 记录过程到 worklog + 形成交接文档 + 同步到仓库 + 检查目录结构是否最优。

### 体检发现的 5 个问题

| # | 问题 | 判定 |
|---|---|---|
| 1 | **82 项回归测试躺在 `/tmp`,随时会丢** —— 仓库里一条测试都没有 | 最严重 |
| 2 | 两个历史 HTML 共 121KB 堆在根目录,占仓库 35%,与产品混杂 | 结构问题 |
| 3 | 无 `docs/`,worklog 与交接文档无处安放 | 结构问题 |
| 4 | **跟踪的是「活」的 `data/marathon_watchlist.json`** —— 一旦填入身份证 / 手机号,下次 `git push` 即公开泄漏 | 安全隐患 |
| 5 | 无 `LICENSE`(公开仓库) | 开放问题 |

### 关于第 2 条的一个反转

原以为 `marathon_registrar.html` 是纯历史垃圾,准备删。查引用时发现:
**它是防漂移回归测试的对照基线** —— `tests/regression.js` 从它里面抽取旧版状态机,
用来证明「路跑 24 场的状态判断没被改坏」。

所以它不是死文件,是**测试夹具**。最终两者都进 `legacy/`,并在 `legacy/README.md` 里
写清「哪个纯粹是历史,哪个被测试依赖、不可删」。

同时发现该夹具的脆弱点:靠**行号切片**(`sl(10,33)`、`sl(59,243)`)抽取,
一旦有人重排这个 HTML 的格式,切片会错位,测试会拿一堆坏数据去比对,
**得出「零漂移」的假结论**。已加一条守卫断言:切片必须抽出 24 场且 `computeStatus` 可用,
否则直接以退出码 3 终止。

### 关于第 4 条的修法

把「活文件」与「入库模板」拆开:

- 入库 `data/marathon_watchlist.example.json`(不含任何个人数据,34 字段全为空)
- `.gitignore` 排除 `data/marathon_watchlist.json`
- `git rm --cached` 把活文件移出索引但**保留本地文件**
- `tools/digest.js` 三级回退:活文件 → 模板(带告警)→ 都没有则明确指引并退出码 4

这样新克隆开箱能跑,而个人数据**在结构上不可能被提交**。

### 最终结构

```
.
├── README.md                          总览
├── .gitignore
├── marathon-platform/                 ★ 产品(线上部署目录)
│   ├── index.html
│   ├── assets/  engine.js / store.js / app.js / styles.css
│   └── README.md                      详细设计与架构说明
├── tools/
│   ├── digest.js                      每日巡检:算状态 → 摘要 / 邮件 / 紧急清单
│   └── notify.js                      巡检 + 推送
├── tests/
│   └── regression.js                  83 项断言,任意克隆可跑
├── data/
│   ├── marathon_watchlist.example.json  入库模板(无个人数据)
│   └── marathon_watchlist.json          活的关注清单(已 gitignore)
├── docs/
│   ├── WORKLOG.md                     本文件
│   └── HANDOVER.md                    交接文档
└── legacy/
    ├── README.md
    ├── marathon_registrar.html        历史单文件版 · 同时是防漂移基线夹具
    └── marathon_calendar_2026.html    历史赛历,无引用
```

### 验证

- 回归从 82 项 → **83 项**(新增夹具守卫)全绿,且**在仓库内用相对路径运行**
- `digest.js` 三级回退逐一实测:活文件(静默) / 仅模板(告警 + 退出码 0) / 全缺(指引 + 退出码 4)
- 移动文件后活数据完好(24 场 + 33 个档案字段)

---

## 10. 阶段九:交接可独立性审计(10-07 17:25)

**目标:让同事克隆仓库后能独立推进,不必回来问原作者。**

### 验证方式:真的做一次「陌生人克隆」

不靠通读代码下判断,而是**从 GitHub 匿名克隆**到干净目录,把同事会敲的命令全敲一遍:

| 命令 | 结果 |
|---|---|
| `git clone`(匿名,无凭据) | ✅ 17 个文件全部拿到 |
| `node tests/regression.js` | ✅ 83 通过 / 0 失败 |
| `node tools/digest.js` | ✅ 自动回退到入库模板 + 明确告警,退出码 0 |
| `node tools/notify.js` | ❌ **找不到发信 CLI** —— 而仓库里对此只字未提 |
| 打开 `index.html` | ✅ 资源全为相对路径,放哪儿都能跑 |

关键在最后两行:**代码能跑 ≠ 能接手。** 断的是信息,不是功能。

### 找出的 6 个移交阻断项(已全部修掉)

| # | 问题 | 为什么这算阻断 |
|---|---|---|
| 1 | `tools/notify.js` **硬编码了原作者的绝对路径**(`/Users/<用户名>/...`) | 公开仓库里带着个人路径;对别人是条死路径 |
| 2 | **邮件通道完全没写进仓库**(配置文档被 gitignore) | 同事跑到 `notify.js` 只看到「找不到 CLI」,无从下手 |
| 3 | **每日 09:00 自动化只存在于原作者的 WorkBuddy 里** | 这是产品的核心行为,同事看不到也重建不了 |
| 4 | **发布方式没写** | 只有一个线上 URL,不知道是怎么上去的、怎么再发一次 |
| 5 | **`LICENSE` 缺失** | 公开可见但无授权条款,同事严格讲无权复用。已定为**保留所有权利** |
| 6 | `HANDOVER §10` 的验收断言**本身是错的** | 写着「`--date 2026-10-07` 期望有『待缴费』」,那天压根没有待缴费 |

### 一个被文档掩盖的陷阱:`--date` 的时刻语义

起因是发现「同一日期,两次运行结果不一样」,顺着查到:

```bash
node tools/digest.js                     # 用真实时间 → 17:30 跑,14:00 的抽签已过 → 「结果已公布·待确认」
node tools/digest.js --date 2026-10-07   # 固定按当天 09:00 算 → 抽签未到 → 「待抽签」
```

不是 bug,是 `--date` 的既定语义(`digest.js` 第 50 行:不写时刻则取 09:00)。
但**生产环境的自动化用的是真实时间**,于是文档里那条「复现命令」其实复现不了线上行为 ——
同事照做会以为系统算错了。已在 `HANDOVER §10` 与 `MAIL_SETUP §4` 写明,并给出带时刻的写法。

### 顺带发现的真实故障:邮件授权已过期

审计中调用 `agently-cli +me`,返回:

```
invalid_grant: refresh token is invalid or expired, please re-authenticate
```

**每日 09:00 的自动化目前是坏的。**

更麻烦的是原来的报错会**掩盖**它 —— `+me` 失败后 `TO` 为空,程序只说
「无法确定收件地址…请设置 DIGEST_TO」,把人引向配置问题,而真因是授权失效。
已把两种情况分开:授权失效 → 退出码 `11` + 直接给出 `agently-cli auth login`。

### 补进仓库的东西

| 新增 | 作用 |
|---|---|
| `LICENSE` | 保留所有权利,中英对照,含免责声明与「以官方公告为准」条款 |
| `scripts/check.sh` | 一键自检:语法 + 83 项断言 + 巡检冒烟 + 隐私守卫。零权限、谁都能跑 |
| `docs/MAIL_SETUP.md` | CLI 契约、配置项、故障排查表(**不含任何真实邮箱**) |
| `docs/OPERATIONS.md` | 巡检调度(cron/launchd)、网站发布、数据维护位置 |

> **关于 CI**:原本打算加 GitHub Actions,推送时被 GitHub 拒收 ——
> `refusing to allow a Personal Access Token to create or update workflow`
> (创建 `.github/workflows/` 下的文件需要带 `workflow` 权限的令牌)。
> 与用户确认后**改为本地自检脚本**:同一批断言,但零权限要求,
> 而且能在本地就把问题拦下来。将来要接 Actions,套一层 workflow 调它即可。

### 文字修正

- `HANDOVER` **内部自相矛盾**:一处写「33 个字段」、另一处写「34 字段」。
  实为 **33 个档案字段 + 1 个 `_说明` 注释键 = 34 个键**,已统一表述
- `marathon-platform/README.md` 的「82 项断言」是旧值 → 改为 83
- `HANDOVER §8` 原文「本机没有存储任何 Git 凭据」—— 那是原作者机器的状态,
  对同事是误导。改为「若 `push` 要凭据,三条解决路径」
- 「60 场里 31 场待公布」标注为**某时点快照**,避免被当成常数

### 验证

- 匿名克隆 → 83 项断言全绿、`digest.js` 退出码 0、无 `/tmp` 残留、`git status` 干净
- 新增文档全文扫描:无邮箱 / 身份证号 / 手机号 / token(仅 `you@example.com` 等占位)
- `scripts/check.sh` 实跑:四项全绿、退出码 0;用 `--out` 写临时目录,
  **不会覆盖当天真实的 `reports/` 摘要**

---

## 11. 阶段十:UI 动感改版(10-08 13:20,本阶段)

**需求原话:** 「UI要做得充满动感,有跑步运动的风格」。

### 决策:改版只准动 CSS,类名一个都不许改

这是本阶段唯一重要的一条,值得单独写下来。

`tests/regression.js` 的 C 段(UI 回归)是**按类名计数**做断言的 —— 它把渲染结果当字符串数:

| 断言 | 计数方式 |
|---|---|
| 看板 KPI 8 项 | `class="kpi` 出现 8 次 |
| 赛事库 60 场 | `class="lib-card` 出现 60 次 |
| 类型切换条 3 个按钮 | `class="kt` 出现 3 次 |
| 赛事库分两区 | `class="kind-sec` 出现 2 次 |
| 分区表头 / 类型标记 / 距离 / 分组占比 / 档案字段 | `class="ks-desc"` · `class="k-tag` · `class="lc-dist` · `class="kd"` · `class="field"` |

所以一次「换皮」如果顺手改了类名,测试就会**整片变红**,而且回退成本极高。
处理方式是:**视觉全部落在 `assets/styles.css`,`app.js` 只做纯增量**——
加元素、加属性、加一个渲染函数,既有类名与 DOM 结构原封不动。

结果:83 项断言**一行都没改**就全绿通过。

### 做了什么

| 文件 | 改动 |
|---|---|
| `marathon-platform/assets/styles.css` | **整体重写**(379 → 约 1040 行),视觉体系全部替换 |
| `marathon-platform/index.html` | 加装饰层与跑者 SVG;**所有既有 id 不变**,只登记新增的 4 个 |
| `marathon-platform/assets/app.js` | 只加 `renderTicker(tl)`,在 `renderDash` 里调用 |
| `marathon-platform/assets/motion.js` | **新增**,顶栏计时器 / 赛道进度条 / KPI 数字冲刺 |
| `scripts/check.sh` | 语法检查清单补上 `motion.js` |

视觉体系(「跑道 / 田径」):

- **深色沥青顶栏** —— 渐变底 + 循环掠过的扫光 + 底部滚动的分道虚线;品牌圆标带脉冲光环
- **顶栏计时器** —— 每秒走动的跑步表(等宽字体 + 闪烁指示点),给出"全站都在跑"的观感
- **Hero 跑道** —— 底部渐隐的分道线 + 一个**四肢循环摆动的跑者剪影**沿赛道循环跑过,身后拖速度线
- **赛道播报条** —— 未来 60 天节点横向滚动播报,鼠标悬停暂停
- **号码布式卡片** —— 徽标 + 等宽斜体计时数字;悬停上浮 4px 并有一道速度残影横扫
- **进度条** —— 底下是分道刻度,填充里跑过一条流光
- **入场节奏** —— 卡片按 `nth-child` 依次延迟升起,形成"起跑"错位感
- 时间/数字统一换 `font-variant-numeric:tabular-nums`,读起来像计时器

**降级:** `@media (prefers-reduced-motion:reduce)` 里把所有动画与过渡一次性关掉,
跑者定格居中、残影层直接 `display:none`。这是硬要求,不是可选项。

### 这一阶段新踩的坑

| 坑 | 结论 |
|---|---|
| 渐变字(`background-clip:text` + `color:transparent`) | 不支持该属性的内核会让**整段标题消失**。必须用 `@supports` 包住,并保留一层纯色兜底 |
| 装饰元素命名 | 新增类名要**避开会被测试计数的前缀**(`kt` / `k-tag` / `kd` / `kpi` / `race ` / `lib-card`)。播报条条目最终定名 `.tbi`,不要图省事写 `.tk` |
| 滚动字幕无缝循环 | `translateX(-50%)` 只在「轨道宽度不含额外内边距」时等于一份拷贝。左边留白要加在**外层容器**的 `padding-left`,不能加在滚动轨道上,否则接缝会跳 |
| 沙箱内看不了页面 | 无头 Chrome 依旧不可用(见 §13)。**验证靠 `curl` 抓线上字节 + Node DOM 存根跑断言**,视觉最终由用户在人眼预览里确认 |

### 验证

```bash
node tests/regression.js   # 83 通过 / 0 失败(断言零改动)
sh scripts/check.sh        # 四段全绿:语法 / 回归 / 巡检冒烟 / 隐私守卫
```

外加一次**临时的一致性核对**(用完即删,不入库):CSS 花括号配平、
HTML/JS 里出现的静态类名是否都有样式定义、关键 DOM 锚点是否齐全。

发布后用 `curl` 抓线上实际字节复核:`index.html` 含 `class="runner"`、
`assets/motion.js` 返回 200(3150B)、`assets/styles.css` 为新的 42081B。

---

## 12. 缺陷修复总账

| # | 缺陷 | 影响 | 状态 |
|---|---|---|---|
| 1 | 抽签结果公布后警报被「已截止」埋掉 | 中签后错过 3–7 天缴费期,名额作废 | ✅ 新增 `drawdone` 态 |
| 2 | 「已开放但无截止日」被误判为「还没开放」 | 把正在开放的窗口写成未开放,直接错过 | ✅ 新增 `opendeadline` 态 |
| 3 | 长期开放赛事天天触发「紧急」 | 报警疲劳,淹没真正的截止日 | ✅ 重定义「紧急」为有明确时间窗 |
| 4 | 「我的关注」漏掉三种状态的赛事 | 关注了却看不到,以为没关注上 | ✅ 补分组 |
| 5 | 巡检脚本从旧 HTML 抽 JS | 越野赛对邮件完全不可见 + 可能悄悄分叉 | ✅ 收口到唯一引擎 |
| 6 | 回归测试只存在于 `/tmp` | 随时丢失,无从复现 | ✅ 收编进 `tests/` |
| 7 | 防漂移靠行号切片,错位会静默假绿 | 测试可能给出虚假的安全感 | ✅ 加夹具守卫断言 |
| 8 | 活的个人档案被 git 跟踪 | 填了真实身份证号即公开泄漏 | ✅ 拆分模板 + gitignore |
| 9 | `notify.js` 硬编码原作者绝对路径 | 公开仓库泄漏个人路径;对他人是死路径 | ✅ 改为通用探测 + `AGENTLY_CLI` |
| 10 | 邮件授权失效被报成「收件人未配置」 | 排查方向被带偏,真因是授权过期 | ✅ 分开报错 + 退出码 `11` |

---

## 13. 环境坑记录(省得下次再试)

| 坑 | 结论 |
|---|---|
| 沙箱内无头 Chrome 截图 | **不可用**。`--headless=new` 报 `FATAL:base/path_service.cc:264 Failed to get the path for 1001`,换 HOME / `--user-data-dir` / `--no-sandbox` / 禁 crashpad 均无效。**验证 UI 请用 Node DOM 存根方案**,别浪费时间在截图上 |
| 沙箱内没有 `timeout` 命令 | 脚本里别用 |
| `git push` 报 `CONNECT tunnel failed, response 502` | 代理隧道偶发失败,**原样重试一次即可**,不要重配 proxy |
| `ls 不存在的 glob` | zsh 返回非零会打断整条命令链,记得用 `;` 分开写 |
| Bash 里多模式 `grep "a\|b"` | 本环境表现异常(返回空),**改用专用搜索工具** |
| CloudStudio 静态部署 | 必须 8080 端口(其他端口会 400 exec failed) |
| 沙箱内 `ps` 命令 | **不可用**(`operation not permitted`)。查进程改用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 找监听 + `lsof -p <pid> -a -d cwd` 认归属 |

---

## 14. 验证方法

项目没有引入任何测试框架,**保持零依赖**。全部验证靠:

```bash
# 全量回归 —— 83 项断言,失败则退出码非 0
node tests/regression.js
```

**并且已经收了自检脚本**:`sh scripts/check.sh` 一次跑完语法检查、83 项断言、
巡检冒烟与隐私守卫,全绿退出码 0。

> 为什么不接 CI:创建 `.github/workflows/` 下的文件需要带 `workflow` 权限的令牌。
> 自检脚本用同一批断言,零权限要求,还能在本地就拦下问题。

测试用 **Node DOM 存根**在 `vm` 沙箱里真实加载 `engine.js → store.js → app.js` 三层,
跑真实断言,覆盖:

- **A. 引擎防漂移**:1152 组对照,路跑状态不得改变
- **B. 越野数据完整性**:36 场的官网 / 距离 / 备注 / 比赛日 / 赛季分布 / 门槛值域
- **C. UI 回归**:两区块渲染、类型筛选、切换条点击路径、关注分组完整性、
  材料清单分支、档案越野告警三条分支、ICS 结构闭合、自建赛事

> 之所以不用 agent-browser:需要约 500MB Chromium,而 DOM 存根已经能覆盖
> 「状态机 + 渲染逻辑」这两处真正会出错的地方。

## 15. 阶段十一:P0 本地身份层(10-08 14:30,本阶段)

用户说「那就开始吧」,落地 `docs/AUTH_DESIGN.md` 里的 **P0**:本机身份 + 登录面板 + 顶栏昵称,
**数据仍留本地**,不碰云、不碰引擎。这一步专门绕开「云被手动取消」的约束 —— P0 是纯前端,
不需要任何后端或授权。

**改动清单**

| 文件 | 改动 |
|---|---|
| `assets/auth.js` | **新增**(UMD)。本地账号存 `localStorage` 的 `mt_account_v1`:昵称 + 选填邮箱,**绝不存证件号/手机号**。提供 `get / isAuthed / signIn / signOut / onChange`,刷新保持、多标签页 `onChange` 同步 |
| `index.html` | 给顶栏 `.acct-chip` 加 `id="acctChip"`;`<script>` 在 `store.js` 与 `app.js` 之间插入 `auth.js`(加载顺序 `engine → store → auth → app → motion`) |
| `assets/app.js` | `openAccount()` 改成真实身份表单:未登录显示昵称+邮箱输入,已登录显示信息+退出;点击代理加 `acct-save` / `acct-out`;启动段把 `Auth.get()` 镜像进 `S.state.account`(便于备份 JSON 带昵称),并渲染顶栏 chip |
| `assets/styles.css` | 新增 `.acct-chip.on`(登录态带脉冲点)、`.acct` / `.acct-row`(信息表)、`.acct-intro` / `.acct-form` / `.acct-fld` / `.acct-in` / `.acct-note`(表单)。全走 `.acct-*` / 复用类,**不碰被回归计数的类名** |

**设计要点(和 AUTH_DESIGN 一致)**

- 隐私红线:P0 只存昵称与选填邮箱;证件号/手机号一律不进 `auth.js`,也不经 `store` 上传
- 镜像而非双写:身份真值在 `auth.js`,`store.account` 只是镜像,备份 JSON 才会带上昵称
- 退出不等于清数据:`signOut` 只清身份,关注清单/档案仍在
- 引擎零改动:状态判断仍是 `engine.js` 唯一来源,本阶段 83 项断言一行没改

**验证**

- `node tests/regression.js` → 83/83(存根已补加载 `auth.js`,顺带验证了加载顺序)
- `auth.js` 单元检查 10/10:登录/退出/持久化/刷新保持/`onChange`/空昵称忽略
- 端到端集成冒烟 10/10:点账号 → 填昵称 → 保存 → 顶栏变昵称 → store 镜像 → 退出 → 复位
- `sh scripts/check.sh` → 全通过

**下一步(未做,等用户拍板)**

- P1 上云:接后端单表 blob + 离线缓存 + `ME.mergeStates` 合并策略(换设备看到同一份关注)
- 登录方式:微信扫码 / 手机验证码(需后端)
- 证件信息同不同步:本阶段**默认不同步**,沿用 AUTH_DESIGN 的建议

---

## 16. 阶段十二:P1 云端同步(10-08 15:10,本阶段)

用户说「接着做」,在 P0 本地身份层之上落地 `docs/AUTH_DESIGN.md` 的 **P1**:真实云账号 + 单表 blob 同步,
换设备看到同一份关注 / 勾选 / 设置,**证件类字段仍只留本机**。

**决策:复用已发布的同一个 appId**

站点以应用 `wbapp_Hq5OK3jMzN64v1kK3FMP1z` 发布,云服务身份校验**按同源 Origin 生效**。
P0 阶段曾把云手动取消,这次重新 `activate` 时**故意复用同一个 app 而非新建** —— 这样云端的 Origin 与线上
分享链接同源,登录回调不会被跨域拦掉。新建一个 app 会多一套独立云环境,反而把数据割裂。

### 接入形态(早就定死的)

项目无 `package.json`/无打包器 → SDK **只能走 CDN `<script>`**(全局 `WorkBuddyCloud`,
`@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js`),必须用 `@dev` 而非 `@latest`。
前端**永远不持有端点域名**:`publicConfig` 里只放 `endpoint` / `oauthRelayBaseUrl` / `publishableKey` 三样,
且**绝不在代码里硬编码 endpoint**,也不手写对 `/.cloud/**` 的 fetch。

### 改动清单

| 文件 | 改动 |
|---|---|
| `assets/cloud.js` | **新增**(UMD)。持有 `PC = publicConfig`;`init()` 建 `cloud = W.createWorkBuddyCloud({...})`;`isReady()` 暴露就绪态。封装 Auth(`sendOtp`/`verifyOtp`/`signOut`/`getSession`/`onAuthStateChange`/`maskIdentity`)与同步(`pull`/`push`)。`owner_id` 一律交给服务端,前端不传 |
| `assets/engine.js` | 新增纯函数 `ME.mergeStates(local, cloud)`(见下「冲突处理」),导出到返回对象 |
| `assets/store.js` | 新增 `toSyncBlob()`(只吐 `{watching,checklists,settings,custom,savedAt}`,**永不带 profile/account**)、`applySyncBlob(blob)`(写回合并后的子集,profile/account 原样不动)、`clone()`;`[SEAM]` 不变 |
| `index.html` | 顶栏加 `<span class="sync-dot" id="syncDot">`;`<script>` 在 `auth.js` 与 `app.js` 间插入 `cloud.js`(加载序 `engine → store → auth → cloud → app → motion`);页脚注明云端同步范围与证件类字段不上云 |
| `assets/app.js` | 加云同步整块:`doSync()`(拉 → `mergeStates` → 写回 → 渲染 → 推)、`schedulePush()`(1.5s 防抖)、`cloudSection()`(登录页/已登录区)、`setSyncDot()`(ok/pending/error/off)、`refreshCloudUI()`;点击代理加 `cloud-tab`/`cloud-send-phone`/`cloud-verify-phone`/`cloud-send-email`/`cloud-verify-email`/`cloud-sync`/`cloud-out`;启动段 `Cloud.isReady()` 时挂 `onAuthStateChange` + 自动 `doSync` + `S.subscribe(schedulePush)` |
| `assets/styles.css` | 加 `.sync-dot`(+ `.ok/.pending/.error/.off`)+ `.acct-cloud` / `.cloud-status` / `.acct-tabs` / `.acct-tab` / `.cloud-form` 等,全在 `.acct-*` / `.sync-*` 命名空间,**不碰被回归计数的类名** |

### 冲突处理(写成引擎纯函数,可回归)

`ME.mergeStates(local, cloud)` 是**首次登录即合并、而非覆盖**的核心,规则:

- `watching` 按 `raceId` 并集;冲突取 `updatedAt` 较新者
- `checklists` 并集,`true` 优先级最高(勾上过就不要被没勾的覆盖)
- `settings` 本地优先(`Object.assign({}, cloud.settings, local.settings)`)
- `custom` 按 `id` 并集,本地优先
- 返回 `{watching, checklists, settings, custom, savedAt}`

这样「手机上关注了 A、电脑上关注了 B」合并后是 A+B,不会互相吞。

### 隐私红线(云上只放安全子集)

- `toSyncBlob()` **只**取 watching / checklists / settings / custom / savedAt 五样
- `applySyncBlob()` 只写回这五样,`profile`(姓名/身份证/手机号/紧急联系人)与 `account`(昵称镜像)**原样不动**
- 云表 `user_state` 结构:`id` / `owner_id(默认 auth.uid())` / `state_json(JSONB)` / `updated_at` / `created_at`
- 表级 RLS:`owner_id = auth.uid()`,`authenticated` 才授权;`INSERT` 也不许带 `owner_id`,由服务端默认填
- 回归里加了 13 条断言守护这两条(mergeStates 各分支 + `toSyncBlob` 不含 profile/account + `applySyncBlob` 不写 profile)

### 验证

- `node tests/regression.js` → **96 通过 / 0 失败**(新增 13 条,断言零改动)
- `sh scripts/check.sh` → 四段全绿(语法 / 回归 / 巡检冒烟 / 隐私守卫)
- 线上 `curl` 复核:`index.html` 含 `id="syncDot"`、`workbuddy-cloud-sdk@dev`、`assets/cloud.js` 200(5239B)、`publishableKey` 已注入(验证时脱敏为 `wbpk_..._***`)
- 发布:`workbuddy_sites_deploy` 重新发布,线上已生效

### 这一阶段新踩的坑

| 坑 | 结论 |
|---|---|
| RLS 策略被并行写竞争吃掉 | 8 条 `exec_sql`(4 DROP + 4 CREATE 交错)并行跑,后到的 DROP 把先到的 CREATE 干掉,最后只剩 `insert_own` / `delete_own`。**改串行**:先一批 4 个 DROP,再一批 4 个 CREATE,`list_rls` 复核 4 条全在 |
| 回归 `const T` 重名 | 新增测试块误用 `const T`(file 前面已声明),`SyntaxError`。改名 `const MG = W.mergeStates` |
| 断言数先估错 | 初设 99,实际 96(83+13)。统一改为 96 |

### 下一步(未做,等用户拍板)

- P2 服务端:把单表拆成 `watchlist`/`checklists`/`profiles` 等多表,巡检迁服务端才能「不开机也收邮件」
- 登录方式:手机/邮箱 OTP 已接,微信扫码需 `oauthRelayBaseUrl`(已传);**Auth Provider 开关若云端当前关闭,需在云管理面板开启** —— 这是上线前需用户确认的一步
- 证件是否上云:本阶段**默认不同步**;AUTH_DESIGN 建议仅显式勾选才同步且界面标注

---

## 17. 阶段十三:赛事库「报名中 / 已截止 / 所有」过滤(10-08 18:55,本阶段)

用户要求在浏览赛事库时加三个过滤条件:**报名中 / 已截止 / 所有**。

### 设计(守两条红线)

- **红线 4(分类必须由引擎驱动)**:过滤归类不写在界面,而是在 `engine.js` 新增纯函数 `ME.phaseOf(key)`,
  把 15 态归为三类:`open`(报名中:open/opendeadline/pay/drawdone/closing/waitdraw)、
  `closed`(已截止:closed/lost/racing/done/skipped)、`other`(待公布:soon/notopen/unknown/pending,只在「所有」出现)。
  界面只调 `ME.phaseOf(catalogStatus(r).key)`,不自行判断。
- **红线 5(类名不得更名 / 不新增独立事件绑定)**:过滤按钮用新类名 `.lib-pbtn`(避开被回归计数的 `kt`/`lib-card` 等前缀),
  走全局点击代理 `data-act="libphase"`,不另绑事件。视觉复刻 `.kt` 的胶囊 + 激活态,纯 CSS。

### 改动清单

| 文件 | 改动 |
|---|---|
| `assets/engine.js` | 新增 `PHASE_OPEN` / `PHASE_CLOSED` / `ME.phaseOf(key)`,并导出到返回对象 |
| `assets/app.js` | `lib.phase` 状态(默认 `all`);`filteredCatalog()` 拆出 `catalogBase()`(不含阶段过滤),阶段过滤在末端套用;`phaseTabsHTML(cur,cnt)` 渲染三按钮(数字跟随类型/地区/赛制/搜索实时变化);`renderLib()` 先算各阶段计数再填 `#libPhase`;点击代理加 `case "libphase"` |
| `index.html` | 赛事库 `#kindTabs` 下新增 `<div id="libPhase" class="lib-phase">` |
| `assets/styles.css` | 新增 `.lib-phase` / `.lib-pbtn`(`.on` 激活态 + 底部跑道高亮),不碰被计数的类名 |
| `tests/regression.js` | 新增 3 条 `ME.phaseOf` 断言(open/closed/other 三类覆盖),**守护「分类必须由引擎驱动」**,防止以后有人把判断挪回界面 |

### 验证

- `node tests/regression.js` → **99 通过 / 0 失败**(较 §16 的 96 新增 3 条 phaseOf 断言)
- `sh scripts/check.sh` → 四段全绿(语法 / 回归 / 巡检冒烟 / 隐私守卫)
- 线上 `curl` 复核 `index.html` 含 `id="libPhase"`(待重新发布后生效)

### 这一步的取舍

「所有」是 catch-all:soon / notopen / unknown / pending 这四类「未开放 / 待公布」的赛事**只在「所有」里出现**,
不在「报名中」也不在「已截止」—— 它们既没开也没关,归到任一边都会误导。越野赛大量处于「窗口未公布」,
这样它们不会在「报名中」里被误标成可报。

---

## 18. 阶段十四:个人资料管家 —— 加密备份(A)+ 报名预填辅助(C)(10-08 21:50,本阶段)

用户真实目的:把个人信息(姓名 / 身份证 / 手机号 / 紧急联系人等)记下来,以后报名时不用每次重填,
最好能一键提交。先澄清了硬现实:**本平台是「赛事跟踪台」、没有报名 API**;真正报名在各自官网,
那一步必然明文出境,所以「一键报名」目前走「备好资料 + 预填/复制、手动去官网提交」,而非自动 POST 第三方。

用户拍板 **A + C**:
- **A. 本机加密备份**:资料用口令加密成一份文件带走(换机 / U 盘),平台与云端都看不到明文。
- **C. 报名预填辅助**:资料已可一键复制(已有 `ME.profileBlock` + 详情弹窗「复制报名资料」+ 档案侧栏「复制全部资料」),
  本阶段把入口补到赛事库列表卡片(浏览时即可「复制资料」)。

### 设计要点

- **加密只在客户端、密钥只由口令派生**:`assets/crypto.js`(UMD,零依赖)用 Web Crypto
  `PBKDF2(SHA-256, 25 万轮)` 派生 `AES-GCM-256` 密钥,随机 salt + 随机 iv。
  密文结构 `{ v, alg, iter, salt, iv, ct }` 全部 base64。「口令遗忘 = 不可恢复」在 UI 明示。
- **不破隐私红线**:云端 `user_state` 仍不含证件字段(§16 红线 9 不变);加密备份是**本机外带机制**,
  密文文件离开本机也不怕泄露。`file://` 下 Web Crypto 不可用 → 禁用加密按钮并提示改用 https / localhost。
- **`store.exportEncrypted(pass)` / `importEncrypted(text, pass)`**:加密整份 state(含 profile 证件)为密文 JSON;
  解密后 `normalize` 写回。与明文 `exportJSON/importJSON` 并列,数据收口仍在 `store.js` 的 `[SEAM]` 哲学内。
- **守红线 4/5**:加密导出/导入按钮走全局点击代理 `data-act="backupex"/"backupim"/"enc-ok"/"enc-cancel"`,
  口令模态用新类名 `.enc-modal`(不碰被计数类名);赛事库复制按钮复用既有 `data-act="copy"`(已存在)。

### 改动清单

| 文件 | 改动 |
|---|---|
| `assets/crypto.js` | **新增**(UMD)。`MCrypto = { isAvailable, encryptText, decryptText }`;base64 兼容浏览器 btoa/atob 与 Node Buffer |
| `assets/store.js` | 新增 `exportEncrypted(pass)` / `importEncrypted(text, pass)`(async),暴露到 `root.Store` |
| `index.html` | 加载序 `engine → crypto → store → auth → cloud → app → motion`;备份面板加「导出/导入加密备份」+ 隐藏 `#importEncFile`;新增 `#encModal` 口令模态 |
| `assets/app.js` | `openEncModal/closeEncModal/encOk` + `pendingEnc` 状态机;`renderLib` 卡片加「复制资料」;`backupex/backupim/enc-ok/enc-cancel` 点击代理;`importEncFile` change 读文件 → 弹口令 |
| `assets/styles.css` | 新增 `.enc-modal` / `.enc-box` / `.enc-in` / `.enc-acts` / `.enc-warn`(纯 CSS,非计数类) |
| `tests/crypto.test.js` | **新增**(独立,Node webcrypto):密文不含明文(姓名/证件/手机)/ 口令正确还原 / 错误口令失败 / 非法结构失败,共 5 项 |
| `scripts/check.sh` | 语法检查加 `crypto.js`;新增「2b. 加密备份守卫」段调用 `tests/crypto.test.js`(失败即非零退出) |

### 验证

- `node tests/regression.js` → **99 通过 / 0 失败**(不变)
- `node tests/crypto.test.js` → **5 项全过**(密文不含明文 / 错误口令失败 / 非法结构失败)
- `sh scripts/check.sh` → 全绿(语法 / 99 回归 / 5 加密守卫 / 巡检冒烟 / 隐私守卫)
- 本地预览 http://127.0.0.1:8787 复核:`#encModal` 容器、`assets/crypto.js` 引用、`app.js` 含 `backupex`、`renderLib` 含 `data-act="copy"` 均就位

### 这一步后仍未做(等用户拍板)

- **B 路线(客户端加密同步上云)**:若用户要「无感跨设备」而非手动带文件,再做口令派生密钥的密文同步(红线 9 需改写为「证件上云必须是客户端加密密文」)。
- **D 路线(真·API 自动提交第三方)**:基本不可行(无稳定公开接口 / ToS / 验证码 / 支付),暂不做。
- 当前「报名预填」是复制文本手动粘贴;若某些赛事官网支持「预填链接 / 表单回填参数」,可后续增强为生成带参 URL。

---

## §19 阶段十五:移动端抛光 + C+预填升级 + 微信登录 + 待公布提示(2026-10-08)

> 用户拍板做 1、2、4、5(移动端 CSS 抛光 / C+ 报名预填升级 / 微信登录 / 待公布提示)。
> 5 个回归断言(99→104),自检验证全绿。本地 commit 后等用户「发布」上线。

### 改动清单

| 文件 | 改动 |
|---|---|
| `assets/engine.js` | 新增纯函数 `isWindowPending(key)`(soon/notopen/unknown/pending 归「窗口待公布」)、`trailGearList(km)`(按距离给强制装备清单);`profileBlock` 在越野赛时追加强制装备段;return 导出两者 |
| `assets/app.js` | `doOpen(id)` 先复制 `profileBlock` 文本再 `window.open(r.url)`(C+ 一键复制+跳官网);赛事卡加待公布标签 `.r-pend`(`pendTag` 辅助);`cloudSection` 加微信登录按钮 `data-act="cloud-wechat"` + `cloudWechat()`;启动块先 `Cloud.handleOAuthCallback()` 再 `Cloud.getSession()`;点击代理加 `case "cloud-wechat"` |
| `assets/cloud.js` | 新增 `wechatAuth(redirectTo)`(走 `auth.signInWithOAuth({provider:"wechat",redirectTo})`)+ `handleOAuthCallback()`;均 `ready` 守卫;导出两者 |
| `assets/styles.css` | 增强 `@media(max-width:900px)`(触控目标、`.lib-phase`/`.kind-tabs` 横滚、`.r-acts` 换行);新增 `@media(max-width:560px)`;加 `.r-pend` / `.wechat-btn` 基础样式 |
| `tools/digest.js` | 复用 `ME.isWindowPending`;MD 概览 + 邮件 HTML + 控制台计数新增「窗口待公布」分组 |
| `tests/regression.js` | +5 断言守 `isWindowPending` / `trailGearList`(99→104) |

### 关键判定

- **微信登录走 OAuth 中转(signInWithOAuth provider=wechat + handleOAuthCallback)**,适配静态站无后端场景;
  依赖云端该应用的微信 OAuth 回调白名单(客户端无法验证,已备注待用户在云后台确认)。
- **待公布提示不计入「紧急」(红线 2 不变)**:`isWindowPending` 只用于摘要/邮件的「窗口待公布」分组与站点标签,
  不触发发信,避免天天为同一场长挂窗口报警。
- **C+ 预填**:复制资料与跳官网解耦(`profileBlock` 先复制,窗口照常开),越野赛自动带强制装备清单,贴合越野三处本质差异。
- 守红线 4/5:微信按钮与待公布标签均走全局点击代理 / 非计数类名,未新增独立事件绑定。

### 验证

- `node tests/regression.js` → **104 通过 / 0 失败**
- `node tests/crypto.test.js` → **5 项全过**
- `sh scripts/check.sh` → 全绿(语法 / 104 回归 / 5 加密守卫 / 巡检冒烟 / 隐私守卫)
- 本地预览复核:`.r-pend` 标签、`cloud-wechat` 按钮、`isWindowPending` 分组均就位

### 这一步后仍未做(等用户拍板)

- **微信 OAuth 回调白名单**:需用户在云后台把本站域名加入该应用微信登录的 redirect 白名单,否则 `handleOAuthCallback` 拿不到 code。
- B 路线(客户端加密同步上云)、D 路线(真·API 自动提交第三方)维持 §18 结论暂不做。
- 移动端为 CSS 抛光,未引入新交互框架;若后续要 PWA/离线缓存可单列阶段。


