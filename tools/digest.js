#!/usr/bin/env node
/* =========================================================
   赛事报名每日摘要生成器(马拉松 + 越野赛)
   ---------------------------------------------------------
   状态引擎「唯一来源」: marathon-platform/assets/engine.js

   这里不再自己重写任何状态判断,也不再去旧的单文件页面里抽取 JS。
   引擎被 require 进来直接调用 —— 网页、本脚本、后续小程序共用同一份
   逻辑,结构上不可能出现「网页说待缴费、邮件说已截止」。

   赛事目录同样以引擎的 SEED_ALL 为准,JSON 只承载「我的进度」:
     · userStatus(已中签 / 已缴费 / 已放弃 …)以 JSON 为准
     · 报名窗口、抽签日、比赛日等事实字段以引擎为准(会自动跟进最新赛历)
     · JSON 里引擎没有的赛事(自建)原样保留

   数据来源 : data/marathon_watchlist.json   (关注清单 + 档案 + 我的进度)
   逻辑来源 : marathon-platform/assets/engine.js
   产出      : reports/marathon_digest_YYYY-MM-DD.md
               reports/marathon_digest_YYYY-MM-DD.email.html
               reports/urgent_YYYY-MM-DD.json

   用法:  node tools/digest.js [--date 2026-10-07]
   ========================================================= */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENGINE = path.join(ROOT, "marathon-platform", "assets", "engine.js");
const REPORTS = path.join(ROOT, "reports");

/* ---------- 0. 命令行参数 ---------- */
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return (i >= 0 && argv[i + 1]) ? argv[i + 1] : def;
};
const DATA_MAIN = path.join(ROOT, "data", "marathon_watchlist.json");
const DATA_EXAMPLE = path.join(ROOT, "data", "marathon_watchlist.example.json");
/* 优先用「活的」关注清单;不存在时回退到入库模板,好让新克隆开箱即可跑通。
   活文件含个人档案(姓名 / 身份证号 / 手机号),已被 .gitignore 排除 ——
   仓库里那份是不带个人数据的模板。 */
const DATA = path.resolve(arg("--data", fs.existsSync(DATA_MAIN) ? DATA_MAIN : DATA_EXAMPLE));
const OUT = path.resolve(arg("--out", REPORTS));
let NOW = new Date();
const dstr = arg("--date", null);
if (dstr) {
  /* 支持 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM —— 后者便于复现「抽签公布当天」这类时刻 */
  const m = dstr.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (!m) { console.error("--date 格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM"); process.exit(2); }
  NOW = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0, 0, 0);
}
const pad = n => String(n).padStart(2, "0");
const TODAY = NOW.getFullYear() + "-" + pad(NOW.getMonth() + 1) + "-" + pad(NOW.getDate());

/* ---------- 1. 装载唯一引擎 ---------- */
let ME;
try {
  ME = require(ENGINE);
} catch (e) {
  console.error("无法加载状态引擎(" + path.relative(ROOT, ENGINE) + "):\n" + ((e && e.stack) || e));
  process.exit(3);
}
const computeStatus  = ME.computeStatus;
const profileWarnings = ME.profileWarnings;
const parseDT        = ME.parseDT;
const dayDiff        = ME.dayDiff;
const MS_DAY         = ME.MS_DAY;
const kindOf         = ME.kindOf;
const KIND_LABEL     = ME.KIND_LABEL;

/* ---------- 2. 读数据 + 合并目录 ---------- */
if (!fs.existsSync(DATA)) {
  console.error("找不到关注清单: " + DATA +
    "\n首次使用请先执行: cp data/marathon_watchlist.example.json data/marathon_watchlist.json");
  process.exit(4);
}
const watchData = JSON.parse(fs.readFileSync(DATA, "utf-8"));
if (path.basename(DATA) === "marathon_watchlist.example.json") {
  console.warn("⚠ 未找到活的关注清单,本次使用入库模板 " + path.relative(ROOT, DATA) +
    " —— 个人进度为空,仅用于验证管线。");
}
const profile = watchData.profile || {};
const savedRaces = watchData.races || [];

/* 事实字段(报名窗口 / 抽签日 / 比赛日 / 官网)一律以引擎为准,
   这样赛历一更新,摘要自动跟上,不用回头改 JSON。
   只有「我的进度」(userStatus)以 JSON 为准。 */
const seed = ME.SEED_ALL || ME.SEED_RACES || [];
const savedById = new Map(savedRaces.map(function (r) { return [r.id, r]; }));
const RACES = seed.map(function (r) {
  const saved = savedById.get(r.id);
  return Object.assign({}, r, { userStatus: (saved && saved.userStatus) || "watching" });
});
/* JSON 里引擎没有的赛事(自建)原样纳入 */
savedRaces.forEach(function (r) {
  if (!seed.some(function (s) { return s.id === r.id; })) RACES.push(Object.assign({}, r));
});

const ORDER = { pay: 0, drawdone: 1, closing: 2, soon: 3, open: 4, opendeadline: 5, waitdraw: 6,
                pending: 7, racing: 8, notopen: 9, unknown: 10, closed: 11, lost: 12, done: 13, skipped: 14 };

const raceDays = function (r) { const d = parseDT(r.raceDate); return d ? dayDiff(r.raceDate, NOW) : null; };
const stripTags = function (s) { return String(s || "").replace(/<[^>]+>/g, ""); };

const rows = RACES.map(function (r) {
  const s = computeStatus(r, NOW);
  let warn = [];
  try { warn = profileWarnings(r, profile) || []; }
  catch (e) { warn = ["(档案检查异常: " + e.message + ")"]; }
  return { r: r, s: s, warn: warn };
}).sort(function (a, b) {
  return (ORDER[a.s.key] - ORDER[b.s.key]) ||
         ((a.s.cd == null ? 9999 : a.s.cd) - (b.s.cd == null ? 9999 : b.s.cd));
});

const R = {
  today: TODAY,
  races: rows.map(function (x) {
    const r = x.r;
    return {
      id: r.id, name: r.name, en: r.en || r.nameEn, city: r.city, country: r.country,
      region: r.region, tier: r.tier, mode: r.mode, url: r.url,
      kind: kindOf(r), kindLabel: KIND_LABEL[kindOf(r)], dist: r.dist || null,
      statusKey: x.s.key, statusLabel: x.s.label, urg: x.s.urg,
      cd: x.s.cd == null ? null : x.s.cd, cdLabel: x.s.cdLabel || null, cdDate: x.s.cdDate || null,
      userStatus: r.userStatus || "watching",
      regOpen: r.regOpen || null, regClose: r.regClose || null,
      drawDate: r.drawDate || null, payDeadline: r.payDeadline || null, raceDate: r.raceDate || null,
      daysToRace: raceDays(r), confidence: r.confidence || null,
      note: stripTags(r.note),
      warnings: x.warn
    };
  })
};

/* 档案整体体检(与具体赛事无关的项) */
const p = profile;
const profIssues = [];
if (!p.name)  profIssues.push("姓名为空");
if (!p.idNo)  profIssues.push("证件号码为空");
if (!p.phone) profIssues.push("手机号码为空");
if (!p.email) profIssues.push("邮箱为空");
if (!p.ecName || !p.ecPhone) profIssues.push("紧急联系人未填写完整");
if (p.medDate) {
  const d = parseDT(p.medDate);
  if (d) {
    const mo = Number(p.medMonths) || 12;
    const exp = new Date(d.getFullYear(), d.getMonth() + mo, d.getDate());
    R.medExpire = exp.getFullYear() + "-" + String(exp.getMonth() + 1).padStart(2, "0") + "-" + String(exp.getDate()).padStart(2, "0");
    R.medLeft = Math.round((exp - NOW) / MS_DAY);
  }
} else profIssues.push("未填写体检报告日期");

/* 成绩记录时效:路跑看马拉松成绩,越野看最长越野完赛 */
const pbDate = p.pbFullDate || p.pbHalfDate;
if (pbDate) {
  const d = parseDT(pbDate);
  if (d) R.pbAgeDays = Math.round((NOW - d) / MS_DAY);
} else profIssues.push("无马拉松完赛成绩记录");

const trailDate = p.trailMaxDate;
if (trailDate) {
  const d = parseDT(trailDate);
  if (d) R.trailAgeDays = Math.round((NOW - d) / MS_DAY);
}
if (!p.trailMax) profIssues.push("无越野完赛记录(越野赛报名硬门槛,路跑成绩通常不被接受)");
if (!p.itra) profIssues.push("未填写 ITRA 表现分(境外越野赛常设门槛)");

R.profileIssues = profIssues;
R.counts = rows.reduce(function (a, x) { a[x.s.key] = (a[x.s.key] || 0) + 1; return a; }, {});

/* ---------- 3. 分类 ---------- */
const all = R.races;
const roadAll  = all.filter(x => x.kind === "road");
const trailAll = all.filter(x => x.kind === "trail");

const payUrgent = all.filter(x => x.statusKey === "pay" && x.cd !== null && x.cd <= 3);
const drawDone  = all.filter(x => x.statusKey === "drawdone");
const soonOpen  = all.filter(x => x.statusKey === "soon");
const closing   = all.filter(x => x.statusKey === "closing");
/* 已开放但官方未公布截止日 —— 售罄即止,属于需要尽快处理的一类 */
const noDeadline = all.filter(x => x.statusKey === "opendeadline");
const inWindow  = all.filter(x => x.statusKey === "open");
const waiting   = all.filter(x => x.statusKey === "waitdraw" || x.statusKey === "pending");
const upcoming  = all.filter(x => x.statusKey === "notopen");
const racing    = all.filter(x => x.statusKey === "racing");
const unknown   = all.filter(x => x.statusKey === "unknown");

/* 「紧急」= 有明确时间窗、错过就没了的事件。故意不含 opendeadline:
   未设截止日的窗口会长期挂着(有的已开放数月),若也计入紧急,邮件将永远
   无法安静下来 —— 天天为同一场赛事报警,反而让真正的截止日被淹没。
   它单独成节 + 窗口概览各占一行,邮件正文里始终可见,只是不单独触发发信。 */
const urgent = [...payUrgent, ...drawDone, ...soonOpen, ...closing];

/* 分组展示时的截断:60 场赛事若全列会淹没重点 */
const cap = (arr, n) => {
  const lim = n || 6;
  if (arr.length <= lim) return arr.map(x => x.name).join(" · ");
  return arr.slice(0, lim).map(x => x.name).join(" · ") + " 等 " + arr.length + " 场";
};

/* ---------- 3. 输出 ---------- */
fs.mkdirSync(OUT, { recursive: true });

const md = [];
md.push("# 赛事报名每日巡检 · " + TODAY);
md.push("");
md.push("> 覆盖 <b>马拉松 / 路跑 " + roadAll.length + " 场</b> + <b>越野赛 " + trailAll.length +
        " 场</b> · 由 `tools/digest.js` 自动生成 · 状态引擎与网站同源(`marathon-platform/assets/engine.js`)");
md.push("");

md.push("## 一、紧急事项");
if (!urgent.length) {
  md.push("");
  md.push("**今日无紧急事项。**");
  if (noDeadline.length) {
    md.push("");
    md.push("当前有 " + noDeadline.length + " 场「已开放但未设截止日」的赛事长期挂着 —— 它们不构成时间压力,但名额售罄即止,详见下方小节。");
  }
} else {
  md.push("");
  md.push("| 优先级 | 赛事 | 类型 | 状态 | 关键节点 | 剩余 | 官网 |");
  md.push("|---|---|---|---|---|---|---|");
  urgent.forEach(x => {
    const tier = x.statusKey === "pay" ? "🔴 最高"
               : x.statusKey === "drawdone" ? "🟠 高"
               : x.statusKey === "closing" ? "🟠 高"
               : x.statusKey === "opendeadline" ? "🟠 高" : "🔵 中";
    /* drawdone 的 cd 是「已过去几天」,其余是「还剩几天」 */
    const cdTxt = x.statusKey === "drawdone"
      ? (x.cd === 0 ? "**今天公布**" : "已过 **" + x.cd + "** 天")
      : x.statusKey === "opendeadline"
        ? "**售罄即止**"
        : (x.cd === 0 ? "**今天**" : "**" + x.cd + "** " + (x.cdLabel || ""));
    md.push("| " + tier + " | " + x.name + " | " + (x.kind === "trail" ? "越野" : "路跑") + " | " +
      x.statusLabel + " | " +
      (x.cdDate ? x.cdDate.slice(0, 10) : "—") + " | " + cdTxt + " | [报名](" + x.url + ") |");
  });
}
md.push("");

if (noDeadline.length) {
  md.push("### ⏳ 报名中,但官方未设截止日");
  md.push("");
  md.push("这类赛事<b>名额售罄即止</b>,窗口开着不代表还有名额 —— 想跑就尽快确认。");
  md.push("");
  noDeadline.forEach(x => {
    md.push("- **" + x.name + "**(" + (x.kind === "trail" ? "越野" : "路跑") + ") —— 开放日 " +
      (x.regOpen || "").replace("T", " ") + ",比赛日 " + (x.raceDate || "").slice(0, 10) +
      (x.daysToRace != null ? "(还有 " + x.daysToRace + " 天)" : "") + "。");
    md.push("  - 确认是否仍可报名:" + x.url);
  });
  md.push("");
}

if (payUrgent.length) {
  md.push("### ⚠️ 待缴费(最容易丢名额)");
  md.push("");
  payUrgent.forEach(x => {
    md.push("- **" + x.name + "** —— 缴费截止 " + (x.payDeadline || "").replace("T", " ") +
      ",仅剩 **" + x.cd + " 天**。中签不等于拿到名额,逾期名额立即释放且不可恢复。");
    md.push("  - 入口:" + x.url);
  });
  md.push("");
}

if (drawDone.length) {
  md.push("### 🔔 抽签结果已公布,但尚未确认");
  md.push("");
  drawDone.forEach(x => {
    md.push("- **" + x.name + "** —— 结果已于 " + (x.cdDate || "").slice(0, 10) + " 公布" +
      (x.cd === 0 ? "(就是今天)" : "(已过 " + x.cd + " 天)") + ",本赛事状态仍是「关注中」。");
    md.push("  - **立即到官网查询:**" + x.url);
    md.push("  - 中签后缴费期通常只有 3–7 天,逾期名额立即释放。查到结果后请把状态改为「已中签」或「未中签」,系统会自动接管倒计时。");
  });
  md.push("");
}

md.push("## 二、窗口动态概览");
md.push("");
md.push("> 名称后标 **`[越]`** 的为越野赛,其余为路跑。分组内超过 6 场只列前 6 场。");
md.push("");
md.push("| 分组 | 场次 | 赛事 |");
md.push("|---|---|---|");
/* cd=0 时说「今天」而不是「0 天后」 */
const rel = (x, verb) => x.cd === 0 ? "今天" + verb : x.cd + " 天后" + verb;
const tag = x => (x.kind === "trail" ? "[越] " : "");
const grp = (label, arr, f) => {
  if (!arr.length) return;
  const show = arr.slice(0, 6).map(f).join(" · ");
  const more = arr.length > 6 ? " … 等 " + arr.length + " 场" : "";
  md.push("| " + label + " | " + arr.length + " | " + show + more + " |");
};
grp("报名中", inWindow, x => tag(x) + x.name + "(" + rel(x, "截止") + ")");
grp("报名中·未设截止日", noDeadline, x => tag(x) + x.name);
grp("待抽签 / 待结果", waiting, x => tag(x) + x.name + (x.cd != null ? "(" + rel(x, "公布") + ")" : ""));
grp("未开放", upcoming, x => tag(x) + x.name + "(" + (x.cd != null ? rel(x, "开放") : "待定") + ")");
grp("已锁定待比赛", racing, x => tag(x) + x.name + "(" + x.daysToRace + " 天后比赛)");
grp("窗口未记录", unknown, x => tag(x) + x.name + "(" + (x.daysToRace != null ? x.daysToRace + " 天后比赛" : "日期待定") + ")");
md.push("");
md.push("**分类统计:**路跑 " + roadAll.length + " 场(报名中 " +
  roadAll.filter(x => x.statusKey === "open" || x.statusKey === "opendeadline").length + ") · 越野赛 " +
  trailAll.length + " 场(报名中 " +
  trailAll.filter(x => x.statusKey === "open" || x.statusKey === "opendeadline").length + ")");
md.push("");

md.push("## 三、档案体检");
md.push("");
if (R.profileIssues.length) {
  md.push("**待补齐:**");
  md.push("");
  R.profileIssues.forEach(s => md.push("- " + s));
} else {
  md.push("- 基础信息完整 ✓");
}
if (R.medLeft !== undefined) {
  md.push("- 体检报告有效期至 " + R.medExpire + (R.medLeft < 0
    ? ",**已过期 " + Math.abs(R.medLeft) + " 天**" 
    : ",剩余 **" + R.medLeft + " 天**" + (R.medLeft <= 60 ? "(建议尽快更新)" : "")));
}
if (R.pbAgeDays !== undefined) {
  md.push("- 路跑成绩记录距今 " + R.pbAgeDays + " 天" +
    (R.pbAgeDays > 730 ? ",**已超 24 个月,国内赛事可能不再认可**" : " ✓"));
}
if (R.trailAgeDays !== undefined) {
  md.push("- 越野成绩记录距今 " + R.trailAgeDays + " 天" +
    (R.trailAgeDays > 730 ? ",**已超 24 个月,多数越野赛要求近 2 年内成绩**" : " ✓"));
}
md.push("");

/* 按告警文本归并,同一条只出现一次,避免「档案未填」被重复 N 遍。
   这些是「档案层面的通识缺口」,已在上面「档案体检」里成条列出,
   不再沉到下面「赛事要求差异」里 —— 否则同一个缺项会借着不同赛事名重复刷屏。 */
const GENERIC = /^(档案未填写完整|缺少24个月内的完赛证明|未填写体检报告日期|缺少越野赛完赛记录|越野成绩记录已超过|该赛事设 ITRA 表现分门槛|已有成绩记录已超过|体检报告已过期|体检报告将在)/;
const warnMap = new Map();
all.forEach(x => x.warnings.forEach(w => {
  if (!warnMap.has(w)) warnMap.set(w, []);
  warnMap.get(w).push(x.name);
}));
const warnList = [...warnMap.entries()];

/* 赛事专属(非通识性)告警:单独列出 */
const specificWarn = warnList.filter(([w]) => !GENERIC.test(w));

if (specificWarn.length) {
  md.push("**赛事要求差异:**");
  md.push("");
  specificWarn.slice(0, 6).forEach(([w, names]) => {
    const tail = names.length > 2 ? names.slice(0, 2).join("、") + " 等 " + names.length + " 场" : names.join("、");
    md.push("- " + w + " —— 涉及:" + tail);
  });
  md.push("");
}

md.push("---");
md.push("");
md.push("*共 " + all.length + " 场赛事 · 路跑 " + roadAll.length + " + 越野 " + trailAll.length +
  " · 紧急 " + urgent.length + " · 报名中 " + inWindow.length +
  " · 长期开放 " + noDeadline.length + " · 待抽签 " + waiting.length + "*");

const mdPath = path.join(OUT, "marathon_digest_" + TODAY + ".md");
fs.writeFileSync(mdPath, md.join("\n"), "utf-8");

/* ---------- 4. 邮件版(HTML,内联样式) ---------- */
const E = s => String(s == null ? "" : s)
  .replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function rowHtml(x) {
  const isP = x.statusKey === "pay";
  const isC = x.statusKey === "closing" || x.statusKey === "drawdone" || x.statusKey === "opendeadline";
  const accent = isP ? "#c62828" : isC ? "#e07b00" : "#1565c0";
  const bg = isP ? "#fdecec" : isC ? "#fff6e5" : "#eef4fd";
  /* drawdone 的 cd 表示「已过去几天」,opendeadline 无截止日,其余表示「还剩几天」 */
  const cdTxt = x.statusKey === "drawdone"
    ? (x.cd === 0 ? "今天公布" : "已过 " + x.cd + " 天")
    : x.statusKey === "opendeadline"
      ? "售罄即止"
      : (x.cd === 0 ? "就是今天" : x.cd + " " + (x.cdLabel || ""));
  /* opendeadline 没有截止日,改显开放日,避免留下空白 */
  const whenTxt = (x.cdDate || (x.statusKey === "opendeadline" ? x.regOpen : "")) || "";
  return '<tr>'
    + '<td style="padding:12px 14px;border-bottom:1px solid #e8eaea;border-left:4px solid ' + accent + ';background:' + bg + '">'
    + '<div style="font-weight:700;font-size:15px;color:#14201f">' + (x.kind === "trail" ? "🏔 " : "") + E(x.name) + '</div>'
    + '<div style="font-size:12px;color:#5c6b6a;margin-top:3px">' + E(x.city) + ' · ' + E(x.country) + ' · 比赛日 ' + E((x.raceDate || "").slice(0, 10)) + '</div>'
    + '</td>'
    + '<td style="padding:12px 10px;border-bottom:1px solid #e8eaea;background:' + bg + ';white-space:nowrap">'
    + '<span style="display:inline-block;padding:3px 9px;border-radius:20px;background:' + accent + ';color:#fff;font-size:12px;font-weight:600">' + E(x.statusLabel) + '</span></td>'
    + '<td style="padding:12px 10px;border-bottom:1px solid #e8eaea;background:' + bg + ';font-size:13px;color:#14201f;white-space:nowrap">'
    + E(whenTxt.replace("T", " ").slice(0, 16)) + '<div style="font-size:12px;color:' + accent + ';font-weight:700">' + E(cdTxt) + '</div></td>'
    + '<td style="padding:12px 14px;border-bottom:1px solid #e8eaea;background:' + bg + ';text-align:right">'
    + '<a href="' + E(x.url) + '" style="display:inline-block;padding:7px 14px;background:#14201f;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600">去报名</a></td>'
    + '</tr>';
}

const ehtml = []
  .concat([
    '<div style="max-width:680px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#14201f;background:#ffffff">',
    '<div style="padding:22px 24px;border-bottom:3px solid #0f6e63">',
    '<div style="font-size:19px;font-weight:700">马拉松 / 越野赛报名每日巡检</div>',
    '<div style="font-size:13px;color:#5c6b6a;margin-top:4px">' + TODAY + ' · 关注 ' + all.length +
      ' 场(路跑 ' + roadAll.length + ' · 越野 ' + trailAll.length + ') · 紧急 ' + urgent.length + ' 项</div>',
    '</div>'
  ])
  .concat(urgent.length ? [
    '<div style="padding:20px 24px 6px"><div style="font-size:15px;font-weight:700;margin-bottom:10px">需要你处理的 ' + urgent.length + ' 件事</div>',
    '<table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden">',
    urgent.map(rowHtml).join(""),
    '</table></div>'
  ] : [
    '<div style="padding:24px"><div style="padding:16px;background:#eef7f4;border-radius:8px;border-left:4px solid #0f6e63">',
    '<b>今日无紧急事项。</b>可以趁这段时间把档案和材料补齐。</div></div>'
  ]);

if (payUrgent.length) {
  ehtml.push('<div style="padding:8px 24px 4px">');
  ehtml.push('<div style="padding:14px 16px;background:#fdecec;border-radius:8px;font-size:13px;line-height:1.75">');
  ehtml.push('<b style="color:#c62828">⚠️ 中签不等于拿到名额。</b>付款期通常只有 3–7 天,逾期名额立即释放且不可恢复 —— 绝大多数被释放的名额都死在这一步。');
  ehtml.push('</div></div>');
}

if (drawDone.length) {
  ehtml.push('<div style="padding:8px 24px 4px">');
  ehtml.push('<div style="padding:14px 16px;background:#fff6e5;border-radius:8px;font-size:13px;line-height:1.75">');
  ehtml.push('<b style="color:#e07b00">🔔 抽签结果已公布,但还没有确认。</b>立即到官网查结果 —— 中签后缴费期通常只有 3–7 天,逾期名额立即释放。查到后把状态改成「已中签」或「未中签」,系统会自动接管倒计时。');
  ehtml.push('</div></div>');
}

/* 长期开放(未设截止日)不触发发信,但只要在发信就一并列出,避免用户以为漏了 */
if (noDeadline.length) {
  ehtml.push('<div style="padding:8px 24px 4px">');
  ehtml.push('<div style="padding:14px 16px;background:#eaf6f4;border-radius:8px;border-left:4px solid #0f6e63;font-size:13px;line-height:1.75">');
  ehtml.push('<b style="color:#0f6e63">⏳ 另有 ' + noDeadline.length + ' 场已开放但官方未设截止日</b>(名额售罄即止,不构成时间压力,但需要时尽早确认):<br>');
  noDeadline.slice(0, 6).forEach(x => {
    ehtml.push('· ' + (x.kind === "trail" ? "🏔 " : "") + '<b>' + E(x.name) + '</b> · 开放日 ' +
      E((x.regOpen || "").replace("T", " ").slice(0, 10)) + '<br>');
  });
  ehtml.push('</div></div>');
}

ehtml.push('<div style="padding:16px 24px 4px"><div style="font-size:15px;font-weight:700;margin-bottom:8px">窗口动态</div>');
ehtml.push('<table style="width:100%;border-collapse:collapse;font-size:13px">');
[["报名中", inWindow, x => (x.kind === "trail" ? "[越] " : "") + x.name + " · " + rel(x, "截止")],
 ["报名中·未设截止日", noDeadline, x => (x.kind === "trail" ? "[越] " : "") + x.name + " · 售罄即止"],
 ["待抽签", waiting, x => (x.kind === "trail" ? "[越] " : "") + x.name + (x.cd != null ? " · " + rel(x, "公布") : "")],
 ["未开放", upcoming, x => (x.kind === "trail" ? "[越] " : "") + x.name + (x.cd != null ? " · " + rel(x, "开放") : "")],
 ["已锁定待比赛", racing, x => (x.kind === "trail" ? "[越] " : "") + x.name + " · " + x.daysToRace + " 天后比赛"]].forEach(g => {
  if (!g[1].length) return;
  ehtml.push('<tr><td style="padding:8px 0;color:#5c6b6a;white-space:nowrap;vertical-align:top;width:96px">' + g[0] + '</td>'
    + '<td style="padding:8px 0;color:#14201f">' + E(g[1].map(g[2]).join(" ｜ ")) + '</td></tr>');
});
ehtml.push('</table></div>');

ehtml.push('<div style="padding:16px 24px 8px"><div style="font-size:15px;font-weight:700;margin-bottom:8px">档案体检</div>');
ehtml.push('<div style="font-size:13px;line-height:1.9;color:#14201f">');
if (R.profileIssues.length) ehtml.push('待补齐:' + E(R.profileIssues.join("、")) + "<br>");
else ehtml.push('基础信息完整 ✓<br>');
if (R.medLeft !== undefined) ehtml.push('体检有效期至 ' + R.medExpire + (R.medLeft < 0 ? ' · <b style="color:#c62828">已过期</b>' : ' · 剩余 ' + R.medLeft + ' 天') + "<br>");
if (R.pbAgeDays !== undefined) ehtml.push('成绩记录距今 ' + R.pbAgeDays + ' 天' + (R.pbAgeDays > 730 ? ' · <b style="color:#c62828">超 24 个月</b>' : '') + "<br>");
ehtml.push('</div></div>');

if (specificWarn.length) {
  ehtml.push('<div style="padding:4px 24px 8px"><div style="font-size:15px;font-weight:700;margin-bottom:8px">赛事要求差异</div>');
  ehtml.push('<div style="font-size:13px;line-height:1.9;color:#14201f">');
  specificWarn.slice(0, 5).forEach(([w, names]) => {
    const tail = names.length > 2 ? names.slice(0, 2).join("、") + " 等 " + names.length + " 场" : names.join("、");
    ehtml.push("· " + E(w) + ' <span style="color:#879493">(' + E(tail) + ")</span><br>");
  });
  ehtml.push('</div></div>');
}

ehtml.push('<div style="padding:14px 24px 28px;font-size:12px;color:#879493;border-top:1px solid #e8eaea;margin-top:14px">');
ehtml.push('本邮件由「赛事跟踪台」每日巡检自动生成(与马拉松/越野赛跟踪网站同源)。日期以组委会官方公告为准。');
ehtml.push('</div></div>');

const emailPath = path.join(OUT, "marathon_digest_" + TODAY + ".email.html");
fs.writeFileSync(emailPath, ehtml.join("\n"), "utf-8");

const urgentPath = path.join(OUT, "urgent_" + TODAY + ".json");
fs.writeFileSync(urgentPath, JSON.stringify({
  date: TODAY, generatedAt: new Date().toISOString(),
  urgent, counts: R.counts, profileIssues: R.profileIssues,
  kinds: { road: roadAll.length, trail: trailAll.length },
  noDeadline: noDeadline.length,
  medLeft: R.medLeft, medExpire: R.medExpire, pbAgeDays: R.pbAgeDays, trailAgeDays: R.trailAgeDays
}, null, 2), "utf-8");

/* ---------- 5. 控制台摘要 ---------- */
console.log("=== 马拉松 / 越野赛报名巡检 · " + TODAY + " ===");
console.log("");
if (!urgent.length) {
  console.log("今日无紧急事项。");
} else {
  urgent.forEach(x => console.log(
    "  [" + x.statusLabel + "] " + (x.kind === "trail" ? "[越野] " : "") + x.name +
    "  → " + (x.statusKey === "opendeadline" ? "售罄即止"
            : x.cd === 0 ? "就是今天" : x.cd + " " + (x.cdLabel || "")) +
    " (" + (x.cdDate || "").slice(0, 10) + ")"));
}
console.log("");
console.log("覆盖: 路跑 " + roadAll.length + " 场 · 越野赛 " + trailAll.length + " 场");
console.log("窗口动态: 报名中 " + inWindow.length + " · 未设截止日 " + noDeadline.length +
            " · 待抽签 " + waiting.length + " · 未开放 " + upcoming.length +
            " · 已锁定 " + racing.length + " · 窗口未记录 " + unknown.length);
if (R.profileIssues.length) console.log("档案待补齐: " + R.profileIssues.join("、"));
console.log("");
console.log("已写出:");
console.log("  " + path.relative(ROOT, mdPath));
console.log("  " + path.relative(ROOT, emailPath));
console.log("  " + path.relative(ROOT, urgentPath));
