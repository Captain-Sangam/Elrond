import React, { useEffect, useState } from 'react'
import { useAgentsStore } from '@renderer/stores/agentsStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui/tabs'
import { ProvidersTab } from './ProvidersTab'
import { AssignmentsTab } from './AssignmentsTab'
import type { ProviderName } from '@shared/types'

interface AgentsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings?: () => void
}

export type CloudProvider = Exclude<ProviderName, 'ollama'>

export const CLOUD_PROVIDER_LIST: CloudProvider[] = ['openai', 'anthropic', 'google']

export function AgentsDialog({ open, onOpenChange, onOpenSettings }: AgentsDialogProps): React.JSX.Element {
  const { ollamaModels, testOllama } = useAgentsStore()
  const [activeTab, setActiveTab] = useState('assignments')
  const [keyPresence, setKeyPresence] = useState<Record<CloudProvider, boolean>>({
    openai: false,
    anthropic: false,
    google: false
  })
  const [cloudModels, setCloudModels] = useState<Record<CloudProvider, string[]>>({
    openai: [],
    anthropic: [],
    google: []
  })

  useEffect(() => {
    if (!open) return
    CLOUD_PROVIDER_LIST.forEach(async (name) => {
      const key = await window.elrond.getApiKey(name)
      setKeyPresence((prev) => ({ ...prev, [name]: Boolean(key) }))
      if (key) {
        try {
          const models = await window.elrond.listModels(name, key)
          setCloudModels((prev) => ({ ...prev, [name]: models }))
        } catch {
          // keep empty — the model field falls back to free text
        }
      }
    })
    testOllama()
  }, [open, testOllama])

  const availableModels: Record<ProviderName, string[]> = {
    ...cloudModels,
    ollama: ollamaModels
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agents</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="pt-2">
          <TabsList>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
            <TabsTrigger value="providers">Providers</TabsTrigger>
          </TabsList>

          <TabsContent value="assignments" className="pt-4">
            <AssignmentsTab keyPresence={keyPresence} availableModels={availableModels} />
          </TabsContent>

          <TabsContent value="providers" className="pt-4">
            <ProvidersTab
              keyPresence={keyPresence}
              cloudModels={cloudModels}
              onOpenSettings={onOpenSettings}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
