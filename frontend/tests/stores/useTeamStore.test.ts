import { describe, it, expect, beforeEach } from 'vitest'
import { useTeamStore } from '@/store/useTeamStore'

describe('useTeamStore', () => {
  beforeEach(() => {
    useTeamStore.setState({
      teams: [],
      activeTeam: null,
      tasks: [],
      members: [],
      activity: [],
      activityCursor: null,
      comments: [],
      commentsCursor: null,
      taskAttachments: [],
      isLoading: false,
    })
  })

  it('fetchTeams populates teams list', async () => {
    await useTeamStore.getState().fetchTeams('880e8400-e29b-41d4-a716-446655440002')
    const { teams } = useTeamStore.getState()
    expect(teams).toHaveLength(1)
    expect(teams[0].name).toBe('Engineering')
  })

  it('fetchTasks populates tasks list', async () => {
    await useTeamStore.getState().fetchTasks('team-1')
    const { tasks } = useTeamStore.getState()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Fix bug')
    expect(tasks[0].due_date).toBe('2026-04-20T00:00:00Z')
  })

  it('updateTask sends updated data and refreshes store', async () => {
    await useTeamStore.getState().fetchTasks('team-1')
    const updated = await useTeamStore.getState().updateTask('team-1', 'task-1', {
      title: 'Fix critical bug',
      due_date: '2026-05-01T00:00:00Z',
    })
    expect(updated.title).toBe('Fix critical bug')
    expect(updated.due_date).toBe('2026-05-01T00:00:00Z')
  })

  it('uploadTaskAttachment via apiFetch returns attachment', async () => {
    const file = new File(['test content'], 'report.pdf', { type: 'application/pdf' })
    const attachment = await useTeamStore.getState().uploadTaskAttachment('team-1', 'task-1', file)
    expect(attachment.file_name).toBe('report.pdf')
    expect(attachment.file_size).toBe(1024)
    const { taskAttachments } = useTeamStore.getState()
    expect(taskAttachments).toHaveLength(1)
    expect(taskAttachments[0].id).toBe('att-1')
  })

  it('deleteTaskAttachment removes from state', async () => {
    // Seed an attachment
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    await useTeamStore.getState().uploadTaskAttachment('team-1', 'task-1', file)
    expect(useTeamStore.getState().taskAttachments).toHaveLength(1)

    await useTeamStore.getState().deleteTaskAttachment('team-1', 'task-1', 'att-1')
    expect(useTeamStore.getState().taskAttachments).toHaveLength(0)
  })

  it('fetchMembers populates members list', async () => {
    await useTeamStore.getState().fetchMembers('team-1')
    const { members } = useTeamStore.getState()
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('leader')
  })

  it('fetchComments populates comments list', async () => {
    await useTeamStore.getState().fetchComments('task-1')
    const { comments } = useTeamStore.getState()
    expect(comments).toHaveLength(0) // mock returns empty
  })

  it('fetchTaskAttachments populates attachments list', async () => {
    await useTeamStore.getState().fetchTaskAttachments('team-1', 'task-1')
    const { taskAttachments } = useTeamStore.getState()
    expect(taskAttachments).toHaveLength(0) // mock returns empty list
  })
})
