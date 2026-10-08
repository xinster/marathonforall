/* =========================================================================
   auth.js — 本地身份层(P0)
   -------------------------------------------------------------------------
   当前为「本地版」身份:账号只保存在本浏览器(localStorage),不上云、不联网。
   设计目标:把「我是谁」从「本机数据」里抽出来,让后续 P1(云端同步)只需要在
   这里接入 auth provider,界面与数据层不必重写。

   关键约束(隐私红线):
   - 不持有任何长期密钥、不发起任何网络请求(纯本地)。
   - 只存昵称与(可选)邮箱;证件号 / 手机号绝不进这里。
   - 登录状态刷新后保持。
   ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Auth = factory();
}(typeof window !== "undefined" ? window : this, function () {
  var KEY = "mt_account_v1";
  var root = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this);

  function read() {
    try { var raw = root.localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function write(obj) {
    try { root.localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
    catch (e) { return false; }
  }

  function avatarOf(name) {
    name = (name || "").trim();
    if (!name) return "";
    return name.slice(0, 1).toUpperCase();
  }

  function normalize(a) {
    a = a || {};
    return {
      name: (a.name || "").trim(),
      email: (a.email || "").trim(),
      avatar: avatarOf(a.name),
      provider: "local",
      createdAt: a.createdAt || (current && current.createdAt) || null,
      updatedAt: new Date().toISOString()
    };
  }

  var current = read();
  var listeners = [];
  function emit() { listeners.forEach(function (cb) { try { cb(current); } catch (e) {} }); }

  return {
    KEY: KEY,
    provider: "local",

    /** 当前账号对象(含 nickname/email/avatar/provider/createdAt);未登录返回 null */
    get: function () { return current; },

    /** 是否已设置本地身份 */
    isAuthed: function () { return !!(current && current.name); },

    /** 建立 / 更新本地身份。昵称为空则忽略。返回标准化后的账号对象。 */
    signIn: function (patch) {
      var base = current ? Object.assign({}, current) : {};
      var next = normalize(Object.assign(base, patch || {}));
      if (!next.name) return current;
      if (!next.createdAt) next.createdAt = new Date().toISOString();
      current = next;
      write(current);
      emit();
      return current;
    },

    /** 清除本地身份(不删除业务数据:关注清单 / 档案仍在) */
    signOut: function () {
      current = null;
      try { root.localStorage.removeItem(KEY); } catch (e) {}
      emit();
      return null;
    },

    /** 订阅身份变化(如多标签页同步);返回取消订阅函数 */
    onChange: function (cb) {
      if (typeof cb !== "function") return function () {};
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (f) { return f !== cb; }); };
    }
  };
}));
