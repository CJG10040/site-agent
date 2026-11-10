"""T2 격자화 + T3 인코딩: 타일마다 등고선 정점·표고점으로 들로네 삼각망을 만들어 10m 격자로 보간하고 PNG로 저장한다.

- 이웃 8장의 점을 함께 읽어 타일 가장자리 200m 바깥까지 쓰므로 타일 경계에 이음매가 생기지 않는다.
- 가장 가까운 자료가 400m보다 먼 칸(바다 등)과 삼각망 바깥은 '자료 없음'.
- PNG RGB: v = round(높이×10) + 10000 (0.1m 단위, −1000m부터), R = v>>8, G = v&255, B = 255(자료 있음)/0(없음)
- 출력: work/dem/{열}_{행}.png, work/t2_result.json
실행: python t2_grid.py [--workers 20] [--only 330_640,331_640]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.interpolate import LinearNDInterpolator
from scipy.spatial import Delaunay, QhullError, cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import WORK  # noqa: E402

TILE = 2560.0
CELL = 10.0
N = 256
MARGIN = 200.0
MAX_GAP = 400.0
SNAP = 2.5
PTS = WORK / 'pts'
DEM = WORK / 'dem'


def tile_files() -> dict[tuple[int, int], list[Path]]:
    out: dict[tuple[int, int], list[Path]] = defaultdict(list)
    for f in PTS.glob('*.bin'):
        c, r = f.name.split('.')[0].split('_')
        out[(int(c), int(r))].append(f)
    return out


def load(files: dict[tuple[int, int], list[Path]], c: int, r: int) -> np.ndarray:
    parts = []
    for dc in (-1, 0, 1):
        for dr in (-1, 0, 1):
            for f in files.get((c + dc, r + dr), []):
                a = np.fromfile(f, dtype=np.float32).reshape(-1, 3).astype(np.float64)
                a[:, 0] += dc * TILE
                a[:, 1] += dr * TILE
                m = (a[:, 0] >= -MARGIN) & (a[:, 0] <= TILE + MARGIN) & (a[:, 1] >= -MARGIN) & (a[:, 1] <= TILE + MARGIN)
                parts.append(a[m])
    return np.concatenate(parts) if parts else np.empty((0, 3))


def grid_tile(args: tuple[int, int, dict]) -> dict:
    c, r, files = args
    t0 = time.time()
    pts = load(files, c, r)
    res = {'tile': f'{c}_{r}', 'points': int(len(pts))}
    if len(pts) < 3:
        res['status'] = 'empty'
        return res
    # 2.5m 안에 겹친 점은 하나만
    key = np.round(pts[:, 0] / SNAP).astype(np.int64) * 10_000_000 + np.round(pts[:, 1] / SNAP).astype(np.int64)
    _, idx = np.unique(key, return_index=True)
    pts = pts[idx]
    res['unique'] = int(len(pts))
    xs = (np.arange(N) + 0.5) * CELL
    ys = TILE - (np.arange(N) + 0.5) * CELL  # 0행 = 북쪽
    gx, gy = np.meshgrid(xs, ys)
    q = np.column_stack([gx.ravel(), gy.ravel()])
    try:
        tri = Delaunay(pts[:, :2])
    except QhullError:
        res['status'] = 'qhull-fail'
        return res
    z = LinearNDInterpolator(tri, pts[:, 2])(q)
    d, _ = cKDTree(pts[:, :2]).query(q, distance_upper_bound=MAX_GAP)
    valid = np.isfinite(z) & np.isfinite(d)
    if not valid.any():
        res['status'] = 'nodata'
        return res
    v = np.zeros(N * N, np.int64)
    v[valid] = np.clip(np.round(z[valid] * 10) + 10000, 1, 65535)
    rgb = np.zeros((N * N, 3), np.uint8)
    rgb[:, 0] = (v >> 8) & 255
    rgb[:, 1] = v & 255
    rgb[valid, 2] = 255
    DEM.mkdir(parents=True, exist_ok=True)
    path = DEM / f'{c}_{r}.png'
    Image.fromarray(rgb.reshape(N, N, 3), 'RGB').save(path, compress_level=9)
    zz = z[valid]
    res.update(status='ok', valid=round(float(valid.mean()), 4), zmin=round(float(zz.min()), 1), zmax=round(float(zz.max()), 1), bytes=path.stat().st_size, secs=round(time.time() - t0, 2))
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=20)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    files = tile_files()
    tiles = sorted(files)
    if a.only:
        keep = {tuple(map(int, s.split('_'))) for s in a.only.split(',')}
        tiles = [t for t in tiles if t in keep]
    print(f'자료가 있는 타일 {len(tiles):,}장', flush=True)
    t0 = time.time()
    results = []
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for i, res in enumerate(ex.map(grid_tile, [(c, r, files) for c, r in tiles], chunksize=4)):
            results.append(res)
            if (i + 1) % 250 == 0:
                print(f'{i + 1:,}/{len(tiles):,} ({time.time() - t0:.0f}초)', flush=True)
    ok = [r for r in results if r.get('status') == 'ok']
    total = sum(r['bytes'] for r in ok)
    summary = {
        'tiles': len(results),
        'ok': len(ok),
        'bytes': total,
        'mb': round(total / 1024 / 1024, 1),
        'avg_kb': round(total / max(1, len(ok)) / 1024, 1),
        'zmin': min((r['zmin'] for r in ok), default=None),
        'zmax': max((r['zmax'] for r in ok), default=None),
        'secs': round(time.time() - t0, 1),
        'status': {s: sum(1 for r in results if r.get('status') == s) for s in {r.get('status') for r in results}},
    }
    print(summary, flush=True)
    (WORK / 't2_result.json').write_text(json.dumps({'summary': summary, 'tiles': results}, ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
