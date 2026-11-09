import { useCallback, useState } from 'react'
import DiagnosticsPanel from './components/DiagnosticsPanel'
import SettingsDialog from './components/SettingsDialog'
import Stepper from './components/Stepper'
import { useHashRoute } from './lib/hashRoute'
import { downloadBlob, nowIso } from './model/project'
import { exportProjectFile } from './model/transfer'
import type { StepId } from './model/types'
import { useProject, type SaveState } from './model/useProject'
import BriefStep from './screens/BriefStep'
import DataStep from './screens/DataStep'
import FactsStep from './screens/FactsStep'
import Home from './screens/Home'
import InterpretStep from './screens/InterpretStep'
import ObserveStep from './screens/ObserveStep'
import QuestionStep from './screens/QuestionStep'
import ReportStep from './screens/ReportStep'
import SiteStep from './screens/SiteStep'
import { loadKeys, saveKeys, type ApiKeys } from './sources/keys'
import { loadConfig, saveConfig, type BaseMap, type VWorldConfig } from './sources/vworld'

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: '저장 중…',
  saved: '브라우저에 저장됨',
  error: '저장 실패',
}

export default function App() {
  const [route, navigate] = useHashRoute()
  const [config, setConfig] = useState<VWorldConfig>(() => loadConfig())
  const [keys, setKeys] = useState<ApiKeys>(() => loadKeys())
  const [settingsOpen, setSettingsOpen] = useState(() => !loadConfig().key)
  const [diagOpen, setDiagOpen] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [baseMap, setBaseMap] = useState<BaseMap>('Base')

  const projectId = route.name === 'project' ? route.id : null
  const { project, loadError, saveState, update } = useProject(projectId)

  const go = useCallback(
    (step: StepId) => {
      if (projectId) navigate({ name: 'project', id: projectId, step })
    },
    [navigate, projectId],
  )

  const handleSave = (next: VWorldConfig, nextKeys: ApiKeys) => {
    const ok1 = saveConfig(next)
    const ok2 = saveKeys(nextKeys)
    setStorageBlocked(!(ok1 && ok2))
    setConfig({ key: next.key.trim(), domain: next.domain.trim() })
    setKeys({ sgisKey: nextKeys.sgisKey.trim(), sgisSecret: nextKeys.sgisSecret.trim(), dataGoKr: nextKeys.dataGoKr.trim(), kakaoRest: nextKeys.kakaoRest.trim() })
    setSettingsOpen(false)
  }
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  const [exporting, setExporting] = useState(false)
  const doExport = async () => {
    if (!project || exporting) return
    setExporting(true)
    try {
      const { filename, blob } = await exportProjectFile(project)
      downloadBlob(filename, blob)
      update((d) => {
        d.lastExportedAt = nowIso()
      })
    } catch (e) {
      window.alert(`내보내지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  const step = route.name === 'project' ? route.step : 'brief'

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => navigate({ name: 'home' })} aria-label="프로젝트 목록으로">
          <span className="brand-mark" aria-hidden="true" />
          <h1>대지해석 에이전트</h1>
        </button>
        {project && (
          <>
            <span className="crumb" aria-hidden="true">
              /
            </span>
            <span className="project-title">{project.brief.projectName || '이름 없는 프로젝트'}</span>
            <span className={`save-state ${saveState}`}>{SAVE_LABEL[saveState]}</span>
          </>
        )}
        <span className="spacer" />
        {project && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => void doExport()}
            disabled={exporting}
            title="프로젝트를 사진까지 파일 하나로 저장 (다른 기기로 옮기거나 백업)"
          >
            {exporting ? '내보내는 중…' : '내보내기'}
            {!project.lastExportedAt && <span className="dot-warn" aria-label="내보낸 적 없음" />}
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => setDiagOpen(true)}>
          연결 진단
        </button>
        <button type="button" className="btn ghost" onClick={() => setSettingsOpen(true)}>
          설정
        </button>
      </header>

      {storageBlocked && (
        <div className="banner">이 브라우저에서는 설정 저장이 막혀 있어 새로고침하면 인증키가 사라집니다. (사생활 보호 모드 등)</div>
      )}

      {route.name === 'home' && <Home onOpen={(id) => navigate({ name: 'project', id, step: 'brief' })} />}

      {route.name === 'project' && (
        <>
          {loadError && (
            <div className="form-page">
              <p className="notice error">{loadError}</p>
              <button type="button" className="btn" onClick={() => navigate({ name: 'home' })}>
                목록으로
              </button>
            </div>
          )}
          {!loadError && !project && <p className="loading pad">불러오는 중…</p>}
          {project && (
            <div className="workspace">
              <Stepper project={project} current={step} onSelect={go} />
              <main className="workspace-main">
                {step === 'brief' && <BriefStep project={project} update={update} onNext={() => go('question')} />}
                {step === 'question' && <QuestionStep project={project} update={update} onNext={() => go('site')} />}
                {step === 'site' && (
                  <SiteStep
                    project={project}
                    update={update}
                    config={config}
                    baseMap={baseMap}
                    onBaseMap={setBaseMap}
                    onNext={() => go('data')}
                  />
                )}
                {step === 'data' && (
                  <DataStep
                    project={project}
                    update={update}
                    config={config}
                    keys={keys}
                    baseMap={baseMap}
                    onBaseMap={setBaseMap}
                    onGoSite={() => go('site')}
                    onGoQuestion={() => go('question')}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onNext={() => go('facts')}
                  />
                )}
                {step === 'facts' && <FactsStep project={project} update={update} onGoData={() => go('data')} />}
                {step === 'observe' && (
                  <ObserveStep project={project} update={update} config={config} baseMap={baseMap} onBaseMap={setBaseMap} onGoFacts={() => go('facts')} />
                )}
                {step === 'interpret' && <InterpretStep project={project} update={update} />}
                {step === 'report' && <ReportStep project={project} update={update} config={config} />}
              </main>
            </div>
          )}
        </>
      )}

      {settingsOpen && <SettingsDialog initial={config} initialKeys={keys} onSave={handleSave} onClose={closeSettings} />}
      {diagOpen && (
        <div className="dialog-backdrop" onClick={() => setDiagOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label="연결 진단" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-title-row">
              <h2>연결 진단</h2>
              <button type="button" className="btn ghost small" onClick={() => setDiagOpen(false)}>
                닫기
              </button>
            </div>
            <DiagnosticsPanel config={config} />
          </div>
        </div>
      )}
    </div>
  )
}
