import { createContext, useContext } from 'react'
export const AuthContext = createContext(null)
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider')
  return ctx
}
