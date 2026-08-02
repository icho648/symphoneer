#!/usr/bin/env bash
# Serve a generated HTML index over the Markdown documentation tree.
# This is the only runnable surface while the repo remains docs-only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${DOCS_PREVIEW_PORT:-4173}"
HOST="${DOCS_PREVIEW_HOST:-127.0.0.1}"
OUT="$ROOT/.docs-preview"

mkdir -p "$OUT"

python3 - "$ROOT" "$OUT" <<'PY'
import html
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

md_files = sorted(p for p in root.rglob("*.md") if ".git" not in p.parts and ".docs-preview" not in p.parts)

rows = []
for path in md_files:
    rel = path.relative_to(root).as_posix()
    rows.append(
        f'<li><a href="/raw/{html.escape(rel)}">{html.escape(rel)}</a></li>'
    )

index = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Symphony Workbench — Docs Preview</title>
  <style>
    :root {{
      --bg: #0f1419;
      --panel: #172028;
      --text: #e7eef5;
      --muted: #9bb0c3;
      --accent: #3d9bfd;
      --line: #2a3845;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      color: var(--text);
      background:
        radial-gradient(1200px 600px at 10% -10%, #1d3348 0%, transparent 55%),
        radial-gradient(900px 500px at 100% 0%, #24301f 0%, transparent 45%),
        var(--bg);
      min-height: 100vh;
    }}
    main {{
      max-width: 920px;
      margin: 0 auto;
      padding: 4rem 1.5rem 5rem;
    }}
    h1 {{
      font-size: clamp(2.4rem, 6vw, 4rem);
      letter-spacing: -0.03em;
      margin: 0 0 0.5rem;
    }}
    p {{
      color: var(--muted);
      font-size: 1.1rem;
      line-height: 1.6;
      max-width: 42rem;
    }}
    .panel {{
      margin-top: 2rem;
      padding: 1.25rem 1.5rem;
      background: color-mix(in srgb, var(--panel) 88%, transparent);
      border: 1px solid var(--line);
      backdrop-filter: blur(8px);
    }}
    ul {{
      list-style: none;
      padding: 0;
      margin: 0;
      columns: 1;
    }}
    @media (min-width: 720px) {{
      ul {{ columns: 2; column-gap: 2rem; }}
    }}
    li {{
      break-inside: avoid;
      margin: 0.35rem 0;
      font-family: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      font-size: 0.86rem;
    }}
    a {{ color: var(--accent); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .meta {{
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin-top: 1.25rem;
      color: var(--muted);
      font-family: "IBM Plex Mono", Menlo, Consolas, monospace;
      font-size: 0.8rem;
    }}
  </style>
</head>
<body>
  <main>
    <h1>Symphony Workbench</h1>
    <p>当前仓库仍是文档化产品契约阶段。此预览只暴露 Markdown 事实源，不代表应用运行时。</p>
    <div class="panel">
      <div class="meta">
        <span>files: {len(md_files)}</span>
        <span>stage: docs-only</span>
        <span>health: /healthz</span>
      </div>
      <ul>
        {''.join(rows)}
      </ul>
    </div>
  </main>
</body>
</html>
"""
(out / "index.html").write_text(index, encoding="utf-8")

# Mirror markdown files under /raw for direct browsing.
raw = out / "raw"
for path in md_files:
    rel = path.relative_to(root)
    dest = raw / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(path.read_bytes())

print(f"Generated preview for {len(md_files)} markdown files at {out}", flush=True)
PY

cd "$OUT"
echo "Docs preview listening on http://${HOST}:${PORT}/"
echo "Health check: http://${HOST}:${PORT}/healthz"
# Tiny health endpoint via a static file plus python server.
printf 'ok\n' > healthz
exec python3 -m http.server "$PORT" --bind "$HOST"
