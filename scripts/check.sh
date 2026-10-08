#!/usr/bin/env sh
# =========================================================
# 本地自检 —— 不需要令牌、不需要权限、不需要 CI
#
#   sh scripts/check.sh
#
# 跑四件事:
#   1. 语法检查(全部源码)
#   2. 运行时回归(83 项断言,失败即非 0)
#   3. 巡检冒烟(全新克隆下应回退到入库模板,退出码 0)
#   4. 隐私守卫(含个人数据的文件不得被 git 跟踪)
#
# 全部通过 → 退出码 0;任一项失败 → 退出码 1。
#
# 为什么不做成 GitHub Actions:在 .github/workflows/ 下创建文件需要
# 带 workflow 权限的令牌。这个脚本用的是同一批断言,但谁都能跑、零权限要求,
# 而且在本地就能拦下来,不用等 push 之后。
# =========================================================
set -u

cd "$(dirname "$0")/.." || exit 1

NODE="${NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
  echo "找不到 node。可用 NODE=/path/to/node 指定。需要 Node >= 18。" >&2
  exit 1
fi

FAIL=0
pass()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()     { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------- 1. 语法检查 ----------
section "1/4 语法检查"
for f in \
  marathon-platform/assets/engine.js \
  marathon-platform/assets/store.js \
  marathon-platform/assets/auth.js \
  marathon-platform/assets/cloud.js \
  marathon-platform/assets/app.js \
  marathon-platform/assets/motion.js \
  tools/digest.js \
  tools/notify.js \
  tests/regression.js
do
  if "$NODE" --check "$f" >/dev/null 2>&1; then pass "$f"; else bad "$f"; fi
done

# ---------- 2. 运行时回归 ----------
section "2/4 运行时回归(期望 96 通过 / 0 失败)"
if "$NODE" tests/regression.js; then
  pass "回归通过"
else
  bad "回归未通过"
fi

# ---------- 3. 巡检冒烟 ----------
# 用 --out 写到临时目录:避免覆盖你当天真实的 reports/ 摘要。
section "3/4 巡检冒烟(全新克隆下应回退到入库模板)"
SMOKE="$(mktemp -d 2>/dev/null || echo "${TMPDIR:-/tmp}/marathon-smoke.$$")"
mkdir -p "$SMOKE"
if "$NODE" tools/digest.js --date 2026-10-07T17:30 --out "$SMOKE" >/dev/null 2>&1; then
  pass "digest.js 退出码 0"
  for n in \
    marathon_digest_2026-10-07.md \
    marathon_digest_2026-10-07.email.html \
    urgent_2026-10-07.json
  do
    if [ -f "$SMOKE/$n" ]; then pass "生成 $n"; else bad "缺少 $n"; fi
  done
else
  bad "digest.js 退出码非 0"
fi
rm -rf "$SMOKE"

# ---------- 4. 隐私守卫 ----------
section "4/4 隐私守卫(含个人数据的文件不得进仓库)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  for f in data/marathon_watchlist.json AGENT_MAIL_SETUP.md; do
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      bad "$f 被 git 跟踪 —— 含个人数据,必须从索引移除"
    else
      pass "$f 未被跟踪"
    fi
  done
  if [ -n "$(git ls-files reports)" ]; then
    bad "reports/ 下有文件被跟踪 —— 每日摘要含关注清单快照,不应入库"
  else
    pass "reports/ 未被跟踪"
  fi
else
  echo "  (当前不在 git 仓库中,跳过)"
fi

# ---------- 汇总 ----------
printf '\n'
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m========== 全部通过 ==========\033[0m\n'
else
  printf '\033[31m========== 有检查未通过,见上方 ✗ ==========\033[0m\n'
fi
exit "$FAIL"
