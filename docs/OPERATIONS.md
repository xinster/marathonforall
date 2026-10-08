# 日常运行 · OPERATIONS

> 网站是零构建静态页,不需要运维。**需要长期运行的是「每日巡检」这一条命令**。
> 本文说明它怎么跑、产出什么、怎么搬到别的机器上、以及网站怎么发布。

---

## 1. 唯一需要长期运行的东西

```bash
node tools/notify.js
```

就这一条。它内部串起:算状态 → 写摘要 → 判断有没有紧急项 → 有则发信。

| 项 | 值 |
|---|---|
| 频率 | **每天 09:00**(本地时区) |
| 产出 | `reports/marathon_digest_YYYY-MM-DD.md`、`.email.html`、`urgent_YYYY-MM-DD.json` |
| 发信策略 | **只有存在「紧急事项」时才发**;没有则只落盘,保持安静 |
| 失败处理 | 报错即停,**单次运行只尝试一次**,不重试、不循环 |

### 为什么定在 09:00

早上一次就够 —— 报名窗口、抽签日、缴费截止都是以**天**为粒度的,没有分钟级的抢购场景。
一天多跑几次不会让提醒更准,只会增加噪音。

### 为什么没有紧急事项就不发信

**紧急 = 有明确时间窗的四类**:`待缴费` / `结果已公布·待确认` / `即将截止` / `即将开放`。

`opendeadline`(报名中·未设截止日)刻意排除在外 —— 它可能挂几个月,
计入紧急会导致**天天为同一场报警**,真正的截止日反而被淹没。详见 `docs/HANDOVER.md` §4。

---

## 2. 搬到别的机器上跑

本项目**零依赖**,只要该机器有 Node(建议 ≥ 18)即可,不需要 `npm install`。

### cron(macOS / Linux)

```bash
# 编辑 crontab
crontab -e

# 每天 09:00 跑一次,日志留在本地
0 9 * * * cd /path/to/marathon-tracker && /usr/bin/env node tools/notify.js >> ~/marathon-tracker.log 2>&1
```

> ⚠️ cron 的环境变量很干净,`PATH` 可能找不到 `node`、也读不到你的 `DIGEST_TO`。
> 稳妥做法是在命令前显式带上,或把变量写进同一个脚本里。

### macOS launchd

需要「错过时间后开机补跑」时用 launchd(见 `man launchd.plist`),配置比 cron 长,
但 `StartCalendarInterval` 支持机器休眠后补跑。

### GitHub Actions(本项目刻意没接)

想用 Actions 定时跑巡检、或每次 push 自动跑测试,都可以,但本项目没接,理由是:

- 在 `.github/workflows/` 下**创建文件需要带 `workflow` 权限的令牌**。
  只有 `repo` 权限的令牌会被 GitHub 直接拒收:
  `refusing to allow a Personal Access Token to create or update workflow`
- 若还要让 Actions 自动**发信**,就得把发信凭据放进仓库 Secrets ——
  对一个只做个人提醒的项目,这个代价不划算

替代方案是本地自检脚本,用的是同一批断言,但零权限要求、谁都能跑:

```bash
sh scripts/check.sh     # 语法 + 104 项回归 + 巡检冒烟 + 隐私守卫
```

好处是**在本地就把问题拦下来**,不用等 push 之后才发现。
将来要接 Actions,套一层 workflow 调这个脚本即可。

---

## 3. 网站怎么发布

`marathon-platform/` 是**零构建静态目录**,任何静态托管都能放。

```bash
# 本地看
open marathon-platform/index.html
# 或
python3 -m http.server 8000 --directory marathon-platform
```

### 当前线上

| 项 | 值 |
|---|---|
| 地址 | https://marathon-tracker.app.workbuddy.host/ |
| 形态 | 静态站,**无后端、无数据库** |
| 发布方式 | 由 WorkBuddy 的应用发布能力上传整个 `marathon-platform/` 目录 |
| 发布句柄 | `.wbapp_*.genie`(已在 `.gitignore` 中,**不入库**) |

### 换到别的托管

因为是纯静态,直接把 `marathon-platform/` 目录内容丢上去即可:

- **GitHub Pages**:把 `marathon-platform/` 作为发布目录(注意仓库根不是它)
- **Vercel / Netlify / Cloudflare Pages**:项目根设为 `marathon-platform`,`build` 留空,输出目录填 `.`
- **自建 Nginx**:把目录丢进 webroot,`index.html` 即入口

**唯一约束:入口必须是 `marathon-platform/index.html`**,且 `assets/` 与它同级
(页面用**相对路径**引用 `assets/engine.js` 等,放哪儿都能跑,不要改成绝对路径)。

### 发布后自查

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<你的域名>/
curl -s https://<你的域名>/ | grep -oE 'id="kindTabs"|id="mineKind"|id="kindBar"'
```

三个 id 齐备 = 新版页面已生效(它们是分类显示功能的挂载点)。

---

## 4. 数据放在哪、怎么改

**赛历只改一个地方:`marathon-platform/assets/engine.js` 里的 `SEED_RACES` / `SEED_TRAIL`。**

改完不需要同步别处 —— 网站与每日邮件都直接读它。这是本项目的核心不变量,
**不要另建一份数据源**(理由见 `docs/HANDOVER.md` §3)。

| 想改什么 | 改哪 |
|---|---|
| 新增/修改赛事、报名窗口、抽签日、官网 | `engine.js` 的 `SEED_*` |
| 可信度标注 | 同条目的 `confidence`: `official` / `reported` / `projected` / `manual` / `unknown` |
| 我的进度(关注中/已报名/已中签…) | `data/marathon_watchlist.json` 的 `userStatus`(本地文件,不入库) |
| 界面文案与分区 | `marathon-platform/assets/app.js`;类型判定一律走引擎的 `kindOf()` |

改完**务必跑一遍**:

```bash
node tests/regression.js
```

---

## 5. 日常自检清单

```bash
sh scripts/check.sh            # 一键跑完下面四项,全绿退出码 0
node tests/regression.js       # 期望:104 通过 / 0 失败
node tools/digest.js           # 期望:退出码 0,reports/ 下三个文件
git status --short             # 期望:干净,或只有你预期的改动
```

| 症状 | 先看 |
|---|---|
| 没收到邮件 | `docs/MAIL_SETUP.md` §6 故障排查表 |
| 摘要里某场赛事状态不对 | `engine.js` 里该场的日期字段是否已更新为官方公告 |
| 测试失败 | 是不是改了 `legacy/marathon_registrar.html`?它是防漂移基线,见 `docs/HANDOVER.md` §6 |
| 一片 ⚪(窗口未记录) | **正常**。越野赛窗口公布普遍很晚,约半数赛事处于此状态 |
