const MAX_CACHE_BYTES = 50 * 1024 * 1024

export interface Entry {
  sha: string
  contentType: string
  bytes: Buffer
}

// Insertion-ordered Map used as an LRU, one entry per doc id (a new sha replaces the old one).
export const cache = new Map<string, Entry>()
let cacheBytes = 0

export function resetFileCache() {
  cache.clear()
  cacheBytes = 0
}

export function remember(id: string, entry: Entry) {
  const old = cache.get(id)
  if (old) {
    cacheBytes -= old.bytes.length
    cache.delete(id)
  }
  if (entry.bytes.length > MAX_CACHE_BYTES) return
  cache.set(id, entry)
  cacheBytes += entry.bytes.length
  for (const [k, v] of cache) {
    if (cacheBytes <= MAX_CACHE_BYTES) break
    cache.delete(k)
    cacheBytes -= v.bytes.length
  }
}

