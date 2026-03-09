import React, { useEffect, useRef } from 'react'
import { useSessionStore } from '@renderer/stores/sessionStore'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { AgentPanel } from './AgentPanel'
import { DebatePanel } from './DebatePanel'
import { SynthesisPanel } from './SynthesisPanel'
import { MessageInput } from './MessageInput'
import { MarkdownContent } from './MarkdownContent'
import type { ProviderName } from '@shared/types'
import { Sparkles, User, GitBranch } from 'lucide-react'

export function SessionView(): React.JSX.Element {
  const {
    activeSessionId,
    sessions,
    messages,
    isDeliberating,
    currentPhase,
    currentPrompt,
    agentStreams,
    debateStreams,
    synthesisStream
  } = useSessionStore()

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const { providers } = useSettingsStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, agentStreams, debateStreams, synthesisStream])

  if (!activeSessionId) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Welcome to Elrond</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a new session to deliberate with multiple AI agents.
            </p>
          </div>
        </div>
        <MessageInput />
      </div>
    )
  }

  const enabledProviders = providers.filter((p) => p.enabled)
  const hasActiveStreams = Object.values(agentStreams).some((s) => s.content)
  const hasDebateStreams = Object.values(debateStreams).some((s) => s.content)

  // Group past messages into deliberation rounds
  const pastMessages = !isDeliberating ? messages : messages.filter((m) => {
    const streamProviders = Object.keys(agentStreams)
    if (m.role === 'user' && messages.indexOf(m) === messages.length - 1) return false
    return !streamProviders.some(
      (p) => (m.role === 'agent' || m.role === 'debate' || m.role === 'synthesis') && m.agent_name === p
    )
  })

  // Group saved messages into deliberation rounds for display
  const rounds: { user: typeof messages[0]; agents: typeof messages; debates: typeof messages; synthesis: typeof messages[0] | null }[] = []
  let currentRound: typeof rounds[0] | null = null

  for (const msg of pastMessages) {
    if (msg.role === 'user') {
      if (currentRound) rounds.push(currentRound)
      currentRound = { user: msg, agents: [], debates: [], synthesis: null }
    } else if (currentRound) {
      if (msg.role === 'agent') currentRound.agents.push(msg)
      else if (msg.role === 'debate') currentRound.debates.push(msg)
      else if (msg.role === 'synthesis') currentRound.synthesis = msg
    }
  }
  if (currentRound) rounds.push(currentRound)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-5xl space-y-6">
          {activeSession?.repo_id && (
            <div className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2">
              <GitBranch className="h-4 w-4 text-green-400" />
              <span className="text-xs font-medium text-green-400">Code Session</span>
              <span className="text-xs text-muted-foreground">
                Agents have access to the indexed repository
              </span>
            </div>
          )}

          {rounds.map((round) => (
            <div key={round.user.id} className="space-y-4">
              {/* User message */}
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <MarkdownContent content={round.user.content} className="pt-0.5" />
              </div>

              {/* Agent responses */}
              {round.agents.length > 0 && (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {round.agents.map((agent) => (
                    <AgentPanel
                      key={agent.id}
                      provider={agent.agent_name as ProviderName}
                      model={providers.find((p) => p.name === agent.agent_name)?.model || ''}
                      content={agent.content}
                      isStreaming={false}
                      error={null}
                      tokenCount={agent.token_count || undefined}
                    />
                  ))}
                </div>
              )}

              {/* Debate */}
              {round.debates.length > 0 && (
                <DebatePanel
                  entries={round.debates.map((d) => ({
                    provider: d.agent_name as ProviderName,
                    content: d.content,
                    isStreaming: false
                  }))}
                  isActive={false}
                />
              )}

              {/* Synthesis */}
              {round.synthesis && (
                <SynthesisPanel
                  content={round.synthesis.content}
                  isStreaming={false}
                  tokenCount={round.synthesis.token_count || undefined}
                />
              )}
            </div>
          ))}

          {/* Current prompt shown immediately while deliberating */}
          {isDeliberating && currentPrompt && (
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <User className="h-4 w-4 text-primary" />
              </div>
              <MarkdownContent content={currentPrompt} className="pt-0.5" />
            </div>
          )}

          {/* Active streaming panels — only while deliberating */}
          {isDeliberating && hasActiveStreams && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {enabledProviders.map((provider) => {
                  const stream = agentStreams[provider.name]
                  return (
                    <AgentPanel
                      key={provider.name}
                      provider={provider.name}
                      model={provider.model}
                      content={stream?.content || ''}
                      isStreaming={stream?.isStreaming || false}
                      error={stream?.error || null}
                      tokenCount={stream?.tokenCount}
                    />
                  )
                })}
              </div>

              {(hasDebateStreams || currentPhase === 'debate') && (
                <DebatePanel
                  entries={enabledProviders.map((p) => ({
                    provider: p.name,
                    content: debateStreams[p.name]?.content || '',
                    isStreaming: debateStreams[p.name]?.isStreaming || false
                  }))}
                  isActive={currentPhase === 'debate'}
                />
              )}

              {(synthesisStream.content || currentPhase === 'synthesis') && (
                <SynthesisPanel
                  content={synthesisStream.content}
                  isStreaming={synthesisStream.isStreaming}
                  tokenCount={synthesisStream.tokenCount || undefined}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <MessageInput />
    </div>
  )
}
