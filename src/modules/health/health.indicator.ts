import { Injectable } from "@nestjs/common";
import { HealthIndicator, HealthIndicatorResult } from "@nestjs/terminus";
import { DatabaseService } from "@database/database.service";
import { RedisService } from "@database/redis.service";

// import { ElasticsearchService } from '@database/elasticsearch.service';

@Injectable()
export class ApiHealthIndicator extends HealthIndicator {
  async isHealthy(): Promise<HealthIndicatorResult> {
    return this.getStatus('api', true, {})
  }
}

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private databaseService: DatabaseService) {
    super()
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    try {
      const admin = await this.databaseService.user.findFirst({
        where: {
          username: 'admin',
        },
      })
      return this.getStatus('database', !!admin, {})
    } catch (error) {
      return this.getStatus('database', false, {})
    }
  }
}

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private redisService: RedisService) {
    super()
  }

  async isHealthy(): Promise<HealthIndicatorResult> {
    // In-memory fallback mode counts as healthy (no Redis addon configured)
    if ((this.redisService as any).isInMemoryMode) {
      return this.getStatus('redis', true, { message: 'using in-memory fallback' })
    }
    const status = this.redisService.status
    return this.getStatus('redis', status === 'ready', {
      message: `current status is ${status}`,
    })
  }
}

// @Injectable()
// export class ElasticsearchHealthIndicator extends HealthIndicator {
//   constructor(private elasticsearchService: ElasticsearchService) {
//     super();
//   }
//   async isHealthy(): Promise<HealthIndicatorResult> {
//     return this.getStatus('elasticsearch', true, {});
//   }
// }
