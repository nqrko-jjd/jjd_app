/** Project durable pending actions over the last known server timer. */
interface Timer { id: string; startedAt: string; worksiteId?: string | null; worksite: { ref: string; title: string } | null }
export function projectTimer(base: Timer | null, calls: { id: string; path: string; body: unknown }[], events: { worksite: { id: string; ref: string; title: string } }[]): Timer | null {
  let timer = base;
  for (const call of calls) {
    const body = call.body as { startedAt?: string; worksiteId?: string } | undefined;
    if (call.path === '/api/timesheet/timer/start' && body?.startedAt) {
      timer = { id: call.id, startedAt: body.startedAt, worksiteId: body.worksiteId,
        worksite: events.find(e => e.worksite.id === body.worksiteId)?.worksite ?? null };
    } else if (call.path === '/api/timesheet/timer/stop') timer = null;
  }
  return timer;
}
