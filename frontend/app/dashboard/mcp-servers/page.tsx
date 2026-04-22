'use client'

import React, { useEffect, useState } from 'react'
import { Modal } from '@heroui/react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  PlugZap,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react'
import { useMcpServersStore } from '@/store/useMcpServersStore'
import type {
  CreateMcpServerInput,
  McpServerSummary,
  McpTransport,
} from '@/types/mcp-server'

const serverSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório.').max(100),
  url: z
    .string()
    .url('URL inválida.')
    .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
      message: 'Use http:// ou https://',
    }),
  transport: z.enum(['http', 'sse']),
  auth_header_name: z.string().optional(),
  auth_header_value: z.string().optional(),
})
type ServerFormData = z.infer<typeof serverSchema>

function ServerForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: Partial<ServerFormData & { hasAuthHeader?: boolean }>
  onSubmit: (data: CreateMcpServerInput) => Promise<void>
  onCancel: () => void
  submitLabel: string
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ServerFormData>({
    resolver: zodResolver(serverSchema),
    defaultValues: {
      name: initial?.name ?? '',
      url: initial?.url ?? '',
      transport: (initial?.transport as McpTransport) ?? 'http',
      auth_header_name: initial?.auth_header_name ?? '',
      auth_header_value: '',
    },
  })

  const onSave = async (data: ServerFormData) => {
    setSaving(true)
    setError(null)
    try {
      const headerName = data.auth_header_name?.trim() || null
      const headerValue = data.auth_header_value?.trim() || null
      await onSubmit({
        name: data.name.trim(),
        url: data.url.trim(),
        transport: data.transport,
        auth_header_name: headerName,
        auth_header_value: headerValue,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
      <div>
        <label
          className="text-subtle text-xs font-medium mb-1.5 block"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          Nome
        </label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              placeholder="Ex: Jira"
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
            />
          )}
        />
        {errors.name && (
          <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label
          className="text-subtle text-xs font-medium mb-1.5 block"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          URL do servidor MCP
        </label>
        <Controller
          name="url"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              placeholder="https://mcp.example.com/endpoint"
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full font-mono"
            />
          )}
        />
        {errors.url && (
          <p className="text-red-400 text-xs mt-1">{errors.url.message}</p>
        )}
        <p className="text-subtle text-xs mt-1">
          URLs internas (localhost, IPs privados, serviços do docker) são bloqueadas
          por segurança.
        </p>
      </div>

      <div>
        <label
          className="text-subtle text-xs font-medium mb-1.5 block"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          Transporte
        </label>
        <Controller
          name="transport"
          control={control}
          render={({ field }) => (
            <div className="flex gap-2">
              {(['http', 'sse'] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => field.onChange(t)}
                  className={`flex-1 px-3 py-2 rounded-[10px] border text-sm transition-colors ${
                    field.value === t
                      ? 'border-[#ff6b2c]/50 bg-[#ff6b2c]/10 text-[#ff6b2c]'
                      : 'border-dim bg-raised text-subtle hover:text-heading'
                  }`}
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                >
                  {t === 'http' ? 'HTTP streamable' : 'SSE (legacy)'}
                </button>
              ))}
            </div>
          )}
        />
        <p className="text-subtle text-xs mt-1">
          HTTP streamable é o padrão moderno (MCP 2025-03-26). SSE ainda em
          desenvolvimento.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            className="text-subtle text-xs font-medium mb-1.5 block"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Header de auth (opcional)
          </label>
          <Controller
            name="auth_header_name"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                placeholder="Authorization"
                className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
              />
            )}
          />
        </div>
        <div>
          <label
            className="text-subtle text-xs font-medium mb-1.5 block"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Valor do header (criptografado)
          </label>
          <Controller
            name="auth_header_value"
            control={control}
            render={({ field }) => (
              <input
                {...field}
                type="password"
                placeholder={
                  initial?.hasAuthHeader ? '••••••••  (deixe vazio para manter)' : 'Bearer ...'
                }
                autoComplete="new-password"
                className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full font-mono"
              />
            )}
          />
        </div>
      </div>

      {error && (
        <div
          className="p-3 rounded-[10px]"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-neu-ghost text-sm"
          disabled={saving}
        >
          Cancelar
        </button>
        <button type="submit" className="btn-neu text-sm" disabled={saving}>
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Salvando...
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  )
}

function ServerCard({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServerSummary
  onEdit: () => void
  onDelete: () => void
}) {
  const { testConnection, refreshTools } = useMcpServersStore()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(
    null
  )
  const [refreshing, setRefreshing] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testConnection(server.id)
      if (r.ok) {
        setTestResult({ ok: true, msg: `${r.tools_count ?? 0} tools descobertas` })
      } else {
        setTestResult({ ok: false, msg: r.error ?? 'Falha ao conectar' })
      }
    } catch (e) {
      setTestResult({
        ok: false,
        msg: e instanceof Error ? e.message : 'Erro ao testar',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshTools(server.id)
    } catch (e) {
      console.error(e)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="glass-card rounded-xl p-5 transition-all duration-300 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center shrink-0">
            <Server size={18} className="text-[#ff6b2c]" />
          </div>
          <div className="min-w-0">
            <h3
              className="text-heading text-sm font-semibold truncate"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              {server.name}
            </h3>
            <p className="text-subtle text-[11px] truncate font-mono">{server.url}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            aria-label="Editar"
            onClick={onEdit}
            className="w-8 h-8 rounded-[8px] flex items-center justify-center text-subtle hover:text-heading hover:bg-dim/50 transition-colors"
          >
            <Pencil size={14} />
          </button>
          <button
            aria-label="Deletar"
            onClick={onDelete}
            className="w-8 h-8 rounded-[8px] flex items-center justify-center text-subtle hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span
          className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-[#ff6b2c]/15 text-[#ff6b2c] border border-[#ff6b2c]/30"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          {server.transport.toUpperCase()}
        </span>
        {server.has_auth_header && (
          <span className="text-subtle text-[11px]">🔒 auth</span>
        )}
        <span className="text-subtle text-[11px]">
          {server.tools_count != null
            ? `${server.tools_count} tools cache`
            : 'sem cache'}
        </span>
      </div>

      {server.last_error && (
        <div
          className="p-2 rounded-[8px] mb-3 flex items-start gap-2"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-red-400 text-[11px] font-medium">Última falha</p>
            <p className="text-red-400/90 text-[11px] break-all line-clamp-3">
              {server.last_error}
            </p>
          </div>
        </div>
      )}

      {testResult && (
        <div
          className="p-2 rounded-[8px] mb-3 flex items-center gap-2"
          style={{
            background: testResult.ok
              ? 'rgba(34,197,94,0.08)'
              : 'rgba(239,68,68,0.08)',
            border: testResult.ok
              ? '1px solid rgba(34,197,94,0.3)'
              : '1px solid rgba(239,68,68,0.3)',
          }}
        >
          {testResult.ok ? (
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
          ) : (
            <XCircle size={14} className="text-red-400 shrink-0" />
          )}
          <p
            className={`text-xs ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}
          >
            {testResult.msg}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="btn-neu-ghost text-xs flex-1"
        >
          <span className="inline-flex items-center gap-1.5">
            {testing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <PlugZap size={12} />
            )}
            Testar
          </span>
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="btn-neu-ghost text-xs flex-1"
        >
          <span className="inline-flex items-center gap-1.5">
            {refreshing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Atualizar tools
          </span>
        </button>
      </div>
    </div>
  )
}

export default function McpServersPage() {
  const { items, hasFetched, fetchServers, createServer, updateServer, deleteServer } =
    useMcpServersStore()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<McpServerSummary | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<McpServerSummary | null>(null)

  useEffect(() => {
    if (!hasFetched) {
      fetchServers()
    }
  }, [hasFetched, fetchServers])

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-heading text-xl font-bold"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Servidores MCP
          </h1>
          <p className="text-subtle text-sm mt-1">
            Registre servidores Model Context Protocol externos — tools descobertas via{' '}
            <span className="font-mono">tools/list</span> ficam disponíveis para os
            assistentes que você vincular.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-neu text-sm">
          <span className="inline-flex items-center gap-2">
            <Plus size={14} />
            Novo servidor
          </span>
        </button>
      </div>

      {!hasFetched ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-subtle" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-raised flex items-center justify-center mb-4">
            <Server size={24} className="text-subtle" />
          </div>
          <h3
            className="text-heading text-base font-semibold mb-1"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Nenhum servidor registrado
          </h3>
          <p className="text-subtle text-sm max-w-md mb-4">
            Adicione um endpoint MCP para expor tools externas ao tool loop dos
            assistentes.
          </p>
          <button onClick={() => setCreating(true)} className="btn-neu text-sm">
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              Adicionar primeiro servidor
            </span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {items.map((srv, i) => (
            <div
              key={srv.id}
              className="animate-fade-in-up opacity-0"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
            >
              <ServerCard
                server={srv}
                onEdit={() => setEditing(srv)}
                onDelete={() => setConfirmDelete(srv)}
              />
            </div>
          ))}
        </div>
      )}

      <Modal>
        <Modal.Backdrop isOpen={creating} onOpenChange={(v) => !v && setCreating(false)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px] w-full max-h-[90vh] overflow-y-auto p-6">
              <Modal.Header className="flex items-center justify-between mb-4">
                <Modal.Heading
                  className="text-heading text-[15px] font-bold"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                >
                  Novo servidor MCP
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <ServerForm
                  submitLabel="Criar servidor"
                  onCancel={() => setCreating(false)}
                  onSubmit={async (data) => {
                    await createServer(data)
                    setCreating(false)
                  }}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal>
        <Modal.Backdrop isOpen={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px] w-full max-h-[90vh] overflow-y-auto p-6">
              <Modal.Header className="flex items-center justify-between mb-4">
                <Modal.Heading
                  className="text-heading text-[15px] font-bold"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                >
                  Editar servidor MCP
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {editing && (
                  <ServerForm
                    initial={{
                      name: editing.name,
                      url: editing.url,
                      transport: editing.transport,
                      auth_header_name: editing.auth_header_name ?? '',
                      hasAuthHeader: editing.has_auth_header,
                    }}
                    submitLabel="Salvar alterações"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (data) => {
                      const patch: Partial<CreateMcpServerInput> & {
                        auth_header_value?: string | null
                      } = {
                        name: data.name,
                        url: data.url,
                        transport: data.transport,
                        auth_header_name: data.auth_header_name,
                      }
                      if (data.auth_header_value && data.auth_header_value.trim()) {
                        patch.auth_header_value = data.auth_header_value
                      }
                      await updateServer(editing.id, patch)
                      setEditing(null)
                    }}
                  />
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal>
        <Modal.Backdrop
          isOpen={!!confirmDelete}
          onOpenChange={(v) => !v && setConfirmDelete(null)}
        >
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[400px] w-full p-6">
              <Modal.Header className="flex items-center justify-between mb-4">
                <Modal.Heading
                  className="text-heading text-[15px] font-bold"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                >
                  Deletar servidor?
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {confirmDelete && (
                  <>
                    <p className="text-body text-sm mb-6">
                      <span className="text-heading font-semibold">
                        {confirmDelete.name}
                      </span>{' '}
                      será removido e desvinculado de todos os assistentes. As tools
                      não estarão mais acessíveis.
                    </p>
                    <div className="flex justify-end gap-3">
                      <button
                        className="btn-neu-ghost text-sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn-neu text-sm !text-red-400 hover:!text-red-300"
                        onClick={async () => {
                          await deleteServer(confirmDelete.id)
                          setConfirmDelete(null)
                        }}
                      >
                        Deletar
                      </button>
                    </div>
                  </>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
