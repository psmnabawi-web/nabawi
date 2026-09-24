import { AlertTriangle, Camera, CheckCircle2, Copy, ExternalLink, Link2, Unlink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { useCollection, useDocument } from '../../hooks/useFirestore'
import { useIntegrationStatus } from '../../hooks/useIntegrationStatus'
import { useStoreScope } from '../../hooks/useStoreScope'
import { useToast } from '../../hooks/useToast'
import { isAdmin, saveSocialSettings, socialAccountsQuery } from '../../services/firestore'
import { manageSocialAccount, socialConnect } from '../../services/functions'
import type { AppSettings, SocialAccount } from '../../types'
import { errorMessage } from '../../utils/errors'
import { formatDate } from '../../utils/format'
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, SelectInput, Skeleton, Switch } from '../ui'

function CopyField({ value }: { value: string }) {
  const toast = useToast()
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <code className="min-w-0 flex-1 truncate text-xs text-slate-800">{value}</code>
      <button
        type="button"
        className="rounded-lg p-1.5 text-slate-500 hover:bg-white hover:text-slate-800"
        aria-label="Copy"
        onClick={() => navigator.clipboard.writeText(value).then(() => toast.success('Copied.'), () => toast.error('Copy failed.'))}
      >
        <Copy className="size-4" />
      </button>
    </div>
  )
}

function SetupGuide({ redirectUri, appIdSet }: { redirectUri: string; appIdSet: boolean }) {
  const steps = [
    <>
      Open{' '}
      <a className="font-medium text-brand-800 underline" href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer">
        developers.facebook.com/apps
      </a>{' '}
      → <strong>Create app</strong> → use case <em>Manage messaging &amp; content on Instagram</em>.
    </>,
    <>
      In the app: <strong>Instagram → API setup with Instagram login</strong>. Note the <em>Instagram app ID</em> and <em>Instagram app secret</em>.
    </>,
    <>
      Under <strong>Set up Instagram business login → Business login settings</strong>, add this OAuth redirect URI:
      <div className="mt-2">
        <CopyField value={redirectUri} />
      </div>
    </>,
    <>
      <strong>App roles → Roles → Instagram testers</strong>: add each Instagram account you want to post to (Business or Creator), then accept the invite in the Instagram app (Settings → Apps and websites → Tester invites).
    </>,
    <>
      On your laptop, in the <code>paint-ai</code> folder: add <code>INSTAGRAM_APP_ID=…</code> to <code>functions/.env</code>, run{' '}
      <code>npx firebase-tools functions:secrets:set INSTAGRAM_APP_SECRET --project &lt;project-id&gt;</code> and deploy functions.
    </>,
    <>Come back here and click <strong>Connect Instagram account</strong>.</>,
  ]
  return (
    <div className="space-y-3">
      <Alert kind="info" title="Instagram posting is not set up yet">
        {appIdSet ? 'The Instagram app secret is missing on the server.' : 'The server has no Instagram app ID yet.'} It takes about 15 minutes, once.
      </Alert>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-slate-700">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">{i + 1}</span>
            <div className="min-w-0 flex-1">{s}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function AccountRow({ account, editable }: { account: SocialAccount; editable: boolean }) {
  const toast = useToast()
  const { stores } = useStoreScope()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const expires = account.tokenExpiresAt ? formatDate(account.tokenExpiresAt) : null

  const setStore = async (storeId: string) => {
    setBusy(true)
    try {
      await manageSocialAccount({ accountId: account.id, storeId })
      toast.success(`@${account.username} now posts for ${storeId === 'ALL' ? 'all stores' : stores.find((s) => s.id === storeId)?.storeName ?? storeId}.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const disconnect = async () => {
    setBusy(true)
    try {
      await manageSocialAccount({ accountId: account.id, disconnect: true })
      toast.success(`@${account.username} disconnected.`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {account.pictureUrl ? (
          <img src={account.pictureUrl} alt="" className="size-11 rounded-full object-cover ring-2 ring-white" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-white">
            <Camera className="size-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
            <a href={`https://www.instagram.com/${account.username}/`} target="_blank" rel="noopener noreferrer" className="hover:underline">
              @{account.username}
            </a>
            {account.status === 'connected' ? (
              <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200">
                <CheckCircle2 className="size-3" aria-hidden /> Connected
              </Badge>
            ) : (
              <Badge className="bg-amber-50 text-amber-800 ring-amber-200">
                <AlertTriangle className="size-3" aria-hidden /> Reconnect needed
              </Badge>
            )}
          </p>
          <p className="text-xs text-slate-500">
            Instagram {account.accountType === 'MEDIA_CREATOR' ? 'Creator' : 'Business'}
            {expires && <> · access renews automatically (current until {expires})</>}
          </p>
          {account.error && <p className="mt-0.5 text-xs text-amber-700">{account.error}</p>}
        </div>
      </div>
      <div className="flex items-end gap-2 sm:w-80">
        <SelectInput
          wrapperClassName="flex-1"
          label="Posts for"
          value={account.storeId}
          disabled={!editable || busy}
          onChange={(e) => setStore(e.target.value)}
          options={[{ value: 'ALL', label: 'All stores (brand account)' }, ...stores.map((s) => ({ value: s.id, label: s.storeName }))]}
        />
        {editable && <Button variant="ghost" aria-label={`Disconnect @${account.username}`} title="Disconnect" icon={<Unlink className="size-4" />} disabled={busy} onClick={() => setConfirm(true)} />}
      </div>
      <ConfirmDialog
        open={confirm}
        title={`Disconnect @${account.username}?`}
        message="Scheduled posts for this account will fail until it is connected again."
        confirmLabel="Disconnect"
        danger
        loading={busy}
        onConfirm={disconnect}
        onClose={() => setConfirm(false)}
      />
    </li>
  )
}

export function SocialAccountsTab() {
  const { profile } = useAuth()
  const admin = isAdmin(profile)
  const toast = useToast()
  const status = useIntegrationStatus(true)
  const accounts = useCollection<SocialAccount>(() => socialAccountsQuery(), [])
  const settings = useDocument<AppSettings>('settings/app')
  const [params, setParams] = useSearchParams()
  const [connecting, setConnecting] = useState(false)
  const [savingAuto, setSavingAuto] = useState(false)
  const ig = status.data?.social?.instagram
  const autoPost = settings.data?.social?.autoPost === true

  // Result of the OAuth round trip (?connected=@name or ?social_error=…), shown once.
  const announced = useRef('')
  useEffect(() => {
    const connected = params.get('connected')
    const failed = params.get('social_error')
    if (!connected && !failed) return
    const key = `${connected}|${failed}`
    if (announced.current !== key) {
      announced.current = key
      if (connected) toast.success(`${connected} connected. It can now post Reels.`)
      if (failed) toast.error(failed)
    }
    const next = new URLSearchParams(params)
    next.delete('connected')
    next.delete('social_error')
    setParams(next, { replace: true })
  }, [params, setParams, toast])

  const connect = async () => {
    setConnecting(true)
    try {
      const { url } = await socialConnect({ platform: 'instagram' })
      window.location.assign(url)
    } catch (err) {
      toast.error(errorMessage(err))
      setConnecting(false)
    }
  }
  const toggleAuto = async (next: boolean) => {
    setSavingAuto(true)
    try {
      await saveSocialSettings({ autoPost: next })
      toast.success(next ? 'Finished videos will be posted to Instagram automatically.' : 'Auto-posting is off. Videos are posted after review.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSavingAuto(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader
          title="Instagram accounts"
          subtitle="Reels are posted through the official Instagram API (professional accounts). Link each account to a store or use it brand-wide."
          action={
            admin && ig?.configured ? (
              <Button icon={<Link2 className="size-4" />} loading={connecting} onClick={connect}>
                Connect Instagram account
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {status.loading || accounts.loading ? (
            <Skeleton className="h-32 w-full" />
          ) : ig && !ig.configured ? (
            <SetupGuide redirectUri={ig.redirectUri} appIdSet={ig.appIdSet} />
          ) : accounts.data.length ? (
            <ul className="divide-y divide-slate-100">
              {accounts.data.map((a) => (
                <AccountRow key={a.id} account={a} editable={admin} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Camera className="size-5" />} title="No Instagram account connected" description={admin ? 'Click “Connect Instagram account” and log in with the Instagram account that should post.' : 'Ask the super admin to connect the store Instagram accounts.'} />
          )}
          {accounts.error && <Alert>{accounts.error}</Alert>}
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Posting rules" />
          <CardBody className="space-y-4">
            <Switch
              label="Auto-post finished videos"
              description="Posts every newly finished video to Instagram right away with its AI caption (store account first, otherwise the brand account). Recommended OFF: review each video and caption, then post or schedule with one click."
              checked={autoPost}
              disabled={!admin || savingAuto}
              onChange={toggleAuto}
            />
            {autoPost && <Alert kind="warning">AI videos can contain mistakes (odd text, artefacts). With auto-post on, they go live without anyone checking them.</Alert>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Other platforms" />
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p>
              <strong>TikTok &amp; YouTube Shorts:</strong> their APIs keep uploads private until the app passes a platform audit. Until then, use the AI captions (Post → Captions) and upload with the download button; add trending music in the app.
            </p>
            <a href="https://developers.tiktok.com/doc/content-sharing-guidelines" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-800 hover:underline">
              TikTok content sharing guidelines <ExternalLink className="size-3" />
            </a>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
