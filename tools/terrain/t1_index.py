"""T1 색인: 등고선·표고점 정점 가운데 세 지역(전남광주·전북)에 걸친 타일의 것만 골라 타일별 파일로 나눈다.

- 묶음이 지역별이 아니므로(가공계획서 §2.1) regions_mask.json(0.02° 격자)로 '필요한 타일'을 먼저 정한다.
- 타일: EPSG:5179 2,560m 격자. 열 = floor(x/2560), 행 = floor(y/2560).
- 출력: work/pts/{열}_{행}.{출처}.bin — float32 (dx, dy, z) 세 개씩. dx·dy는 타일 왼쪽 아래 모서리 기준(m).
  묶음마다 따로 써서 여러 프로세스가 같은 파일에 동시에 쓰지 않게 한다.
실행: python t1_index.py [--only 004,005] [--workers 6]
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import time
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import TOOLS, WORK, contour_zips, spot_zip  # noqa: E402

TILE = 2560.0
PTS = WORK / 'pts'
FLUSH_POINTS = 8_000_000


def wanted_tiles() -> tuple[np.ndarray, int, int]:
    """마스크(1칸 넓힘)에 닿는 타일을 불리언 격자로. 반환: (격자[행-r0, 열-c0], c0, r0)"""
    m = json.loads((TOOLS / 'regions_mask.json').read_text(encoding='utf-8'))
    W, H, x0, y0, step = m['W'], m['H'], m['x0'], m['y0'], m['step']
    grid = np.zeros((H, W), bool)
    for j, row in enumerate(m['rows'].split('|')):
        if not row:
            continue
        for run in row.split(','):
            i, n = map(int, run.split(':'))
            grid[j, i : i + n] = True
    # 한 칸(약 2km) 넓혀 해안·경계 여유
    dil = grid.copy()
    dil[1:, :] |= grid[:-1, :]
    dil[:-1, :] |= grid[1:, :]
    dil[:, 1:] |= grid[:, :-1]
    dil[:, :-1] |= grid[:, 1:]
    to5179 = Transformer.from_crs('EPSG:4326', 'EPSG:5179', always_xy=True)
    to4326 = Transformer.from_crs('EPSG:5179', 'EPSG:4326', always_xy=True)
    xs, ys = to5179.transform([x0, x0 + W * step, x0, x0 + W * step], [y0, y0, y0 + H * step, y0 + H * step])
    c0, c1 = int(min(xs) // TILE) - 1, int(max(xs) // TILE) + 1
    r0, r1 = int(min(ys) // TILE) - 1, int(max(ys) // TILE) + 1
    out = np.zeros((r1 - r0 + 1, c1 - c0 + 1), bool)
    # 타일마다 9점(모서리·변 가운데·가운데)을 마스크에 비춰 본다
    cc, rr = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
    for fx in (0.0, 0.5, 1.0):
        for fy in (0.0, 0.5, 1.0):
            lon, lat = to4326.transform(((cc + fx) * TILE).ravel(), ((rr + fy) * TILE).ravel())
            i = np.floor((np.asarray(lon) - x0) / step).astype(int)
            j = np.floor((np.asarray(lat) - y0) / step).astype(int)
            ok = (i >= 0) & (i < W) & (j >= 0) & (j < H)
            hit = np.zeros(i.shape, bool)
            hit[ok] = dil[j[ok], i[ok]]
            out |= hit.reshape(out.shape)
    return out, c0, r0


class Sink:
    """타일별로 모았다가 한꺼번에 파일 끝에 덧붙인다."""

    def __init__(self, tag: str):
        self.tag = tag
        self.buf: dict[tuple[int, int], list[np.ndarray]] = {}
        self.count = 0
        self.total = 0
        PTS.mkdir(parents=True, exist_ok=True)

    def add(self, x: np.ndarray, y: np.ndarray, z: np.ndarray, want: np.ndarray, c0: int, r0: int) -> None:
        col = np.floor(x / TILE).astype(np.int64)
        row = np.floor(y / TILE).astype(np.int64)
        ci = col - c0
        ri = row - r0
        ok = (ci >= 0) & (ci < want.shape[1]) & (ri >= 0) & (ri < want.shape[0])
        ok[ok] = want[ri[ok], ci[ok]]
        if not ok.any():
            return
        col, row, x, y, z = col[ok], row[ok], x[ok], y[ok], z[ok]
        key = col * 100000 + row
        order = np.argsort(key, kind='stable')
        key, col, row, x, y, z = key[order], col[order], row[order], x[order], y[order], z[order]
        cuts = np.flatnonzero(np.diff(key)) + 1
        starts = np.r_[0, cuts]
        ends = np.r_[cuts, len(key)]
        for s, e in zip(starts, ends):
            c, r = int(col[s]), int(row[s])
            arr = np.empty((e - s, 3), np.float32)
            arr[:, 0] = x[s:e] - c * TILE
            arr[:, 1] = y[s:e] - r * TILE
            arr[:, 2] = z[s:e]
            self.buf.setdefault((c, r), []).append(arr)
        n = int(ok.sum())
        self.count += n
        self.total += n
        if self.count >= FLUSH_POINTS:
            self.flush()

    def flush(self) -> None:
        for (c, r), parts in self.buf.items():
            with open(PTS / f'{c}_{r}.{self.tag}.bin', 'ab') as f:
                for p in parts:
                    f.write(p.tobytes())
        self.buf.clear()
        self.count = 0


def read_exact(stream, n: int) -> bytes:
    b = stream.read(n)
    if len(b) < n:
        raise EOFError
    return b


def index_contours(zpath_str: str) -> dict:
    zpath = Path(zpath_str)
    t0 = time.time()
    want, c0, r0 = wanted_tiles()
    tag = zpath.name[-7:-4]
    z = zipfile.ZipFile(zpath)
    base = next(n[:-4] for n in z.namelist() if n.lower().endswith('.shp'))
    shp = z.open(base + '.shp')
    dbf = z.open(base + '.dbf')
    # DBF 머리: 레코드 수, 머리 길이, 레코드 길이, 필드 위치
    head = read_exact(dbf, 32)
    nrec, hlen, rlen = struct.unpack('<IHH', head[4:12])
    hdr = read_exact(dbf, hlen - 32)  # 필드 설명들 + 끝 표시(0x0D)
    fields = []
    off = 1  # 레코드 첫 바이트는 삭제 표시
    p = 0
    while hdr[p] != 0x0D:
        fd = hdr[p : p + 32]
        name = fd[:11].split(b'\0')[0].decode('ascii', 'ignore')
        size = fd[16]
        fields.append((name, off, size))
        off += size
        p += 32
    cont = next(f for f in fields if f[0] == 'CONT')
    # SHP 머리
    read_exact(shp, 100)
    sink = Sink(tag)
    kept_shapes = 0
    BATCH = 2000
    xs: list[np.ndarray] = []
    ys: list[np.ndarray] = []
    zs: list[np.ndarray] = []
    for k in range(nrec):
        rec = read_exact(dbf, rlen)
        zval = float(rec[cont[1] : cont[1] + cont[2]].decode('ascii', 'ignore').strip() or 'nan')
        rh = read_exact(shp, 8)
        clen = struct.unpack('>i', rh[4:8])[0] * 2
        content = read_exact(shp, clen)
        stype = struct.unpack('<i', content[:4])[0]
        if stype == 0 or not np.isfinite(zval):
            continue
        xmin, ymin, xmax, ymax = struct.unpack('<4d', content[4:36])
        # 경계 상자가 필요한 타일에 하나도 닿지 않으면 건너뜀
        ca, cb = int(xmin // TILE) - c0, int(xmax // TILE) - c0
        ra, rb = int(ymin // TILE) - r0, int(ymax // TILE) - r0
        ca, ra = max(ca, 0), max(ra, 0)
        cb, rb = min(cb, want.shape[1] - 1), min(rb, want.shape[0] - 1)
        if ca > cb or ra > rb or not want[ra : rb + 1, ca : cb + 1].any():
            continue
        nparts, npts = struct.unpack('<2i', content[36:44])
        pts = np.frombuffer(content, dtype='<f8', count=npts * 2, offset=44 + 4 * nparts).reshape(-1, 2)
        xs.append(pts[:, 0])
        ys.append(pts[:, 1])
        zs.append(np.full(npts, zval))
        kept_shapes += 1
        if len(xs) >= BATCH:
            sink.add(np.concatenate(xs), np.concatenate(ys), np.concatenate(zs), want, c0, r0)
            xs, ys, zs = [], [], []
    if xs:
        sink.add(np.concatenate(xs), np.concatenate(ys), np.concatenate(zs), want, c0, r0)
    sink.flush()
    return {'file': zpath.name, 'records': nrec, 'kept_shapes': kept_shapes, 'points': sink.total, 'secs': round(time.time() - t0, 1)}


def index_spots(zpath: Path) -> dict:
    t0 = time.time()
    want, c0, r0 = wanted_tiles()
    z = zipfile.ZipFile(zpath)
    base = next(n[:-4] for n in z.namelist() if n.lower().endswith('.shp'))
    shp = z.read(base + '.shp')
    # 점 레코드는 크기가 같다: 머리 8 + 형식 4 + x 8 + y 8 = 28바이트
    n = (len(shp) - 100) // 28
    rec = np.frombuffer(shp, dtype=np.dtype([('h', '>i4', 2), ('t', '<i4'), ('x', '<f8'), ('y', '<f8')]), count=n, offset=100)
    assert (rec['t'] == 1).all(), '점이 아닌 레코드가 섞여 있음'
    dbf = z.read(base + '.dbf')
    nrec, hlen, rlen = struct.unpack('<IHH', dbf[4:12])
    off = 1
    nume = None
    p = 32
    while dbf[p] != 0x0D:
        name = dbf[p : p + 11].split(b'\0')[0].decode('ascii', 'ignore')
        size = dbf[p + 16]
        if name == 'NUME':
            nume = (off, size)
        off += size
        p += 32
    assert nume and nrec == n
    raw = np.frombuffer(dbf, dtype=np.uint8, count=nrec * rlen, offset=hlen).reshape(nrec, rlen)
    txt = raw[:, nume[0] : nume[0] + nume[1]].copy().view(f'S{nume[1]}').ravel()
    zv = np.char.strip(txt).astype(np.float64)
    sink = Sink('spot')
    sink.add(rec['x'].astype(np.float64), rec['y'].astype(np.float64), zv, want, c0, r0)
    sink.flush()
    return {'file': zpath.name, 'records': n, 'points': sink.total, 'secs': round(time.time() - t0, 1)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--fresh', action='store_true', help='work/pts를 비우고 시작')
    a = ap.parse_args()
    if a.fresh and PTS.exists():
        for f in PTS.glob('*.bin'):
            f.unlink()
    want, c0, r0 = wanted_tiles()
    print(f'필요한 타일 {int(want.sum()):,}장 (격자 {want.shape[1]}×{want.shape[0]}, 시작 열 {c0} 행 {r0})', flush=True)
    files = contour_zips()
    if a.only:
        keep = {s.strip().zfill(3) for s in a.only.split(',')}
        files = [f for f in files if f.name[-7:-4] in keep]
    results = []
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(index_contours, str(f)) for f in files]
        sp = spot_zip()
        if sp and not a.only:
            futs.append(ex.submit(index_spots, sp))
        for fu in futs:
            r = fu.result()
            results.append(r)
            print(r, flush=True)
    (WORK / 't1_result.json').write_text(json.dumps({'tiles_wanted': int(want.sum()), 'c0': c0, 'r0': r0, 'files': results}, ensure_ascii=False, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main()
