import { useEffect, useState } from 'react'

function read() {
  return document.documentElement.classList.contains('dark')
}

export function useTheme() {
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const sync = () => setDark(read())
    window.addEventListener('theme-change', sync)
    return () => window.removeEventListener('theme-change', sync)
  }, [])
  const set = (next: boolean) => {
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('theme-change'))
  }
  return { dark, toggle: () => set(!dark), set }
}
