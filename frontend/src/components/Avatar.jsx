const palette = ['lavender', 'blue', 'peach', 'green', 'pink']
export default function Avatar({ name = '?', size = 'md', group = false }) {
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase()
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return <span className={`avatar avatar--${size} avatar--${palette[hash % palette.length]} ${group ? 'avatar--group' : ''}`} aria-hidden="true">{initials}</span>
}
