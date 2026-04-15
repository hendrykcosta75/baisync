import { describe, it, expect, beforeEach } from 'vitest'
import { useChannelStore, type Channel, type ChannelMessage, type ChannelNote, type ChannelCanvas } from '@/store/useChannelStore'

const mockChannel: Channel = {
  id: 'ch-1', workspace_id: 'ws-1', name: 'general', description: 'General channel',
  type: 'public', created_by: 'user-1', created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
}

describe('useChannelStore', () => {
  beforeEach(() => {
    useChannelStore.setState({
      channels: [], dms: [], activeChannel: null,
      messages: [], members: [], notes: [], canvases: [],
      nextCursor: null, isLoading: false,
    })
  })

  // ─── Channels CRUD ───

  it('fetchChannels loads channels (excluding DMs)', async () => {
    await useChannelStore.getState().fetchChannels('ws-1')
    const { channels } = useChannelStore.getState()
    expect(channels).toHaveLength(2)
    expect(channels.every(c => c.type !== 'dm')).toBe(true)
  })

  it('fetchDms loads direct messages', async () => {
    await useChannelStore.getState().fetchDms('ws-1')
    expect(useChannelStore.getState().dms).toHaveLength(1)
    expect(useChannelStore.getState().dms[0].type).toBe('dm')
  })

  it('createChannel creates and refetches channels', async () => {
    const channel = await useChannelStore.getState().createChannel('ws-1', 'new-channel', 'A new channel')
    expect(channel.name).toBe('new-channel')
  })

  it('updateChannel updates local state', async () => {
    useChannelStore.setState({ channels: [mockChannel], activeChannel: mockChannel })
    await useChannelStore.getState().updateChannel('ch-1', 'renamed')
    const { channels, activeChannel } = useChannelStore.getState()
    expect(channels[0].name).toBe('renamed')
    expect(activeChannel?.name).toBe('renamed')
  })

  it('deleteChannel removes from list and clears active', async () => {
    useChannelStore.setState({ channels: [mockChannel], activeChannel: mockChannel })
    await useChannelStore.getState().deleteChannel('ch-1')
    expect(useChannelStore.getState().channels).toHaveLength(0)
    expect(useChannelStore.getState().activeChannel).toBeNull()
  })

  // ─── Messages ───

  it('setActiveChannel resets messages and fetches new ones', () => {
    useChannelStore.setState({ messages: [{ id: 'old', channel_id: 'x', sender_id: 'u', sender_name: 'U', content: 'x', message_type: 'text', edited_at: null, created_at: '' }] })
    useChannelStore.getState().setActiveChannel(mockChannel)
    // Messages are reset on setActiveChannel call
    const state = useChannelStore.getState()
    expect(state.activeChannel?.id).toBe('ch-1')
  })

  it('sendMessage prepends message to list', async () => {
    useChannelStore.setState({ activeChannel: mockChannel })
    await useChannelStore.getState().sendMessage('ch-1', 'Hello!')
    const { messages } = useChannelStore.getState()
    expect(messages[0].content).toBe('Hello!')
  })

  it('editMessage updates message content', async () => {
    const msg: ChannelMessage = {
      id: 'msg-1', channel_id: 'ch-1', sender_id: 'u-1', sender_name: 'Test',
      content: 'old', message_type: 'text', edited_at: null, created_at: '2024-01-01T00:00:00Z',
    }
    useChannelStore.setState({ messages: [msg] })
    await useChannelStore.getState().editMessage('ch-1', 'msg-1', 'new content')
    expect(useChannelStore.getState().messages[0].content).toBe('new content')
    expect(useChannelStore.getState().messages[0].edited_at).toBeTruthy()
  })

  it('deleteMessage removes from list', async () => {
    const msg: ChannelMessage = {
      id: 'msg-1', channel_id: 'ch-1', sender_id: 'u-1', sender_name: 'Test',
      content: 'hello', message_type: 'text', edited_at: null, created_at: '2024-01-01T00:00:00Z',
    }
    useChannelStore.setState({ messages: [msg] })
    await useChannelStore.getState().deleteMessage('ch-1', 'msg-1')
    expect(useChannelStore.getState().messages).toHaveLength(0)
  })

  // ─── addMessage (SSE) ───

  it('addMessage prepends to active channel messages', () => {
    useChannelStore.setState({ activeChannel: mockChannel, messages: [] })
    const newMsg: ChannelMessage = {
      id: 'msg-new', channel_id: 'ch-1', sender_id: 'u-2', sender_name: 'Other',
      content: 'SSE message', message_type: 'text', edited_at: null, created_at: new Date().toISOString(),
    }
    useChannelStore.getState().addMessage(newMsg)
    expect(useChannelStore.getState().messages[0].content).toBe('SSE message')
  })

  it('addMessage increments unread for non-active channels', () => {
    const otherChannel: Channel = { ...mockChannel, id: 'ch-2', name: 'other', unread_count: 0 }
    useChannelStore.setState({ activeChannel: mockChannel, channels: [mockChannel, otherChannel] })
    const msg: ChannelMessage = {
      id: 'msg-x', channel_id: 'ch-2', sender_id: 'u-2', sender_name: 'Other',
      content: 'hi', message_type: 'text', edited_at: null, created_at: '',
    }
    useChannelStore.getState().addMessage(msg)
    expect(useChannelStore.getState().channels.find(c => c.id === 'ch-2')?.unread_count).toBe(1)
  })

  // ─── Notes ───

  it('createNote adds to notes list', async () => {
    const note = await useChannelStore.getState().createNote('ch-1', 'My Note')
    expect(note.title).toBe('My Note')
    expect(useChannelStore.getState().notes).toHaveLength(1)
  })

  it('deleteNote removes from list', async () => {
    const note = await useChannelStore.getState().createNote('ch-1', 'To Delete')
    await useChannelStore.getState().deleteNote('ch-1', note.id)
    expect(useChannelStore.getState().notes).toHaveLength(0)
  })

  // ─── SSE note handlers ───

  it('addNoteFromSSE adds new note without duplicates', () => {
    const note: ChannelNote = {
      id: 'n-1', channel_id: 'ch-1', title: 'SSE Note', content: '',
      created_by: 'u-1', updated_by: 'u-1', created_at: '', updated_at: '',
    }
    useChannelStore.getState().addNoteFromSSE(note)
    useChannelStore.getState().addNoteFromSSE(note) // duplicate
    expect(useChannelStore.getState().notes).toHaveLength(1)
  })

  it('updateNoteFromSSE updates existing note', () => {
    const note: ChannelNote = {
      id: 'n-1', channel_id: 'ch-1', title: 'Original', content: '',
      created_by: 'u-1', updated_by: 'u-1', created_at: '', updated_at: '',
    }
    useChannelStore.setState({ notes: [note] })
    useChannelStore.getState().updateNoteFromSSE({ ...note, title: 'Updated' })
    expect(useChannelStore.getState().notes[0].title).toBe('Updated')
  })

  it('removeNoteFromSSE removes note', () => {
    const note: ChannelNote = {
      id: 'n-1', channel_id: 'ch-1', title: 'Test', content: '',
      created_by: 'u-1', updated_by: 'u-1', created_at: '', updated_at: '',
    }
    useChannelStore.setState({ notes: [note] })
    useChannelStore.getState().removeNoteFromSSE('n-1')
    expect(useChannelStore.getState().notes).toHaveLength(0)
  })

  // ─── SSE canvas handlers ───

  it('addCanvasFromSSE adds without duplicates', () => {
    const canvas: ChannelCanvas = {
      id: 'cv-1', channel_id: 'ch-1', title: 'Canvas', canvas_data: '',
      created_by: 'u-1', updated_by: 'u-1', created_at: '', updated_at: '',
    }
    useChannelStore.getState().addCanvasFromSSE(canvas)
    useChannelStore.getState().addCanvasFromSSE(canvas)
    expect(useChannelStore.getState().canvases).toHaveLength(1)
  })

  it('removeCanvasFromSSE removes canvas', () => {
    const canvas: ChannelCanvas = {
      id: 'cv-1', channel_id: 'ch-1', title: 'Canvas', canvas_data: '',
      created_by: 'u-1', updated_by: 'u-1', created_at: '', updated_at: '',
    }
    useChannelStore.setState({ canvases: [canvas] })
    useChannelStore.getState().removeCanvasFromSSE('cv-1')
    expect(useChannelStore.getState().canvases).toHaveLength(0)
  })

  // ─── handleRemovedFromChannel ───

  it('handleRemovedFromChannel clears channel and related data', () => {
    useChannelStore.setState({
      channels: [mockChannel],
      activeChannel: mockChannel,
      messages: [{ id: 'm', channel_id: 'ch-1', sender_id: 'u', sender_name: 'U', content: '', message_type: 'text', edited_at: null, created_at: '' }],
      notes: [{ id: 'n', channel_id: 'ch-1', title: '', content: '', created_by: '', updated_by: '', created_at: '', updated_at: '' }],
    })
    useChannelStore.getState().handleRemovedFromChannel('ch-1')
    const state = useChannelStore.getState()
    expect(state.channels).toHaveLength(0)
    expect(state.activeChannel).toBeNull()
    expect(state.messages).toHaveLength(0)
    expect(state.notes).toHaveLength(0)
  })

  // ─── markRead ───

  it('markRead resets unread_count to 0', async () => {
    const ch: Channel = { ...mockChannel, unread_count: 5 }
    useChannelStore.setState({ channels: [ch] })
    await useChannelStore.getState().markRead('ch-1')
    expect(useChannelStore.getState().channels[0].unread_count).toBe(0)
  })
})
