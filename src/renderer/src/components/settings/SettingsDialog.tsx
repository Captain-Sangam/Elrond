import React, { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui/tabs'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@renderer/components/ui/select'
import { Badge } from '@renderer/components/ui/badge'
import { GitHubRepoManager } from './GitHubRepoManager'
import { Check, Loader2, Key, AlertTriangle, GitBranch, Globe } from 'lucide-react'
import type { ProviderName } from '@shared/types'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PROVIDER_LIST: { name: ProviderName; label: string }[] = [
  { name: 'openai', label: 'OpenAI' },
  { name: 'anthropic', label: 'Anthropic' },
  { name: 'google', label: 'Google' }
]

type KeyTestStatus = 'idle' | 'testing' | 'valid' | 'invalid'

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const {
    providers,
    synthesizer,
    enableDebate,
    maxDebateRounds,
    submitKey,
    systemPrompt,
    setSetting
  } = useSettingsStore()

  const [activeTab, setActiveTab] = useState('general')
  const [apiKeys, setApiKeys] = useState<Record<ProviderName, string>>({
    openai: '',
    anthropic: '',
    google: ''
  })
  const [keyStatus, setKeyStatus] = useState<Record<ProviderName, KeyTestStatus>>({
    openai: 'idle',
    anthropic: 'idle',
    google: 'idle'
  })
  const [localSystemPrompt, setLocalSystemPrompt] = useState(systemPrompt)
  const [githubToken, setGithubToken] = useState('')
  const [githubStatus, setGithubStatus] = useState<KeyTestStatus>('idle')
  const [githubOrg, setGithubOrg] = useState('')
  const [tavilyKey, setTavilyKey] = useState('')
  const [tavilyStatus, setTavilyStatus] = useState<KeyTestStatus>('idle')
  const [availableModels, setAvailableModels] = useState<Record<ProviderName, string[]>>({
    openai: [],
    anthropic: [],
    google: []
  })
  const [modelsLoading, setModelsLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setModelsLoading(true)
      PROVIDER_LIST.forEach(async ({ name }) => {
        const key = await window.elrond.getApiKey(name)
        if (key) {
          setApiKeys((prev) => ({ ...prev, [name]: '••••••••' + key.slice(-4) }))
          setKeyStatus((prev) => ({ ...prev, [name]: 'valid' }))
          try {
            const models = await window.elrond.listModels(name, key)
            setAvailableModels((prev) => ({ ...prev, [name]: models }))
          } catch {
            // keep empty
          }
        }
      })
      setLocalSystemPrompt(systemPrompt)
      setTimeout(() => setModelsLoading(false), 2000)

      window.elrond.getGitHubToken().then((has) => {
        if (has) {
          setGithubToken('••••••••')
          setGithubStatus('valid')
        }
      })
      window.elrond.getSetting('githubOrg').then((val) => {
        if (val) setGithubOrg(val)
      })
      window.elrond.getApiKey('tavily').then((key) => {
        if (key) {
          setTavilyKey('••••••••' + key.slice(-4))
          setTavilyStatus('valid')
        }
      })
    }
  }, [open, systemPrompt])

  const handleTestGithubToken = useCallback(async () => {
    if (!githubToken || githubToken.startsWith('••')) return
    setGithubStatus('testing')
    const valid = await window.elrond.testGitHubToken(githubToken)
    if (valid) {
      await window.elrond.setGitHubToken(githubToken)
      setGithubStatus('valid')
    } else {
      setGithubStatus('invalid')
    }
  }, [githubToken])

  const handleTestTavilyKey = useCallback(async () => {
    if (!tavilyKey || tavilyKey.startsWith('••')) return
    setTavilyStatus('testing')
    const valid = await window.elrond.testWebSearchKey(tavilyKey)
    if (valid) {
      await window.elrond.setApiKey('tavily', tavilyKey)
      setTavilyStatus('valid')
    } else {
      setTavilyStatus('invalid')
    }
  }, [tavilyKey])

  const handleTestKey = useCallback(async (provider: ProviderName, key: string) => {
    if (!key || key.startsWith('••')) return
    setKeyStatus((prev) => ({ ...prev, [provider]: 'testing' }))
    const valid = await window.elrond.testApiKey(provider, key)
    if (valid) {
      await window.elrond.setApiKey(provider, key)
      setKeyStatus((prev) => ({ ...prev, [provider]: 'valid' }))
    } else {
      setKeyStatus((prev) => ({ ...prev, [provider]: 'invalid' }))
    }
  }, [])

  const handleClearHistory = useCallback(async () => {
    if (confirm('Are you sure you want to delete all session history?')) {
      const sessions = await window.elrond.getSessions()
      for (const s of sessions) {
        await window.elrond.deleteSession(s.id)
      }
    }
  }, [])

  const handleResetKeys = useCallback(async () => {
    if (confirm('Are you sure you want to reset all API keys?')) {
      for (const { name } of PROVIDER_LIST) {
        await window.elrond.deleteApiKey(name)
      }
      setApiKeys({ openai: '', anthropic: '', google: '' })
      setKeyStatus({ openai: 'idle', anthropic: 'idle', google: 'idle' })
    }
  }, [])

  const statusIcon = (status: KeyTestStatus, fallback: React.ReactNode): React.ReactNode => {
    if (status === 'testing') return <Loader2 className="h-3 w-3 animate-spin" />
    if (status === 'valid') return <Check className="h-3 w-3 text-green-400" />
    if (status === 'invalid') return <AlertTriangle className="h-3 w-3 text-destructive" />
    return fallback
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="pt-2">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
            <TabsTrigger value="github">GitHub</TabsTrigger>
            <TabsTrigger value="websearch">Web Search</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------------ General */}
          <TabsContent value="general" className="space-y-6 pt-4">
            {/* Synthesizer */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Synthesizer</h3>
              <Select value={synthesizer} onValueChange={(v) => setSetting('synthesizer', v)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_LIST.map(({ name, label }) => (
                    <SelectItem key={name} value={name}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>

            {/* Debate */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Debate</h3>
                  <p className="text-xs text-muted-foreground">
                    Agents critique each other and revise their answers before synthesis
                  </p>
                </div>
                <Button
                  variant={enableDebate ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSetting('enableDebate', enableDebate ? 'false' : 'true')}
                >
                  {enableDebate ? 'Enabled' : 'Disabled'}
                </Button>
              </div>
              {enableDebate && (
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-medium">Max debate rounds</h4>
                    <p className="text-[10px] text-muted-foreground">
                      A moderator ends the debate early once agents agree. Each round makes one
                      call per agent plus a moderator check.
                    </p>
                  </div>
                  <Select
                    value={String(maxDebateRounds)}
                    onValueChange={(v) => setSetting('maxDebateRounds', v)}
                  >
                    <SelectTrigger className="h-8 w-20 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </section>

            {/* Submit Key */}
            <section className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">Submit Key</h3>
                <p className="text-xs text-muted-foreground">How to send messages</p>
              </div>
              <Select value={submitKey} onValueChange={(v) => setSetting('submitKey', v)}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CmdEnter">⌘ + Enter</SelectItem>
                  <SelectItem value="Enter">Enter</SelectItem>
                </SelectContent>
              </Select>
            </section>

            {/* System Prompt */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Custom System Prompt</h3>
              <Textarea
                value={localSystemPrompt}
                onChange={(e) => setLocalSystemPrompt(e.target.value)}
                onBlur={() => setSetting('systemPrompt', localSystemPrompt)}
                placeholder="Optional system prompt prepended to all agent calls..."
                className="text-xs"
                rows={3}
              />
            </section>

            {/* Danger Zone */}
            <section className="space-y-2 rounded-lg border border-destructive/20 p-3">
              <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={handleClearHistory}>
                  Clear All History
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={handleResetKeys}>
                  Reset API Keys
                </Button>
              </div>
            </section>
          </TabsContent>

          {/* ------------------------------------------------ Providers */}
          <TabsContent value="providers" className="space-y-6 pt-4">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">API Keys</h3>
              {PROVIDER_LIST.map(({ name, label }) => (
                <div key={name} className="space-y-1">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={apiKeys[name]}
                      onChange={(e) => setApiKeys((prev) => ({ ...prev, [name]: e.target.value }))}
                      placeholder={`${label} API Key`}
                      className="h-8 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={() => handleTestKey(name, apiKeys[name])}
                      disabled={!apiKeys[name] || apiKeys[name].startsWith('••')}
                    >
                      {statusIcon(keyStatus[name], <Key className="h-3 w-3" />)}
                      Test
                    </Button>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">Models</h3>
                {modelsLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              {providers.map((provider) => {
                const list = availableModels[provider.name]
                return (
                  <div key={provider.name} className="space-y-1">
                    <label className="text-xs text-muted-foreground">{provider.label}</label>
                    {list.length > 0 ? (
                      <Select
                        value={provider.model}
                        onValueChange={(v) => setSetting(`${provider.name}_model`, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent className="max-h-52">
                          {list.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={provider.model}
                        onChange={(e) => setSetting(`${provider.name}_model`, e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Model name"
                      />
                    )}
                  </div>
                )
              })}
            </section>
          </TabsContent>

          {/* ------------------------------------------------ GitHub */}
          <TabsContent value="github" className="space-y-4 pt-4">
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">GitHub</h3>
                {githubStatus === 'valid' && (
                  <Badge className="border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
                    Connected
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Add a personal access token to query repos via{' '}
                <span className="font-mono">/github</span> and index their code for the agents.
              </p>
              <div className="space-y-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Personal Access Token</label>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_..."
                      className="h-8 text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1"
                      onClick={handleTestGithubToken}
                      disabled={!githubToken || githubToken.startsWith('••')}
                    >
                      {statusIcon(githubStatus, <GitBranch className="h-3 w-3" />)}
                      Test
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Generate one at{' '}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=Elrond"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline decoration-primary/30 underline-offset-2"
                    >
                      github.com/settings/tokens
                    </a>{' '}
                    → "Generate new token (classic)" with the <span className="font-mono">repo</span>{' '}
                    scope (required to list, clone and index private repos).
                  </p>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Organization(s)</label>
                  <Input
                    value={githubOrg}
                    onChange={(e) => setGithubOrg(e.target.value)}
                    onBlur={() => setSetting('githubOrg', githubOrg)}
                    placeholder="my-org (comma-separated for multiple)"
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Repos from these orgs will appear in the{' '}
                    <span className="font-mono">/github</span> dropdown.
                  </p>
                </div>
              </div>
            </section>

            <GitHubRepoManager hasToken={githubStatus === 'valid'} active={activeTab === 'github'} />
          </TabsContent>

          {/* ------------------------------------------------ Web Search */}
          <TabsContent value="websearch" className="space-y-4 pt-4">
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Web Search</h3>
                {tavilyStatus === 'valid' && (
                  <Badge className="border-green-500/30 bg-green-500/10 text-[9px] text-green-400">
                    Connected
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Give the agents live web results: arm the globe button in the message input and
                the top results are injected into their context for that message.
              </p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Tavily API Key</label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={tavilyKey}
                    onChange={(e) => setTavilyKey(e.target.value)}
                    placeholder="tvly-..."
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    onClick={handleTestTavilyKey}
                    disabled={!tavilyKey || tavilyKey.startsWith('••')}
                  >
                    {statusIcon(tavilyStatus, <Globe className="h-3 w-3" />)}
                    Test
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Sign up free at{' '}
                  <a
                    href="https://app.tavily.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline decoration-primary/30 underline-offset-2"
                  >
                    app.tavily.com
                  </a>{' '}
                  — 1,000 searches/month, no credit card required. Copy the key from the dashboard.
                  Each armed message uses one search.
                </p>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
