import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'

export default function AuthPage() {
  const location = useLocation()
  const isRegister = location.pathname === '/register'
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (user) return <Navigate to="/app" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (isRegister) await register(name, email, password)
      else await login(email, password)
      navigate('/app', { replace: true })
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return <main className="auth-layout">
    <section className="auth-showcase">
      <div className="showcase-pattern" />
      <Link to="/login" className="brand brand--showcase"><span className="brand-mark"><Icon name="message" size={22} /></span> relay<span className="brand-dot">.</span></Link>
      <div className="showcase-content">
        <span className="eyebrow eyebrow--light"><span className="eyebrow-dot" /> LA MESSAGERIE QUI RAPPROCHE</span>
        <h1>Les meilleures idées commencent par une <em>conversation.</em></h1>
        <p>Un espace simple pour réunir vos équipes, partager vos idées et garder le fil de vos projets.</p>
        <div className="showcase-preview">
          <div className="preview-top"><span className="preview-dots"><i/><i/><i/></span><span>Projet Web — équipe démo</span><Icon name="users" size={17}/></div>
          <div className="preview-messages">
            <div className="preview-message"><Avatar name="Alice Martin" size="sm"/><div><strong>Alice Martin <small>10:42</small></strong><p>Bienvenue sur Relay ! 👋</p></div></div>
            <div className="preview-message"><Avatar name="Bob Laurent" size="sm"/><div><strong>Bob Laurent <small>10:43</small></strong><p>Tout le monde est prêt pour le projet ?</p></div></div>
            <div className="preview-message"><Avatar name="Charlie Moreau" size="sm"/><div><strong>Charlie Moreau <small>10:44</small></strong><p>On est lancés ! 🚀</p></div></div>
            <div className="preview-input"><span>Écrire un message...</span><span className="preview-send"><Icon name="arrow" size={16}/></span></div>
          </div>
        </div>
      </div>
      <div className="showcase-footer">Conçu pour connecter les personnes, pas les compliquer.</div>
    </section>
    <section className="auth-right">
      <div className="auth-right-content">
        <div className="mobile-brand brand"><span className="brand-mark"><Icon name="message" size={20}/></span> relay<span className="brand-dot">.</span></div>
        <span className="eyebrow">BIENVENUE SUR RELAY</span>
        <h2>{isRegister ? 'Créez votre compte' : 'Heureux de vous revoir 👋'}</h2>
        <p className="auth-subtitle">{isRegister ? 'Rejoignez la conversation en quelques secondes.' : 'Connectez-vous pour retrouver vos conversations.'}</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {isRegister && <label>Nom complet<input autoComplete="name" required minLength={2} maxLength={70} placeholder="Alice Martin" value={name} onChange={e => setName(e.target.value)} /></label>}
          <label>Adresse e-mail<input type="email" autoComplete="email" required placeholder="vous@exemple.fr" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label>Mot de passe<input type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 10 : undefined} placeholder="••••••••••••" value={password} onChange={e => setPassword(e.target.value)}/></label>
          {isRegister && <span className="input-hint">10 caractères minimum pour protéger votre compte.</span>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Chargement…' : isRegister ? 'Créer mon compte' : 'Se connecter'} <Icon name="arrow" size={18} /></button>
        </form>
        <p className="auth-switch">{isRegister ? 'Déjà un compte ? ' : 'Pas encore de compte ? '}
          <Link to={isRegister ? '/login' : '/register'} onClick={() => setError('')}>{isRegister ? 'Se connecter' : 'Créer un compte'}</Link>
        </p>
        <div className="demo-note"><Icon name="sparkles" size={18}/><span>Pour essayer la démo : <strong>alice@example.test</strong> avec <strong>Demo1234!X</strong> après <code>npm run seed</code>.</span></div>
      </div>
      <div className="auth-footnote">Un projet full-stack React + Node.js + SQLite</div>
    </section>
  </main>
}
