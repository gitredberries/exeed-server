import { AUTH_TOKEN_EXPIRED_TIME, REDIS_AUTH_PREFIX, PREFIX, REDIS_TENANT_IDS_KEY } from '@common/constants/auth'
import { Injectable, Logger } from '@nestjs/common'
import Redis from 'ioredis'
import { ConfigService } from '@nestjs/config'

// In-memory storage for development when Redis is not available
const inMemoryStorage = new Map<string, any>()
const inMemoryHash = new Map<string, Map<string, string>>()
const inMemoryList = new Map<string, string[]>()

// In-memory TTL management
const inMemoryExpiry = new Map<string, number>()

function cleanupExpired() {
  const now = Date.now()
  for (const [key, expiry] of inMemoryExpiry.entries()) {
    if (expiry < now) {
      inMemoryStorage.delete(key)
      inMemoryHash.delete(key)
      inMemoryList.delete(key)
      inMemoryExpiry.delete(key)
    }
  }
}

@Injectable()
class RedisClient extends Redis {
  private readonly logger = new Logger(RedisClient.name)
  private useInMemory = false

  constructor(private configService: ConfigService) {
    super({
      host: configService.get('redis.host'),
      port: configService.get('redis.port') as any as number,
      password: configService.get('redis.password'),
      db: +configService.get('redis.database_index') || 0,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          return null // stop retrying
        }
        return Math.min(times * 100, 3000)
      },
      lazyConnect: true,
    })

    this.on('error', (err) => {
      if (!this.useInMemory) {
        this.logger.warn('Redis connection failed, using in-memory storage for development')
        this.useInMemory = true
      }
    })

    // Try to connect
    this.connect().catch(() => {
      this.logger.warn('Redis not available, using in-memory storage')
      this.useInMemory = true
    })

    // Cleanup expired keys periodically
    setInterval(cleanupExpired, 10000)
  }

  get isInMemoryMode() {
    return this.useInMemory
  }

  // Override base Redis methods for in-memory fallback
  async get(key: string): Promise<string | null> {
    if (this.useInMemory) {
      cleanupExpired()
      return inMemoryStorage.get(key) || null
    }
    return super.get(key)
  }

  async set(key: string, value: string, ...args: any[]): Promise<any> {
    if (this.useInMemory) {
      inMemoryStorage.set(key, value)
      // Handle EX argument for TTL
      const exIndex = args.indexOf('EX')
      if (exIndex !== -1 && args[exIndex + 1]) {
        inMemoryExpiry.set(key, Date.now() + args[exIndex + 1] * 1000)
      }
      return 'OK'
    }
    return super.set(key, value, ...args)
  }

  async incr(key: string): Promise<number> {
    if (this.useInMemory) {
      cleanupExpired()
      const current = parseInt(inMemoryStorage.get(key) || '0', 10)
      const newVal = current + 1
      inMemoryStorage.set(key, newVal.toString())
      return newVal
    }
    return super.incr(key)
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    if (this.useInMemory) {
      inMemoryStorage.set(key, value)
      inMemoryExpiry.set(key, Date.now() + seconds * 1000)
      return 'OK'
    }
    return super.setex(key, seconds, value)
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.useInMemory) {
      if (inMemoryStorage.has(key) || inMemoryHash.has(key) || inMemoryList.has(key)) {
        inMemoryExpiry.set(key, Date.now() + seconds * 1000)
        return 1
      }
      return 0
    }
    return super.expire(key, seconds)
  }

  // @ts-ignore - Override with simplified signature for in-memory fallback
  async del(...keys: any[]): Promise<number> {
    if (this.useInMemory) {
      let count = 0
      for (const key of keys) {
        if (typeof key === 'function') continue // Skip callbacks
        const k = key.toString()
        if (inMemoryStorage.delete(k)) count++
        if (inMemoryHash.delete(k)) count++
        if (inMemoryList.delete(k)) count++
        inMemoryExpiry.delete(k)
      }
      return count
    }
    return super.del(...keys)
  }
}

@Injectable()
export class RedisService extends RedisClient {
  async setAuthToken(userId: bigint, token: string) {
    const key = `${REDIS_AUTH_PREFIX}:${userId}`
    const timestamp = Date.now()
    if (this.isInMemoryMode) {
      if (!inMemoryHash.has(key)) inMemoryHash.set(key, new Map())
      inMemoryHash.get(key).set(token, timestamp.toString())
      return
    }
    await this.multi().hset(key, token, timestamp.toString()).expire(key, AUTH_TOKEN_EXPIRED_TIME).exec()
  }

  async getAuthToken(userId: bigint, token: string) {
    const key = `${REDIS_AUTH_PREFIX}:${userId}`
    if (this.isInMemoryMode) {
      return inMemoryHash.get(key)?.get(token) || null
    }
    return this.hget(key, token)
  }

  async removeAuthToken(userId: bigint, token: string) {
    const key = `${REDIS_AUTH_PREFIX}:${userId}`
    if (this.isInMemoryMode) {
      inMemoryHash.get(key)?.delete(token)
      return 1
    }
    return this.hdel(key, token)
  }

  async removeAllAuthTokens(userId: bigint) {
    const key = `${REDIS_AUTH_PREFIX}:${userId}`
    if (this.isInMemoryMode) {
      inMemoryHash.delete(key)
      return 1
    }
    return this.del(key)
  }

  async getUserTokens(userId: bigint): Promise<{ token: string; timestamp: number }[]> {
    const key = `${REDIS_AUTH_PREFIX}:${userId}`
    if (this.isInMemoryMode) {
      const tokens = inMemoryHash.get(key) || new Map()
      return Array.from(tokens.entries()).map(([token, timestamp]) => ({
        token,
        timestamp: parseInt(timestamp, 10),
      }))
    }
    const tokens = await this.hgetall(key)
    return Object.entries(tokens).map(([token, timestamp]) => ({
      token,
      timestamp: parseInt(timestamp as string, 10),
    }))
  }

  async addTenantId(tenantId: number) {
    if (this.isInMemoryMode) {
      if (!inMemoryList.has(REDIS_TENANT_IDS_KEY)) inMemoryList.set(REDIS_TENANT_IDS_KEY, [])
      inMemoryList.get(REDIS_TENANT_IDS_KEY).unshift(tenantId.toString())
      return
    }
    await this.lpush(REDIS_TENANT_IDS_KEY, tenantId.toString())
  }

  async getTenantIds() {
    if (this.isInMemoryMode) {
      return inMemoryList.get(REDIS_TENANT_IDS_KEY) || []
    }
    return await this.lrange(REDIS_TENANT_IDS_KEY, 0, -1)
  }

  async delTenantId(tenantId: number) {
    if (this.isInMemoryMode) {
      const list = inMemoryList.get(REDIS_TENANT_IDS_KEY) || []
      const idx = list.indexOf(tenantId.toString())
      if (idx > -1) list.splice(idx, 1)
      return 1
    }
    return await this.lrem(REDIS_TENANT_IDS_KEY, 0, tenantId.toString())
  }

  // 获取刷新令牌
  async getRefreshToken(userId: string): Promise<string | null> {
    const key = `${PREFIX}refresh_token:${userId}`
    if (this.isInMemoryMode) {
      return inMemoryStorage.get(key) || null
    }
    return this.get(key)
  }

  // 删除刷新令牌
  async removeRefreshToken(userId: string): Promise<void> {
    const key = `${PREFIX}refresh_token:${userId}`
    if (this.isInMemoryMode) {
      inMemoryStorage.delete(key)
      return
    }
    await this.del(key)
  }

  async setUserPermissions(userId: number, permissions: string[]) {
    const key = `${PREFIX}user:${userId}:permissions`
    if (this.isInMemoryMode) {
      inMemoryStorage.set(key, JSON.stringify(permissions))
      return
    }
    await this.set(key, JSON.stringify(permissions))
  }

  async getUserPermissions(userId: number) {
    const key = `${PREFIX}user:${userId}:permissions`
    if (this.isInMemoryMode) {
      const permissions = inMemoryStorage.get(key)
      return permissions ? JSON.parse(permissions) : []
    }
    const permissions = await this.get(key)
    return permissions ? JSON.parse(permissions) : []
  }

  async setRolePermissions(roleId: number, permissions: string[]) {
    const key = `${PREFIX}role:${roleId}:permissions`
    if (this.isInMemoryMode) {
      inMemoryStorage.set(key, JSON.stringify(permissions))
      return
    }
    await this.set(key, JSON.stringify(permissions))
  }

  async getRolePermissions(roleId: number) {
    const key = `${PREFIX}role:${roleId}:permissions`
    if (this.isInMemoryMode) {
      const permissions = inMemoryStorage.get(key)
      return permissions ? JSON.parse(permissions) : []
    }
    const permissions = await this.get(key)
    return permissions ? JSON.parse(permissions) : []
  }

  async findKeys(pattern) {
    if (this.isInMemoryMode) {
      const regex = new RegExp(pattern.replace('*', '.*'))
      return Array.from(inMemoryStorage.keys()).filter(k => regex.test(k))
    }
    let foundKeys = []
    let cursor = '0'
    do {
      const reply = await this.scan(cursor, 'MATCH', pattern)
      cursor = reply[0]
      foundKeys = foundKeys.concat(reply[1])
    } while (cursor !== '0')

    return foundKeys
  }
}
