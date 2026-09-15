'use client'

import { AlertCircle, CheckCircle2, RefreshCw, UploadCloud, Video } from 'lucide-react'
import { useRef, useState } from 'react'

// Direct introduction-video upload (PR 3b §4).
//
// The file is PUT straight from the browser to a YouTube resumable-upload
// session (minted by /api/tutor/video/session), so it NEVER passes through the
// Vercel serverless request body and its ~4.5 MB cap — the reason the old limit
// was an unusable 4 MB. The real limit is 200 MB, shown here.
//
//   1. POST /api/tutor/video/session { contentType, size } -> a session URL.
//   2. XHR PUT the file to that URL, with real upload progress.
//   3. POST /api/tutor/video/record { videoId } -> verified + recorded.
//
// The chosen file is held in a ref, so RETRY re-runs the whole flow without the
// tutor having to pick the file again. The 3-submission cap and the review step
// are unchanged — the server enforces both.
//
// NOTE (honest limit of this build): the step-2 PUT crosses to Google, so it
// depends on YouTube's resumable endpoint returning CORS headers for a browser
// PUT. That transport cannot be exercised without a browser and live YouTube
// credentials; a failure surfaces as a plain retry-able error, never a fake
// success.

const MAX_BYTES = 200 * 1024 * 1024
const MB = 1024 * 1024

// Accepted formats (owner PR6 §1.6): MP4, MOV, 3GP, WEBM. Android Chrome often
// reports file.type = "" or an odd subtype, so a file is accepted when its type
// is video/* OR its extension is one of these — the server infers the real
// content type either way.
const ACCEPTED_EXT = ['mp4', 'm4v', 'mov', '3gp', '3gpp', 'webm']
const ACCEPT_ATTR = 'video/mp4,video/quicktime,video/3gpp,video/webm,.mp4,.m4v,.mov,.3gp,.3gpp,.webm'
const FORMATS_LABEL = 'MP4, MOV, 3GP or WEBM'

function isAcceptedVideo(file: File): boolean {
  if (file.type && file.type.startsWith('video/')) return true
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return !!ext && ACCEPTED_EXT.includes(ext)
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < MB) return `${Math.round(n / 1024)} KB`
  return `${(n / MB).toFixed(1)} MB`
}

type Phase = 'idle' | 'preparing' | 'uploading' | 'recording' | 'done' | 'error'

/** PUT the file to the resumable session URL with progress; resolve the video id. */
function putVideo(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          if (data?.id) resolve(data.id as string)
          else reject(new Error('YouTube did not return a video id.'))
        } catch {
          reject(new Error('Unexpected response from the upload.'))
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`))
      }
    }
    xhr.onerror = () =>
      reject(new Error('The upload could not reach YouTube. Check your connection and try again.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))
    xhr.send(file)
  })
}

export default function VideoUpload({
  initialAttempts,
  initialStatus,
  maxAttempts = 3,
  onSubmitted,
}: {
  initialAttempts: number
  initialStatus: string
  maxAttempts?: number
  onSubmitted?: (attempt: number) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const fileRef = useRef<File | null>(null)
  const [attempts, setAttempts] = useState(initialAttempts)
  const [status, setStatus] = useState(initialStatus)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null)

  const left = Math.max(0, maxAttempts - attempts)
  const locked = attempts >= maxAttempts
  const busy = phase === 'preparing' || phase === 'uploading' || phase === 'recording'

  function pick(file: File | null | undefined) {
    if (!file) return
    setError(null)
    if (!isAcceptedVideo(file)) {
      setError(`Choose a video file (${FORMATS_LABEL}).`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`That video is ${prettyBytes(file.size)}. The limit is ${Math.round(MAX_BYTES / MB)} MB.`)
      return
    }
    fileRef.current = file
    setPicked({ name: file.name, size: file.size })
    setPhase('idle')
    setProgress(0)
    void upload(file)
  }

  async function upload(file: File) {
    setError(null)
    setProgress(0)
    setPhase('preparing')
    try {
      // 1. Mint the session.
      const sRes = await fetch('/api/tutor/video/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type || 'video/mp4', size: file.size, fileName: file.name }),
      })
      const sJson = await sRes.json().catch(() => ({}))
      if (!sRes.ok || !sJson.uploadUrl) {
        throw new Error(
          sJson.unavailable
            ? 'Video upload is temporarily unavailable — please try again later. Nothing was recorded.'
            : (sJson.error ?? 'Could not start the upload.'),
        )
      }

      // 2. Upload the bytes straight to Google, with progress.
      setPhase('uploading')
      const videoId = await putVideo(sJson.uploadUrl as string, file, setProgress)

      // 3. Record the result (verified server-side).
      setPhase('recording')
      const rRes = await fetch('/api/tutor/video/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      })
      const rJson = await rRes.json().catch(() => ({}))
      if (!rRes.ok || !rJson.success) {
        throw new Error(rJson.error ?? 'The video uploaded but could not be recorded. Please try again.')
      }

      setAttempts(rJson.attempt ?? attempts + 1)
      setStatus('uploaded')
      setPhase('done')
      onSubmitted?.(rJson.attempt ?? attempts + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That upload did not go through.')
      setPhase('error')
    }
  }

  function retry() {
    const f = fileRef.current
    if (f) void upload(f)
  }

  if (locked) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
        You have used all {maxAttempts} submissions. Please contact support@tutormint.org.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        disabled={busy}
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {status !== 'none' && phase !== 'done' && (
        <p className="rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
          Video submitted — status: {status}
        </p>
      )}

      {/* Idle / pick */}
      {phase === 'idle' && !picked && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex min-h-[96px] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-4 text-center transition-colors hover:border-tm-navy"
        >
          <UploadCloud aria-hidden size={22} className="text-gray-500" />
          <span className="text-xs font-bold text-tm-navy">Introduction video</span>
          <span className="text-[11px] text-gray-500">Tap to choose · {FORMATS_LABEL}, up to 200 MB</span>
        </button>
      )}

      {/* Uploading / recording, with progress */}
      {(phase === 'preparing' || phase === 'uploading' || phase === 'recording') && (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-tm-navy">
            <Video aria-hidden size={15} className="text-gray-500" />
            <span className="min-w-0 flex-1 truncate">{picked?.name ?? 'Your video'}</span>
            <span className="shrink-0 text-gray-500">
              {phase === 'uploading' ? `${progress}%` : phase === 'recording' ? 'Finishing…' : 'Preparing…'}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Uploading video"
            aria-valuenow={phase === 'uploading' ? progress : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
          >
            <div
              className={`h-full rounded-full bg-tm-navy transition-[width] ${phase !== 'uploading' ? 'animate-pulse' : ''}`}
              style={{ width: phase === 'uploading' ? `${progress}%` : '100%' }}
            />
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <p className="flex items-center gap-2 rounded-xl border border-tm-green-deep/30 bg-tm-tint-green p-3 text-xs font-bold text-tm-green-deep">
          <CheckCircle2 aria-hidden size={15} />
          Video submitted for review. {left} submission{left === 1 ? '' : 's'} left.
        </p>
      )}

      {/* Error, with a retry that keeps the file */}
      {phase === 'error' && (
        <div className="space-y-2">
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-xl bg-tm-tint-red p-2.5 text-[11px] font-semibold text-tm-red-hover"
          >
            <AlertCircle aria-hidden size={13} className="mt-px shrink-0" />
            {error}
          </p>
          <div className="flex flex-wrap gap-2">
            {fileRef.current && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-tm-red px-4 text-xs font-bold text-white transition-colors hover:bg-tm-red-hover"
              >
                <RefreshCw aria-hidden size={14} />
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy transition-colors hover:border-tm-navy"
            >
              Choose another
            </button>
          </div>
        </div>
      )}

      {error && phase !== 'error' && (
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
