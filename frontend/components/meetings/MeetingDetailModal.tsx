'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, Button } from '@heroui/react'
import { Copy, CheckCheck, Video } from 'lucide-react'
import type { Meeting } from '@/types/meeting'

interface Props {
  isOpen: boolean
  meeting: Meeting | null
  onClose: () => void
}

export function MeetingDetailModal({ isOpen, meeting, onClose }: Props) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)

  if (!meeting) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meeting.shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open: boolean) => {
          if (!open) onClose()
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px] w-full bg-overlay p-5 rounded-2xl shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-[#ff6b2c]/10 text-[#ff6b2c] flex items-center justify-center">
                <Video size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground truncate">
                  {meeting.title || 'Reunião'}
                </h3>
                <p className="text-xs text-subtle font-mono">{meeting.code}</p>
              </div>
            </div>

            {meeting.scheduledStart && (
              <p className="text-sm text-subtle">
                Agendada para{' '}
                {new Date(meeting.scheduledStart).toLocaleString('pt-BR', {
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </p>
            )}

            <div className="flex items-center gap-2 p-2 rounded-lg bg-[#0a0a0a] border border-[#1f1f1f]">
              <span className="flex-1 text-xs text-subtle truncate">{meeting.shareUrl}</span>
              <Button variant="ghost" size="sm" onPress={copy} className="text-[#ff6b2c]">
                {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
              </Button>
            </div>

            <div className="flex items-center justify-end gap-2 mt-2">
              <Button variant="ghost" onPress={onClose}>
                Fechar
              </Button>
              {meeting.status !== 'ended' && (
                <Button
                  onPress={() => router.push(`/dashboard/meetings/${meeting.code}`)}
                  className="bg-[#ff6b2c] hover:bg-[#ff8533] text-white"
                >
                  Entrar agora
                </Button>
              )}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
