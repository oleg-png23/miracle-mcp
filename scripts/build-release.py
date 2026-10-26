"""Build distributable archives from explicit runtime inputs, never workspace data."""
import hashlib
import json
from pathlib import Path
import re
import runpy
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


def runtime_entries():
    plugin = [ROOT / name for name in ['manifest.json', 'background.js', 'config.js',
        'dashboard.html', 'welcome.html', 'INSTALL.md', 'LICENSE', 'THIRD_PARTY.md']]
    for directory in ['assets', 'styles', 'content']:
        plugin.extend(file for file in files_under(directory)
                      if not file.name.startswith(('test-', 'test_'))
                      and file.suffix not in {'.pyc', '.zip'})
    plugin.extend((ROOT / 'scripts').glob('*.js'))
    plugin.extend(ROOT / 'icons' / name for name in ['icon16.png', 'icon48.png', 'icon128.png'])
    registry = (ROOT / 'scripts' / 'appearance.js').read_text(encoding='utf-8')
    backgrounds = set(re.findall(r"(?:file|thumb):'([^']+)'", registry)) | {'PHOTO-SOURCES.md'}
    plugin = [file for file in plugin if file.parent != ROOT / 'assets' / 'bg' or file.name in backgrounds]
    bridge = [ROOT / name for name in ['run.bat', 'stop.bat', 'scripts/start.ps1', 'python/mcp_server.py',
        'python/studio_mcp.py', 'python/usage_stats.py', 'INSTALL.md', 'LICENSE', 'THIRD_PARTY.md', 'RELEASE_NOTES.md']]
    return [(file, Path('plugin') / file.relative_to(ROOT)) for file in plugin] + [
        (file, Path('release') / file.relative_to(ROOT)) for file in bridge]


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    outputs = [archive(f'miracle-mcp-{VERSION}.zip', runtime_entries())]
    runpy.run_path(str(ROOT / 'scripts' / 'build-site-preview.py'), run_name='__main__')
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
        if {Path(name).parts[0] for name in bundle.namelist()} != {'plugin', 'release'}:
            raise RuntimeError('The main release must contain exactly plugin/ and release/')
        forbidden = {'token.txt', '2fa.txt', 'queue.json', '.env'}
        if any(Path(name).name in forbidden or '/__pycache__/' in name for name in bundle.namelist()):
            raise RuntimeError('A private/runtime file entered the release archive')


if __name__ == '__main__':
    build()
