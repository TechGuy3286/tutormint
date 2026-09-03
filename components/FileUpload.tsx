'use client'

import { AlertCircle, Loader2, UploadCloud, X } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'

// The one file picker on the platform.
//
// It replaces a bare `<input type="file">` in every place that took one: the
// CNIC image, degree and qualification certificates, payment screenshots, ad
// creatives, the bulk-import spreadsheet and avatars. Those inputs shared one
// failure, and it was not cosmetic: THE MEMBER NEVER SAW WHAT THEY SENT. A
// blurry CNIC, the back of the card instead of the front, a screenshot of the
// wrong transfer — all of it looked identical to a correct upload, which is a
// browser chrome string and nothing else. The first person to see the picture
// was an admin, days later, and the way the member found out was a rejection.
//
// So the preview is the point. Everything else here — the drop area, the
// stated limits, the inline errors — is in service of the member being able to
// tell, before they submit, that they have sent the right thing.
//
// VALIDATION HERE IS A COURTESY, NOT A CONTROL. Type and size are re-checked
// server-side in /api/documents/upload and friends; this only means somebody
// on a phone connection is told in the same second rather than after a 6 MB
// upload completes and is refused.

export type FileUploadProps = {
  /** What is being uploaded, e.g. "CNIC image". Becomes the accessible name. */
  label: string
  /** The accept attribute AND what the copy promises, e.g. 'image/*'. */
  accept?: string
  /** Human list of what is allowed, e.g. "JPG or PNG". */
  acceptLabel?: string
  maxBytes?: number
  /** Called with a validated file. Throw or reject to surface an error. */
  onFile: (file: File) => Promise<void> | void
  /** Owned by the caller when the upload is driven from outside. */
  busy?: boolean
  /** An existing preview to show instead of the empty state. */
  currentPreview?: React.ReactNode
  hint?: string
  disabled?: boolean
  className?: string
}

const MB = 1024 * 1024

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < MB) return `${Math.round(n / 1024)} KB`
  return `${(n / MB).toFixed(1)} MB`
}

export default function FileUpload({
  label,
  accept = 'image/*',
  acceptLabel = 'JPG or PNG',
  maxBytes = 5 * MB,
  onFile,
  busy = false,
  currentPreview,
  hint,
  disabled = false,
  className = '',
}: FileUploadProps) {
  const inputId = useId()
  const input = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<{ name: string; size: number; url: string | null } | null>(
    null,
  )
  const [uploading, setUploading] = useState(false)

  const working = busy || uploading

  const accepts = useCallback(
    (file: File): string | null => {
      if (file.size > maxBytes) {
        return `That file is ${prettyBytes(file.size)}. The limit is ${prettyBytes(maxBytes)}.`
      }
      if (file.size === 0) return 'That file is empty.'
      if (accept === 'image/*' && !file.type.startsWith('image/')) {
        // Named rather than generic: "invalid file" tells somebody who picked a
        // PDF of their CNIC nothing about what to do next.
        return `That is a ${file.type || 'unknown'} file. ${acceptLabel} only.`
      }
      return null
    },
    [accept, acceptLabel, maxBytes],
  )

  const take = useCallback(
    async (file: File | undefined | null) => {
      if (!file || disabled) return
      setError(null)
      const problem = accepts(file)
      if (problem) {
        setError(problem)
        setChosen(null)
        return
      }
      // A local object URL, so the thumbnail appears instantly and does not
      // wait on the round trip it is meant to give the member confidence about.
      const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      setChosen({ name: file.name, size: file.size, url })
      setUploading(true)
      try {
        await onFile(file)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That upload did not go through.')
      } finally {
        setUploading(false)
      }
    },
    [accepts, disabled, onFile],
  )

  const clear = () => {
    if (chosen?.url) URL.revokeObjectURL(chosen.url)
    setChosen(null)
    setError(null)
    if (input.current) input.current.value = ''
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled || working}
        className="sr-only"
        onChange={(e) => void take(e.target.files?.[0])}
      />

      {chosen ? (
        <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
          {chosen.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={chosen.url}
              alt={`${label} preview`}
              className="h-16 w-16 shrink-0 rounded-xl border border-gray-200 object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-tm-bg text-[10px] font-black text-gray-500">
              FILE
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-xs font-bold text-tm-navy">{chosen.name}</p>
            <p className="text-[11px] text-gray-500">
              {working ? 'Uploading…' : prettyBytes(chosen.size)}
            </p>
            {working && (
              <div
                role="progressbar"
                aria-label={`Uploading ${label}`}
                className="h-1 w-full overflow-hidden rounded-full bg-gray-200"
              >
                {/* Indeterminate on purpose: fetch() gives no upload progress
                    without XHR, and a fake percentage that jumps to 90 and
                    waits is a worse lie than an honest barber pole. */}
                <span className="block h-full w-1/3 animate-pulse rounded-full bg-tm-navy" />
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={working}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-60"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={working}
              aria-label={`Remove ${label}`}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-[11px] font-bold text-tm-red transition-colors hover:bg-tm-tint-red disabled:opacity-60"
            >
              <X aria-hidden size={13} />
              Remove
            </button>
          </div>
        </div>
      ) : (
        <>
          {currentPreview}
          {/* A label, not a div with a click handler: it is focusable, it is
              activated by Enter and Space for free, and it names the input. */}
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault()
              if (!disabled && !working) setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void take(e.dataTransfer.files?.[0])
            }}
            className={`flex min-h-[96px] cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed p-4 text-center transition-colors focus-within:border-tm-navy ${
              disabled || working
                ? 'cursor-not-allowed border-gray-200 bg-tm-bg opacity-60'
                : dragging
                  ? 'border-tm-navy bg-tm-tint-navy'
                  : 'border-gray-200 bg-white hover:border-tm-navy'
            }`}
          >
            {working ? (
              <Loader2 aria-hidden size={20} className="animate-spin text-gray-500" />
            ) : (
              <UploadCloud aria-hidden size={20} className="text-gray-500" />
            )}
            <span className="text-xs font-bold text-tm-navy">{label}</span>
            <span className="text-[11px] text-gray-500">
              Tap to choose, or drag a file here · {acceptLabel}, up to{' '}
              {prettyBytes(maxBytes)}
            </span>
          </label>
        </>
      )}

      {hint && !error && <p className="text-[11px] text-gray-500">{hint}</p>}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 rounded-xl bg-tm-tint-red p-2.5 text-[11px] font-semibold text-tm-red-hover"
        >
          <AlertCircle aria-hidden size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}
