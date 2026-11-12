import type { RequestInput, Results, WorkerRequest, WorkerResponse } from './worker-protocol.js'
export class WorkerClient {
  private worker: Worker
  private nextId = 0
  private pending = new Map<
    number,
    { resolve: (message: WorkerResponse) => void; reject: (error: Error) => void; progress?: (detail: string) => void }
  >()
  failed = false
  constructor(private onFailure: (message: string) => void) {
    this.worker = new Worker(new URL('./stats-worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      const pending = this.pending.get(message.requestId)
      if (!pending) return
      if (message.type === 'progress') {
        pending.progress?.(message.detail)
        return
      }
      this.pending.delete(message.requestId)
      if (message.type === 'failure') pending.reject(new Error(message.message))
      else pending.resolve(message)
    })
    this.worker.addEventListener('error', () =>
      this.fail('The analysis worker stopped unexpectedly. Import your export again to restart it.')
    )
    this.worker.addEventListener('messageerror', () =>
      this.fail('The analysis worker returned an unreadable response. Import your export again.')
    )
  }
  private fail(message: string) {
    this.failed = true
    for (const pending of this.pending.values()) pending.reject(new Error(message))
    this.pending.clear()
    this.onFailure(message)
    this.worker.terminate()
  }
  request<R extends RequestInput>(
    request: R,
    options: { signal?: AbortSignal; onProgress?: (detail: string) => void } = {}
  ): Promise<Results[R['type']]> {
    if (this.failed) return Promise.reject(new Error('Import your export again to restart analysis.'))
    if (options.signal?.aborted) return Promise.reject(new DOMException('Request cancelled', 'AbortError'))
    const requestId = ++this.nextId
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(requestId)
        reject(new DOMException('Request cancelled', 'AbortError'))
      }
      const cleanup = () => options.signal?.removeEventListener('abort', abort)
      this.pending.set(requestId, {
        resolve: message => {
          cleanup()
          if (message.type !== request.type) {
            reject(new Error('Unexpected worker response'))
            return
          }
          resolve(message as unknown as Results[R['type']])
        },
        reject: error => {
          cleanup()
          reject(error)
        },
        progress: options.onProgress,
      })
      options.signal?.addEventListener('abort', abort, { once: true })
      const message: WorkerRequest = { ...request, requestId }
      this.worker.postMessage(message)
    })
  }
  close() {
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new DOMException('Worker closed', 'AbortError'))
    this.pending.clear()
  }
}
