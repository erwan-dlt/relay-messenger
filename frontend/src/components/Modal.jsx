import { useEffect } from 'react'
import Icon from './Icon'
export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Fermer" onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </div>
  </div>
}
