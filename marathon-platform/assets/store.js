/* =========================================================================
   store.js — 数据层(存储适配器)
   -------------------------------------------------------------------------
   把「数据放在哪里」和「界面怎么用」隔开。当前实现落在 localStorage,
   每个浏览器各存一份。将来接入账号体系时,只需换掉本文件的
   read / write 两个函数,界面代码一行不用改。

   未来接后端的改动点已经用 [SEAM] 标出。
   ========================================================================= */
(function (root) {
  "use strict";

  var ME = root.ME;
  var KEY = "marathon_platform_v1";
  var SCHEMA = 1;

  function emptyProfile() { return Object.assign({}, ME.EMPTY_PROFILE); }

  function emptyState() {
    return {
      schema: SCHEMA,
      account: {
        id: null,
        nickname: "",
        avatarChar: "",
        provider: "local",
        createdAt: null
      },
      profile: emptyProfile(),
      custom: [],
      watching: {},
      checklists: {},
      settings: {
        channels: { browser: false, email: false, wechat: false, ics: true },
        email: "",
        leadDays: 3,
        dailyDigest: true
      },
      meta: { created: null, updated: null }
    };
  }

  /* ---------------------------------------------------------------- [SEAM]
     存储读写。接后端时把这两个函数换成网络调用即可(建议保持函数签名同步,
     或整体改为 async —— 届时把调用点补上 await)。
     -------------------------------------------------------------------- */
  function read() {
    try {
      var raw = root.localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("读取本地数据失败", e);
      return null;
    }
  }

  function write(obj) {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      console.warn("写入本地数据失败", e);
      return false;
    }
  }
  /* ------------------------------------------------------------------ */

  var state = emptyState();

  function normalize(raw) {
    var s = emptyState();
    if (!raw || typeof raw !== "object") return s;
    s.account = Object.assign(s.account, raw.account || {});
    s.profile = Object.assign(emptyProfile(), raw.profile || {});
    s.custom = Array.isArray(raw.custom) ? raw.custom : [];
    s.watching = raw.watching && typeof raw.watching === "object" ? raw.watching : {};
    s.checklists = raw.checklists && typeof raw.checklists === "object" ? raw.checklists : {};
    s.settings = Object.assign(s.settings, raw.settings || {});
    s.settings.channels = Object.assign(
      { browser: false, email: false, wechat: false, ics: true },
      (raw.settings && raw.settings.channels) || {}
    );
    s.meta = Object.assign(s.meta, raw.meta || {});
    return s;
  }

  function load() {
    state = normalize(read());
    if (!state.meta.created) {
      state.meta.created = new Date().toISOString();
      save();
    }
    return state;
  }

  function save() {
    state.meta.updated = new Date().toISOString();
    var ok = write(state);
    if (ok) notify();
    return ok;
  }

  var listeners = [];
  function notify() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }

  /* ---------------- 赛事目录 ---------------- */

  /* 目录 = 马拉松种子 + 越野赛种子 + 用户自建。
     store 只负责「合并」,分类判断统一走 ME.kindOf(),避免两处各写一套。 */
  function allRaces() {
    var seed = ME.SEED_ALL || ME.SEED_RACES || [];
    return seed.concat(state.custom || []);
  }

  function raceById(id) {
    return allRaces().filter(function (r) { return r.id === id; })[0] || null;
  }

  /** 带用户状态的赛事对象 —— computeStatus 需要 race.userStatus */
  function withStatus(race) {
    var w = state.watching[race.id];
    var copy = Object.assign({}, race);
    copy.userStatus = (w && w.status) || "watching";
    copy._watched = !!w;
    copy._addedAt = w ? w.addedAt : null;
    return copy;
  }

  function isWatched(id) { return Object.prototype.hasOwnProperty.call(state.watching, id); }

  function watch(id) {
    if (isWatched(id)) return false;
    state.watching[id] = { status: "watching", addedAt: new Date().toISOString() };
    save();
    return true;
  }

  function unwatch(id) {
    if (!isWatched(id)) return false;
    delete state.watching[id];
    delete state.checklists[id];
    save();
    return true;
  }

  function setStatus(id, st) {
    if (!isWatched(id)) watch(id);
    state.watching[id].status = st;
    state.watching[id].updatedAt = new Date().toISOString();
    save();
  }

  function watchedRaces() {
    return allRaces()
      .filter(function (r) { return isWatched(r.id); })
      .map(withStatus);
  }

  /* ---------------- 材料清单 ---------------- */

  function checklistOf(id) { return state.checklists[id] || {}; }

  function toggleCheck(id, k) {
    if (!state.checklists[id]) state.checklists[id] = {};
    if (state.checklists[id][k]) delete state.checklists[id][k];
    else state.checklists[id][k] = true;
    save();
  }

  function checklistProgress(race) {
    var list = ME.buildChecklist(race, state.profile);
    var done = checklistOf(race.id);
    var ok = list.filter(function (i) { return done[i.k]; }).length;
    return { ok: ok, total: list.length, pct: list.length ? Math.round(ok / list.length * 100) : 0 };
  }

  /* ---------------- 自建赛事 ---------------- */

  function addCustomRace(race) {
    var id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var r = Object.assign({
      id: id, name: "", region: "中国", city: "", mode: "lottery", tier: "std", kind: "road",
      dist: "", regOpen: "", regClose: "", drawDate: "", payDeadline: "", raceDate: "",
      url: "", confidence: "manual", custom: true
    }, race, { id: id, custom: true });
    state.custom.push(r);
    save();
    return r;
  }

  function removeCustomRace(id) {
    state.custom = state.custom.filter(function (r) { return r.id !== id; });
    unwatch(id);
    save();
  }

  /* ---------------- 备份与重置 ---------------- */

  function exportJSON() {
    var out = JSON.parse(JSON.stringify(state));
    out._meta = {
      app: "马拉松跟踪台",
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      racesInCatalog: allRaces().length
    };
    return JSON.stringify(out, null, 2);
  }

  function importJSON(text) {
    var raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || !("watching" in raw) && !("profile" in raw)) {
      throw new Error("文件格式不符,缺少必要字段");
    }
    state = normalize(raw);
    save();
    return state;
  }

  function resetAll() {
    state = emptyState();
    state.meta.created = new Date().toISOString();
    save();
    return state;
  }

  function stats() {
    var watched = watchedRaces();
    var now = new Date();
    var byKey = {}, byKind = {};
    watched.forEach(function (r) {
      var k = ME.computeStatus(r, now).key;
      byKey[k] = (byKey[k] || 0) + 1;
      var kd = ME.kindOf(r);
      byKind[kd] = (byKind[kd] || 0) + 1;
    });
    var seed = ME.SEED_ALL || ME.SEED_RACES || [];
    return {
      catalog: allRaces().length,
      seed: seed.length,
      road: seed.filter(function (r) { return ME.kindOf(r) === "road"; }).length,
      trail: seed.filter(function (r) { return ME.kindOf(r) === "trail"; }).length,
      custom: state.custom.length,
      watched: watched.length,
      byStatus: byKey,
      byKind: byKind
    };
  }

  /* ---------------- 云端同步(后端接入 seam) ---------------- */

  /* 提取「同步安全子集」。绝不返回 profile(姓名/身份证/手机号/紧急联系人)
     与 account(本机身份镜像)。这两个字段只留本地,默认不上云。 */
  function toSyncBlob() {
    return {
      watching: clone(state.watching),
      checklists: clone(state.checklists),
      settings: clone(state.settings),
      custom: clone(state.custom),
      savedAt: new Date().toISOString()
    };
  }

  /* 写回合并后的 blob。profile / account 不动。 */
  function applySyncBlob(blob) {
    if (!blob || typeof blob !== "object") return false;
    if (blob.watching && typeof blob.watching === "object") state.watching = blob.watching;
    if (blob.checklists && typeof blob.checklists === "object") state.checklists = blob.checklists;
    if (blob.settings && typeof blob.settings === "object") {
      state.settings = Object.assign(state.settings, blob.settings);
    }
    if (Array.isArray(blob.custom)) state.custom = blob.custom;
    save();
    return true;
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  root.Store = {
    KEY: KEY, SCHEMA: SCHEMA,
    load: load, save: save, subscribe: subscribe,
    get state() { return state; },
    emptyState: emptyState,
    allRaces: allRaces, raceById: raceById, withStatus: withStatus,
    isWatched: isWatched, watch: watch, unwatch: unwatch,
    setStatus: setStatus, watchedRaces: watchedRaces,
    checklistOf: checklistOf, toggleCheck: toggleCheck, checklistProgress: checklistProgress,
    addCustomRace: addCustomRace, removeCustomRace: removeCustomRace,
    toSyncBlob: toSyncBlob, applySyncBlob: applySyncBlob,
    exportJSON: exportJSON, importJSON: importJSON, resetAll: resetAll, stats: stats
  };
})(typeof window !== "undefined" ? window : globalThis);
