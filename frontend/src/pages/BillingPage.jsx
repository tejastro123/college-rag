import { useState, useEffect } from 'react'
import api from '../api'
import GlassCard from '../components/shared/GlassCard'
import AnimatedPage from '../components/shared/AnimatedPage'

const PLAN_COLORS = {
  free: 'from-white/5 to-white/10 border-white/10',
  pro: 'from-accent/20 to-accent/5 border-accent/30',
  enterprise: 'from-purple-900/30 to-purple-900/10 border-purple-500/30',
}

const FEATURE_ICONS = {
  'Free': 'bg-white/10',
  'Pro': 'bg-accent/20',
  'Enterprise': 'bg-purple-500/20',
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
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Billing & Plans</h1>
        <p className="text-sm text-white/50 mb-8">Current plan: <span className="text-accent capitalize">{currentPlan}</span></p>

        {subscription && subscription.status !== 'active' && subscription.plan !== 'free' && (
          <div className="mb-6 p-4 rounded bg-yellow-900/30 border border-yellow-500/30 text-sm text-yellow-200">
            Your subscription is {subscription.status}. Please update your payment method.
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {plans.map(plan => {
            const isCurrent = currentPlan === plan.id
            const isFree = plan.id === 'free'
            return (
              <GlassCard
                key={plan.id}
                className={`relative border ${PLAN_COLORS[plan.id] || PLAN_COLORS.free} ${
                  isCurrent ? 'ring-2 ring-accent' : ''
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-2 -right-2 text-[10px] px-2 py-0.5 rounded-full bg-accent text-black font-semibold">
                    Current
                  </span>
                )}
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <p className="text-3xl font-bold mb-4">
                  ${(plan.price_monthly / 100).toFixed(2)}
                  <span className="text-sm font-normal text-white/50">/mo</span>
                </p>
                <ul className="space-y-2 mb-6 text-sm">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`mt-0.5 w-4 h-4 rounded-full ${FEATURE_ICONS[plan.name] || 'bg-white/10'} flex items-center justify-center text-[10px]`}>
                        &#10003;
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => isFree ? null : isCurrent ? handleManagePortal() : handleSubscribe(plan)}
                  className={`w-full py-2 rounded text-sm font-semibold transition-colors ${
                    isCurrent
                      ? 'border border-white/20 text-white/70 cursor-default'
                      : 'bg-accent text-black hover:bg-accent/80'
                  }`}
                  disabled={isCurrent && isFree}
                >
                  {isCurrent ? 'Current Plan' : isFree ? 'Free' : 'Upgrade'}
                </button>
              </GlassCard>
            )
          })}
        </div>

        {subscription && (
          <div className="mt-8">
            <GlassCard>
              <h3 className="font-semibold mb-4">Usage Today</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-2xl font-bold">{subscription.usage_today?.api_calls || 0}</p>
                  <p className="text-xs text-white/50">API Calls</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{subscription.usage_today?.documents_processed || 0}</p>
                  <p className="text-xs text-white/50">Documents</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{(subscription.usage_today?.storage_bytes || 0) > 1048576
                    ? `${((subscription.usage_today?.storage_bytes || 0) / 1048576).toFixed(1)} MB`
                    : `${((subscription.usage_today?.storage_bytes || 0) / 1024).toFixed(1)} KB`}
                  </p>
                  <p className="text-xs text-white/50">Storage</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{(subscription.usage_today?.tokens_used || 0).toLocaleString()}</p>
                  <p className="text-xs text-white/50">Tokens Used</p>
                </div>
              </div>
            </GlassCard>

            {subscription.status === 'active' && subscription.plan !== 'free' && (
              <div className="mt-4 text-center">
                <button onClick={handleManagePortal} className="text-sm text-accent hover:underline">
                  Manage billing via Stripe &rarr;
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}
