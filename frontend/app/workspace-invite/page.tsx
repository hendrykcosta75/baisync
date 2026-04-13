'use client'

import React, { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { apiFetch } from '@/lib/api'
import { useAuthStore } from '@/store/useAuthStore'
import { Building2, CheckCircle, XCircle } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

function WorkspaceInviteContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')
  const { isAuthenticated } = useAuthStore()

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [workspaceName, setWorkspaceName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setError('Token de convite não encontrado')
      return
    }

    if (!isAuthenticated) {
      router.replace(`/login?redirect=/workspace-invite?token=${token}`)
      return
    }

    acceptInvite()
  }, [token, isAuthenticated])

  const acceptInvite = async () => {
    try {
      const data = await apiFetch<{ workspace: { name: string; id: string }; workspace_id: string }>(
        `/api/workspace-invites/${token}/accept`,
        { method: 'POST' }
      )
      setWorkspaceName(data.workspace.name)
      // Store the accepted workspace as active so dashboard loads it
      if (data.workspace_id) {
        localStorage.setItem('active-workspace-id', data.workspace_id)
        // Clear workspace-specific caches so dashboard fetches fresh data
        localStorage.removeItem('assistant-storage')
        localStorage.removeItem('api-keys-storage')
      }
      setStatus('success')
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Falha ao aceitar convite')
    }
  }

  return (
    <div
      className="max-w-md w-full rounded-2xl border border-dim p-8 text-center"
      style={{ background: '#0a0a0a' }}
    >
      {status === 'loading' && (
        <>
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.15)' }}>
            <Building2 size={24} className="text-indigo-400 animate-pulse" />
          </div>
          <p className="text-white text-lg font-semibold" style={{ fontFamily: mono }}>
            Aceitando convite...
          </p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.15)' }}>
            <CheckCircle size={24} className="text-green-400" />
          </div>
          <p className="text-white text-lg font-semibold mb-2" style={{ fontFamily: mono }}>
            Bem-vindo!
          </p>
          <p className="text-[#888] text-sm mb-6" style={{ fontFamily: mono }}>
            Você agora faz parte do workspace <strong className="text-white">{workspaceName}</strong>
          </p>
          <Button
            onPress={() => router.push('/dashboard')}
            className="bg-[#ff6b2c] text-black font-semibold"
          >
            Ir para o Dashboard
          </Button>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.15)' }}>
            <XCircle size={24} className="text-red-400" />
          </div>
          <p className="text-white text-lg font-semibold mb-2" style={{ fontFamily: mono }}>
            Erro
          </p>
          <p className="text-[#888] text-sm mb-6" style={{ fontFamily: mono }}>
            {error}
          </p>
          <Button
            onPress={() => router.push('/dashboard')}
            variant="ghost"
            className="border-dim text-white"
          >
            Ir para o Dashboard
          </Button>
        </>
      )}
    </div>
  )
}

export default function WorkspaceInvitePage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="text-white text-sm" style={{ fontFamily: mono }}>Carregando...</div>
      }>
        <WorkspaceInviteContent />
      </Suspense>
    </div>
  )
}
