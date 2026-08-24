'use client'

import { useState } from 'react'
import { DoorOpen } from 'lucide-react'

const CODE_RE = /^[A-Z0-9]{4,6}$/

export function JoinForm({
  onJoin,
  initialCode = '',
  initialName = '',
}: {
  onJoin: (code: string, name: string) => void
  initialCode?: string
  initialName?: string
}) {
  const [code, setCode] = useState(initialCode.toUpperCase().slice(0, 6))
  const [name, setName] = useState(initialName.slice(0, 16))
  const [touched, setTouched] = useState(false)
  const valid = CODE_RE.test(code) && name.trim().length >= 1

  return (
    <form
      className="w-full max-w-sm"
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (valid) onJoin(code, name.trim())
      }}
    >
      <label className="mb-1.5 block text-[0.65rem] uppercase tracking-widest2 text-bone-faint">
        The house&apos;s mark
      </label>
      <input
        value={code}
        onChange={(e) =>
          setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))
        }
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        placeholder="ABC123"
        className="wsp-input mb-5 text-center font-display text-3xl tracking-[0.35em]"
      />

      <label className="mb-1.5 block text-[0.65rem] uppercase tracking-widest2 text-bone-faint">
        What shall it call you
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 16))}
        autoComplete="off"
        placeholder="A name it can whisper"
        className="wsp-input mb-7"
      />

      {(touched && !CODE_RE.test(code)) || (touched && !name.trim()) ? (
        <p className="-mt-4 mb-4 text-center text-xs text-blood-bright">
          A full mark and a name are required.
        </p>
      ) : null}

      <button type="submit" disabled={!valid} className="wsp-btn-primary w-full disabled:opacity-40">
        <DoorOpen size={18} className="inline" /> Enter the house
      </button>
    </form>
  )
}
