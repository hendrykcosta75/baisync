'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import Script from 'next/script'

interface ChargeInfo {
  id: string
  amount: number
  description: string
  clientSecret: string | null
  preferenceId: string | null
  checkoutUrl: string | null
  status: string
  customerName: string | null
  cardMode: string | null
  publicKey: string | null
  paymentType: string   // "credit" or "debit"
  installments: number  // 1-12
}

export default function PayPage() {
  const params = useParams()
  const chargeId = params?.id as string
  const [charge, setCharge] = useState<ChargeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [paymentError, setPaymentError] = useState('')

  // Map payment error codes to user-friendly messages
  const translatePaymentError = (detail: string): string => {
    const map: Record<string, string> = {
      'cc_rejected_insufficient_amount': 'Saldo insuficiente. Tente outro cartao ou forma de pagamento.',
      'cc_rejected_bad_filled_card_number': 'Numero do cartao incorreto. Verifique e tente novamente.',
      'cc_rejected_bad_filled_date': 'Data de validade incorreta. Verifique e tente novamente.',
      'cc_rejected_bad_filled_security_code': 'Codigo de seguranca incorreto. Verifique e tente novamente.',
      'cc_rejected_bad_filled_other': 'Dados do cartao incorretos. Verifique e tente novamente.',
      'cc_rejected_call_for_authorize': 'Voce precisa autorizar o pagamento junto ao banco do cartao.',
      'cc_rejected_card_disabled': 'Cartao desabilitado. Entre em contato com o banco.',
      'cc_rejected_duplicated_payment': 'Pagamento duplicado. Voce ja realizou esse pagamento.',
      'cc_rejected_high_risk': 'Pagamento recusado por seguranca. Tente outro cartao.',
      'cc_rejected_max_attempts': 'Limite de tentativas atingido. Tente outro cartao.',
      'cc_rejected_other_reason': 'Pagamento recusado pela operadora. Tente outro cartao.',
      'cc_rejected_blacklist': 'Pagamento recusado. Entre em contato com o banco.',
      'cc_rejected_card_type_not_allowed': 'Tipo de cartao nao permitido para esta transacao.',
      'cc_rejected_invalid_installments': 'Numero de parcelas invalido para este cartao.',
      'insufficient_funds': 'Saldo insuficiente.',
      'card_declined': 'Cartao recusado. Tente outro cartao.',
      'expired_card': 'Cartao expirado.',
      'incorrect_cvc': 'Codigo de seguranca incorreto.',
      'processing_error': 'Erro de processamento. Tente novamente.',
      'incorrect_number': 'Numero do cartao incorreto.',
    }
    return map[detail] || 'Pagamento recusado. Verifique os dados e tente novamente.'
  }

  // Refs for SDK instances
  const stripeRef = useRef<any>(null)
  const stripeElementsRef = useRef<any>(null)
  const mpBrickRef = useRef<any>(null)
  const mpContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chargeId) return
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
    fetch(`${apiUrl}/api/pay/${chargeId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Cobranca nao encontrada')
        return res.json()
      })
      .then((data) => { setCharge(data); setLoading(false) })
      .catch((err) => { setError(err.message); setLoading(false) })
  }, [chargeId])

  // Initialize Stripe Elements when data + SDK are ready
  const initStripe = () => {
    if (!charge || charge.cardMode !== 'stripe' || !charge.clientSecret || !charge.publicKey) return
    if (stripeRef.current) return // already initialized
    if (!(window as any).Stripe) return

    const stripe = (window as any).Stripe(charge.publicKey)
    stripeRef.current = stripe

    const elements = stripe.elements({
      clientSecret: charge.clientSecret,
      appearance: {
        theme: 'night',
        variables: { colorPrimary: '#635BFF', fontFamily: 'system-ui, sans-serif' },
      },
    })
    stripeElementsRef.current = elements

    const paymentElement = elements.create('payment')
    paymentElement.mount('#stripe-payment-element')
  }

  // Initialize MP Bricks when data + SDK are ready
  const initMercadoPago = () => {
    if (!charge || charge.cardMode !== 'mercadopago' || !charge.publicKey) return
    if (mpBrickRef.current) return
    if (!(window as any).MercadoPago) return

    const mp = new (window as any).MercadoPago(charge.publicKey, { locale: 'pt-BR' })
    const bricksBuilder = mp.bricks()

    const isDebit = charge.paymentType === 'debit'
    bricksBuilder.create('cardPayment', 'mp-card-payment', {
      initialization: {
        amount: charge.amount,
      },
      customization: {
        visual: {
          style: {
            theme: 'dark',
          },
        },
        paymentMethods: {
          creditCard: isDebit ? 'none' : 'all',
          debitCard: isDebit ? 'all' : 'none',
          maxInstallments: isDebit ? 1 : (charge.installments || 1),
        },
      },
      callbacks: {
        onReady: () => {},
        onSubmit: async (cardFormData: any) => {
          setPaymentStatus('processing')
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
            const resp = await fetch(`${apiUrl}/api/pay/${chargeId}/process`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cardFormData),
            })
            const result = await resp.json()
            if (result.status === 'approved') {
              setPaymentStatus('success')
            } else if (result.status === 'cancelled' || result.status === 'rejected') {
              setPaymentStatus('error')
              setPaymentError(translatePaymentError(result.statusDetail || 'cc_rejected_other_reason'))
            } else if (!resp.ok) {
              setPaymentStatus('error')
              setPaymentError(result.error || 'Falha ao processar pagamento.')
            } else {
              // pending
              setPaymentStatus('error')
              setPaymentError('Pagamento em processamento. Aguarde a confirmacao.')
            }
          } catch {
            setPaymentStatus('error')
            setPaymentError('Falha na conexao. Verifique sua internet e tente novamente.')
          }
        },
        onError: (err: any) => {
          console.error('MP Brick error:', JSON.stringify(err, null, 2))
          // Don't show error for non-critical brick errors (tracking, etc.)
          if (err?.message || err?.cause) {
            setPaymentStatus('error')
            setPaymentError(err?.message || 'Erro no formulario de pagamento.')
          }
        },
      },
    }).then((brick: any) => {
      mpBrickRef.current = brick
    })
  }

  const handleStripeSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripeRef.current || !stripeElementsRef.current) return

    setPaymentStatus('processing')
    const { error: submitError } = await stripeRef.current.confirmPayment({
      elements: stripeElementsRef.current,
      confirmParams: {
        return_url: `${window.location.origin}/pay/success`,
      },
      redirect: 'if_required',
    })

    if (submitError) {
      setPaymentStatus('error')
      const code = submitError.decline_code || submitError.code || ''
      setPaymentError(translatePaymentError(code) || submitError.message || 'Erro ao processar pagamento.')
    } else {
      setPaymentStatus('success')
    }
  }

  const formatBRL = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  // ─── Status screens ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-muted">Carregando...</div>
      </div>
    )
  }

  if (error || !charge) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <h1 className="text-xl font-bold text-foreground">Cobranca nao encontrada</h1>
          <p className="text-muted text-sm">O link de pagamento pode ter expirado ou ser invalido.</p>
        </div>
      </div>
    )
  }

  if (charge.status === 'approved' || paymentStatus === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <h1 className="text-xl font-bold text-foreground">Pagamento confirmado!</h1>
          <p className="text-muted text-sm">Obrigado, {charge.customerName || 'cliente'}. A confirmacao foi enviada na conversa.</p>
        </div>
      </div>
    )
  }

  if (charge.status === 'cancelled') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#eab308" strokeWidth="2" /><path d="M12 8v4M12 16h.01" stroke="#eab308" strokeWidth="2" strokeLinecap="round" /></svg>
          </div>
          <h1 className="text-xl font-bold text-foreground">Pagamento cancelado</h1>
          <p className="text-muted text-sm">Esta cobranca foi cancelada ou expirou.</p>
        </div>
      </div>
    )
  }

  const hasPublicKey = !!charge.publicKey
  const isStripe = charge.cardMode === 'stripe'
  const isMercadoPago = charge.cardMode === 'mercadopago'

  // ─── Payment form ───────────────────────────────────────────────────────

  return (
    <>
      {/* Load Stripe.js */}
      {isStripe && hasPublicKey && (
        <Script
          src="https://js.stripe.com/v3/"
          onReady={initStripe}
        />
      )}
      {/* Load MercadoPago.js */}
      {isMercadoPago && hasPublicKey && (
        <Script
          src="https://sdk.mercadopago.com/js/v2"
          onReady={initMercadoPago}
        />
      )}

      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-lg w-full bg-overlay border border-dim rounded-2xl shadow-xl overflow-hidden">
          {/* Header */}
          <div className="bg-[#635BFF]/10 dark:bg-[#635BFF]/5 px-6 py-5 border-b border-dim">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#635BFF]/20 rounded-lg flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="2" y="5" width="20" height="14" rx="2" stroke="#635BFF" strokeWidth="1.5" />
                  <path d="M2 10h20" stroke="#635BFF" strokeWidth="1.5" />
                  <path d="M6 15h4" stroke="#635BFF" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Pagamento por Cartao</h1>
                <p className="text-xs text-muted">Pagamento seguro via {isMercadoPago ? 'Mercado Pago' : 'Stripe'}</p>
              </div>
            </div>
          </div>

          {/* Charge details */}
          <div className="px-6 py-4 space-y-3 border-b border-dim">
            {charge.customerName && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted">Cliente</span>
                <span className="text-sm font-medium text-foreground">{charge.customerName}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted">Descricao</span>
              <span className="text-sm font-medium text-foreground text-right max-w-[250px]">{charge.description}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted">Forma</span>
              <span className="text-sm font-medium text-foreground">
                {charge.paymentType === 'debit' ? 'Debito' : 'Credito'}
                {charge.paymentType === 'credit' && charge.installments > 1
                  ? ` ${charge.installments}x de ${formatBRL(charge.amount / charge.installments)}`
                  : ' a vista'}
              </span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-base font-semibold text-foreground">Total</span>
              <span className="text-2xl font-bold text-foreground">{formatBRL(charge.amount)}</span>
            </div>
          </div>

          {/* Payment form */}
          <div className="px-6 py-5">
            {!hasPublicKey ? (
              <div className="text-center text-sm text-muted py-4">
                Formulario de pagamento indisponivel. Chave publica nao configurada.
              </div>
            ) : isStripe && charge.clientSecret ? (
              <form onSubmit={handleStripeSubmit}>
                <div id="stripe-payment-element" className="mb-4" />
                {paymentStatus === 'error' && (
                  <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 text-sm">{paymentError}</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={paymentStatus === 'processing'}
                  className="w-full bg-[#635BFF] hover:bg-[#5347E0] disabled:opacity-50 text-white font-semibold py-3 px-4 rounded-xl transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {paymentStatus === 'processing' ? 'Processando...' : paymentStatus === 'error' ? 'Tentar novamente' : `Pagar ${formatBRL(charge.amount)}`}
                </button>
              </form>
            ) : isMercadoPago ? (
              <div>
                <div id="mp-card-payment" ref={mpContainerRef} />
                {paymentStatus === 'processing' && (
                  <p className="text-yellow-400 text-sm mt-3 text-center">Processando pagamento...</p>
                )}
                {paymentStatus === 'error' && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 text-sm text-center">{paymentError}</p>
                    <button
                      type="button"
                      onClick={() => { setPaymentStatus('idle'); setPaymentError('') }}
                      className="w-full mt-2 text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Fallback: redirect to checkout URL */
              charge.checkoutUrl ? (
                <a
                  href={charge.checkoutUrl}
                  className="block w-full text-center bg-[#635BFF] hover:bg-[#5347E0] text-white font-semibold py-3 px-4 rounded-xl transition-colors"
                >
                  Pagar com Cartao
                </a>
              ) : (
                <div className="text-center text-sm text-muted py-4">
                  Link de pagamento indisponivel.
                </div>
              )
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-5">
            <p className="text-center text-[11px] text-muted">
              Seus dados sao processados com seguranca pelo {isMercadoPago ? 'Mercado Pago' : 'Stripe'}. Nenhum dado de cartao passa pelo nosso sistema.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
