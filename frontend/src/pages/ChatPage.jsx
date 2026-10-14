import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useAuth } from '../lib/AuthContext'
import Avatar from '../components/Avatar'
import Icon from '../components/Icon'
import Modal from '../components/Modal'

function timeLabel(iso) {
  if (!iso) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}
function dateLabel(iso) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(iso))
}
function mergeMessages(oldMessages, incoming) {
  const byId = new Map([...oldMessages, ...incoming].map(message => [message.id, message]))
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export default function ChatPage() {
  const { user, logout } = useAuth()
  const [groups, setGroups] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [details, setDetails] = useState(null)
  const [messages, setMessages] = useState([])
  const [connection, setConnection] = useState('connecting')
  const [hasMore, setHasMore] = useState(false)
  const [messageInput, setMessageInput] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [modalInput, setModalInput] = useState('')
  const [modalError, setModalError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pageBusy, setPageBusy] = useState(false)
  const [loadingGroup, setLoadingGroup] = useState(false)
  const [error, setError] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [mobileSidebar, setMobileSidebar] = useState(false)
  const chatList = useRef(null)
  const scrollToBottom = useRef(false)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const refreshGroups = useCallback(async () => {
    const { groups } = await api('/groups')
    setGroups(groups)
    setSelectedId(previous => (previous && groups.some(g => g.id === previous)) ? previous : (groups[0]?.id ?? null))
  }, [])

  useEffect(() => {
    let active = true
    api('/groups').then(({ groups }) => {
      if (!active) return
      setGroups(groups)
      setSelectedId(groups[0]?.id ?? null)
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  // The socket uses the same HttpOnly session cookie as the REST API.
  // Rooms are assigned on the server after checking current group memberships.
  useEffect(() => {
    if (typeof window.io !== 'function') {
      setConnection('disconnected')
      return
    }
    const socket = window.io({ path: '/socket.io', withCredentials: true })
    let seenConnection = false

    async function syncAfterConnect() {
      setConnection('connected')
      try {
        await refreshGroups()
        const id = selectedIdRef.current
        if (id && seenConnection) {
          // Catch events missed while offline. HTTP remains the source of truth.
          const [page, info] = await Promise.all([
            api(`/groups/${id}/messages`), api(`/groups/${id}`)
          ])
          if (selectedIdRef.current === id) {
            setMessages(current => mergeMessages(current, page.messages))
            setDetails(info)
          }
        }
      } catch {
        // A group may have been removed while disconnected; refreshGroups
        // already switches to a group the current user can access.
      }
      seenConnection = true
    }
    function onNewMessage({ groupId, message }) {
      if (selectedIdRef.current === groupId) {
        const element = chatList.current
        if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 150) scrollToBottom.current = true
        setMessages(current => mergeMessages(current, [message]))
      }
      refreshGroups().catch(() => {})
    }
    function onMemberChange({ groupId }) {
      if (selectedIdRef.current === groupId) {
        api(`/groups/${groupId}`).then(setDetails).catch(() => {})
      }
    }
    function onRemoved({ groupId }) {
      if (selectedIdRef.current === groupId) {
        setDetails(null)
        setMessages([])
        setShowDetails(false)
      }
      refreshGroups().catch(() => {})
    }
    socket.on('connect', syncAfterConnect)
    socket.on('disconnect', () => setConnection('disconnected'))
    socket.on('connect_error', () => setConnection('disconnected'))
    socket.on('message:new', onNewMessage)
    socket.on('groups:changed', () => refreshGroups().catch(() => {}))
    socket.on('group:members-changed', onMemberChange)
    socket.on('group:removed', onRemoved)
    return () => socket.disconnect()
  }, [refreshGroups])

  useEffect(() => {
    if (!selectedId) { return }
    let active = true
    const id = selectedId
    // Clear previous group before loading to avoid displaying data from another conversation.
    setMessages([]); setDetails(null); setHasMore(false); setLoadingGroup(true); setError('')
    scrollToBottom.current = true
    Promise.all([api(`/groups/${id}`), api(`/groups/${id}/messages`)]).then(([info, page]) => {
      if (!active) return
      setDetails(info)
      setMessages(current => mergeMessages(current, page.messages))
      setHasMore(page.hasMore)
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setLoadingGroup(false) })
    return () => { active = false }
  }, [selectedId])

  useEffect(() => {
    if (scrollToBottom.current && chatList.current) {
      chatList.current.scrollTop = chatList.current.scrollHeight
      scrollToBottom.current = false
    }
  }, [messages])

  async function sendMessage(event) {
    event.preventDefault()
    if (!messageInput.trim() || !selectedId || busy) return
    setBusy(true); setError('')
    try {
      const { message } = await api(`/groups/${selectedId}/messages`, { method: 'POST', body: { body: messageInput } })
      scrollToBottom.current = true
      setMessages(current => mergeMessages(current, [message]))
      setMessageInput('')
      await refreshGroups()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function loadOlder() {
    if (!messages.length || pageBusy) return
    setPageBusy(true)
    try {
      const before = messages[0].id
      const container = chatList.current
      const oldHeight = container?.scrollHeight || 0
      const { messages: older, hasMore: more } = await api(`/groups/${selectedId}/messages?before=${before}`)
      setMessages(current => mergeMessages(older, current))
      setHasMore(more)
      // Keep reading position when older messages are prepended.
      requestAnimationFrame(() => { if (container) container.scrollTop += container.scrollHeight - oldHeight })
    } catch (err) { setError(err.message) }
    finally { setPageBusy(false) }
  }

  function openModal(which) { setModal(which); setModalInput(''); setModalError('') }
  async function submitModal(event) {
    event.preventDefault()
    if (!modalInput.trim()) return
    setBusy(true); setModalError('')
    try {
      if (modal === 'group') {
        const { group } = await api('/groups', { method: 'POST', body: { name: modalInput } })
        await refreshGroups()
        setSelectedId(group.id)
      } else if (modal === 'member') {
        await api(`/groups/${selectedId}/members`, { method: 'POST', body: { email: modalInput } })
        setDetails(await api(`/groups/${selectedId}`))
        await refreshGroups()
      }
      setModal(null)
    } catch (err) { setModalError(err.message) }
    finally { setBusy(false) }
  }

  async function removeMember(member) {
    const self = member.id === user.id
    const confirmation = self ? 'Quitter ce groupe ?' : `Retirer ${member.name} du groupe ?`
    if (!window.confirm(confirmation)) return
    try {
      await api(`/groups/${selectedId}/members/${member.id}`, { method: 'DELETE' })
      if (self) { setShowDetails(false); await refreshGroups() }
      else { setDetails(await api(`/groups/${selectedId}`)); await refreshGroups() }
    } catch (err) { setError(err.message) }
  }
  async function deleteGroup() {
    if (!window.confirm(`Supprimer définitivement « ${details.group.name} » et tous ses messages ?`)) return
    try {
      await api(`/groups/${selectedId}`, { method: 'DELETE' })
      setShowDetails(false); await refreshGroups()
    } catch (err) { setError(err.message) }
  }
  const currentGroup = groups.find(group => group.id === selectedId)
  const filteredGroups = groups.filter(group => group.name.toLowerCase().includes(groupSearch.toLowerCase()))
  const isOwner = currentGroup?.role === 'owner'
  let lastDate = ''

  return <div className="app-shell">
    <aside className={`sidebar ${mobileSidebar ? 'sidebar--open' : ''}`}>
      <div className="sidebar-heading">
        <div className="brand"><span className="brand-mark"><Icon name="message" size={22}/></span> relay<span className="brand-dot">.</span></div>
        <button className="icon-button sidebar-close" onClick={() => setMobileSidebar(false)} aria-label="Fermer le menu"><Icon name="close"/></button>
      </div>
      <div className="workspace-pill"><span className="workspace-icon">R</span><div><strong>Mon espace</strong><span>Espace de collaboration</span></div><Icon name="chevron" size={16}/></div>
      <div className="sidebar-section-heading"><span>CONVERSATIONS</span><button className="icon-button icon-button--subtle" onClick={() => openModal('group')} aria-label="Nouveau groupe" title="Nouveau groupe"><Icon name="plus" size={19}/></button></div>
      <div className="sidebar-search"><Icon name="search" size={17}/><input aria-label="Rechercher un groupe" placeholder="Rechercher un groupe..." value={groupSearch} onChange={event => setGroupSearch(event.target.value)}/></div>
      <nav className="groups-nav" aria-label="Conversations">
        {filteredGroups.map(group => <button key={group.id} className={`group-item ${group.id === selectedId ? 'group-item--active' : ''}`} onClick={() => { setSelectedId(group.id); setShowDetails(false); setMobileSidebar(false) }}>
          <Avatar name={group.name} group/><span className="group-item-content"><strong>{group.name}</strong><small>{group.lastMessage || `${group.memberCount} membre${group.memberCount > 1 ? 's' : ''}`}</small></span>
          {group.id === selectedId && <span className="active-marker"/>}
        </button>)}
        {!filteredGroups.length && <p className="sidebar-empty">{groupSearch ? 'Aucun résultat' : 'Aucun groupe pour le moment'}</p>}
      </nav>
      <button className="create-group-shortcut" onClick={() => openModal('group')}><Icon name="plus" size={18}/> Créer un groupe</button>
      <div className="sidebar-profile"><Avatar name={user.name}/><div className="profile-info"><strong>{user.name}</strong><span>{user.email}</span></div><button className="icon-button icon-button--subtle" onClick={logout} title="Déconnexion" aria-label="Se déconnecter"><Icon name="logout" size={19}/></button></div>
    </aside>
    {mobileSidebar && <button aria-label="Fermer la navigation" className="mobile-overlay" onClick={() => setMobileSidebar(false)}/>}
    <main className="conversation">
      {currentGroup ? <>
        <header className="conversation-header">
          <button className="icon-button mobile-menu" aria-label="Ouvrir les conversations" onClick={() => setMobileSidebar(true)}><Icon name="menu"/></button>
          <Avatar name={currentGroup.name} group/><div className="header-title"><h1>{currentGroup.name}</h1><span><span className={`status-dot ${connection !== 'connected' ? 'status-dot--offline' : ''}`}/>{connection === 'connected' ? 'En direct' : 'Reconnexion…'} · {currentGroup.memberCount} membre{currentGroup.memberCount > 1 ? 's' : ''}</span></div>
          <button className={`header-info-button ${showDetails ? 'header-info-button--active' : ''}`} onClick={() => setShowDetails(!showDetails)}><Icon name="users" size={19}/><span>Membres</span></button>
        </header>
        {error && <div className="chat-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Fermer"><Icon name="close" size={16}/></button></div>}
        <div className="message-scroll" ref={chatList}>
          {loadingGroup ? <p className="conversation-placeholder">Chargement de la conversation…</p> : <>
            <div className="conversation-intro"><Avatar name={currentGroup.name} group size="xl"/><h2>{currentGroup.name}</h2><p>C'est le début de votre conversation. Partagez un message avec le groupe !</p></div>
            {hasMore && <button className="load-older" onClick={loadOlder} disabled={pageBusy}>{pageBusy ? 'Chargement…' : 'Afficher les messages précédents'}</button>}
            {messages.map(message => {
              const date = dateLabel(message.createdAt)
              const showDate = date !== lastDate
              lastDate = date
              const mine = message.authorId === user.id
              return <div key={message.id}>
                {showDate && <div className="date-divider"><span>{date}</span></div>}
                <div className={`message-row ${mine ? 'message-row--mine' : ''}`}>
                  {!mine && <Avatar name={message.authorName} size="sm"/>}
                  <div className="message-main"><div className="message-meta"><strong>{mine ? 'Vous' : message.authorName}</strong><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div><div className="message-bubble">{message.body}</div></div>
                </div>
              </div>
            })}
          </>}
        </div>
        <div className="composer-area"><form className="composer" onSubmit={sendMessage}><textarea aria-label="Écrire un message" placeholder={`Écrire à # ${currentGroup.name}...`} maxLength={2000} rows={1} value={messageInput} onChange={e => setMessageInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit() } }}/><button type="submit" disabled={!messageInput.trim() || busy} aria-label="Envoyer le message" title="Envoyer (Entrée)"><Icon name="send" size={18}/></button></form><p>Entrée pour envoyer · Maj + Entrée pour revenir à la ligne</p></div>
      </> : <div className="empty-conversation"><button className="icon-button mobile-menu" onClick={() => setMobileSidebar(true)} aria-label="Ouvrir les conversations"><Icon name="menu"/></button><div className="empty-icon"><Icon name="message" size={35}/></div><h1>Une conversation commence ici.</h1><p>Créez votre premier groupe et invitez des personnes pour commencer à échanger.</p><button className="button button-primary" onClick={() => openModal('group')}><Icon name="plus" size={18}/> Créer un groupe</button>{error && <p className="form-error">{error}</p>}</div>}
    </main>
    {showDetails && details && currentGroup && <aside className="details-panel"><div className="details-heading"><h2>À propos du groupe</h2><button className="icon-button" onClick={() => setShowDetails(false)} aria-label="Fermer"><Icon name="close"/></button></div><div className="details-summary"><Avatar name={details.group.name} size="xl" group/><h3>{details.group.name}</h3><p><Icon name="users" size={15}/> {details.members.length} membre{details.members.length > 1 ? 's' : ''}</p></div><div className="details-members-title"><h3>Membres <span>{details.members.length}</span></h3>{isOwner && <button className="button-add-member" onClick={() => openModal('member')}><Icon name="plus" size={16}/> Inviter</button>}</div><div className="details-members">{details.members.map(member => <div className="details-member" key={member.id}><Avatar name={member.name} size="sm"/><div><strong>{member.name}{member.id === user.id ? ' (vous)' : ''}</strong><span>{member.role === 'owner' ? 'Propriétaire' : member.email}</span></div>{isOwner && member.role !== 'owner' && <button onClick={() => removeMember(member)} className="icon-button remove-member" aria-label={`Retirer ${member.name}`} title="Retirer du groupe"><Icon name="close" size={15}/></button>}</div>)}</div><div className="details-bottom">{isOwner ? <button className="destructive-button" onClick={deleteGroup}><Icon name="trash" size={17}/> Supprimer le groupe</button> : <button className="destructive-button" onClick={() => removeMember(user)}><Icon name="logout" size={17}/> Quitter le groupe</button>}<p>Seul le propriétaire peut inviter et retirer des membres.</p></div></aside>}
    {modal && <Modal title={modal === 'group' ? 'Créer un groupe' : 'Ajouter un membre'} onClose={() => setModal(null)}><p className="modal-description">{modal === 'group' ? 'Choisissez un nom pour votre nouvel espace de discussion.' : 'La personne doit déjà disposer d’un compte Relay.'}</p><form className="modal-form" onSubmit={submitModal}><label>{modal === 'group' ? 'Nom du groupe' : 'E-mail du membre'}<input autoFocus maxLength={modal === 'group' ? 70 : 254} type={modal === 'group' ? 'text' : 'email'} placeholder={modal === 'group' ? 'Ex. Équipe projet' : 'nom@exemple.fr'} value={modalInput} onChange={e => setModalInput(e.target.value)} required/></label>{modalError && <p className="form-error" role="alert">{modalError}</p>}<div className="modal-actions"><button className="button button-outline" type="button" onClick={() => setModal(null)}>Annuler</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'En cours…' : modal === 'group' ? 'Créer le groupe' : 'Ajouter'}</button></div></form></Modal>}
  </div>
}
