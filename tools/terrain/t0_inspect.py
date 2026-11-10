"""T0 조사: 내려받은 원자료(등고선·표고점 ZIP)의 구조를 풀지 않고 확인해 보고서를 쓴다.

실행: tools/terrain/.venv/Scripts/python.exe tools/terrain/t0_inspect.py
결과: tools/terrain/reports/t0_inspect.md
"""

from __future__ import annotations

import sys
import time
from collections import Counter
from pathlib import Path

from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REGIONS, REPORTS, ZipShape, contour_zips, epsg_guess, file_list_xlsx, region_files, spot_zip  # noqa: E402

SAMPLE = 3000
TO_LONLAT = Transformer.from_crs('EPSG:5179', 'EPSG:4326', always_xy=True)
SHAPE_NAMES = {3: 'PolyLine', 13: 'PolyLineZ', 23: 'PolyLineM', 1: 'Point', 11: 'PointZ', 21: 'PointM'}


def mb(n: int) -> str:
    return f'{n / 1024 / 1024:,.0f}MB'


def inspect(path: Path) -> list[str]:
    t0 = time.time()
    zs = ZipShape(path)
    r = zs.reader
    lines = [f'### {path.name}', '']
    size = path.stat().st_size
    unz = sum(i.file_size for i in zs.z.infolist())
    lines.append(f'- 크기: 압축 {mb(size)} / 풀면 {mb(unz)}')
    lines.append(f'- 셰이프: `{zs.base}` · 형식 {SHAPE_NAMES.get(r.shapeType, r.shapeType)} · 개수 {len(r):,}')
    lines.append(f'- 좌표계: {epsg_guess(zs.prj)} — `{zs.prj[:90]}…`')
    x0, y0, x1, y1 = r.bbox
    lo0, la0 = TO_LONLAT.transform(x0, y0)
    lo1, la1 = TO_LONLAT.transform(x1, y1)
    lines.append(f'- 범위(EPSG:5179): {x0:,.0f}, {y0:,.0f} – {x1:,.0f}, {y1:,.0f} → 경위도 {lo0:.3f},{la0:.3f} – {lo1:.3f},{la1:.3f}')
    if r.shapeType in (13, 11):
        lines.append(f'- Z 범위(헤더): {r.zbox}')
    fields = [f for f in r.fields if f[0] != 'DeletionFlag']
    lines.append('- 속성: ' + ', '.join(f'`{f[0]}`({f[1]}{f[2]}{"." + str(f[3]) if f[3] else ""})' for f in fields))
    # 앞쪽 일부 레코드의 값 분포
    vals: dict[str, list] = {f[0]: [] for f in fields}
    for i, rec in enumerate(r.iterRecords()):
        if i >= SAMPLE:
            break
        for f in fields:
            vals[f[0]].append(rec[f[0]])
    for name, vs in vals.items():
        nums = [v for v in vs if isinstance(v, (int, float))]
        if nums and len(nums) == len(vs):
            mod5 = sum(1 for v in nums if abs(v - round(v / 5) * 5) < 1e-6)
            lines.append(f'  - `{name}` 숫자 {min(nums):g} ~ {max(nums):g}, 5의 배수 {mod5 * 100 // len(nums)}% (앞 {len(nums):,}개)')
        else:
            common = Counter(str(v) for v in vs).most_common(5)
            lines.append(f'  - `{name}` 예: ' + ', '.join(f'{k}({c})' for k, c in common))
    # 첫 도형의 점 수와 Z
    shp = r.shape(0)
    lines.append(f'- 첫 도형: 점 {len(shp.points):,}개, 부분 {len(shp.parts)}' + (f', Z 예 {shp.z[:3]}' if getattr(shp, 'z', None) else ''))
    lines.append(f'- 조사 시간 {time.time() - t0:.1f}초')
    zs.close()
    return lines + ['']


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = ['# T0 원자료 조사', '', f'- 조사일: {time.strftime("%Y-%m-%d %H:%M")}', '']
    xl = file_list_xlsx()
    if xl:
        rf = region_files()
        out.append('## 시도별 등고선 묶음 (시도별_등고선_파일_목록.xlsx)')
        out.append('')
        for code, name in REGIONS.items():
            out.append(f'- {code} {name}: {", ".join(f"{n:03d}" for n in rf.get(code, []))}')
        need = sorted({n for c in REGIONS for n in rf.get(c, [])})
        have = sorted(int(p.name[-7:-4]) for p in contour_zips())
        missing = [n for n in need if n not in have]
        out.append(f'- 필요한 묶음 {len(need)}개, 받은 묶음 {len(have)}개' + (f', **빠진 묶음: {missing}**' if missing else ' — 모두 있음'))
        out.append('')
    out.append('## 등고선')
    out.append('')
    for p in contour_zips():
        print('조사:', p.name, flush=True)
        out.extend(inspect(p))
    sp = spot_zip()
    if sp:
        out.append('## 표고점')
        out.append('')
        print('조사:', sp.name, flush=True)
        out.extend(inspect(sp))
    path = REPORTS / 't0_inspect.md'
    path.write_text('\n'.join(out), encoding='utf-8')
    print('보고서:', path)


if __name__ == '__main__':
    main()
