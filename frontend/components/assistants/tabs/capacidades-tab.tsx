'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { Switch } from '@heroui/react'
import { Sparkles, Server, Plus, Loader2, AlertTriangle } from 'lucide-react'
import { Assistant } from '@/types/assistant'
import { useSkillsStore } from '@/store/useSkillsStore'
import { useMcpServersStore } from '@/store/useMcpServersStore'

interface Props {
  assistant: Assistant
  isReadOnly?: boolean
}

export function CapacidadesTab({ assistant, isReadOnly }: Props) {
  const assistantId = assistant.id
  const skillsStore = useSkillsStore()
  const mcpStore = useMcpServersStore()

  const linkedSkills = skillsStore.linkedByAssistant[assistantId] ?? []
  const linkedServers = mcpStore.linkedByAssistant[assistantId] ?? []
  const linkedSkillIds = new Set(linkedSkills.map((s) => s.id))
  const linkedServerIds = new Set(linkedServers.map((s) => s.id))

  useEffect(() => {
    if (!skillsStore.hasFetched) skillsStore.fetchSkills()
    if (!mcpStore.hasFetched) mcpStore.fetchServers()
    skillsStore.fetchLinkedForAssistant(assistantId)
    mcpStore.fetchLinkedForAssistant(assistantId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantId])

  const toggleSkill = async (skillId: string, next: boolean) => {
    if (next) await skillsStore.linkToAssistant(assistantId, skillId)
    else await skillsStore.unlinkFromAssistant(assistantId, skillId)
  }
  const toggleServer = async (serverId: string, next: boolean) => {
    if (next) await mcpStore.linkToAssistant(assistantId, serverId)
    else await mcpStore.unlinkFromAssistant(assistantId, serverId)
  }

  const noToolSupport =
    assistant.llmProvider === 'deepseek' && assistant.model === 'deepseek-reasoner'

  return (
    <div className="flex flex-col gap-6">
      {noToolSupport && (
        <div
          className="flex items-start gap-3 rounded-xl p-4 border"
          style={{
            background: 'rgba(245, 158, 11, 0.06)',
            borderColor: 'rgba(245, 158, 11, 0.25)',
          }}
        >
          <AlertTriangle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <p
              className="text-yellow-500 text-sm font-semibold"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              Modelo sem suporte a ferramentas
            </p>
            <p className="text-subtle text-xs mt-0.5">
              O modelo <span className="text-body font-medium">deepseek-reasoner</span> não suporta
              chamadas de ferramentas. Skills e servidores MCP vinculados serão ignorados durante
              as conversas.
            </p>
          </div>
        </div>
      )}

      {/* Skills */}
      <div className="glass-card rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3
              className="text-heading text-base font-semibold flex items-center gap-2"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              <Sparkles size={16} className="text-[#ff6b2c]" />
              Skills vinculadas
            </h3>
            <p className="text-subtle text-sm mt-1">
              Capacidades que este assistente pode invocar. A IA decide quando chamar
              com base na descrição de cada skill.
            </p>
          </div>
          <Link
            href="/dashboard/skills"
            className="btn-neu-ghost text-xs shrink-0"
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus size={12} />
              Criar skill
            </span>
          </Link>
        </div>

        {!skillsStore.hasFetched ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-subtle" />
          </div>
        ) : skillsStore.items.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-subtle text-sm">
              Nenhuma skill no workspace ainda.{' '}
              <Link
                href="/dashboard/skills"
                className="text-[#ff6b2c] hover:underline"
              >
                Criar a primeira
              </Link>
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-dim">
            {skillsStore.items.map((skill) => {
              const isLinked = linkedSkillIds.has(skill.id)
              return (
                <div
                  key={skill.id}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-heading text-sm font-medium"
                      style={{
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      }}
                    >
                      {skill.name}
                    </p>
                    <p className="text-subtle text-xs line-clamp-1">
                      {skill.description}
                    </p>
                  </div>
                  <Switch
                    isSelected={isLinked}
                    isDisabled={isReadOnly}
                    onChange={(e: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      const val = typeof e === 'boolean' ? e : e.target.checked
                      toggleSkill(skill.id, val).catch(() => {})
                    }}
                  >
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* MCP Servers */}
      <div className="glass-card rounded-xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3
              className="text-heading text-base font-semibold flex items-center gap-2"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              <Server size={16} className="text-[#ff6b2c]" />
              Servidores MCP vinculados
            </h3>
            <p className="text-subtle text-sm mt-1">
              Tools de servidores MCP externos ficam expostas à IA como{' '}
              <span className="font-mono text-subtle/80">
                &lt;slug&gt;__&lt;tool&gt;
              </span>
              .
            </p>
          </div>
          <Link
            href="/dashboard/mcp-servers"
            className="btn-neu-ghost text-xs shrink-0"
          >
            <span className="inline-flex items-center gap-1.5">
              <Plus size={12} />
              Novo servidor
            </span>
          </Link>
        </div>

        {!mcpStore.hasFetched ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-subtle" />
          </div>
        ) : mcpStore.items.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-subtle text-sm">
              Nenhum servidor MCP no workspace.{' '}
              <Link
                href="/dashboard/mcp-servers"
                className="text-[#ff6b2c] hover:underline"
              >
                Registrar um
              </Link>
            </p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-dim">
            {mcpStore.items.map((srv) => {
              const isLinked = linkedServerIds.has(srv.id)
              return (
                <div
                  key={srv.id}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p
                        className="text-heading text-sm font-medium"
                        style={{
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        }}
                      >
                        {srv.name}
                      </p>
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#ff6b2c]/15 text-[#ff6b2c]"
                        style={{
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        }}
                      >
                        {srv.transport.toUpperCase()}
                      </span>
                      {srv.last_error && (
                        <span
                          title={srv.last_error}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-500/15 text-red-400 border border-red-500/30"
                          style={{
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          }}
                        >
                          <AlertTriangle size={10} />
                          falha
                        </span>
                      )}
                    </div>
                    <p className="text-subtle text-xs font-mono truncate">
                      {srv.url}
                      {srv.tools_count != null && (
                        <span className="ml-2">· {srv.tools_count} tools</span>
                      )}
                    </p>
                  </div>
                  <Switch
                    isSelected={isLinked}
                    isDisabled={isReadOnly}
                    onChange={(e: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      const val = typeof e === 'boolean' ? e : e.target.checked
                      toggleServer(srv.id, val).catch(() => {})
                    }}
                  >
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
