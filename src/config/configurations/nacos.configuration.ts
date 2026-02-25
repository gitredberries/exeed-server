import { NacosManager } from './nacos.manage'
import { DatabaseConfig, PlatformConfig } from '../config.interface'
import path from 'path'
import fs from 'fs'
import * as yaml from 'yaml'
import { decryptJasyptField } from '../../utils/encrypt'

// 自动解密工具
function autoDecrypt(val: string) {
  if (typeof val === 'string' && /^ENC\(.+\)$/.test(val)) {
    return decryptJasyptField(val)
  }
  return val
}

function parseYml(content: string) {
  return yaml.parse(content)
}

export const loadNacosConfig = async (): Promise<PlatformConfig> => {
  let nacosConfigs: PlatformConfig
  if (!process.env.NACOS_HOST) {
    let dbCfg: DatabaseConfig
    if (process.env.DATABASE_URL?.startsWith('mysql:')) {
      // mysql://root:123456@localhost:3306/test
      const [, username, password, host, port, database] =
        process.env.DATABASE_URL.match(/^mysql:\/\/(.*):(.*)@(.*):(\d+)\/(.*)$/) || []

      if (!host || !port || !database || !username) {
        throw new Error('DATABASE_URL 格式错误')
      }

      dbCfg = {
        url: `${host}:${port}/${database}`,
        username,
        password: password || '',
        log_level: ['error'],
      }
    } else {
      dbCfg = {
        url: process.env.DATABASE_URL,
        username: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        log_level: process.env.DATABASE_LOG_LEVEL?.split(',') || ['error'],
      }
    }

    nacosConfigs = {
      database: dbCfg,
      redis: {
        host: process.env.REDIS_HOST,
        port: +process.env.REDIS_PORT,
        password: process.env.REDIS_PASSWORD,
        database_index: +process.env.REDIS_DATABASE_INDEX || 0,
      },
      obs: {
        default: {
          access_key_id: process.env.S3_ACCESS_KEY_ID,
          access_key_secret: process.env.S3_SECRET_ACCESS_KEY,
          bucket: process.env.S3_BUCKET,
          region: process.env.S3_REGION,
          endpoint: process.env.S3_ENDPOINT,
          domain: process.env.S3_DOMAIN,
          public_dir: process.env.S3_PUBLIC_DIR,
        },
      },
    }
  } else {
    if (process.env.NODE_ENV === 'development') {
      const configPath = path.join(process.cwd(), 'nacos-config-example.yaml')
      nacosConfigs = parseYml(fs.readFileSync(configPath, 'utf8')) as unknown as PlatformConfig
    } else {
      const configManager = new NacosManager()
      nacosConfigs = await configManager.getAllConfig()
    }
  }

  if (nacosConfigs.database.url.startsWith('mysql:')) {
    const [, username, password, host, port, database] =
      nacosConfigs.database.url.match(/^mysql:\/\/(.*):(.*)@(.*):(\d+)\/(.*)$/) || []
    nacosConfigs.database.url = `${host}:${port}/${database}`
    nacosConfigs.database.username = username
    nacosConfigs.database.password = password
  }

  const cfgs = {
    database: {
      url: nacosConfigs.database.url,
      username: autoDecrypt(nacosConfigs.database.username),
      password: autoDecrypt(nacosConfigs.database.password),
      log_level: nacosConfigs.database.log_level,
    },
    redis: (() => {
      const redisConfig = {
        // 集群模式配置（如果存在）
        ...(nacosConfigs.redis.cluster && {
          cluster: {
            nodes: nacosConfigs.redis.cluster.nodes,
          },
        }),
        // 单节点模式配置（如果不是集群模式）
        ...(nacosConfigs.redis.host && {
          host: nacosConfigs.redis.host,
          port: nacosConfigs.redis.port,
        }),
        // 通用配置
        password: autoDecrypt(nacosConfigs.redis.password),
        database_index: nacosConfigs.redis.database_index,
      }

      // 验证配置有效性
      const hasCluster = nacosConfigs.redis.cluster && nacosConfigs.redis.cluster.nodes
      const hasSingleNode = nacosConfigs.redis.host && nacosConfigs.redis.port

      if (!hasCluster && !hasSingleNode) {
        // No Redis configured — RedisService will fall back to in-memory mode
        console.warn('Redis not configured: will use in-memory fallback (no cluster.nodes or host+port)')
      }

      if (hasCluster && hasSingleNode) {
        console.warn('警告：同时配置了Redis集群模式和单节点模式，将优先使用集群模式')
      }

      return redisConfig
    })(),
    obs: {
      ...nacosConfigs.obs,
      default: {
        ...nacosConfigs.obs[nacosConfigs.obs['chery_xt'] ? 'chery_xt' : Object.keys(nacosConfigs.obs)[0]],
      },
    },
  }
  return cfgs
}
