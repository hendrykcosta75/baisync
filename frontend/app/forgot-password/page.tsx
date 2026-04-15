'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Input, Button, Label } from '@heroui/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/store/useAuthStore'
import { AuthLayout } from '@/components/auth/auth-layout'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const forgotSchema = z.object({
  email: z.string().email('Endereço de e-mail inválido'),
})

const resetSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'As senhas não coincidem',
  path: ['confirmPassword'],
})

type ForgotFormData = z.infer<typeof forgotSchema>
type ResetFormData = z.infer<typeof resetSchema>

export default function ForgotPasswordPage() {
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [pwFocused, setPwFocused] = useState(false)
  const { forgotPassword, resetPassword, isLoading, error, clearError } = useAuthStore()

  const forgotForm = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
  })

  const resetForm = useForm<ResetFormData>({
    resolver: zodResolver(resetSchema),
  })

  const onSendEmail = async (data: ForgotFormData) => {
    clearError()
    setSuccessMessage(null)
    try {
      const message = await forgotPassword(data.email)
      setSuccessMessage(message)
      setEmailSent(true)
    } catch {
      // error is set in store
    }
  }

  const onResetPassword = async (data: ResetFormData) => {
    clearError()
    try {
      await resetPassword(data.token, data.password)
      setResetSuccess(true)
    } catch {
      // error is set in store
    }
  }

  const toggleVisibility = () => setIsVisible(!isVisible)

  return (
    <AuthLayout
      passwordVisible={isVisible}
      passwordFocused={pwFocused}
      footerContent={
        <Link href="/login" style={{ fontFamily: mono, fontSize: 12, color: '#ff6b2c', fontWeight: 600 }} className="hover:underline">
          Voltar ao login
        </Link>
      }
    >
      <div className="flex flex-col gap-2 mb-8">
        <h1 style={{ fontFamily: mono, fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: -0.5 }}>
          {emailSent ? 'Redefinir sua senha' : 'Esqueceu a senha?'}
        </h1>
        <p style={{ fontFamily: mono, fontSize: 13, color: '#666' }}>
          {emailSent
            ? 'Digite o token do seu e-mail e sua nova senha'
            : 'Digite seu e-mail e enviaremos um código de redefinição'}
        </p>
      </div>

      {!emailSent ? (
        <form onSubmit={forgotForm.handleSubmit(onSendEmail)} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>E-mail</Label>
            <Input
              autoFocus
              placeholder="Digite seu e-mail"
              type="email"
              className="border-[#222] hover:border-[#ff6b2c] focus-within:!border-[#ff6b2c] transition-colors shadow-sm"
              {...forgotForm.register('email')}
            />
            {forgotForm.formState.errors.email && (
              <p className="text-xs text-red-500">{forgotForm.formState.errors.email.message}</p>
            )}
          </div>

          <Button
            type="submit"
            isDisabled={isLoading}
            className="mt-2 font-semibold text-base border-none shadow-xl w-full"
            style={{ background: '#ff6b2c', color: '#000', fontFamily: mono, fontWeight: 700, letterSpacing: 0.5 }}
          >
            {isLoading ? 'Enviando...' : 'Enviar código de redefinição'}
          </Button>
        </form>
      ) : resetSuccess ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>
            Senha redefinida com sucesso!
          </div>
          <Link
            href="/login"
            className="mt-2 text-center w-full rounded-xl py-2.5 block"
            style={{ background: '#ff6b2c', color: '#000', fontFamily: mono, fontSize: 14, fontWeight: 700 }}
          >
            Ir para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={resetForm.handleSubmit(onResetPassword)} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
              {error}
            </div>
          )}

          {successMessage && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}>
              {successMessage}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Token de Redefinição</Label>
            <Input
              autoFocus
              placeholder="Cole o token recebido no seu e-mail"
              className="border-[#222] hover:border-[#ff6b2c] focus-within:!border-[#ff6b2c] transition-colors shadow-sm"
              {...resetForm.register('token')}
            />
            {resetForm.formState.errors.token && (
              <p className="text-xs text-red-500">{resetForm.formState.errors.token.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Nova Senha</Label>
            <div className="relative">
              <Input
                placeholder="Digite a nova senha"
                type={isVisible ? "text" : "password"}
                className="border-[#222] hover:border-[#ff6b2c] focus-within:!border-[#ff6b2c] transition-colors shadow-sm w-full pr-10"
                {...resetForm.register('password')}
                onFocus={() => setPwFocused(true)}
                onBlur={(e) => { setPwFocused(false); resetForm.register('password').onBlur(e) }}
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
            {resetForm.formState.errors.password && (
              <p className="text-xs text-red-500">{resetForm.formState.errors.password.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Confirmar Nova Senha</Label>
            <Input
              placeholder="Confirme a nova senha"
              type={isVisible ? "text" : "password"}
              className="border-[#222] hover:border-[#ff6b2c] focus-within:!border-[#ff6b2c] transition-colors shadow-sm"
              {...resetForm.register('confirmPassword')}
              onFocus={() => setPwFocused(true)}
              onBlur={(e) => { setPwFocused(false); resetForm.register('confirmPassword').onBlur(e) }}
            />
            {resetForm.formState.errors.confirmPassword && (
              <p className="text-xs text-red-500">{resetForm.formState.errors.confirmPassword.message}</p>
            )}
          </div>

          <Button
            type="submit"
            isDisabled={isLoading}
            className="mt-2 font-semibold text-base border-none shadow-xl w-full"
            style={{ background: '#ff6b2c', color: '#000', fontFamily: mono, fontWeight: 700, letterSpacing: 0.5 }}
          >
            {isLoading ? 'Redefinindo...' : 'Redefinir senha'}
          </Button>

          <button
            type="button"
            className="text-center hover:underline"
            style={{ fontFamily: mono, fontSize: 12, color: '#ff6b2c', fontWeight: 600 }}
            onClick={() => { setEmailSent(false); clearError(); setSuccessMessage(null) }}
          >
            Reenviar código
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
