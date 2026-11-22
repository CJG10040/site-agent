import { useCallback, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import DiagnosticsPanel from './components/DiagnosticsPanel'
import SettingsDialog from './components/SettingsDialog'
import Stepper from './components/Stepper'
import { useHashRoute } from './lib/hashRoute'
import { THEME_LABEL, useTheme } from './lib/theme'
import { downloadBlob, nowIso } from './model/project'
import { exportProjectFile } from './model/transfer'
import type { StepId } from './model/types'
import { useProject, type SaveState } from './model/useProject'
import BriefStep from './screens/BriefStep'
import DataStep from './screens/DataStep'
import DiagramStep from './screens/DiagramStep'
import FactsStep from './screens/FactsStep'
import Home from './screens/Home'
import InterpretStep from './screens/InterpretStep'
import VersionSave from './components/VersionSave'
import ObserveStep from './screens/ObserveStep'
import QuestionStep from './screens/QuestionStep'
import ReportStep from './screens/ReportStep'
import ModelStep from './screens/ModelStep'
import LawStep from './screens/LawStep'
import PastStep from './screens/PastStep'
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
  const [theme, cycleTheme] = useTheme()
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

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
    setKeys({ sgisKey: nextKeys.sgisKey.trim(), sgisSecret: nextKeys.sgisSecret.trim(), dataGoKr: nextKeys.dataGoKr.trim(), kakaoRest: nextKeys.kakaoRest.trim(), itsKey: nextKeys.itsKey.trim() })
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
          {/* 표지: 필지 경계선 하나와 대지 중심점 하나 */}
          <svg className="brand-mark" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 6.5 12.5 2.8 17 12.2 7.6 17.2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle className="site-dot" cx="10" cy="10" r="2.2" />
          </svg>
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
        <div className="topbar-actions">
          {project && <VersionSave project={project} />}
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
          {project && <span className="topbar-sep" aria-hidden="true" />}
          <button type="button" className="btn ghost" onClick={() => setDiagOpen(true)}>
            연결 진단
          </button>
          <button type="button" className="btn ghost" onClick={() => setSettingsOpen(true)}>
            설정
          </button>
          <button
            type="button"
            className="btn ghost icon-only"
            onClick={cycleTheme}
            title={`테마: ${THEME_LABEL[theme]} — 눌러서 바꾸기`}
            aria-label={`테마: ${THEME_LABEL[theme]}. 눌러서 바꾸기`}
          >
            <ThemeIcon aria-hidden="true" />
          </button>
        </div>
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
                {step === 'diagrams' && (
                  <DiagramStep project={project} update={update} config={config} keys={keys} onGoData={() => go('data')} onGoModel={() => go('model')} onNext={() => go('observe')} />
                )}
                {step === 'observe' && (
                  <ObserveStep project={project} update={update} config={config} baseMap={baseMap} onBaseMap={setBaseMap} onGoFacts={() => go('facts')} />
                )}
                {step === 'interpret' && <InterpretStep project={project} update={update} config={config} />}
                {step === 'report' && <ReportStep project={project} update={update} config={config} />}
                {step === 'model' && <ModelStep project={project} update={update} config={config} keys={keys} onGoData={() => go('data')} onGoSite={() => go('site')} />}
                {step === 'law' && <LawStep project={project} update={update} onGoData={() => go('data')} onGoDiagrams={() => go('diagrams')} />}
                {step === 'past' && <PastStep project={project} update={update} config={config} onGoData={() => go('data')} />}
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
            <DiagnosticsPanel config={config} keys={keys} />
          </div>
        </div>
      )}
    </div>
  )
}
