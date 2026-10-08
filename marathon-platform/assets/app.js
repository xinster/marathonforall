/* =========================================================================
   app.js — 界面层
   -------------------------------------------------------------------------
   所有状态判断都走 assets/engine.js,所有数据读写都走 assets/store.js。
   本文件只负责「把数据画出来」和「把点击变成数据变更」。
   ========================================================================= */
(function () {
  "use strict";

  var ME = window.ME, S = window.Store, Auth = window.Auth, Cloud = window.Cloud, MCrypto = window.MCrypto;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = ME.esc;

  var USER_STATUS = [
    ["watching", "关注中"],
    ["submitted", "已提交报名"],
    ["won", "已中签"],
    ["paid", "已缴费"],
    ["lost", "未中签"],
    ["skipped", "已放弃"]
  ];
  var STATUS_NAME = {};
  USER_STATUS.forEach(function (p) { STATUS_NAME[p[0]] = p[1]; });

  var REGIONS = ["中国", "亚洲", "欧洲", "北美", "大洋洲", "非洲", "南美"];
  /* 赛事级别标记 —— 路跑与越野是两套完全不同的体系,不能混用:
     路跑看世界田联标牌与大满贯,越野看 UTMB 世界系列赛与世界越野大满贯。 */
  var TIER_MARK = {
    /* 路跑 */
    maj: "世界大满贯", platinum: "白金标", gold: "金标", elite: "精英标", label: "标牌",
    candidate: "大满贯候选",
    /* 越野 */
    utmbfinal: "UTMB 总决赛", utmbws: "UTMB 世界系列赛", wtm: "世界越野大满贯",
    wmtrc: "世界锦标赛", classic: "经典超长越野",
    std: ""
  };
  /* 两大类赛事(马拉松/路跑 与 越野赛)在赛制、资格与材料上完全不是一回事,
     所以从赛事库、我的关注到看板一律按类别分开呈现,而不是混在一个列表里。 */
  var KIND_ORDER = ["road", "trail"];
  var KIND_META = {
    road: {
      label: "马拉松 / 路跑", short: "马拉松 · 路跑", icon: "🏃",
      desc: "赛制:抽签 / 先到先得 / 成绩达标 · 资格看 24 个月内的全马或半马成绩 · 材料:体检 + 完赛证明"
    },
    trail: {
      label: "越野赛", short: "越野赛", icon: "🏔",
      desc: "赛制:ITRA 表现分门槛 / 跑石 + UTMB 指数 / 资格赛制 · 资格看同类距离的山地完赛记录 · 追加强制装备与夜间行进"
    }
  };
  var CONF_NOTE = {
    official: "官方公告",
    reported: "媒体多源",
    projected: "按往年推算",
    manual: "手动录入",
    unknown: "待公布"
  };

  var tab = "dash";
  var lib = { q: "", kind: "", region: "", month: "", mode: "", onlyWatch: false, phase: "all" };
  var mine = { kind: "" };

  /* ---------------------------------------------------------------- 基础 */

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || "已复制到剪贴板"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { toast("复制失败,请手动选择文本"); }
      document.body.removeChild(ta);
    }
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* ------------------------------------------------------- 弹出层(通用) */

  function showModal(html, wide) {
    $("#modalBox").className = "modal-box" + (wide ? " wide" : "");
    $("#modalBox").innerHTML = html;
    $("#modal").classList.add("on");
  }
  function hideModal() { $("#modal").classList.remove("on"); }

  /* ------------------------------------------------------------ 计算层 */

  function now() { return new Date(); }

  function computed() {
    var n = now();
    return S.watchedRaces().map(function (r) {
      var s = ME.computeStatus(r, n);
      return { race: r, s: s, warn: ME.profileWarnings(r, S.state.profile), prog: S.checklistProgress(r) };
    });
  }

  var ORDER = {
    pay: 0, drawdone: 1, closing: 2, soon: 3, open: 4, opendeadline: 5, waitdraw: 6,
    pending: 7, racing: 8, notopen: 9, unknown: 10, closed: 11, lost: 12, done: 13, skipped: 14
  };
  var ACTION_KEYS = ["pay", "drawdone", "closing", "soon", "open", "opendeadline", "waitdraw"];

  function sorted(list) {
    return list.slice().sort(function (a, b) {
      var d = (ORDER[a.s.key] - ORDER[b.s.key]);
      if (d) return d;
      return (a.s.urg - b.s.urg);
    });
  }

  function urgentList() {
    return sorted(computed()).filter(function (x) { return x.s.urg <= 12; });
  }

  function catalogStatus(race) {
    return ME.computeStatus(S.withStatus(race), now());
  }

  function daysToRace(race) { return ME.dayDiff(race.raceDate, now()); }

  /* ---------------------------------------------------------- 分类 */

  function kindCounts(races) {
    var c = { road: 0, trail: 0 };
    races.forEach(function (r) { var k = ME.kindOf(r); c[k] = (c[k] || 0) + 1; });
    return c;
  }

  /* 类型切换条 —— 赛事库与我的关注共用同一套渲染 */
  function kindTabsHTML(cur, counts, act) {
    var total = (counts.road || 0) + (counts.trail || 0);
    var items = [["", "全部类型", total]];
    KIND_ORDER.forEach(function (k) {
      if (counts[k]) items.push([k, KIND_META[k].short, counts[k]]);
    });
    return items.map(function (it) {
      var on = cur === it[0];
      return '<button type="button" class="kt' + (it[0] ? " kt-" + it[0] : "") + (on ? " on" : "") +
        '" data-act="' + act + '" data-id="' + it[0] + '">' +
        (it[0] ? '<i class="k-dot k-' + it[0] + '"></i>' : "") +
        esc(it[1]) + '<span class="n">' + it[2] + '</span></button>';
    }).join("");
  }

  /* 分区渲染:每一类给一个带标题与说明的区块,而不是混在一张列表里 */
  function kindSecsHTML(list, cardFn, gridCls, order) {
    return (order || KIND_ORDER).map(function (k) {
      var arr = list.filter(function (r) { return ME.kindOf(r) === k; });
      if (!arr.length) return "";
      var m = KIND_META[k];
      return '<section class="kind-sec ks-' + k + '">' +
        '<div class="ks-head"><span class="ks-ic">' + m.icon + '</span>' +
          '<h3>' + esc(m.label) + '<span class="n">' + arr.length + ' 场</span></h3>' +
          '<p class="ks-desc">' + esc(m.desc) + '</p>' +
        '</div>' +
        '<div class="' + gridCls + '">' + arr.map(cardFn).join("") + '</div>' +
      '</section>';
    }).join("");
  }

  /* 看板顶部的分类速览 —— 两类各自关注了多少场、有几场正在窗口里 */
  var KIND_LIVE = ["pay", "drawdone", "closing", "soon", "open", "opendeadline", "waitdraw", "pending"];
  function renderKindBar() {
    var watched = S.watchedRaces();
    if (!watched.length) { $("#kindBar").innerHTML = ""; return; }
    var n = now();
    var html = KIND_ORDER.map(function (k) {
      var arr = watched.filter(function (r) { return ME.kindOf(r) === k; });
      if (!arr.length) return "";
      var live = arr.filter(function (r) {
        return KIND_LIVE.indexOf(ME.computeStatus(S.withStatus(r), n).key) >= 0;
      }).length;
      return '<span class="kb">' +
        '<i class="k-dot k-' + k + '"></i>' + esc(KIND_META[k].label) +
        '<b>' + arr.length + '</b> 场' +
        (live ? '<em>窗口进行中 ' + live + '</em>' : '<em class="off">均未开放</em>') +
      '</span>';
    }).join("");
    $("#kindBar").innerHTML = '<span class="kb-l">已关注按类别</span>' + html;
  }

  /* 赛道播报 —— 把 60 天内的节点压成一条横向滚动条。
     纯装饰性表达,数据完全来自上面同一份 timeline(),不引入新的状态判断。 */
  function renderTicker(tl) {
    var wrap = $("#ticker"), track = $("#tickerTrack");
    if (!wrap || !track) return;
    if (!tl.length) { wrap.classList.remove("on"); track.innerHTML = ""; return; }
    var items = tl.slice(0, 14).map(function (t) {
      return '<span class="tbi">' +
        '<i class="k-dot k-' + ME.kindOf(t.race) + '"></i>' +
        '<b>' + (t.d === 0 ? "今天" : t.d + " 天后") + '</b>' +
        esc(ME.fmtMd(t.date)) + ' · ' + esc(t.race.name) + ' · ' + t.label +
        '</span>';
    }).join("");
    /* 复制一份,首尾相接才能无缝循环 */
    track.innerHTML = items + items;
    wrap.classList.add("on");
  }

  /* ------------------------------------------------------------ 日期轴 */

  function timeline(days) {
    var n = now(), out = [];
    var watched = S.watchedRaces();
    watched.forEach(function (r) {
      [
        ["regOpen", "报名开放", "open", 7],
        ["regClose", "报名截止", "close", 3],
        ["drawDate", "抽签公布", "draw", 1],
        ["payDeadline", "缴费截止", "pay", 3],
        ["raceDate", "比赛日", "race", 1]
      ].forEach(function (f) {
        if (!r[f[0]]) return;
        var d = ME.dayDiff(r[f[0]], n);
        if (d === null || d < 0 || d > days) return;
        out.push({ d: d, date: r[f[0]], kind: f[2], label: f[1], race: r, lead: f[3] });
      });
    });
    out.sort(function (a, b) { return a.d - b.d || a.race.name.localeCompare(b.race.name); });
    return out;
  }

  /* ============================================================ 看板 */

  function renderDash() {
    var n = now();
    $("#todayLabel").textContent =
      n.getFullYear() + " 年 " + (n.getMonth() + 1) + " 月 " + n.getDate() + " 日 " + ME.WD[n.getDay()];

    var all = computed();
    var cnt = function (k) { return all.filter(function (x) { return x.s.key === k; }).length; };
    var urgent = urgentList();

    var kpi = [
      [urgent.length, "需要立刻处理", urgent.length ? "alert" : ""],
      [cnt("pay"), "待缴费(最易丢名额)", cnt("pay") ? "alert" : ""],
      [cnt("drawdone"), "结果待确认", cnt("drawdone") ? "warn" : ""],
      [cnt("closing"), "即将截止", cnt("closing") ? "warn" : ""],
      [cnt("open") + cnt("opendeadline"), "报名中", ""],
      [cnt("soon"), "即将开放", ""],
      [cnt("waitdraw") + cnt("pending"), "等待结果", ""],
      [cnt("notopen") + cnt("unknown"), "未开放", ""]
    ];
    $("#kpis").innerHTML = kpi.map(function (k) {
      return '<div class="kpi ' + k[2] + '"><div class="n">' + k[0] + '</div><div class="l">' + k[1] + '</div></div>';
    }).join("");

    var banner = [];
    if (cnt("pay")) banner.push("有 <b>" + cnt("pay") + "</b> 场已中签待缴费 —— 逾期名额立即释放,请优先处理。");
    if (cnt("drawdone")) banner.push("有 <b>" + cnt("drawdone") + "</b> 场<b>抽签结果已公布</b>但尚未确认 —— 去官网查结果,中签后缴费期通常只有 3–7 天。");
    if (cnt("closing")) banner.push("有 <b>" + cnt("closing") + "</b> 场报名窗口 3 天内关闭。");
    if (cnt("opendeadline")) banner.push("有 <b>" + cnt("opendeadline") + "</b> 场<b>报名中但官方未设截止日</b> —— 这类赛事名额售罄即止,别等。");
    if (cnt("soon")) banner.push("有 <b>" + cnt("soon") + "</b> 场即将开放报名,建议先备齐材料。");
    $("#actionBanner").innerHTML = banner.length ? banner.join(" ")
      : (S.state.watching && Object.keys(S.state.watching).length
        ? "当前没有紧急待办。可以趁这段时间把档案补齐 —— 窗口开启时,资料齐全的人才有机会第一时间提交。"
        : "你还没有关注任何赛事。去<b>「赛事库」</b>挑几场加入关注,系统就会开始为你盯着报名窗口。");

    renderKindBar();

    var tl = timeline(60);
    $("#timelineCount").textContent = tl.length ? tl.length + " 个节点" : "";
    $("#timeline").innerHTML = tl.length ? tl.map(function (t) {
      return '<li class="tl ' + t.kind + '">' +
        '<span class="tl-d">' + (t.d === 0 ? "今天" : t.d + " 天后") + '</span>' +
        '<span class="tl-date">' + ME.fmtMd(t.date) + '</span>' +
        '<span class="tl-l"><i class="k-dot k-' + ME.kindOf(t.race) + '"></i>' + esc(t.race.name) + ' · ' + t.label + '</span>' +
        '<button class="mini" data-act="detail" data-id="' + t.race.id + '">详情</button>' +
        '</li>';
    }).join("") : '<li class="empty">未来 60 天没有已关注赛事的节点。</li>';

    renderTicker(tl);

    var top = sorted(all).slice(0, 6);
    $("#dashTop").innerHTML = top.length ? top.map(card).join("")
      : '<div class="empty big">关注赛事后,这里会按紧迫程度排列你该处理的事。</div>';
  }

  /* ========================================================== 卡片 */

  function card(x) {
    var r = x.race, s = x.s, cls = s.cls;
    var cdTxt = "";
    if (s.cd !== null && s.cd !== undefined) {
      if (s.key === "drawdone") cdTxt = s.cd === 0 ? "今天公布" : "已过 " + s.cd + " 天";
      else cdTxt = s.cd <= 0 ? "就是今天" : s.cd + " " + (s.cdLabel || "");
    }
    var cdDate = s.cdDate ? '<small>(' + ME.fmtMd(s.cdDate) + ')</small>' : "";
    var marks = [];
    if (r.tier && TIER_MARK[r.tier]) marks.push(TIER_MARK[r.tier]);
    marks.push(ME.MODE_LABEL[r.mode] || r.mode);
    if (r.custom) marks.push("自建");
    var kind = ME.kindOf(r);
    /* 任务5 站点侧:报名窗口未公布的赛事打「待公布」标签(引擎驱动,见 ME.isWindowPending) */
    var pendTag = ME.isWindowPending(s.key) ? '<i class="r-pend">待公布</i>' : "";

    return '<article class="race ' + (ME.URG_CLS[s.key] || "u-grey") + '">' +
      '<div class="r-head">' +
        '<span class="r-badge">' + esc(s.label) + '</span>' +
        (cdTxt ? '<span class="r-cd">' + cdTxt + ' ' + cdDate + '</span>' : '') +
      '</div>' +
      '<h4 class="r-name"><span class="k-dot k-' + kind + '"></span>' + esc(r.name) + '</h4>' +
      '<div class="r-meta">' +
        '<span>' + esc(r.region) + (r.city ? " · " + esc(r.city) : "") + '</span>' +
        '<span>比赛日 ' + ME.fmtMd(r.raceDate) + (daysToRace(r) >= 0 ? ' · ' + daysToRace(r) + ' 天后' : '') + '</span>' +
      '</div>' +
      (r.dist ? '<div class="lc-dist">' + esc(r.dist) + '</div>' : '') +
      '<div class="r-tags"><i class="k-tag k-' + kind + '">' + esc(ME.KIND_LABEL[kind]) + '</i>' +
        marks.map(function (m) { return '<i>' + esc(m) + '</i>'; }).join("") + pendTag + '</div>' +
      (s.note ? '<p class="r-note">' + s.note + '</p>' : '') +
      (x.warn && x.warn.length ? '<p class="r-warn">材料提醒:' + esc(x.warn[0]) + (x.warn.length > 1 ? " 等 " + x.warn.length + " 项" : "") + '</p>' : '') +
      '<div class="r-prog"><div class="bar"><i style="width:' + x.prog.pct + '%"></i></div>' +
        '<span>' + x.prog.ok + '/' + x.prog.total + ' 材料就绪</span></div>' +
      '<div class="r-acts">' +
        '<button class="mini primary" data-act="open" data-id="' + r.id + '">去官网报名</button>' +
        '<button class="mini" data-act="copy" data-id="' + r.id + '">复制资料</button>' +
        '<button class="mini" data-act="detail" data-id="' + r.id + '">详情</button>' +
        '<button class="mini" data-act="check" data-id="' + r.id + '">材料清单</button>' +
      '</div>' +
    '</article>';
  }

  /* ========================================================== 赛事库 */

  function catalogBase() {
    var q = lib.q.trim().toLowerCase();
    return S.allRaces().filter(function (r) {
      if (lib.kind && ME.kindOf(r) !== lib.kind) return false;
      if (lib.region && r.region !== lib.region) return false;
      if (lib.mode && r.mode !== lib.mode) return false;
      if (lib.month) {
        var d = ME.parseDT(r.raceDate);
        if (!d || (d.getMonth() + 1) !== Number(lib.month)) return false;
      }
      if (lib.onlyWatch && !S.isWatched(r.id)) return false;
      if (q) {
        var hay = [r.name, r.city, r.region, r.nameEn, r.en, r.dist,
                   ME.KIND_LABEL[ME.kindOf(r)], ME.MODE_LABEL[r.mode]].filter(Boolean).join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      var da = ME.parseDT(a.raceDate), db = ME.parseDT(b.raceDate);
      if (!da) return 1; if (!db) return -1;
      return da - db;
    });
  }

  /* 报名阶段过滤:按引擎 ME.phaseOf 归类(红线 4 —— 分类必须由引擎驱动)。
     phase="all" 即不过滤;open=报名中;closed=已截止。 */
  function filteredCatalog() {
    var base = catalogBase();
    if (lib.phase && lib.phase !== "all") {
      return base.filter(function (r) { return ME.phaseOf(catalogStatus(r).key) === lib.phase; });
    }
    return base;
  }

  /* 赛事库阶段切换条:全部 / 报名中 / 已截止(数字跟随其它筛选条件实时变化) */
  function phaseTabsHTML(cur, cnt) {
    var items = [["all", "全部", cnt.open + cnt.closed + cnt.other],
                 ["open", "报名中", cnt.open],
                 ["closed", "已截止", cnt.closed]];
    return items.map(function (it) {
      var on = cur === it[0];
      return '<button type="button" class="lib-pbtn' + (on ? " on" : "") + '" data-act="libphase" data-id="' + it[0] + '">' +
        esc(it[1]) + '<span class="n">' + it[2] + '</span></button>';
    }).join("");
  }

  function renderLib() {
    var base = catalogBase();
    var cnt = { open: 0, closed: 0, other: 0 };
    base.forEach(function (r) { cnt[ME.phaseOf(catalogStatus(r).key)]++; });
    $("#libPhase").innerHTML = phaseTabsHTML(lib.phase, cnt);

    var list = filteredCatalog();
    $("#libCount").textContent = "共 " + list.length + " 场";

    var months = {};
    S.allRaces().forEach(function (r) {
      var d = ME.parseDT(r.raceDate);
      if (d) months[d.getMonth() + 1] = (months[d.getMonth() + 1] || 0) + 1;
    });
    $("#fMonth").innerHTML = '<option value="">全部月份</option>' +
      Object.keys(months).sort(function (a, b) { return a - b; }).map(function (m) {
        return '<option value="' + m + '"' + (lib.month === m ? " selected" : "") + '>' + m + " 月 (" + months[m] + ")</option>";
      }).join("");

    /* 类型切换条:全部 / 马拉松·路跑(24) / 越野赛(36) */
    $("#kindTabs").innerHTML = kindTabsHTML(lib.kind, kindCounts(S.allRaces()), "kindfilter");

    $("#fRegion").innerHTML = '<option value="">全部地区</option>' +
      REGIONS.filter(function (g) { return S.allRaces().some(function (r) { return r.region === g; }); })
        .map(function (g) { return '<option value="' + g + '"' + (lib.region === g ? " selected" : "") + '>' + g + '</option>'; }).join("");
    $("#fMode").innerHTML = '<option value="">全部赛制</option>' +
      Object.keys(ME.MODE_LABEL).map(function (k) {
        return '<option value="' + k + '"' + (lib.mode === k ? " selected" : "") + '>' + ME.MODE_LABEL[k] + '</option>';
      }).join("");

    /* 分类分区展示:选了某一类就只渲染那一区,选「全部」则两类各成一区 */
    $("#libGrid").innerHTML = list.length
      ? kindSecsHTML(list, libCard, "lib-grid", lib.kind ? [lib.kind] : KIND_ORDER)
      : '<div class="empty big">没有符合条件的赛事。试试放宽筛选,或点「自建赛事」手动添加。</div>';
  }

  function libCard(r) {
    var s = catalogStatus(r);
    var w = S.isWatched(r.id);
    var conf = CONF_NOTE[r.confidence] || "";
    var kind = ME.kindOf(r);
    var marks = [];
    if (r.tier && TIER_MARK[r.tier]) marks.push(TIER_MARK[r.tier]);
    marks.push(ME.MODE_LABEL[r.mode] || r.mode);

    return '<article class="lib-card ' + (ME.URG_CLS[s.key] || "u-grey") + (w ? " watched" : "") + '">' +
      '<div class="lc-head">' +
        '<span class="r-badge">' + esc(s.label) + '</span>' +
        (w ? '<span class="lc-w">已关注</span>' : '') +
      '</div>' +
      '<h4><span class="k-dot k-' + kind + '"></span>' + esc(r.name) + '</h4>' +
      '<div class="r-meta"><span>' + esc(r.region) + (r.city ? " · " + esc(r.city) : "") + '</span>' +
        '<span>' + ME.weekday(r.raceDate) + ' ' + ME.fmtMd(r.raceDate) + '</span></div>' +
      (r.dist ? '<div class="lc-dist">' + esc(r.dist) + '</div>' : '') +
      '<div class="r-tags"><i class="k-tag k-' + kind + '">' + esc(ME.KIND_LABEL[kind]) + '</i>' +
        marks.map(function (m) { return '<i>' + esc(m) + '</i>'; }).join("") + '</div>' +
      '<dl class="lc-dates">' +
        dl("报名开放", r.regOpen, conf) + dl("报名截止", r.regClose) +
        dl("抽签公布", r.drawDate) + dl("缴费截止", r.payDeadline) +
      '</dl>' +
      (s.cd !== null && s.cd !== undefined && ["open", "closing", "soon", "drawdone", "pay"].indexOf(s.key) >= 0
        ? '<p class="lc-cd">' + (s.key === "drawdone"
            ? (s.cd === 0 ? "⚠️ 今天公布抽签结果" : "⚠️ 结果已公布 " + s.cd + " 天,尚未确认")
            : (s.cd <= 0 ? "就是今天" : "还有 " + s.cd + " 天")) + '</p>'
        : (s.key === "opendeadline" ? '<p class="lc-cd">⚠️ 报名中但未设截止日 —— 售罄即止</p>' : '')) +
      '<div class="r-acts">' +
        '<button class="mini ' + (w ? "" : "primary") + '" data-act="' + (w ? "unwatch" : "watch") + '" data-id="' + r.id + '">' +
          (w ? "取消关注" : "加入关注") + '</button>' +
        '<button class="mini" data-act="open" data-id="' + r.id + '">官网</button>' +
        (r.custom ? '<button class="mini danger" data-act="delrace" data-id="' + r.id + '">删除</button>' : '') +
      '</div>' +
    '</article>';
  }

  function dl(label, v, conf) {
    return '<div><dt>' + label + '</dt><dd>' +
      (v ? esc(ME.fmtDate(v, true)) : '<span class="tbd">' + (conf ? esc(conf) : "待公布") + '</span>') +
      '</dd></div>';
  }

  /* ====================================================== 我的关注 */

  function renderMine() {
    var all = sorted(computed());
    var watched = S.watchedRaces();
    $("#mineKind").innerHTML = watched.length
      ? kindTabsHTML(mine.kind, kindCounts(watched), "minekind") : "";

    if (!all.length) {
      $("#mineWrap").innerHTML = '<div class="empty big">还没有关注的赛事。<br>去「赛事库」挑几场,系统会持续盯着它们的报名窗口、抽签日和缴费截止。</div>';
      return;
    }

    var list = mine.kind ? all.filter(function (x) { return ME.kindOf(x.race) === mine.kind; }) : all;
    if (!list.length) {
      $("#mineWrap").innerHTML = '<div class="empty big">你关注的赛事里暂时没有「' +
        esc(KIND_META[mine.kind].label) + '」。切回「全部类型」可以看另外一类。</div>';
      return;
    }

    var groups = [
      ["需要行动", ACTION_KEYS],
      ["进行中 · 已锁定 · 待结果", ["racing", "pending"]],
      /* 未开放 / 窗口未记录 的赛事过去不在任何分组里 —— 用户明明关注了,
         却在「我的关注」里看不到,只能靠赛事库再搜一次。越野赛大量处于
         「窗口未公布」状态,这个漏洞会被放大,必须单列一组兜住。 */
      ["待开放 · 窗口待公布", ["notopen", "unknown"]],
      ["已结束", ["closed", "lost", "done", "skipped"]]
    ];
    $("#mineWrap").innerHTML = groups.map(function (g) {
      var arr = list.filter(function (x) { return g[1].indexOf(x.s.key) >= 0; });
      if (!arr.length) return "";
      return '<section class="grp"><h3>' + g[0] + '<span class="n">' + arr.length + '</span>' +
        kindSplit(arr) + '</h3>' +
        '<div class="grid">' + arr.map(card).join("") + '</div></section>';
    }).join("");
  }

  /* 分组标题里带上两类各几场 —— 只有混在一起时才需要说明 */
  function kindSplit(arr) {
    var c = kindCounts(arr.map(function (x) { return x.race; }));
    if (!c.road || !c.trail) return "";
    return '<span class="kd">' +
      '<i class="k-dot k-road"></i>' + KIND_META.road.short + ' ' + c.road +
      '<i class="k-dot k-trail"></i>' + KIND_META.trail.short + ' ' + c.trail +
    '</span>';
  }

  /* ========================================================= 档案 */

  var FIELDS = [
    ["name", "姓名", "text"], ["nameEn", "拼音 / 英文名", "text"],
    ["gender", "性别", "select:男|女"], ["birth", "出生日期", "date"],
    ["idType", "证件类型", "select:身份证|护照|港澳通行证|台胞证"], ["idNo", "证件号码", "text"],
    ["phone", "手机号", "tel"], ["email", "邮箱", "email"],
    ["country", "国家 / 地区", "text"], ["city", "常住城市", "text"],
    ["blood", "血型", "text"], ["shirt", "参赛服尺码", "text"],
    ["shoe", "鞋码", "text"], ["travel", "是否接受异地参赛", "select:愿意|仅本地|视情况"],
    ["ecName", "紧急联系人", "text"], ["ecRel", "与本人关系", "text"],
    ["ecPhone", "紧急联系人电话", "tel"],
    ["pbFull", "全马最好成绩", "text"], ["pbFullRace", "全马成绩出自赛事", "text"],
    ["pbFullDate", "全马成绩日期", "text"],
    ["pbHalf", "半马最好成绩", "text"], ["pbHalfRace", "半马成绩出自赛事", "text"],
    ["pbHalfDate", "半马成绩日期", "text"],
    ["trailMax", "最长越野完赛(公里)", "text"], ["trailMaxRace", "该越野成绩出自赛事", "text"],
    ["trailMaxDate", "该越野成绩日期", "date"], ["itra", "ITRA 表现分", "text"],
    ["medDate", "最近体检日期", "date"], ["medMonths", "体检有效期(月)", "number"],
    ["certPlace", "成绩证书存放位置", "text"], ["budget", "单场预算", "text"],
    ["radius", "可接受出行半径", "text"], ["notes", "备注", "text"]
  ];

  function renderProfileForm() {
    var p = S.state.profile;
    $("#pForm").innerHTML = FIELDS.map(function (f) {
      var key = f[0], label = f[1], kind = f[2], val = p[key] == null ? "" : p[key];
      var input;
      if (kind.indexOf("select:") === 0) {
        var opts = kind.slice(7).split("|");
        input = '<select id="f_' + key + '"><option value=""></option>' + opts.map(function (o) {
          return '<option value="' + esc(o) + '"' + (String(val) === o ? " selected" : "") + '>' + esc(o) + '</option>';
        }).join("") + '</select>';
      } else {
        input = '<input id="f_' + key + '" type="' + (kind === "number" ? "number" : kind) + '" value="' + esc(val) + '">';
      }
      return '<label class="field"><span>' + esc(label) + '</span>' + input + '</label>';
    }).join("");
  }

  function readProfileForm() {
    var p = {};
    FIELDS.forEach(function (f) { p[f[0]] = $("#f_" + f[0]).value; });
    return p;
  }

  function renderProfileSide() {
    var p = S.state.profile;
    var age = ME.ageFromBirth(p.birth);
    var missing = [];
    if (!p.name) missing.push("姓名");
    if (!p.idNo) missing.push("证件号码");
    if (!p.phone) missing.push("手机号");
    if (!p.email) missing.push("邮箱");
    if (!p.ecName) missing.push("紧急联系人");
    if (!p.ecPhone) missing.push("紧急联系人电话");
    var hasProof = (p.pbFull && p.pbFullDate) || (p.pbHalf && p.pbHalfDate);
    if (!hasProof) missing.push("24 个月内完赛证明");
    if (!p.trailMax) missing.push("越野完赛记录");
    if (!p.medDate) missing.push("体检日期");

    var pct = Math.round((FIELDS.length - missing.length) / FIELDS.length * 100);
    var std = null;
    if (age !== null) {
      var STDS = [[34, "2:50:00"], [39, "3:00:00"], [44, "3:05:00"], [49, "3:15:00"], [54, "3:20:00"],
                  [59, "3:30:00"], [64, "3:50:00"], [69, "4:05:00"], [74, "4:20:00"], [79, "4:35:00"], [999, "4:50:00"]];
      std = STDS.filter(function (s) { return age <= s[0]; })[0];
    }

    /* 路跑看全马成绩,越野看最长越野完赛与 ITRA 分 —— 两套资历分开呈现 */
    var watched = S.watchedRaces();
    var nRoad = watched.filter(function (r) { return ME.kindOf(r) === "road"; }).length;
    var nTrail = watched.length - nRoad;

    var rows = [];
    rows.push('<div class="side-row"><span>档案完整度</span><b>' + pct + '%</b></div>');
    rows.push('<div class="bar"><i style="width:' + pct + '%"></i></div>');
    if (age !== null) rows.push('<div class="side-row"><span>当前年龄</span><b>' + age + ' 岁</b></div>');
    if (std) rows.push('<div class="side-row"><span>' + age + ' 岁组达标线(男子参照)</span><b>' + std[1] + '</b></div>');
    if (p.medDate) {
      var d = ME.parseDT(p.medDate), mo = Number(p.medMonths) || 12;
      if (d) {
        var exp = new Date(d.getFullYear(), d.getMonth() + mo, d.getDate());
        var left = Math.round((exp - new Date()) / ME.MS_DAY);
        rows.push('<div class="side-row"><span>体检报告</span><b class="' + (left < 0 ? "bad" : left <= 45 ? "warn" : "good") + '">' +
          (left < 0 ? "已过期" : "还剩 " + left + " 天") + '</b></div>');
      }
    }
    if (p.pbFull) rows.push('<div class="side-row"><span>全马最好成绩</span><b>' + esc(p.pbFull) + '</b></div>');
    if (p.pbHalf) rows.push('<div class="side-row"><span>半马最好成绩</span><b>' + esc(p.pbHalf) + '</b></div>');
    if (p.trailMax) rows.push('<div class="side-row"><span>最长越野完赛</span><b>' + esc(p.trailMax) + ' 公里</b></div>');
    if (p.itra) rows.push('<div class="side-row"><span>ITRA 表现分</span><b>' + esc(p.itra) + '</b></div>');
    if (watched.length) {
      rows.push('<div class="side-row"><span>已关注</span><b>' + watched.length + ' 场(路跑 ' + nRoad + ' · 越野 ' + nTrail + ')</b></div>');
    }

    /* 越野赛的门槛和路跑完全不同,单独给一条提示 */
    var trailTip = nTrail
      ? '<div class="side-missing"><b>越野赛额外要求</b><p>强制装备需逐项核对(头灯/救生毯/冲锋衣/哨子/水袋);ITRA 表现分与 UTMB 指数是报名硬门槛,马拉松成绩不能替代。</p></div>'
      : "";

    $("#pSide").innerHTML = rows.join("") +
      (missing.length ? '<div class="side-missing"><b>还缺 ' + missing.length + ' 项</b><p>' + esc(missing.join("、")) + '</p></div>'
        : '<div class="side-missing ok"><b>材料已齐</b><p>报名窗口开启时可直接提交。</p></div>') +
      trailTip +
      '<button class="mini" data-act="copyprofile">复制全部资料</button>';
  }

  /* ====================================================== 加密备份(A 路线)
     把整份本机数据(含证件字段)用用户口令加密成文件带走;导入时凭口令解密。
     密钥只在本机由口令派生,平台/云端看不到明文。file:// 下 Web Crypto 不可用,
     此时禁用并提示改用 https / localhost。 */

  var pendingEnc = { mode: null, text: null };

  function encAvail() { return !!(MCrypto && MCrypto.isAvailable && MCrypto.isAvailable()); }

  function openEncModal(mode) {
    if (!encAvail()) { toast("请通过 https 或 localhost 访问以启用加密备份"); return; }
    pendingEnc.mode = mode;
    var title = $("#encTitle"), tip = $("#encTip"), p2 = $("#encPass2"), warn = $("#encWarn");
    warn.textContent = "";
    $("#encPass").value = "";
    if (mode === "export") {
      title.textContent = "设置加密口令";
      tip.textContent = "这个口令用于加密整份备份文件;口令遗忘将无法恢复,请务必记牢。";
      p2.hidden = false;
    } else {
      title.textContent = "输入备份口令";
      tip.textContent = "输入导出该备份时设置的口令以解密并恢复本机数据。";
      p2.hidden = true;
    }
    $("#encModal").hidden = false;
    setTimeout(function () { $("#encPass").focus(); }, 30);
  }

  function closeEncModal() {
    $("#encModal").hidden = true;
    pendingEnc.mode = null;
    pendingEnc.text = null;
  }

  function encOk() {
    var pass = $("#encPass").value;
    var warn = $("#encWarn");
    if (!pass) { warn.textContent = "请输入口令"; return; }
    if (pendingEnc.mode === "export") {
      if (pass !== $("#encPass2").value) { warn.textContent = "两次输入的口令不一致"; return; }
      S.exportEncrypted(pass).then(function (cipher) {
        download("marathon-secure-backup-" + stamp() + ".json", JSON.stringify(cipher, null, 2), "application/json");
        closeEncModal();
        toast("已导出加密备份文件");
      }).catch(function (e) { warn.textContent = e.message; });
    } else if (pendingEnc.mode === "import") {
      if (!pendingEnc.text) { closeEncModal(); return; }
      S.importEncrypted(pendingEnc.text, pass).then(function () {
        closeEncModal();
        render();
        toast("已从加密备份恢复");
      }).catch(function (e) { warn.textContent = e.message; });
    }
  }

  /* ====================================================== 提醒与导出 */

  function renderNotify() {
    var st = S.state.settings;
    var ch = st.channels;
    var rows = [
      ["browser", "浏览器通知", "本机弹窗提醒。需要你授权,且本页面处于打开或已安装到桌面时有效。", true],
      ["ics", "日历订阅(ICS)", "把报名开放、截止、抽签、缴费、比赛日导成日历文件,导入手机后由系统提醒。完全可靠,不依赖任何服务。", true],
      ["email", "邮件摘要", "每天早上把「今天该做什么」发到你的邮箱。", false],
      ["wechat", "微信提醒", "通过微信直接触达,到达率最高。", false]
    ];
    $("#chList").innerHTML = rows.map(function (r) {
      var key = r[0], on = !!ch[key], usable = r[3];
      return '<div class="ch ' + (usable ? "" : "locked") + '">' +
        '<label class="ch-sw"><input type="checkbox" data-ch="' + key + '"' + (on ? " checked" : "") +
          (usable ? "" : " disabled") + '><i></i></label>' +
        '<div class="ch-body"><b>' + r[1] + (usable ? "" : '<span class="tag-lock">需开启后端</span>') + '</b><p>' + r[2] + '</p>' +
        (key === "email" ? '<input class="ch-in" id="chEmail" placeholder="你的邮箱地址"' +
          (st.email ? ' value="' + esc(st.email) + '"' : "") + (usable ? "" : " disabled") + '>' : "") +
        '</div></div>';
    }).join("");

    var n = now();
    var due = computed().filter(function (x) { return x.s.urg <= 12; });
    $("#notifyPreview").innerHTML = due.length
      ? '<p class="np-lead">如果现在推送,你会收到 <b>' + due.length + '</b> 条:</p>' +
        due.map(function (x) {
          var k = ME.kindOf(x.race);
          return '<div class="np-item ' + x.s.cls + '"><b>' + esc(x.race.name) + '</b>' +
            '<i class="k-tag k-' + k + '">' + esc(ME.KIND_LABEL[k]) + '</i>' +
            ' · ' + esc(x.s.label) +
            (x.s.cd !== null && x.s.cd !== undefined ? ' · ' + (x.s.cd <= 0 ? "就是今天" : x.s.cd + " " + (x.s.cdLabel || "")) : "") +
            (x.s.cdDate ? ' <small>' + ME.fmtMd(x.s.cdDate) + '</small>' : '') + '</div>';
        }).join("")
      : '<p class="np-lead">当前没有需要推送的紧急事项。系统只在你真正需要行动时才打扰你。</p>';

    var nW = S.watchedRaces().length;
    $("#icsInfo").textContent = nW ? "将导出 " + nW + " 场已关注赛事的全部关键日期(含提前提醒)" : "先关注赛事才能导出";
    $("#icsAll").disabled = !nW;
  }

  /* ============================================================ 动作 */

  function openDetail(id) {
    var r = S.raceById(id); if (!r) return;
    var rr = S.withStatus(r);
    var s = ME.computeStatus(rr, now());
    var list = ME.buildChecklist(r, S.state.profile);
    var done = S.checklistOf(id);
    var prog = S.checklistProgress(r);

    var dates = [["报名开放", r.regOpen], ["报名截止", r.regClose], ["抽签公布", r.drawDate],
                 ["缴费截止", r.payDeadline], ["比赛日", r.raceDate]]
      .map(function (d) {
        var dd = d[1] ? ME.dayDiff(d[1], now()) : null;
        return '<li><span>' + d[0] + '</span><b>' + (d[1] ? ME.fmtDate(d[1], true) + " " + ME.WD[ME.parseDT(d[1]).getDay()] : "待公布") + '</b>' +
          (dd !== null && dd >= 0 ? '<i>' + (dd === 0 ? "今天" : dd + " 天后") + '</i>' : "") + '</li>';
      }).join("");

    showModal(
      '<div class="m-head"><div><span class="r-badge ' + (ME.URG_CLS[s.key] || "") + '">' + esc(s.label) + '</span>' +
      '<h3>' + esc(r.name) + '</h3><p class="m-sub">' + esc(ME.KIND_LABEL[ME.kindOf(r)]) + ' · ' +
      esc(r.region) + (r.city ? " · " + esc(r.city) : "") +
      ' · ' + esc(ME.MODE_LABEL[r.mode] || "") + (r.tier && TIER_MARK[r.tier] ? " · " + TIER_MARK[r.tier] : "") + '</p>' +
      (r.dist ? '<p class="m-sub">组别与距离:' + esc(r.dist) + (r.quota ? " · 规模 " + esc(r.quota) : "") + '</p>' : '') +
      '</div>' +
      '<button class="x" data-act="close">×</button></div>' +

      (s.note ? '<p class="m-note">' + s.note + '</p>' : '') +
      (ME.MODE_TIP[r.mode] ? '<p class="m-tip">' + esc(ME.MODE_TIP[r.mode]) + '</p>' : '') +

      '<div class="m-cols">' +
        '<div><h5>关键日期</h5><ul class="m-dates">' + dates + '</ul>' +
          '<p class="m-conf">日期可信度:' + esc(CONF_NOTE[r.confidence] || "未知") + ' —— 以组委会官方公告为准。</p></div>' +
        '<div><h5>材料清单 <span class="pill">' + prog.ok + '/' + prog.total + '</span></h5>' +
          '<ul class="m-chk">' + list.map(function (i) {
            return '<li><label><input type="checkbox" data-chk="' + esc(i.k) + '"' + (done[i.k] ? " checked" : "") + '>' +
              '<span><b>' + esc(i.t) + '</b><i>' + esc(i.why) + '</i></span></label></li>';
          }).join("") + '</ul></div>' +
      '</div>' +

      (function () {
        var w = ME.profileWarnings(r, S.state.profile);
        return w.length ? '<div class="m-warn"><b>档案提醒</b><ul>' + w.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul></div>' : "";
      })() +

      '<div class="m-acts">' +
        '<label class="m-stat">我的进度<select data-status-of="' + id + '">' +
          USER_STATUS.map(function (o) {
            return '<option value="' + o[0] + '"' + (rr.userStatus === o[0] ? " selected" : "") + '>' + o[1] + '</option>';
          }).join("") + '</select></label>' +
        '<button class="mini primary" data-act="open" data-id="' + id + '">去官网</button>' +
        '<button class="mini" data-act="copy" data-id="' + id + '">复制报名资料</button>' +
        '<button class="mini" data-act="ics1" data-id="' + id + '">导出到日历</button>' +
        '<button class="mini" data-act="' + (S.isWatched(id) ? "unwatch" : "watch") + '" data-id="' + id + '">' +
          (S.isWatched(id) ? "取消关注" : "加入关注") + '</button>' +
      '</div>',
      true
    );
    $("#modalBox").dataset.raceId = id;
  }

  function doOpen(id) {
    var r = S.raceById(id); if (!r) return;
    window.open(r.url, "_blank", "noopener");
    /* C+ 报名预填辅助:点「去官网报名」即复制资料 + 跳官网,带去粘贴即可 */
    copyText(ME.profileBlock(r, S.state.profile), "已打开官网,报名资料已复制,直接粘贴即可");
    var w = ME.profileWarnings(r, S.state.profile);
    if (w.length) toast("注意:" + w[0]);
  }

  function openChecklist(id) {
    var r = S.raceById(id); if (!r) return;
    var list = ME.buildChecklist(r, S.state.profile);
    var done = S.checklistOf(id);
    var prog = S.checklistProgress(r);
    showModal(
      '<div class="m-head"><div><h3>材料清单</h3><p class="m-sub">' + esc(r.name) + ' · ' + prog.ok + '/' + prog.total + ' 已就绪</p></div>' +
      '<button class="x" data-act="close">×</button></div>' +
      '<p class="m-tip">清单按赛制自动生成。勾选状态会保存在本机。</p>' +
      '<ul class="m-chk">' + list.map(function (i) {
        return '<li><label><input type="checkbox" data-chk="' + esc(i.k) + '"' + (done[i.k] ? " checked" : "") + '>' +
          '<span><b>' + esc(i.t) + '</b><i>' + esc(i.why) + '</i></span></label></li>';
      }).join("") + '</ul>' +
      '<div class="m-acts"><button class="mini" data-act="close">关闭</button>' +
      '<button class="mini primary" data-act="copychecklist" data-id="' + id + '">复制清单</button></div>'
    );
    $("#modalBox").dataset.raceId = id;
  }

  function openAddRace() {
    showModal(
      '<div class="m-head"><div><h3>自建赛事</h3><p class="m-sub">内置目录里没有的赛事,可以手动加入,系统同样会盯着它的窗口</p></div>' +
      '<button class="x" data-act="close">×</button></div>' +
      '<div class="m-form">' +
      fld("nName", "赛事名称", "text") +
      fld("nKind", "类型", "select:road|trail", { road: "马拉松 / 路跑", trail: "越野赛" }) +
      fld("nRegion", "地区", "select:" + REGIONS.join("|")) +
      fld("nCity", "城市", "text") +
      fld("nDist", "组别与距离(可留空)", "text") +
      fld("nMode", "赛制", "select:lottery|fcfs|qualify|invite|stones", ME.MODE_LABEL) +
      fld("nRegOpen", "报名开放(可留空)", "datetime-local") + fld("nRegClose", "报名截止(可留空)", "datetime-local") +
      fld("nDraw", "抽签公布(可留空)", "datetime-local") + fld("nPay", "缴费截止(可留空)", "datetime-local") +
      fld("nRace", "比赛日", "date") + fld("nUrl", "官网报名链接", "url") +
      '</div>' +
      '<div class="m-acts"><button class="mini" data-act="close">取消</button>' +
      '<button class="mini primary" data-act="addrace">添加并关注</button></div>',
      true
    );
  }

  function fld(id, label, kind, map) {
    var input;
    if (kind.indexOf("select:") === 0) {
      input = '<select id="' + id + '">' + kind.slice(7).split("|").map(function (o) {
        return '<option value="' + esc(o) + '">' + esc(map && map[o] ? map[o] : o) + '</option>';
      }).join("") + '</select>';
    } else input = '<input id="' + id + '" type="' + kind + '">';
    return '<label class="field"><span>' + esc(label) + '</span>' + input + '</label>';
  }

  function v(id) { var e = $("#" + id); return e ? e.value.trim() : ""; }

  function normalizeDT(s) { return s ? s.replace("T", " ") : ""; }

  function addRace() {
    var name = v("nName"), raceDate = v("nRace");
    if (!name) { toast("请填写赛事名称"); return; }
    if (!raceDate) { toast("请填写比赛日"); return; }
    var r = S.addCustomRace({
      name: name, kind: $("#nKind").value || "road",
      region: v("nRegion") || "中国", city: v("nCity"), dist: v("nDist"),
      mode: $("#nMode").value, tier: "std",
      regOpen: normalizeDT(v("nRegOpen")), regClose: normalizeDT(v("nRegClose")),
      drawDate: normalizeDT(v("nDraw")), payDeadline: normalizeDT(v("nPay")),
      raceDate: raceDate, url: v("nUrl") || "#", confidence: "manual"
    });
    S.watch(r.id);
    hideModal();
    toast("已添加并加入关注:" + name);
    render();
  }

  function renderAcctChip() {
    var el = $("#acctChip"); if (!el) return;
    var a = Auth.get();
    if (a && a.name) { el.textContent = a.name; el.classList.add("on"); }
    else { el.textContent = "登录"; el.classList.remove("on"); }
  }

  function openAccount() {
    var a = Auth.get();
    if (a && a.name) {
      var meta = S.state.meta.updated ? new Date(S.state.meta.updated).toLocaleString("zh-CN") : "—";
      showModal(
        '<div class="m-head"><div><h3>账号</h3><p class="m-sub">本地身份 · 已登录</p></div>' +
        '<button class="x" data-act="close">×</button></div>' +
        '<div class="acct">' +
          '<div class="acct-row"><span>昵称</span><b>' + esc(a.name) + '</b></div>' +
          '<div class="acct-row"><span>邮箱</span><b>' + (a.email ? esc(a.email) : "—") + '</b></div>' +
          '<div class="acct-row"><span>登录方式</span><b>本机身份</b></div>' +
          '<div class="acct-row"><span>数据存放</span><b>当前浏览器</b></div>' +
          '<div class="acct-row"><span>已关注赛事</span><b>' + S.watchedRaces().length + ' 场</b></div>' +
          '<div class="acct-row"><span>最近保存</span><b>' + meta + '</b></div>' +
        '</div>' +
        cloudSection() +
        '<p class="m-tip">手机 / 邮箱登录后,关注清单、材料勾选与偏好会跨设备一致。档案里的姓名 / 身份证 / 手机号默认只留本机,不同步上云。</p>' +
        '<div class="m-acts"><button class="mini" data-act="close">关闭</button>' +
        '<button class="mini danger" data-act="acct-out">退出登录</button></div>'
      );
      return;
    }
    showModal(
      '<div class="m-head"><div><h3>账号与同步</h3><p class="m-sub">本地模式 · 可随时升级</p></div>' +
      '<button class="x" data-act="close">×</button></div>' +
      '<div class="acct-intro">先设置一个本机身份,关注清单与档案会带上你的标识。当前数据仍只保存在这台浏览器。</div>' +
      '<div class="acct-form">' +
        '<label class="acct-fld"><span>昵称</span><input class="acct-in" id="acctName" type="text" placeholder="例如:星哥、MarathonFan" maxlength="20" autocomplete="nickname"></label>' +
        '<label class="acct-fld"><span>邮箱(选填)</span><input class="acct-in" id="acctEmail" type="text" placeholder="用于后续云端同步,现在不发送任何邮件" maxlength="80" autocomplete="email"></label>' +
        '<p class="acct-note">本地版不会把证件号 / 手机号上传。邮箱仅在你主动开启云端同步后才会使用。</p>' +
        cloudSection() +
        '<div class="m-acts">' +
          '<button class="mini" type="button" data-act="close">稍后</button>' +
          '<button class="mini primary" type="button" data-act="acct-save">保存身份</button>' +
        '</div>' +
      '</div>'
    );
  }

  /* ============================================================ 渲染 */

  /* ============================================================ 云端同步(P1) */

  var lastSyncAt = null, pendingPhone = null, pendingEmail = null, pushTimer = null;

  function fmtAgo(d) {
    try { return new Date(d).toLocaleString("zh-CN", { hour12: false }); } catch (e) { return "—"; }
  }
  function setSyncDot(state) {
    var d = $("#syncDot"); if (!d) return;
    d.className = "sync-dot " + (state || "");
    var map = { ok: "已同步", pending: "同步中 / 待同步", error: "同步失败", off: "未连接" };
    d.title = "同步状态:" + (map[state] || "未连接");
  }
  function setCloudStatus(text, cls) {
    var el = $("#cloudStatus"); if (el) { el.textContent = text; el.className = "cloud-status " + (cls || ""); }
  }

  /* 账号面板里的云端区块(内容在 openAccount 后由 refreshCloudUI 填充) */
  function cloudSection() {
    if (!Cloud.isReady()) {
      return '<div class="acct-cloud off"><div class="acct-sub">云端同步</div>' +
        '<div class="cloud-status off">云服务未连接(离线) · 本地数据照常保存</div></div>';
    }
    return '<div class="acct-cloud" id="acctCloud">' +
      '<div class="acct-sub">云端同步 · 跨设备</div>' +
      '<div id="cloudStatus" class="cloud-status">检测登录态…</div>' +
      '<div id="cloudLogin">' +
        '<div class="acct-tabs">' +
          '<button class="acct-tab on" data-act="cloud-tab" data-id="phone">手机验证码</button>' +
          '<button class="acct-tab" data-act="cloud-tab" data-id="email">邮箱验证码</button>' +
        '</div>' +
        '<div id="cloudFormPhone" class="cloud-form">' +
          '<input class="acct-in" id="cloudPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="11 位手机号" autocomplete="tel">' +
          '<button class="mini" type="button" data-act="cloud-send-phone" id="cloudSendPhone">获取验证码</button>' +
          '<input class="acct-in" id="cloudPhoneCode" type="text" inputmode="numeric" maxlength="8" placeholder="短信验证码">' +
          '<button class="mini primary" type="button" data-act="cloud-verify-phone">登录 / 注册</button>' +
        '</div>' +
        '<div id="cloudFormEmail" class="cloud-form" style="display:none">' +
          '<input class="acct-in" id="cloudEmail" type="email" maxlength="80" placeholder="邮箱" autocomplete="email">' +
          '<button class="mini" type="button" data-act="cloud-send-email" id="cloudSendEmail">获取验证码</button>' +
          '<input class="acct-in" id="cloudEmailCode" type="text" inputmode="numeric" maxlength="8" placeholder="邮箱验证码">' +
          '<input class="acct-in" id="cloudEmailPwd" type="password" maxlength="60" placeholder="设置密码(新账号必填)" style="display:none">' +
          '<button class="mini primary" type="button" data-act="cloud-verify-email">登录 / 注册</button>' +
        '</div>' +
        '<div class="cloud-wechat">' +
          '<button class="mini wechat-btn" type="button" data-act="cloud-wechat">微信扫码登录</button>' +
          '<p class="m-tip">微信扫码后,关注清单与设置同样跨设备同步。需云端已配置微信登录(redirect 白名单含本站点)。</p>' +
        '</div>' +
      '</div>' +
      '<div id="cloudOn" style="display:none">' +
        '<div class="acct-row"><span>云端账号</span><b id="cloudWho">—</b></div>' +
        '<div class="acct-row"><span>最近同步</span><b id="cloudWhen">—</b></div>' +
        '<div class="m-acts">' +
          '<button class="mini primary" type="button" data-act="cloud-sync">立即同步</button>' +
          '<button class="mini" type="button" data-act="cloud-out">退出云端</button>' +
        '</div>' +
        '<p class="m-tip">退出只清除本机登录态,云端数据保留;下次同账号登录会自动合并。</p>' +
      '</div>' +
    '</div>';
  }

  function refreshCloudUI() {
    var box = $("#acctCloud"); if (!box) return;
    if (!Cloud.isReady()) { setSyncDot("off"); return; }
    Cloud.getSession().then(function (r) {
      var on = !!(r.data && r.data.user);
      var login = $("#cloudLogin"), onp = $("#cloudOn");
      if (login) login.style.display = on ? "none" : "";
      if (onp) onp.style.display = on ? "" : "none";
      if (on) {
        var who = $("#cloudWho"); if (who) who.textContent = Cloud.maskIdentity(r.data) || "云端用户";
        var when = $("#cloudWhen"); if (when) when.textContent = lastSyncAt ? fmtAgo(lastSyncAt) : "尚未同步";
        setSyncDot(lastSyncAt ? "ok" : "pending");
      } else {
        setSyncDot("off");
      }
    });
  }

  /* 拉取云端 -> 与本地合并 -> 写回 -> 推送合并结果。合并规则见 ME.mergeStates。 */
  async function doSync() {
    if (!Cloud.isReady()) { toast("云服务未连接"); return; }
    var s = await Cloud.getSession();
    if (!s.data || !s.data.user) { toast("请先登录云端账号"); return; }
    setCloudStatus("同步中…", "pending"); setSyncDot("pending");
    var pulled = await Cloud.pull();
    if (pulled.error) {
      if (pulled.error.kind === "unauthenticated") { toast("登录已失效,请重新登录"); refreshCloudUI(); return; }
      setCloudStatus("云端拉取失败", "error"); setSyncDot("error"); toast("云端拉取失败,稍后重试"); return;
    }
    var local = S.toSyncBlob();
    var merged = ME.mergeStates(local, pulled.data || {});
    S.applySyncBlob(merged);
    render();
    var pushed = await Cloud.push(merged);
    if (pushed.error) { setCloudStatus("云端上传失败", "error"); setSyncDot("error"); toast("已合并但上传失败,稍后重试"); return; }
    lastSyncAt = new Date();
    setCloudStatus("已同步 · " + fmtAgo(lastSyncAt), "ok"); setSyncDot("ok");
    var when = $("#cloudWhen"); if (when) when.textContent = fmtAgo(lastSyncAt);
    toast("已与云端合并并同步");
  }

  /* 本地改动后防抖上传(仅传本地 blob;跨设备冲突在下次登录 pull 时按 updatedAt 合并) */
  function schedulePush() {
    if (!Cloud.isReady()) return;
    Cloud.getSession().then(function (r) {
      if (!r.data || !r.data.user) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(function () {
        Cloud.push(S.toSyncBlob()).then(function (res) {
          if (res.error) { setSyncDot("pending"); setCloudStatus("待同步", "pending"); }
          else { lastSyncAt = new Date(); setSyncDot("ok"); setCloudStatus("已同步 · " + fmtAgo(lastSyncAt), "ok"); var w = $("#cloudWhen"); if (w) w.textContent = fmtAgo(lastSyncAt); }
        });
      }, 1500);
    });
  }

  function afterCloudLogin() { refreshCloudUI(); renderAcctChip(); doSync(); }

  function cloudTab(which) {
    var p = which === "phone";
    var fp = $("#cloudFormPhone"), fe = $("#cloudFormEmail");
    if (fp) fp.style.display = p ? "" : "none";
    if (fe) fe.style.display = p ? "none" : "";
    $$("#acctCloud .acct-tab").forEach(function (b) { b.classList.toggle("on", b.dataset.id === which); });
  }

  function cloudSendPhone() {
    var phone = $("#cloudPhone") ? $("#cloudPhone").value.trim() : "";
    if (!/^1\d{10}$/.test(phone)) { toast("请输入正确的 11 位手机号"); return; }
    Cloud.sendOtp({ phone: phone }).then(function (r) {
      if (r.error) { toast("发送失败:" + (r.error.message || r.error.kind)); return; }
      pendingPhone = { phone: phone, verificationId: r.data && r.data.verificationId, isExistingUser: r.data && r.data.isExistingUser };
      toast("验证码已发送");
      var b = $("#cloudSendPhone"); if (b) { b.disabled = true; setTimeout(function () { b.disabled = false; }, 30000); }
    });
  }
  function cloudVerifyPhone() {
    if (!pendingPhone) { toast("请先获取验证码"); return; }
    var code = $("#cloudPhoneCode") ? $("#cloudPhoneCode").value.trim() : "";
    if (!code) { toast("请输入验证码"); return; }
    Cloud.verifyOtp({ phone: pendingPhone.phone, verificationId: pendingPhone.verificationId, isExistingUser: pendingPhone.isExistingUser, token: code })
      .then(function (r) {
        if (r.error) { toast("验证失败:" + (r.error.message || r.error.kind)); return; }
        pendingPhone = null; afterCloudLogin();
      });
  }
  function cloudSendEmail() {
    var email = $("#cloudEmail") ? $("#cloudEmail").value.trim() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("请输入有效邮箱"); return; }
    Cloud.sendOtp({ email: email }).then(function (r) {
      if (r.error) { toast("发送失败:" + (r.error.message || r.error.kind)); return; }
      pendingEmail = { email: email, verificationId: r.data && r.data.verificationId, isExistingUser: r.data && r.data.isExistingUser };
      if (pendingEmail.isExistingUser === false) { var p = $("#cloudEmailPwd"); if (p) p.style.display = ""; }
      toast("验证码已发送");
      var b = $("#cloudSendEmail"); if (b) { b.disabled = true; setTimeout(function () { b.disabled = false; }, 30000); }
    });
  }
  function cloudVerifyEmail() {
    if (!pendingEmail) { toast("请先获取验证码"); return; }
    var code = $("#cloudEmailCode") ? $("#cloudEmailCode").value.trim() : "";
    if (!code) { toast("请输入验证码"); return; }
    var pwd = (pendingEmail.isExistingUser === false) ? ($("#cloudEmailPwd") ? $("#cloudEmailPwd").value : "") : undefined;
    if (pendingEmail.isExistingUser === false && !pwd) { toast("新账号请先设置密码"); return; }
    Cloud.verifyOtp({ email: pendingEmail.email, verificationId: pendingEmail.verificationId, isExistingUser: pendingEmail.isExistingUser, token: code, password: pwd })
      .then(function (r) {
        if (r.error) { toast("验证失败:" + (r.error.message || r.error.kind)); return; }
        pendingEmail = null; afterCloudLogin();
      });
  }
  function cloudOut() {
    Cloud.signOut().then(function () {
      lastSyncAt = null; refreshCloudUI(); renderAcctChip(); toast("已退出云端(本地数据保留)");
    });
  }
  /* 微信扫码登录:调 SDK 的 OAuth relay 跳转,浏览器会被重定向到微信确认页,
     用户确认后 relay 带 code 跳回本页,由启动段的 handleOAuthReturn 完成会话。 */
  function cloudWechat() {
    if (!Cloud.isReady()) { toast("云服务未连接"); return; }
    Cloud.wechatLogin(location.href).then(function (r) {
      if (r && r.error) toast("微信登录发起失败:" + (r.error.message || r.error.kind));
    });
  }

  function render() {
    $$(".nav button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === tab); });
    $$(".view").forEach(function (v) { v.classList.toggle("on", v.id === "view-" + tab); });

    if (tab === "dash") renderDash();
    else if (tab === "lib") renderLib();
    else if (tab === "mine") renderMine();
    else if (tab === "profile") { renderProfileForm(); renderProfileSide(); }
    else if (tab === "notify") renderNotify();

    var st = S.stats();
    $("#navCount").textContent = st.watched || "";
    $("#navCount").style.display = st.watched ? "" : "none";
  }

  /* ============================================================ 事件 */

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act],[data-tab]");
    if (!t) return;

    if (t.dataset.tab) { tab = t.dataset.tab; render(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }

    var act = t.dataset.act, id = t.dataset.id;
    switch (act) {
      case "close": hideModal(); break;
      case "kindfilter": lib.kind = id || ""; renderLib(); break;
      case "libphase": lib.phase = id || "all"; renderLib(); break;
      case "minekind": mine.kind = id || ""; renderMine(); break;
      case "detail": openDetail(id); break;
      case "check": openChecklist(id); break;
      case "open": doOpen(id); break;
      case "watch":
        if (S.watch(id)) { toast("已加入关注"); render(); if ($("#modal").classList.contains("on")) openDetail(id); }
        break;
      case "unwatch":
        if (S.unwatch(id)) { toast("已取消关注"); hideModal(); render(); }
        break;
      case "delrace":
        if (confirm("删除自建赛事?该赛事的关注与材料勾选会一并移除。")) { S.removeCustomRace(id); toast("已删除"); render(); }
        break;
      case "addrace": addRace(); break;
      case "copy": { var r = S.raceById(id); copyText(ME.profileBlock(r, S.state.profile)); break; }
      case "copychecklist": {
        var rc = S.raceById(id);
        var txt = "【" + rc.name + "】报名材料清单\n" + ME.buildChecklist(rc, S.state.profile)
          .map(function (i, n) { return (n + 1) + ". " + i.t + " —— " + i.why; }).join("\n");
        copyText(txt); break;
      }
      case "copyprofile": copyText(ME.profileBlock(null, S.state.profile)); break;
      case "ics1": exportICS(id); break;
      case "icsAll": exportICS(null); break;
      case "addraceopen": openAddRace(); break;
      case "acct-save": {
        var nm = $("#acctName") ? $("#acctName").value.trim() : "";
        if (!nm) { toast("请先填写昵称"); break; }
        var em = $("#acctEmail") ? $("#acctEmail").value.trim() : "";
        var acc = Auth.signIn({ name: nm, email: em });
        S.state.account = Object.assign(S.state.account, {
          nickname: acc.name, avatarChar: acc.avatar, provider: "local", createdAt: acc.createdAt
        });
        S.save();
        renderAcctChip();
        toast("身份已保存 · " + acc.name);
        hideModal();
        break;
      }
      case "acct-out":
        Auth.signOut();
        S.state.account = Object.assign(S.state.account, { nickname: "", avatarChar: "", provider: "local", createdAt: null });
        S.save();
        renderAcctChip();
        toast("已退出登录");
        hideModal();
        break;
      case "account": openAccount(); break;
      case "cloud-tab": cloudTab(t.dataset.id); break;
      case "cloud-send-phone": cloudSendPhone(); break;
      case "cloud-verify-phone": cloudVerifyPhone(); break;
      case "cloud-send-email": cloudSendEmail(); break;
      case "cloud-verify-email": cloudVerifyEmail(); break;
      case "cloud-sync": doSync(); break;
      case "cloud-out": cloudOut(); break;
      case "cloud-wechat": cloudWechat(); break;
      case "backup": download("marathon-backup-" + stamp() + ".json", S.exportJSON(), "application/json"); break;
      case "reset":
        if (confirm("清空全部本地数据(档案、关注、材料勾选)?\n此操作不可恢复,建议先导出备份。")) {
          S.resetAll(); toast("已清空"); render();
        }
        break;
      case "import": $("#importFile").click(); break;
      case "backupex": openEncModal("export"); break;
      case "backupim": $("#importEncFile").click(); break;
      case "enc-ok": encOk(); break;
      case "enc-cancel": closeEncModal(); break;
      case "notifyperm": requestNotif(); break;
    }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.chk) {
      var id = $("#modalBox").dataset.raceId;
      if (id) {
        S.toggleCheck(id, t.dataset.chk);
        var r = S.raceById(id);
        var p = S.checklistProgress(r);
        var pill = $("#modalBox .pill");
        if (pill) pill.textContent = p.ok + "/" + p.total;
        if (tab !== "dash") render();
      }
      return;
    }
    if (t.dataset.statusOf) {
      S.setStatus(t.dataset.statusOf, t.value);
      toast("状态已更新为「" + STATUS_NAME[t.value] + "」");
      render();
      if ($("#modal").classList.contains("on")) openDetail(t.dataset.statusOf);
      return;
    }
    if (t.dataset.ch) {
      var ch = S.state.settings.channels;
      ch[t.dataset.ch] = t.checked;
      if (t.dataset.ch === "email") {
        S.state.settings.email = $("#chEmail") ? $("#chEmail").value.trim() : S.state.settings.email;
      }
      S.save();
      if (t.dataset.ch === "browser" && t.checked) requestNotif();
      toast("提醒通道已" + (t.checked ? "开启" : "关闭"));
      return;
    }
    if (t.id === "f_medMonths" || t.id === "f_medDate" || t.id === "f_birth") {
      S.state.profile = Object.assign(S.state.profile, readProfileForm());
      S.save(); renderProfileSide();
      return;
    }
  });

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "libQ") { lib.q = t.value; renderLib(); }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "fRegion") { lib.region = t.value; renderLib(); }
    if (t.id === "fMonth") { lib.month = t.value; renderLib(); }
    if (t.id === "fMode") { lib.mode = t.value; renderLib(); }
    if (t.id === "fOnlyWatch") { lib.onlyWatch = t.checked; renderLib(); }
    if (t.id === "chEmail") { S.state.settings.email = t.value.trim(); S.save(); }
    if (t.id === "importFile") {
      var f = t.files && t.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { S.importJSON(String(fr.result)); toast("导入成功"); render(); }
        catch (err) { toast("导入失败:" + err.message); }
      };
      fr.readAsText(f);
      t.value = "";
    }
    if (t.id === "importEncFile") {
      var f2 = t.files && t.files[0]; if (!f2) return;
      var fr2 = new FileReader();
      fr2.onload = function () {
        pendingEnc.text = String(fr2.result);
        openEncModal("import");
      };
      fr2.readAsText(f2);
      t.value = "";
    }
  });

  $("#pForm").addEventListener("change", function () {
    S.state.profile = Object.assign(S.state.profile, readProfileForm());
    S.save(); renderProfileSide(); toast("档案已保存");
  });
  $("#pForm").addEventListener("input", function () {
    clearTimeout(window.__psave);
    window.__psave = setTimeout(function () {
      S.state.profile = Object.assign(S.state.profile, readProfileForm());
      S.save(); renderProfileSide();
    }, 600);
  });

  /* ---------------------------------------------------------- 提醒/ICS */

  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function exportICS(onlyId) {
    var races = onlyId ? [S.withStatus(S.raceById(onlyId))] : S.watchedRaces();
    if (!races.length) { toast("先关注赛事才能导出"); return; }
    var ics = ME.buildICS(races, null);
    var name = onlyId ? (S.raceById(onlyId).name + ".ics") : ("马拉松关键日期-" + stamp() + ".ics");
    download(name, ics, "text/calendar;charset=utf-8");
    toast("已导出 " + races.length + " 场赛事的日历文件");
  }

  function requestNotif() {
    if (!("Notification" in window)) { toast("当前浏览器不支持通知"); return; }
    Notification.requestPermission().then(function (p) {
      if (p === "granted") toast("浏览器通知已开启");
      else { toast("未授权通知,可改用日历订阅"); S.state.settings.channels.browser = false; }
      if (tab === "notify") renderNotify();
    });
  }

  /* 页面打开时,把已经到点的提醒弹出来(浏览器通知可用时) */
  function fireDue() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!S.state.settings.channels.browser) return;
    var key = "mp_notified_" + new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(key)) return; } catch (e) { return; }
    var due = urgentList();
    if (due.length) {
      var first = due[0];
      new Notification("马拉松报名提醒", {
        body: due.length + " 项待处理 · " + first.race.name + " " + first.s.label +
          (first.s.cd != null ? (first.s.cd <= 0 ? "(就是今天)" : "(还有 " + first.s.cd + " 天)") : "")
      });
    }
    try { localStorage.setItem(key, "1"); } catch (e) {}
  }

  /* ============================================================ 启动 */

  S.load();

  /* 本地身份(P0):把账号信息镜像进 store,便于备份 JSON 带上昵称;不重复写盘 */
  (function syncAccount() {
    var a = Auth.get();
    if (a && a.name) {
      S.state.account = Object.assign(S.state.account, {
        nickname: a.name, avatarChar: a.avatar, provider: "local", createdAt: a.createdAt
      });
      S.save();
    }
  })();
  renderAcctChip();
  if (Auth.onChange) Auth.onChange(renderAcctChip);

  /* 云端同步(P1):会话检测 + 自动拉取合并 + 本地改动防抖上传 */
  if (Cloud.isReady()) {
    Cloud.onAuthStateChange(function (ev, sess) {
      if (sess && sess.user) { refreshCloudUI(); schedulePush(); }
      else { lastSyncAt = null; refreshCloudUI(); }
    });
    Cloud.getSession().then(function (r) {
      if (r.data && r.data.user) { refreshCloudUI(); doSync(); }
      else { refreshCloudUI(); }
    });
    S.subscribe(schedulePush);
  } else {
    setSyncDot("off");
  }

  /* 微信扫码登录回调:relay 带 code 跳回本页时,完成会话并清掉 URL 里的临时参数。
     依赖云端已配置微信 OAuth(redirect 白名单含本站点域名)。 */
  (function handleOAuthReturn() {
    if (!Cloud.isReady()) return;
    try {
      var q = new URLSearchParams(location.search);
      if ((q.get("provider") === "wechat" || q.get("provider_id")) && q.get("code")) {
        Cloud.handleOAuthCallback().then(function (r) {
          if (r && r.error) toast("微信登录失败:" + (r.error.message || r.error.kind));
          else toast("微信登录成功,正在同步…");
          history.replaceState({}, "", location.pathname);
        });
      }
    } catch (e) { /* 非 OAuth 返回,忽略 */ }
  })();

  render();
  fireDue();
  S.subscribe(function () {
    var n = $("#navCount"); var c = S.watchedRaces().length;
    n.textContent = c || ""; n.style.display = c ? "" : "none";
  });

  window.__app = { render: render, S: S, ME: ME, setTab: function (t) { tab = t; render(); },
                   setLib: function (o) { Object.assign(lib, o); renderLib(); },
                   setMine: function (o) { Object.assign(mine, o); renderMine(); },
                   KIND_META: KIND_META };
})();
