'use client'

import { useRef, useState } from 'react'
import { Award, Loader2, Pencil, Plus, Upload, X } from 'lucide-react'

import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'

// Degrees and certifications, one editor for both.
//
// ONE ROW PER CREDENTIAL. The old card was two things at once — a list of
// saved degrees AND a permanently-open "add" row of four inputs — so a tutor
// with three degrees saw three summary rows above a fourth, empty, wider row
// that spilled its inputs, its file name and a "130 KB" nobody asked for
// outside the card. Here each saved credential is ONE row (thumbnail, summary,
// Edit, Remove); Edit expands the fields inline in place; Add opens the same
// field group at the foot. Nothing shows a file name or a byte count.
//
// THE FIELD GROUP WRAPS, never spills. Title, second field, year, the
// certificate control and the buttons are flex-wrapped, so at a narrow width
// they fall onto a second line inside the card rather than pushing past its
// edge. Verified at 360 / 390 / 768 / 1024 / 1280.

// The second field is institute (degrees) or issuer (certifications); both are
// optional so one type serves both, and the saved payload keeps its own key.
export type Field2Key = 'institute' | 'issuer'
export type Credential = {
  title: string
  year: string
  fileName: string
  fileUrl: string
  institute?: string
  issuer?: string
}

export default function CredentialEditor({
  items,
  onChange,
  uploadFile,
  noun,
  titlePlaceholder,
  field2Key,
  field2Placeholder,
  addLabel,
}: {
  items: Credential[]
  onChange: (items: Credential[]) => void
  /** Uploads a certificate image and resolves its URL. */
  uploadFile: (file: File) => Promise<string>
  /** "degree" / "certification", for confirm and toast copy. */
  noun: string
  titlePlaceholder: string
  field2Key: Field2Key
  field2Placeholder: string
  addLabel: string
}) {
  const confirm = useConfirm()
  const toast = useToast()

  // -1 = nothing open; index = editing that row; items.length = adding.
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<Credential>(blank(field2Key))

  const startAdd = () => {
    setDraft(blank(field2Key))
    setOpenIndex(items.length)
  }
  const startEdit = (i: number) => {
    setDraft({ ...items[i] })
    setOpenIndex(i)
  }
  const cancel = () => setOpenIndex(null)

  const commit = () => {
    if (!draft.title.trim()) {
      toast.error(`Give the ${noun} a title.`)
      return
    }
    const next = [...items]
    if (openIndex === items.length) {
      next.push(draft)
      toast.success(`${cap(noun)} added.`)
    } else if (openIndex !== null) {
      next[openIndex] = draft
      toast.success(`${cap(noun)} updated.`)
    }
    onChange(next)
    setOpenIndex(null)
  }

  const remove = async (i: number) => {
    const ok = await confirm({
      title: `Remove this ${noun}?`,
      body: items[i].title ? `“${items[i].title}” will be removed when you save.` : undefined,
      confirmLabel: 'Remove',
    })
    if (!ok) return
    onChange(items.filter((_, idx) => idx !== i))
    if (openIndex === i) setOpenIndex(null)
    toast.success(`${cap(noun)} removed.`)
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item, i) =>
            openIndex === i ? (
              <li key={i}>
                <Fields
                  draft={draft}
                  setDraft={setDraft}
                  onSave={commit}
                  onCancel={cancel}
                  uploadFile={uploadFile}
                  titlePlaceholder={titlePlaceholder}
                  field2Key={field2Key}
                  field2Placeholder={field2Placeholder}
                />
              </li>
            ) : (
              <li
                key={i}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-tm-bg p-3"
              >
                <Thumb url={item.fileUrl} />
                <div className="min-w-0 flex-1 text-xs">
                  <p className="truncate font-bold text-tm-navy">{item.title || `Untitled ${noun}`}</p>
                  {(item[field2Key] || item.year) && (
                    <p className="truncate text-gray-500">
                      {[item[field2Key], item.year].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(i)}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-tm-navy hover:bg-white"
                  >
                    <Pencil aria-hidden size={13} /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(i)}
                    aria-label={`Remove ${item.title || noun}`}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-tm-red hover:bg-tm-tint-red"
                  >
                    <X aria-hidden size={13} /> Remove
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {openIndex === items.length ? (
        <Fields
          draft={draft}
          setDraft={setDraft}
          onSave={commit}
          onCancel={cancel}
          uploadFile={uploadFile}
          titlePlaceholder={titlePlaceholder}
          field2Key={field2Key}
          field2Placeholder={field2Placeholder}
        />
      ) : (
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
        >
          <Plus aria-hidden size={14} /> {addLabel}
        </button>
      )}
    </div>
  )
}

function Fields({
  draft,
  setDraft,
  onSave,
  onCancel,
  uploadFile,
  titlePlaceholder,
  field2Key,
  field2Placeholder,
}: {
  draft: Credential
  setDraft: (c: Credential) => void
  onSave: () => void
  onCancel: () => void
  uploadFile: (file: File) => Promise<string>
  titlePlaceholder: string
  field2Key: Field2Key
  field2Placeholder: string
}) {
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const toast = useToast()

  const pick = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadFile(file)
      if (url) {
        setDraft({ ...draft, fileUrl: url, fileName: file.name })
        toast.success('Certificate uploaded.')
      } else {
        toast.error('That upload did not go through.')
      }
    } catch {
      toast.error('That upload did not go through.')
    } finally {
      setUploading(false)
    }
  }

  const field =
    'min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-tm-navy placeholder:text-gray-500 focus:border-tm-navy focus:outline-none'

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      {/* The wrapping field group. basis + grow so it is one line on a wide
          card and folds to two on a narrow one, always inside the card. */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[9rem] flex-[2] basis-full sm:basis-auto">
          <span className="sr-only">Title</span>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder={titlePlaceholder}
            className={field}
          />
        </label>
        <label className="min-w-[8rem] flex-[2] basis-[calc(60%-0.5rem)] sm:basis-auto">
          <span className="sr-only">{field2Placeholder}</span>
          <input
            value={draft[field2Key] ?? ''}
            onChange={(e) => setDraft({ ...draft, [field2Key]: e.target.value })}
            placeholder={field2Placeholder}
            className={field}
          />
        </label>
        <label className="min-w-[4.5rem] flex-1 basis-[calc(40%-0.5rem)] sm:basis-[5rem]">
          <span className="sr-only">Year</span>
          <input
            value={draft.year}
            onChange={(e) => setDraft({ ...draft, year: e.target.value })}
            placeholder="Year"
            className={field}
          />
        </label>

        {/* Certificate control — a thumbnail plus one button, no file name,
            no byte count. */}
        <div className="flex items-center gap-2">
          <Thumb url={draft.fileUrl} />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 aria-hidden size={13} className="animate-spin" />
            ) : (
              <Upload aria-hidden size={13} />
            )}
            {draft.fileUrl ? 'Replace' : 'Certificate'}
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-[40px] items-center rounded-xl border border-gray-200 px-4 text-xs font-bold text-tm-navy hover:border-tm-navy"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          className="inline-flex min-h-[40px] items-center rounded-xl bg-tm-navy px-4 text-xs font-bold text-white hover:bg-tm-navy-hover"
        >
          Save
        </button>
      </div>
    </div>
  )
}

function Thumb({ url }: { url: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-cover"
    />
  ) : (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-dashed border-gray-200 bg-tm-bg text-gray-500">
      <Award aria-hidden size={16} />
    </span>
  )
}

function blank(field2Key: Field2Key): Credential {
  return { title: '', year: '', fileName: '', fileUrl: '', [field2Key]: '' }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
