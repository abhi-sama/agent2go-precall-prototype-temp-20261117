"use client"

/**
 * The offline store deliberately has no network or AppSync knowledge. It holds only encrypted MSL
 * brief/HCP payloads and mutation inputs.  Owner and scope metadata remain outside the ciphertext so
 * records can be removed without decrypting them; sensitive values never do.
 */
const DATABASE = "a2g-offline-v1"
const VERSION = 1
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export interface OfflineScope {
  ownerId: string
  scopeLabel: string
  enabled: boolean
}

type StoreName = "keys" | "cache" | "queue"

interface KeyRecord { id: string; key: CryptoKey }
interface CipherRecord {
  id: string
  ownerId: string
  scopeId: string
  kind: "brief" | "brief-list" | "hcp"
  key: string
  expiresAt: number
  iv: Uint8Array
  ciphertext: ArrayBuffer
}
export interface QueuedMutation {
  id: string
  ownerId: string
  scopeId: string
  operation: "flagIssue" | "saveBriefEdits"
  dedupeKey: string
  createdAt: number
  iv: Uint8Array
  ciphertext: ArrayBuffer
}

function scopeId(scope: OfflineScope) {
  return `${scope.ownerId}:${scope.scopeLabel}`
}

function supported() {
  return typeof window !== "undefined" && "indexedDB" in window && "crypto" in window && "subtle" in window.crypto
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys", { keyPath: "id" })
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "id" })
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(store: StoreName, mode: IDBTransactionMode, action: (value: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(store, mode).objectStore(store))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

async function all<T>(store: StoreName): Promise<T[]> {
  return transaction(store, "readonly", (value) => value.getAll() as IDBRequest<T[]>)
}

async function getKey(scope: OfflineScope): Promise<CryptoKey> {
  const id = scopeId(scope)
  const existing = await transaction<KeyRecord | undefined>("keys", "readonly", (store) => store.get(id))
  if (existing?.key) return existing.key
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
  await transaction("keys", "readwrite", (store) => store.put({ id, key } satisfies KeyRecord))
  return key
}

function encode(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)) }
function decode<T>(value: ArrayBuffer) { return JSON.parse(new TextDecoder().decode(value)) as T }

async function encrypt(scope: OfflineScope, value: unknown) {
  const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)))
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(scope), encode(value))
  return { iv, ciphertext }
}

async function decrypt<T>(scope: OfflineScope, record: { iv: Uint8Array; ciphertext: ArrayBuffer }) {
  return decode<T>(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(record.iv) }, await getKey(scope), record.ciphertext))
}

export async function cacheOfflineValue(scope: OfflineScope, kind: CipherRecord["kind"], key: string, value: unknown, expiresAt = Date.now() + CACHE_TTL_MS) {
  if (!scope.enabled || !supported()) return
  const encrypted = await encrypt(scope, value)
  const record: CipherRecord = { id: `${scopeId(scope)}:${kind}:${key}`, ownerId: scope.ownerId, scopeId: scopeId(scope), kind, key, expiresAt, ...encrypted }
  await transaction("cache", "readwrite", (store) => store.put(record))
}

export async function readOfflineValue<T>(scope: OfflineScope, kind: CipherRecord["kind"], key: string): Promise<T | null> {
  if (!scope.enabled || !supported()) return null
  const id = `${scopeId(scope)}:${kind}:${key}`
  const record = await transaction<CipherRecord | undefined>("cache", "readonly", (store) => store.get(id))
  if (!record) return null
  if (record.expiresAt <= Date.now()) {
    await transaction("cache", "readwrite", (store) => store.delete(id))
    return null
  }
  try {
    return await decrypt<T>(scope, record)
  } catch {
    // A changed or missing non-extractable key must never expose stale ciphertext.
    await transaction("cache", "readwrite", (store) => store.delete(id))
    return null
  }
}

/** Deterministic serialization makes an interrupted retry collapse to the same queue item. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export async function enqueueOfflineMutation(scope: OfflineScope, operation: QueuedMutation["operation"], input: unknown): Promise<QueuedMutation | null> {
  if (!scope.enabled || !supported()) return null
  const dedupeKey = `${operation}:${stableJson(input)}`
  const existing = (await all<QueuedMutation>("queue")).find((item) => item.scopeId === scopeId(scope) && item.dedupeKey === dedupeKey)
  if (existing) return existing
  const encrypted = await encrypt(scope, input)
  const item: QueuedMutation = {
    id: crypto.randomUUID(), ownerId: scope.ownerId, scopeId: scopeId(scope), operation, dedupeKey, createdAt: Date.now(), ...encrypted,
  }
  await transaction("queue", "readwrite", (store) => store.put(item))
  return item
}

export async function queuedMutationInput<T>(scope: OfflineScope, item: QueuedMutation): Promise<T | null> {
  try { return await decrypt<T>(scope, item) } catch { return null }
}

export async function offlineQueueCount(scope: OfflineScope): Promise<number> {
  if (!scope.enabled || !supported()) return 0
  return (await all<QueuedMutation>("queue")).filter((item) => item.scopeId === scopeId(scope)).length
}

/** Queue metadata is safe to enumerate; the mutation input remains encrypted until delivery. */
export async function offlineQueuedMutations(scope: OfflineScope): Promise<QueuedMutation[]> {
  if (!scope.enabled || !supported()) return []
  return (await all<QueuedMutation>("queue"))
    .filter((item) => item.ownerId === scope.ownerId && item.scopeId === scopeId(scope))
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Expiry is enforced on every read and also swept when the signed-in MSL's offline boundary starts. */
export async function purgeExpiredOfflineData(now = Date.now()) {
  if (!supported()) return
  const expired = (await all<CipherRecord>("cache")).filter((record) => record.expiresAt <= now)
  await Promise.all(expired.map((record) => transaction("cache", "readwrite", (store) => store.delete(record.id))))
}

export async function deleteQueuedMutation(id: string) {
  if (!supported()) return
  await transaction("queue", "readwrite", (store) => store.delete(id))
}

/** Cache deletion includes the non-extractable keys and shell cache so no scope can inherit another's data. */
export async function clearOfflineDataForOwner(ownerId: string) {
  if (!ownerId || !supported()) return
  for (const store of ["keys", "cache", "queue"] as StoreName[]) {
    const rows = await all<{ id: string; ownerId?: string }>(store)
    await Promise.all(rows.filter((row) => row.ownerId === ownerId || row.id.startsWith(`${ownerId}:`)).map((row) => transaction(store, "readwrite", (value) => value.delete(row.id))))
  }
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_OFFLINE" })
}

export async function clearAllOfflineData() {
  if (!supported()) return
  const db = await openDb()
  db.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_OFFLINE" })
}
