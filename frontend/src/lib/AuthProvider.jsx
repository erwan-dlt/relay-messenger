import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { AuthContext } from './AuthContext'

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    api('/auth/me').then(({ user }) => { if (active) setUser(user) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setReady(true) })
    const invalidate = () => setUser(null)
    window.addEventListener('relay:unauthorized', invalidate)
    return () => { active = false; window.removeEventListener('relay:unauthorized', invalidate) }
  }, [])

  const login = useCallback(async (email, password) => {
    const result = await api('/auth/login', { method: 'POST', body: { email, password } })
    setUser(result.user)
  }, [])
  const register = useCallback(async (name, email, password) => {
    const result = await api('/auth/register', { method: 'POST', body: { name, email, password } })
    setUser(result.user)
  }, [])
  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }) } finally { setUser(null) }
  }, [])
  const value = useMemo(() => ({ user, ready, login, register, logout }), [user, ready, login, register, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
