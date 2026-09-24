import { BarChart3, Clapperboard, Sparkles, TrendingUp } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Brand } from '../components/layout/Sidebar'
import { Alert, Button, PageLoader, TextInput } from '../components/ui'
import { isFirebaseConfigured } from '../firebase/config'
import { useAuth } from '../hooks/useAuth'
import { errorMessage } from '../utils/errors'
import { fieldErrors, signInSchema, signUpSchema } from '../utils/validation'

type Mode = 'signin' | 'signup' | 'reset'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  )
}

export default function LoginPage() {
  const { user, loading, signIn, signUp, signInWithGoogle, resetPassword } = useAuth()
  const location = useLocation()
  const [mode, setMode] = useState<Mode>('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState<'form' | 'google' | null>(null)

  if (loading) return <PageLoader />
  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setInfo(null)
    setErrors({})
    try {
      if (mode === 'reset') {
        const email = form.email.trim()
        if (!/^\S+@\S+\.\S+$/.test(email)) {
          setErrors({ email: 'Enter a valid email' })
          return
        }
        setBusy('form')
        await resetPassword(email)
        setInfo('If this email is registered, a password reset link has been sent.')
        return
      }
      const schema = mode === 'signup' ? signUpSchema : signInSchema
      const parsed = schema.safeParse(form)
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error))
        return
      }
      setBusy('form')
      if (mode === 'signup') await signUp(form.name, form.email, form.password)
      else await signIn(form.email, form.password)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const google = async () => {
    setFormError(null)
    setBusy('google')
    try {
      await signInWithGoogle()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const features = [
    { icon: TrendingUp, title: 'Trend intelligence', text: 'Score TikTok, Instagram & YouTube trends for paint retail.' },
    { icon: Sparkles, title: 'AI content & scripts', text: '20 ideas per brief and ready-to-shoot scripts.' },
    { icon: Clapperboard, title: 'AI video studio', text: 'Google Veo, Runway, Kling, Pika & HeyGen in one workflow.' },
    { icon: BarChart3, title: 'Performance analytics', text: 'Engagement, leads and sales impact per content.' },
  ]

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-950 p-10 text-white lg:flex">
        <div className="absolute -top-24 -right-24 size-96 rounded-full bg-brand-700/40 blur-3xl" aria-hidden />
        <Brand />
        <div className="relative">
          <h1 className="max-w-md text-3xl font-semibold tracking-tight">AI Content Intelligence & Video Generator for Retail Paint</h1>
          <p className="mt-3 max-w-md text-brand-100/80">From social media trend to published video — and the numbers to prove it worked.</p>
          <ul className="mt-8 grid max-w-lg grid-cols-2 gap-4">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
                <Icon className="size-5 text-brand-300" aria-hidden />
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs text-brand-100/70">{text}</p>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-brand-200/60">Secure sign-in with Firebase Authentication</p>
      </div>

      <div className="flex items-center justify-center bg-slate-50 p-4 sm:p-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 rounded-xl bg-brand-950 p-4 lg:hidden">
            <Brand />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">{mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset password' : 'Sign in'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'signup' ? 'An admin will assign your role and store after you register.' : mode === 'reset' ? 'We will email you a reset link.' : 'Welcome back. Sign in to continue.'}
          </p>

          {!isFirebaseConfigured && (
            <div className="mt-4">
              <Alert kind="warning" title="Firebase is not configured">
                Copy <code>.env.example</code> to <code>.env.local</code> and fill in the web app config.
              </Alert>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {mode === 'signup' && <TextInput label="Full name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} required />}
            <TextInput label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
            {mode !== 'reset' && (
              <TextInput
                label="Password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                required
              />
            )}
            {mode === 'signup' && <TextInput label="Confirm password" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />}

            {formError && <Alert>{formError}</Alert>}
            {info && <Alert kind="info">{info}</Alert>}

            <Button type="submit" className="w-full" size="lg" loading={busy === 'form'} disabled={!!busy}>
              {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            </Button>
          </form>

          {mode !== 'reset' && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
              </div>
              <Button variant="outline" className="w-full" size="lg" icon={<GoogleIcon />} loading={busy === 'google'} disabled={!!busy} onClick={google}>
                Continue with Google
              </Button>
            </>
          )}

          <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
            {mode === 'signin' ? (
              <>
                <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setMode('signup')}>
                  Create an account
                </button>
                <button type="button" className="text-slate-500 hover:underline" onClick={() => setMode('reset')}>
                  Forgot password?
                </button>
              </>
            ) : (
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setMode('signin')}>
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
