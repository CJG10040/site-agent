import { useEffect, useRef, useState } from 'react'

// 브라우저 음성인식(Web Speech API). 지원하지 않는 브라우저에서는 버튼을 숨긴다.
// 크롬 등은 음성을 브라우저 제조사의 음성인식 서버로 보내 글자로 바꾼다.

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: RecognitionResultEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
}

type RecognitionCtor = new () => Recognition

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export default function SpeechButton({ onText }: { onText: (text: string) => void }) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<Recognition | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const Ctor = getCtor()

  useEffect(() => () => recRef.current?.stop(), [])

  if (!Ctor) return null

  const start = () => {
    setError(null)
    const rec = new Ctor()
    rec.lang = 'ko-KR'
    rec.interimResults = false
    rec.continuous = false
    rec.onresult = (e) => {
      const parts: string[] = []
      for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) parts.push(e.results[i][0].transcript)
      if (parts.length) onTextRef.current(parts.join(' ').trim())
    }
    rec.onerror = (e) => setError(e.error === 'not-allowed' ? '마이크 사용이 허용되지 않았습니다.' : '음성을 알아듣지 못했습니다.')
    rec.onend = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  return (
    <span className="speech">
      <button
        type="button"
        className={`btn small${listening ? ' primary' : ''}`}
        onClick={() => (listening ? recRef.current?.stop() : start())}
        aria-pressed={listening}
        title="말하면 글자로 받아 적습니다 (브라우저 음성인식)"
      >
        {listening ? '듣는 중… (누르면 멈춤)' : '음성 입력'}
      </button>
      {error && <span className="hint">{error}</span>}
    </span>
  )
}
