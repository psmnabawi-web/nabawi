import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { AuditLogTab } from '../components/settings/AuditLogTab'
import { BrandTemplateTab } from '../components/settings/BrandTemplateTab'
import { SocialAccountsTab } from '../components/settings/SocialAccountsTab'
import { DemoDataTab } from '../components/settings/DemoDataTab'
import { IntegrationsTab } from '../components/settings/IntegrationsTab'
import { ProfileTab } from '../components/settings/ProfileTab'
import { StoresTab } from '../components/settings/StoresTab'
import { UsersTab } from '../components/settings/UsersTab'
import { PageHeader, Tabs } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { isAdmin, isContentManager } from '../services/firestore'

type Tab = 'profile' | 'stores' | 'users' | 'integrations' | 'brand' | 'social' | 'demo' | 'audit'

export default function SettingsPage() {
  const { profile } = useAuth()
  const admin = isAdmin(profile)
  const manager = isContentManager(profile)
  const [params] = useSearchParams()
  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    ...(admin ? [{ id: 'stores' as Tab, label: 'Stores' }, { id: 'users' as Tab, label: 'Users & roles' }] : []),
    ...(manager ? [{ id: 'integrations' as Tab, label: 'AI & Integrations' }, { id: 'brand' as Tab, label: 'Brand template' }, { id: 'social' as Tab, label: 'Social accounts' }] : []),
    ...(admin ? [{ id: 'demo' as Tab, label: 'Demo data' }, { id: 'audit' as Tab, label: 'Audit log' }] : []),
  ]
  // Deep link: /settings?tab=stores (ignored when the tab is not available for this role).
  const requested = params.get('tab')
  const [tab, setTab] = useState<Tab>(() => tabs.find((t) => t.id === requested)?.id ?? 'profile')
  return (
    <>
      <PageHeader title="Settings" description={admin ? 'Stores, users, AI providers, brand template and audit trail.' : 'Your profile and access.'} />
      <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-5">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'stores' && admin && <StoresTab />}
        {tab === 'users' && admin && <UsersTab />}
        {tab === 'integrations' && manager && <IntegrationsTab />}
        {tab === 'brand' && manager && <BrandTemplateTab />}
        {tab === 'social' && manager && <SocialAccountsTab />}
        {tab === 'demo' && admin && <DemoDataTab />}
        {tab === 'audit' && admin && <AuditLogTab />}
      </div>
    </>
  )
}
