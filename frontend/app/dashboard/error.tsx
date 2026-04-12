'use client'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <p className="text-sm text-subtle">Algo deu errado.</p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
        style={{ background: '#ff6b2c', color: '#fff' }}
      >
        Tentar novamente
      </button>
    </div>
  )
}
