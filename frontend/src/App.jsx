import { Navigate, Route, Routes } from 'react-router-dom'
import AuthProvider from './lib/AuthProvider'
import { useAuth } from './lib/AuthContext'
import AuthPage from './pages/AuthPage'
import ChatPage from './pages/ChatPage'

function AppRoutes() {
  const { ready, user } = useAuth()
  if (!ready) return <div className="loading-screen"><div className="loading-mark">r<span>.</span></div><p>Chargement de Relay…</p></div>
  return <Routes>
    <Route path="/login" element={<AuthPage/>}/>
    <Route path="/register" element={<AuthPage/>}/>
    <Route path="/app" element={user ? <ChatPage/> : <Navigate to="/login" replace/>}/>
    <Route path="*" element={<Navigate to={user ? '/app' : '/login'} replace/>}/>
  </Routes>
}

export default function App() {
  return <AuthProvider><AppRoutes/></AuthProvider>
}
