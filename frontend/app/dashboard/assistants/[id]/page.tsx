'use client'

import React, { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Tabs, Button } from '@heroui/react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { OverviewTab } from '@/components/assistants/tabs/overview-tab'
import { KnowledgeTab } from '@/components/assistants/tabs/knowledge-tab'
import { ToolsTab } from '@/components/assistants/tabs/tools-tab'
import { ApplicationsTab } from '@/components/assistants/tabs/applications-tab'
import { ConversationsTab } from '@/components/assistants/tabs/conversations-tab'
import { ChatTab } from '@/components/assistants/tabs/chat-tab'
import { LogsTab } from '@/components/assistants/tabs/logs-tab'
import { PageTransition } from '@/lib/motion'

export default function AssistantDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const assistants = useAssistantStore(s => s.assistants)
  const fetchAssistants = useAssistantStore(s => s.fetchAssistants)
  const hasFetched = useAssistantStore(s => s.hasFetched)

  const assistant = assistants.find(a => a.id === id)

  useEffect(() => {
    if (!hasFetched) fetchAssistants()
  }, [hasFetched, fetchAssistants])

  if (!assistant) return null

  return (
    <PageTransition>
      <div className="flex flex-col gap-6 w-full pb-10">
        <div className="flex items-center gap-4 w-full">
          <Button
            variant="ghost"
            onPress={() => router.push('/dashboard/assistants')}
            className="shrink-0 font-medium px-3 text-subtle hover:text-heading border-none bg-transparent"
          >
            ← Voltar
          </Button>
          <div className="flex-1">
            <h1
              className="text-2xl font-light tracking-tight text-foreground"
              style={{ fontFamily: "'Fira Code', 'JetBrains Mono', monospace" }}
            >
              {assistant.name}
            </h1>
            <p className="text-subtle text-sm mt-1">
              Gerencie configuração, conhecimento e ferramentas do assistente.
            </p>
          </div>
        </div>

        <Tabs className="w-full">
          <Tabs.ListContainer
            className="w-full mb-6 overflow-x-auto rounded-2xl p-1"
            style={{
              background: '#0a0a0a',
              border: '1px solid #1e1e1e',
            }}
          >
            <Tabs.List aria-label="Assistant Management Options" className="gap-1 flex min-w-max">
              <Tabs.Tab id="overview">
                Visão Geral
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="knowledge">
                Conhecimento
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="tools">
                Ferramentas
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="applications">
                Integrações
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="conversations">
                Conversas
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="chat">
                Chat
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="logs">
                Logs
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="overview">
            <OverviewTab assistant={assistant} />
          </Tabs.Panel>

          <Tabs.Panel id="knowledge">
            <KnowledgeTab assistant={assistant} />
          </Tabs.Panel>

          <Tabs.Panel id="tools">
            <ToolsTab assistant={assistant} />
          </Tabs.Panel>

          <Tabs.Panel id="applications">
            <ApplicationsTab assistant={assistant} />
          </Tabs.Panel>

          <Tabs.Panel id="conversations">
            <ConversationsTab assistant={assistant} />
          </Tabs.Panel>

          <Tabs.Panel id="chat">
            <ChatTab assistant={assistant} />
          </Tabs.Panel>

          <Tabs.Panel id="logs">
            <LogsTab assistant={assistant} />
          </Tabs.Panel>
        </Tabs>
      </div>
    </PageTransition>
  )
}
