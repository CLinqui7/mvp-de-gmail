import { createClient } from '@supabase/supabase-js'

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' })
  }

  const token = (event.headers.authorization || '').replace('Bearer ', '')

  if (!token) {
    return json(401, { ok: false, error: 'Missing authorization token' })
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
  const appsScriptUrl = process.env.APPS_SCRIPT_SYNC_URL
  const appsScriptSecret = process.env.APPS_SCRIPT_SYNC_SECRET

  if (!supabaseUrl || !supabaseAnonKey || !appsScriptUrl || !appsScriptSecret) {
    return json(500, { ok: false, error: 'Missing Netlify environment variables' })
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return json(401, { ok: false, error: 'Invalid session' })
  }

  try {
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: appsScriptSecret })
    })

    const text = await response.text()
    let body

    try {
      body = JSON.parse(text)
    } catch (_error) {
      body = { ok: false, error: text }
    }

    return json(response.ok ? 200 : response.status, body)
  } catch (error) {
    return json(500, { ok: false, error: error.message })
  }
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }
}
