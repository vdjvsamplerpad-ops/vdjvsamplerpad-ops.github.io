export type ActivityEventType =
  | 'auth.login'
  | 'auth.signup'
  | 'auth.signout'
  | 'bank.export'
  | 'bank.import'

export type ActivityStatus = 'success' | 'failed'

type ActivityDevice = {
  fingerprint: string
  name: string
  model: string
  platform: string
  browser: string
  os: string
  raw: Record<string, unknown>
}

type ActivityQueueItem = {
  endpoint: '/api/activity/event' | '/api/activity/signout'
  payload: Record<string, unknown>
}

type ActivityEventInput = {
  eventType: ActivityEventType
  status: ActivityStatus
  userId?: string | null
  email?: string | null
  bankId?: string | null
  bankName?: string | null
  padCount?: number | null
  padNames?: string[]
  errorMessage?: string | null
  meta?: Record<string, unknown>
}

type SignoutInput = {
  status: ActivityStatus
  userId?: string | null
  email?: string | null
  errorMessage?: string | null
  meta?: Record<string, unknown>
}

type HeartbeatInput = {
  userId: string
  email?: string | null
  meta?: Record<string, unknown>
  lastEvent?: string
}

const ACTIVITY_QUEUE_KEY = 'vdjv-activity-queue'
const SESSION_KEY_STORAGE_KEY = 'vdjv-session-key'
const MAX_QUEUE_LENGTH = 1000

const isBrowser = typeof window !== 'undefined'

let runtimeStarted = false
let isFlushing = false
let cachedDevice: ActivityDevice | null = null
let devicePromise: Promise<ActivityDevice> | null = null

const safeJsonParse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const generateUuid = (): string => {
  if (!isBrowser) return '00000000-0000-4000-8000-000000000000'
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0
    const v = ch === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

const getSessionKey = (): string => {
  if (!isBrowser) return generateUuid()
  try {
    const existing = sessionStorage.getItem(SESSION_KEY_STORAGE_KEY)
    if (existing) return existing
    const created = generateUuid()
    sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, created)
    return created
  } catch {
    return generateUuid()
  }
}

const readQueue = (): ActivityQueueItem[] => {
  if (!isBrowser) return []
  const parsed = safeJsonParse<ActivityQueueItem[]>(localStorage.getItem(ACTIVITY_QUEUE_KEY), [])
  return Array.isArray(parsed) ? parsed : []
}

const writeQueue = (queue: ActivityQueueItem[]) => {
  if (!isBrowser) return
  try {
    if (queue.length === 0) {
      localStorage.removeItem(ACTIVITY_QUEUE_KEY)
      return
    }
    localStorage.setItem(ACTIVITY_QUEUE_KEY, JSON.stringify(queue))
  } catch (err) {
    console.warn('Failed to persist activity queue:', err)
  }
}

const enqueue = (item: ActivityQueueItem) => {
  const queue = readQueue()
  queue.push(item)
  if (queue.length > MAX_QUEUE_LENGTH) {
    queue.splice(0, queue.length - MAX_QUEUE_LENGTH)
  }
  writeQueue(queue)
}

const parseBrowser = (ua: string, uaBrands: string): string => {
  const text = `${ua} ${uaBrands}`.toLowerCase()
  if (text.includes('edg/')) return 'Edge'
  if (text.includes('opr/') || text.includes('opera')) return 'Opera'
  if (text.includes('chrome/') || text.includes('chromium')) return 'Chrome'
  if (text.includes('firefox/')) return 'Firefox'
  if (text.includes('safari/') && !text.includes('chrome/')) return 'Safari'
  return 'Unknown'
}

const parseOS = (ua: string, platform: string): string => {
  const lowerUa = ua.toLowerCase()
  const lowerPlatform = platform.toLowerCase()
  if (lowerUa.includes('windows') || lowerPlatform.includes('win')) return 'Windows'
  if (lowerUa.includes('android')) return 'Android'
  if (lowerUa.includes('iphone') || lowerUa.includes('ipad') || lowerUa.includes('ios')) return 'iOS'
  if (lowerUa.includes('mac os') || lowerPlatform.includes('mac')) return 'macOS'
  if (lowerUa.includes('linux') || lowerPlatform.includes('linux')) return 'Linux'
  return platform || 'Unknown'
}

const parseDeviceName = (platform: string, model: string, ua: string): string => {
  if (model) return model
  if (/iPad/i.test(ua)) return 'iPad'
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/Android/i.test(ua)) return 'Android Device'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows NT/i.test(ua)) return 'Windows PC'
  if (/Linux/i.test(ua)) return 'Linux Device'
  return platform || 'Unknown Device'
}

const sha256Hex = async (text: string): Promise<string> => {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      return btoa(text).replace(/=/g, '').slice(0, 64)
    }
    const encoded = new TextEncoder().encode(text)
    const digest = await crypto.subtle.digest('SHA-256', encoded)
    const bytes = new Uint8Array(digest)
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return btoa(text).replace(/=/g, '').slice(0, 64)
  }
}

const buildMinimalDevice = (): ActivityDevice => {
  if (!isBrowser) {
    return {
      fingerprint: 'server',
      name: 'unknown',
      model: 'unknown',
      platform: 'unknown',
      browser: 'unknown',
      os: 'unknown',
      raw: {},
    }
  }

  const ua = navigator.userAgent || ''
  const platform = navigator.platform || 'unknown'
  const browser = parseBrowser(ua, '')
  const os = parseOS(ua, platform)
  return {
    fingerprint: 'pending',
    name: parseDeviceName(platform, '', ua),
    model: '',
    platform,
    browser,
    os,
    raw: {},
  }
}

const buildDevice = async (): Promise<ActivityDevice> => {
  if (!isBrowser) return buildMinimalDevice()
  if (cachedDevice) return cachedDevice
  if (devicePromise) return devicePromise

  devicePromise = (async () => {
    const ua = navigator.userAgent || ''
    const nav = navigator as Navigator & {
      userAgentData?: {
        brands?: Array<{ brand: string; version: string }>
        mobile?: boolean
        platform?: string
        getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>
      }
      deviceMemory?: number
    }

    const uaData = nav.userAgentData
    const brands = Array.isArray(uaData?.brands) ? uaData.brands : []
    const brandText = brands.map((b) => `${b.brand}/${b.version}`).join(', ')
    const platform = String(uaData?.platform || navigator.platform || 'unknown')

    let model = ''
    let platformVersion = ''
    let architecture = ''
    try {
      if (uaData?.getHighEntropyValues) {
        const details = await uaData.getHighEntropyValues(['model', 'platformVersion', 'architecture'])
        model = String(details?.model || '')
        platformVersion = String(details?.platformVersion || '')
        architecture = String(details?.architecture || '')
      }
    } catch {
      // Ignore unsupported high-entropy reads.
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
    const language = navigator.language || 'unknown'
    const screenWidth = window.screen?.width || 0
    const screenHeight = window.screen?.height || 0
    const dpr = Number(window.devicePixelRatio || 1)
    const hardwareConcurrency = Number(navigator.hardwareConcurrency || 0)
    const deviceMemory = Number(nav.deviceMemory || 0)
    const browser = parseBrowser(ua, brandText)
    const os = parseOS(ua, platform)
    const name = parseDeviceName(platform, model, ua)

    const fingerprintSeed = JSON.stringify({
      ua,
      brands: brandText,
      platform,
      platformVersion,
      architecture,
      model,
      language,
      timezone,
      screen: `${screenWidth}x${screenHeight}`,
      dpr,
      hardwareConcurrency,
      deviceMemory,
      mobile: Boolean(uaData?.mobile),
    })
    const fingerprint = await sha256Hex(fingerprintSeed)

    const device: ActivityDevice = {
      fingerprint,
      name,
      model,
      platform,
      browser,
      os,
      raw: {
        mobile: Boolean(uaData?.mobile),
        platformVersion,
        architecture,
        timezone,
        language,
        screenWidth,
        screenHeight,
        dpr,
        hardwareConcurrency,
        deviceMemory,
      },
    }
    cachedDevice = device
    return device
  })()

  return devicePromise
}

const postJson = async (endpoint: string, payload: Record<string, unknown>) => {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: endpoint !== '/api/activity/event',
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${text || 'request failed'}`)
  }
}

export const flushActivityQueue = async () => {
  if (!isBrowser || isFlushing || !navigator.onLine) return
  const queue = readQueue()
  if (!queue.length) return
  isFlushing = true
  try {
    const remaining: ActivityQueueItem[] = []
    for (const item of queue) {
      try {
        await postJson(item.endpoint, item.payload)
      } catch (err: any) {
        const message = String(err?.message || '')
        const retriable =
          message.includes('HTTP 5') ||
          message.includes('HTTP 429') ||
          message.includes('Failed to fetch') ||
          message.includes('NetworkError')
        if (retriable) {
          remaining.push(item)
        } else {
          console.warn('Dropping non-retriable queued activity item:', message)
        }
      }
    }
    writeQueue(remaining)
  } finally {
    isFlushing = false
  }
}

const sendOrQueue = async (
  endpoint: '/api/activity/event' | '/api/activity/signout',
  payload: Record<string, unknown>
) => {
  if (!isBrowser) return
  if (!navigator.onLine) {
    enqueue({ endpoint, payload })
    return
  }
  try {
    await postJson(endpoint, payload)
  } catch (err: any) {
    const message = String(err?.message || '')
    const retriable =
      message.includes('HTTP 5') ||
      message.includes('HTTP 429') ||
      message.includes('Failed to fetch') ||
      message.includes('NetworkError')
    if (retriable) {
      enqueue({ endpoint, payload })
      return
    }
    throw err
  }
}

export const ensureActivityRuntime = () => {
  if (!isBrowser || runtimeStarted) return
  runtimeStarted = true
  void buildDevice().catch(() => {})
  const flush = () => {
    void flushActivityQueue()
  }
  window.addEventListener('online', flush)
  window.addEventListener('focus', flush)
  if (navigator.onLine) flush()
}

const buildEventPayload = async (
  input: Omit<ActivityEventInput, 'eventType' | 'status'> & {
    eventType: ActivityEventType
    status: ActivityStatus
    requestId?: string
  }
) => {
  const device = await buildDevice()
  return {
    requestId: input.requestId || generateUuid(),
    eventType: input.eventType,
    status: input.status,
    userId: input.userId || null,
    email: input.email || null,
    sessionKey: getSessionKey(),
    device,
    bankId: input.bankId || null,
    bankName: input.bankName || null,
    padCount: typeof input.padCount === 'number' ? input.padCount : null,
    padNames: Array.isArray(input.padNames) ? input.padNames : [],
    errorMessage: input.errorMessage || null,
    meta: input.meta || {},
  }
}

export const logActivityEvent = async (input: ActivityEventInput) => {
  ensureActivityRuntime()
  const payload = await buildEventPayload(input)
  await sendOrQueue('/api/activity/event', payload)
}

export const logSignoutActivity = async (input: SignoutInput) => {
  ensureActivityRuntime()
  const payload = await buildEventPayload({
    eventType: 'auth.signout',
    status: input.status,
    userId: input.userId,
    email: input.email,
    errorMessage: input.errorMessage,
    meta: input.meta,
  })
  await sendOrQueue('/api/activity/signout', payload)
}

export const sendActivityHeartbeat = async (input: HeartbeatInput) => {
  if (!isBrowser || !input.userId) return
  ensureActivityRuntime()
  const device = await buildDevice()
  const payload = {
    sessionKey: getSessionKey(),
    userId: input.userId,
    email: input.email || null,
    device,
    lastEvent: input.lastEvent || 'heartbeat',
    meta: input.meta || {},
  }
  try {
    await postJson('/api/activity/heartbeat', payload)
  } catch (err) {
    console.warn('Heartbeat failed:', err)
  }
}

export const sendHeartbeatBeacon = (input: {
  userId?: string | null
  email?: string | null
  lastEvent?: string
  meta?: Record<string, unknown>
}): boolean => {
  if (!isBrowser || !navigator.sendBeacon || !input.userId) return false
  const device = cachedDevice || buildMinimalDevice()
  const payload = {
    sessionKey: getSessionKey(),
    userId: input.userId,
    email: input.email || null,
    device,
    lastEvent: input.lastEvent || 'heartbeat',
    meta: input.meta || {},
  }
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  return navigator.sendBeacon('/api/activity/heartbeat', blob)
}

