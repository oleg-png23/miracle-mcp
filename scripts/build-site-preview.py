"""Publish the real entry pages as an isolated, offline GitHub Pages demo."""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]


def build():
    site = ROOT / 'website'
    preview = site / 'preview'
    preview.mkdir(exist_ok=True)
    for folder in ['styles', 'assets/icons']:
        shutil.copytree(ROOT / folder, preview / folder, dirs_exist_ok=True)
    backgrounds = (ROOT / 'scripts/appearance.js').read_text()
    for name in set(re.findall(r"(?:file|thumb):'([^']+)'", backgrounds)) | {'PHOTO-SOURCES.md'}:
        destination = preview / 'assets/bg' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / 'assets/bg' / name, destination)
    scripts = preview / 'scripts'
    scripts.mkdir(exist_ok=True)
    names = ['setup-guide', 'appearance', 'dashboard', 'welcome', 'rail', 'usage',
             'chat-prompt', 'executor', 'dashboard-glass', 'surfaces', 'welcome-motion']
    for name in names:
        source = (ROOT / 'scripts' / f'{name}.js').read_text()
        if name == 'dashboard':
            old = "await fetch(`http://${currentHost}/api/status`, {cache:'no-store', signal:controller.signal})"
            assert old in source, 'Dashboard transport changed; review preview isolation.'
            source = source.replace(old, "({ok:true, json:() => client.request(currentHost, '/api/status')})")
            source = source.replace("return isSameOriginLocal() || Boolean(globalThis.chrome?.runtime?.id);", 'return false;')
        # Keep demo drafts and pending jobs separate from the installed application.
        source = source.replace('miracles.code', 'miracle.preview.code').replace('miracles.pending', 'miracle.preview.pending')
        (scripts / f'{name}.js').write_text(source)
    shutil.copy2(site / 'preview-client.js', scripts / 'bridge-client.js')
    for page in ['dashboard', 'welcome']:
        html = (ROOT / f'{page}.html').read_text()
        html = html.replace('<script src="config.js" defer></script>', '')
        html = html.replace('</head>', '<link rel="stylesheet" href="../preview.css"></head>')
        html = re.sub(r'(<body[^>]*>)', r'\1\n' + '''<nav class="demo-banner" aria-label="Preview navigation"><a href="../index.html">← Miracle MCP</a><span>INTERACTIVE PREVIEW · Sample data · No Studio connection</span><div><a href="welcome.html">Start page</a><a href="dashboard.html">Dashboard</a><a href="https://github.com/oleg-png23/miracle-mcp/releases/latest">Download ↗</a></div></nav><noscript><p class="demo-noscript">Enable JavaScript to explore the interactive demo. All connection values below are placeholders.</p></noscript>''', html, count=1)
        html = html.replace('<title>', '<title>Preview · ')
        if page == 'dashboard':
            html = html.replace('Run in Studio ', 'Preview only ')
        (preview / f'{page}.html').write_text(html)
    # GitHub Pages serves /docs; keep its source identical to the standalone site.
    shutil.copytree(site, ROOT / 'docs', dirs_exist_ok=True)


if __name__ == '__main__':
    build()
