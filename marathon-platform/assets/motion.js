/* =========================================================================
   motion.js — 动效层(纯装饰,不参与任何状态判断)
   -------------------------------------------------------------------------
   只做三件事,全部与数据无关:
     1. 顶栏计时器    —— 每秒走动的"跑步表",给出全站都在跑的观感
     2. 赛道进度条    —— 随滚动推进的顶部橙色分道线
     3. KPI 数字冲刺  —— 每次看板重绘后,数字从 0 递增到目标值
   用户系统里开启「减少动态效果」时,1 与 3 直接跳过(进度条属功能性反馈,保留)。
   本文件不读写存储、不碰引擎,删掉它页面功能完全不受影响。
   ========================================================================= */
(function () {
  "use strict";

  var reduce = false;
  try {
    reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) { reduce = false; }

  /* -------------------------------------------------- 1. 顶栏计时器 */
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  var clock = document.getElementById("clock");
  if (clock) {
    var tick = function () {
      var d = new Date();
      clock.textContent = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    };
    tick();
    if (!reduce) setInterval(tick, 1000);
  }

  /* -------------------------------------------------- 2. 赛道进度条 */
  var prog = document.getElementById("laneProgress");
  if (prog) {
    var onScroll = function () {
      var h = document.documentElement;
      var max = (h.scrollHeight - h.clientHeight) || 1;
      var top = window.pageYOffset || h.scrollTop || 0;
      prog.style.width = Math.min(100, Math.max(0, (top / max) * 100)) + "%";
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    setTimeout(onScroll, 80);
  }

  /* -------------------------------------------- 3. KPI 数字冲刺递增 */
  function countUp(el) {
    var target = parseInt(String(el.textContent).replace(/[^\d-]/g, ""), 10);
    if (!isFinite(target) || target === 0) return;
    if (el.dataset && el.dataset.counted === String(target)) return;
    if (el.dataset) el.dataset.counted = String(target);

    var dur = 520, t0 = null;
    var ease = function (p) { return 1 - Math.pow(1 - p, 3); };  /* easeOutCubic */
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      el.textContent = String(Math.round(target * ease(p)));
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = String(target);
    }
    requestAnimationFrame(frame);
  }

  var kpis = document.getElementById("kpis");
  if (kpis) {
    var runAll = function () {
      if (reduce) return;
      Array.prototype.forEach.call(kpis.querySelectorAll(".n"), countUp);
    };
    runAll();                                   /* app.js 已画完首屏 */
    if (window.MutationObserver) {
      new MutationObserver(runAll).observe(kpis, { childList: true });
    }
  }
})();
