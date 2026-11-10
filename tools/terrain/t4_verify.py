"""T4 검증: 만든 지형 타일이 맞는지 확인하고 보고서와 미리보기 그림을 만든다.

① 기준 산 높이 (꼭대기 반경 500m 안 가장 높은 칸. 무등산·모악산 좌표는 처음 대략값이 2km 이상 틀려 2026-11-10 격자에서 찾은 꼭대기로 고침)
② 시험 대지(광주 충장로)의 높이 — 같은 원자료로 만든 sitedia 값(44.9m)과 비교
③ 타일 이음매: 이웃 타일 가장자리 칸끼리의 차이 vs 타일 안쪽 이웃 칸끼리의 차이
④ 표고점 위치의 격자 값과 표고점 값 차이 (입력으로 쓴 점이라 작아야 정상)
⑤ 전체 음영기복 미리보기 그림
결과: reports/t4_verify.md, reports/t4_preview.png
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPORTS, WORK  # noqa: E402

TILE = 2560.0
CELL = 10.0
N = 256
DEM = WORK / 'dem'
PTS = WORK / 'pts'
TO5179 = Transformer.from_crs('EPSG:4326', 'EPSG:5179', always_xy=True)

PEAKS = [
    ('무등산 천왕봉', 127.0091, 35.1244, 1187.0),
    ('덕유산 향적봉', 127.7462, 35.8601, 1614.0),
    ('지리산 반야봉', 127.5677, 35.3195, 1732.0),
    ('지리산 노고단', 127.5313, 35.2953, 1507.0),
    ('모악산', 127.0853, 35.7286, 793.5),
    ('월출산 천황봉', 126.7009, 34.7689, 809.0),
]
SITE = ('광주 충장로3가 17-5 (시험 대지)', 126.91543, 35.14837, 44.9)

_cache: dict[tuple[int, int], np.ndarray | None] = {}


def tile(c: int, r: int) -> np.ndarray | None:
    if (c, r) not in _cache:
        p = DEM / f'{c}_{r}.png'
        if not p.exists():
            _cache[(c, r)] = None
        else:
            a = np.asarray(Image.open(p).convert('RGB')).astype(np.int64)
            z = ((a[:, :, 0] << 8) | a[:, :, 1]).astype(np.float64) / 10 - 1000
            z[a[:, :, 2] == 0] = np.nan
            _cache[(c, r)] = z
    return _cache[(c, r)]


def value_at(x: float, y: float) -> float:
    c, r = int(x // TILE), int(y // TILE)
    z = tile(c, r)
    if z is None:
        return float('nan')
    i = int((x - c * TILE) // CELL)
    j = int(N - 1 - (y - r * TILE) // CELL)
    return float(z[min(max(j, 0), N - 1), min(max(i, 0), N - 1)])


def max_near(lon: float, lat: float, radius: float) -> tuple[float, float]:
    x, y = TO5179.transform(lon, lat)
    best, bd = float('nan'), 0.0
    for dx in np.arange(-radius, radius + 1, CELL):
        for dy in np.arange(-radius, radius + 1, CELL):
            if dx * dx + dy * dy > radius * radius:
                continue
            v = value_at(x + dx, y + dy)
            if np.isfinite(v) and (not np.isfinite(best) or v > best):
                best, bd = v, float(np.hypot(dx, dy))
    return best, bd


def main() -> None:
    t0 = time.time()
    REPORTS.mkdir(parents=True, exist_ok=True)
    tiles = sorted(tuple(map(int, p.stem.split('_'))) for p in DEM.glob('*.png'))
    sizes = [(DEM / f'{c}_{r}.png').stat().st_size for c, r in tiles]
    lines = ['# T4 지형 타일 검증', '', f'- 검증일: {time.strftime("%Y-%m-%d %H:%M")}', f'- 타일 {len(tiles):,}장, 합계 {sum(sizes) / 1024 / 1024:,.1f}MB (평균 {np.mean(sizes) / 1024:.1f}KB)', '']

    lines += ['## ① 기준 산 높이 (반경 500m 안 가장 높은 칸)', '', '| 산 | 공식 높이 | 격자 | 차이 | 꼭대기까지 |', '|---|---|---|---|---|']
    peak_ok = 0
    for name, lon, lat, h in PEAKS:
        v, d = max_near(lon, lat, 500)
        diff = v - h
        ok = np.isfinite(v) and abs(diff) <= 5
        peak_ok += ok
        lines.append(f'| {name} | {h:,.1f}m | {v:,.1f}m | {diff:+.1f}m {"✅" if ok else "⚠️"} | {d:.0f}m |')
    lines.append('')

    name, lon, lat, ref = SITE
    x, y = TO5179.transform(lon, lat)
    sv = value_at(x, y)
    lines += ['## ② 시험 대지', '', f'- {name}: 격자 {sv:.1f}m, sitedia(같은 원자료 10m 격자) {ref}m → 차이 {sv - ref:+.1f}m {"✅" if abs(sv - ref) <= 2 else "⚠️"}', '']

    # ③ 이음매
    edge, inner = [], []
    for c, r in tiles:
        a = tile(c, r)
        b = tile(c + 1, r)
        if a is not None and b is not None:
            d = np.abs(a[:, -1] - b[:, 0])
            edge.append(d[np.isfinite(d)])
            dd = np.abs(a[:, -2] - a[:, -1])
            inner.append(dd[np.isfinite(dd)])
        if len(edge) > 800:
            break
    e = np.concatenate(edge) if edge else np.array([np.nan])
    i_ = np.concatenate(inner) if inner else np.array([np.nan])
    lines += ['## ③ 타일 이음매 (가로 이웃 타일 800쌍 표본)', '', f'- 이웃 타일 가장자리 칸 차이: 평균 {np.nanmean(e):.2f}m, 95% {np.nanpercentile(e, 95):.2f}m', f'- 같은 타일 안 이웃 칸 차이: 평균 {np.nanmean(i_):.2f}m, 95% {np.nanpercentile(i_, 95):.2f}m', f'- 두 값이 비슷하면 이음매 없음 {"✅" if abs(np.nanmean(e) - np.nanmean(i_)) <= 0.5 else "⚠️"}', '']

    # ④ 표고점
    rng = np.random.default_rng(0)
    spot_files = sorted(PTS.glob('*.spot.bin'))
    res = []
    for f in rng.choice(spot_files, size=min(300, len(spot_files)), replace=False):
        c, r = map(int, f.name.split('.')[0].split('_'))
        a = np.fromfile(f, dtype=np.float32).reshape(-1, 3)
        for px, py, pz in a[rng.choice(len(a), size=min(10, len(a)), replace=False)]:
            v = value_at(c * TILE + float(px), r * TILE + float(py))
            if np.isfinite(v):
                res.append(v - float(pz))
    res = np.array(res)
    lines += ['## ④ 표고점 위치의 격자 값 − 표고점 (입력 점이므로 칸 크기 10m 안의 차이만 있어야 함)', '', f'- 표본 {len(res):,}개: 중앙 {np.median(np.abs(res)):.2f}m, 95% {np.percentile(np.abs(res), 95):.2f}m, 최대 {np.max(np.abs(res)):.1f}m', '']

    # ⑤ 미리보기: 타일당 32칸으로 줄인 음영기복
    cs = [c for c, _ in tiles]
    rs = [r for _, r in tiles]
    c0, c1, r0, r1 = min(cs), max(cs), min(rs), max(rs)
    S = 32
    big = np.full(((r1 - r0 + 1) * S, (c1 - c0 + 1) * S), np.nan)
    for c, r in tiles:
        z = tile(c, r)
        small = z.reshape(S, N // S, S, N // S)
        with np.errstate(all='ignore'):
            small = np.nanmean(small, axis=(1, 3))
        big[(r1 - r) * S : (r1 - r + 1) * S, (c - c0) * S : (c - c0 + 1) * S] = small
    cell = TILE / S
    gy, gx = np.gradient(np.nan_to_num(big, nan=0.0), cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(45)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    img = np.clip(shade * 255, 0, 255).astype(np.uint8)
    rgb = np.stack([img, img, img], axis=-1)
    rgb[np.isnan(big)] = (205, 225, 240)
    Image.fromarray(rgb).save(REPORTS / 't4_preview.png', optimize=True)
    lines += ['## ⑤ 미리보기', '', '![음영기복](t4_preview.png)', '', f'- 검증 시간 {time.time() - t0:.0f}초']
    (REPORTS / 't4_verify.md').write_text('\n'.join(lines), encoding='utf-8')
    (WORK / 't4_result.json').write_text(json.dumps({'peaks_ok': int(peak_ok), 'site': sv, 'edge_mean': float(np.nanmean(e)), 'inner_mean': float(np.nanmean(i_))}), encoding='utf-8')
    print('\n'.join(lines[:30]))


if __name__ == '__main__':
    main()
