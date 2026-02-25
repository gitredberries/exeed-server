// src/database.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'

const SOFT_DELETE_MODELS = []

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit {
  constructor(private configService: ConfigService) {
    const dbUrl = `mysql://${encodeURIComponent(configService.get('database.username'))}:${encodeURIComponent(configService.get('database.password'))}@${configService.get('database.url')}`
    console.log('Prisma connecting to:', dbUrl.replace(/:([^:@]+)@/, ':***@'))
    super({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
      log: configService.get('database.log_level'),
    })

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.$on('query', (e: any) => {
        try {
          const params = JSON.parse(`${e.params}`)
          let realSql = e.query
          params.forEach((p) => {
            if (typeof p === 'string') {
              realSql = realSql.replace('?', `'${p}'`)
            } else {
              realSql = realSql.replace('?', p)
            }
          })
          console.log('\n--------real-sql start:-----------\n')
          console.log(realSql)
          console.log('\n----------real-sql end.------------\n')
        } catch (err) {
          console.log(err, e)
        }
      })
    }

    this.setupPrismaMiddleware()
  }

  async onModuleInit() {
    const maxRetries = 5
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect()
        console.log('Database connected successfully')
        return
      } catch (error) {
        console.error(`Database connection attempt ${attempt}/${maxRetries} failed:`, error.message)
        if (attempt === maxRetries) {
          throw error
        }
        // Wait before retrying (exponential backoff: 2s, 4s, 8s, 16s)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }
  }

  private setupPrismaMiddleware() {
    this.$use(async (params, next) => {
      if (SOFT_DELETE_MODELS.includes(params.model)) {
        if (params.action == 'delete') {
          params.action = 'update'
          params.args['data'] = { delFlag: true }
        }
        if (params.action == 'deleteMany') {
          params.action = 'updateMany'
          if (params.args.data != undefined) {
            params.args.data['delFlag'] = true
          } else {
            params.args.data = { delFlag: true }
          }
        }
        if (params.action == 'findUnique') {
          params.action = 'findFirst'
          params.args.where['delFlag'] = false
        }
        if (params.action == 'update') {
          params.action = 'updateMany'
          params.args.where['delFlag'] = false
        }
        if (['count', 'aggregate', 'updateMany', 'findMany'].includes(params.action)) {
          if (params.args.where != undefined) {
            if (params.args.where.deleted === undefined) {
              params.args.where['delFlag'] = false
            }
          } else {
            params.args['where'] = { delFlag: false }
          }
        }
      }
      const result = await next(params)

      // 处理查询结果，将 createTime 和 updateTime 转换为时间戳
      if (result && typeof result === 'object') {
        if (Array.isArray(result)) {
          return result.map((item) => this.convertDateFieldsToTimestamp(item))
        } else {
          return this.convertDateFieldsToTimestamp(result)
        }
      }

      return result
    })
  }
  private convertDateFieldsToTimestamp(data: any): any {
    if (data && typeof data === 'object') {
      for (const key in data) {
        if (key === 'createTime' || key === 'updateTime' || key === 'lastLogin' || key === 'publishTime') {
          if (data[key] instanceof Date) {
            data[key] = data[key].getTime()
          }
        } else if (typeof data[key] === 'object') {
          data[key] = this.convertDateFieldsToTimestamp(data[key])
        }
      }
    }
    return data
  }
}
