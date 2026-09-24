import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useDocument } from '../../hooks/useFirestore'
import { useIntegrationStatus } from '../../hooks/useIntegrationStatus'
import { useToast } from '../../hooks/useToast'
import { isAdmin, saveSettings } from '../../services/firestore'
import type { AppSettings, IntegrationStatus, ProviderStatus, TextProvider, VideoProvider } from '../../types'
import { TEXT_PROVIDERS, VIDEO_PROVIDERS } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { Alert, Button, Card, CardBody, CardHeader, SelectInput, Skeleton, TextArea, TextInput } from '../ui'

function StatusList({ items }: { items: ProviderStatus[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
          {p.configured ? <CheckCircle2 className="size-4 text-emerald-600" aria-label="Configured" /> : <XCircle className="size-4 text-slate-300" aria-label="Not configured" />}
          <span className="font-medium text-slate-900">{p.label}</span>
          <span className="ml-auto truncate text-xs text-slate-500">{p.model}</span>
        </li>
      ))}
    </ul>
  )
}

type SettingsForm = Omit<AppSettings, 'updatedAt' | 'updatedBy'>

export function IntegrationsTab() {
  const { profile } = useAuth()
  const admin = isAdmin(profile)
  const status = useIntegrationStatus(true)
  const settingsDoc = useDocument<AppSettings>('settings/app')
  const s = settingsDoc.data
  const d = status.data?.defaults
  const initial: SettingsForm = {
    textProvider: s?.textProvider ?? d?.textProvider ?? 'gemini',
    videoProvider: s?.videoProvider ?? d?.videoProvider ?? 'runway',
    contentLanguage: s?.contentLanguage ?? d?.contentLanguage ?? 'id',
    brandContext: s?.brandContext ?? '',
    heygenAvatarId: s?.heygenAvatarId ?? '',
    heygenVoiceId: s?.heygenVoiceId ?? '',
  }
  // Remount the form whenever the stored settings or backend defaults change.
  const formKey = `${s?.updatedAt?.toMillis?.() ?? 'none'}-${d?.textProvider ?? ''}-${d?.videoProvider ?? ''}`

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="AI defaults" subtitle={admin ? 'Choose which providers the whole team uses.' : 'Only the super admin can change these settings.'} />
        <CardBody className="space-y-4">
          {settingsDoc.loading ? <Skeleton className="h-48" /> : <SettingsFormFields key={formKey} initial={initial} admin={admin} status={status.data} onSaved={() => void status.reload()} />}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Provider status"
          subtitle="API keys live in Secret Manager — never in the browser."
          action={<Button size="sm" variant="ghost" aria-label="Reload status" icon={<RefreshCw className="size-4" />} loading={status.loading} onClick={() => status.reload()} />}
        />
        <CardBody className="space-y-4">
          {status.error && <Alert>{status.error}</Alert>}
          {status.data ? (
            <>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase">Text AI</p>
                <StatusList items={status.data.text} />
                <p className="text-xs text-slate-400">Gemini auth: {status.data.geminiMode === 'vertex' ? 'Vertex AI (service account)' : 'API key'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase">Video AI</p>
                <StatusList items={status.data.video} />
              </div>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Daily limits per user: {status.data.limits.aiDaily} AI generations, {status.data.limits.videoDaily} videos. You used {status.data.usageToday.ai} / {status.data.usageToday.video} today. Region: {status.data.region}.
              </p>
            </>
          ) : (
            !status.error && <Skeleton className="h-48" />
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function SettingsFormFields({ initial, admin, status, onSaved }: { initial: SettingsForm; admin: boolean; status: IntegrationStatus | null; onSaved: () => void }) {
  const toast = useToast()
  const [form, setForm] = useState<SettingsForm>(initial)
  const [saving, setSaving] = useState(false)
  const configured = (list: ProviderStatus[] | undefined, id: string) => list?.find((p) => p.id === id)?.configured

  const save = async () => {
    setSaving(true)
    try {
      await saveSettings({ ...form, brandContext: form.brandContext.trim(), heygenAvatarId: form.heygenAvatarId.trim(), heygenVoiceId: form.heygenVoiceId.trim() })
      toast.success('Settings saved. New AI requests use them within ~30 seconds.')
      onSaved()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectInput
          label="Text AI provider"
          value={form.textProvider}
          disabled={!admin}
          onChange={(e) => setForm({ ...form, textProvider: e.target.value as TextProvider })}
          options={TEXT_PROVIDERS.map((p) => ({ value: p.id, label: `${p.label}${status && !configured(status.text, p.id) ? ' (not configured)' : ''}` }))}
        />
        <SelectInput
          label="Video AI provider"
          value={form.videoProvider}
          disabled={!admin}
          onChange={(e) => setForm({ ...form, videoProvider: e.target.value as VideoProvider })}
          options={VIDEO_PROVIDERS.map((p) => ({ value: p.id, label: `${p.label}${status && !configured(status.video, p.id) ? ' (not configured)' : ''}` }))}
        />
        <SelectInput
          label="Content language"
          value={form.contentLanguage}
          disabled={!admin}
          onChange={(e) => setForm({ ...form, contentLanguage: e.target.value as 'id' | 'en' })}
          options={[
            { value: 'id', label: 'Bahasa Indonesia' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <TextArea
        label="Brand context for the AI"
        disabled={!admin}
        maxLength={2000}
        value={form.brandContext}
        onChange={(e) => setForm({ ...form, brandContext: e.target.value })}
        placeholder="Who you are, product lines, services (tinting, delivery), tone of voice, things the AI must never say…"
        hint={`${form.brandContext.length}/2000 · sent with every AI request`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInput label="HeyGen avatar ID" disabled={!admin} value={form.heygenAvatarId} onChange={(e) => setForm({ ...form, heygenAvatarId: e.target.value })} />
        <TextInput label="HeyGen voice ID" disabled={!admin} value={form.heygenVoiceId} onChange={(e) => setForm({ ...form, heygenVoiceId: e.target.value })} />
      </div>
      {admin && (
        <div className="flex justify-end">
          <Button loading={saving} onClick={save}>
            Save settings
          </Button>
        </div>
      )}
    </>
  )
}
