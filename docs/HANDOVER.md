# 交接文档 · HANDOVER

> 面向接手这个项目的人(或半年后的自己)。目标:**读完这一份就能改代码,不用先考古。**
> 配合 `docs/WORKLOG.md`(怎么走到今天的)一起看。
>
> 最后更新:2026-10-07

---

## 1. 这是什么

**赛事跟踪台** —— 盯住马拉松 / 越野赛的报名开放、截止、抽签公布、缴费截止,
在真正需要人行动的那一刻推一条提醒。

- 收录 **60 场**:24 场马拉松 / 路跑 + 36 场全球越野赛(2026–2027 赛季)
- 形态:**零构建纯静态网站** + **零依赖 Node 脚本**(每日巡检与邮件)
- 线上:`https://marathon-tracker.app.workbuddy.host/`(发布方式见 `docs/OPERATIONS.md` §3)
- 仓库:`https://github.com/xinster/marathonforall`(**保留所有权利,非开源**,见 `LICENSE`)

### 它不做什么(想清楚了才做的决定)

**不做代报名、不做自动提交。** 理由:

1. 报名要实名 + 人脸/证件核验,自动化提交必然触发风控
2. **抽签制下报名先后完全不影响中签率** —— 抢时间不产生任何收益
3. 代人提交实名信息有合规问题

真正的痛点不是「没抢到」,而是 **中签后忘记缴费** —— 缴费期通常只有 3–7 天,
逾期名额**立即释放且不可恢复**。绝大多数流掉的名额死在这条线上。

**所以这个项目的核心是状态机 + 提醒,不是表单提交。** 这句话决定了后面所有架构选择。

---

## 2. 五分钟上手

```bash
# 1. 拿一份自己的数据文件(仓库里的模板不含个人数据)
cp data/marathon_watchlist.example.json data/marathon_watchlist.json

# 2. 看网站(零构建,直接开)
open marathon-platform/index.html
#    或 python3 -m http.server 8000 --directory marathon-platform

# 3. 跑一次巡检(只生成摘要,不发信)
node tools/digest.js

# 4. 跑测试 —— 应输出 "99 通过 / 0 失败"
node tests/regression.js

# 5. 一键自检(语法 + 回归 + 巡检冒烟 + 隐私守卫)
sh scripts/check.sh
```

个人数据存在浏览器 `localStorage`,同时可由 `tools/digest.js` 从
`data/marathon_watchlist.json` 读取用于发信。

### 深入一点

| 想知道 | 看 |
|---|---|
| 架构为什么不许改、状态机 15 态、改代码红线 | **本文(§3 / §4 / §11)** |
| 每天怎么自动跑、网站怎么发布、赛历数据怎么改 | `docs/OPERATIONS.md` |
| 邮件通道怎么接、报错怎么查 | `docs/MAIL_SETUP.md` |
| 账号体系 / 用户登录怎么落地 | `docs/AUTH_DESIGN.md`(完整方案);**P0 本地身份已落地** |
| 为什么当初这么做、踩过哪些坑 | `docs/WORKLOG.md` |

---

## 3. 架构

### 唯一不变量:状态判断只写一遍

```
        ┌──────────────────────────────────────────┐
        │  marathon-platform/assets/engine.js      │
        │  纯函数 · 零 DOM · 唯一状态机 + 赛事目录 │
        └───────────────┬──────────────────────────┘
                        │ require / window.ME
        ┌───────────────┼───────────────┬──────────────────┐
        ▼               ▼               ▼                  ▼
   assets/app.js   assets/store.js  tools/digest.js   tests/regression.js
   (界面)          (数据适配)       (每日巡检)        (回归断言)
                                        │
                                        ▼
                                  tools/notify.js  → 邮件
```

**这是硬约束,不是偏好。** 状态判断写两遍**必然漂移**,会出现
「网页说待缴费、邮件说已截止」这种最要命的错误。共用一份文件,结构上就不可能漂移。

历史上 `tools/digest.js` 曾经从旧 HTML 里抽 JS —— 结果就是越野赛对邮件**完全不可见**,
而且随时可能悄悄分叉。已收口。**不要再引入第二份状态判断。**

### 数据分工

| 数据 | 来源 | 说明 |
|---|---|---|
| 赛事**事实字段**(窗口 / 抽签日 / 比赛日 / 官网 / 距离) | 引擎 `SEED_ALL` | 赛历更新只改引擎,网页与邮件自动跟随 |
| **我的进度** `userStatus` | `data/marathon_watchlist.json` | 唯一以 JSON 为准的字段 |
| 自建赛事 | `data/marathon_watchlist.json` | 引擎里没有的赛事原样纳入 |
| 个人档案 | 同上(浏览器端在 `localStorage`) | 33 个字段 |

### 目录

```
marathon-platform/           ★ 产品,线上部署目录
  index.html                 应用外壳(看板/赛事库/我的关注/我的档案/提醒与导出)
  assets/engine.js           ★ 唯一状态机 + 60 场赛事种子(纯函数,零 DOM)
  assets/store.js            数据层 / 存储适配器 —— read()/write() 有 [SEAM] 标记
  assets/app.js              界面层
  assets/styles.css          样式 + 全部动画(路跑=青绿 --ac,越野=土黄 --amb)
  assets/motion.js           动效装饰(计时器/进度条/KPI 数字)—— 可整个删除,不影响功能
  assets/auth.js            本地身份层(P0):昵称/选填邮箱存 localStorage,不联网、不碰引擎
  assets/cloud.js           云端同步层(P1):真实云账号 + 单表 user_state + RLS,换设备同步关注/勾选/设置
  README.md                  详细设计与架构说明
tools/
  digest.js                  每日巡检:算状态 → Markdown / HTML 邮件 / 紧急清单
  notify.js                  巡检 + 推送(有紧急项才发信;需外部发信 CLI)
tests/regression.js          99 项断言,任意克隆可跑
data/
  marathon_watchlist.example.json   入库模板(无个人数据)
  marathon_watchlist.json           活的关注清单 —— 已 gitignore,含个人档案
docs/
  HANDOVER.md                本文
  WORKLOG.md                 工程记录
  OPERATIONS.md              日常运行:巡检调度 / 网站发布 / 数据维护
  MAIL_SETUP.md              邮件通道接入与故障排查
legacy/                      历史产物,见 legacy/README.md
scripts/check.sh             一键自检:语法 / 回归 / 巡检冒烟 / 隐私守卫
```

**依赖顺序固定:`engine.js → store.js → auth.js → app.js → motion.js`。五者都不需要构建步骤。**
`motion.js` 是**纯装饰层**:只做顶栏计时器、赛道进度条、KPI 数字冲刺,不读写存储、
不碰引擎。删掉它或让它加载失败,页面功能完全不受影响。
`auth.js` 是**本地身份层(P0)**:账号只存浏览器 `localStorage`,刷新保持、不发起任何网络请求、
不持有密钥;它镜像身份进 `store.account` 便于备份,但状态判断仍全部走 `engine.js`。

### 本机身份与云端同步(已落地 P0 + P1)

`assets/store.js` 的 `read()` / `write()` 打了 `[SEAM]` 标记 —— 这里是读写收口,也是接后端的唯一改动点。

**P0 本地身份层**(`assets/auth.js`):账号只存浏览器 `localStorage`(昵称 + 选填邮箱,绝不存证件号/手机号),
刷新保持、不发起任何网络请求。它镜像身份进 `store.account` 便于备份,但状态判断仍全部走 `engine.js`。

**P1 云端同步**(`assets/cloud.js`,本阶段已落地):真实云账号(手机/邮箱 OTP)+ 单表 `user_state` 同步,
换设备看到同一份关注 / 勾选 / 设置。**证件类字段(姓名/身份证号/手机号/紧急联系人)永不进云** —— 这是硬红线。

P1 的云上结构:

| 层 | 说明 |
|---|---|
| `assets/cloud.js` | UMD。持有 `PC = publicConfig`(`endpoint` / `oauthRelayBaseUrl` / `publishableKey`),`init()` 建 `cloud = W.createWorkBuddyCloud(...)`。**前端不硬编码 endpoint、不手写 `/.cloud/**` fetch** |
| `assets/engine.js` | 纯函数 `ME.mergeStates(local, cloud)` —— 首次登录是「合并」不是「覆盖」:`watching` 按 raceId 并集且冲突取 `updatedAt` 较新者、`checklists` 并集(true 优先)、`settings` 本地优先、`custom` 按 id 并集(本地优先) |
| `assets/store.js` | `toSyncBlob()` 只吐 `{watching,checklists,settings,custom,savedAt}`(**不含 profile/account**);`applySyncBlob(blob)` 写回这五样,profile/account 原样不动 |
| 云表 `user_state` | `id` / `owner_id TEXT NOT NULL DEFAULT auth.uid()` / `state_json JSONB` / `updated_at` / `created_at`;表级 RLS `owner_id = auth.uid()`,只授权 `authenticated`;`INSERT` 也不许带 `owner_id`,由服务端默认填 |

> 完整方案(登录方式排序、哪些字段不许上云、合并策略、分期 P0→P1→P2→P3)见
> [`docs/AUTH_DESIGN.md`](AUTH_DESIGN.md)。**P0 + P1 都已落地**(本地身份 + 云端同步),
> 数据部分上云、证件类字段仍留本机。

⚠️ **网站与小程序是两个独立应用 → 两个独立云环境,数据默认不共享。**
小程序是另一套代码(WXML/WXSS/JS + `app.json`),**不能**从 HTML/DOM 转换或重组。

---

## 4. 状态机(15 态)

`computeStatus(race, now)` 返回 `{ key, label, cls, urg, cd, cdLabel, cdDate, note }`。

| key | 标签 | 危急度 | 含义 |
|---|---|---|---|
| `pay` | 待缴费 | 🔴 最高 | **已中签 · 缴费截止 ≤ 3 天** —— 过期名额立即释放,不可恢复 |
| `drawdone` | 结果已公布·待确认 | 🟠 高 | 结果已出但状态仍是「关注中」(7 天内)—— 你可能压根不知道结果出了 |
| `closing` | 即将截止 | 🟠 高 | 报名截止 ≤ 3 天 |
| `soon` | 即将开放 | 🔵 中 | 开放 ≤ 7 天,该备材料了 |
| `open` | 报名中 | 🟢 | 窗口开放中,已知截止日 |
| `opendeadline` | 报名中·未设截止日 | 🟢 | 已开放但官方未公布截止日 —— **售罄即止** |
| `waitdraw` | 待抽签 | 🟣 | 已提交,等公布 |
| `pending` | 已报名·待结果 | 🟣 | 同上(窗口已过) |
| `notopen` | 未开放 | ⚪ | 开放日未到 |
| `racing` | 已锁定·待比赛 | 🟢 | 名额已稳,等比赛 |
| `unknown` | 窗口待公布 / 窗口未记录 | ⚪ | 没有窗口数据(**越野赛常态,不是数据缺失**) |
| `closed` | 已截止 / 未中签 | ⚪ | 窗口已关 |
| `lost` | 已逾期·名额释放 | ⚪ | 错过缴费 |
| `done` | 已完赛 | ⚪ | |
| `skipped` | 已放弃 | ⚪ | |

> `unknown` 与 `closed` 各有两种标签,按上下文取。

### 「紧急」的定义(改过一次,务必理解)

**紧急 = 有明确时间窗的四类:`pay` / `drawdone` / `soon` / `closing`。**

刻意**不包含** `opendeadline`。原因:越野赛和国内先到先得赛事常年在开放状态
(某场已开放数月),若计入紧急,**每天都会为同一场报警**,反而把真正的截止日淹没。
它仍照常出现在摘要、邮件正文与窗口概览里,只是不单独触发发信。

> 早期版本把 `drawdone` 漏了 —— 结果公布后状态走完窗口变成「已截止」,
> 系统于是显示「已截止」,**把最关键的警报藏在了最平静的标签后面**。已修。

### 赛制

`MODE_LABEL`:`lottery` 抽签制 · `fcfs` 先到先得 · `qualify` 成绩达标制 ·
`invite` 邀请制 · `stones` 跑石抽签

---

## 5. 越野赛与路跑的三处本质差异

引擎里**按 `kind` 分支**,不是加个标签了事。

| 维度 | 马拉松 / 路跑 | 越野赛 |
|---|---|---|
| **赛制** | 抽签 / 先到先得 / 成绩达标 | ITRA 表现分门槛 / **跑石 + UTMB 指数双门槛** / 资格赛制 / 黄金门票 |
| **资格** | 24 个月内的全马或半马成绩 | **同类距离的山地完赛记录**(路跑成绩通常不被接受) |
| **材料** | 体检报告、完赛证明 | 追加**强制装备**(头灯+备用电池 / 救生毯 / 冲锋衣 / 哨子 / 水袋 / 备用口粮 / 急救绷带)、夜间行进、换装包 |

- `MODE_LABEL` 有 `stones:"跑石抽签"`
- `buildChecklist()` 按 `race.kind === "trail"` 分支,UTMB 总决赛走「跑石」、世界系列赛走「UTMB 指数」
- `profileWarnings()` 按类分支;`maxDistKm()` 解析 `dist` 文本比对档案里的最长越野完赛
- 档案额外有 4 个字段:`trailMax` / `trailMaxRace` / `trailMaxDate` / `itra`

**已核实的真实门槛:**

- 柴古唐斯括苍:105K ≥ 410 / 50K ≥ 360 / 25K ≥ 260 分
- 熊猫蜀道山:160K ≥ 500 / 105K ≥ 400 / 60K ≥ 350 / 25K ≥ 249 分
- 崇礼 168:不设 ITRA 分,按距离阶梯要完赛证书

> ⚠️ **60 场里 31 场是「窗口未记录 / 待公布」—— 这是越野赛的常态节奏,不是数据缺失。**
> 越野赛的报名窗口公布普遍比路跑晚得多。看到一片 ⚪ 不要以为哪里坏了。

### 分类显示

分类**贯穿全站**,不只是一个筛选器:

- 赛事库:类型切换条;选「全部」时**真的分成两个区块**,每区带一句话差异说明
- 我的关注:同一套切换条 + 分组标题显示两类占比
- 看板:类别速览(两类各关注几场、其中几场在窗口里)
- 邮件:每行 `[越]` 前缀 + 分类统计

**分类判定只走引擎的 `kindOf()`,界面一行硬编码都没有。** 以后要加 Skyrunning、
山径徒步,只需在引擎里加一个 `kind`,界面自动多出一个分区。

### 界面风格(「跑道 / 田径」动感风)

主题是跑步:深色沥青顶栏(扫光 + 滚动分道虚线)、橙色分道线 `--run`、号码布式徽标、
等宽表格数字的计时器字体、Hero 里循环跑过的跑者剪影、未来 60 天的滚动播报条、
卡片入场错位 + 悬停速度残影。**动画全部是纯 CSS 关键帧**,不引入任何前端库。

改视觉时遵守两条:

1. **只改 `assets/styles.css`,不要动类名。** 回归测试按类名计数(见 §11 红线 7)。
2. **新增装饰元素要避开会被计数的前缀** —— `kt` / `k-tag` / `kd` / `kpi` / `race ` / `lib-card`。
   播报条条目因此定名 `.tbi`。

`@media (prefers-reduced-motion:reduce)` 里把动画与过渡一次性关掉 ——
用户系统开了「减少动态效果」就必须全站静止,这是硬要求。渐变字用了
`background-clip:text` + `color:transparent`,外面套了 `@supports` 并留纯色兜底,
否则旧内核下整段标题会消失。

---

## 6. 已知脆弱点

| 位置 | 风险 | 缓解 |
|---|---|---|
| `tests/regression.js` 的夹具抽取 | 靠**行号切片**(`sl(10,33)`)从 `legacy/marathon_registrar.html` 抽旧状态机。若有人重排该 HTML 格式,切片错位 → **拿坏数据比对,得出「零漂移」的假绿** | 已加夹具守卫:必须抽出 24 场且 `computeStatus` 可用,否则退出码 3 终止。**改动该文件后务必重跑测试** |
| 赛事日期 | 大量日期是**按往年推算**(`confidence: "projected"`),不是官方公告 | UI 全程显示可信度标签;对外一律声明「以官方公告为准」 |
| `data/marathon_watchlist.json` | 含个人档案(姓名 / 身份证号 / 手机号) | **已 gitignore**。入库的只有 `.example.json` 模板。见下节 |
| 本机 Git 凭据 | 无凭据助手,`git push` 每次都要 token | 见 §8 |
| 邮件链路 | 依赖外部 CLI(默认 `agently-cli`)的**授权有效期**;过期后 `notify.js` 会退出码 `11` | 提示里直接给了重新授权命令;接入方式与排查表见 `docs/MAIL_SETUP.md` |
| 无头浏览器截图 | 本沙箱**不可用**(见 WORKLOG §13) | 验证 UI 一律用 DOM 存根回归 |
| 界面视觉 | 回归测试**按类名计数**,改类名会让一批断言同时变红 | 视觉改动只落在 `styles.css`;见 §11 红线 7 |

---

## 7. 隐私设计(别破坏它)

```
data/marathon_watchlist.example.json   ← 入库。33 个档案字段全空(+1 个 `_说明` 注释键),无个人数据
data/marathon_watchlist.json           ← gitignore。活的,含个人档案
```

`.gitignore` 还排除:`.workbuddy/`(工作区记忆)、`reports/`(每日摘要含关注清单快照)、
`AGENT_MAIL_SETUP.md`(含个人邮箱地址)、`.wbapp_*.genie`。

`tools/digest.js` 三级回退:

1. 活的 `marathon_watchlist.json` → 静默使用
2. 只有模板 → 告警 + 退出码 0(新克隆开箱能跑)
3. 都没有 → 明确指引 + 退出码 4

**加新文件前先问:这里会不会出现姓名、证件号、手机号、邮箱?** 会 → 加进 `.gitignore`。

### 提交前自查

```bash
git status --short                        # 看有没有意外文件
git diff --cached | grep -nE "ghp_|@|身份证"   # 粗筛 token / 邮箱
```

### 云端同步的隐私边界

即使开启了 P1 云端同步,**涉证件字段也只留本机**:

- `toSyncBlob()` 的产出只有 `watching` / `checklists` / `settings` / `custom` / `savedAt` 五样,
  不含 `profile`(姓名/身份证号/手机号/紧急联系人)与 `account`(昵称镜像)
- 云表 `user_state.state_json` 里因此**永远不会有证件号/手机号**
- 合并写回 `applySyncBlob()` 只动这五样,绝不回写 profile
- 回归测试(`tests/regression.js`)有断言守护「blob 不含 profile/account」「applySyncBlob 不写 profile」

---

## 8. 推送代码

如果你克隆后 `git push` 提示要凭据,用下面任一条路解决(**本项目不在仓库里存任何凭据**):

```bash
git add -A && git commit -m "..." && git push     # 没有凭据助手时会询问
```

- **用 token**:GitHub → Settings → Developer settings → Personal access tokens →
  **Tokens (classic)** → 勾 `repo`。用完立刻吊销
- **用 `gh` CLI**:`gh auth login` 一次,之后 `git push` 走同一套凭据
- **SSH**:改用 `git@github.com:xinster/marathonforall.git`,配好 key 即可

> 坑:若首次 push 报 `CONNECT tunnel failed, response 502` —— 那是**出网代理隧道偶发失败**,
> **原样重试一次即可**。不是凭据问题,不要重配 proxy,也不要改用 API 兜底。

---

## 9. 待办与开放问题

### 待办

- [x] **`LICENSE` 已定:保留所有权利(非开源)** —— 见仓库根 `LICENSE`。
      将来若要开源,只需替换该文件并删掉 README「许可」一节中的限制说明
- [x] **一键自检已加** —— `sh scripts/check.sh`:语法 + 99 项断言 + 巡检冒烟 + 隐私守卫
- [ ] **(可选)接 GitHub Actions** —— 想让 push 时自动跑同批检查的话,
      需要带 `workflow` 权限的令牌(只有 `repo` 会被 GitHub 拒收)。
      脚本 `scripts/check.sh` 已经就绪,套一层 workflow 即可
- [ ] 微信小程序:需要 AppID 与资质,且必须**新建小程序应用重新构建**(不能从 HTML 转换)
- [x] **P1 云端同步已落地**:真实云账号 + 单表 `user_state` + RLS,换设备同步关注/勾选/设置;证件类字段仍留本机(见 §3)
- [ ] 接后端(多表拆分 P2):把单表拆成 `watchlist`/`checklists`/`profiles` 等多表,巡检迁服务端才能「不开机也收邮件」;注意网站与小程序是两个独立云环境
- [ ] `tests/regression.js` 的防漂移基线:理想做法是把当前基线**冻结成 JSON 快照**,
      之后就能删掉 `legacy/marathon_registrar.html`(现在它既是历史又是夹具,角色混着)
- [ ] 赛事数据目前**手工维护**在 `engine.js` 的 `SEED_*` 里。若赛历规模再涨,
      值得考虑外置成 JSON 数据文件 + 校验脚本

### 开放问题

1. **多用户(P1 已部分回答):** 已通过云端账号实现跨设备同步(每人各自隔离,互不可见)。
   剩下的是「微信扫码 / 跑团共享」等更强社交能力,按需再上。
2. **越野赛收录要不要继续扩?** 现在 36 场。继续扩的边际价值在于长尾赛事,
   但维护成本(核实门槛 / 窗口)是非线性的。
3. **`reports/` 要不要留档?** 现在每天重新生成且被 gitignore。如果需要历史追溯,
   得另设归档机制。

---

## 10. 交接检查清单

接手后跑一遍,全绿就算环境没问题:

```bash
node tests/regression.js                      # 期望:99 通过 / 0 失败
node tools/digest.js                          # 期望:退出码 0,reports/ 下三个文件
node tools/digest.js --date 2026-10-07T17:30  # 指定日期+时刻,便于复现
cp data/marathon_watchlist.example.json data/marathon_watchlist.json   # 首次才需要
```

> ⚠️ **`--date` 的语义**:只写日期(如 `--date 2026-10-07`)时**固定按当天 09:00 计算**;
> 不带 `--date` 则用**真实当前时间**。同一天若有小时级事件(如「14:00 公布抽签」),
> 两者结果会不同。要复现线上行为,**带上时刻**。
>
> 另外:**摘要内容随日期变化**,不要拿某一天的紧急项条数当作验收标准 ——
> 只要退出码为 0、三个文件都生成,管线就是通的。

| 检查项 | 期望 |
|---|---|
| `node tests/regression.js` | `99 通过 / 0 失败` |
| `tools/digest.js` 退出码 | `0` |
| 两个数据文件都缺失时 | 退出码 `4` + 明确指引 |
| 只有模板时(新克隆的默认状态) | 退出码 `0` + 一条告警 |
| `notify.js` 找不到发信 CLI | 退出码 `10` + 指引;此时用 `digest.js` 一样能拿结论 |
| `notify.js` 授权失效 | 退出码 `11` + 提示重新授权 |
| `git status` | 干净(或只有预期的改动) |
| `git ls-files` 不含 | `.workbuddy/` · `reports/` · `AGENT_MAIL_SETUP.md` · 活的 watchlist |
| 线上站点 | 200,且 `#kindTabs` / `#mineKind` / `#kindBar` 齐备;`assets/motion.js` 亦为 200 |

`sh scripts/check.sh` 会把上面这几项一次跑完(语法 / 回归 / 巡检冒烟 / 隐私守卫),
全绿则退出码 0。**改动代码后跑它就够了。**

---

## 11. 改代码时的红线

1. **不要把状态判断写第二遍** —— 一切走 `engine.js`
2. **改 `legacy/marathon_registrar.html` 后必须重跑测试** —— 它是防漂移基线
3. **不要提交含个人数据的文件** —— 先看 §7
4. **不要把「未设截止日」加回「紧急」集合** —— 会导致天天报警
5. **不要假设越野赛有报名窗口** —— 31/60 场处于「待公布」是正常的
6. **零依赖是特性,不是疏忽** —— 不引入测试框架、打包器、前端库
7. **改界面只改 CSS,类名一个都不要动** —— 回归测试 C 段按类名计数
   (`class="kpi` 8 / `class="lib-card` 60 / `class="kt` 3 / `class="kind-sec` 2,
   另有 `ks-desc` / `k-tag` / `lc-dist` / `kd"` / `field"`)。改名会让一批断言同时变红。
   `app.js` 只做**纯增量**(加元素、加属性),既有类名与 DOM 结构保持原样。
8. **动效必须能整个关掉** —— 新增动画一律纯 CSS,并在文件末尾那条
   `@media (prefers-reduced-motion:reduce)` 里被统一关停;装饰性脚本放 `motion.js`,
   保持「删掉它页面照常工作」。
9. **云端同步只放安全子集,证件类字段永不进云** —— `toSyncBlob()` 只吐
   `watching` / `checklists` / `settings` / `custom` / `savedAt`,绝不带 `profile` / `account`;
   `applySyncBlob()` 只写回这五样。改云同步逻辑时,这条不可破;`tests/regression.js` 有断言守门。
   网络层只有 `assets/cloud.js` 一个出口,**不要另起 fetch 通道**(端点、密钥一律走 `publicConfig`)。
10. **本机加密备份(A 路线)可外带证件字段,但密钥只由口令派生** —— `assets/crypto.js`
   用 `PBKDF2(SHA-256, 25 万轮) + AES-GCM-256`,口令永不离开本机,密文文件落 U 盘 / 换机都安全;
   `file://` 下 Web Crypto 不可用,此时**禁用加密按钮并提示改用 https / localhost**。`tests/crypto.test.js`
   守卫「密文不含明文 / 错误口令失败」。档案仍**只留本机**,云端 `user_state` 不含证件字段(红线 9)不变。
   ⚠️ 若将来要做 B 路线(加密同步上云),红线 9 需改写为「证件上云必须是客户端加密密文」,且 `ME`/`store`
   的 blob 结构要随之调整,回归断言要补「上云的是密文不是明文」。
