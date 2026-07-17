import { useState, useEffect } from 'react'
import { Check, Sparkles, AlertCircle, ArrowRight, Activity, FileText, Database, Cpu } from 'lucide-react'
import api from '../api'
import GlassCard from '../components/shared/GlassCard'
import AnimatedPage from '../components/shared/AnimatedPage'

const PLAN_COLORS = {
  free: 'rgba(255, 255, 255, 0.03)',
  pro: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.15) 0%, rgba(var(--accent-rgb), 0.03) 100%)',
  enterprise: 'linear-gradient(135deg, rgba(168, 85, 247, 0.15) 0%, rgba(168, 85, 247, 0.03) 100%)',
}

const BORDER_STYLES = {
  free: '1px solid var(--border)',
  pro: '2px solid var(--accent)',
  enterprise: '1px solid rgba(168, 85, 247, 0.3)',
}

export default function BillingPage() {
  const [plans, setPlans] = useState([])
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(true)
  const [orgId, setOrgId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const { data: orgs } = await api.get('/orgs/')
        if (orgs.length > 0) {
          setOrgId(orgs[0].id)
          const { data: sub } = await api.get('/billing/my-subscription', { params: { org_id: orgs[0].id } })
          setSubscription(sub)
        }
        const { data } = await api.get('/billing/plans')
        setPlans(data.plans || [])
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load billing data')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const handleSubscribe = async (plan) => {
    if (plan.id === 'free') return
    if (!orgId) return
    try {
      const { data } = await api.post('/billing/create-checkout-session', null, {
        params: { org_id: orgId, plan: plan.id, interval: 'monthly' },
      })
      window.location.href = data.url
    } catch (err) {
      alert(err.response?.data?.detail || 'Checkout failed')
    }
  }

  const handleManagePortal = async () => {
    if (!orgId) return
    try {
      const { data } = await api.post('/billing/create-portal-session', null, {
        params: { org_id: orgId },
      })
      window.location.href = data.url
    } catch (err) {
      alert(err.response?.data?.detail || 'Portal failed')
    }
  }

  if (loading) return <div className="p-8 text-white/50 text-center">Loading plans...</div>
  if (error) return <div className="p-8 text-red-400 text-center">{error}</div>

  const currentPlan = subscription?.plan || 'free'

  return (
    <AnimatedPage>
      <div className="max-w-5xl mx-auto px-6 py-8 fade-in-scale">
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <span className="badge badge-accent" style={{ marginBottom: '.5rem', display: 'inline-flex', gap: '.25rem' }}>
            <Sparkles size={12} /> Pricing plans
          </span>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '2.25rem', margin: '0.25rem 0' }}>
            Simple, transparent pricing
          </h1>
          <p className="text-muted" style={{ fontSize: '.95rem' }}>
            Choose the best plan for your academic journey. Current plan: <strong style={{ color: 'var(--accent-light)', textTransform: 'capitalize' }}>{currentPlan}</strong>
          </p>
        </div>

        {subscription && subscription.status !== 'active' && subscription.plan !== 'free' && (
          <div className="mb-6 p-4 rounded bg-red-950/20 border border-red-500/30 text-sm text-red-200 flex items-center gap-3">
            <AlertCircle size={18} style={{ color: 'var(--rose)', flexShrink: 0 }} />
            <span>Your subscription status is <strong>{subscription.status}</strong>. Please update your payment method to restore access.</span>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6" style={{ alignItems: 'stretch' }}>
          {plans.map(plan => {
            const isCurrent = currentPlan === plan.id
            const isFree = plan.id === 'free'
            const isPro = plan.id === 'pro'
            
            return (
              <GlassCard
                key={plan.id}
                style={{
                  background: PLAN_COLORS[plan.id] || PLAN_COLORS.free,
                  border: BORDER_STYLES[plan.id] || BORDER_STYLES.free,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  borderRadius: 'var(--radius-lg)',
                  padding: '2rem',
                  position: 'relative',
                  boxShadow: isCurrent ? 'var(--shadow-glow)' : 'var(--shadow)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                }}
                className={`plan-card ${isCurrent ? 'active' : ''}`}
              >
                {isPro && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] px-3 py-1 rounded-full bg-accent text-black font-bold uppercase tracking-wider" style={{ boxShadow: 'var(--shadow-glow)' }}>
                    Most Popular
                  </span>
                )}
                {isCurrent && !isPro && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] px-3 py-1 rounded-full bg-white/10 text-white font-bold uppercase tracking-wider">
                    Current Plan
                  </span>
                )}

                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{plan.name}</h3>
                  <p className="text-muted" style={{ fontSize: '.8rem', marginBottom: '1.5rem' }}>
                    {isFree ? 'Essential study tools' : isPro ? 'Power tools for top students' : 'Custom organization setup'}
                  </p>
                  
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.1rem', marginBottom: '1.5rem' }}>
                    <span style={{ fontSize: '2.5rem', fontWeight: 800 }}>
                      ${(plan.price_monthly / 100).toFixed(0)}
                    </span>
                    <span className="text-muted" style={{ fontSize: '.9rem' }}>/mo</span>
                  </div>

                  <div className="divider" style={{ margin: '1.5rem 0' }} />

                  <ul style={{ display: 'flex', flexDirection: 'column', gap: '.85rem', marginBottom: '2rem', listStyle: 'none', padding: 0 }}>
                    {plan.features.map((f, i) => (
                      <li key={i} style={{ display: 'flex', alignItems: 'start', gap: '.65rem', fontSize: '.875rem', color: 'var(--text-secondary)' }}>
                        <Check size={16} style={{ color: isPro ? 'var(--accent)' : 'var(--text-muted)', marginTop: '0.1rem', flexShrink: 0 }} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  onClick={() => isFree ? null : isCurrent ? handleManagePortal() : handleSubscribe(plan)}
                  className="btn w-full"
                  style={{
                    padding: '.75rem',
                    borderRadius: 'var(--radius)',
                    fontWeight: 600,
                    fontSize: '.875rem',
                    background: isCurrent ? 'rgba(255,255,255,0.06)' : isPro ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: isCurrent ? 'var(--text-secondary)' : isPro ? '#0a0a0a' : 'var(--text-primary)',
                    border: isCurrent ? '1px solid var(--border)' : '1px solid transparent',
                    cursor: isCurrent && isFree ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '.5rem',
                    transition: 'all 0.15s',
                  }}
                  disabled={isCurrent && isFree}
                >
                  <span>{isCurrent ? 'Current Plan' : isFree ? 'Free Forever' : 'Upgrade Plan'}</span>
                  {!isCurrent && !isFree && <ArrowRight size={14} />}
                </button>
              </GlassCard>
            )
          })}
        </div>

        {subscription && (
          <div style={{ marginTop: '3.5rem' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.25rem', marginBottom: '1rem' }}>
              Your Usage Today
            </h2>
            <GlassCard style={{ padding: '1.75rem', borderRadius: 'var(--radius-lg)' }}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <div style={{ padding: '.5rem', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', color: 'var(--accent)' }}>
                    <Activity size={20} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{subscription.usage_today?.api_calls || 0}</h4>
                    <p style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>API Queries</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <div style={{ padding: '.5rem', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', color: 'var(--accent)' }}>
                    <FileText size={20} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{subscription.usage_today?.documents_processed || 0}</h4>
                    <p style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Indexed Files</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <div style={{ padding: '.5rem', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', color: 'var(--accent)' }}>
                    <Database size={20} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                      {(subscription.usage_today?.storage_bytes || 0) > 1048576
                        ? `${((subscription.usage_today?.storage_bytes || 0) / 1048576).toFixed(1)} MB`
                        : `${((subscription.usage_today?.storage_bytes || 0) / 1024).toFixed(1)} KB`}
                    </h4>
                    <p style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Storage Used</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                  <div style={{ padding: '.5rem', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.03)', color: 'var(--accent)' }}>
                    <Cpu size={20} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '1.5rem', fontWeight: 700 }}>{(subscription.usage_today?.tokens_used || 0).toLocaleString()}</h4>
                    <p style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Tokens Spent</p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {subscription.status === 'active' && subscription.plan !== 'free' && (
              <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                <button
                  onClick={handleManagePortal}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-light)',
                    fontSize: '.875rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Manage subscription & billing history via Stripe &rarr;
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}
