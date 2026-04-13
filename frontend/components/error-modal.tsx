'use client'

import { Modal, Button } from '@heroui/react'
import { AlertTriangle } from 'lucide-react'
import { useErrorStore } from '@/store/useErrorStore'

export function ErrorModal() {
  const { isOpen, title, message, close } = useErrorStore()

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open: boolean) => { if (!open) close() }}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[400px] w-full bg-overlay p-6 rounded-2xl shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-red-500/10">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-heading">{title}</h3>
            </div>
            <p className="text-sm text-body">{message}</p>
            <div className="flex justify-end pt-2">
              <button type="button" className="btn-neu text-sm !text-red-400 hover:!text-red-300" onClick={close}>
                Fechar
              </button>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
