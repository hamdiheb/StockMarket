// Tiny in-memory promise cache. Concurrent callers share one in-flight request,
// and failures are evicted immediately so the next call retries.
const store = new Map()

function remember(key, ttlMs, promise) {
  const guarded = promise.catch((err) => {
    if (store.get(key)?.promise === guarded) store.delete(key)
    throw err
  })
  // Primed entries may never be read; mark them handled so a failure can't crash the process.
  guarded.catch(() => {})
  store.set(key, { promise: guarded, expires: Date.now() + ttlMs })
  return guarded
}

export function peek(key) {
  const hit = store.get(key)
  return hit && hit.expires > Date.now() ? hit.promise : null
}

export function cached(key, ttlMs, load) {
  return peek(key) ?? remember(key, ttlMs, load())
}

// Drops every entry whose key starts with `prefix`, so the next call fetches fresh.
export function forget(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
}

// Stores a value that was fetched as part of a larger (batched) request.
export function prime(key, ttlMs, promise) {
  return remember(key, ttlMs, promise)
}
