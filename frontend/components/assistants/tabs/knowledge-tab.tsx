'use client'

import React, { useState, useEffect } from 'react'
import { Assistant, AssistantFile } from '@/types/assistant'
import { Card, Button } from '@heroui/react'
import { FileText, Folder } from 'lucide-react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { apiFetch } from '@/lib/api'
import { v4 as uuidv4 } from 'uuid'

interface KnowledgeTabProps {
  assistant: Assistant
  shareToken?: string
  isReadOnly?: boolean
}

export function KnowledgeTab({ assistant, shareToken, isReadOnly }: KnowledgeTabProps) {
  const { addFileToAssistant, removeFileFromAssistant, fetchAssistantFiles } = useAssistantStore()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharedFiles, setSharedFiles] = useState<AssistantFile[]>([])

  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''
  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  useEffect(() => {
    if (shareToken) {
      apiFetch<{ id: string; name: string; size: number; type: string; uploadedAt: string }[]>(
        `/api/assistants/${assistant.id}/files${qs}`
      )
        .then(data => setSharedFiles(data.map(f => ({
          id: f.id, name: f.name, size: f.size, type: f.type, uploadedAt: f.uploadedAt,
        }))))
        .catch(() => {})
    } else {
      fetchAssistantFiles(assistant.id)
    }
  }, [assistant.id, shareToken, qs, fetchAssistantFiles])

  const files = shareToken ? sharedFiles : (assistant.files || [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const file = fileList[0]

    if (file.size > MAX_FILE_SIZE) {
      setError(`File "${file.name}" excede o limite de 10MB (${formatSize(file.size)}).`)
      e.target.value = ''
      return
    }

    setError(null)
    setIsUploading(true)

    if (shareToken) {
      // Direct API call for shared access
      try {
        const formData = new FormData()
        formData.append('file', file)
        const resp = await fetch(`/api/assistants/${assistant.id}/files${qs}`, {
          method: 'POST', credentials: 'same-origin', body: formData,
        })
        if (resp.ok) {
          const data = await resp.json()
          const sf = data.file as { id: string; name: string; size: number; type: string; uploadedAt: string }
          setSharedFiles(prev => [...prev, { id: sf.id, name: sf.name, size: sf.size, type: sf.type, uploadedAt: sf.uploadedAt }])
        }
      } catch (err) {
        console.error('File upload failed:', err)
      }
    } else {
      const fileData = {
        id: uuidv4(),
        name: file.name,
        size: file.size,
        type: file.type || 'unknown',
        uploadedAt: new Date().toISOString(),
      }
      await addFileToAssistant(assistant.id, fileData, file)
    }

    setIsUploading(false)
    e.target.value = ''
  }

  const handleRemoveFile = async (fileId: string) => {
    if (shareToken) {
      try {
        await apiFetch(`/api/assistants/${assistant.id}/files/${fileId}${qs}`, { method: 'DELETE' })
        setSharedFiles(prev => prev.filter(f => f.id !== fileId))
      } catch (err) {
        console.error('Failed to delete file:', err)
      }
    } else {
      removeFileFromAssistant(assistant.id, fileId)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <div className="flex flex-col gap-6">
      {!isReadOnly && (
        <Card className="p-6 border border-dashed border-dim-hover bg-raised/50 w-full flex flex-col items-center justify-center min-h-[200px] gap-4">
          <div className="w-12 h-12 bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10 text-[#ff6b2c] dark:text-[#ff6b2c] rounded-full flex items-center justify-center">
            <FileText size={22} />
          </div>
          <div className="text-center">
            <h3 className="font-semibold text-lg">Enviar Dados de Treinamento</h3>
            <p className="text-muted text-sm max-w-sm mt-1 mb-4">
              Envie PDFs, documentos ou CSVs para ampliar a base de conhecimento do seu assistente. Máx. 10MB por arquivo.
            </p>
          </div>

          <div className="relative">
            <Button variant="primary" isDisabled={isUploading}>
              {isUploading ? 'Enviando...' : 'Procurar Arquivos'}
            </Button>
            <input
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:pointer-events-none"
              onChange={handleFileUpload}
              disabled={isUploading}
              accept=".pdf,.txt,.md,.csv,.json"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
              <span className="shrink-0">&#x26A0;</span>
              <span>{error}</span>
            </div>
          )}
        </Card>
      )}

      <div className="mt-4 w-full">
        <h3 className="text-lg font-semibold mb-4 text-foreground">Arquivos Enviados ({files.length})</h3>

        {files.length === 0 ? (
          <div className="text-sm text-muted p-4 text-center rounded-xl">
            Nenhum arquivo disponível ainda. Envie arquivos para dar ao seu assistente um contexto personalizado.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {files.map((file) => (
              <div key={file.id} className="flex items-center justify-between p-4 bg-surface rounded-xl hover:border-dim-hover transition">
                <div className="flex items-center gap-4 overflow-hidden">
                  <div className="w-10 h-10 bg-raised rounded-lg flex items-center justify-center shrink-0 text-muted">
                    <Folder size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{file.name}</p>
                    <p className="text-xs text-muted flex items-center gap-2">
                      <span>{formatSize(file.size)}</span>
                      <span>•</span>
                      <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                {!isReadOnly && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onPress={() => handleRemoveFile(file.id)}
                  >
                    Excluir
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
