"use strict";
/* 加密备份模块守卫(独立运行,依赖 Node18+ 的 Web Crypto 全局)
   验证:A. 密文不含明文  B. 口令正确可还原  C. 错误口令失败  D. 非法结构失败 */
require("../marathon-platform/assets/crypto.js");
const assert = require("assert");
const MC = globalThis.MCrypto;

(async () => {
  assert.ok(MC && MC.isAvailable(), "MCrypto.isAvailable 应为 true(Node18+ webcrypto)");

  const plain = JSON.stringify({
    name: "张三", idNo: "110101199001011234",
    profile: { phone: "13800000000", ecName: "李四" }
  });

  const cipher = await MC.encryptText(plain, "pw-123");

  // A. 密文不得含明文
  const serialized = JSON.stringify(cipher);
  assert.ok(!serialized.includes("张三"), "密文不得含明文姓名");
  assert.ok(!serialized.includes("110101199001011234"), "密文不得含明文证件号");
  assert.ok(!serialized.includes("13800000000"), "密文不得含明文手机号");

  // B. 口令正确可还原
  const back = await MC.decryptText(cipher, "pw-123");
  assert.strictEqual(back, plain, "解密应还原原文");

  // C. 错误口令必须失败
  let wrongFailed = false;
  try { await MC.decryptText(cipher, "wrong-pw"); } catch (e) { wrongFailed = true; }
  assert.ok(wrongFailed, "错误口令必须解密失败");

  // D. 非法结构必须失败
  let badStruct = false;
  try { await MC.decryptText({ v: 99 }, "pw-123"); } catch (e) { badStruct = true; }
  assert.ok(badStruct, "非法结构必须解密失败");

  console.log("crypto.test: PASS (5 项断言)");
})().catch(function (e) {
  console.error("crypto.test FAIL:", e.message);
  process.exit(1);
});
