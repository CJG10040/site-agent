import type { Project } from '../model/types'

interface Props {
  project: Project
  update: (fn: (draft: Project) => void) => void
  onNext: () => void
}

// 요청서 6.2의 선택지
const LENSES = [
  '이 장소의 사람과 관계',
  '장소의 기억과 역사',
  '도시의 이동과 경계',
  '생태·기후·물의 흐름',
  '빈 공간과 유휴공간',
  '지역의 생산·상업 활동',
  '주거와 생활 방식',
  '앞으로의 변화',
  '아직 모르겠음',
]

export default function QuestionStep({ project, update, onNext }: Props) {
  const q = project.question

  const toggleLens = (lens: string) =>
    update((d) => {
      const has = d.question.lenses.includes(lens)
      d.question.lenses = has ? d.question.lenses.filter((l) => l !== lens) : [...d.question.lenses, lens]
    })

  return (
    <div className="form-page">
      <header className="form-head">
        <p className="eyebrow">② 첫 질문 — 데이터를 모으기 전에</p>
        <h2>이번 설계에서 이 대지를 통해 가장 궁금한 것은 무엇인가요?</h2>
        <p className="muted">
          자료를 먼저 모으면 자료가 질문을 정해 버립니다. 지금 떠오르는 질문을 먼저 적어 두면, 이후의 사실·해석이 이
          질문을 기준으로 정리됩니다.
        </p>
      </header>

      <label className="field">
        <span className="label">가장 궁금한 것</span>
        <textarea
          rows={4}
          value={q.curiosity}
          placeholder="예: 저녁 6시 이후 이 거리에서 사람들이 어디로 사라지는지, 비어 있는 2층들은 왜 비어 있는지"
          onChange={(e) =>
            update((d) => {
              d.question.curiosity = e.target.value
            })
          }
        />
      </label>

      <fieldset className="field">
        <legend className="label">관심 있는 관점 (여러 개 선택 가능)</legend>
        <div className="chips">
          {LENSES.map((l) => (
            <button
              key={l}
              type="button"
              className={`chip${q.lenses.includes(l) ? ' on' : ''}`}
              aria-pressed={q.lenses.includes(l)}
              onClick={() => toggleLens(l)}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={q.lensOther}
          placeholder="다른 관점이 있다면 적어 주세요"
          onChange={(e) =>
            update((d) => {
              d.question.lensOther = e.target.value
            })
          }
        />
      </fieldset>

      <label className="field">
        <span className="label">이 대지를 고른 이유, 기억에 남은 장면, 불편했던 점</span>
        <textarea
          rows={3}
          value={q.personal}
          placeholder="예: 고등학생 때 자주 지나던 길인데, 지금은 셔터 내린 가게가 절반이다"
          onChange={(e) =>
            update((d) => {
              d.question.personal = e.target.value
            })
          }
        />
        <span className="help">개인적인 경험도 중요한 자료입니다. (요청서 4.2)</span>
      </label>

      <label className="field">
        <span className="label">피하고 싶은 일반적인 해석</span>
        <textarea
          rows={2}
          value={q.avoid}
          placeholder="예: '연결', '소통', '지속가능성' 같은 말로만 끝나는 개념 / 광장 하나 만들면 해결된다는 식의 결론"
          onChange={(e) =>
            update((d) => {
              d.question.avoid = e.target.value
            })
          }
        />
      </label>

      <div className="form-foot">
        <button type="button" className="btn primary" onClick={onNext}>
          다음: 대지 지정
        </button>
      </div>
    </div>
  )
}
