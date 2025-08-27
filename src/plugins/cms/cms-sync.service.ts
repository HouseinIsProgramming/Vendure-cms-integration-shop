import { Injectable, Inject } from "@nestjs/common";
import {
  Logger,
  TransactionalConnection,
  Product,
  ProductVariant,
  Collection,
} from "@vendure/core";
import { SyncJobData, SyncResponse, PluginInitOptions } from "./types";
import { CMS_PLUGIN_OPTIONS, loggerCtx } from "./constants";

@Injectable()
export class CmsSyncService {
  private readonly storyblokBaseUrl = "https://mapi.storyblok.com/v1";

  constructor(
    private connection: TransactionalConnection,
    @Inject(CMS_PLUGIN_OPTIONS) private options: PluginInitOptions,
  ) {}

  private getStoryblokHeaders(): Record<string, string> {
    if (!this.options.cmsApiKey) {
      throw new Error("Storyblok API key is not configured");
    }

    return {
      Authorization: this.options.cmsApiKey,
      "Content-Type": "application/json",
    };
  }

  private async makeStoryblokRequest(
    method: "GET" | "POST" | "PUT" | "DELETE",
    endpoint: string,
    data?: any,
  ): Promise<any> {
    const url = `${this.storyblokBaseUrl}/spaces/${this.options.storyblokSpaceId}${endpoint}`;

    const config: RequestInit = {
      method,
      headers: this.getStoryblokHeaders(),
    };

    if (data && (method === "POST" || method === "PUT")) {
      config.body = JSON.stringify(data);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Storyblok API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    if (method === "DELETE") {
      return {}; // DELETE requests typically don't return content
    }

    return await response.json();
  }

  private getComponentType(
    entity: Product | ProductVariant | Collection,
  ): string {
    switch (entity.constructor.name) {
      case "Product":
        return "product";
      case "ProductVariant":
        return "product_variant";
      case "Collection":
        return "collection";
      default:
        throw new Error(`Unsupported entity type: ${entity.constructor.name}`);
    }
  }

  private createStoryContent(
    entity: Product | ProductVariant | Collection,
    operationType: string,
  ): any {
    const baseContent: any = {
      component: this.getComponentType(entity),
      vendureId: entity.id.toString(),
      vendureTitle:
        entity.translations?.[0]?.name ||
        `${entity.constructor.name} ${entity.id}`,
    };

    // Add vendureSlug based on entity type
    if (entity instanceof Product) {
      baseContent.vendureSlug =
        entity.translations?.[0]?.slug || `product-${entity.id}`;
    } else if (entity instanceof ProductVariant) {
      // Variants might not have direct slug, using ID-based approach
      baseContent.vendureSlug = `variant-${entity.id}`;
    } else if (entity instanceof Collection) {
      baseContent.vendureSlug =
        entity.translations?.[0]?.slug || `collection-${entity.id}`;
    }

    // Add localized translations (title and slug only as per spec)
    if (entity.translations && entity.translations.length > 0) {
      baseContent.localizedFields = entity.translations.map((translation) => {
        const localized: any = {
          language_code: translation.languageCode,
          title: translation.name,
        };

        // Only add slug for entities that have it in their translations
        if (entity instanceof Product || entity instanceof Collection) {
          localized.slug = (translation as any).slug || "";
        } else if (entity instanceof ProductVariant) {
          // ProductVariants don't have slug in translations, use ID-based approach
          localized.slug = `variant-${entity.id}`;
        }

        return localized;
      });
    }

    return baseContent;
  }

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

      // Create Storyblok story content
      const storyContent = this.createStoryContent(
        product,
        jobData.operationType,
      );
      const storySlug =
        product.translations?.[0]?.slug ||
        product.slug ||
        `product-${product.id}`;
      const storyName =
        product.translations?.[0]?.name || `Product ${product.id}`;

      let result;
      if (jobData.operationType === "create") {
        // Create new story in Storyblok
        result = await this.makeStoryblokRequest("POST", "/stories/", {
          story: {
            name: storyName,
            slug: storySlug,
            content: storyContent,
          },
          publish: 1,
        });

        Logger.info(
          `[${loggerCtx}] Created Storyblok story for product ${product.id} with Storyblok ID: ${result.story.id}`,
        );
      } else if (jobData.operationType === "update") {
        // For updates, we need to find the existing story first
        // This assumes you store the Storyblok story ID somewhere or use a consistent naming pattern
        // For now, we'll create a new story if update fails
        try {
          // Try to update - you might need to implement a way to track Storyblok story IDs
          result = await this.makeStoryblokRequest(
            "PUT",
            `/stories/${storySlug}`,
            {
              story: {
                name: storyName,
                content: storyContent,
              },
              publish: 1,
            },
          );

          Logger.info(
            `[${loggerCtx}] Updated Storyblok story for product ${product.id}`,
          );
        } catch (error) {
          // If update fails, create a new story
          Logger.warn(
            `[${loggerCtx}] Story not found for product ${product.id}, creating new story instead`,
          );
          result = await this.makeStoryblokRequest("POST", "/stories/", {
            story: {
              name: storyName,
              slug: storySlug,
              content: storyContent,
            },
            publish: 1,
          });
        }
      } else if (jobData.operationType === "delete") {
        // For delete operations, we need the Storyblok story ID
        try {
          await this.makeStoryblokRequest(
            "DELETE",
            `/stories/${storySlug}`,
            null,
          );
          Logger.info(
            `[${loggerCtx}] Deleted Storyblok story for product ${product.id}`,
          );
        } catch (error) {
          Logger.warn(
            `[${loggerCtx}] Could not delete Storyblok story for product ${product.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
        result = { success: true };
      }

      return {
        success: true,
        message: `Product ${jobData.operationType} synced successfully to Storyblok`,
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

      // Create Storyblok story content
      const storyContent = this.createStoryContent(
        variant,
        jobData.operationType,
      );
      const storySlug = `variant-${variant.id}`;
      const storyName =
        variant.translations?.[0]?.name || `Variant ${variant.id}`;

      let result;
      if (jobData.operationType === "create") {
        // Create new story in Storyblok
        result = await this.makeStoryblokRequest("POST", "/stories/", {
          story: {
            name: storyName,
            slug: storySlug,
            content: storyContent,
          },
          publish: 1,
        });

        Logger.info(
          `[${loggerCtx}] Created Storyblok story for variant ${variant.id} with Storyblok ID: ${result.story.id}`,
        );
      } else if (jobData.operationType === "update") {
        try {
          result = await this.makeStoryblokRequest(
            "PUT",
            `/stories/${storySlug}`,
            {
              story: {
                name: storyName,
                content: storyContent,
              },
              publish: 1,
            },
          );

          Logger.info(
            `[${loggerCtx}] Updated Storyblok story for variant ${variant.id}`,
          );
        } catch (error) {
          Logger.warn(
            `[${loggerCtx}] Update failed for variant ${variant.id}, creating new story instead`,
          );
          result = await this.makeStoryblokRequest("POST", "/stories/", {
            story: {
              name: storyName,
              slug: storySlug,
              content: storyContent,
            },
            publish: 1,
          });
        }
      } else if (jobData.operationType === "delete") {
        try {
          await this.makeStoryblokRequest(
            "DELETE",
            `/stories/${storySlug}`,
            null,
          );
          Logger.info(
            `[${loggerCtx}] Deleted Storyblok story for variant ${variant.id}`,
          );
        } catch (error) {
          Logger.warn(
            `[${loggerCtx}] Could not delete Storyblok story for variant ${variant.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
        result = { success: true };
      }

      return {
        success: true,
        message: `Variant ${jobData.operationType} synced successfully to Storyblok`,
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

      // Create Storyblok story content
      const storyContent = this.createStoryContent(
        collection,
        jobData.operationType,
      );
      const storySlug =
        collection.translations?.[0]?.slug ||
        collection.slug ||
        `collection-${collection.id}`;
      const storyName =
        collection.translations?.[0]?.name || `Collection ${collection.id}`;

      let result;
      if (jobData.operationType === "create") {
        // Create new story in Storyblok
        result = await this.makeStoryblokRequest("POST", "/stories/", {
          story: {
            name: storyName,
            slug: storySlug,
            content: storyContent,
          },
          publish: 1,
        });

        Logger.info(
          `[${loggerCtx}] Created Storyblok story for collection ${collection.id} with Storyblok ID: ${result.story.id}`,
        );
      } else if (jobData.operationType === "update") {
        try {
          result = await this.makeStoryblokRequest(
            "PUT",
            `/stories/${storySlug}`,
            {
              story: {
                name: storyName,
                content: storyContent,
              },
              publish: 1,
            },
          );

          Logger.info(
            `[${loggerCtx}] Updated Storyblok story for collection ${collection.id}`,
          );
        } catch (error) {
          Logger.warn(
            `[${loggerCtx}] Update failed for collection ${collection.id}, creating new story instead`,
          );
          result = await this.makeStoryblokRequest("POST", "/stories/", {
            story: {
              name: storyName,
              slug: storySlug,
              content: storyContent,
            },
            publish: 1,
          });
        }
      } else if (jobData.operationType === "delete") {
        try {
          await this.makeStoryblokRequest(
            "DELETE",
            `/stories/${storySlug}`,
            null,
          );
          Logger.info(
            `[${loggerCtx}] Deleted Storyblok story for collection ${collection.id}`,
          );
        } catch (error) {
          Logger.warn(
            `[${loggerCtx}] Could not delete Storyblok story for collection ${collection.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }
        result = { success: true };
      }

      return {
        success: true,
        message: `Collection ${jobData.operationType} synced successfully to Storyblok`,
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
