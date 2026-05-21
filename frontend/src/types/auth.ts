// Mirrors backend/src/middleware/auth.ts AuthUser. Keep in sync.
export interface AuthUser {
  id: string
  entraId: string
  email: string
  displayName: string
  ministryCode: string | null
  role: 'admin' | 'user' | 'viewer'
}
