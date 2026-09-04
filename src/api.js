import { apiUrl, token, VERSION } from './config.js'

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api(path, { method = 'GET', body, text = false } = {}) {
  const tk = token()
  if (!tk) throw new ApiError(401, 'Not logged in: set BYSTEP_TOKEN or run `npx @bystep/cli login`', 'no_token')
  const headers = { accept: text ? 'text/plain' : 'application/json', authorization: `Bearer ${tk}`, 'x-bystep-mcp': VERSION }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${apiUrl()}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const raw = await res.text()
  if (text) {
    if (!res.ok) throw new ApiError(res.status, raw || res.statusText)
    return raw
  }
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = { raw }
  }
  if (!res.ok) throw new ApiError(res.status, data?.error?.message || res.statusText, data?.error?.code)
  return data
}
