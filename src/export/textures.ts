// 렌더 재질 무늬 이미지 (2026-11-16): 앱이 직접 그리는 이음매 없는 타일 — 받아 오는 이미지가 아니라 저작권 걱정이 없다.
// 한 장 = 실제 크기 tile m (renderMaterials.ts). 같은 씨앗으로 그려서 늘 같은 그림이 나온다.
// 브라우저 캔버스로 그리고 JPEG로 담는다 (한 장 1024px, 약 0.2~0.5MB).

export type TexId = 'asphalt' | 'asphaltRed' | 'paving' | 'pavingBump' | 'grass' | 'ground' | 'concrete'

/** .3dm 안·ZIP 안 파일 이름 (렌더러가 한글 경로를 못 읽는 경우가 있어 영문) */
export const TEX_FILE: Record<TexId, string> = {
  asphalt: 'SA_asphalt.jpg',
  asphaltRed: 'SA_asphalt_red.jpg',
  paving: 'SA_paving.jpg',
  pavingBump: 'SA_paving_bump.jpg',
  grass: 'SA_grass.jpg',
  ground: 'SA_ground.jpg',
  concrete: 'SA_concrete.jpg',
}

const SIZE = 1024

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 이음매 없는 값 잡음: 주기 p칸 격자를 부드럽게 이음 (x, y는 0~1) */
function tileNoise(p: number, rand: () => number): (x: number, y: number) => number {
  const g = new Float32Array(p * p)
  for (let i = 0; i < g.length; i++) g[i] = rand()
  return (x, y) => {
    const fx = x * p
    const fy = y * p
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const sx = tx * tx * (3 - 2 * tx)
    const sy = ty * ty * (3 - 2 * ty)
    const i0 = ((x0 % p) + p) % p
    const i1 = (i0 + 1) % p
    const j0 = ((y0 % p) + p) % p
    const j1 = (j0 + 1) % p
    const a = g[j0 * p + i0]
    const b = g[j0 * p + i1]
    const c = g[j1 * p + i0]
    const d = g[j1 * p + i1]
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
}

/** 여러 크기 잡음을 겹침 (0~1 근처) */
function fbm(rand: () => number, base: number, octaves: number): (x: number, y: number) => number {
  const ns = Array.from({ length: octaves }, (_, o) => tileNoise(base * 2 ** o, rand))
  return (x, y) => {
    let s = 0
    let amp = 1
    let tot = 0
    for (const n of ns) {
      s += n(x, y) * amp
      tot += amp
      amp *= 0.5
    }
    return s / tot
  }
}

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

type Px = (x: number, y: number, i: number) => [number, number, number]

function paint(fn: Px): ImageData {
  const img = new ImageData(SIZE, SIZE)
  const d = img.data
  for (let py = 0; py < SIZE; py++)
    for (let px = 0; px < SIZE; px++) {
      const i = py * SIZE + px
      const [r, g, b] = fn(px / SIZE, py / SIZE, i)
      d[i * 4] = clamp(r)
      d[i * 4 + 1] = clamp(g)
      d[i * 4 + 2] = clamp(b)
      d[i * 4 + 3] = 255
    }
  return img
}

/** 아스팔트: 큰 얼룩 + 잔 알갱이 + 밝은 골재 점 (한 장 4m → 1px ≈ 4mm) */
function asphalt(seed: number, tint: [number, number, number], lift: number): ImageData {
  const rand = mulberry32(seed)
  const big = fbm(rand, 4, 3)
  const grain = fbm(rand, 128, 2)
  const speck = mulberry32(seed + 7)
  return paint((x, y) => {
    let v = lift + 0.05 * (big(x, y) - 0.5) * 2 + 0.07 * (grain(x, y) - 0.5) * 2
    const s = speck()
    if (s < 0.04) v += 0.08 + speck() * 0.12
    else if (s < 0.06) v -= 0.06
    return [v * tint[0], v * tint[1], v * tint[2]]
  })
}

/** 보도블록: 30cm 각 8×8장 (한 장 2.4m), 블록마다 색이 조금씩 다름 + 줄눈 + 모서리 살짝 어둡게 */
const BLOCKS = 8
function pavingTone(seed: number): [number, number, number][] {
  const rand = mulberry32(seed)
  const pal: [number, number, number][] = [
    [192, 186, 174],
    [178, 174, 168],
    [200, 188, 170],
    [186, 178, 164],
  ]
  return Array.from({ length: BLOCKS * BLOCKS }, () => {
    const c = pal[Math.floor(rand() * pal.length)]
    const k = 0.92 + rand() * 0.12
    return [c[0] * k, c[1] * k, c[2] * k]
  })
}
function pavingEdge(px: number, py: number): number {
  const cell = SIZE / BLOCKS
  const ex = Math.min(px % cell, cell - (px % cell))
  const ey = Math.min(py % cell, cell - (py % cell))
  return Math.min(ex, ey)
}
function paving(seed: number): ImageData {
  const tone = pavingTone(seed)
  const rand = mulberry32(seed + 1)
  const fine = fbm(rand, 256, 2)
  const mott = fbm(rand, 16, 2)
  const cell = SIZE / BLOCKS
  return paint((x, y) => {
    const px = x * SIZE
    const py = y * SIZE
    const e = pavingEdge(px, py)
    if (e < 1.5) return [96, 92, 86]
    const c = tone[Math.floor(py / cell) * BLOCKS + Math.floor(px / cell)]
    const bevel = e < 5 ? 1 - ((5 - e) / 3.5) * 0.14 : 1
    const k = bevel * (0.94 + 0.08 * fine(x, y) + 0.06 * (mott(x, y) - 0.5))
    return [c[0] * k, c[1] * k, c[2] * k]
  })
}
function pavingBump(seed: number): ImageData {
  const rand = mulberry32(seed + 2)
  const fine = fbm(rand, 256, 2)
  return paint((x, y) => {
    const e = pavingEdge(x * SIZE, y * SIZE)
    const v = e < 1.5 ? 0 : e < 5 ? ((e - 1.5) / 3.5) * 200 : 200 + 40 * fine(x, y)
    return [v, v, v]
  })
}

/** 잔디: 누런 얼룩 + 잎 잡음 (한 장 4m) */
function grass(seed: number): ImageData {
  const rand = mulberry32(seed)
  const patch = fbm(rand, 4, 3)
  const mid = fbm(rand, 48, 2)
  const blade = mulberry32(seed + 3)
  return paint((x, y) => {
    const t = smooth(0.4, 0.8, patch(x, y))
    const k = 0.8 + 0.26 * mid(x, y) + (blade() - 0.5) * 0.22
    return [(80 + 24 * t) * k, (116 + 8 * t) * k, (50 + 8 * t) * k]
  })
}

/** 땅: 흙과 풀이 섞인 바닥 (한 장 8m, 항공사진을 안 입힐 때 지형 면) */
function ground(seed: number): ImageData {
  const rand = mulberry32(seed)
  const mask = fbm(rand, 3, 4)
  const fine = fbm(rand, 96, 2)
  const dot = mulberry32(seed + 4)
  return paint((x, y) => {
    const m = smooth(0.32, 0.72, mask(x, y))
    const k = 0.86 + 0.2 * fine(x, y) + (dot() - 0.5) * 0.1
    return [(110 + (94 - 110) * m) * k, (102 + (108 - 102) * m) * k, (80 + (64 - 80) * m) * k]
  })
}

/** 콘크리트: 밝은 회색 + 얼룩 + 잔 기공 (한 장 3m) */
function concrete(seed: number): ImageData {
  const rand = mulberry32(seed)
  const mott = fbm(rand, 6, 4)
  const fine = fbm(rand, 192, 2)
  const pore = mulberry32(seed + 5)
  return paint((x, y) => {
    let k = 0.95 + 0.12 * (mott(x, y) - 0.5) + 0.06 * (fine(x, y) - 0.5)
    if (pore() < 0.003) k -= 0.18
    return [186 * k, 184 * k, 178 * k]
  })
}

function draw(id: TexId): ImageData {
  switch (id) {
    case 'asphalt':
      return asphalt(11, [255, 255, 262], 0.29)
    case 'asphaltRed':
      return asphalt(12, [370, 160, 136], 0.42)
    case 'paving':
      return paving(21)
    case 'pavingBump':
      return pavingBump(21)
    case 'grass':
      return grass(31)
    case 'ground':
      return ground(41)
    case 'concrete':
      return concrete(51)
  }
}

export async function imageToJpeg(img: ImageData, quality = 0.88): Promise<Uint8Array> {
  let blob: Blob | null
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(img.width, img.height)
    c.getContext('2d')!.putImageData(img, 0, 0)
    blob = await c.convertToBlob({ type: 'image/jpeg', quality })
  } else {
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    c.getContext('2d')!.putImageData(img, 0, 0)
    blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', quality))
  }
  if (!blob) throw new Error('무늬 이미지를 JPEG로 바꾸지 못했습니다')
  return new Uint8Array(await blob.arrayBuffer())
}

const cache = new Map<TexId, Promise<Uint8Array>>()

/** 무늬 이미지 한 장 (JPEG). 같은 탭에서는 한 번만 그림 */
export function textureJpeg(id: TexId): Promise<Uint8Array> {
  let p = cache.get(id)
  if (!p) {
    p = imageToJpeg(draw(id))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}
