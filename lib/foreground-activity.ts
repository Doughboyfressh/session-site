type ActivityEnvironment = {
  now: () => number;
  visible: () => boolean;
  send: () => Promise<boolean>;
};

const INTERVAL = 5 * 60 * 1000;
const RETRY_DELAY = 60 * 1000;

// Shared across client route changes. Serialize requests so the first visitor
// cookie is established before another route records activity in this tab.
export function createForegroundActivity(environment: ActivityEnvironment) {
  let lastSuccess: number | null = null;
  let lastDay = '';
  let retryAt = 0;
  let inFlight: Promise<void> | null = null;
  let queuedVisit = false;

  function record(visit = false): Promise<void> {
    if (!environment.visible()) return Promise.resolve();
    const now = environment.now();
    if (
      !Number.isSafeInteger(now) || now < 0 ||
      now > 8640000000000000 || now < retryAt
    )
      return Promise.resolve();
    const day = new Date(now).toISOString().slice(0, 10);
    if (inFlight) {
      if (visit) queuedVisit = true;
      return inFlight;
    }
    if (
      !visit && lastSuccess !== null && lastDay === day &&
      now >= lastSuccess && now - lastSuccess < INTERVAL
    ) return Promise.resolve();

    inFlight = Promise.resolve().then(environment.send).then((success) => {
      if (success) {
        lastSuccess = now;
        lastDay = day;
        retryAt = 0;
      } else {
        retryAt = environment.now() + RETRY_DELAY;
      }
    }).catch(() => {
      retryAt = environment.now() + RETRY_DELAY;
    }).finally(() => {
      inFlight = null;
      if (queuedVisit) {
        queuedVisit = false;
        void record(true);
      }
    });
    return inFlight;
  }

  return { record };
}
