// TODO: Remove onApplicationBootstrap
// TODO: Add real api calls to collection and variants

import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  ChannelService,
  Collection,
  ID,
  LanguageCode,
  Logger,
  ProcessContext,
  Product,
  ProductVariant,
  RequestContext,
  RequestContextService,
  TransactionalConnection,
} from "@vendure/core";
import { CMS_PLUGIN_OPTIONS, loggerCtx } from "../constants";
import { PluginInitOptions, SyncJobData, SyncResponse } from "../types";
import { TranslationUtils } from "../utils/translation.utils";
import { StoryblokService } from "./storyblok.service";

@Injectable()
export class CmsSyncService implements OnApplicationBootstrap {
  private readonly translationUtils = new TranslationUtils();

  // Entity type constants - following the pattern from StoryblokService
  private readonly ENTITY_TYPES = {
    product: "Product",
    product_variant: "ProductVariant",
    collection: "Collection",
  } as const;

  constructor(
    @Inject(CMS_PLUGIN_OPTIONS) private options: PluginInitOptions,
    private readonly connection: TransactionalConnection,
    private readonly channelService: ChannelService,
    private readonly requestContextService: RequestContextService,
    private readonly storyblockService: StoryblokService,
    private processContext: ProcessContext,
  ) {}

  async onApplicationBootstrap() {
    if (this.processContext.isWorker) {
      // TODO: Uncomment to enable auto-sync on startup (not recommended for production)
      // await this.syncAllEntitiesToCmsGeneric(
      // "Product",
      // Product,
      // this.syncProductToCms.bind(this),
      // );
      // Logger.info("CMS Sync Service initialized");
    }
  }
  ensureContentTypesExists() {
    throw new Error("Method not implemented.");
  }

  private async getDefaultLanguageCode(): Promise<LanguageCode> {
    const defaultChannel = await this.channelService.getDefaultChannel();
    return defaultChannel.defaultLanguageCode;
  }

  private async syncAllEntitiesToCmsGeneric<T extends { id: any }>(
    entityType: "Product" | "ProductVariant" | "Collection",
    repository: any,
    syncMethod: (jobData: SyncJobData) => Promise<SyncResponse>,
  ): Promise<{
    success: boolean;
    totalEntities: number;
    successCount: number;
    errorCount: number;
    errors: Array<{
      entityId: number | string;
      error: string;
      attempts: number;
    }>;
  }> {
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    const finalErrors: Array<{
      entityId: number | string;
      error: string;
      attempts: number;
    }> = [];

    try {
      Logger.info(
        `[${loggerCtx}] Starting sync of all ${entityType.toLowerCase()}s to CMS with rate limiting`,
      );

      // Fetch all entities with translations
      const entities = await this.connection.rawConnection
        .getRepository(repository)
        .find({
          relations: ["translations"],
          order: { id: "ASC" },
        });

      const totalEntities = entities.length;
      Logger.info(
        `[${loggerCtx}] Found ${totalEntities} ${entityType.toLowerCase()}s to sync`,
      );

      if (totalEntities === 0) {
        return {
          success: true,
          totalEntities: 0,
          successCount: 0,
          errorCount: 0,
          errors: [],
        };
      }

      // Create a job queue with retry logic
      interface EntityJob {
        entity: T;
        attempts: number;
        maxAttempts: number;
        lastError?: string;
      }

      // Initialize job queue
      const jobQueue: EntityJob[] = entities.map((entity) => ({
        entity: entity as T,
        attempts: 0,
        maxAttempts: 10,
        lastError: undefined,
      }));

      let processedCount = 0;
      const rateLimitDelay = 1000 / 5; // 5 calls per second

      // Process jobs with rate limiting and retries
      while (jobQueue.length > 0) {
        const currentJob = jobQueue.shift()!;
        currentJob.attempts++;

        Logger.info(
          `[${loggerCtx}] Processing ${entityType.toLowerCase()} ${currentJob.entity.id} (attempt ${currentJob.attempts}/${currentJob.maxAttempts}) - ${processedCount + 1}/${totalEntities} total`,
        );

        try {
          // Rate limiting: Wait before making the API call
          await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));

          await syncMethod({
            entityType,
            entityId: currentJob.entity.id,
            operationType: "update",
            timestamp: new Date().toISOString(),
            retryCount: 0,
          });

          successCount++;
          processedCount++;
          Logger.debug(
            `[${loggerCtx}] Successfully synced ${entityType.toLowerCase()} ${currentJob.entity.id} after ${currentJob.attempts} attempts`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          const errorStack = error instanceof Error ? error.stack : "";
          currentJob.lastError = errorMessage;

          Logger.error(
            `[${loggerCtx}] Attempt ${currentJob.attempts} failed for ${entityType.toLowerCase()} ${currentJob.entity.id}: ${errorMessage}`,
            errorStack,
          );

          // Check if we should retry
          if (currentJob.attempts < currentJob.maxAttempts) {
            const backoffDelay = Math.min(
              1000 * Math.pow(2, currentJob.attempts - 1),
              10000,
            );

            Logger.info(
              `[${loggerCtx}] Requeuing ${entityType.toLowerCase()} ${currentJob.entity.id} for retry in ${backoffDelay}ms (attempt ${currentJob.attempts + 1}/${currentJob.maxAttempts})`,
            );

            setTimeout(() => {
              jobQueue.push(currentJob);
            }, backoffDelay);
          } else {
            // Max attempts reached
            errorCount++;
            processedCount++;
            finalErrors.push({
              entityId: currentJob.entity.id,
              error: `Failed after ${currentJob.maxAttempts} attempts. Last error: ${errorMessage}`,
              attempts: currentJob.attempts,
            });
            Logger.error(
              `[${loggerCtx}] ${entityType} ${currentJob.entity.id} failed permanently after ${currentJob.maxAttempts} attempts`,
            );
          }
        }

        // Progress logging every 10 processed items
        if (processedCount % 10 === 0) {
          Logger.info(
            `[${loggerCtx}] Progress: ${processedCount}/${totalEntities} processed, ${successCount} successful, ${errorCount} failed, ${jobQueue.length} in queue`,
          );
        }
      }

      const duration = Date.now() - startTime;
      const result = {
        success: errorCount === 0,
        totalEntities,
        successCount,
        errorCount,
        errors: finalErrors,
      };

      Logger.info(
        `[${loggerCtx}] Bulk ${entityType.toLowerCase()} sync completed in ${duration}ms: ${successCount}/${totalEntities} successful, ${errorCount} permanently failed`,
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(
        `[${loggerCtx}] Bulk ${entityType.toLowerCase()} sync failed: ${errorMessage}`,
      );

      return {
        success: false,
        totalEntities: 0,
        successCount,
        errorCount: errorCount + 1,
        errors: [
          ...finalErrors,
          { entityId: -1, error: errorMessage, attempts: 1 },
        ],
      };
    }
  }

  async syncAllProductsToCms(): Promise<{
    success: boolean;
    totalProducts: number;
    successCount: number;
    errorCount: number;
    errors: Array<{
      productId: number | string;
      error: string;
      attempts: number;
    }>;
  }> {
    const result = await this.syncAllEntitiesToCmsGeneric(
      "Product",
      Product,
      this.syncProductToCms.bind(this),
    );

    return {
      success: result.success,
      totalProducts: result.totalEntities,
      successCount: result.successCount,
      errorCount: result.errorCount,
      errors: result.errors.map((e) => ({
        productId: e.entityId,
        error: e.error,
        attempts: e.attempts,
      })),
    };
  }

  /**
   * Syncs all product variants in the database to the CMS with rate limiting and retry logic
   * @returns Summary of sync results
   */
  async syncAllProductVariantsToCms(): Promise<{
    success: boolean;
    totalProductVariants: number;
    successCount: number;
    errorCount: number;
    errors: Array<{
      productVariantId: number | string;
      error: string;
      attempts: number;
    }>;
  }> {
    const result = await this.syncAllEntitiesToCmsGeneric(
      "ProductVariant",
      ProductVariant,
      this.syncVariantToCms.bind(this),
    );

    return {
      success: result.success,
      totalProductVariants: result.totalEntities,
      successCount: result.successCount,
      errorCount: result.errorCount,
      errors: result.errors.map((e) => ({
        productVariantId: e.entityId,
        error: e.error,
        attempts: e.attempts,
      })),
    };
  }

  /**
   * Syncs all collections in the database to the CMS with rate limiting and retry logic
   * @returns Summary of sync results
   */
  async syncAllCollectionsToCms(): Promise<{
    success: boolean;
    totalCollections: number;
    successCount: number;
    errorCount: number;
    errors: Array<{
      collectionId: number | string;
      error: string;
      attempts: number;
    }>;
  }> {
    const result = await this.syncAllEntitiesToCmsGeneric(
      "Collection",
      Collection,
      this.syncCollectionToCms.bind(this),
    );

    return {
      success: result.success,
      totalCollections: result.totalEntities,
      successCount: result.successCount,
      errorCount: result.errorCount,
      errors: result.errors.map((e) => ({
        collectionId: e.entityId,
        error: e.error,
        attempts: e.attempts,
      })),
    };
  }

  async syncProductToCms(jobData: SyncJobData): Promise<SyncResponse> {
    try {
      // Fetch fresh product data from database
      const product = await this.connection.rawConnection
        .getRepository(Product)
        .findOne({
          where: { id: jobData.entityId },
          relations: { translations: true },
        });

      const operationType = jobData.operationType;

      const defaultLanguageCode = await this.getDefaultLanguageCode();

      if (!product) {
        throw new Error(`Product with ID ${jobData.entityId} not found`);
      }

      Logger.info(
        `\n[${loggerCtx}] Product ${jobData.operationType}: ${JSON.stringify(
          {
            id: product.id,
            operation: jobData.operationType,
            timestamp: jobData.timestamp,
            translations: product.translations,
            defaultData: this.translationUtils.getTranslationByLanguage(
              product.translations,
              defaultLanguageCode,
            ),
            otherLanguages: product.translations.filter(
              (t) => t.languageCode !== defaultLanguageCode,
            ),
          },
          null,
          2,
        )}`,
      );

      // Get product slug for variant lookups
      const productSlug = this.translationUtils.getSlugByLanguage(
        product.translations,
        defaultLanguageCode,
      );

      await this.storyblockService.syncProduct({
        product,
        defaultLanguageCode,
        operationType,
        productSlug,
      });

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      // TODO: Replace with actual CMS API call
      // Example implementation:
      // const response = await this.cmsApiClient.post('/products', {
      //     id: product.id,
      //     operation: jobData.operationType,
      //     translations: product.translations
      // });

      return {
        success: true,
        message: `Product ${jobData.operationType} synced successfully`,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : "";
      Logger.error(
        `[${loggerCtx}] Product sync failed: ${errorMessage}`,
        errorStack,
      );
      return {
        success: false,
        message: `Product sync failed: ${errorMessage}`,
      };
    }
  }

  async syncVariantToCms(jobData: SyncJobData): Promise<SyncResponse> {
    try {
      // Fetch fresh variant data from database with product relation
      const variant = await this.connection.rawConnection
        .getRepository(ProductVariant)
        .findOne({
          where: { id: jobData.entityId },
          relations: ["translations", "product", "product.translations"],
        });

      const operationType = jobData.operationType;
      const defaultLanguageCode = await this.getDefaultLanguageCode();

      if (!variant) {
        throw new Error(`ProductVariant with ID ${jobData.entityId} not found`);
      }

      // Generate variant slug from parent product slug + variant ID
      const productSlug = this.translationUtils.getSlugByLanguage(
        variant.product.translations,
        defaultLanguageCode,
      );
      const variantSlug = productSlug
        ? `${productSlug}-variant-${variant.id}`
        : `variant-${variant.id}`;

      Logger.info(
        `\n[${loggerCtx}] Variant ${jobData.operationType}: ${JSON.stringify(
          {
            id: variant.id,
            operation: jobData.operationType,
            timestamp: jobData.timestamp,
            translations: variant.translations,
            generatedSlug: variantSlug,
            defaultData: this.translationUtils.getTranslationByLanguage(
              variant.translations,
              defaultLanguageCode,
            ),
          },
          null,
          2,
        )}`,
      );

      await this.storyblockService.syncProductVariant({
        variant,
        defaultLanguageCode,
        operationType,
        variantSlug,
      });

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        success: true,
        message: `Variant ${jobData.operationType} synced successfully`,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : "";
      Logger.error(
        `[${loggerCtx}] Variant sync failed: ${errorMessage}`,
        errorStack,
      );
      return {
        success: false,
        message: `Variant sync failed: ${errorMessage}`,
      };
    }
  }

  async syncCollectionToCms(jobData: SyncJobData): Promise<SyncResponse> {
    try {
      // Fetch fresh collection data from database
      const collection = await this.connection.rawConnection
        .getRepository(Collection)
        .findOne({
          where: { id: jobData.entityId },
          relations: ["translations"],
        });

      if (!collection) {
        throw new Error(`Collection with ID ${jobData.entityId} not found`);
      }

      Logger.info(
        `[${loggerCtx}] Collection ${jobData.operationType}: ${JSON.stringify(
          {
            id: collection.id,
            operation: jobData.operationType,
            timestamp: jobData.timestamp,
            translations: collection.translations,
          },
          null,
          2,
        )}`,
      );

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      // TODO: Replace with actual CMS API call
      // Example implementation:
      // const response = await this.cmsApiClient.post('/collections', {
      //     id: collection.id,
      //     operation: jobData.operationType,
      //     translations: collection.translations
      // });

      return {
        success: true,
        message: `Collection ${jobData.operationType} synced successfully`,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : "";
      Logger.error(
        `\n[${loggerCtx}] Collection sync failed: ${errorMessage}`,
        errorStack,
      );
      return {
        success: false,
        message: `Collection sync failed: ${errorMessage}`,
      };
    }
  }
}
