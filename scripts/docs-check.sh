#!/usr/bin/env bash
# Phase 0 documentation validation suite for the current docs-only baseline.
# Exit 0 only when every check passes. No application runtime is required.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

command -v ruby >/dev/null || fail "ruby is required for Phase 0 docs checks"
command -v rg >/dev/null || fail "rg (ripgrep) is required for status scans"

echo "==> Markdown local-link check"
ruby -rpathname -ruri -e '
missing = []
Dir["**/*.md"].sort.each do |file|
  File.read(file).scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw|
    target = raw.strip
    next if target.match?(/\A(?:https?:|mailto:|data:|#)/)
    target = target[1...-1] if target.start_with?("<") && target.end_with?(">")
    target = target.split("#", 2).first.split("?", 2).first
    next if target.empty?
    path = Pathname.new(file).dirname.join(URI::DEFAULT_PARSER.unescape(target)).cleanpath
    missing << "#{file}: #{raw}" unless path.exist?
  end
end
puts missing
exit(missing.empty? ? 0 : 1)
'

echo "==> Partition index coverage"
ruby -rpathname -ruri -e '
dirs = %w[
  docs/design-docs
  docs/product-specs
  docs/references
  docs/research
  docs/exec-plans/active
  docs/exec-plans/completed
]
missing = []
dirs.each do |dir|
  index = "#{dir}/index.md"
  linked = File.read(index).scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.map do |raw|
    target = raw.strip
    next if target.match?(/\A(?:https?:|mailto:|data:|#)/)
    target = target[1...-1] if target.start_with?("<") && target.end_with?(">")
    target = target.split("#", 2).first.split("?", 2).first
    next if target.empty?
    Pathname.new(dir).join(URI::DEFAULT_PARSER.unescape(target)).cleanpath.to_s
  end.compact
  Dir["#{dir}/*.md"].sort.each do |leaf|
    next if leaf == index
    missing << "#{leaf}: missing from #{index}" unless linked.include?(Pathname.new(leaf).cleanpath.to_s)
  end
end
puts missing
exit(missing.empty? ? 0 : 1)
'

echo "==> ExecPlan required H2 chapters"
ruby -e '
expected = [
  "Purpose / Big Picture",
  "Progress",
  "Surprises & Discoveries",
  "Decision Log",
  "Outcomes & Retrospective",
  "Context and Orientation",
  "Plan of Work",
  "Concrete Steps",
  "Validation and Acceptance",
  "Idempotence and Recovery",
  "Artifacts and Notes",
  "Interfaces and Dependencies"
]
actual = File.readlines("docs/exec-plans/active/symphony-workbench-v1.md").map do |line|
  line[/\A## (.+?)\s*\z/, 1]
end.compact
abort("ExecPlan H2 mismatch: #{actual.inspect}") unless actual == expected
puts "ExecPlan H2: 12/12"
'

echo "==> Normative status headers"
rg -n '^> (Decision status|Implementation evidence|Project adoption|Contract evidence|External source status):' \
  README.md ARCHITECTURE.md docs/design-docs docs/product-specs docs/references docs/exec-plans/active \
  || fail "status header scan failed"

echo "==> Reject unresolved product decisions in normative docs"
if rg -n 'Decision status: Proposed|## 尚未决定|实现方式未决定|V1 计划只读' \
  README.md docs/design-docs docs/product-specs docs/references; then
  fail "found unresolved Proposed / undecided product language"
fi

echo "==> Git hygiene"
git status --short
git diff --check

echo "==> Environment toolchain"
ruby -v
node -v
pnpm -v
rg --version | head -1

echo
echo "PASS: docs-only Phase 0 validation suite"
echo "NOTE: no application process exists yet; pnpm check / pnpm dev are Phase 1+."
