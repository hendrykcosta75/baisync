'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

const CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/

export function JoinByCodeInput() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim().toLowerCase()
    if (!CODE_REGEX.test(trimmed)) {
      setError('Código inválido. Use o formato xxx-yyyy-zzz.')
      return
    }
    setError(null)
    router.push(`/dashboard/meetings/${trimmed}`)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Digite o código (ex: abc-defg-hij)"
          className="flex-1 bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm
                     placeholder:text-subtle/50
                     focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20
                     transition-all duration-200 outline-none"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        />
        <button type="submit" className="btn-neu inline-flex items-center gap-2">
          <ArrowRight size={14} />
          Entrar
        </button>
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </form>
  )
}
