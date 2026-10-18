const TOKEN = "rytmus-dash-token"

async function api(path, body) {
  const headers = { "Content-Type": "application/json" }
  const token = localStorage.getItem(TOKEN)
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers,
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (response.status === 401) localStorage.removeItem(TOKEN)
  if (!response.ok) throw new Error(data.error || "The account did not respond.")
  if (data.token) localStorage.setItem(TOKEN, data.token)
  return data
}

export const account = {
  token() {
    return localStorage.getItem(TOKEN) || ""
  },
  me() {
    return api("/api/me").catch((error) => {
      if (!this.token()) return null
      throw error
    })
  },
  register(name, password) {
    return api("/api/register", { name, password })
  },
  login(name, password) {
    return api("/api/login", { name, password })
  },
  async logout() {
    const token = this.token()
    localStorage.removeItem(TOKEN)
    await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {})
  },
  push(patch) {
    return api("/api/progress", patch)
  },
  setSkin(id) {
    return api("/api/skin", { id })
  },
  promo(code) {
    return api("/api/promo", { code })
  },
  promoOff() {
    return api("/api/promo", { off: true })
  },
}
