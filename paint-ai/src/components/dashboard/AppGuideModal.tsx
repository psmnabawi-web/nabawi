import { ArrowRight, BarChart3, CalendarDays, Clapperboard, FileText, Sparkles, TrendingUp } from 'lucide-react'
import { Link } from 'react-router'
import { Modal } from '../ui'

const STEPS = [
  { icon: TrendingUp, title: 'Trend Intelligence', text: 'Add a TikTok, Instagram or YouTube link. AI scores the trend (0–100), explains why it works and recommends an angle for paint retail.', to: '/trends' },
  { icon: Sparkles, title: 'Content Generator', text: 'Pick a trend, product and audience. AI writes 20 content ideas with hook, caption, CTA and hashtags — edit or delete what you do not need.', to: '/content' },
  { icon: FileText, title: 'Video scripts', text: 'Turn an idea into a 15, 30 or 60-second script: hook, scenes, voice-over and call to action.', to: '/content' },
  { icon: Clapperboard, title: 'Video Studio', text: 'Choose a template, the script and a provider (Google Veo by default). Clips are generated, stitched and saved to Firebase Storage automatically.', to: '/video' },
  { icon: CalendarDays, title: 'Campaign Calendar', text: 'Schedule when and where each video is posted, per store or brand-wide.', to: '/calendar' },
  { icon: BarChart3, title: 'Analytics', text: 'After posting, record views, likes, comments, shares, leads and sales (or import Excel). The dashboard updates every hour.', to: '/analytics' },
]

export function AppGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} size="lg" title="How the app works" description="From a social media trend to a published video — and the numbers that prove it worked.">
      <ol className="space-y-3">
        {STEPS.map(({ icon: Icon, title, text, to }, i) => (
          <li key={title} className="flex gap-4 rounded-2xl border border-slate-100 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-800">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                <span className="text-slate-400 tabular-nums">{i + 1}.</span> {title}
              </p>
              <p className="mt-0.5 text-sm text-slate-600">{text}</p>
            </div>
            <Link to={to} onClick={onClose} className="self-center rounded-full p-2 text-brand-800 hover:bg-brand-50" aria-label={`Open ${title}`}>
              <ArrowRight className="size-4" />
            </Link>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
