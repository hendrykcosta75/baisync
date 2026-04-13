'use client'

import React, { useEffect, useCallback, useState } from 'react'
import { Button, Dropdown, Modal } from '@heroui/react'
import { useNotificationStore } from '@/store/useNotificationStore'
import type { Notification } from '@/types/notification'

export function NotificationBell() {
  const { notifications, unreadCount, fetch, markRead, markAllRead, deleteOne, deleteAll } = useNotificationStore()
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const refresh = useCallback(() => {
    fetch()
  }, [fetch])

  // Fetch on mount + listen for SSE notification events
  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener('sse:notification_created', handler)
    // Fallback polling every 60s in case SSE drops
    const interval = setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('sse:notification_created', handler)
      clearInterval(interval)
    }
  }, [refresh])

  const handleNotificationClick = (n: Notification) => {
    if (!n.is_read) markRead(n.id)
    setDropdownOpen(false)
    // Small delay to let dropdown close before opening modal
    setTimeout(() => setSelectedNotification(n), 150)
  }

  return (
    <>
    <Dropdown isOpen={dropdownOpen} onOpenChange={setDropdownOpen}>
      <Dropdown.Trigger>
        <div role="button" tabIndex={0} className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-subtle hover:bg-raised/80 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-[#ff6b2c]/40 focus-visible:outline-none" aria-label="Notificações">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </Dropdown.Trigger>

      <Dropdown.Popover className="w-[calc(100vw-2rem)] sm:w-80 max-h-[420px] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-dim">
          <span className="font-semibold text-sm text-foreground">Notificações</span>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                className="text-xs text-accent hover:underline"
                onClick={() => markAllRead()}
              >
                Marcar lidas
              </button>
            )}
            {notifications.length > 0 && (
              <button
                className="text-xs text-muted hover:text-red-500 transition-colors"
                onClick={() => deleteAll()}
                aria-label="Remover todas"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              Nenhuma notificação
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`group flex items-start gap-2 px-4 py-3 border-b border-dim last:border-b-0 hover:bg-raised transition-colors ${!n.is_read ? 'bg-accent/5' : ''}`}
              >
                <div
                  className="flex items-start gap-2 flex-1 min-w-0 cursor-pointer"
                  onClick={() => handleNotificationClick(n)}
                >
                  <span className={`mt-1.5 flex-shrink-0 w-2 h-2 rounded-full ${!n.is_read ? 'bg-red-500' : ''}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                    <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.message}</p>
                    <p className="text-[10px] text-subtle mt-1">
                      {new Date(n.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5 p-1 rounded text-muted hover:text-red-500"
                  onClick={() => deleteOne(n.id)}
                  aria-label="Remover notificação"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      </Dropdown.Popover>
    </Dropdown>

    {/* Notification detail modal */}
    <Modal isOpen={!!selectedNotification} onOpenChange={(open) => { if (!open) setSelectedNotification(null) }}>
      <Modal.Backdrop variant="blur">
        <Modal.Container placement="center">
          <Modal.Dialog className="sm:max-w-[480px]">
            {selectedNotification && (
              <>
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>{selectedNotification.title}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <div className="space-y-3">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{selectedNotification.message}</p>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      </svg>
                      <span>
                        {new Date(selectedNotification.created_at).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {selectedNotification.notification_type && (
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
                        </svg>
                        <span>
                          {selectedNotification.notification_type === 'human_agent_request'
                            ? 'Solicitação de agente humano'
                            : selectedNotification.notification_type === 'connection_lost'
                            ? 'Conexão perdida'
                            : selectedNotification.notification_type}
                        </span>
                      </div>
                    )}
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" slot="close">
                    Fechar
                  </Button>
                  <Button
                    variant="danger"
                    onPress={() => {
                      deleteOne(selectedNotification.id)
                      setSelectedNotification(null)
                    }}
                  >
                    Excluir
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
    </>
  )
}
