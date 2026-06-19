import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Search, RefreshCw, LogOut, PackageCheck, Truck, Clock, AlertTriangle } from 'lucide-react'
import { supabase } from './supabaseClient'
import './styles.css'

function App() {
  const [session, setSession] = useState(null)
  const [loadingSession, setLoadingSession] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoadingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  if (loadingSession) return <Shell><p>Loading session...</p></Shell>
  if (!session) return <Login />

  return <Dashboard session={session} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setMessage('')

    const action = mode === 'signin'
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password })

    const { error } = await action

    if (error) setMessage(error.message)
    else if (mode === 'signup') setMessage('User created. Check email confirmation if Supabase requires it.')

    setBusy(false)
  }

  return (
    <Shell>
      <section className="loginCard">
        <div className="brandMark">PO</div>
        <h1>Tracking Command Center</h1>
        <p>Login to monitor POs, pick tickets, tracking numbers, and pending shipments.</p>

        <form onSubmit={submit} className="loginForm">
          <label>Email</label>
          <input value={email} onChange={event => setEmail(event.target.value)} type="email" required />

          <label>Password</label>
          <input value={password} onChange={event => setPassword(event.target.value)} type="password" required minLength="6" />

          <button disabled={busy}>{busy ? 'Working...' : mode === 'signin' ? 'Login' : 'Create user'}</button>
        </form>

        <button className="linkButton" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need a user? Create one' : 'Already have a user? Login'}
        </button>

        {message && <p className="message">{message}</p>}
      </section>
    </Shell>
  )
}

function Dashboard({ session }) {
  const [orders, setOrders] = useState([])
  const [syncRuns, setSyncRuns] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedPo, setSelectedPo] = useState('all')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')

  async function loadData() {
    setLoading(true)

    const [{ data: ordersData, error: ordersError }, { data: runsData }] = await Promise.all([
      supabase
        .from('order_dashboard')
        .select('*')
        .order('last_updated', { ascending: false }),
      supabase
        .from('sync_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)
    ])

    if (ordersError) {
      setSyncMessage(ordersError.message)
    } else {
      setOrders(ordersData || [])
      setSyncRuns(runsData || [])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const filteredOrders = useMemo(() => {
    const term = search.toLowerCase().trim()

    return orders.filter(order => {
      const matchesStatus = statusFilter === 'all' || order.tracking_status === statusFilter
      const matchesPo = selectedPo === 'all' || order.retail_po === selectedPo
      const searchable = [
        order.retail_po,
        order.order_no,
        order.pick_ticket_no,
        order.tracking_number,
        order.retailer,
        order.customer,
        order.order_status
      ].filter(Boolean).join(' ').toLowerCase()

      return matchesStatus && matchesPo && (!term || searchable.includes(term))
    })
  }, [orders, search, statusFilter, selectedPo])

  const poOptions = useMemo(() => {
    return [...new Set(orders.map(order => order.retail_po).filter(Boolean))].sort()
  }, [orders])

  const stats = useMemo(() => {
    const total = orders.length
    const withTracking = orders.filter(order => order.tracking_number).length
    const pending = orders.filter(order => !order.tracking_number).length
    const late = orders.filter(order => order.tracking_status === 'pending_late').length

    return { total, withTracking, pending, late }
  }, [orders])

  const lastSync = syncRuns[0]

  async function runManualSync() {
    setSyncing(true)
    setSyncMessage('Running email sync...')

    try {
      const response = await fetch('/.netlify/functions/sync-email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      })

      const result = await response.json()

      if (!response.ok || !result.ok) {
        throw new Error(result.error || result.message || 'Sync failed')
      }

      setSyncMessage(
        result.status === 'skipped_cooldown'
          ? result.message
          : `Sync completed. ${result.processedMessages || 0} messages processed.`
      )

      await loadData()
    } catch (error) {
      setSyncMessage(error.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Shell>
      <header className="topbar">
        <div>
          <span className="eyebrow">Operations dashboard</span>
          <h1>PO & Pick Ticket Tracking</h1>
          <p>Search by PO, pick ticket, order number, or tracking number.</p>
        </div>
        <div className="topbarActions">
          <button className="refreshButton" onClick={runManualSync} disabled={syncing}>
            <RefreshCw size={18} className={syncing ? 'spin' : ''} />
            {syncing ? 'Updating...' : 'Update from Gmail'}
          </button>
          <button className="ghostButton" onClick={() => supabase.auth.signOut()}>
            <LogOut size={18} /> Logout
          </button>
        </div>
      </header>

      {syncMessage && <div className="notice">{syncMessage}</div>}

      <section className="statsGrid">
        <StatCard icon={<PackageCheck />} label="Total POs" value={stats.total} />
        <StatCard icon={<Truck />} label="With tracking" value={stats.withTracking} />
        <StatCard icon={<Clock />} label="Pending tracking" value={stats.pending} />
        <StatCard icon={<AlertTriangle />} label="Pending over 4 days" value={stats.late} warning />
      </section>

      <section className="controlPanel">
        <div className="searchBox">
          <Search size={18} />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search PO, tracking, pick ticket, customer..."
          />
        </div>

        <select value={selectedPo} onChange={event => setSelectedPo(event.target.value)}>
          <option value="all">All POs</option>
          {poOptions.map(po => <option value={po} key={po}>{po}</option>)}
        </select>

        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending_tracking">Pending tracking</option>
          <option value="pending_late">Pending over 4 days</option>
          <option value="tracking_received">Tracking received</option>
        </select>
      </section>

      <section className="metaRow">
        <span>{loading ? 'Loading...' : `${filteredOrders.length} records displayed`}</span>
        {lastSync && <span>Last sync: {formatDate(lastSync.finished_at || lastSync.created_at)} · {lastSync.status}</span>}
      </section>

      <section className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Retail PO</th>
              <th>Pick Ticket</th>
              <th>Order</th>
              <th>Retailer</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Ship Date</th>
              <th>Tracking</th>
              <th>Waiting</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map(order => (
              <tr key={order.id}>
                <td className="strong">{order.retail_po || '-'}</td>
                <td>{order.pick_ticket_no || '-'}</td>
                <td>{order.order_no || '-'}</td>
                <td>{order.retailer || '-'}</td>
                <td>{order.customer || '-'}</td>
                <td><StatusPill status={order.tracking_status} /></td>
                <td>{order.ship_date || '-'}</td>
                <td className="trackingCell">{order.tracking_number || 'Pending'}</td>
                <td>{order.days_waiting ?? '-'} days</td>
                <td>{formatDate(order.last_updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && filteredOrders.length === 0 && <div className="emptyState">No orders match your search.</div>}
      </section>
    </Shell>
  )
}

function StatCard({ icon, label, value, warning }) {
  return (
    <article className={warning ? 'statCard warning' : 'statCard'}>
      <div className="statIcon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  )
}

function StatusPill({ status }) {
  const labels = {
    tracking_received: 'Tracking received',
    pending_late: 'Late pending',
    pending_tracking: 'Pending tracking'
  }

  return <span className={`pill ${status || 'pending_tracking'}`}>{labels[status] || 'Pending tracking'}</span>
}

function Shell({ children }) {
  return <main className="appShell">{children}</main>
}

function formatDate(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

createRoot(document.getElementById('root')).render(<App />)
