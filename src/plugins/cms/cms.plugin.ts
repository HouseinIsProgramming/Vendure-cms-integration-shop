import {
  EventBus,
  JobQueueService,
  Logger,
  PluginCommonModule,
  ProductEvent,
  ProductVariantEvent,
  CollectionEvent,
  ProductVariant,
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
  private variantSyncQueue: JobQueue<SyncJobData>;
  private collectionSyncQueue: JobQueue<SyncJobData>;

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

    // Create variant sync queue
    this.variantSyncQueue = await this.jobQueueService.createQueue({
      name: 'cms-variant-sync',
      process: async (job) => {
        Logger.info(`[${loggerCtx}] Processing variant sync job: ${JSON.stringify(job.data)}`);
        const result = await this.cmsSyncService.syncVariantToCms(job.data);
        Logger.info(`[${loggerCtx}] Variant sync result: ${JSON.stringify(result)}`);
        return result;
      }
    });

    // Create collection sync queue
    this.collectionSyncQueue = await this.jobQueueService.createQueue({
      name: 'cms-collection-sync',
      process: async (job) => {
        Logger.info(`[${loggerCtx}] Processing collection sync job: ${JSON.stringify(job.data)}`);
        const result = await this.cmsSyncService.syncCollectionToCms(job.data);
        Logger.info(`[${loggerCtx}] Collection sync result: ${JSON.stringify(result)}`);
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

    // Listen for ProductVariant events
    this.eventBus.ofType(ProductVariantEvent).subscribe(async (event) => {
      try {
        const variantIds = event.entity.map(v => v.id).join(', ');
        Logger.info(`[${loggerCtx}] ProductVariant event detected: ${event.type} for variants ${variantIds}`);
        
        // Create a sync job for each variant
        for (const variant of event.entity) {
          const syncData = this.extractVariantSyncData(event, variant);
          await this.variantSyncQueue.add(syncData);
        }
        
        Logger.info(`[${loggerCtx}] ProductVariant sync jobs queued for variants ${variantIds}`);
      } catch (error) {
        Logger.error(`[${loggerCtx}] Failed to queue variant sync job: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      }
    });

    // Listen for Collection events
    this.eventBus.ofType(CollectionEvent).subscribe(async (event) => {
      try {
        const syncData = this.extractCollectionSyncData(event);
        
        Logger.info(`[${loggerCtx}] Collection event detected: ${event.type} for collection ${event.entity.id}`);
        
        await this.collectionSyncQueue.add(syncData);
        
        Logger.info(`[${loggerCtx}] Collection sync job queued for collection ${event.entity.id}`);
      } catch (error) {
        Logger.error(`[${loggerCtx}] Failed to queue collection sync job: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      }
    });

    Logger.info(`[${loggerCtx}] CMS Plugin initialized with product, variant, and collection sync queues`);
  }

  private extractSyncData(event: ProductEvent): SyncJobData {
    return {
      entityType: 'product',
      entityId: event.entity.id,
      operationType: this.mapEventTypeToOperation(event.type),
      timestamp: new Date().toISOString(),
      retryCount: 0
    };
  }

  private extractVariantSyncData(event: ProductVariantEvent, variant: ProductVariant): SyncJobData {
    return {
      entityType: 'variant',
      entityId: variant.id,
      operationType: this.mapEventTypeToOperation(event.type),
      timestamp: new Date().toISOString(),
      retryCount: 0
    };
  }

  private extractCollectionSyncData(event: CollectionEvent): SyncJobData {
    return {
      entityType: 'collection',
      entityId: event.entity.id,
      operationType: this.mapEventTypeToOperation(event.type),
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
