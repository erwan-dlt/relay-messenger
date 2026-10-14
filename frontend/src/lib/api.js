export async function api(path, { method = 'GET', body, signal } = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Impossible de contacter le serveur. Vérifie que le backend est démarré.')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/me' && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new Event('relay:unauthorized'))
    }
    throw new Error(data.error || `Erreur HTTP ${response.status}`)
  }
  return data
}
