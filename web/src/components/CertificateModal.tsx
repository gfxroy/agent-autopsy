import { useEffect, useMemo, useRef, useState } from 'react'
import type { Analysis } from '../engine/analyze'
import { certificateData, drawCertificate, shareText, SITE_URL } from '../lib/certificate'
import { ProgressTx } from '../lib/progress'
import { useStore } from '../store'
import { Modal } from './ui'

export function CertificateModal({ analysis }: { analysis: Analysis }) {
  const st = useStore()
  const ref = useRef<HTMLCanvasElement>(null)
  const data = useMemo(
    () =>
      certificateData(
        analysis,
        st.progress.playerName === 'You' ? 'Agent Autopsy' : st.progress.playerName,
      ),
    [analysis, st.progress.playerName],
  )
  const text = useMemo(() => shareText(data), [data])
  const [ok, setOk] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const draw = () => setOk(drawCertificate(ref.current!, data))
    draw()
    // redraw once webfonts are ready
    void document.fonts?.ready.then(draw)
  }, [data])

  const download = () => {
    const c = ref.current
    if (!c) return
    const a = document.createElement('a')
    a.download = `death-certificate-${data.caseNo.slice(1).toLowerCase()}.png`
    a.href = c.toDataURL('image/png')
    a.click()
    st.applyProgress(new ProgressTx(st.progress).badge('notary'))
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      st.toast({
        icon: '⚠️',
        title: 'Clipboard blocked',
        body: 'Select the text and copy manually.',
        tone: 'error',
      })
    }
  }

  return (
    <Modal
      title={data.status === 'alive' ? '📜 Certificate of Survival' : '📜 Death Certificate'}
      onClose={() => st.setModal(null)}
      wide
    >
      <canvas
        ref={ref}
        width={1200}
        height={675}
        className="w-full rounded-lg border border-white/10 shadow-2xl"
        data-testid="certificate"
        data-status={data.status}
        aria-label={`Death certificate: ${data.cause}`}
      />
      {!ok && <p className="mt-2 text-sm text-rose-300">Canvas is unavailable in this browser.</p>}
      <p className="mt-2 text-[11px] text-slate-500">
        🔒 Redaction is always applied to the certificate (keys, emails, phone numbers, cards…).
        Nothing is uploaded.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <textarea
          readOnly
          value={text}
          className="h-28 w-full resize-none rounded-lg border border-white/10 bg-ink-900 p-2 font-mono text-xs text-slate-300"
          aria-label="Share text"
          data-testid="share-text"
        />
        <div className="flex flex-col gap-2">
          <button className="btn-primary" onClick={download} data-testid="download-certificate">
            ⬇ Download PNG
          </button>
          <button className="btn" onClick={() => void copy()}>
            {copied ? '✓ Copied' : '📋 Copy text'}
          </button>
          <a
            className="btn text-center"
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
          >
            𝕏 Post
          </a>
          <a
            className="btn text-center"
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE_URL)}`}
            target="_blank"
            rel="noreferrer"
          >
            in Share
          </a>
        </div>
      </div>
    </Modal>
  )
}
