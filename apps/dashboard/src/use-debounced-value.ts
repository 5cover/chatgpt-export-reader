import { useEffect, useState } from 'preact/hooks'
export function useDebouncedValue<T>(value: T, milliseconds = 150): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), milliseconds)
    return () => clearTimeout(timer)
  }, [value, milliseconds])
  return settled
}
