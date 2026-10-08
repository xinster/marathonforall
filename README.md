# 赛事跟踪台 · 马拉松 / 越野赛报名窗口跟踪与提醒

关注你想跑的赛事,系统持续盯着它的**报名开放 / 报名截止 / 抽签公布 / 缴费截止**,
在真正需要你行动的那一刻把你叫起来。

覆盖 **24 场马拉松 / 路跑 + 36 场全球越野赛,共 60 场**(2026–2027 赛季),
两类赛事在赛事库、我的关注、看板与每日邮件里**全程分类展示**。

---

## 这个项目真正解决的问题

自动报名在技术与合规上都不成立 —— 实名核验、验证码风控、以及**抽签制下报名先后完全不影响中签率**。
真正的痛点不是"没抢到报名",而是**中签后忘记缴费**:中签名额的缴费期通常只有 3–7 天,
逾期立即释放且不可恢复。绝大多数流掉的名额死于这条死线。

所以这里不做"代报名",只做**指挥中心**:替你把窗口盯住,把该做的那件事在最该做的时间点推到你面前。

---

## 目录结构

```
.
├── marathon-platform/            ★ 跟踪台网站(零构建,直接开 index.html)
│   ├── index.html                应用外壳(看板 / 赛事库 / 我的关注 / 我的档案 / 提醒与导出)
│   ├── assets/
│   │   ├── engine.js             ★ 唯一状态引擎 + 赛事种子数据(纯函数,零 DOM)
│   │   ├── store.js              数据层 / 存储适配器(接后端只有一个改动点)
│   │   ├── app.js                界面层
│   │   ├── styles.css            样式 + 全部 CSS 动画(跑道 / 田径主题)
│   │   ├── auth.js               本地身份层(昵称/邮箱存 localStorage,不联网)
│   │   ├── cloud.js              云端同步层(P1):真实云账号 + 单表 blob,换设备同步关注/勾选/设置
│   │   └── motion.js             动效装饰(计时器 / 进度条 / KPI 数字),可整个删除
│   └── README.md                 详细设计与架构说明
├── tools/
│   ├── digest.js                 每日巡检:算窗口状态 → 生成 Markdown / HTML 邮件 / 紧急清单
│   └── notify.js                 巡检 + 推送(有紧急项才发信)
├── tests/
│   └── regression.js             96 项断言,任意克隆可直接跑
├── data/
│   ├── marathon_watchlist.example.json  入库模板(不含个人数据)
│   └── marathon_watchlist.json          你的关注清单 —— 已 gitignore,自行创建
├── docs/
│   ├── HANDOVER.md               交接必读:架构、状态机、已知脆弱点、改代码红线
│   ├── WORKLOG.md                工程记录:每个阶段的决策、踩的坑、怎么验证的
│   ├── MAIL_SETUP.md             邮件通道怎么接、坏了怎么排查
│   ├── AUTH_DESIGN.md            账号体系 / 用户登录设计方案(P0 本地身份 + P1 云端同步已实现)
│   └── OPERATIONS.md             每日巡检怎么长期跑、网站怎么发布、数据怎么改
├── legacy/                       历史产物(其中一个被测试当作基线,勿删,见 legacy/README.md)
├── scripts/check.sh              一键自检:语法 / 回归 / 巡检冒烟 / 隐私守卫(零权限要求)
├── LICENSE                       保留所有权利(公开可见,但非开源)
└── README.md
```

依赖顺序固定:`engine.js → store.js → app.js`。三者都不需要构建步骤。

---

## 跑起来

```bash
# 1. 首次:创建你自己的关注清单(模板不含个人数据)
cp data/marathon_watchlist.example.json data/marathon_watchlist.json

# 2. 网站:直接打开,或用任意静态服务器
open marathon-platform/index.html
python3 -m http.server 8000 --directory marathon-platform

# 3. 每日巡检(生成摘要,不发信)
node tools/digest.js

# 4. 巡检 + 推送(无紧急事项时按策略不发信)
node tools/notify.js
node tools/notify.js --dry-run     # 只打印,不真发
node tools/notify.js --force       # 无紧急事项也发

# 5. 测试(零依赖,期望 "96 通过 / 0 失败")
node tests/regression.js

# 6. 一键自检(语法 + 回归 + 巡检冒烟 + 隐私守卫,四合一)
sh scripts/check.sh
```

> **第 4 步需要先接一条邮件通道** —— 本项目零依赖,不内置 SMTP 客户端,发信交给外部 CLI。
> 没有通道时用第 3 步即可拿到全部结论(摘要同样写到 `reports/`)。
> 接入方法见 [`docs/MAIL_SETUP.md`](docs/MAIL_SETUP.md)。
>
> 想让巡检每天自动跑,见 [`docs/OPERATIONS.md`](docs/OPERATIONS.md)。

---

## 唯一的架构不变量:状态判断只写一遍

`marathon-platform/assets/engine.js` 是**唯一一份**状态判断逻辑与赛事目录,
被网站、`tools/digest.js`、`tools/notify.js`(以及将来的小程序)共用。

理由很实际:**状态判断写两遍必然漂移**,会出现"网页说待缴费、提醒邮件说已截止"这种最要命的错误。
共用一份文件,从结构上就不可能漂移。

- 赛事**事实字段**(报名窗口 / 抽签日 / 缴费截止 / 比赛日 / 官网 / 组别距离)一律取自引擎的 `SEED_ALL`
- `data/marathon_watchlist.json` **只承载"我的进度"**(`userStatus`)与个人档案
- 赛历更新只改引擎,网页与邮件自动跟随

---

## 越野赛与路跑不是同一件事

| 维度 | 马拉松 / 路跑 | 越野赛 |
|---|---|---|
| **赛制** | 抽签 / 先到先得 / 成绩达标 | ITRA 表现分门槛 / 跑石(Running Stones)+ UTMB 指数双门槛 / 资格赛制 |
| **资格** | 24 个月内的全马或半马成绩 | **同类距离的山地完赛记录**(路跑成绩通常不被接受) |
| **材料** | 体检报告、完赛证明 | 追加**强制装备**(头灯+备用电池 / 救生毯 / 冲锋衣 / 哨子 / 水袋 / 备用口粮 / 急救绷带)、夜间行进、换装包 |

越野赛的报名窗口公布得普遍比路跑晚,60 场里有 31 场处于"窗口未记录 / 待公布"——
**这是越野赛的常态节奏,不是数据缺失。**

---

## 数据可信度

赛事日期都带可信度标签:**官方公告 / 媒体多源 / 按往年推算 / 手动录入 / 待公布**。

**最终一律以组委会官方公告为准。** 系统只负责让你不错过,不负责替你确认日期。

---

## 隐私

仓库**不包含**个人档案数据、每日巡检输出与邮箱配置(见 `.gitignore`)。

```
data/marathon_watchlist.example.json   ← 入库的模板,33 个档案字段全为空
data/marathon_watchlist.json           ← 你的实际文件,已被 gitignore 排除
```

> 模板的 `profile` 下有 34 个键 = **33 个档案字段** + 1 个 `_说明` 注释键。

档案里有姓名 / 身份证号 / 手机号这类字段,所以**活的文件刻意不入库** ——
这样即使哪天你填了真值,`git push` 也不可能把它带上去。
网站端的档案只存浏览器 `localStorage`,不上传。

> 开启云端同步后(见 [`docs/AUTH_DESIGN.md`](docs/AUTH_DESIGN.md) 的 P1),
> **也只有关注清单 / 材料勾选 / 偏好设置 / 自建赛事会上云**;`profile` 里的
> 姓名 / 身份证号 / 手机号 / 紧急联系人**永远只留本机**,云表结构里根本没有这些字段。

---

## 工程记录与交接

- [`docs/HANDOVER.md`](docs/HANDOVER.md) —— **接手先看这份**:架构不变量、15 态状态机、已知脆弱点、改代码的红线
- [`docs/WORKLOG.md`](docs/WORKLOG.md) —— 怎么走到今天的:每个阶段的决策依据、踩过的坑、怎么验证的
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) —— 巡检怎么长期跑、网站怎么发布、赛历数据怎么改
- [`docs/MAIL_SETUP.md`](docs/MAIL_SETUP.md) —— 邮件通道接入与故障排查
- [`docs/AUTH_DESIGN.md`](docs/AUTH_DESIGN.md) —— 用户登录 / 账号体系设计方案(P0 本地身份 + P1 云端同步已落地)
- [`legacy/README.md`](legacy/README.md) —— 历史产物的角色说明(其中一个被测试当作基线,**勿删**)

## 许可

**保留所有权利,非开源。** 仓库公开可见,但未授予任何使用、修改或分发许可 ——
详见 [`LICENSE`](LICENSE)。如需授权请另行联系。

