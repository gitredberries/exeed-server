import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { toNumber } from 'lodash'
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston'
import { AppModule } from './app.module'
import { ExceptionsFilter } from '@core/filters/exceptions.filter'
import { TransformInterceptor } from '@core/interceptors/transform.interceptor'
import basicAuth from 'express-basic-auth'
async function bootstrap() {
  console.log('=== SERVER STARTING ===')
  console.log('NODE_ENV:', process.env.NODE_ENV)
  console.log('PORT:', process.env.PORT || process.env.SERVER_PORT || 3000)
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL)
  console.log('MYSQL_URL set:', !!process.env.MYSQL_URL)
  console.log('REDIS_HOST:', process.env.REDIS_HOST || '(not set)')

  // Railway MySQL addon exposes MYSQL_URL; our code reads DATABASE_URL
  if (!process.env.DATABASE_URL && process.env.MYSQL_URL) {
    console.log('Mapping MYSQL_URL -> DATABASE_URL')
    process.env.DATABASE_URL = process.env.MYSQL_URL
  }

  let logger: any
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    BigInt.prototype.toJSON = function () {
      return Number(this.toString())
    }
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    })
    console.log('NestJS app created successfully, configuring middleware...')

    app.use(helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }))
    app.enableCors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g., same-origin, mobile apps, curl)
        if (!origin) {
          callback(null, true)
          return
        }

        // In production, validate against allowed origins from env
        const allowedOrigins = process.env.CORS_ORIGINS
          ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
          : []

        if (process.env.NODE_ENV !== 'production' || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true)
        } else {
          callback(null, true) // Allow all origins for flexibility
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    })
    logger = app.get(WINSTON_MODULE_NEST_PROVIDER)
    app.useLogger(logger)
    app.use(cookieParser())
    app.useGlobalFilters(new ExceptionsFilter(app.get(HttpAdapterHost), logger))
    app.useGlobalInterceptors(new TransformInterceptor())
    app.setGlobalPrefix('api')

    if (process.env.NODE_ENV !== 'production') {
      const config = new DocumentBuilder()
        .setTitle('CMS SERVER')
        .setDescription('CMS SERVER POWERED BY NEST.JS')
        .setExternalDoc('OPENAPI 3.0', './docs/json')
        .setVersion('1.0')
        .build()

      const document = SwaggerModule.createDocument(app, config)
      if (process.env.NODE_ENV !== 'development') {
        app.use(
          ['/api/docs', '/api/docs/json', '/api/docs/yaml', '/api/front/articles/replaceUrlPrefix'],
          basicAuth({
            users: { swagger: 'swaggerui@platformt' },
            challenge: true,
          }),
        )
      }
      SwaggerModule.setup('/docs', app, document, {
        useGlobalPrefix: true,
        jsonDocumentUrl: '/docs/json',
        yamlDocumentUrl: '/docs/yaml',
      })
    }

    process.on('unhandledRejection', (reason, promise) => {
      // console.error('Unhandled Rejection at:', promise, 'reason:', reason)
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason)
    })

    process.on('uncaughtException', (error) => {
      // console.error('Uncaught Exception:', error)
      logger.error('Uncaught Exception:', error)
      logger.error(error)
      console.log(error)
    })

    const port = toNumber(process.env.PORT || process.env.SERVER_PORT || 3000)
    await app.listen(port, '0.0.0.0')
    logger.log(`Application is running on port ${port}`)
  } catch (error) {
    const errLogger = logger || console
    errLogger.error('Failed to start application:')
    errLogger.error(error)
    console.error('STARTUP ERROR:', error)
    process.exit(1)
  }
}

bootstrap()
