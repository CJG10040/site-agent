"""조례 표 만들기 (2026-11-21 묶음 E2).

광주 + 전남·전북 모든 시·군의 도시계획 조례(건폐율·용적률)와 건축 조례(대지 안의 공지·일조 높이 제한)를
국가법령정보센터 공식 API에서 받아 앱이 읽는 표(JSON)로 만든다.

- 인증값은 환경 변수 LAW_OC에서만 읽는다(GitHub 저장소 비밀 값, 사용자가 직접 넣음). 로그·파일에 남기지 않는다.
- 법령센터는 등록한 도메인으로 확인하므로 사이트 주소(Referer)를 밝혀 부른다(2026-11-21 사용자 결정).
- 못 읽은 값은 비워 두고 issues에 적는다(앱은 '확인 필요' + 원문 링크).
- 받기에 실패한 지자체는 지난번 표(--prev)를 그대로 쓰고 stale로 표시한다.
- 지난번 표가 --max-age-days보다 새것이면 받지 않고 그대로 쓴다(배포할 때마다 법령센터를 부르지 않게).

출처 표기: 법제처 국가법령정보센터 (법제처 자료는 출처를 밝혀야 함).
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

VERSION = 1
SITE = 'https://cjg10040.github.io/site-agent/'
API = 'https://www.law.go.kr/DRF/'
SOURCE = '법제처 국가법령정보센터 (www.law.go.kr) 자치법규'

# 2026-07-01 광주·전남 통합: 시·군은 '전남광주통합특별시 ○○', 광역 조례는 '(구)광주광역시'
JEONNAM = ['목포시', '여수시', '순천시', '나주시', '광양시', '담양군', '곡성군', '구례군', '고흥군', '보성군', '화순군',
           '장흥군', '강진군', '해남군', '영암군', '무안군', '함평군', '영광군', '장성군', '완도군', '진도군', '신안군']
JEONBUK = ['전주시', '군산시', '익산시', '정읍시', '남원시', '김제시', '완주군', '진안군', '무주군', '장수군', '임실군',
           '순창군', '고창군', '부안군']

REGIONS = (
    [{'id': 'gwangju', 'name': '광주광역시', 'province': '전남광주통합특별시 (종전 광주광역시)', 'org': '(구)광주광역시',
      'districts': ['동구', '서구', '남구', '북구', '광산구']}]
    + [{'id': f'jn-{n}', 'name': n, 'province': '전남광주통합특별시 (종전 전라남도)', 'org': f'전남광주통합특별시 {n}'} for n in JEONNAM]
    + [{'id': f'jb-{n}', 'name': n, 'province': '전북특별자치도', 'org': f'전북특별자치도 {n}'} for n in JEONBUK]
)

OC = os.environ.get('LAW_OC', '').strip()
HEAD = {'Referer': SITE, 'User-Agent': 'site-agent-law-table (student project)'}


def redact(s: str) -> str:
    return s.replace(OC, '***') if OC else s


def fetch(url: str, tries: int = 3) -> bytes:
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEAD)
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            time.sleep(0.3)  # 법령센터에 부담을 주지 않게
            return data
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            time.sleep(2 + 3 * k)
    raise RuntimeError(redact(f'받기 실패: {last}'))


def api(path: str, **q) -> ET.Element:
    q = {'OC': OC, 'type': 'XML', **q}
    root = ET.fromstring(fetch(API + path + '?' + urllib.parse.urlencode(q)))
    if root.tag == 'Response' or root.findtext('result'):
        raise RuntimeError(f"법령센터 거절: {root.findtext('result')} {root.findtext('msg') or ''}".strip())
    return root


def norm(s: str) -> str:
    return re.sub(r'[\s·ㆍ]', '', s or '')


def flat(s: str) -> str:
    return ' '.join((s or '').split())


def ordin_link(mst: str) -> str:
    return f'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq={mst}'


# ───────────────────────── 조례 찾기 ─────────────────────────

def find_ordinance(name: str, org: str, candidates: list[str]) -> dict | None:
    """이름이 정확히 같고 지자체가 맞는 현행 조례"""
    for cand in candidates:
        root = api('lawSearch.do', target='ordin', query=cand, display=50)
        for it in root.findall('.//law'):
            nm = flat(it.findtext('자치법규명'))
            if norm(nm) != norm(cand):
                continue
            if norm(it.findtext('지자체기관명')) != norm(org):
                continue
            return {
                'name': nm,
                'mst': flat(it.findtext('자치법규일련번호')),
                'id': flat(it.findtext('자치법규ID')),
                'effective': flat(it.findtext('시행일자')),
                'promulgated': flat(it.findtext('공포일자')),
            }
    return None


def body(mst: str) -> ET.Element:
    return api('lawService.do', target='ordin', MST=mst)


def articles(root: ET.Element) -> list[dict]:
    out = []
    for jo in root.findall('.//조'):
        if (jo.findtext('조문여부') or '').strip() not in ('', 'Y'):
            continue
        text = flat(jo.findtext('조내용'))
        title = flat(jo.findtext('조제목'))
        m = re.match(r'(제\d+조(?:의\d+)?)', text)
        no = m.group(1) if m else f"제{(jo.findtext('조문번호') or '').lstrip('0')}조"
        if title or text:
            out.append({'no': no, 'title': title, 'text': text})
    return out


# ───────────────────────── 도시계획 조례: 용도지역별 건폐율·용적률 ─────────────────────────

# 호 하나: '3. 제1종일반주거지역 : 60퍼센트 이하(다만 …) 다만, …'
ITEM_START = re.compile(r'(?<!\S)(\d{1,2})\.\s+')
ITEM_RE = re.compile(
    r'^([가-힣0-9]+(?:[ ·ㆍ][가-힣0-9]+)*?지역)\s*[:：]\s*'
    r'(\d+(?:\.\d+)?)\s*퍼센트(?:\s*(이하|이상|이내|미만))?(.*)$',
    re.S,
)


def first_paragraph(text: str) -> str:
    """조문의 첫 항(①)만 — 뒤 항의 특례 숫자가 섞이지 않게"""
    m = re.search(r'\s②', text)
    return text[: m.start()] if m else text


def zone_values(text: str) -> dict:
    out: dict = {}
    text = first_paragraph(text)
    starts = list(ITEM_START.finditer(text))
    for k, s in enumerate(starts):
        item = text[s.end(): starts[k + 1].start() if k + 1 < len(starts) else len(text)].strip()
        m = ITEM_RE.match(item)
        if not m:
            continue
        zone = norm(m.group(1))
        if zone in out:
            continue
        # 덧붙임: 괄호·'다만' 글 (개정 표시는 뺌)
        note = re.sub(r'<[^>]*>', '', m.group(4))
        note = flat(note).strip(' .,')
        if note.startswith('(') and note.endswith(')'):
            note = note[1:-1]
        note = note.replace(')', ') ', 1) if note.startswith('(') else note
        out[zone] = {'pct': float(m.group(2)) if '.' in m.group(2) else int(m.group(2)), 'bound': m.group(3) or '이하', **({'note': note.strip()} if note.strip() else {})}
    return out


def urban_values(arts: list[dict], key: str) -> tuple[dict, list[str]]:
    """key = '건폐율' 또는 '용적률' — 용도지역·관리지역 등 조문에서 지역별 값"""
    vals: dict = {}
    used: list[str] = []
    for a in arts:
        t = a['title']
        if key not in t:
            continue
        if not re.search(r'(용도지역|관리지역|농림지역|자연환경보전지역)', t):
            continue
        got = zone_values(a['text'])
        if not got:
            continue
        used.append(f"{a['no']}({t})")
        for z, v in got.items():
            if z not in vals:
                vals[z] = {**v, 'article': a['no']}
    return vals, used


# ───────────────────────── 건축 조례: 대지 안의 공지(별표)·일조 ─────────────────────────

def hwpx_text(data: bytes) -> str | None:
    if data[:2] != b'PK':
        return None
    z = zipfile.ZipFile(io.BytesIO(data))
    parts = []
    for n in sorted(n for n in z.namelist() if re.match(r'Contents/section\d+\.xml$', n)):
        x = z.read(n).decode('utf-8', 'replace')
        x = re.sub(r'</hp:p>', '\n', x)
        x = re.sub(r'<[^>]+>', ' ', x)
        x = x.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&').replace('&quot;', '"')
        parts.append('\n'.join(' '.join(l.split()) for l in x.split('\n') if l.strip()))
    return '\n'.join(parts).strip() or None


def table_text(root: ET.Element, no: int) -> tuple[str | None, str, str | None]:
    """별표 no의 글: (글, 제목, 못 읽은 까닭)"""
    for u in root.findall('.//별표단위'):
        if (u.findtext('별표구분') or '').strip() not in ('', '별표'):
            continue
        try:
            n = int(re.sub(r'\D', '', u.findtext('별표번호') or '') or -1)
        except ValueError:
            continue
        if n != no:
            continue
        title = flat(u.findtext('별표제목'))
        txt = (u.findtext('별표내용') or '').strip()
        if txt:
            return txt, title, None
        url = (u.findtext('별표첨부파일명') or '').strip()
        kind = (u.findtext('별표첨부파일구분') or '').strip().lower()
        if not url.startswith('http'):
            return None, title, '별표 파일 주소가 없음'
        data = fetch(url)
        if kind == 'hwpx' or data[:2] == b'PK':
            t = hwpx_text(data)
            return (t, title, None) if t else (None, title, '별표 파일(hwpx)에서 글을 찾지 못함')
        return None, title, f'별표가 {kind or "알 수 없는"} 파일이라 글을 읽지 못함'
    return None, '', f'별표 {no}를 찾지 못함'


def building_values(root: ET.Element, arts: list[dict]) -> tuple[dict, list[str]]:
    out: dict = {}
    issues: list[str] = []
    for a in arts:
        if re.search(r'대지\s*안의\s*공지', a['title']):
            m = re.search(r'별표\s*(\d+)', a['text'])
            entry = {'article': a['no'], 'title': a['title'], 'text': a['text'][:1500]}
            if m:
                t, ttitle, why = table_text(root, int(m.group(1)))
                entry['table'] = f'별표 {m.group(1)}' + (f' {ttitle}' if ttitle else '')
                if t:
                    entry['tableText'] = t[:12000]
                else:
                    issues.append(f"대지 안의 공지 {entry['table']}: {why}")
            out['setback'] = entry
            break
    else:
        issues.append('대지 안의 공지 조문을 찾지 못함')
    for a in arts:
        if '일조' in a['title']:
            out['sunlight'] = {'article': a['no'], 'title': a['title'], 'text': a['text'][:3000]}
            break
    return out, issues


# ───────────────────────── 특별법 경과조치 (광주·전남 통합) ─────────────────────────

def transition_note() -> dict | None:
    root = api('lawSearch.do', target='law', query='전남광주통합특별시 설치를 위한 특별법', display=5)
    law = next((i for i in root.findall('.//law') if flat(i.findtext('법령명한글')) == '전남광주통합특별시 설치를 위한 특별법'), None)
    if law is None:
        return None
    mst = flat(law.findtext('법령일련번호'))
    b = api('lawService.do', target='law', MST=mst)
    found = []
    for e in b.iter():
        if e.tag not in ('부칙내용', '조문내용', '항내용'):
            continue
        t = flat(''.join(e.itertext()))
        if '조례' in t and re.search(r'종전|경과', t) and re.search(r'효력|적용|본다', t):
            found.append(t)
    found = sorted(set(found), key=len)[:3]
    return {
        'law': '전남광주통합특별시 설치를 위한 특별법',
        'effective': flat(law.findtext('시행일자')),
        'url': 'https://www.law.go.kr/법령/전남광주통합특별시설치를위한특별법',
        'excerpts': [t[:1200] for t in found],
    }


# ───────────────────────── 지자체 하나 ─────────────────────────

def region_entry(r: dict) -> dict:
    n = r['name']
    issues: list[str] = []
    entry = {k: v for k, v in r.items() if k != 'org'}
    entry['org'] = r['org']

    urban = find_ordinance(n, r['org'], [f'{n} 도시계획 조례', f'{n} 계획 조례', f'{n} 군계획 조례', f'{n} 시계획 조례'])
    if urban:
        root = body(urban['mst'])
        arts = articles(root)
        bcr, used_b = urban_values(arts, '건폐율')
        far, used_f = urban_values(arts, '용적률')
        urban.update({'url': ordin_link(urban['mst']), 'bcr': bcr, 'far': far, 'from': used_b + used_f})
        if not bcr:
            issues.append('용도지역별 건폐율을 조문에서 읽지 못함')
        if not far:
            issues.append('용도지역별 용적률을 조문에서 읽지 못함')
        entry['urban'] = urban
    else:
        issues.append('도시계획 조례를 찾지 못함')

    building = find_ordinance(n, r['org'], [f'{n} 건축 조례'])
    if building:
        root = body(building['mst'])
        vals, more = building_values(root, articles(root))
        building.update({'url': ordin_link(building['mst']), **vals})
        issues += more
        entry['building'] = building
    else:
        issues.append('건축 조례를 찾지 못함')

    entry['issues'] = issues
    return entry


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--prev', default='')
    ap.add_argument('--max-age-days', type=float, default=7)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--only', default='', help='지자체 이름(쉼표) — 시험용')
    a = ap.parse_args()

    prev = None
    if a.prev and os.path.exists(a.prev):
        try:
            prev = json.load(open(a.prev, encoding='utf-8'))
            if prev.get('version') != VERSION:
                prev = None
        except (ValueError, OSError):
            prev = None

    now = dt.datetime.now(dt.timezone.utc)
    if prev and not a.force and not a.only:
        age = (now - dt.datetime.fromisoformat(prev['checkedAt'])).total_seconds() / 86400
        if age < a.max_age_days:
            print(f'지난 표가 {age:.1f}일 전 것 — 그대로 씀')
            json.dump(prev, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            return 0

    if not OC:
        print('LAW_OC가 없어 새로 받지 않음' + (' — 지난 표를 그대로 씀' if prev else ''))
        if prev:
            json.dump(prev, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        return 0

    prev_by_id = {r['id']: r for r in (prev or {}).get('regions', [])}
    only = {x.strip() for x in a.only.split(',') if x.strip()}
    regions = []
    for r in REGIONS:
        if only and r['name'] not in only:
            continue
        try:
            e = region_entry(r)
            e['checkedAt'] = now.isoformat(timespec='seconds')
            regions.append(e)
            print(f"{r['org']}: 건폐율 {len(e.get('urban', {}).get('bcr', {}))} · 용적률 {len(e.get('urban', {}).get('far', {}))} · 공지 {'있음' if e.get('building', {}).get('setback', {}).get('tableText') else '없음'} · 문제 {len(e['issues'])}")
        except Exception as ex:  # 한 곳이 실패해도 나머지는 계속
            msg = redact(str(ex))
            print(f"{r['org']}: 실패 — {msg}")
            old = prev_by_id.get(r['id'])
            regions.append({**old, 'stale': True, 'staleReason': msg} if old else {**{k: v for k, v in r.items()}, 'issues': [f'받지 못함: {msg}'], 'stale': True})

    try:
        trans = transition_note()
    except Exception as ex:
        print('특별법 경과조치 받기 실패:', redact(str(ex)))
        trans = (prev or {}).get('transition')

    out = {
        'version': VERSION,
        'checkedAt': now.isoformat(timespec='seconds'),
        'source': SOURCE,
        'transition': trans,
        'regions': regions,
    }
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ok = sum(1 for r in regions if not r.get('stale'))
    print(f'지자체 {len(regions)}곳 중 {ok}곳 새로 받음 → {a.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
