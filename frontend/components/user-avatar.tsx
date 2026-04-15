'use client'

import React, { useState } from 'react'

/**
 * Renders a user's avatar image if available, otherwise shows initials.
 * Always attempts to load the avatar for any user with an ID.
 * Falls back to initials on load error (no avatar uploaded).
 */
export function UserAvatar({
  userId,
  name,
  size = 32,
  className = '',
}: {
  userId?: string
  name?: string | null
  size?: number
  className?: string
}) {
  const [imgFailed, setImgFailed] = useState(false)

  const initials = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?'

  const fontSize = Math.max(8, Math.round(size * 0.35))
  const canLoadAvatar = !!userId && !imgFailed

  return (
    <div
      className={`rounded-full overflow-hidden flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: '#1e1e1e',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {canLoadAvatar ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/users/${userId}/avatar`}
          alt=""
          className="w-full h-full object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <span
          className="font-bold"
          style={{ fontSize, color: 'rgba(255,255,255,0.4)' }}
        >
          {initials}
        </span>
      )}
    </div>
  )
}
