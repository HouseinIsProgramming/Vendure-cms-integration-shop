import {
  EventBus,
  JobQueueService,
  Logger,
  PluginCommonModule,
  ProductEvent,
  Type,
  VendurePlugin,
  JobQueue,
} from "@vendure/core";
import { OnModuleInit } from "@nestjs/common";

import { CMS_PLUGIN_OPTIONS, loggerCtx } from "./constants";
import { PluginInitOptions, SyncJobData } from "./types";
import { CmsSyncService } from "./cms-sync.service";

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [
    { provide: CMS_PLUGIN_OPTIONS, useFactory: () => CmsPlugin.options },
    CmsSyncService,
  ],
  compatibility: "^3.0.0",
})
export class CmsPlugin implements OnModuleInit {
  static options: PluginInitOptions;
  private productSyncQueue: JobQueue<SyncJobData>;

  constructor(
    private eventBus: EventBus,
    private jobQueueService: JobQueueService,
    private cmsSyncService: CmsSyncService,
  ) {}

  async onModuleInit() {
    // Create product sync queue
    this.productSyncQueue = await this.jobQueueService.createQueue({
      name: 'cms-product-sync',
      process: async (job) => {
        Logger.info(`[${loggerCtx}] Processing product sync job: ${JSON.stringify(job.data)}`);
        const result = await this.cmsSyncService.syncProductToCms(job.data);
        Logger.info(`[${loggerCtx}] Product sync result: ${JSON.stringify(result)}`);
        return result;
      }
    });

    // Listen for Product events
    this.eventBus.ofType(ProductEvent).subscribe(async (event) => {
      try {
        const syncData = this.extractSyncData(event);
        
        Logger.info(`[${loggerCtx}] Product event detected: ${event.type} for product ${event.entity.id}`);
        
        await this.productSyncQueue.add(syncData);
        
        Logger.info(`[${loggerCtx}] Product sync job queued for product ${event.entity.id}`);
      } catch (error) {
        Logger.error(`[${loggerCtx}] Failed to queue product sync job: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      }
    });

    Logger.info(`[${loggerCtx}] CMS Plugin initialized with product sync queue`);
  }

  private extractSyncData(event: ProductEvent): SyncJobData {
    const product = event.entity;
    
    return {
      entityType: 'product',
      entityId: product.id.toString(),
      operationType: this.mapEventTypeToOperation(event.type),
      vendureData: {
        id: product.id.toString(),
        title: product.translations?.[0]?.name || '',
        slug: product.translations?.[0]?.slug || '',
        translations: product.translations?.map(t => ({
          languageCode: t.languageCode,
          name: t.name,
          slug: t.slug
        })) || []
      },
      timestamp: new Date().toISOString(),
      retryCount: 0
    };
  }

  private mapEventTypeToOperation(eventType: string): 'create' | 'update' | 'delete' {
    switch (eventType) {
      case 'created':
        return 'create';
      case 'updated':
        return 'update';
      case 'deleted':
        return 'delete';
      default:
        return 'update';
    }
  }

  static init(options: PluginInitOptions): Type<CmsPlugin> {
    this.options = options;
    return CmsPlugin;
  }
}
