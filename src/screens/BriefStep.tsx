import type { Brief, Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  onNext: () => void
}

type TextKey = Exclude<keyof Brief, 'visit'>

const FIELDS: { key: TextKey; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'projectName', label: '프로젝트 이름', placeholder: '예: 충장로 빈 점포 재생 스튜디오' },
  { key: 'theme', label: '과제명 또는 공모전 주제', placeholder: '예: 2026 학생건축상 — 사라지는 상업 공간의 다음 쓰임' },
  { key: 'program', label: '건축 프로그램', placeholder: '예: 청년 공유주거 + 동네 작업장' },
  { key: 'scale', label: '예상 규모·연면적', placeholder: '예: 연면적 약 2,000㎡, 지상 5층 이하' },
  { key: 'targetUsers', label: '사용자·대상자', placeholder: '예: 원도심 상인, 인근 대학생, 주말 방문객' },
  { key: 'nature', label: '설계 대상의 성격', placeholder: '예: 신축 / 기존 건물 리노베이션 / 증축 / 외부공간' },
  { key: 'deliverables', label: '제출 결과물 형태', placeholder: '예: A1 패널 2장, 1/200 모형, 발표 10분' },
  {
    key: 'materials',
    label: '이미 가지고 있는 자료',
    placeholder: '예: 지난주 답사 사진 40장, 과제 지침서, 1/1000 지형도',
    multiline: true,
  },
]

const VISIT_OPTIONS: { value: Brief['visit']; label: string }[] = [
  { value: 'done', label: '다녀왔음' },
  { value: 'planned', label: '갈 예정' },
  { value: 'none', label: '계획 없음' },
]

export default function BriefStep({ project, update, onNext }: Props) {
  const b = project.brief
  const set = (key: TextKey, value: string) =>
    update((d) => {
      d.brief[key] = value
    })

  return (
    <div className="form-page">
      <header className="form-head">
        <p className="eyebrow">① 과제</p>
        <h2>어떤 과제로 이 대지를 보나요?</h2>
        <p className="muted">모두 채우지 않아도 됩니다. 나중에 챗봇에게 보낼 프롬프트의 맥락이 됩니다.</p>
      </header>

      <div className="form-grid">
        {FIELDS.map((f) => (
          <label key={f.key} className={`field${f.multiline ? ' wide' : ''}`}>
            <span className="label">{f.label}</span>
            {f.multiline ? (
              <textarea rows={3} value={b[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input type="text" value={b[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}

        <fieldset className="field wide">
          <legend className="label">현장답사</legend>
          <div className="chips">
            {VISIT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`chip${b.visit === o.value ? ' on' : ''}`}
                aria-pressed={b.visit === o.value}
                onClick={() =>
                  update((d) => {
                    d.brief.visit = d.brief.visit === o.value ? '' : o.value
                  })
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="form-foot">
        <button type="button" className="btn primary" onClick={onNext}>
          다음: 첫 질문
        </button>
      </div>
    </div>
  )
}
