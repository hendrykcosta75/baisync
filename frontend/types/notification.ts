export interface Notification {
  user_id: string
  id: string
  assistant_id: string | null
  integration_id: string | null
  notification_type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
}
