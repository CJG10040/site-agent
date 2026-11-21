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


def fetch(url: str, tries: int = 5) -> bytes:
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
            time.sleep(3 * 2 ** k)  # 3·6·12·24초
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

def find_ordinance(name: str, org: str, queries: list[str], pattern: str) -> dict | None:
    """이름이 꼴(pattern, 띄어쓰기·가운뎃점 뺀 이름에 맞춤)에 맞고 지자체가 맞는 현행 조례"""
    pat = re.compile(pattern)
    seen: list[str] = []
    for q in queries:
        root = api('lawSearch.do', target='ordin', query=q, display=100)
        for it in root.findall('.//law'):
            nm = flat(it.findtext('자치법규명'))
            if norm(it.findtext('지자체기관명')) != norm(org):
                continue
            if not pat.fullmatch(norm(nm)):
                if nm not in seen:
                    seen.append(nm)
                continue
            return {
                'name': nm,
                'mst': flat(it.findtext('자치법규일련번호')),
                'id': flat(it.findtext('자치법규ID')),
                'effective': flat(it.findtext('시행일자')),
                'promulgated': flat(it.findtext('공포일자')),
            }
    LAST_CANDIDATES[:] = seen[:12]
    return None


LAST_CANDIDATES: list[str] = []


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
ITEM_START = re.compile(r'(?<!\S)(\d{1,2})\.(?!\d)\s*')
ITEM_RE = re.compile(
    r'^([가-힣0-9]+(?:[ ·ㆍ][가-힣0-9]+)*?지역)\s*[:：]\s*'
    r'(?:100분의\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:퍼센트|%))'
    r'(?:\s*(이하|이상|이내|미만))?(.*)$',
    re.S,
)


def first_paragraph(text: str) -> str:
    """조문의 첫 항(①)만 — 뒤 항의 특례 숫자가 섞이지 않게"""
    m = re.search(r'\s②', text)
    return text[: m.start()] if m else text


def zone_values(text: str) -> dict:
    out: dict = {}
    # 개정·신설 표시(<개정 2022. 9. 15.>)의 '9.'가 호 번호로 잘못 읽히지 않게 먼저 뺌
    text = re.sub(r'<[^<>]*>|〈[^〈〉]*〉', ' ', first_paragraph(text))
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
        note = re.sub(r'<[^>]*>|〈[^〉]*〉', '', m.group(5))
        note = flat(note).strip(' .,')
        if note.startswith('(') and note.endswith(')'):
            note = note[1:-1]
        note = note.replace(')', ') ', 1) if note.startswith('(') else note
        num = (m.group(2) or m.group(3)).replace(',', '')
        out[zone] = {'pct': float(num) if '.' in num else int(num), 'bound': m.group(4) or '이하', **({'note': note.strip()} if note.strip() else {})}
    return out


ZONES = {'제1종전용주거지역', '제2종전용주거지역', '제1종일반주거지역', '제2종일반주거지역', '제3종일반주거지역', '준주거지역',
         '중심상업지역', '일반상업지역', '근린상업지역', '유통상업지역', '전용공업지역', '일반공업지역', '준공업지역',
         '보전녹지지역', '생산녹지지역', '자연녹지지역', '보전관리지역', '생산관리지역', '계획관리지역', '농림지역', '자연환경보전지역'}


def urban_values(arts: list[dict], key: str) -> tuple[dict, list[str]]:
    """key = '건폐율' 또는 '용적률' — 용도지역·관리지역 등 조문에서 지역별 값"""
    vals: dict = {}
    used: list[str] = []
    cands = [a for a in arts if key in a['title']]
    cands.sort(key=lambda a: 0 if re.search(r'용도지역|용도구역|지역\s*안|지역에서', a['title']) else 1)
    for a in cands:
        t = a['title']
        got = zone_values(a['text'])
        if len(got) < 3:
            continue
        used.append(f"{a['no']}({t})")
        for z, v in got.items():
            if z in ZONES and z not in vals:
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


def _cfb_streams(data: bytes) -> dict[str, bytes]:
    """OLE(복합 문서) 파일에서 스트림 이름 → 바이트 (hwp 5.0 묶음)"""
    import struct
    if data[:8] != b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
        return {}
    ssz = 1 << struct.unpack_from('<H', data, 0x1E)[0]
    msz = 1 << struct.unpack_from('<H', data, 0x20)[0]
    dir_start = struct.unpack_from('<I', data, 0x30)[0]
    cutoff = struct.unpack_from('<I', data, 0x38)[0]
    minifat_start, n_minifat = struct.unpack_from('<II', data, 0x3C)
    difat_start, n_difat = struct.unpack_from('<II', data, 0x44)
    END = 0xFFFFFFFE

    def sec(i: int) -> bytes:
        o = (i + 1) * ssz
        return data[o:o + ssz]

    fat_secs = [x for x in struct.unpack_from('<109I', data, 0x4C) if x < 0xFFFFFFFA]
    d = difat_start
    for _ in range(n_difat):
        if d >= 0xFFFFFFFA:
            break
        vals = struct.unpack('<%dI' % (ssz // 4), sec(d))
        fat_secs += [x for x in vals[:-1] if x < 0xFFFFFFFA]
        d = vals[-1]
    fat: list[int] = []
    for f in fat_secs:
        fat += struct.unpack('<%dI' % (ssz // 4), sec(f))

    def chain(start: int, table: list[int], limit: int = 1 << 20) -> list[int]:
        out = []
        while start != END and start < len(table) and len(out) < limit:
            out.append(start)
            start = table[start]
        return out

    def read(start: int) -> bytes:
        return b''.join(sec(i) for i in chain(start, fat))

    dirs = read(dir_start)
    entries = []
    for k in range(len(dirs) // 128):
        e = dirs[k * 128:(k + 1) * 128]
        nlen = struct.unpack_from('<H', e, 64)[0]
        name = e[:max(0, nlen - 2)].decode('utf-16-le', 'replace')
        typ = e[66]
        start, size = struct.unpack_from('<II', e, 116)
        entries.append((name, typ, start, size))
    root = next((x for x in entries if x[1] == 5), None)
    ministream = read(root[2]) if root else b''
    minifat: list[int] = []
    if n_minifat:
        mf = read(minifat_start)
        minifat = list(struct.unpack('<%dI' % (len(mf) // 4), mf))
    out = {}
    for name, typ, start, size in entries:
        if typ != 2:
            continue
        if size < cutoff:
            buf = b''.join(ministream[i * msz:(i + 1) * msz] for i in chain(start, minifat))
        else:
            buf = read(start)
        out[name] = buf[:size]
    return out


def hwp_text(data: bytes) -> str | None:
    """옛 한글(hwp 5.0) 본문 글 — 배포용(암호) 문서는 못 읽음"""
    import struct
    import zlib
    try:
        st = _cfb_streams(data)
        head = st.get('FileHeader', b'')
        if not head.startswith(b'HWP Document File'):
            return None
        props = struct.unpack_from('<I', head, 36)[0]
        if props & 0b110:  # 암호·배포용
            return None
        secs = sorted((n for n in st if re.fullmatch(r'Section\d+', n)), key=lambda n: int(n[7:]))
        paras: list[str] = []
        for n in secs:
            raw = st[n]
            body = zlib.decompress(raw, -15) if props & 1 else raw
            i = 0
            while i + 4 <= len(body):
                h = struct.unpack_from('<I', body, i)[0]
                i += 4
                tag, size = h & 0x3FF, (h >> 20) & 0xFFF
                if size == 0xFFF:
                    size = struct.unpack_from('<I', body, i)[0]
                    i += 4
                rec = body[i:i + size]
                i += size
                if tag != 67:  # HWPTAG_PARA_TEXT
                    continue
                chars = struct.unpack('<%dH' % (len(rec) // 2), rec[: len(rec) // 2 * 2])
                k, buf = 0, []
                while k < len(chars):
                    c = chars[k]
                    if c < 32:
                        if c in (10, 13):
                            buf.append('\n')
                        elif c in (30, 31):
                            buf.append(' ')
                        elif c in (0,) or 24 <= c <= 29:
                            pass
                        else:
                            k += 7  # 확장·인라인 조종 문자는 8글자 차지
                        k += 1
                        continue
                    buf.append(chr(c))
                    k += 1
                t = ' '.join(''.join(buf).split())
                if t:
                    paras.append(t)
        return '\n'.join(paras) or None
    except Exception:
        return None


def section_of(text: str, no: int) -> str:
    """한 파일에 별표가 여럿 들어 있으면 [별표 no] 부분만"""
    heads = [(m.start(), int(m.group(1))) for m in re.finditer(r'[\[(〔]\s*별표\s*(\d+)\s*[\])〕]', text)]
    if len({n for _, n in heads}) < 2:
        return text
    for k, (pos, n) in enumerate(heads):
        if n == no:
            end = next((p for p, m in heads[k + 1:] if m != no), len(text))
            return text[pos:end].strip()
    return text


def table_text(root: ET.Element, no: int) -> tuple[str | None, str, str | None]:
    """별표 no의 글: (글, 제목, 못 읽은 까닭)"""
    for u in root.findall('.//별표단위'):
        title = flat(u.findtext('별표제목'))
        if re.search(r'서식|별지', title):
            continue
        tm = re.match(r'\[?\s*별표\s*(\d+)(?:\s*의\s*(\d+))?\s*\]?', title)
        if tm:
            n, branch = int(tm.group(1)), int(tm.group(2) or 0)
        else:
            try:
                n = int(re.sub(r'\D', '', u.findtext('별표번호') or '') or -1)
                branch = int(re.sub(r'\D', '', u.findtext('별표가지번호') or '') or 0)
            except ValueError:
                continue
        if n != no or branch:
            continue
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
            return (section_of(t, no), title, None) if t else (None, title, '별표 파일(hwpx)에서 글을 찾지 못함')
        if data[:4] == b'\xd0\xcf\x11\xe0':
            t = hwp_text(data)
            return (section_of(t, no), title, None) if t else (None, title, '별표 파일(hwp)에서 글을 읽지 못함 (배포용·암호 문서일 수 있음)')
        return None, title, f'별표가 {kind or "알 수 없는"} 파일이라 글을 읽지 못함'
    return None, '', f'별표 {no}를 찾지 못함'


def building_values(root: ET.Element, arts: list[dict]) -> tuple[dict, list[str]]:
    out: dict = {}
    issues: list[str] = []
    for a in arts:
        if re.search(r'대지\s*안\S?\s*공지', a['title']):
            m = re.search(r'별표\s*(\d+)', a['text'])
            entry = {'article': a['no'], 'title': a['title'], 'text': a['text'][:1500]}
            if m:
                t, ttitle, why = table_text(root, int(m.group(1)))
                if not t and why and '찾지 못함' in why:
                    alt = next((int(re.match(r'\[?\s*별표\s*(\d+)', flat(u.findtext('별표제목'))).group(1)) for u in root.findall('.//별표단위')
                                if re.search(r'대지\s*안?\S?\s*공지|대지의\s*공지', flat(u.findtext('별표제목'))) and re.match(r'\[?\s*별표\s*(\d+)', flat(u.findtext('별표제목')))), None)
                    if alt is not None and alt != int(m.group(1)):
                        t, ttitle, why = table_text(root, alt)
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
        if e.tag not in ('부칙내용', '조문내용'):
            continue
        t = flat(''.join(e.itertext()))
        # 부칙은 한 덩어리로 오므로 '제n조(…)'마다 나눔
        for part in re.split(r'(?=제\d+조(?:의\d+)?\()', t):
            head = re.match(r'제\d+조(?:의\d+)?\(([^)]*)\)', part)
            title = head.group(1) if head else ''
            if re.search(r'조례|규칙', title) and re.search(r'경과|종전|효력|적용', title + part[:200]):
                found.append(part.strip())
            elif re.search(r'계획', title) and '경과' in title and len(part) > len(title) + 20:
                found.append(part.strip())
            elif '조례' in part and re.search(r'종전의\s*(광주광역시|전라남도)', part) and re.search(r'효력|본다', part):
                found.append(part.strip())
    found = sorted(set(found), key=len)[:4]
    return {
        'law': '전남광주통합특별시 설치를 위한 특별법',
        'effective': flat(law.findtext('시행일자')),
        'url': 'https://www.law.go.kr/법령/전남광주통합특별시설치를위한특별법',
        'excerpts': [t[:1200] for t in found],
    }


# ───────────────────────── 체크리스트가 근거로 드는 법령 조문 ─────────────────────────
# 앱의 체크리스트는 숫자 기준을 코드에 두되, 화면에는 지금 법령센터의 조문 글과 시행일을 함께 보여 준다(바뀌었는지 사람이 볼 수 있게).

LAW_ARTICLES = {
    '국토의 계획 및 이용에 관한 법률': ['제54조', '제76조', '제84조'],
    '국토의 계획 및 이용에 관한 법률 시행령': ['제71조', '제84조', '제85조'],
    '건축법': ['제2조', '제11조', '제42조', '제43조', '제44조', '제46조', '제47조', '제49조', '제55조', '제56조', '제58조', '제60조', '제61조', '제64조'],
    '건축법 시행령': ['제2조', '제27조', '제27조의2', '제28조', '제31조', '제34조', '제35조', '제46조', '제80조의2', '제86조', '제119조'],
    # 묶음 E4: 나머지 법
    '주차장법': ['제19조'],
    '주차장법 시행령': ['제6조'],
    '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률': ['제7조'],
    '녹색건축물 조성 지원법': ['제14조'],
    '녹색건축물 조성 지원법 시행령': ['제10조'],
    '문화예술진흥법': ['제9조'],
    '문화예술진흥법 시행령': ['제12조'],
    '교육환경 보호에 관한 법률': ['제8조', '제9조'],
    '문화유산의 보존 및 활용에 관한 법률': ['제13조'],
}

# 법령 별표 (용도별 기준 표 — 화면에서 고른 용도 줄을 뽑아 보여 줌)
LAW_TABLES = {
    '주차장법 시행령': [1],
    '장애인ㆍ노인ㆍ임산부 등의 편의증진 보장에 관한 법률 시행령': [1, 2],
}


def find_law(name: str):
    root = api('lawSearch.do', target='law', query=name, display=20)
    return next((i for i in root.findall('.//law') if norm(i.findtext('법령명한글')) == norm(name)), None)


def law_tables() -> dict:
    out = {}
    for name, nos in LAW_TABLES.items():
        law = find_law(name)
        if law is None:
            out[name] = {'error': '법령을 찾지 못함'}
            continue
        mst = flat(law.findtext('법령일련번호'))
        b = api('lawService.do', target='law', MST=mst)
        tables = {}
        for u in b.iter('별표단위'):
            title = flat(u.findtext('별표제목'))
            if re.search(r'서식|별지', title):
                continue
            try:
                n = int(re.sub(r'\D', '', u.findtext('별표번호') or '') or -1)
                br = int(re.sub(r'\D', '', u.findtext('별표가지번호') or '') or 0)
            except ValueError:
                continue
            if n not in nos or br or str(n) in tables:
                continue
            text = (u.findtext('별표내용') or '').strip()
            if not text:
                # 첨부 파일 주소: 이름에 '파일'·'링크'가 든 칸 중 주소인 것
                url = next((c.text.strip() for c in u if c.text and c.text.strip().startswith('http') and re.search(r'파일|링크', c.tag)), '')
                if url:
                    data = fetch(url)
                    text = (hwpx_text(data) if data[:2] == b'PK' else hwp_text(data) if data[:4] == bytes([0xD0, 0xCF, 0x11, 0xE0]) else None) or ''
            tables[str(n)] = {'title': title, 'text': text[:40000]}
        out[name] = {'mst': mst, 'effective': flat(law.findtext('시행일자')), 'url': 'https://www.law.go.kr/법령/' + name.replace(' ', ''), 'tables': tables,
                     'missing': [n for n in nos if str(n) not in tables or not tables[str(n)]['text']]}
        print(f"{name} 별표: {len([t for t in tables.values() if t['text']])}/{len(nos)}")
    return out


def law_articles() -> dict:
    out = {}
    for name, nos in LAW_ARTICLES.items():
        root = api('lawSearch.do', target='law', query=name, display=20)
        law = next((i for i in root.findall('.//law') if norm(i.findtext('법령명한글')) == norm(name)), None)
        if law is None:
            out[name] = {'error': '법령을 찾지 못함'}
            continue
        mst = flat(law.findtext('법령일련번호'))
        b = api('lawService.do', target='law', MST=mst)
        arts = {}
        for jo in b.findall('.//조문단위'):
            if (jo.findtext('조문여부') or '').strip() not in ('', '조문'):
                continue
            no = (jo.findtext('조문번호') or '').strip()
            br = (jo.findtext('조문가지번호') or '').strip()
            key = f'제{no}조' + (f'의{br}' if br and br != '0' else '')
            if key not in nos:
                continue
            # 조문 글 = 조문내용 + 항·호·목 (번호·시행일 같은 칸은 빼고)
            text = flat(' '.join(''.join(e.itertext()) for e in jo.iter() if e.tag in ('조문내용', '항내용', '호내용', '목내용')))
            arts[key] = {'title': flat(jo.findtext('조문제목')), 'text': text[:6000]}
        out[name] = {
            'mst': mst,
            'effective': flat(law.findtext('시행일자')),
            'url': 'https://www.law.go.kr/법령/' + name.replace(' ', ''),
            'articles': arts,
            'missing': [n for n in nos if n not in arts],
        }
        print(f"{name}: 조문 {len(arts)}/{len(nos)} (시행 {out[name]['effective']})")
    return out


# ───────────────────────── 지자체 하나 ─────────────────────────

def region_entry(r: dict) -> dict:
    n = r['name']
    issues: list[str] = []
    entry = {k: v for k, v in r.items() if k != 'org'}
    entry['org'] = r['org']

    base = re.escape(norm(n))
    # 군은 '○○군 계획 조례'·'○○군 관리계획 조례'(장흥·무안)처럼 이름이 여러 꼴
    urban = find_ordinance(n, r['org'], [f'{n} 도시계획 조례', f'{n} 계획 조례', f'{n} 군계획', f'{n} 도시 군계획', f'{n} 관리계획'],
                           base + r'(?:도시|군|시|도시군|도시시|관리)?계획조례')
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
        issues.append('도시계획 조례를 찾지 못함' + (f" (같은 지자체의 다른 조례: {', '.join(LAST_CANDIDATES)})" if LAST_CANDIDATES else ''))

    building = find_ordinance(n, r['org'], [f'{n} 건축 조례', f'{n} 건축조례'], base + r'건축조례')
    if building:
        root = body(building['mst'])
        vals, more = building_values(root, articles(root))
        building.update({'url': ordin_link(building['mst']), **vals})
        issues += more
        entry['building'] = building
    else:
        issues.append('건축 조례를 찾지 못함' + (f" (같은 지자체의 다른 조례: {', '.join(LAST_CANDIDATES)})" if LAST_CANDIDATES else ''))

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

    try:
        laws = law_articles()
    except Exception as ex:
        print('법령 조문 받기 실패:', redact(str(ex)))
        laws = (prev or {}).get('laws')

    try:
        tables = law_tables()
    except Exception as ex:
        print('법령 별표 받기 실패:', redact(str(ex)))
        tables = (prev or {}).get('lawTables')

    out = {
        'version': VERSION,
        'checkedAt': now.isoformat(timespec='seconds'),
        'source': SOURCE,
        'transition': trans,
        'laws': laws,
        'lawTables': tables,
        'regions': regions,
    }
    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    ok = sum(1 for r in regions if not r.get('stale'))
    print(f'지자체 {len(regions)}곳 중 {ok}곳 새로 받음 → {a.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
