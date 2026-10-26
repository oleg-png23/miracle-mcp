"""Publish verified release archives using the existing Git credential helper.

Credentials stay in memory. Run build-release.py and commit/push before invoking.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.mcp_cache' / 'release'
REPOSITORY = 'oleg-png23/miracle-mcp'


def credential():
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if token:
        return token
    result = subprocess.run(['git', '-c', f'safe.directory={ROOT.as_posix()}', 'credential', 'fill'],
        input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, timeout=25,
        env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}, check=False)
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if not values.get('password'):
        raise RuntimeError('No cached GitHub credential is available')
    return values['password']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--commit', required=True)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--pages', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.commit):
        raise RuntimeError('Expected a verified full commit SHA')
    version = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
    tag = f'v{version}'
    files = [OUT / f'helium-{name}-{version}.zip' for name in ['mcp', 'website', 'wallpapers']]
    files.append(OUT / 'SHA256SUMS.txt')
    for file in files:
        if not file.is_file():
            raise RuntimeError(f'Missing release artifact: {file.name}')
    if not args.publish:
        print(json.dumps({'tag': tag, 'commit': args.commit, 'files': [file.name for file in files]}))
        return
    token = credential()

    def request(path, method='GET', body=None, binary=None):
        url = path if path.startswith('https://uploads.github.com/') else 'https://api.github.com' + path
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                   'User-Agent': 'Helium-Release', 'X-GitHub-Api-Version': '2026-03-10'}
        data = json.dumps(body).encode() if body is not None else None
        if binary is not None:
            data = binary
            headers['Content-Type'] = 'application/octet-stream'
        elif data is not None:
            headers['Content-Type'] = 'application/json'
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=90) as response:
            payload = response.read()
            return json.loads(payload) if payload else {}

    base = '/repos/' + REPOSITORY
    try:
        release = request(base + '/releases/tags/' + tag)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        notes = (ROOT / 'RELEASE_NOTES.md').read_text(encoding='utf-8')
        release = request(base + '/releases', 'POST', {'tag_name': tag, 'target_commitish': args.commit,
            'name': f'Helium {version}', 'body': notes, 'draft': True, 'prerelease': False})
    if release['target_commitish'] not in {args.commit, 'main'}:
        raise RuntimeError('The existing release targets a different revision')
    existing = {asset['name']: asset for asset in release.get('assets', [])}
    uploaded = []
    for file in files:
        digest = 'sha256:' + hashlib.sha256(file.read_bytes()).hexdigest()
        if file.name in existing:
            asset = existing[file.name]
            if asset.get('digest') != digest:
                raise RuntimeError(f'Existing release asset differs: {file.name}')
        else:
            upload = release['upload_url'].split('{', 1)[0] + '?name=' + urllib.parse.quote(file.name)
            asset = request(upload, 'POST', binary=file.read_bytes())
        uploaded.append({'name': file.name, 'url': asset['browser_download_url'], 'size': asset['size'], 'digest': asset.get('digest')})
        print('Uploaded', file.name, flush=True)
    if release['draft']:
        release = request(base + '/releases/' + str(release['id']), 'PATCH', {'draft': False, 'make_latest': 'true'})
    result = {'release': release['html_url'], 'tag': tag, 'commit': args.commit, 'assets': uploaded}
    if args.pages:
        try:
            pages = request(base + '/pages')
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            pages = request(base + '/pages', 'POST', {'source': {'branch': 'main', 'path': '/docs'}, 'build_type': 'legacy'})
        if pages.get('source') != {'branch': 'main', 'path': '/docs'}:
            raise RuntimeError('Existing Pages source differs; preserve it and resolve explicitly')
        result['site'] = pages['html_url']
        request(base, 'PATCH', {'homepage': pages['html_url']})
        print('Website', pages['html_url'], flush=True)
    (OUT / 'published.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
