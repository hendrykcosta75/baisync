'use client'

export function BaisyncLogo({ size = 28 }: { size?: number }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/Logo (7).png"
      alt="Baisync"
      width={size}
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}
