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
    const body = await request.json() as any
    if (body.email === 'test@example.com' && body.password === 'Password123!') {
      return HttpResponse.json({ token: 'mock-jwt-token', user: mockUser })
    }
    return HttpResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }),

  http.post('/api/auth/register', async ({ request }) => {
    const body = await request.json() as any
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
    const body = await request.json() as any
    return HttpResponse.json({ ...mockAssistant, ...body, id: '770e8400-new' }, { status: 200 })
  }),

  http.get('/api/assistants/:id', () => {
    return HttpResponse.json(mockAssistant)
  }),

  http.put('/api/assistants/:id', async ({ request }) => {
    const body = await request.json() as any
    return HttpResponse.json({ ...mockAssistant, ...body })
  }),

  http.delete('/api/assistants/:id', () => {
    return HttpResponse.json({ success: true })
  }),

  // API Keys
  http.get('/api/user/api-keys', () => {
    return HttpResponse.json({
      openai: false,
      claude: false,
      gemini: false,
      elevenlabs: false,
    })
  }),

  http.put('/api/user/api-keys', () => {
    return HttpResponse.json({ success: true })
  }),

  // Notifications
  http.get('/api/notifications', () => {
    return HttpResponse.json([])
  }),

  // Workspaces
  http.get('/api/workspaces', () => {
    return HttpResponse.json([{
      id: '880e8400-ws',
      name: 'Personal',
      type: 'personal',
      owner_id: mockUser.id,
    }])
  }),

  // User profile
  http.put('/api/user/profile', async ({ request }) => {
    const body = await request.json() as any
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
]
