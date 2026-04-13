'use client'

import React, { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Input, Button, Label } from '@heroui/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/store/useAuthStore'
import { AuthLayout } from '@/components/auth/auth-layout'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const resetSchema = z.object({
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'As senhas não coincidem',
  path: ['confirmPassword'],
})

type ResetFormData = z.infer<typeof resetSchema>

function ResetPasswordForm() {
  const [isVisible, setIsVisible] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const { resetPassword, isLoading, error, clearError } = useAuthStore()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  })

  const toggleVisibility = () => setIsVisible(!isVisible)

  const onSubmit = async (data: ResetFormData) => {
    clearError()
    setSuccessMessage(null)
    try {
      const message = await resetPassword(token, data.password)
      setSuccessMessage(message)
    } catch {
      // error is set in store
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2 mb-8">
        <h1 style={{ fontFamily: mono, fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>
          Redefinir senha
        </h1>
        <p style={{ fontFamily: mono, fontSize: 13, color: '#666' }}>
          Digite sua nova senha abaixo
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        {error && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
            {error}
          </div>
        )}

        {successMessage && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>
            {successMessage}
            <Link href="/login" className="block mt-2 hover:underline" style={{ color: '#ff6b2c', fontWeight: 600 }}>
              Ir para o login
            </Link>
          </div>
        )}

        {!token && (
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308' }}>
            Token de redefinição ausente. Use o link enviado no seu e-mail.
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Nova Senha</Label>
          <div className="relative">
            <Input
              autoFocus
              placeholder="Digite a nova senha"
              type={isVisible ? "text" : "password"}
              className="border-[#222] hover:border-[#ff6b2c] focus-within:!border-[#ff6b2c] transition-colors shadow-sm w-full pr-10"
              {...register('password')}
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 focus:outline-none text-[#555] hover:text-[#ff6b2c]" type="button" onClick={toggleVisibility}>
              {isVisible ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-red-500">{errors.password.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Confirmar Nova Senha</Label>
          <Input
            placeholder="Confirme a nova senha"
            type={isVisible ? "text" : "password"}
            className="border-[#222] hover:border-[#ff6b2c] focus-within:!border-[#ff6b2c] transition-colors shadow-sm"
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-red-500">{errors.confirmPassword.message}</p>
          )}
        </div>

        <Button
          type="submit"
          isDisabled={isLoading || !token}
          className="mt-2 font-semibold text-base border-none shadow-xl w-full"
          style={{ background: '#ff6b2c', color: '#000', fontFamily: mono, fontWeight: 700, letterSpacing: 0.5 }}
        >
          {isLoading ? 'Redefinindo...' : 'Redefinir senha'}
        </Button>
      </form>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout
      footerContent={
        <Link href="/login" style={{ fontFamily: mono, fontSize: 12, color: '#ff6b2c', fontWeight: 600 }} className="hover:underline">
          Voltar ao login
        </Link>
      }
    >
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  )
}
