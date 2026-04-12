'use client'

import React from 'react'
import { Button, Input } from '@heroui/react'

export interface KeyValuePair {
  key: string
  value: string
}

interface KeyValueEditorProps {
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  disabled?: boolean
}

export function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = 'Chave',
  valuePlaceholder = 'Valor',
  disabled = false,
}: KeyValueEditorProps) {
  const addPair = () => {
    onChange([...pairs, { key: '', value: '' }])
  }

  const removePair = (index: number) => {
    onChange(pairs.filter((_, i) => i !== index))
  }

  const updatePair = (index: number, field: 'key' | 'value', val: string) => {
    const updated = pairs.map((p, i) =>
      i === index ? { ...p, [field]: val } : p
    )
    onChange(updated)
  }

  return (
    <div className="flex flex-col gap-2">
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="flex-1"
            placeholder={keyPlaceholder}
            value={pair.key}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updatePair(index, 'key', e.target.value)}
            disabled={disabled}
          />
          <Input
            className="flex-1"
            placeholder={valuePlaceholder}
            value={pair.value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updatePair(index, 'value', e.target.value)}
            disabled={disabled}
          />
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-red-400 hover:text-red-500 hover:bg-red-900/20 px-2"
            onPress={() => removePair(index)}
            isDisabled={disabled}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-sm text-muted hover:text-foreground"
        onPress={addPair}
        isDisabled={disabled}
      >
        + Adicionar Linha
      </Button>
    </div>
  )
}
