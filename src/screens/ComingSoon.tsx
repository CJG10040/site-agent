import type { StepId } from '../model/types'

const PLANS: Partial<Record<StepId, { phase: number; title: string; items: string[] }>> = {
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
