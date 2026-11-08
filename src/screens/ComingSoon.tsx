import type { StepId } from '../model/types'

const PLANS: Partial<Record<StepId, { phase: number; title: string; items: string[] }>> = {
  observe: {
    phase: 3,
    title: '현장 관찰',
    items: [
      '사진 올리기 — 촬영 위치·시간을 사진에서 자동으로 읽기',
      '지도 위에 관찰 위치 표시',
      '관찰 문장, 감각 키워드, 이용자·행위 태그, 개인적인 느낌',
      '공공데이터와 현장 관찰을 나란히 비교하기',
    ],
  },
  interpret: {
    phase: 4,
    title: '해석·가설 (챗봇 왕복)',
    items: [
      '확인한 사실·관찰로 단계별 프롬프트 만들기 (관계 → 긴장 → 복수 해석 → 설계 질문 → 가설)',
      '챗봇 답변을 붙여넣으면 해석·긴장·질문·가설 카드로 정리',
      '동의 · 부분 동의 · 현장과 다름 · 반대 해석 만들기 · 이 가설 발전시키기',
    ],
  },
  report: {
    phase: 5,
    title: '리포트',
    items: ['웹 리포트와 인쇄용 PDF', '분석 지도 이미지, 사실·해석·가설 표, 출처 목록', '패널용 요약문'],
  },
}

export default function ComingSoon({ step }: { step: StepId }) {
  const plan = PLANS[step]
  if (!plan) return null
  return (
    <div className="form-page">
      <header className="form-head">
        <p className="eyebrow">Phase {plan.phase}에서 만들 예정</p>
        <h2>{plan.title}</h2>
      </header>
      <ul className="plan-list">
        {plan.items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>
      <p className="muted">개발 순서와 범위는 docs/개발계획서.md에 있습니다.</p>
    </div>
  )
}
