"""Build distributable archives from explicit runtime inputs, never workspace data."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.mcp_cache' / 'release'
VERSION = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']


def archive(name, files, prefix=''):
    destination = OUT / name
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as bundle:
        for file, relative in sorted(files, key=lambda item: str(item[1])):
            bundle.write(file, str(Path(prefix) / relative).replace('\\', '/'))
    return destination


def files_under(folder):
    return [file for file in (ROOT / folder).rglob('*') if file.is_file()
            and not any(part.startswith('.') or part == '__pycache__' for part in file.relative_to(ROOT / folder).parts)]


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    runtime = [ROOT / name for name in ['manifest.json', 'background.js', 'config.js',
        'dashboard.html', 'welcome.html', 'run.bat', 'README.md', 'LICENSE', 'THIRD_PARTY.md']]
    for directory in ['assets', 'styles', 'content']:
        runtime.extend(file for file in files_under(directory)
                       if not file.name.startswith(('test-', 'test_'))
                       and file.suffix not in {'.pyc', '.zip'}
                       and file.name not in {'build-release.py', 'publish-release.py'})
    runtime.extend((ROOT / 'scripts').glob('*.js'))
    runtime.append(ROOT / 'scripts' / 'start.ps1')
    runtime.extend(ROOT / 'python' / name for name in ['mcp_server.py', 'studio_mcp.py', 'usage_stats.py'])
    runtime.extend(ROOT / 'icons' / name for name in ['icon16.png', 'icon48.png', 'icon128.png'])
    # Original 4K research/source assets remain in Git; ship only the active
    # registry and thumbnails needed by the picker, not unused full duplicates.
    registry = (ROOT / 'scripts' / 'appearance.js').read_text(encoding='utf-8')
    backgrounds = set(re.findall(r"(?:file|thumb):'([^']+)'", registry)) | {'PHOTO-SOURCES.md'}
    runtime = [file for file in runtime if file.parent != ROOT / 'assets' / 'bg' or file.name in backgrounds]
    outputs = [archive(f'miracle-mcp-{VERSION}.zip', [(file, file.relative_to(ROOT)) for file in runtime], 'miracle-mcp')]
    site = files_under('website')
    site.append(ROOT / 'website' / '.nojekyll')
    if not (ROOT / 'website' / 'index.html').is_file():
        raise RuntimeError('Website is not ready: website/index.html is missing')
    outputs.append(archive(f'miracle-website-{VERSION}.zip', [(file, file.relative_to(ROOT / 'website')) for file in site]))
    wallpapers = [file for file in files_under('assets/bg') if '-new' in file.name or file.name == 'PHOTO-SOURCES.md']
    outputs.append(archive(f'miracle-wallpapers-{VERSION}.zip', [(file, file.name) for file in wallpapers]))
    checksums = OUT / 'SHA256SUMS.txt'
    checksums.write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in outputs), encoding='utf-8')
    for file in [*outputs, checksums]:
        print(f'{file.name}: {file.stat().st_size:,} bytes')
    with zipfile.ZipFile(outputs[0]) as bundle:
        forbidden = {'token.txt', '2fa.txt', 'queue.json', '.env'}
        if any(Path(name).name in forbidden or '/__pycache__/' in name for name in bundle.namelist()):
            raise RuntimeError('A private/runtime file entered the release archive')


if __name__ == '__main__':
    build()
