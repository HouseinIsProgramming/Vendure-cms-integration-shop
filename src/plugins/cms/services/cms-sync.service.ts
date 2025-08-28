import { Injectable, Inject, OnApplicationBootstrap } from "@nestjs/common";
import {
  Logger,
  TransactionalConnection,
  Product,
  ProductVariant,
  Collection,
  ChannelService,
  RequestContextService,
  LanguageCode,
  ProcessContext,
} from "@vendure/core";
import { SyncJobData, SyncResponse, PluginInitOptions } from "../types";
import { CMS_PLUGIN_OPTIONS, loggerCtx } from "../constants";
import { StoryblokService } from "./storyblok.service";
import { TranslationUtils } from "../utils/translation.utils";

@Injectable()
export class CmsSyncService implements OnApplicationBootstrap {
  private readonly translationUtils = new TranslationUtils();

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
      // TODO: comment to disable auto-sync on startup (not recommended for production)
      this.syncAllProductsToCms();
      Logger.info("CMS Sync Service initialized");
    }
  }
  ensureContentTypesExists() {
    throw new Error("Method not implemented.");
  }

  private async getDefaultLanguageCode(): Promise<LanguageCode> {
    const defaultChannel = await this.channelService.getDefaultChannel();
    return defaultChannel.defaultLanguageCode;
  }

  /**
   * Syncs all products in the database to the CMS with rate limiting and retry logic
   * @returns Summary of sync results
   */
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
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    const finalErrors: Array<{
      productId: number | string;
      error: string;
      attempts: number;
    }> = [];

    try {
      Logger.info(
        `[${loggerCtx}] Starting sync of all products to CMS with rate limiting`,
      );

      // Fetch all products with translations
      const products = await this.connection.rawConnection
        .getRepository(Product)
        .find({
          relations: { translations: true },
          order: { id: "ASC" },
        });

      const totalProducts = products.length;
      Logger.info(`[${loggerCtx}] Found ${totalProducts} products to sync`);

      if (totalProducts === 0) {
        return {
          success: true,
          totalProducts: 0,
          successCount: 0,
          errorCount: 0,
          errors: [],
        };
      }

      const defaultLanguageCode = await this.getDefaultLanguageCode();

      // Create a job queue with retry logic
      interface ProductJob {
        product: Product;
        attempts: number;
        maxAttempts: number;
        lastError?: string;
      }

      // Initialize job queue
      const jobQueue: ProductJob[] = products.map((product) => ({
        product,
        attempts: 0,
        maxAttempts: 10, // Maximum 5 attempts per product
        lastError: undefined,
      }));

      let processedCount = 0;
      const rateLimitDelay = 1000 / 5; // 6 calls per second (StoryBlock rate limiting)

      // Process jobs with rate limiting and retries
      while (jobQueue.length > 0) {
        const currentJob = jobQueue.shift()!;
        currentJob.attempts++;

        Logger.info(
          `[${loggerCtx}] Processing product ${currentJob.product.id} (attempt ${currentJob.attempts}/${currentJob.maxAttempts}) - ${processedCount + 1}/${totalProducts} total`,
        );

        try {
          // Rate limiting: Wait before making the API call
          await new Promise((resolve) => setTimeout(resolve, rateLimitDelay));

          await this.storyblockService.syncProduct({
            product: currentJob.product,
            defaultLanguageCode,
            operationType: "update", // Use update which will create if not exists
          });

          successCount++;
          processedCount++;
          Logger.debug(
            `[${loggerCtx}] Successfully synced product ${currentJob.product.id} after ${currentJob.attempts} attempts`,
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          currentJob.lastError = errorMessage;

          Logger.warn(
            `[${loggerCtx}] Attempt ${currentJob.attempts} failed for product ${currentJob.product.id}: ${errorMessage}`,
          );

          // Check if we should retry
          if (currentJob.attempts < currentJob.maxAttempts) {
            // Calculate exponential backoff delay (additional delay on top of rate limiting)
            const backoffDelay = Math.min(
              1000 * Math.pow(2, currentJob.attempts - 1),
              10000,
            ); // Max 10s backoff

            Logger.info(
              `[${loggerCtx}] Requeuing product ${currentJob.product.id} for retry in ${backoffDelay}ms (attempt ${currentJob.attempts + 1}/${currentJob.maxAttempts})`,
            );

            // Add back to queue for retry with exponential backoff
            setTimeout(() => {
              jobQueue.push(currentJob);
            }, backoffDelay);
          } else {
            // Max attempts reached
            errorCount++;
            processedCount++;
            finalErrors.push({
              productId: currentJob.product.id,
              error: `Failed after ${currentJob.maxAttempts} attempts. Last error: ${errorMessage}`,
              attempts: currentJob.attempts,
            });
            Logger.error(
              `[${loggerCtx}] Product ${currentJob.product.id} failed permanently after ${currentJob.maxAttempts} attempts`,
            );
          }
        }

        // Progress logging every 10 processed items
        if (processedCount % 10 === 0) {
          Logger.info(
            `[${loggerCtx}] Progress: ${processedCount}/${totalProducts} processed, ${successCount} successful, ${errorCount} failed, ${jobQueue.length} in queue`,
          );
        }
      }

      const duration = Date.now() - startTime;
      const result = {
        success: errorCount === 0,
        totalProducts,
        successCount,
        errorCount,
        errors: finalErrors,
      };

      Logger.info(
        `[${loggerCtx}] Bulk sync completed in ${duration}ms: ${successCount}/${totalProducts} successful, ${errorCount} permanently failed`,
      );

      if (errorCount > 0) {
        Logger.warn(
          `[${loggerCtx}] ${errorCount} products failed permanently after retries:`,
          finalErrors
            .slice(0, 3)
            .map(
              (e) =>
                `Product ${e.productId} (${e.attempts} attempts): ${e.error}`,
            )
            .join(", "),
        );
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(`[${loggerCtx}] Bulk sync failed: ${errorMessage}`);

      return {
        success: false,
        totalProducts: 0,
        successCount,
        errorCount: errorCount + 1,
        errors: [
          ...finalErrors,
          { productId: -1, error: errorMessage, attempts: 1 },
        ],
      };
    }
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

      await this.storyblockService.syncProduct({
        product,
        defaultLanguageCode,
        operationType,
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
      // Fetch fresh variant data from database
      const variant = await this.connection.rawConnection
        .getRepository(ProductVariant)
        .findOne({
          where: { id: jobData.entityId },
          relations: ["translations"],
        });

      if (!variant) {
        throw new Error(`ProductVariant with ID ${jobData.entityId} not found`);
      }

      Logger.info(
        `\n[${loggerCtx}] Variant ${jobData.operationType}: ${JSON.stringify(
          {
            id: variant.id,
            operation: jobData.operationType,
            timestamp: jobData.timestamp,
            // translation is array so you have to map it
            translations: variant.translations,
          },
          null,
          2,
        )}`,
      );

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 100));

      // TODO: Replace with actual CMS API call
      // Example implementation:
      // const response = await this.cmsApiClient.post('/variants', {
      //     id: variant.id,
      //     operation: jobData.operationType,
      //     translations: variant.translations
      // });

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
