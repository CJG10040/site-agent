"""T5 배포 준비: 지형 저장소 폴더(site-agent-terrain)에 타일·목록·설명을 복사한다. git 올리기는 따로.

실행: python t5_publish.py --out C:/Claude/site-agent-terrain
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REGIONS, REPORTS, WORK, contour_zips, spot_zip  # noqa: E402

DEM = WORK / 'dem'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--version', default='2026.1')
    a = ap.parse_args()
    out = Path(a.out)
    dem_out = out / 'dem'
    dem_out.mkdir(parents=True, exist_ok=True)
    tiles = sorted(p.stem for p in DEM.glob('*.png'))
    # 새로 만든 것으로 바꾸기 (예전 타일 중 없어진 것은 지움)
    for old in dem_out.glob('*.png'):
        if old.stem not in tiles:
            old.unlink()
    for t in tiles:
        shutil.copy2(DEM / f'{t}.png', dem_out / f'{t}.png')
    t4 = json.loads((WORK / 't4_result.json').read_text(encoding='utf-8')) if (WORK / 't4_result.json').exists() else {}
    manifest = {
        'version': a.version,
        'builtAt': time.strftime('%Y-%m-%d'),
        'source': {
            'name': '국토지리정보원 연속수치지형도 등고선(N3L_F0010000)·표고점(N3P_F0020000), 브이월드 공간정보 다운로드',
            'license': 'CC BY',
            'updated': '2026-10-01',
            'files': [p.name for p in contour_zips()] + ([spot_zip().name] if spot_zip() else []),
        },
        'regions': list(REGIONS.values()),
        'crs': 'EPSG:5179',
        'cell': 10,
        'tile': 256,
        'tileSizeM': 2560,
        'encoding': 'PNG RGB: v = R*256 + G, height_m = v/10 - 1000, B=0 means no data',
        'checks': t4,
        'tiles': tiles,
    }
    (dem_out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    (out / '.nojekyll').write_text('', encoding='utf-8')
    verify = (REPORTS / 't4_verify.md').read_text(encoding='utf-8') if (REPORTS / 't4_verify.md').exists() else ''
    if (REPORTS / 't4_preview.png').exists():
        shutil.copy2(REPORTS / 't4_preview.png', out / 't4_preview.png')
    (out / 'README.md').write_text(
        f"""# site-agent-terrain

[대지해석 에이전트](https://cjg10040.github.io/site-agent/)가 쓰는 **지형 격자 타일**입니다 (전남광주통합특별시·전북특별자치도).

- 원자료: 국토지리정보원 연속수치지형도 등고선(5m 간격)·표고점 — 브이월드 공간정보 다운로드, **CC BY** (출처: 국토지리정보원)
- 가공: 등고선 정점과 표고점으로 들로네 삼각망을 만들어 **10m 격자**로 보간 (가장 가까운 자료가 400m보다 먼 칸은 자료 없음)
- 타일: EPSG:5179(UTM-K) 2,560m × 2,560m = 256 × 256칸, 이름 `dem/{{열}}_{{행}}.png` (열 = floor(x/2560), 행 = floor(y/2560))
- 값: PNG RGB — `v = R×256 + G`, 높이(m) = `v/10 − 1000`, `B = 0`이면 자료 없음. 0행이 북쪽
- 목록: `dem/manifest.json` (버전 {a.version}, 타일 {len(tiles):,}장)
- 한계: 10m 격자라 옹벽·계단·작은 둔덕은 나타나지 않음. 참고용이며 측량·인허가 근거가 아님
- 만드는 방법: 앱 저장소 `tools/terrain/` (T0 조사 → T1 색인 → T2 격자화 → T4 검증 → T5 배포), 계획은 `docs/지형자료_가공계획서.md`

![미리보기](t4_preview.png)

---

{verify.replace('![음영기복](t4_preview.png)', '')}
""",
        encoding='utf-8',
    )
    print(f'복사: 타일 {len(tiles):,}장 → {dem_out}')


if __name__ == '__main__':
    main()
