import { useEffect, useState } from 'react'
import { getPhoto } from '../model/db'

/** 저장된 사진을 화면에 보일 주소(object URL)로 바꾼다. 화면에서 사라지면 정리한다. */
export function usePhotoUrl(id: string | null, which: 'thumb' | 'blob' = 'thumb'): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) {
      setUrl(null)
      return
    }
    let cancelled = false
    let made: string | null = null
    getPhoto(id)
      .then((p) => {
        if (cancelled || !p) return
        made = URL.createObjectURL(which === 'thumb' ? p.thumb : p.blob)
        setUrl(made)
      })
      .catch(() => setUrl(null))
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [id, which])
  return url
}

export function PhotoThumb({ id, alt, onClick, onRemove }: { id: string; alt: string; onClick?: () => void; onRemove?: () => void }) {
  const url = usePhotoUrl(id)
  return (
    <div className="photo-thumb">
      <button type="button" className="photo-open" onClick={onClick} aria-label={`${alt} 크게 보기`}>
        {url ? <img src={url} alt={alt} loading="lazy" /> : <span className="photo-loading" />}
      </button>
      {onRemove && (
        <button type="button" className="photo-remove" onClick={onRemove} aria-label={`${alt} 지우기`}>
          ×
        </button>
      )}
    </div>
  )
}

export function PhotoViewer({ id, onClose }: { id: string; onClose: () => void }) {
  const url = usePhotoUrl(id, 'blob')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dialog-backdrop photo-viewer" onClick={onClose} role="dialog" aria-modal="true" aria-label="사진 크게 보기">
      {url ? <img src={url} alt="현장 사진" /> : <p className="loading">불러오는 중…</p>}
      <button type="button" className="btn" onClick={onClose}>
        닫기
      </button>
    </div>
  )
}
