import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { errorMessage } from '../utils/errors'

/**
 * Runs an async action with loading + error state and prevents double submission.
 * `run` resolves to the action result, or undefined when it failed (the message is in `error`).
 */
export function useAsyncAction<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = useRef(false)
  const actionRef = useRef(action)
  useLayoutEffect(() => {
    actionRef.current = action
  })

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (running.current) return undefined
    running.current = true
    setLoading(true)
    setError(null)
    try {
      return await actionRef.current(...args)
    } catch (err) {
      console.error(err)
      setError(errorMessage(err))
      return undefined
    } finally {
      running.current = false
      setLoading(false)
    }
  }, [])

  return { run, loading, error, setError }
}
