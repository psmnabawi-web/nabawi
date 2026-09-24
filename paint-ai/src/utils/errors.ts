import { FirebaseError } from 'firebase/app'

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'This email is already registered. Try signing in.',
  'auth/weak-password': 'Password must be at least 8 characters.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
  'auth/popup-blocked': 'Your browser blocked the Google sign-in popup. Allow popups and try again.',
  'auth/network-request-failed': 'Network error. Check your connection.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
}

/** Converts Firebase / callable / unknown errors into a message safe to show to users. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof FirebaseError) {
    if (AUTH_MESSAGES[err.code]) return AUTH_MESSAGES[err.code]
    if (err.code === 'permission-denied' || err.code === 'functions/permission-denied') return err.message && err.code.startsWith('functions/') ? err.message : 'You do not have permission to do this.'
    if (err.code === 'unavailable') return 'Service is temporarily unavailable. You may be offline.'
    if (err.code === 'functions/deadline-exceeded') return 'The AI is taking longer than expected. Refresh in a minute — results are saved when ready.'
    if (err.code.startsWith('functions/')) return err.message || fallback
    return err.message || fallback
  }
  if (err instanceof Error) return err.message || fallback
  return fallback
}
