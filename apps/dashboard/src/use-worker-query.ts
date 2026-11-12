import { useEffect, useState } from 'preact/hooks'
import type { WorkerClient } from './worker-client.js'
import type { RequestInput, Results } from './worker-protocol.js'
export type QueryState<T> = { kind: 'loading' } | { kind: 'ready'; value: T } | { kind: 'error'; message: string }
export function useWorkerQuery<R extends RequestInput>(
  client: WorkerClient,
  request: R | undefined
): QueryState<Results[R['type']]> {
  const [state, setState] = useState<QueryState<Results[R['type']]>>({ kind: 'loading' })
  useEffect(() => {
    if (!request) return
    const controller = new AbortController()
    setState({ kind: 'loading' })
    void client.request(request, { signal: controller.signal }).then(
      value => setState({ kind: 'ready', value }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    )
    return () => controller.abort()
  }, [client, request])
  return state
}
