import { Injectable } from "@nestjs/common";
import {
  Logger,
  TransactionalConnection,
  Product,
  ProductVariant,
  Collection,
} from "@vendure/core";
import { SyncJobData, SyncResponse } from "./types";
import { loggerCtx } from "./constants";

@Injectable()
export class CmsSyncService {
  constructor(private connection: TransactionalConnection) {}

  async syncProductToCms(jobData: SyncJobData): Promise<SyncResponse> {
    try {
      // Fetch fresh product data from database
      const product = await this.connection.getRepository(Product).findOne({
        where: { id: jobData.entityId },
        relations: ["translations"],
      });

      if (!product) {
        throw new Error(`Product with ID ${jobData.entityId} not found`);
      }

      Logger.info(
        `[${loggerCtx}] Product ${jobData.operationType}: ${JSON.stringify(
          {
            id: product.id,
            operation: jobData.operationType,
            timestamp: jobData.timestamp,
            translations: product.translations,
          },
          null,
          2,
        )}`,
      );

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
      const variant = await this.connection
        .getRepository(ProductVariant)
        .findOne({
          where: { id: jobData.entityId },
          relations: ["translations"],
        });

      if (!variant) {
        throw new Error(`ProductVariant with ID ${jobData.entityId} not found`);
      }

      Logger.info(
        `[${loggerCtx}] Variant ${jobData.operationType}: ${JSON.stringify(
          {
            id: variant.id,
            operation: jobData.operationType,
            timestamp: jobData.timestamp,
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
      const collection = await this.connection
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
        `[${loggerCtx}] Collection sync failed: ${errorMessage}`,
        errorStack,
      );
      return {
        success: false,
        message: `Collection sync failed: ${errorMessage}`,
      };
    }
  }
}
