"""지형 가공 도구 공통 설정과 도우미 (지형자료_가공계획서 참고)."""

from __future__ import annotations

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import shapefile  # pyshp

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent.parent
RAW = Path(os.environ.get('TERRAIN_RAW', REPO / 'terrain-raw'))
WORK = TOOLS / 'work'
REPORTS = TOOLS / 'reports'

# 우선 지원 지역 (시도별_등고선_파일_목록.xlsx의 시도 코드)
REGIONS = {'12000': '전남광주통합특별시', '52000': '전북특별자치도'}

CONTOUR_RE = re.compile(r'등고선_(\d{3})\.zip$')


def contour_zips() -> list[Path]:
    return sorted(p for p in RAW.glob('*.zip') if CONTOUR_RE.search(p.name))


def spot_zip() -> Path | None:
    hits = sorted(RAW.glob('N3P_F0020000*.zip'))
    return hits[0] if hits else None


def file_list_xlsx() -> Path | None:
    hits = sorted(RAW.glob('*파일_목록*.xlsx'))
    return hits[0] if hits else None


def read_xlsx_rows(path: Path) -> list[list[str]]:
    """표준 라이브러리만으로 xlsx 첫 시트를 읽는다 (작은 목록 파일용)."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    z = zipfile.ZipFile(path)
    shared: list[str] = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(f'{ns}si'):
            shared.append(''.join(t.text or '' for t in si.iter(f'{ns}t')))
    sheet = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
    rows: list[list[str]] = []
    for row in ET.fromstring(z.read(sheet)).iter(f'{ns}row'):
        vals = []
        for c in row.iter(f'{ns}c'):
            v = c.find(f'{ns}v')
            if v is None:
                isv = c.find(f'{ns}is')
                vals.append(''.join(t.text or '' for t in isv.iter(f'{ns}t')) if isv is not None else '')
            elif c.get('t') == 's':
                vals.append(shared[int(v.text)])
            else:
                vals.append(v.text or '')
        rows.append(vals)
    return rows


def region_files() -> dict[str, list[int]]:
    """시도 코드 → 그 시도가 들어 있는 등고선 묶음 번호."""
    path = file_list_xlsx()
    out: dict[str, list[int]] = {}
    if not path:
        return out
    for r in read_xlsx_rows(path):
        code = next((c for c in r if re.fullmatch(r'\d{5}', c.strip())), None)
        nums = next((c for c in reversed(r) if re.fullmatch(r'[\d,\s]+', c.strip() or 'x')), None)
        if code and nums:
            out[code] = [int(x) for x in re.split(r'[,\s]+', nums.strip()) if x]
    return out


class ZipShape:
    """ZIP 안의 셰이프파일을 풀지 않고 읽는다."""

    def __init__(self, zpath: Path, encoding: str = 'cp949'):
        self.z = zipfile.ZipFile(zpath)
        names = self.z.namelist()
        base = next(n[:-4] for n in names if n.lower().endswith('.shp'))
        self.base = base
        self.prj = self.z.read(base + '.prj').decode('utf-8', 'ignore') if base + '.prj' in names else ''
        self.reader = shapefile.Reader(
            shp=self.z.open(base + '.shp'),
            shx=self.z.open(base + '.shx'),
            dbf=self.z.open(base + '.dbf'),
            encoding=encoding,
            encodingErrors='replace',
        )

    def close(self) -> None:
        self.reader.close()
        self.z.close()


def epsg_guess(prj: str) -> str:
    p = prj.upper()
    if 'KOREA_2000_UNIFIED' in p or ('2000000' in p and '1000000' in p and '127.5' in p):
        return 'EPSG:5179 (UTM-K)'
    if '200000' in p and '600000' in p and '127' in p:
        return 'EPSG:5186 (중부원점)'
    return '알 수 없음'
