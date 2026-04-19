import { http, HttpResponse } from 'msw'

const mockUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
  name: 'Test User',
  two_factor_enabled: false,
  created_at: '2024-01-01T00:00:00Z',
}

const mockAssistant = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  name: 'My Assistant',
  description: 'A test assistant',
  llm_provider: 'openai',
  model: 'gpt-4o',
  temperature: 0.7,
  max_tokens: 4096,
  system_prompt: 'You are a helpful assistant.',
  created_at: '2024-01-01T00:00:00Z',
}

export const handlers = [
  // Auth
  http.post('/api/auth/login', async ({ request }) => {
    const body = await request.json() as Record<string, string>
    if (body.email === 'test@example.com' && body.password === 'Password123!') {
      return HttpResponse.json({ token: 'mock-jwt-token', user: mockUser })
    }
    return HttpResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }),

  http.post('/api/auth/register', async ({ request }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({
      token: 'mock-jwt-token',
      user: { ...mockUser, name: body.name, email: body.email },
    })
  }),

  http.get('/api/auth/me', () => {
    return HttpResponse.json(mockUser)
  }),

  // Assistants
  http.get('/api/assistants', () => {
    return HttpResponse.json([mockAssistant])
  }),

  http.post('/api/assistants', async ({ request }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({ ...mockAssistant, ...body, id: '770e8400-new' }, { status: 200 })
  }),

  http.get('/api/assistants/:id', () => {
    return HttpResponse.json(mockAssistant)
  }),

  http.put('/api/assistants/:id', async ({ request }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({ ...mockAssistant, ...body })
  }),

  http.delete('/api/assistants/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  // API Keys
  http.get('/api/user/api-keys', () => {
    return HttpResponse.json({
      openai_configured: false,
      claude_configured: false,
      gemini_configured: false,
      elevenlabs_configured: false,
      grok_configured: false,
      deepseek_configured: false,
      mercadopago_configured: false,
      stripe_configured: false,
    })
  }),

  http.put('/api/user/api-keys', () => {
    return HttpResponse.json({ success: true })
  }),

  // Notifications
  http.get('/api/notifications', () => {
    return HttpResponse.json([
      {
        user_id: mockUser.id,
        id: 'notif-1',
        assistant_id: null,
        integration_id: null,
        notification_type: 'info',
        title: 'Welcome',
        message: 'Welcome to the platform',
        is_read: false,
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        user_id: mockUser.id,
        id: 'notif-2',
        assistant_id: null,
        integration_id: null,
        notification_type: 'alert',
        title: 'Update',
        message: 'New features available',
        is_read: true,
        created_at: '2024-01-02T00:00:00Z',
      },
    ])
  }),

  http.post('/api/notifications/:id/read', () => {
    return HttpResponse.json({ success: true })
  }),

  http.post('/api/notifications/read-all', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/notifications/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/notifications', () => {
    return HttpResponse.json({ success: true })
  }),

  // Workspaces
  http.get('/api/workspaces', () => {
    return HttpResponse.json({
      workspaces: [
        {
          workspace_id: mockUser.id,
          workspace_name: 'Perfil de Test User',
          workspace_type: 'personal',
          role: 'owner',
          joined_at: '2024-01-01T00:00:00Z',
        },
        {
          workspace_id: '880e8400-e29b-41d4-a716-446655440002',
          workspace_name: 'Company Workspace',
          workspace_type: 'company',
          role: 'owner',
          joined_at: '2024-01-01T00:00:00Z',
        },
      ],
      active_workspace_id: mockUser.id,
    })
  }),

  http.post('/api/workspaces/:id/switch', () => {
    return HttpResponse.json({ token: 'mock-jwt-token-switched', workspace_id: '880e8400-e29b-41d4-a716-446655440002' })
  }),

  http.get('/api/workspaces/:id/members', () => {
    return HttpResponse.json({
      members: [{
        workspace_id: '880e8400-e29b-41d4-a716-446655440002',
        user_id: mockUser.id,
        role: 'owner',
        invited_by: null,
        joined_at: '2024-01-01T00:00:00Z',
        user_name: mockUser.name,
        user_email: mockUser.email,
      }],
    })
  }),

  http.delete('/api/workspaces/:id', ({ params }) => {
    const id = params.id as string
    // Cannot delete personal workspace
    if (id === mockUser.id) {
      return HttpResponse.json({ error: 'Cannot delete personal workspace' }, { status: 400 })
    }
    return HttpResponse.json({
      success: true,
      token: 'mock-jwt-token-after-delete',
      workspace_id: mockUser.id,
    })
  }),

  // OKRs
  http.get('/api/workspaces/:id/okrs', ({ request }) => {
    const url = new URL(request.url)
    const cycle = url.searchParams.get('cycle')
    return HttpResponse.json({
      objectives: cycle ? [
        {
          workspace_id: 'ws-1', cycle, objective_id: 'obj-1', title: 'Increase Revenue',
          objective_type: 'committed', status: 'on_track', progress: 0.6, confidence: 0.7,
          owner_id: 'u-1', team_id: null, key_results: [],
        },
      ] : [],
    })
  }),

  http.post('/api/workspaces/:id/okrs', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      objective: {
        workspace_id: 'ws-1', id: 'obj-new', title: body.title, description: body.description,
        objective_type: body.objective_type || 'committed', cycle: body.cycle,
        status: 'on_track', owner_id: 'u-1', team_id: null, parent_objective_id: null,
        progress: 0, confidence: 0.5, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.get('/api/okrs/:id/children', () => {
    return HttpResponse.json({ children: [] })
  }),

  // Strategy Map
  http.get('/api/workspaces/:id/strategy-map', () => {
    return HttpResponse.json({ nodes: [], edges: [] })
  }),

  http.post('/api/workspaces/:id/strategy-map/nodes', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      node: {
        workspace_id: 'ws-1', id: 'node-new', node_type: body.node_type, entity_id: null,
        label: body.label, position_x: body.position_x, position_y: body.position_y,
        width: 200, height: 100, style_data: null, bsc_perspective: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.delete('/api/workspaces/:id/strategy-map/nodes/:nodeId', () => {
    return HttpResponse.json({ success: true })
  }),

  // SWOT
  http.get('/api/workspaces/:id/swot', () => {
    return HttpResponse.json({
      analyses: [{
        workspace_id: 'ws-1', id: 'swot-1', title: 'Q2 Analysis',
        description: null, cycle: '2026-Q2', created_by: 'u-1',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
    })
  }),

  http.post('/api/workspaces/:id/swot', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      analysis: {
        workspace_id: 'ws-1', id: 'swot-new', title: body.title,
        description: null, cycle: null, created_by: 'u-1',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.get('/api/workspaces/:id/swot/:analysisId', () => {
    return HttpResponse.json({
      analysis: {
        workspace_id: 'ws-1', id: 'swot-1', title: 'Q2 Analysis',
        description: null, cycle: '2026-Q2', created_by: 'u-1',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        items: [
          { analysis_id: 'swot-1', id: 'item-1', quadrant: 'strengths', content: 'Strong team', priority: 3, linked_objective_id: null, author_id: 'u-1', position: 0, created_at: new Date().toISOString() },
        ],
      },
    })
  }),

  http.post('/api/swot/:id/items', async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      item: {
        analysis_id: params.id, id: 'item-new', quadrant: body.quadrant, content: body.content,
        priority: body.priority || 3, linked_objective_id: null, author_id: 'u-1', position: 0,
        created_at: new Date().toISOString(),
      },
    })
  }),

  http.delete('/api/swot/:id/items/:itemId', () => {
    return HttpResponse.json({ success: true })
  }),

  // User profile
  http.put('/api/user/profile', async ({ request }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({ ...mockUser, ...body })
  }),

  // Appointments
  http.get('/api/appointments', () => {
    return HttpResponse.json([])
  }),

  // Usage
  http.get('/api/user/usage', () => {
    return HttpResponse.json({ total_messages: 0, total_tokens: 0 })
  }),

  http.get('/api/user/activity', () => {
    return HttpResponse.json([])
  }),

  // ─── Teams ───

  http.get('/api/workspaces/:wsId/teams', () => {
    return HttpResponse.json({
      teams: [
        {
          workspace_id: '880e8400-e29b-41d4-a716-446655440002',
          id: 'team-1',
          name: 'Engineering',
          description: 'Dev team',
          color: '#ff6b2c',
          created_by: mockUser.id,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          member_count: 2,
          task_counts: { open: 3, in_progress: 1, done: 5 },
          okr_progress: null,
        },
      ],
    })
  }),

  http.get('/api/teams/:teamId/tasks', () => {
    return HttpResponse.json({
      tasks: [
        {
          team_id: 'team-1', id: 'task-1', title: 'Fix bug',
          description: null, status: 'todo', priority: 'medium',
          assignee_id: mockUser.id, created_by: mockUser.id,
          due_date: '2026-04-20T00:00:00Z', tags: ['bug'],
          checklist_total: 0, checklist_done: 0,
          okr_objective_id: null, okr_key_result_id: null,
          position: 0, created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z', assignee_name: 'Test User',
        },
      ],
    })
  }),

  http.put('/api/teams/:teamId/tasks/:taskId', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      task: {
        team_id: 'team-1', id: 'task-1', title: body.title ?? 'Fix bug',
        description: body.description ?? null,
        status: body.status ?? 'todo', priority: body.priority ?? 'medium',
        assignee_id: body.assignee_id ?? mockUser.id, created_by: mockUser.id,
        due_date: body.due_date ?? null, tags: body.tags ?? [],
        checklist_total: 0, checklist_done: 0,
        okr_objective_id: null, okr_key_result_id: null,
        position: 0, created_at: '2024-01-01T00:00:00Z',
        updated_at: new Date().toISOString(), assignee_name: 'Test User',
      },
    })
  }),

  http.post('/api/teams/:teamId/tasks/:taskId/attachments', () => {
    return HttpResponse.json({
      attachment: {
        task_id: 'task-1', id: 'att-1', team_id: 'team-1',
        file_name: 'report.pdf', file_size: 1024, mime_type: 'application/pdf',
        uploaded_by: mockUser.id, uploader_name: 'Test User',
        created_at: new Date().toISOString(),
      },
    })
  }),

  http.get('/api/teams/:teamId/tasks/:taskId/attachments', () => {
    return HttpResponse.json({ attachments: [] })
  }),

  http.delete('/api/teams/:teamId/tasks/:taskId/attachments/:attId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/teams/:teamId/members', () => {
    return HttpResponse.json({
      members: [{
        team_id: 'team-1', user_id: mockUser.id,
        workspace_id: '880e8400-e29b-41d4-a716-446655440002',
        role: 'leader', joined_at: '2024-01-01T00:00:00Z',
        user_name: 'Test User', user_email: 'test@example.com',
        task_count: { assigned: 3, open: 2, done: 1 },
      }],
    })
  }),

  http.post('/api/teams/:teamId/members', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/teams/:teamId/members/:userId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/tasks/:taskId/comments', () => {
    return HttpResponse.json({ comments: [], next_cursor: null })
  }),

  // ─── Channels ───

  http.get('/api/workspaces/:wsId/channels', () => {
    return HttpResponse.json({
      channels: [
        {
          id: 'ch-1', workspace_id: 'ws-1', name: 'general', description: 'General channel',
          type: 'public', created_by: mockUser.id, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'ch-2', workspace_id: 'ws-1', name: 'random', description: null,
          type: 'public', created_by: mockUser.id, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
        },
      ],
    })
  }),

  http.get('/api/workspaces/:wsId/dms', () => {
    return HttpResponse.json({
      dms: [
        {
          id: 'dm-1', workspace_id: 'ws-1', name: 'DM', description: null,
          type: 'dm', created_by: mockUser.id, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
          other_user: { id: 'user-2', name: 'Other User', email: 'other@test.com' },
        },
      ],
    })
  }),

  http.post('/api/workspaces/:wsId/channels', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      channel: {
        id: 'ch-new', workspace_id: 'ws-1', name: body.name, description: body.description || null,
        type: body.channel_type || 'public', created_by: mockUser.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.put('/api/channels/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/channels/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/channels/:id/messages', () => {
    return HttpResponse.json({
      messages: [
        {
          id: 'msg-1', channel_id: 'ch-1', sender_id: mockUser.id, sender_name: 'Test User',
          content: 'Hello world', message_type: 'text', edited_at: null, created_at: '2024-01-01T12:00:00Z',
        },
      ],
      next_cursor: null,
    })
  }),

  http.post('/api/channels/:id/messages', async ({ request, params }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({
      message: {
        id: 'msg-new', channel_id: params.id, sender_id: mockUser.id, sender_name: 'Test User',
        content: body.content, message_type: 'text', edited_at: null, created_at: new Date().toISOString(),
      },
    })
  }),

  http.put('/api/channels/:chId/messages/:msgId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/channels/:chId/messages/:msgId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.post('/api/channels/:id/read', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/channels/:id/members', () => {
    return HttpResponse.json({
      members: [{
        channel_id: 'ch-1', user_id: mockUser.id, role: 'admin',
        user_name: 'Test User', user_email: 'test@example.com', joined_at: '2024-01-01T00:00:00Z',
      }],
    })
  }),

  http.post('/api/channels/:id/members', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/channels/:chId/members/:userId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/channels/:id/notes', () => {
    return HttpResponse.json({ notes: [] })
  }),

  http.post('/api/channels/:id/notes', async ({ request, params }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({
      note: {
        id: 'note-new', channel_id: params.id, title: body.title, content: '',
        created_by: mockUser.id, updated_by: mockUser.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.put('/api/channels/:chId/notes/:noteId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/channels/:chId/notes/:noteId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/channels/:id/canvases', () => {
    return HttpResponse.json({ canvases: [] })
  }),

  http.post('/api/channels/:id/canvases', async ({ request, params }) => {
    const body = await request.json() as Record<string, string>
    return HttpResponse.json({
      canvas: {
        id: 'canvas-new', channel_id: params.id, title: body.title, canvas_data: '',
        created_by: mockUser.id, updated_by: mockUser.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.get('/api/channels/:chId/canvases/:canvasId', ({ params }) => {
    return HttpResponse.json({
      canvas: {
        id: params.canvasId, channel_id: params.chId, title: 'Test Canvas', canvas_data: '{}',
        created_by: mockUser.id, updated_by: mockUser.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  http.put('/api/channels/:chId/canvases/:canvasId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/channels/:chId/canvases/:canvasId', () => {
    return HttpResponse.json({ success: true })
  }),

  http.post('/api/workspaces/:wsId/dms', () => {
    return HttpResponse.json({
      channel: {
        id: 'dm-new', workspace_id: 'ws-1', name: 'DM', description: null,
        type: 'dm', created_by: mockUser.id,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    })
  }),

  // ─── Admin ───

  http.post('/api/admin/login', async ({ request }) => {
    const body = await request.json() as Record<string, string>
    if (body.username === 'admin' && body.password === 'admin123') {
      return HttpResponse.json({ token: 'mock-admin-token' })
    }
    return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }),

  http.get('/api/admin/stats', () => {
    return HttpResponse.json({
      total_users: 100, total_assistants: 50, total_conversations: 500, total_messages: 5000,
      total_revenue: 10000, total_charges: 200, paid_count: 150, pending_count: 30, cancelled_count: 20,
      users_by_month: [], revenue_by_month: [], providers: [], recent_users: [],
    })
  }),

  http.get('/api/admin/users', () => {
    return HttpResponse.json([
      { id: 'u-1', email: 'user1@test.com', name: 'User 1', blocked: false, created_at: '2024-01-01T00:00:00Z', assistant_count: 2 },
    ])
  }),

  http.get('/api/admin/users/:id', ({ params }) => {
    return HttpResponse.json({
      id: params.id, email: 'user1@test.com', name: 'User 1', blocked: false,
      created_at: '2024-01-01T00:00:00Z', assistants: [],
    })
  }),

  http.get('/api/admin/users/:id/detail', ({ params }) => {
    return HttpResponse.json({
      id: params.id, email: 'user1@test.com', name: 'User 1', blocked: false,
      created_at: '2024-01-01T00:00:00Z', two_factor_enabled: false,
      has_openai_key: true, has_claude_key: false, has_gemini_key: false,
      has_elevenlabs_key: false, has_mercadopago_key: false,
      total_revenue: 500, paid_charges: 10, pending_charges: 2, cancelled_charges: 1,
      recent_charges: [], total_tokens: 1000, total_messages: 50,
      integrations: [], appointments_by_status: [], assistants: [],
    })
  }),

  http.post('/api/admin/users', () => {
    return HttpResponse.json({ success: true })
  }),

  http.put('/api/admin/users/:id/block', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/admin/users/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  http.get('/api/admin/integrations', () => {
    return HttpResponse.json({
      total: 5, connected: 3, disconnected: 2,
      by_channel: [], by_provider: [], integrations: [],
    })
  }),

  http.get('/api/admin/usage', () => {
    return HttpResponse.json({
      total_tokens_current_month: 50000, total_tokens_previous_month: 40000,
      total_messages_current_month: 200, tokens_by_month: [],
      top_users_by_tokens: [], top_assistants_by_tokens: [], by_provider: [],
    })
  }),

  // ─── Calendar ───

  http.post('/api/appointments', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      id: 'apt-new', ...body, status: 'pending',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
  }),

  http.put('/api/appointments/:id', async ({ request, params }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      id: params.id, client_name: 'Test Client', client_phone: '+5511999999999',
      date_time: '2026-05-01T10:00:00Z', duration_minutes: 30,
      status: body.status || 'pending', ...body,
      created_at: '2024-01-01T00:00:00Z', updated_at: new Date().toISOString(),
    })
  }),

  http.delete('/api/appointments/:id', () => {
    return HttpResponse.json({ success: true })
  }),
]
