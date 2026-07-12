import React, { useCallback, useEffect, useState } from 'react'
import { useSettingsStore } from './stores/settingsStore'
import { useAgentsStore } from './stores/agentsStore'
import { useSessionStore } from './stores/sessionStore'
import { useIndexingStore } from './stores/indexingStore'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { SessionView } from './components/chat/SessionView'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { AgentsDialog } from './components/agents/AgentsDialog'
import { SetupWizard } from './components/onboarding/SetupWizard'
import { RepoPickerDialog } from './components/github/RepoPickerDialog'
import { TooltipProvider } from './components/ui/tooltip'

export default function App(): React.JSX.Element {
  const { loaded, setupComplete, loadSettings } = useSettingsStore()
  const loadAgents = useAgentsStore((s) => s.loadAgents)
  const {
    loadSessions,
    handleStreamStart,
    handleStreamToken,
    handleStreamDone,
    handleStreamError,
    handlePhaseChange,
    handleModeratorVerdict,
    handleNotice
  } = useSessionStore()
  const handleIndexProgress = useIndexingStore((s) => s.handleProgress)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(() => localStorage.getItem('elrond:statsOpen') !== 'false')

  const toggleStats = useCallback(() => {
    setStatsOpen((prev) => {
      localStorage.setItem('elrond:statsOpen', String(!prev))
      return !prev
    })
  }, [])

  useEffect(() => {
    loadSettings()
    loadAgents()
    loadSessions()
  }, [loadSettings, loadAgents, loadSessions])

  useEffect(() => {
    const unsubStart = window.elrond.onStreamStart(handleStreamStart)
    const unsubToken = window.elrond.onStreamToken(handleStreamToken)
    const unsubDone = window.elrond.onStreamDone(handleStreamDone)
    const unsubError = window.elrond.onStreamError(handleStreamError)
    const unsubPhase = window.elrond.onPhaseChange(handlePhaseChange)
    const unsubModerator = window.elrond.onModeratorVerdict(handleModeratorVerdict)
    const unsubNotice = window.elrond.onNotice(handleNotice)
    const unsubIndex = window.elrond.onIndexProgress(handleIndexProgress)

    return () => {
      unsubStart()
      unsubToken()
      unsubDone()
      unsubError()
      unsubPhase()
      unsubModerator()
      unsubNotice()
      unsubIndex()
    }
  }, [
    handleStreamStart,
    handleStreamToken,
    handleStreamDone,
    handleStreamError,
    handlePhaseChange,
    handleModeratorVerdict,
    handleNotice,
    handleIndexProgress
  ])

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!setupComplete) {
    return <SetupWizard />
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen">
        <Sidebar
          onSettingsClick={() => setSettingsOpen(true)}
          onRepoClick={() => setRepoPickerOpen(true)}
          onAgentsClick={() => setAgentsOpen(true)}
        />
        <div className="flex flex-1 flex-col">
          <TopBar statsOpen={statsOpen} onToggleStats={toggleStats} />
          <SessionView statsOpen={statsOpen} />
        </div>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <AgentsDialog
          open={agentsOpen}
          onOpenChange={setAgentsOpen}
          onOpenSettings={() => {
            setAgentsOpen(false)
            setSettingsOpen(true)
          }}
        />
        <RepoPickerDialog open={repoPickerOpen} onOpenChange={setRepoPickerOpen} />
      </div>
    </TooltipProvider>
  )
}
