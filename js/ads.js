export const AD_CONFIG = {
  client: "ca-pub-7626180613649732",
  slots: {
    top: "",
    bottom: "",
  },
}

const filled = new Set()
let scriptReady = null

function slotVisible(name) {
  if (!AD_CONFIG.client || !AD_CONFIG.slots[name]) return false
  if (document.body.classList.contains("no-ads")) return false
  if (name === "top") return !document.body.classList.contains("playing")
  return true
}

function loadScript() {
  if (scriptReady) return scriptReady
  scriptReady = new Promise((resolve) => {
    const script = document.createElement("script")
    script.async = true
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(AD_CONFIG.client)}`
    script.crossOrigin = "anonymous"
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.append(script)
  })
  return scriptReady
}

export function refreshAds() {
  const hidden = document.body.classList.contains("no-ads")
  document.body.classList.toggle("ads-live", !hidden)
  if (hidden || !AD_CONFIG.client) return
  for (const name of ["top", "bottom"]) {
    if (!slotVisible(name) || filled.has(name)) continue
    const host = document.querySelector(`.ad-edge.${name} .ad-unit`)
    if (!host) continue
    const ins = document.createElement("ins")
    ins.className = "adsbygoogle"
    ins.style.display = "block"
    ins.style.width = "100%"
    ins.style.height = "100%"
    ins.dataset.adClient = AD_CONFIG.client
    ins.dataset.adSlot = AD_CONFIG.slots[name]
    ins.dataset.adFormat = "horizontal"
    ins.dataset.fullWidthResponsive = "true"
    host.replaceChildren(ins)
    filled.add(name)
    loadScript().then(() => {
      try {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
      } catch {
        /* síť reklamu odmítla, pruh zůstane prázdný */
      }
    })
  }
}
