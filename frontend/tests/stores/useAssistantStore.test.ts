import { describe, it, expect, beforeEach } from 'vitest'
import { useAssistantStore } from '@/store/useAssistantStore'

describe('useAssistantStore', () => {
  beforeEach(() => {
    useAssistantStore.setState({ assistants: [], isLoading: false, hasFetched: false })
  })

  it('fetchAssistants populates the assistants list', async () => {
    await useAssistantStore.getState().fetchAssistants()
    const state = useAssistantStore.getState()
    expect(state.assistants).toHaveLength(1)
    expect(state.assistants[0].name).toBe('My Assistant')
    expect(state.assistants[0].llmProvider).toBe('openai')
    expect(state.hasFetched).toBe(true)
  })

  it('addAssistant adds to the list and syncs with backend', async () => {
    await useAssistantStore.getState().addAssistant({
      id: 'temp-id',
      name: 'New Assistant',
      description: 'New description',
      llmProvider: 'openai',
      model: 'gpt-4o',
      temperature: 0.7,
      maxTokens: 2048,
      systemPrompt: 'Hello',
      integrationSettings: {
        rateLimitPerDay: 1000,
        maxMessageLength: 4096,
        splitOnDoubleNewline: false,
        typingIndicator: true,
        interpretDocuments: false,
        rateLimitMessage: '',
        maxLengthMessage: '',
        unsupportedMediaMessage: '',
      },
      audioConfig: {
        provider: null,
        mode: 'disabled',
        transcribe: false,
        fallbackToText: true,
        transcriptionFailureMessage: '',
        voiceId: null,
      },
    })
    const state = useAssistantStore.getState()
    expect(state.assistants.length).toBeGreaterThanOrEqual(1)
  })

  it('updateAssistant modifies the assistant in state', async () => {
    // Seed an assistant first
    useAssistantStore.setState({
      assistants: [{
        id: '660e8400-e29b-41d4-a716-446655440001',
        name: 'My Assistant',
        description: '',
        llmProvider: 'openai',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: '',
        isTeamLead: false,
        files: [],
        tools: [],
        integrations: [],
        integrationSettings: {
          rateLimitPerDay: 1000,
          maxMessageLength: 4096,
          splitOnDoubleNewline: false,
          typingIndicator: true,
          interpretDocuments: false,
          rateLimitMessage: '',
          maxLengthMessage: '',
          unsupportedMediaMessage: '',
        },
        audioConfig: {
          provider: null,
          mode: 'disabled',
          transcribe: false,
          fallbackToText: true,
          transcriptionFailureMessage: '',
          voiceId: null,
        },
        subAgents: [],
      }],
    })

    await useAssistantStore.getState().updateAssistant(
      '660e8400-e29b-41d4-a716-446655440001',
      { name: 'Updated Name' }
    )
    const state = useAssistantStore.getState()
    expect(state.assistants[0].name).toBe('Updated Name')
  })

  it('deleteAssistant removes from state', async () => {
    useAssistantStore.setState({
      assistants: [{
        id: '660e8400-e29b-41d4-a716-446655440001',
        name: 'My Assistant',
        description: '',
        llmProvider: 'openai',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt: '',
        isTeamLead: false,
        files: [],
        tools: [],
        integrations: [],
        integrationSettings: {
          rateLimitPerDay: 1000,
          maxMessageLength: 4096,
          splitOnDoubleNewline: false,
          typingIndicator: true,
          interpretDocuments: false,
          rateLimitMessage: '',
          maxLengthMessage: '',
          unsupportedMediaMessage: '',
        },
        audioConfig: {
          provider: null,
          mode: 'disabled',
          transcribe: false,
          fallbackToText: true,
          transcriptionFailureMessage: '',
          voiceId: null,
        },
        subAgents: [],
      }],
    })

    await useAssistantStore.getState().deleteAssistant('660e8400-e29b-41d4-a716-446655440001')
    const state = useAssistantStore.getState()
    expect(state.assistants).toHaveLength(0)
  })
})
