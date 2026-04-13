'use client'

import React, { Children, cloneElement, isValidElement } from 'react'

// Page transition wrapper — pure CSS animation (no framer-motion)
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`animate-page-in ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

// Staggered list container — applies incremental animation-delay to each child
export function StaggerContainer({
  children,
  className,
  delay = 0,
  style,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  style?: React.CSSProperties
}) {
  const items = Children.toArray(children)
  return (
    <div className={className} style={style}>
      {items.map((child, i) => {
        if (!isValidElement(child)) return child
        const existing = (child.props as { style?: React.CSSProperties }).style ?? {}
        return cloneElement(child as React.ReactElement<{ style?: React.CSSProperties }>, {
          style: {
            ...existing,
            '--stagger-delay': `${delay + i * 0.06}s`,
          } as React.CSSProperties,
        })
      })}
    </div>
  )
}

// Individual stagger item — uses parent-injected --stagger-delay
export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`animate-stagger-item opacity-0 ${className ?? ''}`}
      style={{ animationDelay: 'var(--stagger-delay, 0s)' } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
