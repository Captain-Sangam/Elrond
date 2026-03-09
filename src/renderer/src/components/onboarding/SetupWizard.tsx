import React, { useState, useCallback, useEffect } from 'react'
import { useSettingsStore } from '@renderer/stores/settingsStore'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Badge } from '@renderer/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@renderer/components/ui/select'
import { Check, ChevronRight, Key, Loader2, AlertTriangle, Sparkles, Keyboard, Cpu } from 'lucide-react'
import type { ProviderName } from '@shared/types'

type Step = 'keys' | 'models' | 'shortcut'

const PROVIDERS: { name: ProviderName; label: string; placeholder: string }[] = [
  { name: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { name: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
  { name: 'google', label: 'Google', placeholder: 'AI...' }
]

export function SetupWizard(): React.JSX.Element {
  const { setSetting, providers } = useSettingsStore()
  const [step, setStep] = useState<Step>('keys')
  const [apiKeys, setApiKeys] = useState<Record<ProviderName, string>>({
    openai: '',
    anthropic: '',
    google: ''
  })
  const [keyStatus, setKeyStatus] = useState<Record<ProviderName, 'idle' | 'testing' | 'valid' | 'invalid'>>({
    openai: 'idle',
    anthropic: 'idle',
    google: 'idle'
  })
  const [models, setModels] = useState<Record<ProviderName, string>>({
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-5-20250514',
    google: 'gemini-1.5-pro'
  })
  const [shortcutDisplay, setShortcutDisplay] = useState('⌘ + Shift + Space')
  const [availableModels, setAvailableModels] = useState<Record<ProviderName, string[]>>({
    openai: [],
    anthropic: [],
    google: []
  })
  const [modelsLoading, setModelsLoading] = useState(false)

  const validKeyCount = Object.values(keyStatus).filter((s) => s === 'valid').length

  useEffect(() => {
    if (step !== 'models') return
    let cancelled = false
    setModelsLoading(true)

    const validProviders = PROVIDERS.filter(({ name }) => keyStatus[name] === 'valid')
    Promise.all(
      validProviders.map(async ({ name }) => {
        const key = apiKeys[name]
        if (!key) return { name, models: [] as string[] }
        try {
          const list = await window.elrond.listModels(name, key)
          return { name, models: list }
        } catch {
          return { name, models: [] as string[] }
        }
      })
    ).then((results) => {
      if (cancelled) return
      const next: Record<ProviderName, string[]> = { openai: [], anthropic: [], google: [] }
      for (const { name, models: list } of results) {
        next[name] = list
      }
      setAvailableModels(next)
      setModelsLoading(false)
    })

    return () => { cancelled = true }
  }, [step, keyStatus, apiKeys])

  const handleTestKey = useCallback(async (provider: ProviderName) => {
    const key = apiKeys[provider]
    if (!key) return
    setKeyStatus((prev) => ({ ...prev, [provider]: 'testing' }))
    const valid = await window.elrond.testApiKey(provider, key)
    if (valid) {
      await window.elrond.setApiKey(provider, key)
      setKeyStatus((prev) => ({ ...prev, [provider]: 'valid' }))
    } else {
      setKeyStatus((prev) => ({ ...prev, [provider]: 'invalid' }))
    }
  }, [apiKeys])

  const handleFinish = useCallback(async () => {
    for (const [provider, model] of Object.entries(models)) {
      await setSetting(`${provider}_model`, model)
    }
    await setSetting('setupComplete', 'true')
  }, [models, setSetting])

  const handleShortcutKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault()
    const parts: string[] = []
    if (e.metaKey) parts.push('⌘')
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
    }
    if (parts.length > 1) {
      setShortcutDisplay(parts.join(' + '))

      const electronParts: string[] = []
      if (e.metaKey || e.ctrlKey) electronParts.push('CommandOrControl')
      if (e.altKey) electronParts.push('Alt')
      if (e.shiftKey) electronParts.push('Shift')
      if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
        electronParts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
      }

      window.elrond.setGlobalShortcut(electronParts.join('+'))
    }
  }, [])

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 p-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Elrond</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Multi-agent deliberation at your fingertips
          </p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2">
          {(['keys', 'models', 'shortcut'] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                  s === step
                    ? 'bg-primary text-primary-foreground'
                    : i < ['keys', 'models', 'shortcut'].indexOf(step)
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && <div className="h-px w-8 bg-border" />}
            </React.Fragment>
          ))}
        </div>

        {/* Step: API Keys */}
        {step === 'keys' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">API Keys</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter API keys for at least two providers. Keys are stored securely in your macOS Keychain.
            </p>

            {PROVIDERS.map(({ name, label, placeholder }) => (
              <div key={name} className="space-y-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium">{label}</label>
                  {keyStatus[name] === 'valid' && (
                    <Badge variant="secondary" className="h-4 gap-0.5 text-[9px] text-green-400">
                      <Check className="h-2.5 w-2.5" />
                      Valid
                    </Badge>
                  )}
                  {keyStatus[name] === 'invalid' && (
                    <Badge variant="secondary" className="h-4 gap-0.5 text-[9px] text-destructive">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Invalid
                    </Badge>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={apiKeys[name]}
                    onChange={(e) => setApiKeys((prev) => ({ ...prev, [name]: e.target.value }))}
                    placeholder={placeholder}
                    className="h-9 text-xs"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => handleTestKey(name)}
                    disabled={!apiKeys[name] || keyStatus[name] === 'testing'}
                  >
                    {keyStatus[name] === 'testing' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
              </div>
            ))}

            <Button
              className="w-full gap-2"
              disabled={validKeyCount < 2}
              onClick={() => setStep('models')}
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </Button>
            {validKeyCount < 2 && (
              <p className="text-center text-[10px] text-muted-foreground">
                At least 2 valid keys required ({validKeyCount}/2)
              </p>
            )}
          </div>
        )}

        {/* Step: Model Selection */}
        {step === 'models' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Model Selection</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Choose the default model for each provider. You can change these later in Settings.
            </p>

            {modelsLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Fetching available models...
              </div>
            )}

            {PROVIDERS.filter(({ name }) => keyStatus[name] === 'valid').map(({ name, label }) => {
              const list = availableModels[name]
              return (
                <div key={name} className="space-y-1">
                  <label className="text-xs font-medium">{label}</label>
                  {list.length > 0 ? (
                    <Select
                      value={models[name]}
                      onValueChange={(v) => setModels((prev) => ({ ...prev, [name]: v }))}
                    >
                      <SelectTrigger className="h-9 text-xs">
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
                      value={models[name]}
                      onChange={(e) => setModels((prev) => ({ ...prev, [name]: e.target.value }))}
                      className="h-9 text-xs"
                      placeholder="Enter model name"
                    />
                  )}
                </div>
              )
            })}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('keys')}>
                Back
              </Button>
              <Button className="flex-1 gap-2" onClick={() => setStep('shortcut')}>
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step: Keyboard Shortcut */}
        {step === 'shortcut' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Global Shortcut</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Press your preferred key combination to invoke Elrond from anywhere.
            </p>

            <div
              className="flex h-16 items-center justify-center rounded-lg border-2 border-dashed text-lg font-mono focus-within:border-primary"
              tabIndex={0}
              onKeyDown={handleShortcutKeyDown}
            >
              {shortcutDisplay}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep('models')}>
                Back
              </Button>
              <Button className="flex-1 gap-2" onClick={handleFinish}>
                <Sparkles className="h-4 w-4" />
                Start Using Elrond
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
