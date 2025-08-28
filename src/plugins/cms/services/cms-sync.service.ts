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
      this.syncAllProductsToCms();
      Logger.info("Synced All Products");
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
   * Syncs all products in the database to the CMS
   * @returns Summary of sync results
   */
  async syncAllProductsToCms(): Promise<{
    success: boolean;
    totalProducts: number;
    successCount: number;
    errorCount: number;
    errors: Array<{ productId: number | string; error: string }>;
  }> {
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ productId: number | string; error: string }> = [];

    try {
      Logger.info(`[${loggerCtx}] Starting sync of all products to CMS`);

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

      // Process products in batches to avoid overwhelming the API
      const batchSize = 3;
      for (let i = 0; i < products.length; i += batchSize) {
        const batch = products.slice(i, i + batchSize);

        Logger.info(
          `[${loggerCtx}] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)} (products ${i + 1}-${Math.min(i + batchSize, products.length)})`,
        );

        // Process batch concurrently but with controlled concurrency
        const batchPromises = batch.map(async (product) => {
          try {
            await this.storyblockService.syncProduct({
              product,
              defaultLanguageCode,
              operationType: "update", // Use update which will create if not exists
            });
            successCount++;
            Logger.debug(
              `[${loggerCtx}] Successfully synced product ${product.id}`,
            );
          } catch (error) {
            errorCount++;
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            errors.push({
              productId: product.id,
              error: errorMessage,
            });
            Logger.error(
              `[${loggerCtx}] Failed to sync product ${product.id}: ${errorMessage}`,
            );
          }
        });

        await Promise.all(batchPromises);

        // Small delay between batches to be nice to the API
        if (i + batchSize < products.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      const duration = Date.now() - startTime;
      const result = {
        success: errorCount === 0,
        totalProducts,
        successCount,
        errorCount,
        errors,
      };

      Logger.info(
        `[${loggerCtx}] Bulk sync completed in ${duration}ms: ${successCount}/${totalProducts} successful, ${errorCount} failed`,
      );

      if (errorCount > 0) {
        Logger.warn(
          `[${loggerCtx}] ${errorCount} products failed to sync. First few errors:`,
          errors
            .slice(0, 5)
            .map((e) => `Product ${e.productId}: ${e.error}`)
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
        errors: [...errors, { productId: -1, error: errorMessage }],
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
