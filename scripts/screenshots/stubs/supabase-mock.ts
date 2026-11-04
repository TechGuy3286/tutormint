// A browser Supabase client that never reaches a server — for screenshots only.
// Every query answers from window.__FIXTURES[table] (INVENTED data).
type Rows = Record<string, unknown>[]
const fixtures = (): Record<string, Rows> => ((window as unknown as { __FIXTURES?: Record<string, Rows> }).__FIXTURES ?? {})

function chain(table: string) {
  const rows = () => fixtures()[table] ?? []
  const q: Record<string, unknown> = {}
  const self = new Proxy(q, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => void) => res({ data: rows(), error: null })
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: rows()[0] ?? null, error: null })
      return () => self
    },
  })
  return self
}

const client = {
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: 'u-invented', email: 'ayesha.example@gmail.com', app_metadata: {} } }, error: null }),
    getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  from: (t: string) => chain(t),
  rpc: () => Promise.resolve({ data: [], error: null }),
  storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel() {},
}

export function createClient() {
  return client as never
}
export function getBrowserClient() {
  return Promise.resolve(client as never)
}
