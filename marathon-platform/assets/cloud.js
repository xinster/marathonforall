/* =========================================================================
   cloud.js — P1 云端同步层(WorkBuddy Cloud Service)
   -------------------------------------------------------------------------
   - 只同步「安全子集」: watching / checklists / settings / custom
   - 绝不碰 profile(姓名/身份证/手机号/紧急联系人)与 account(本机身份)
   - 依赖 CDN 全局 WorkBuddyCloud;若 SDK 未加载,自动降级为本地模式
     (不白屏、不假装已同步)
   - 所有写库请求都带登录态,服务端 RLS 按 owner_id 隔离,前端不传 owner_id
   ========================================================================= */
(function (root) {
  "use strict";

  // 以下四值取自 workbuddy_cloud_service 返回的 publicConfig,可安全放入前端代码。
  // endpoint 即本应用的发布域名(与分享链接同源),换应用须随之更新。
  var PC = {
    endpoint: "https://marathon-tracker.app.workbuddy.host",
    oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
    publishableKey: "wbpk_Hq5OK3jMzN64v1kK3FMP1z_IkWIRk0mvzl5qP1WTl14JzNrPwG9uHUr"
  };

  var cloud = null, ready = false;

  function init() {
    var W = root.WorkBuddyCloud;
    if (!W || !W.createWorkBuddyCloud) { ready = false; return; }
    try {
      cloud = W.createWorkBuddyCloud({
        endpoint: PC.endpoint,
        oauthRelayBaseUrl: PC.oauthRelayBaseUrl,
        publishableKey: PC.publishableKey
      });
      ready = true;
    } catch (e) { ready = false; cloud = null; }
  }
  init();

  function isReady() { return ready; }

  /* 把 SDK 可能返回的 Promise 或 {data,error} 统一成 Promise<{data,error}> */
  function call(p) {
    return Promise.resolve(p).then(function (r) { return r || {}; });
  }

  /* ----------------------------- Auth ----------------------------- */
  function sendOtp(opts) {
    if (!ready) return Promise.resolve({ error: { kind: "offline" } });
    return call(cloud.auth.sendOtp(opts));
  }
  function verifyOtp(opts) {
    if (!ready) return Promise.resolve({ error: { kind: "offline" } });
    return call(cloud.auth.verifyOtp(opts)).then(function (r) {
      if (r.error) return { error: r.error };
      return { data: r.data, user: r.data && r.data.user };
    });
  }
  function signOut() {
    if (!ready) return Promise.resolve({});
    return call(cloud.auth.signOut());
  }
  function getSession() {
    if (!ready) return Promise.resolve({ data: null });
    return call(cloud.auth.getSession());
  }
  function onAuthStateChange(cb) {
    if (!ready || !cloud.auth.onAuthStateChange) return function () {};
    return cloud.auth.onAuthStateChange(function (event, session) { cb(event, session); });
  }
  /* 脱敏:界面只显示账号尾号,不暴露邮箱/手机明文 */
  function maskIdentity(session) {
    if (!session || !session.user) return null;
    var u = session.user;
    var raw = u.phoneNumber || u.email || u.id || "";
    if (/^\+?\d{6,}$/.test(raw)) return raw.replace(/(\d{3})\d{4}(\d+)/, "$1****$2");
    if (u.email) return u.email.replace(/(.{2}).*(@)/, "$1****$2");
    return (u.id || "云端用户").slice(0, 6);
  }

  /* ----------------------------- Sync ----------------------------- */
  function requireSession() {
    return getSession().then(function (r) {
      if (r.error || !r.data) return { error: { kind: "unauthenticated" } };
      return { session: r.data };
    });
  }

  /* 拉取云端 blob;无数据返回 {data:null} */
  function pull() {
    if (!ready) return Promise.resolve({ error: { kind: "offline" } });
    return requireSession().then(function (s) {
      if (s.error) return s;
      return call(cloud.database.from("user_state").select("state_json, updated_at").maybeSingle())
        .then(function (r) {
          if (r.error) return { error: r.error };
          if (!r.data) return { data: null };
          var blob = r.data.state_json || {};
          blob.savedAt = r.data.updated_at || blob.savedAt || null;
          return { data: blob };
        });
    });
  }

  /* 推送 blob:已有行则更新,否则插入。owner_id 由服务端按 auth.uid() 填充。 */
  function push(blob) {
    if (!ready) return Promise.resolve({ error: { kind: "offline" } });
    return requireSession().then(function (s) {
      if (s.error) return s;
      var payload = { state_json: blob, updated_at: new Date().toISOString() };
      return call(cloud.database.from("user_state").select("id").maybeSingle()).then(function (r) {
        if (r.error) return { error: r.error };
        var q = (r.data && r.data.id)
          ? cloud.database.from("user_state").update(payload).eq("id", r.data.id).select()
          : cloud.database.from("user_state").insert(payload).select();
        return call(q).then(function (rr) {
          if (rr.error) return { error: rr.error };
          return { data: true };
        });
      });
    });
  }

  root.Cloud = {
    PC: PC, init: init, isReady: isReady,
    sendOtp: sendOtp, verifyOtp: verifyOtp, signOut: signOut,
    getSession: getSession, onAuthStateChange: onAuthStateChange, maskIdentity: maskIdentity,
    pull: pull, push: push
  };
})(typeof window !== "undefined" ? window : globalThis);
