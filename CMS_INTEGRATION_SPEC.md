# CMS Integration Spec Sheet

## Overview

Build a Vendure plugin for CMS integration using the "Sync with Reference" pattern. Vendure remains the single source of truth for commerce data, while the CMS owns content enrichment.

## Core Requirements

### 1. Entities to Sync

#### Products

- **Fields**: `vendureId` (string, unique, required), `vendureTitle` (string, read-only), `vendureSlug` (string, indexed)
- **Localization**: title and slug must be localized

#### Product Variants

- **Fields**: `vendureId` (string, unique, required), `vendureTitle` (string, read-only), `vendureSlug` (string, indexed)
- **Localization**: title and slug must be localized

#### Collections

- **Fields**: `vendureId` (string, unique), `vendureTitle` (string, read-only), `vendureSlug` (string, unique)
- **Localization**: title and slug must be localized

### 2. Event-Driven Sync Implementation

#### Trigger Events

- Product: created, updated, deleted
- ProductVariant: created, updated, deleted
- Collection: created, updated, deleted

#### Technical Flow

1. EventBus emits entity event (ProductEvent, ProductVariantEvent, CollectionEvent)
2. Event listener captures change using `event.product`
3. Job dispatched to JobQueueService using `Queue.add({ <jobdata> })`
4. Job processor executes CMS API call
5. Success/failure logged

#### Job Queue Structure

- **Separate queues**: One per entity type (products, variants, collections)
- **Configuration**: Use JobQueueStrategy for limits and backoff
- **Retry Strategy**: Exponential backoff with dead letter queue
- **Job Payload Interface**:
  ```typescript
  interface SyncJobData {
    entityType: string;
    entityId: string;
    operationType: "create" | "update" | "delete";
    vendureData: { id: string; title: string; slug: string };
    timestamp: Date;
    retryCount: number;
  }
  ```

### 3. Scheduled Full Sync

#### Implementation

- **Feature**: Use Vendure scheduled tasks
- **Schedule**: Weekly (configurable)
- **Setup**: Add to schedulerOptions.tasks array, configure with ScheduledTask and cron
- **Flow**:
  1. Iterate through all entities
  2. Dispatch individual sync jobs per entity
  3. Rate-limited API calls
  4. Progress tracking and notifications

### 4. Manual Sync Triggers

#### Implementation

- **Location**: Vendure Admin entity detail pages
- **UI**: Action bar button "Sync to CMS"
- **Technical**: GraphQL API extension with custom resolver
- **Behavior**: Direct service method call (immediate, bypasses job queue)
- **Flow**: Loading state → API call → Success/error notification

## Sync Strategy Summary

| Trigger Type | Implementation     | Job Queue | Timing    |
| ------------ | ------------------ | --------- | --------- |
| Events       | EventBus listeners | Yes       | Async     |
| Scheduled    | ScheduledTask      | Yes       | Async     |
| Manual       | GraphQL resolver   | No        | Immediate |

## Implementation Details

### 1. Set up basic plugin structure

**Reference**: https://docs.vendure.io/guides/developer-guide/plugins/

**What happens**: Create a Vendure plugin using the `@VendurePlugin` decorator with proper module structure.

```typescript
@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [CmsSyncService, CmsJobProcessor],
  entities: [], // No custom entities needed for sync-only pattern
  configuration: (config) => {
    // Add scheduled task configuration
    config.schedulerOptions.tasks.push(fullSyncTask);
    return config;
  },
  shopApiExtensions: {
    resolvers: [CmsSyncResolver],
  },
})
export class CmsPlugin implements OnModuleInit {
  static init(options: PluginInitOptions): Type<CmsPlugin> {
    // Plugin initialization with options
  }
}
```

This is a mininal plugin that logs the event and translations of the product that was updated.

```typescript
export class CmsPlugin implements OnModuleInit {
  static options: PluginInitOptions;
  constructor(
    private eventBus: EventBus,
    private logger: Logger,
  ) {}

  onModuleInit() {
    this.eventBus.ofType(ProductEvent).subscribe((event) => {
      // Get all translation names
      const inputData = event.input as UpdateProductInput;
      const allInputs =
        inputData?.translations?.map(
          (t: ProductTranslationInput) => `${t.languageCode}: ${t.name}`,
        ) || [];

      this.logger.log(`\n Product updated - All inputs: ${inspect(inputData)}`);
      this.logger.log(
        `\n Product updated - Input translations: ${allInputs.join(", ")}`,
      );
    });
  }

  static init(options: PluginInitOptions): Type<CmsPlugin> {
    this.options = options;
    return CmsPlugin;
  }
}
```

### 2. Implement EventBus listeners for entity events

**Reference**: https://docs.vendure.io/guides/developer-guide/events/#entity-events

**What happens**: Subscribe to ProductEvent, ProductVariantEvent, and CollectionEvent using RxJS observables to trigger sync jobs when entities change.

```typescript
onModuleInit() {
  // Listen for Product events
  this.eventBus.ofType(ProductEvent).subscribe(async (event) => {
    const syncData = this.extractSyncData(event.entity, 'product');
    await this.productSyncQueue.add('sync-product', {
      entityType: 'product',
      entityId: event.entity.id,
      operationType: event.type, // 'created', 'updated', 'deleted'
      vendureData: syncData,
      timestamp: new Date(),
      retryCount: 0
    });
  });

  // Similar listeners for ProductVariantEvent and CollectionEvent
}

private extractSyncData(entity: Product | ProductVariant | Collection, type: string) {
  return {
    id: entity.id,
    title: entity.translations[0]?.name || '', // Primary translation
    slug: entity.translations[0]?.slug || ''
  };
}
```

### 3. Configure JobQueueService with separate queues

**Reference**: https://docs.vendure.io/guides/developer-guide/worker-job-queue/#the-job-queue

**What happens**: Create three separate job queues (products, variants, collections) with retry strategies and processing logic.

```typescript
    async onModuleInit() {
      // Product sync queue
      this.productSyncQueue = await this.jobQueueService.createQueue({
        name: 'cms-product-sync',
        process: async (job) => {
          console.log(`Processing product sync: ${JSON.stringify(job.data)}`);
          // Call CMS API here (console.log for now)
          await this.cmsSyncService.syncProductToCms(job.data);
          return { success: true };
        }
      });

      // Product Variant sync queue
      this.variantSyncQueue = await this.jobQueueService.createQueue({
        name: 'cms-variant-sync',
        process: async (job) => {
          console.log(`Processing variant sync: ${JSON.stringify(job.data)}`);
          await this.cmsSyncService.syncVariantToCms(job.data);
          return { success: true };
        }
      });

      // Collection sync queue
      this.collectionSyncQueue = await this.jobQueueService.createQueue({
        name: 'cms-collection-sync',
        process: async (job) => {
          console.log(`Processing collection sync: ${JSON.stringify(job.data)}`);
          await this.cmsSyncService.syncCollectionToCms(job.data);
          return { success: true };
        }
      });
    }
```

### 4. Create sync service with CMS API integration

**What happens**: Create a service that handles the actual CMS API calls. For now, using console.log to verify internal workings.

```typescript
@Injectable()
export class CmsSyncService {
  constructor(private logger: Logger) {}

  async syncProductToCms(jobData: SyncJobData): Promise<void> {
    console.log(`[CMS Sync] Product ${jobData.operationType}:`, {
      id: jobData.vendureData.id,
      title: jobData.vendureData.title,
      slug: jobData.vendureData.slug,
      operation: jobData.operationType,
    });

    // TODO: Replace with actual CMS API call
    // await this.cmsApiClient.syncProduct(jobData);
  }

  async syncVariantToCms(jobData: SyncJobData): Promise<void> {
    console.log(
      `[CMS Sync] Variant ${jobData.operationType}:`,
      jobData.vendureData,
    );
    // TODO: Replace with actual CMS API call
  }

  async syncCollectionToCms(jobData: SyncJobData): Promise<void> {
    console.log(
      `[CMS Sync] Collection ${jobData.operationType}:`,
      jobData.vendureData,
    );
    // TODO: Replace with actual CMS API call
  }
}
```

### 5. Add scheduled task for full sync

**Reference**: https://docs.vendure.io/guides/developer-guide/scheduled-tasks/

**What happens**: Create a weekly scheduled task that iterates through all entities and dispatches sync jobs for each one.

```typescript
const fullSyncTask = new ScheduledTask({
  id: "cms-full-sync",
  description: "Full sync of all products, variants, and collections to CMS",
  params: {},
  schedule: (cron) => cron.everyWeekOn(0, [0, 0]), // Sunday at midnight
  async execute({ injector }) {
    const logger = injector.get(Logger);
    const transactionalConnection = injector.get(TransactionalConnection);
    const jobQueueService = injector.get(JobQueueService);

    logger.log("Starting full CMS sync...");

    // Get all products
    const products = await transactionalConnection.getRepository(Product).find({
      relations: ["translations"],
    });

    // Get all variants
    const variants = await transactionalConnection
      .getRepository(ProductVariant)
      .find({
        relations: ["translations"],
      });

    // Get all collections
    const collections = await transactionalConnection
      .getRepository(Collection)
      .find({
        relations: ["translations"],
      });

    logger.log(
      `Found ${products.length} products, ${variants.length} variants, ${collections.length} collections`,
    );

    // Dispatch sync jobs for each entity (rate-limited)
    // TODO: Add rate limiting and progress tracking
    for (const product of products) {
      console.log(`Scheduling full sync for product: ${product.id}`);
      // Add to job queue...
    }
  },
});
```

### 6. Build GraphQL extension for manual sync

**Reference**: https://docs.vendure.io/guides/developer-guide/the-api-layer/

**What happens**: Create a GraphQL resolver with a mutation that allows manual triggering of sync for specific entities. This bypasses the job queue for immediate execution.

```typescript
@Resolver()
export class CmsSyncResolver {
  constructor(private cmsSyncService: CmsSyncService) {}

  @Mutation()
  @Allow(Permission.UpdateProduct) // Require appropriate permissions
  async syncProductToCms(
    @Ctx() ctx: RequestContext,
    @Args() args: { productId: ID },
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get product data directly
      const product = await ctx.injector
        .get(TransactionalConnection)
        .getRepository(Product)
        .findOne({
          where: { id: args.productId },
          relations: ["translations"],
        });

      if (!product) {
        return { success: false, message: "Product not found" };
      }

      // Direct sync call (immediate, no job queue)
      const syncData: SyncJobData = {
        entityType: "product",
        entityId: product.id,
        operationType: "update",
        vendureData: {
          id: product.id,
          title: product.translations[0]?.name || "",
          slug: product.translations[0]?.slug || "",
        },
        timestamp: new Date(),
        retryCount: 0,
      };

      await this.cmsSyncService.syncProductToCms(syncData);

      return { success: true, message: "Product synced successfully" };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Similar resolvers for variants and collections
}
```

## Key Differences Between Sync Methods

| Method       | Trigger          | Processing            | Use Case                     |
| ------------ | ---------------- | --------------------- | ---------------------------- |
| Event-driven | Entity changes   | Async via job queue   | Automatic real-time sync     |
| Scheduled    | Cron schedule    | Async via job queue   | Periodic full reconciliation |
| Manual       | GraphQL mutation | Immediate direct call | On-demand troubleshooting    |
