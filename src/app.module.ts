import { join, resolve } from 'path'
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'
import { ServeStaticModule } from '@nestjs/serve-static'
import { WinstonModule } from 'nest-winston'
import * as winston from 'winston'
import { AcceptLanguageResolver, HeaderResolver, I18nModule, QueryResolver } from 'nestjs-i18n'
import 'winston-daily-rotate-file'
import { UsersModule } from '@modules/admin/users/users.module'
import { AuthModule } from '@modules/admin/auth/auth.module'
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard'
import { RoleGuard } from '@core/guards/role-auth.guard'
import { HealthModule } from '@modules/health/health.module'
import { FilesModule } from '@modules/files/files.module'
import { DatabaseModule } from '@database/database.module'
// import { GatewaysModule } from '@gateways/gateways.module'
import { TasksModule } from '@tasks/tasks.module'
import { AdminModule } from '@modules/admin/admin.module'
// import { SiteMiddleware } from '@core/middleware/site.middleware'
import { MenusModule } from '@modules/admin/menus/menus.module'
import { ProxyCenterMiddleware } from '@core/middleware/proxy-center.middleware'
import { AppConfigModule } from './config/config.module'
import { IamSyncModule } from '@modules/iam-sync/iam-sync.module'
import { PrivacyPolicyModule } from '@modules/admin/privacy-policy/privacy-policy.module'
import { LegalPolicyModule } from '@modules/admin/legal-policy/legal-policy.module'
import { JwtModule } from '@nestjs/jwt'
import { AUTH_SECRET } from '@common/constants/auth'
import { FrontModule } from '@modules/front/front.module'
import { PermissionsGuard } from '@core/guards/permissions.guard'
import { StartupModule } from './startup/startup.module'
import { ApiLogInterceptor } from '@core/interceptors/api-log.interceptor'

@Module({
  imports: [
    AppConfigModule,
    UsersModule,
    AuthModule,
    FilesModule,
    HealthModule,
    // GatewaysModule,
    DatabaseModule,
    AdminModule,
    MenusModule,
    ScheduleModule.forRoot(),
    TasksModule,
    IamSyncModule,
    FrontModule,
    ServeStaticModule.forRoot({
      rootPath: resolve(process.cwd(), 'upload'),
      serveRoot: '/upload',
    }),
    WinstonModule.forRoot({
      exitOnError: false,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.splat(),
        winston.format.printf((info) => {
          const { level, timestamp, context, message } = info
          return `[Nest] ${level} ${timestamp}:${context ? '[' + context + ']' : ''} ${message}`
        }),
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
          filename: 'logs/nest-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
        }),
      ],
    }),
    I18nModule.forRootAsync({
      imports: undefined,
      useFactory: () => ({
        fallbackLanguage: 'en-GB',
        loaderOptions: {
          path: join(__dirname, '/i18n/'),
          watch: process.env.NODE_ENV !== 'production',
        },
        ...(process.env.NODE_ENV !== 'production' && {
          typesOutputPath: join(process.cwd(), 'src/types/i18n.generated.ts'),
        }),
      }),
      resolvers: [new QueryResolver(['lang']), new HeaderResolver(['x-custom-lang']), AcceptLanguageResolver],
    }),
    PrivacyPolicyModule,
    LegalPolicyModule,
    StartupModule,
    JwtModule.register({
      secret: AUTH_SECRET,
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RoleGuard,
    },
    // {
    //   provide: APP_GUARD,
    //   useClass: RolesGuard,
    // },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiLogInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ProxyCenterMiddleware).forRoutes('*')
  }
}
