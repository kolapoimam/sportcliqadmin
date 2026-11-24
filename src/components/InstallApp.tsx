import { useState } from 'react'
import { Download, Share, SquarePlus } from 'lucide-react'
import { Modal } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

/** Returns a menu action for installing the portal, plus the iPhone hint modal it may open. */
export function useInstallApp() {
  const install = useInstallPrompt()
  const [iosOpen, setIosOpen] = useState(false)
  const run = async () => {
    if (install.canPrompt) await install.prompt()
    else setIosOpen(true)
  }
  const modal = (
    <Modal
      open={iosOpen}
      onOpenChange={setIosOpen}
      title="Install SportCliq Admin"
      description="Add the portal to your home screen so it opens like an app."
      icon={<Download />}
      footer={<Button onClick={() => setIosOpen(false)}>Got it</Button>}
    >
      <ol className="space-y-3 text-sm">
        <li className="flex items-center gap-3 rounded-2xl bg-muted/70 p-3"><Share className="h-5 w-5 shrink-0 text-primary" /> Tap the Share button in Safari</li>
        <li className="flex items-center gap-3 rounded-2xl bg-muted/70 p-3"><SquarePlus className="h-5 w-5 shrink-0 text-primary" /> Choose Add to Home Screen, then Add</li>
      </ol>
    </Modal>
  )
  return { available: install.available, run, modal }
}
