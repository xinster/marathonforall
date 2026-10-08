/* =========================================================================
   crypto.js — 个人资料加密备份(纯前端,零依赖)
   -------------------------------------------------------------------------
   用途:把本机档案(含姓名/身份证/手机号/紧急联系人等证件字段)用用户口令
   加密成一份可随身携带的文件。文件落在本机或 U 盘,平台运营方、云端的
   任何其他人都看不到明文 —— 因为密钥只由用户口令在本机派生,从不上传。

   算法:PBKDF2(SHA-256, 25 万轮)派生 AES-GCM-256 密钥;随机 salt + 随机 iv。
   后端:Web Crypto(`crypto.subtle`)。浏览器与 Node18+ 均可用。

   暴露:root.MCrypto = { isAvailable, encryptText, decryptText }
   ========================================================================= */
(function (root) {
  "use strict";

  /* 取 Web Crypto 实现:优先全局,Node 下回退到 crypto 模块的 webcrypto */
  var g = (typeof window !== "undefined") ? window : globalThis;
  var WC = (g.crypto && g.crypto.subtle) ? g.crypto : null;
  if (!WC && typeof require === "function") {
    try { WC = require("crypto").webcrypto; } catch (e) { WC = null; }
  }

  var ITER = 250000;          // PBKDF2 迭代轮数
  var SALT_LEN = 16, IV_LEN = 12;

  /* ---- base64(兼容浏览器 btoa/atob 与 Node Buffer)---- */
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf);
    if (typeof btoa === "function") {
      var bin = "";
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    return Buffer.from(bytes).toString("base64");
  }
  function b64ToBuf(b64) {
    if (typeof atob === "function") {
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    return Buffer.from(b64, "base64").buffer;
  }

  function isAvailable() { return !!(WC && WC.subtle); }

  function deriveKey(pass, saltBuf) {
    var enc = new TextEncoder();
    return WC.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"])
      .then(function (baseKey) {
        return WC.subtle.deriveKey(
          { name: "PBKDF2", salt: saltBuf, iterations: ITER, hash: "SHA-256" },
          baseKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  /* 明文 → 密文对象(可直接 JSON.stringify 落盘)。
     结构:{ v, alg, iter, salt, iv, ct } 全部为 base64(除标量)。 */
  function encryptText(plain, pass) {
    if (!isAvailable()) return Promise.reject(new Error("当前环境不支持加密(需用 https 或 localhost 访问)"));
    var enc = new TextEncoder();
    var salt = WC.getRandomValues(new Uint8Array(SALT_LEN));
    var iv = WC.getRandomValues(new Uint8Array(IV_LEN));
    return deriveKey(pass, salt).then(function (key) {
      return WC.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(plain));
    }).then(function (ct) {
      return {
        v: 1,
        alg: "PBKDF2-SHA256/AES-GCM-256",
        iter: ITER,
        salt: bufToB64(salt.buffer),
        iv: bufToB64(iv.buffer),
        ct: bufToB64(ct)
      };
    });
  }

  /* 密文对象 → 明文。口令错误或文件损坏都会抛错(不泄露任何明文)。 */
  function decryptText(obj, pass) {
    if (!isAvailable()) return Promise.reject(new Error("当前环境不支持解密(需用 https 或 localhost 访问)"));
    if (!obj || obj.v !== 1 || !obj.ct || !obj.salt || !obj.iv) {
      return Promise.reject(new Error("备份格式不正确"));
    }
    var keyPromise = deriveKey(pass, new Uint8Array(b64ToBuf(obj.salt)));
    return keyPromise.then(function (key) {
      return WC.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(b64ToBuf(obj.iv)) },
        key,
        b64ToBuf(obj.ct)
      );
    }).then(function (pt) {
      return new TextDecoder().decode(pt);
    }).catch(function () {
      throw new Error("解密失败:口令错误或文件已损坏");
    });
  }

  root.MCrypto = { isAvailable: isAvailable, encryptText: encryptText, decryptText: decryptText };
})(typeof window !== "undefined" ? window : globalThis);
