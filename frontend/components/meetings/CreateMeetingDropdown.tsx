'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dropdown } from '@heroui/react'
import { Video, ChevronDown, Calendar, Link as LinkIcon } from 'lucide-react'
import { useMeetingStore } from '@/store/useMeetingStore'
import { ScheduleMeetingModal } from '@/components/meetings/ScheduleMeetingModal'

export function CreateMeetingDropdown() {
  const router = useRouter()
  const { createInstant, schedule } = useMeetingStore()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const handleAction = async (key: React.Key) => {
    if (key === 'instant') {
      setCreating(true)
      try {
        const { meeting } = await createInstant()
        router.push(`/dashboard/meetings/${meeting.code}`)
      } catch (e) {
        console.error('Failed to create instant meeting', e)
      } finally {
        setCreating(false)
      }
    } else if (key === 'later') {
      setCreating(true)
      try {
        const meeting = await schedule({
          title: 'Reunião para depois',
          linkExpiry: '7d',
        })
        await navigator.clipboard.writeText(meeting.shareUrl).catch(() => {})
      } catch (e) {
        console.error('Failed to create meeting link', e)
      } finally {
        setCreating(false)
      }
    } else if (key === 'schedule') {
      setScheduleOpen(true)
    }
  }

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger>
          <div
            role="button"
            tabIndex={0}
            aria-disabled={creating}
            className={`btn-neu inline-flex items-center gap-2 ${creating ? 'opacity-60 pointer-events-none' : ''}`}
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            <Video size={16} />
            Nova reunião
            <ChevronDown size={14} />
          </div>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu aria-label="Nova reunião" onAction={handleAction}>
            <Dropdown.Item id="instant">
              <div className="flex items-center gap-2">
                <Video size={14} />
                <span>Iniciar reunião instantânea</span>
              </div>
            </Dropdown.Item>
            <Dropdown.Item id="later">
              <div className="flex items-center gap-2">
                <LinkIcon size={14} />
                <span>Criar reunião para depois</span>
              </div>
            </Dropdown.Item>
            <Dropdown.Item id="schedule">
              <div className="flex items-center gap-2">
                <Calendar size={14} />
                <span>Agendar no calendário</span>
              </div>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <ScheduleMeetingModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
      />
    </>
  )
}
