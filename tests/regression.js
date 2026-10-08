#!/usr/bin/env node
/* =========================================================
   赛事跟踪台 —— 全量回归(可在任意克隆里直接跑)
     node tests/regression.js        退出码 0 = 全绿

   A. 引擎防漂移:路跑 24 场状态必须与旧逻辑一致(唯一允许的差异是
      「opendeadline」这一新增态,即旧逻辑把「已开放但无截止日」误判为 unknown)
      基线夹具:legacy/marathon_registrar.html(见 legacy/README.md)
   B. 越野种子数据完整性
   C. DOM 存根 UI 回归:分类显示(赛事库分区 / 我的关注类型筛选 / 看板类别速览)、
      类型切换、未设截止日、档案越野字段
   ========================================================= */
const fs = require("fs"), vm = require("vm"), path = require("path"), os = require("os");
const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "marathon-platform");
const ME = require(path.join(DIR, "assets", "engine.js"));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log("  \u2713 " + n)) : (fail++, console.log("  \u2717 " + n + (extra ? "  \u2192 " + extra : ""))); };

/* ================= A. 引擎防漂移 ================= */
console.log("=== A. 状态引擎防漂移(路跑 24 场必须不变)===");

/* 从旧单文件页面抽出旧逻辑,作为对照基线。
   注意:这里靠「行号切片」抽取,所以下面有一条夹具守卫断言 ——
   万一将来有人重排 legacy 文件的格式,切片会错位,必须让它响亮地失败,
   而不是拿一堆坏数据去比对,得出"零漂移"的假结论。 */
const LEGACY = path.join(ROOT, "legacy", "marathon_registrar.html");
if (!fs.existsSync(LEGACY)) {
  console.error("缺少防漂移基线夹具: " + path.relative(ROOT, LEGACY));
  console.error("见 legacy/README.md —— 该文件是历史产物,但被本测试用作对照基线,不可删除。");
  process.exit(3);
}
const html = fs.readFileSync(LEGACY, "utf8");
const js = html.split("<script>")[1].split("</script>")[0].split("\n");
const sl = (a, b) => js.slice(a - 1, b).join("\n");
const BASELINE = path.join(os.tmpdir(), "marathon_legacy_baseline.js");
fs.writeFileSync(BASELINE,
  [sl(10, 33), sl(59, 243), sl(278, 284), sl(286, 362)].join("\n") +
  "\nmodule.exports = { SEED_RACES, computeStatus, parseDT, dayDiff };\n");
const OLD = require(BASELINE);

/* 夹具守卫:切片必须真的抽出了一个可用的旧引擎。
   旧页面只含路跑 24 场 —— 抽到别的数量说明行号切片已经错位。 */
{
  const shape = OLD && Array.isArray(OLD.SEED_RACES) && typeof OLD.computeStatus === "function";
  const probe = shape ? OLD.computeStatus(Object.assign({}, OLD.SEED_RACES[0], { userStatus: "watching" }),
    new Date("2026/11/01 09:00:00")) : null;
  ok("基线夹具抽取完好(24 场 + computeStatus 可用)",
    shape && OLD.SEED_RACES.length === 24 && probe && typeof probe.key === "string",
    shape ? (OLD.SEED_RACES.length + " 场, probe=" + (probe && probe.key)) : "抽取失败");
  if (!shape || OLD.SEED_RACES.length !== 24) {
    console.error("\n  基线切片已错位 —— 防漂移比对不可信,直接终止。");
    console.error("  修法:核对 legacy/marathon_registrar.html 的 <script> 行号后更新上面 sl() 的区间。");
    process.exit(3);
  }
}

const DATES = ["2026-10-07T09:00", "2026-10-08T00:00", "2026-10-25T12:00", "2026-11-15T09:00",
               "2026-12-06T09:00", "2026-12-31T23:00", "2027-03-01T09:00", "2027-06-01T09:00"];
const STATES = ["watching", "submitted", "won", "paid", "lost", "skipped"];
const K = s => [s.key, s.label, s.cls, s.urg, s.cd, s.cdLabel, s.cdDate].join("|");

let n = 0, drift = 0, intended = 0;
const intendedList = [];
for (const ds of DATES) {
  const now = new Date(ds.replace("T", " ").replace(/-/g, "/"));
  for (let i = 0; i < ME.SEED_RACES.length; i++) {
    for (const st of STATES) {
      const a = JSON.parse(JSON.stringify(ME.SEED_RACES[i])); a.userStatus = st;
      const b = JSON.parse(JSON.stringify(OLD.SEED_RACES[i])); b.userStatus = st;
      n++;
      const N = ME.computeStatus(a, now), O = OLD.computeStatus(b, now);
      if (K(N) === K(O)) continue;
      /* 唯一允许的差异:旧逻辑把「已开放但截止日未公布」误判成 unknown */
      if (N.key === "opendeadline" && O.key === "unknown") {
        intended++;
        const tag = a.name + " @" + ds.slice(0, 10) + " [" + st + "]";
        if (intendedList.indexOf(tag) < 0) intendedList.push(tag);
        continue;
      }
      drift++;
      if (drift <= 5) console.log("  \u26a0 真实漂移:", a.name, st, ds, "\n     新:", K(N), "\n     旧:", K(O));
    }
  }
}
ok("路跑 " + n + " 组对照:无真实漂移", drift === 0, drift + " 组异常");
console.log("     (其中 " + intended + " 组为新增态 opendeadline 修正了旧误判,涉及 "
  + intendedList.length + " 个场景:" + (intendedList.slice(0, 4).join(" / ") || "无") + ")");

/* 路跑赛事的关键字段不得被改动 */
ok("原 24 场路跑全部保留", ME.SEED_RACES.length === 24, ME.SEED_RACES.length);
const oldIds = OLD.SEED_RACES.map(r => r.id);
const curIds = ME.SEED_RACES.map(r => r.id);
ok("路跑 id 与顺序完全一致", JSON.stringify(oldIds) === JSON.stringify(curIds));

/* ================= B. 越野数据完整性 ================= */
console.log("\n=== B. 越野种子数据 ===");
const T = ME.SEED_TRAIL;
ok("越野种子 36 场", T.length === 36, T.length);
ok("SEED_ALL = 路跑 + 越野 = 60", ME.SEED_ALL.length === 60, ME.SEED_ALL.length);
ok("kindOf 正确区分", ME.kindOf(T[0]) === "trail" && ME.kindOf(ME.SEED_RACES[0]) === "road");
ok("KIND_LABEL 已定义", ME.KIND_LABEL.trail === "越野赛" && ME.KIND_LABEL.road === "马拉松 / 路跑");

/* --- ME.phaseOf: 赛事库「报名中 / 已截止」过滤的分类必须由引擎驱动 --- */
ok("phaseOf · 报名中覆盖 open/opendeadline/pay/drawdone/closing/waitdraw",
  ["open","opendeadline","pay","drawdone","closing","waitdraw"].every(k => ME.phaseOf(k) === "open"));
ok("phaseOf · 已截止覆盖 closed/lost/racing/done/skipped",
  ["closed","lost","racing","done","skipped"].every(k => ME.phaseOf(k) === "closed"));
ok("phaseOf · 待公布归 other(soon/notopen/unknown/pending 只在「所有」出现)",
  ["soon","notopen","unknown","pending"].every(k => ME.phaseOf(k) === "other"));

const allIds = ME.SEED_ALL.map(r => r.id);
ok("无重复 id", new Set(allIds).size === allIds.length,
  allIds.filter((x, i) => allIds.indexOf(x) !== i).join(","));

const miss = (k) => T.filter(r => !r[k]).map(r => r.name);
ok("全部有官网链接", miss("url").length === 0, miss("url").join(" / "));
ok("全部有组别/距离", miss("dist").length === 0, miss("dist").join(" / "));
ok("全部有备注", miss("note").length === 0, miss("note").join(" / "));
ok("全部有比赛日", miss("raceDate").length === 0, miss("raceDate").join(" / "));
ok("全部标 kind=trail", T.filter(r => r.kind !== "trail").length === 0);

const tiers = {}; T.forEach(r => tiers[r.tier] = (tiers[r.tier] || 0) + 1);
const regionsT = {}; T.forEach(r => regionsT[r.region] = (regionsT[r.region] || 0) + 1);
console.log("     赛系分布:", JSON.stringify(tiers));
console.log("     地区分布:", JSON.stringify(regionsT));
ok("覆盖 6 大洲中的 5 个", Object.keys(regionsT).length >= 5, Object.keys(regionsT).join(","));
ok("UTMB 总决赛已收录", T.some(r => r.tier === "utmbfinal"));
ok("世界越野大满贯(WTM)已收录", T.filter(r => r.tier === "wtm").length >= 5);
ok("含 ITRA 门槛赛事(已核实 2 场:柴古唐斯 / 熊猫蜀道山)", T.filter(r => r.itraMin).length >= 2,
  T.filter(r => r.itraMin).map(r => r.name + "=" + r.itraMin).join(" / "));
ok("ITRA 门槛值合理(200–500)", T.filter(r => r.itraMin).every(r => r.itraMin >= 200 && r.itraMin <= 500));
ok("含跑石抽签赛制", T.some(r => r.mode === "stones"));
ok("含资格赛制", T.some(r => r.mode === "qualify"));

/* maxDistKm 解析 */
const parseFail = T.filter(r => ME.maxDistKm(r) === null).map(r => r.name);
console.log("     maxDistKm 解析成功 " + (T.length - parseFail.length) + "/" + T.length +
  (parseFail.length ? " · 未解析:" + parseFail.join(" / ") : ""));
ok("至少 90% 的越野赛距离可解析", (T.length - parseFail.length) / T.length >= 0.9,
  parseFail.join(" / "));
ok("UTMB 解析为 171K", ME.maxDistKm(T.find(r => r.id === "utmb27")) === 171,
  String(ME.maxDistKm(T.find(r => r.id === "utmb27"))));

/* ================= C. UI 回归 ================= */
console.log("\n=== C. DOM 存根 UI 回归 ===");
const cap = {};
function mkClassList() {
  const s = new Set();
  return { add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, f) => { if (f === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else { f ? s.add(c) : s.delete(c); } },
    contains: c => s.has(c) };
}
function mkEl(sel) {
  const el = { _sel: sel, tagName: "DIV", dataset: {}, style: {}, classList: mkClassList(),
    children: [], files: [], value: "", checked: false, disabled: false,
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); return c; }, removeChild(c) { return c; },
    remove() {}, click() {}, focus() {}, select() {},
    closest() { return null; }, querySelector() { return mkEl(); }, querySelectorAll() { return []; } };
  let h = "", t = "";
  Object.defineProperty(el, "innerHTML", { get: () => h, set: v => { h = String(v); if (sel) cap[sel] = h; } });
  Object.defineProperty(el, "textContent", { get: () => t, set: v => { t = String(v); if (sel) cap["text" + sel] = t; } });
  return el;
}
const reg = {}, qsaCache = {};
const NAV_TABS = ["dash", "lib", "mine", "profile", "notify"];
const VIEW_IDS = ["view-dash", "view-lib", "view-mine", "view-profile", "view-notify"];
const handlers = {};
const document = {
  querySelector(sel) { return reg[sel] || (reg[sel] = mkEl(sel)); },
  querySelectorAll(sel) {
    if (qsaCache[sel]) return qsaCache[sel];
    let arr = [];
    if (sel === ".nav button") arr = NAV_TABS.map(t => { const e = mkEl(null); e.dataset.tab = t; return e; });
    else if (sel === ".view") arr = VIEW_IDS.map(id => { const e = mkEl(null); e.id = id; return e; });
    return (qsaCache[sel] = arr);
  },
  createElement(tag) { return mkEl(null); },
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  body: { appendChild() {}, removeChild() {} },
  execCommand() { return true; }
};
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }, clear() { Object.keys(store).forEach(k => delete store[k]); }
};
const win = { localStorage, isSecureContext: true, open() { return {}; }, scrollTo() {} };
const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, document, localStorage, window: win,
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  Blob: function () {}, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  FileReader: function () {}, confirm: () => true, alert: () => {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(DIR + "/assets/engine.js", "utf8"), sandbox, { filename: "engine.js" });
sandbox.window.ME = sandbox.ME;
for (const f of ["assets/store.js", "assets/auth.js", "assets/cloud.js", "assets/app.js"]) {
  vm.runInContext(fs.readFileSync(DIR + "/" + f, "utf8"), sandbox, { filename: f });
}
const txt = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const fireClick = (act, id) => handlers.click.forEach(fn => fn({ target: { closest: () => ({ dataset: { act, id } }) } }));
const fireChange = (props) => {
  const target = Object.assign({ dataset: {}, id: undefined, value: "", checked: false, files: [] }, props);
  handlers.change.forEach(fn => fn({ target }));
};
const A = sandbox.window.__app, S = sandbox.window.Store, W = sandbox.window.ME;

ok("引擎/数据层/应用均已挂载", !!W && !!S && !!A);
ok("看板 KPI 仍为 8 项", (cap["#kpis"] || "").split('class="kpi').length - 1 === 8,
  (cap["#kpis"] || "").split('class="kpi').length - 1);

/* --- 赛事库:类型筛选 --- */
A.setTab("lib");
const libAll = (cap["#libGrid"] || "").split('class="lib-card').length - 1;
ok("赛事库渲染全部 60 场", libAll === 60, libAll);
ok("#kindTabs 渲染出 3 个类型按钮", (cap["#kindTabs"] || "").split('class="kt').length - 1 === 3,
  (cap["#kindTabs"] || "").split('class="kt').length - 1);
ok("#kindTabs 显示路跑 / 越野场次", /马拉松\s*·\s*路跑/.test(txt(cap["#kindTabs"])) &&
  /24/.test(txt(cap["#kindTabs"])) && /越野赛/.test(txt(cap["#kindTabs"])) && /36/.test(txt(cap["#kindTabs"])),
  txt(cap["#kindTabs"]).slice(0, 120));

/* 分类显示:全部类型时,赛事库必须分成「路跑」「越野」两个区块 */
ok("赛事库按类别分两个区", (cap["#libGrid"] || "").split('class="kind-sec').length - 1 === 2,
  (cap["#libGrid"] || "").split('class="kind-sec').length - 1);
ok("两个区各自命名", (cap["#libGrid"] || "").indexOf("ks-road") >= 0 && (cap["#libGrid"] || "").indexOf("ks-trail") >= 0);
ok("分区表头带类别说明", (cap["#libGrid"] || "").indexOf('class="ks-desc"') >= 0 &&
  (cap["#libGrid"] || "").indexOf("ITRA") >= 0);
const hdr = txt(cap["#libGrid"]);
ok("路跑区标注 24 场", /马拉松\s*\/\s*路跑\s*24\s*场/.test(hdr), hdr.slice(0, 80));
ok("越野区标注 36 场", /越野赛\s*36\s*场/.test(hdr), hdr.slice(0, 80));

A.setLib({ kind: "trail" });
const libTrail = (cap["#libGrid"] || "").split('class="lib-card').length - 1;
ok("筛选越野 → 36 场", libTrail === 36, libTrail);
ok("筛选后只剩越野区", (cap["#libGrid"] || "").split('class="kind-sec').length - 1 === 1 &&
  (cap["#libGrid"] || "").indexOf("ks-trail") >= 0 && (cap["#libGrid"] || "").indexOf("ks-road") < 0);
ok("越野卡片带类型标记", (cap["#libGrid"] || "").indexOf('class="k-tag') >= 0);
ok("越野卡片显示距离", (cap["#libGrid"] || "").indexOf('class="lc-dist') >= 0);

A.setLib({ kind: "road" });
const libRoad = (cap["#libGrid"] || "").split('class="lib-card').length - 1;
ok("筛选路跑 → 24 场", libRoad === 24, libRoad);
ok("筛选后只剩路跑区", (cap["#libGrid"] || "").split('class="kind-sec').length - 1 === 1 &&
  (cap["#libGrid"] || "").indexOf("ks-road") >= 0 && (cap["#libGrid"] || "").indexOf("ks-trail") < 0);

A.setLib({ kind: "trail", q: "UTMB" });
const libSearch = (cap["#libGrid"] || "").split('class="lib-card').length - 1;
ok("越野库内搜索 UTMB 生效", libSearch > 0 && libSearch < 36, libSearch);
A.setLib({ kind: "", q: "", region: "" });

/* 点击类型条(走 data-act=kindfilter 的点击路径) */
fireClick("kindfilter", "trail");
ok("点击类型条可切到越野", (cap["#libGrid"] || "").split('class="lib-card').length - 1 === 36);
fireClick("kindfilter", "");
ok("点击「全部类型」恢复 60 场", (cap["#libGrid"] || "").split('class="lib-card').length - 1 === 60);

/* --- 看板:未设截止日 banner --- */
A.setTab("dash");
const banner = txt(cap["#actionBanner"]);
console.log("     看板横幅:", banner.slice(0, 150));

/* --- 关注一场越野赛 → 详情 --- */
A.setTab("lib");
A.setLib({ kind: "trail" });
fireClick("watch", "utmb27");
ok("越野赛可加入关注", S.isWatched("utmb27"));
A.setTab("mine");
const mineCards = (cap["#mineWrap"] || "").split('class="race ').length - 1;
ok("我的关注出现越野卡片", mineCards >= 1, mineCards);
ok("未开放的关注赛事不再消失(新增分组)", (cap["#mineWrap"] || "").indexOf("待开放") >= 0,
  txt(cap["#mineWrap"]).slice(0, 100));

/* 关注一场「窗口未记录」的路跑赛事,验证同样可见 */
fireClick("watch", "bj26");
A.setTab("mine");
ok("窗口未记录的关注赛事同样可见", (cap["#mineWrap"] || "").indexOf("data-id=\"bj26\"") >= 0);
ok("关注总数计入两场", S.watchedRaces().length === 2, S.watchedRaces().length);

/* 我的关注:按类别筛选 + 分组标题给出两类占比 */
ok("#mineKind 类型条已渲染", (cap["#mineKind"] || "").indexOf("全部类型") >= 0 &&
  /马拉松\s*·\s*路跑/.test(txt(cap["#mineKind"])) && /越野赛/.test(txt(cap["#mineKind"])),
  txt(cap["#mineKind"]).slice(0, 120));
ok("#mineKind 两类各 1 场", (cap["#mineKind"] || "").split('<span class="n">1</span>').length - 1 === 2,
  (cap["#mineKind"] || "").split('<span class="n">1</span>').length - 1);
ok("分组标题标出两类占比", (cap["#mineWrap"] || "").indexOf('class="kd"') >= 0,
  txt(cap["#mineWrap"]).slice(0, 140));

fireClick("minekind", "trail");
ok("切到越野:只见越野赛事", (cap["#mineWrap"] || "").indexOf("utmb27") >= 0 &&
  (cap["#mineWrap"] || "").indexOf("bj26") < 0);
ok("切到越野后不再显示两类占比", (cap["#mineWrap"] || "").indexOf('class="kd"') < 0);
fireClick("minekind", "road");
ok("切到路跑:只见路跑赛事", (cap["#mineWrap"] || "").indexOf("bj26") >= 0 &&
  (cap["#mineWrap"] || "").indexOf("utmb27") < 0);
fireClick("minekind", "");
ok("切回全部:两类都在", (cap["#mineWrap"] || "").indexOf("utmb27") >= 0 &&
  (cap["#mineWrap"] || "").indexOf("bj26") >= 0);

/* 看板:已关注按类别速览 */
A.setTab("dash");
ok("看板顶部按类别速览", (cap["#kindBar"] || "").indexOf("已关注按类别") >= 0 &&
  (cap["#kindBar"] || "").indexOf("k-road") >= 0 && (cap["#kindBar"] || "").indexOf("k-trail") >= 0,
  txt(cap["#kindBar"]).slice(0, 120));
ok("速览含两类名称与场次", /马拉松\s*\/\s*路跑/.test(txt(cap["#kindBar"])) && /越野赛/.test(txt(cap["#kindBar"])),
  txt(cap["#kindBar"]).slice(0, 120));

A.setTab("mine");
S.unwatch("bj26");
fireClick("detail", "utmb27");
const modal = cap["#modalBox"] || "";
ok("越野详情标出「越野赛」", modal.indexOf("越野赛") >= 0);
ok("越野详情显示组别距离", /171K/.test(modal));
ok("越野详情含强制装备", modal.indexOf("强制装备") >= 0);
ok("越野详情含跑石/UTMB 指数", modal.indexOf("跑石") >= 0 || modal.indexOf("UTMB 指数") >= 0);
ok("越野详情含材料清单", modal.indexOf("材料清单") >= 0);

/* --- 材料清单分支 --- */
const cl = W.buildChecklist(S.raceById("utmb27"), S.state.profile);
const clWS = W.buildChecklist(S.raceById("eiger27"), S.state.profile);
const clRoad = W.buildChecklist(S.raceById("bos27"), S.state.profile);
ok("UTMB 总决赛清单含跑石项", cl.some(x => x.k === "stones"));
ok("UTMB 世界系列赛清单含指数项", clWS.some(x => x.k === "index"));
ok("越野清单含强制装备项", cl.some(x => x.k === "gear"));
ok("越野清单含夜间行进项", cl.some(x => x.k === "night"));
ok("越野清单含换装包规划", cl.some(x => x.k === "crew"));
ok("越野清单比路跑多出装备/资历项", cl.length > clRoad.length, cl.length + " vs " + clRoad.length);
ok("路跑清单不含强制装备", !clRoad.some(x => x.k === "gear"));

/* --- 越野档案告警 --- */
const wUTMB = W.profileWarnings(S.raceById("utmb27"), {});
ok("缺越野资历时给出告警", wUTMB.some(x => x.indexOf("越野") >= 0), wUTMB.join(" | ").slice(0, 120));
const wReady = W.profileWarnings(S.raceById("utmb27"),
  { name: "测试", idNo: "X", trailMax: "100", trailMaxDate: "2026-01-01", itra: "500", medDate: "2026-06-01" });
ok("资历齐备时不再报越野缺项", !wReady.some(x => x.indexOf("缺少越野赛完赛记录") >= 0), wReady.join(" | "));
const wShort = W.profileWarnings(S.raceById("utmb27"),
  { name: "测试", idNo: "X", trailMax: "50", trailMaxDate: "2026-01-01", itra: "500", medDate: "2026-06-01" });
ok("越野距离不足时提示补齐", wShort.some(x => x.indexOf("171K") >= 0 && x.indexOf("50") >= 0), wShort.join(" | ").slice(0, 140));
const wItra = W.profileWarnings(S.raceById("cgts26"), { name: "测试", idNo: "X", trailMax: "120", itra: "240", medDate: "2026-06-01" });
ok("ITRA 低于门槛时告警", wItra.some(x => x.indexOf("ITRA 表现分") >= 0 && x.indexOf("260") >= 0), wItra.join(" | ").slice(0, 140));

/* --- 档案表单含越野字段 --- */
A.setTab("profile");
const fieldCount = (cap["#pForm"] || "").split('class="field"').length - 1;
ok("档案字段 33 项(含越野 4 项)", fieldCount === 33, fieldCount);
ok("档案表单含最长越野完赛", (cap["#pForm"] || "").indexOf('id="f_trailMax"') >= 0);
ok("档案表单含 ITRA 表现分", (cap["#pForm"] || "").indexOf('id="f_itra"') >= 0);

/* --- 自建赛事:类型 + 距离 --- */
A.setTab("lib");
A.setLib({ kind: "" });
const n0 = S.allRaces().length;
const cr = S.addCustomRace({ name: "自建越野测试", raceDate: "2027-05-01", kind: "trail", dist: "50K" });
ok("自建赛事默认进入目录", S.allRaces().length === n0 + 1);
ok("自建赛事默认 kind=road", (function () { const c2 = S.addCustomRace({ name: "自建路跑" }); const r = S.raceById(c2.id).kind === "road"; S.removeCustomRace(c2.id); return r; })());
ok("自建赛事可标 trail", S.raceById(cr.id).kind === "trail");
A.setTab("lib");
A.setLib({ kind: "trail" });
ok("自建越野出现在越野筛选里", (cap["#libGrid"] || "").indexOf("自建越野测试") >= 0);
A.setLib({ kind: "" });
S.removeCustomRace(cr.id);
ok("删除后目录复原", S.allRaces().length === n0);

/* --- store.stats 类型统计 --- */
const st = S.stats();
ok("stats 提供 road/trail 计数", st.road === 24 && st.trail === 36, JSON.stringify({ road: st.road, trail: st.trail }));

/* --- ICS:越野赛 --- */
const ics = W.buildICS([S.raceById("utmb27")], null);
ok("越野 ICS 生成事件", (ics.match(/BEGIN:VEVENT/g) || []).length >= 1);
ok("越野 ICS 结构闭合", (ics.match(/BEGIN:VEVENT/g) || []).length === (ics.match(/END:VEVENT/g) || []).length);

/* --- ME.mergeStates: 云端合并(隐私安全,不碰 profile) --- */
const MG = W.mergeStates;
let m1 = MG(
  { watching: { r1: { status: "paid", updatedAt: "2026-10-01T00:00:00Z" } } },
  { watching: { r1: { status: "watching", updatedAt: "2026-10-05T00:00:00Z" }, r2: { status: "watching" } } }
);
ok("watching 并集两场", Object.keys(m1.watching).length === 2);
ok("watching 冲突取较新(云端)", m1.watching.r1.status === "watching");
let m2 = MG(
  { watching: { r1: { status: "paid", updatedAt: "2026-10-09T00:00:00Z" } } },
  { watching: { r1: { status: "watching", updatedAt: "2026-10-05T00:00:00Z" } } }
);
ok("watching 本地较新保留本地", m2.watching.r1.status === "paid");
let m3 = MG({ checklists: { r1: { a: true } } }, { checklists: { r1: { b: true } } });
ok("checklists 并集两项且都为 true", Object.keys(m3.checklists.r1).length === 2 && m3.checklists.r1.a && m3.checklists.r1.b);
let m4 = MG({ settings: { leadDays: 7, email: "a@x.com" } }, { settings: { leadDays: 3, email: "b@x.com" } });
ok("settings 本地优先", m4.settings.leadDays === 7 && m4.settings.email === "a@x.com");
let m5 = MG({ custom: [{ id: "c1", name: "本地自建" }] }, { custom: [{ id: "c2", name: "云端自建" }] });
ok("custom 两方向并集", m5.custom.length === 2 && m5.custom.some(r => r.id === "c1") && m5.custom.some(r => r.id === "c2"));
let m6 = MG({ watching: { r9: { status: "watching" } } }, {});
ok("空云端返回本地", m6.watching.r9 && Object.keys(m6.watching).length === 1);

/* --- store seam: toSyncBlob 绝不含 profile / account --- */
S.resetAll();
S.state.profile = { name: "张三", idNo: "110101199001011234", phone: "13800000000" };
S.state.account = { nickname: "本地昵称", provider: "local" };
S.watch("bj26"); S.toggleCheck("bj26", "gear");
const blob = S.toSyncBlob();
ok("toSyncBlob 不含 profile(隐私红线)", !("profile" in blob));
ok("toSyncBlob 不含 account(本机身份)", !("account" in blob));
ok("toSyncBlob 含 watching", !!(blob.watching && blob.watching.bj26));
ok("toSyncBlob 含 checklists", !!(blob.checklists && blob.checklists.bj26 && blob.checklists.bj26.gear));
const beforeProfile = JSON.stringify(S.state.profile);
S.applySyncBlob({ watching: { sh27: { status: "watching" } }, checklists: {}, settings: {}, custom: [] });
ok("applySyncBlob 不动 profile", JSON.stringify(S.state.profile) === beforeProfile);
ok("applySyncBlob 写入 watching", S.isWatched("sh27"));
S.resetAll();

console.log("\n========== " + pass + " 通过 / " + fail + " 失败 ==========");
process.exit(fail ? 1 : 0);
