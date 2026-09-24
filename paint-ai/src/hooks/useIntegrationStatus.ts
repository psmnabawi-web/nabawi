import { useCallback, useEffect, useState } from 'react'
import { getIntegrationStatus } from '../services/functions'
import type { IntegrationStatus } from '../types'
import { errorMessage } from '../utils/errors'

/** Which AI / video providers are configured on the backend (content managers only). */
export function useIntegrationStatus(enabled: boolean) {
  const [data, setData] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const result = await getIntegrationStatus({})
      setData(result)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, 'Could not load integration status.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- async fetch; state is only set after the request resolves
    if (enabled) void fetchStatus()
  }, [enabled, fetchStatus])

  const reload = useCallback(async () => {
    setLoading(true)
    await fetchStatus()
  }, [fetchStatus])

  return { data, loading: enabled && loading, error, reload }
}
