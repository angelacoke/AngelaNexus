/**
 * Compose multiple kernel-neutral execution session invalidation sources.
 *
 * Each source receives the same listener and must return an unsubscribe function.
 * Subscription is transactional: if one source fails, earlier subscriptions are
 * rolled back. Unsubscription runs in reverse order.
 */
export function createSessionInvalidationSource(...sources) {
  const validSources = sources.filter(Boolean);
  for (const source of validSources) {
    if (typeof source !== "function") throw new TypeError("session invalidation source must be a function");
  }

  return async function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("session invalidation listener must be a function");
    const unsubscribers = [];
    try {
      for (const source of validSources) {
        const unsubscribe = await source(listener);
        if (typeof unsubscribe !== "function") {
          throw new TypeError("session invalidation source must return an unsubscribe function");
        }
        unsubscribers.push(unsubscribe);
      }
    } catch (error) {
      for (let index = unsubscribers.length - 1; index >= 0; index -= 1) {
        try { await unsubscribers[index](); } catch {}
      }
      throw error;
    }

    return async function unsubscribe() {
      for (let index = unsubscribers.length - 1; index >= 0; index -= 1) {
        await unsubscribers[index]();
      }
    };
  };
}
