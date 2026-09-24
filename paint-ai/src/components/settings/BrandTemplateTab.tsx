import { Camera, Clock, Globe, MapPin, MessageCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useDocument } from '../../hooks/useFirestore'
import { useToast } from '../../hooks/useToast'
import { isAdmin, saveBrandKit } from '../../services/firestore'
import type { AppSettings, BrandKit } from '../../types'
import { brandKitOf } from '../../utils/brandKit'
import { BRAND } from '../../utils/constants'
import { errorMessage } from '../../utils/errors'
import { Button, Card, CardBody, CardHeader, Skeleton, Switch, TextInput } from '../ui'

const DEFAULT_CTA = 'Konsultasikan warna rumahmu di toko kami'
const RAINBOW = ['#C0267A', '#7B2F9E', '#F2B705', '#4FA82E', '#1E88E5']

function RainbowBar({ className }: { className?: string }) {
  return (
    <div className={`flex overflow-hidden rounded-full ${className ?? ''}`} aria-hidden>
      {RAINBOW.map((c) => (
        <span key={c} className="flex-1" style={{ backgroundColor: c }} />
      ))}
    </div>
  )
}

/** Phone-sized mock of the rendered template (same layout as the server renderer, scaled down). */
function PhoneFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="relative aspect-[9/16] w-full max-w-[210px] overflow-hidden rounded-[22px] bg-slate-900 shadow-soft ring-4 ring-slate-900" aria-hidden>
        {children}
      </div>
      <figcaption className="text-xs text-slate-500">{label}</figcaption>
    </figure>
  )
}

function Preview({ kit }: { kit: BrandKit }) {
  const rows: { icon: ReactNode; color: string; text: string }[] = [
    { icon: <MapPin className="size-2.5" />, color: '#C0267A', text: 'Nama toko - alamat (dari Settings → Stores)' },
    ...(kit.whatsapp ? [{ icon: <MessageCircle className="size-2.5" />, color: '#16A34A', text: `WhatsApp ${kit.whatsapp}` }] : []),
    ...(kit.instagram ? [{ icon: <Camera className="size-2.5" />, color: '#7B2F9E', text: kit.instagram.startsWith('@') ? kit.instagram : `@${kit.instagram}` }] : []),
    ...(kit.website ? [{ icon: <Globe className="size-2.5" />, color: '#1E88E5', text: kit.website }] : []),
    ...(kit.hours ? [{ icon: <Clock className="size-2.5" />, color: '#F2B705', text: kit.hours }] : []),
  ]
  return (
    <div className="grid grid-cols-2 gap-4">
      <PhoneFrame label="Opening: logo, stage label & hook">
        <div className="absolute inset-0 bg-gradient-to-b from-[#6b7f5a] via-[#8c9a78] to-[#4a5a3e]" />
        <div className="absolute top-[4.5%] left-[4%] flex items-center gap-1 rounded-full bg-white/95 py-0.5 pr-2 pl-1 shadow">
          <img src={BRAND.markUrl} alt="" className="h-3.5 w-auto" />
          <span className="text-[8px] font-extrabold text-[#13295B]">Inti Warna</span>
        </div>
        <span className="absolute top-[10.5%] left-[4%] rounded-md bg-slate-900 px-1.5 py-0.5 text-[8px] font-extrabold tracking-wider text-white">• SEBELUM</span>
        <div className="absolute inset-x-[5%] top-[20%] flex flex-col items-center gap-1">
          <span className="rounded-full bg-[#FFC928] px-2 py-0.5 text-[7px] font-extrabold tracking-wider text-[#13295B]">SEBELUM &amp; SESUDAH</span>
          <div className="w-full overflow-hidden rounded-lg bg-[#13295B]/95 shadow">
            <RainbowBar className="h-1 rounded-none" />
            <p className="px-2 py-1.5 text-center text-[11px] leading-tight font-extrabold text-white">Kamar sempit jadi terasa lega!</p>
          </div>
        </div>
        {kit.captions && (
          <p className="absolute inset-x-[7%] bottom-[23.5%] rounded-md border-l-4 border-[#4FA82E] bg-white/95 px-2 py-1 text-center text-[9px] font-extrabold text-[#13295B] shadow">Caption tiap scene</p>
        )}
      </PhoneFrame>
      <PhoneFrame label={kit.endCard ? 'End card (last 3 seconds)' : 'End card is off'}>
        {kit.endCard ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#FFFDF8] px-3">
            <div className="absolute -top-8 -right-8 size-24 rounded-full bg-[#C0267A]/10" />
            <div className="absolute -bottom-10 -left-8 size-28 rounded-full bg-[#F2B705]/15" />
            <img src={BRAND.logoUrl} alt="" className="relative w-[80%]" />
            <RainbowBar className="relative h-1 w-10" />
            <p className="relative text-center text-[10px] leading-tight font-extrabold text-[#13295B]">{kit.ctaText || DEFAULT_CTA}</p>
            <ul className="relative w-full space-y-1 rounded-lg bg-white p-2 shadow">
              {rows.map((r) => (
                <li key={r.text} className="flex items-center gap-1.5 text-[7px] font-semibold text-slate-700">
                  <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${r.color}22`, color: r.color }}>
                    {r.icon}
                  </span>
                  <span className="truncate">{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-[10px] text-slate-500">No end card</div>
        )}
      </PhoneFrame>
    </div>
  )
}

function BrandKitForm({ initial, editable }: { initial: BrandKit; editable: boolean }) {
  const toast = useToast()
  const [kit, setKit] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof BrandKit>(k: K, v: BrandKit[K]) => setKit((prev) => ({ ...prev, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      await saveBrandKit({
        ...kit,
        instagram: kit.instagram.trim(),
        whatsapp: kit.whatsapp.trim(),
        website: kit.website.trim(),
        hours: kit.hours.trim(),
        ctaText: kit.ctaText.trim(),
      })
      toast.success('Brand template saved. It applies to videos finished from now on.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_460px]">
      <Card>
        <CardHeader title="Inti Warna video template" subtitle="Applied automatically when a generated video is assembled. A clean copy without branding is always saved too." />
        <CardBody className="space-y-6">
          <div className="space-y-4">
            <Switch label="Apply template to new videos" description="Logo, hook title, stage labels (Before/After template) and transitions. Can be switched off per video in Video Studio." checked={kit.enabled} onChange={(v) => set('enabled', v)} disabled={!editable} />
            <Switch label="Scene captions" description="Short caption per clip, written by the AI from the script." checked={kit.captions} onChange={(v) => set('captions', v)} disabled={!editable} />
            <Switch label="End card" description="3-second closing card with the logo, call to action and contact details." checked={kit.endCard} onChange={(v) => set('endCard', v)} disabled={!editable} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Instagram" placeholder="@akun_instagram" maxLength={60} value={kit.instagram} disabled={!editable} onChange={(e) => set('instagram', e.target.value)} />
            <TextInput label="WhatsApp" placeholder="08xx-xxxx-xxxx" maxLength={30} value={kit.whatsapp} disabled={!editable} onChange={(e) => set('whatsapp', e.target.value)} />
            <TextInput label="Website (optional)" placeholder="www.contoh.co.id" maxLength={80} value={kit.website} disabled={!editable} onChange={(e) => set('website', e.target.value)} />
            <TextInput label="Opening hours" placeholder="Setiap hari 07.30 - 17.30 WIB" maxLength={60} value={kit.hours} disabled={!editable} onChange={(e) => set('hours', e.target.value)} />
            <TextInput
              wrapperClassName="sm:col-span-2"
              label="Default call to action"
              placeholder={DEFAULT_CTA}
              maxLength={80}
              value={kit.ctaText}
              disabled={!editable}
              onChange={(e) => set('ctaText', e.target.value)}
              hint="Used on the end card when the script has no CTA text. Store name and address come from Settings → Stores."
            />
          </div>
          {editable ? (
            <div className="flex justify-end">
              <Button loading={saving} onClick={save}>
                Save template
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Only the super admin can change the template.</p>
          )}
        </CardBody>
      </Card>
      <Card className="self-start">
        <CardHeader title="Preview" subtitle="Layout of the rendered 9:16 video (text comes from the AI plan / script)." />
        <CardBody>
          <Preview kit={kit} />
        </CardBody>
      </Card>
    </div>
  )
}

export function BrandTemplateTab() {
  const { profile } = useAuth()
  const settings = useDocument<AppSettings>('settings/app')
  if (settings.loading) return <Skeleton className="h-96 w-full" />
  // Remount when the stored settings change so the form shows the saved values.
  return <BrandKitForm key={settings.data?.updatedAt?.toMillis?.() ?? 'none'} initial={brandKitOf(settings.data)} editable={isAdmin(profile)} />
}
