import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import type { WorkerClient } from './worker-client.js'
import type { RequestInput } from './worker-protocol.js'
import { MessageEvidence } from './message-evidence.js'
export function WorkerMessage({
  client,
  request,
  role,
  preview,
  metadata,
}: {
  client: WorkerClient
  request: Extract<RequestInput, { type: 'message-content' | 'temporal-content' }>
  role: string
  preview: string
  metadata: ComponentChildren
}) {
  const [content, setContent] = useState<string>()
  const [error, setError] = useState<string>()
  const controller = useRef<AbortController>()
  useEffect(() => () => controller.current?.abort(), [])
  const load = () => {
    if (controller.current && !controller.current.signal.aborted) return
    controller.current = new AbortController()
    const signal = controller.current.signal
    setError(undefined)
    void client.request(request, { signal }).then(
      result => {
        if (!signal.aborted) setContent(result.contents[0]?.body ?? '')
      },
      (error: unknown) => {
        if (!signal.aborted) setError(error instanceof Error ? error.message : String(error))
        controller.current = undefined
      }
    )
  }
  return (
    <MessageEvidence role={role} preview={preview} metadata={metadata} content={content} error={error} onLoad={load} />
  )
}
