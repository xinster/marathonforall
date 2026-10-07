# 邮件通道接入 · MAIL_SETUP

> `tools/notify.js` 会把每日摘要**发到你的邮箱**。发信这一步需要你自己接一条通道。
> 本文说明它需要什么、怎么配、坏了怎么查。
>
> ⚠️ **本文件刻意不含任何真实邮箱地址**,可安全入库。
> 个人邮箱只写在本地文件里(见 §5)。

---

## 1. 分工:谁负责什么

```
tools/digest.js    ← 纯本地。算状态、写 reports/ 下三个文件。零依赖,不需要任何凭据。
      │
      ▼  reports/marathon_digest_YYYY-MM-DD.email.html   (自包含的 HTML 邮件正文)
      │  reports/urgent_YYYY-MM-DD.json                  (机器可读的紧急清单)
      ▼
tools/notify.js    ← 只做两件事:解析收件人 + 调外部 CLI 发信。
```

**关键点:`notify.js` 不内置 SMTP 客户端。** 这是刻意的 ——

- 发信凭据不该出现在代码里
- 你很可能已经有自己的邮件通道(企业邮箱、SMTP、内部通知服务)
- HTML 正文是**自包含文件**,你可以完全绕过 `notify.js`,用任何工具把它发出去

**如果你不想用本文的 CLI**:直接读 `reports/*.email.html`,自己投递即可。
`notify.js` 是便利封装,不是必需品。

---

## 2. `notify.js` 要求的 CLI 契约

只要一个命令行工具满足下面三条,就能替换:

| # | 用途 | 调用形式 | 期望输出 |
|---|---|---|---|
| 1 | 查当前账号 | `<CLI> +me` | JSON:`{"ok":true,"data":{"aliases":[{"email":"...","is_primary":true}]}}` |
| 2 | 发一封信 | `<CLI> message +send --to <邮箱> --subject <主题> --body-file <html> --body-format html --confirmed` | JSON:`{"ok":true}` |
| 3 | (可选)二次确认 | 上面返回 `confirmation_token` 时,追加 `--confirmation-token <tok>` 重发 | 同上 |

`--dry-run` 会透传给 CLI(只演练不投递)。

### 默认使用的 CLI

参考实现是 **`agently-cli`**(Agent Mail):

```bash
agently-cli auth login        # 交互式授权,令牌存进系统钥匙串
agently-cli +me               # 验证授权是否有效
```

装法(任选):

```bash
npm install -g @tencent-qqmail/agently-cli
# 或装到任意位置后用 AGENTLY_CLI 指定
```

> 授权令牌存在**系统钥匙串**里,不在本仓库、也不在环境变量里。

---

## 3. 配置项

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `AGENTLY_CLI` | 指定 CLI 可执行文件的绝对路径 | 自动查找(见下) |
| `DIGEST_TO` | 收件人邮箱 | 取 `<CLI> +me` 的主别名 |
| `AGENTLY_CLI` 未设时的查找顺序 | ① `AGENTLY_CLI` ② `$HOME/.workbuddy/binaries/node/workspace/node_modules/.bin/` ③ `$HOME/.local/bin/` ④ `/usr/local/bin/` ⑤ `/opt/homebrew/bin/` ⑥ `PATH`(`which`) | — |

**建议显式指定收件人**,省掉一次网络调用:

```bash
DIGEST_TO=you@example.com node tools/notify.js
```

不想每次敲,写进自己的 shell 配置即可(注意这个文件别提交)。

---

## 4. 用法

```bash
node tools/notify.js                # 有紧急事项才发信
node tools/notify.js --dry-run      # 只演练,不真投递
node tools/notify.js --force        # 没有紧急事项也发
node tools/notify.js --date 2026-12-01         # 指定日期跑
node tools/notify.js --date 2026-12-01T17:30   # 连时刻一起指定(见下)
```

### ⚠️ `--date` 的时刻陷阱(踩过)

`--date 2026-12-01` 不带时刻时,**固定按当天 09:00 计算**;而每日自动化跑的时候用的是**真实当前时间**。

同一天里存在**小时级事件**(例如「今天 14:00 公布抽签结果」)时,两者会给出**不同结果**:

```bash
node tools/digest.js                       # 17:30 跑 → 抽签已过 → 「结果已公布·待确认」
node tools/digest.js --date 2026-12-01     # 按 09:00 算 → 抽签未到 → 「待抽签」
```

**要复现线上行为,请带上时刻**:`--date 2026-12-01T17:30`。

这不是 bug,是 `--date` 的语义(`tools/digest.js` 第 50 行)。但不知道这点会以为系统算错了。

---

## 5. 个人邮箱放哪

**不要写进仓库。** 放在本地:

```bash
# 方式一:临时
DIGEST_TO=you@example.com node tools/notify.js

# 方式二:写进不提交的本地文件
echo 'export DIGEST_TO=you@example.com' >> ~/.zshrc
```

`.gitignore` 已排除的敏感文件(见仓库根 `.gitignore`):

- `AGENT_MAIL_SETUP.md` —— 授权过程的完整记录(**含个人邮箱,勿入库**)
- `data/marathon_watchlist.json` —— 含个人档案
- `reports/` —— 每日摘要,含关注清单快照

**新增文件前先问:会不会出现姓名、证件号、手机号、邮箱?** 会 → 加进 `.gitignore`。

---

## 6. 故障排查

| 现象 / 退出码 | 原因 | 处理 |
|---|---|---|
| `找不到发信 CLI`(退出码 **10**) | 没装,或不在查找路径里 | `AGENTLY_CLI=/绝对路径/agently-cli node tools/notify.js`,或装进 `PATH`;只想出摘要就跑 `node tools/digest.js` |
| `发信通道授权失效(invalid_grant)`(退出码 **11**) | 令牌过期或被吊销 | `agently-cli auth login` 重新授权;或临时 `DIGEST_TO=... ` 绕过解析 |
| `无法确定收件地址`(退出码 **13**) | CLI 通,但 `+me` 没返回别名 | 显式指定 `DIGEST_TO=you@example.com` |
| `今日无紧急事项,按策略不发信`(退出码 **0**) | **这是正常行为,不是故障** | 想强制发就加 `--force` |
| 邮件发出但内容为空 | 摘要没生成 | 先单独跑一次 `node tools/digest.js` 看有没有报错 |
| `CONNECT tunnel failed, response 502` | 代理隧道偶发失败 | 原样重试一次。不是凭据问题 |

### 为什么「无紧急事项不发信」是设计而不是缺陷

**紧急 = 有明确时间窗的四类**:`待缴费` / `结果已公布·待确认` / `即将截止` / `即将开放`。

`报名中·未设截止日`(`opendeadline`)**刻意不计入紧急** —— 越野赛和国内先到先得赛事常常
常年开放(有的已开放数月),若也算紧急,就会**每天为同一场比赛报警**,反而把真正的截止日淹没。

它仍照常出现在摘要正文与窗口概览里,只是不单独触发发信。
详见 `docs/HANDOVER.md` §4。
