#!/usr/bin/env node
/* =========================================================
   赛事跟踪台 · 摘要生成 + 邮件推送(一体)
   ---------------------------------------------------------
   覆盖马拉松 / 路跑 + 全球越野赛(60 场)。
   状态引擎唯一来源: marathon-platform/assets/engine.js

   1) 调用 tools/digest.js 生成摘要(逻辑与网页同源)
   2) 读 reports/urgent_*.json,判断是否有紧急项
      「紧急」= pay / drawdone / soon / closing —— 有明确时间窗的;
      「报名中·未设截止日 opendeadline」长期开放,不计入紧急
      (否则同一场赛事会天天报警,真正的截止日反被淹没)
   3) 有紧急项 → 通过 Agent Mail CLI 发 HTML 邮件到用户自己的收件箱
      无紧急项 → 只落盘,不发信(--force 可强制发)

   用法:
     node tools/notify.js              正常巡检
     node tools/notify.js --force      无紧急项也发
     node tools/notify.js --dry-run    只打印将要发送的内容,不真发
     node tools/notify.js --date 2026-12-01

   环境变量:
     AGENTLY_CLI   CLI 路径(默认自动探测)
     DIGEST_TO     收件地址(默认取 agently-cli +me 的主别名)
   ========================================================= */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DRY = has("--dry-run");
const FORCE = has("--force");
const DATE_ARG = val("--date", null);

/* ---------- 定位发信 CLI ----------
   本项目零依赖,不内置 SMTP 客户端:发信交给外部 CLI。
   查找顺序:AGENTLY_CLI 环境变量 → PATH → 若干常见安装位置。
   只要你的 CLI 支持 `+me`(返回发件别名)与发信子命令即可替换。
   完整说明见 docs/MAIL_SETUP.md */
const CLI_NAME = "agently-cli";
function findCli() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const cands = [];
  if (process.env.AGENTLY_CLI) cands.push(process.env.AGENTLY_CLI);
  if (home) {
    cands.push(path.join(home, ".workbuddy/binaries/node/workspace/node_modules/.bin", CLI_NAME));
    cands.push(path.join(home, ".local/bin", CLI_NAME));
  }
  cands.push("/usr/local/bin/" + CLI_NAME, "/opt/homebrew/bin/" + CLI_NAME);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  const w = spawnSync("which", [CLI_NAME], { encoding: "utf-8" });
  if (w.status === 0 && w.stdout.trim()) return w.stdout.trim();
  console.error("找不到发信 CLI(" + CLI_NAME + ")。三种解决办法:");
  console.error("  1) 指定路径  AGENTLY_CLI=/path/to/" + CLI_NAME + " node tools/notify.js");
  console.error("  2) 装进 PATH  npm install -g @tencent-qqmail/" + CLI_NAME);
  console.error("  3) 不发信也行  node tools/digest.js  —— 摘要同样会写到 reports/");
  console.error("  详见 docs/MAIL_SETUP.md");
  process.exit(10);
}
const CLI = findCli();

/* ---------- 1. 生成摘要 ---------- */
console.log("[1/3] 生成摘要…");
const genArgs = [path.join(__dirname, "digest.js")];
if (DATE_ARG) genArgs.push("--date", DATE_ARG);
const gen = spawnSync(process.execPath, genArgs, { cwd: ROOT, encoding: "utf-8" });
process.stdout.write(gen.stdout || "");
if (gen.status !== 0) {
  console.error("摘要生成失败(退出码 " + gen.status + "):\n" + (gen.stderr || ""));
  process.exit(gen.status || 11);
}

/* 定位刚生成的文件 */
/* 定位刚生成的文件(文件名只含日期,去掉 --date 里可能带的时分) */
const stamp = (DATE_ARG || (() => {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
})()).slice(0, 10);
const urgentFile = path.join(REPORTS, "urgent_" + stamp + ".json");
const emailFile  = path.join(REPORTS, "marathon_digest_" + stamp + ".email.html");

if (!fs.existsSync(emailFile)) { console.error("找不到邮件正文: " + emailFile); process.exit(12); }
const U = fs.readFileSync(urgentFile, "utf-8");
const urgent = (JSON.parse(U).urgent) || [];

/* ---------- 2. 判断是否发信 ---------- */
const html = fs.readFileSync(emailFile, "utf-8");
const first = urgent[0];
/* 「还剩几天」的文案要区分三类:已公布(drawdone)按「已过 X 天」、
   未设截止日(opendeadline)按「售罄即止」、其余按「剩 X 天」。 */
const firstWhen = !first ? ""
  : first.statusKey === "drawdone" ? (first.cd === 0 ? " 今天公布" : " 已过 " + first.cd + " 天")
  : first.statusKey === "opendeadline" ? " 售罄即止"
  : first.cd === 0 ? " 就是今天" : " 剩 " + first.cd + " 天";
const subject = urgent.length
  ? "【赛事报名】今日 " + urgent.length + " 项紧急事项 — " + (first.kind === "trail" ? "🏔 " : "") + first.name + firstWhen
  : "【赛事报名】今日无紧急事项 · " + stamp;

if (!urgent.length && !FORCE) {
  console.log("[2/3] 今日无紧急事项,按策略不发信(如需强制发送请加 --force)。");
  console.log("[3/3] 摘要已留档:" + path.relative(ROOT, emailFile));
  process.exit(0);
}

/* ---------- 3. 发信 ---------- */
console.log("[2/3] 收件人解析…");
let TO = process.env.DIGEST_TO;
if (!TO) {
  const me = spawnSync(CLI, ["+me"], { encoding: "utf-8", cwd: ROOT });
  let raw = null;
  try { raw = JSON.parse(me.stdout); } catch (e) {}
  /* 授权失效要与「没有别名」区分开:前者需要重新授权,后者只是配置问题。
     混为一谈会让使用者在错的方向上排查半天。 */
  if (raw && raw.ok === false) {
    const why = (raw.error && (raw.error.type || raw.error.message)) || "未知错误";
    console.error("发信通道授权失效(" + why + ")。两条路:");
    console.error("  1) 重新授权   " + CLI_NAME + " auth login");
    console.error("  2) 临时绕过   DIGEST_TO=you@example.com node tools/notify.js");
    process.exit(11);
  }
  try {
    const d = raw.data;
    const p = (d.aliases || []).find(a => a.is_primary) || (d.aliases || [])[0];
    TO = p && p.email;
  } catch (e) {}
}
if (!TO) {
  console.error("无法确定收件地址(" + CLI_NAME + " +me 未返回别名)。请显式指定:");
  console.error("  DIGEST_TO=you@example.com node tools/notify.js");
  process.exit(13);
}
console.log("       收件人: " + TO);

console.log("[3/3] 发送…");
const sendArgs = [
  "message", "+send",
  "--to", TO,
  "--subject", subject,
  "--body-file", path.relative(ROOT, emailFile),
  "--body-format", "html",
  "--confirmed",
];
if (DRY) {
  sendArgs.push("--dry-run");
  console.log("       (dry-run,不实际投递)");
}

const res = spawnSync(CLI, sendArgs, { encoding: "utf-8", cwd: ROOT });
const out = (res.stdout || "") + (res.stderr || "");
process.stdout.write(out);

let ok = false;
try { ok = JSON.parse(res.stdout).ok === true; } catch (e) { ok = /queued|ok/i.test(out); }

/* CLI 若仍要求二次确认,自动带令牌重试一次 */
if (!ok && /confirmation_token/.test(out)) {
  let tok = null;
  try { tok = JSON.parse(res.stdout).data.confirmation_token; } catch (e) {
    const m = out.match(/ctk_[A-Za-z0-9\-]+/); tok = m && m[0];
  }
  if (tok) {
    console.log("       需二次确认,带令牌重试…");
    const r2 = spawnSync(CLI, [
      "message", "+send", "--to", TO, "--subject", subject,
      "--body-file", path.relative(ROOT, emailFile), "--body-format", "html",
      "--confirmation-token", tok,
    ], { encoding: "utf-8", cwd: ROOT });
    process.stdout.write((r2.stdout || "") + (r2.stderr || ""));
    try { ok = JSON.parse(r2.stdout).ok === true; } catch (e) {}
  }
}

console.log("");
if (ok && !DRY) console.log("✓ 已投递 → " + TO);
else if (DRY)  console.log("✓ dry-run 通过");
else { console.error("✗ 发送失败"); process.exit(14); }
