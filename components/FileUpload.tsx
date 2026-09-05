'use client'

import { AlertCircle, Camera, Loader2, RefreshCw, UploadCloud, X } from 'lucide-react'
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
//
// THE PREVIEW HAS TO SURVIVE THE UPLOAD, and until now it did not. The local
// object URL is discarded when the component remounts -- which is exactly what
// a router.refresh() after a successful save does -- so a member who had just
// uploaded their CNIC came back to an empty drop zone reading "Tap to choose",
// with no way to tell whether the upload had worked. They uploaded it again.
// `currentPreview` is now shown in the SAME frame as Replace and Remove
// instead of only in the empty state, so a stored file looks like a stored
// file. For a private bucket the caller passes a node that renders through
// /api/documents/[id]/preview -- there is no public URL to show and there must
// not be one.
//
// SHAPE. An avatar and a CNIC scan are not the same picture. `square` is a
// 160px well with the current photo inside it and "Change photo" beneath --
// the shape of the thing being uploaded, so somebody can see at a glance
// whether their face is centred. `wide` is the full-width drop zone, which is
// right for a document or a screenshot and wrong for a head-and-shoulders.

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
  /**
   * Remove the STORED file. When set, the Remove button deletes what is stored
   * (the caller does the server delete, confirmation and toast, then clears its
   * own `currentPreview`) rather than only clearing the local preview — which is
   * what "Remove does nothing" was: with a stored document, clearing the local
   * pick left the stored one on screen and on disk. Without it, Remove only
   * discards a freshly-picked, not-yet-uploaded file.
   */
  onRemove?: () => Promise<void> | void
  /**
   * Show the Remove button. Default true. Off for the identity documents (CNIC
   * front/back, selfie), where Replace is the only action — a member does not
   * delete an identity document, they replace it; the file is retained
   * privately either way.
   */
  allowRemove?: boolean
  /** Owned by the caller when the upload is driven from outside. */
  busy?: boolean
  /**
   * What is already stored, if anything.
   *
   * Rendered in the empty state AND beside Replace/Remove after an upload, so
   * the zone never claims to be empty when a file exists. For a private bucket
   * this is a node that fetches through an authorising route; never a URL.
   */
  currentPreview?: React.ReactNode
  /**
   * 'wide' — the full-width dashed drop zone. Documents, screenshots, files.
   * 'square' — a 160px well showing the current image, with the action under
   * it. Avatars and anything else where the crop is the point.
   */
  shape?: 'wide' | 'square'
  /** Replaces "Tap to choose…" on a square well once something is stored. */
  changeLabel?: string
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
  onRemove,
  allowRemove = true,
  busy = false,
  currentPreview,
  shape = 'wide',
  changeLabel = 'Change photo',
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
  const [removing, setRemoving] = useState(false)

  const working = busy || uploading || removing

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

  const clearLocal = () => {
    if (chosen?.url) URL.revokeObjectURL(chosen.url)
    setChosen(null)
    setError(null)
    if (input.current) input.current.value = ''
  }

  // Remove. With a STORED file and an onRemove handler, this deletes what is
  // stored — the caller does the server delete, the confirmation and the toast,
  // then clears its own currentPreview. Otherwise it just discards a
  // freshly-picked file that has not been committed. This is the fix for
  // "Remove does nothing": before, a stored document had no path to deletion at
  // all, so pressing Remove cleared a local pick that was not even there.
  const hasStoredNow = currentPreview !== undefined && currentPreview !== null
  const remove = async () => {
    if (onRemove && hasStoredNow) {
      setRemoving(true)
      setError(null)
      try {
        await onRemove()
        clearLocal()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That could not be removed.')
      } finally {
        setRemoving(false)
      }
      return
    }
    clearLocal()
  }

  // Something is on screen when a file has just been chosen OR when one is
  // already stored. The old condition was `chosen` alone, which is why a
  // remount after a successful save showed the empty state over a file that
  // existed.
  const hasStored = currentPreview !== undefined && currentPreview !== null
  const showFrame = !!chosen || hasStored

  const actions = (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={working}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-60"
      >
        <RefreshCw aria-hidden size={13} />
        Replace
      </button>
      {allowRemove && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={working}
          aria-label={`Remove ${label}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-[11px] font-bold text-tm-red transition-colors hover:bg-tm-tint-red disabled:opacity-60"
        >
          <X aria-hidden size={13} />
          Remove
        </button>
      )}
    </div>
  )

  const dropZone = (
    // A label, not a div with a click handler: it is focusable, it is
    // activated by Enter and Space for free, and it names the input.
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
        Tap to choose, or drag a file here · {acceptLabel}, up to {prettyBytes(maxBytes)}
      </span>
    </label>
  )

  // ------------------------------------------------------------- square ----
  //
  // The well IS the preview: a 160px picture with the action beneath it, which
  // is what an avatar control looks like everywhere else and what makes a badly
  // framed photograph obvious before it is saved.
  if (shape === 'square') {
    const inWell = chosen?.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={chosen.url} alt={`${label} preview`} className="h-full w-full object-cover" />
    ) : hasStored ? (
      currentPreview
    ) : null

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

        <div className="flex flex-col items-start gap-2">
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
            className={`relative grid h-40 w-40 cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 transition-colors focus-within:border-tm-navy ${
              disabled || working
                ? 'cursor-not-allowed border-dashed border-gray-200 bg-tm-bg opacity-60'
                : dragging
                  ? 'border-dashed border-tm-navy bg-tm-tint-navy'
                  : inWell
                    ? 'border-solid border-gray-200 bg-tm-bg'
                    : 'border-dashed border-gray-200 bg-white hover:border-tm-navy'
            }`}
          >
            {inWell ?? (
              <span className="flex flex-col items-center gap-1 px-3 text-center">
                <UploadCloud aria-hidden size={22} className="text-gray-500" />
                <span className="text-[11px] font-bold text-tm-navy">{label}</span>
              </span>
            )}
            {working && (
              <span className="absolute inset-0 grid place-items-center bg-tm-black/40">
                <Loader2 aria-hidden size={22} className="animate-spin text-white" />
              </span>
            )}
          </label>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={disabled || working}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy transition-colors hover:border-tm-navy disabled:opacity-60"
            >
              <Camera aria-hidden size={13} />
              {inWell ? changeLabel : 'Choose a photo'}
            </button>
            {allowRemove && chosen && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={working}
                aria-label={`Remove ${label}`}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-[11px] font-bold text-tm-red transition-colors hover:bg-tm-tint-red disabled:opacity-60"
              >
                <X aria-hidden size={13} />
                Remove
              </button>
            )}
          </div>
        </div>

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

  // --------------------------------------------------------------- wide ----
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

      {showFrame ? (
        // Wraps cleanly: the thumbnail and its "Uploaded" label stay together,
        // and Replace drops onto its own line when the card is too narrow to
        // hold all three — instead of the label being clipped under the thumb.
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-tm-bg">
            {chosen?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={chosen.url}
                alt={`${label} preview`}
                className="h-full w-full object-cover"
              />
            ) : hasStored ? (
              currentPreview
            ) : (
              <span className="grid h-full w-full place-items-center text-[10px] font-black text-gray-500">
                FILE
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 basis-40 space-y-0.5">
            <p className="truncate text-xs font-bold text-tm-navy">{label}</p>
            <p className="text-[11px] text-gray-500">
              {removing ? 'Removing…' : working ? 'Uploading…' : 'Uploaded'}
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
          {actions}
        </div>
      ) : (
        dropZone
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
