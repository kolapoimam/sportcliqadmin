import { useEffect, useRef } from 'react'
import {
  ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Filler, Legend, LinearScale,
  LineController, LineElement, PieController, PointElement, Title, Tooltip, type ChartConfiguration,
} from 'chart.js'
import { useTheme } from '@/hooks/useTheme'

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, PieController, DoughnutController, ArcElement, CategoryScale, LinearScale, Tooltip, Legend, Title, Filler)
Chart.defaults.font.family = '"Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif'

export function chartColors(dark: boolean) {
  return { tick: dark ? '#9aa3a0' : '#6b7280', grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', text: dark ? '#f5f7f6' : '#0a0a0a' }
}

/** Renders a Chart.js chart and rebuilds it when the config or theme changes. */
export function ChartCanvas({ config, label, className, canvasRef }: { config: (dark: boolean) => ChartConfiguration; label: string; className?: string; canvasRef?: React.RefObject<HTMLCanvasElement | null> }) {
  const innerRef = useRef<HTMLCanvasElement>(null)
  const ref = canvasRef ?? innerRef
  const { dark } = useTheme()
  const cfgRef = useRef(config)
  cfgRef.current = config
  const key = JSON.stringify(config(dark).data)

  useEffect(() => {
    if (!ref.current) return
    const c = new Chart(ref.current, cfgRef.current(dark))
    return () => c.destroy()
  }, [key, dark, ref])

  return (
    <div className={className}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  )
}
