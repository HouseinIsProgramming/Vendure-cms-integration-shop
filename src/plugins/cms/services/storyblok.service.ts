// TODO: Remove onApplicationBootstrap

import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  LanguageCode,
  Product,
  ProductVariant,
  TransactionalConnection,
  ProcessContext,
  Logger,
} from "@vendure/core";
import { CMS_PLUGIN_OPTIONS } from "../constants";
import { OperationType, PluginInitOptions } from "../types";
import { TranslationUtils } from "../utils/translation.utils";
const COMPONENT_TYPE = {
  product: "vendure_product",
  product_variant: "vendure_product_variant",
  collection: "vendure_collection",
};

@Injectable()
export class StoryblokService implements OnApplicationBootstrap {
  private readonly storyblokBaseUrl = "https://mapi.storyblok.com/v1";
  private readonly componentsPath = "components";
  private isInitialized = false;
  private readonly translationUtils = new TranslationUtils();

  constructor(
    private connection: TransactionalConnection,
    private processContext: ProcessContext,
    @Inject(CMS_PLUGIN_OPTIONS) private options: PluginInitOptions,
  ) {}

  async onApplicationBootstrap() {
    if (this.processContext.isWorker) {
      await this.ensureContentTypesExists();
      Logger.info("Storyblok service initialized successfully");
    }
  }

  async syncProduct({
    product,
    defaultLanguageCode,
    operationType,
    productSlug,
  }: {
    product: Product;
    defaultLanguageCode: LanguageCode;
    operationType: OperationType;
    productSlug?: string | null;
  }) {
    try {
      this.translationUtils.validateTranslations(
        product.translations,
        defaultLanguageCode,
      );

      Logger.info(
        `Syncing product ${product.id} (${operationType}) to Storyblok`,
      );

      switch (operationType) {
        case "create":
          await this.createStoryFromProduct(product, defaultLanguageCode, productSlug);
          break;
        case "update":
          await this.updateStoryFromProduct(product, defaultLanguageCode, productSlug);
          break;
        case "delete":
          await this.deleteStoryFromProduct(product, defaultLanguageCode);
          break;
        default:
          Logger.error(`Unknown operation type: ${operationType}`);
      }

      Logger.info(
        `Successfully synced product ${product.id} (${operationType}) to Storyblok`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(
        `Failed to sync product ${product.id} (${operationType}) to Storyblok: ${errorMessage}`,
      );
      throw error;
    }
  }

  async syncProductVariant({
    variant,
    defaultLanguageCode,
    operationType,
  }: {
    variant: ProductVariant;
    defaultLanguageCode: LanguageCode;
    operationType: OperationType;
  }) {
    try {
      this.translationUtils.validateTranslations(
        variant.translations,
        defaultLanguageCode,
      );

      Logger.info(
        `Syncing product variant ${variant.id} (${operationType}) to Storyblok`,
      );

      switch (operationType) {
        case "create":
          await this.createStoryFromVariant(variant, defaultLanguageCode);
          break;
        case "update":
          await this.updateStoryFromVariant(variant, defaultLanguageCode);
          break;
        case "delete":
          await this.deleteStoryFromVariant(variant, defaultLanguageCode);
          break;
        default:
          Logger.error(`Unknown operation type: ${operationType}`);
      }

      Logger.info(
        `Successfully synced product variant ${variant.id} (${operationType}) to Storyblok`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      Logger.error(
        `Failed to sync product variant ${variant.id} (${operationType}) to Storyblok: ${errorMessage}`,
      );
      throw error;
    }
  }

  /**
   * Finds a Storyblok story by slug
   * @param slug The slug to search for
   * @returns The story object or null if not found
   */
  private async findStoryBySlug(slug: string): Promise<any> {
    try {
      const response = await this.makeStoryblokRequest({
        method: "GET",
        endpoint: `stories?by_slugs=${slug}`,
      });

      return response.stories.find((story: any) => story.slug === slug);
    } catch (error) {
      Logger.error(`Failed to find story by slug: ${slug}`, String(error));
    }
  }

  /**
   * Finds all product variants for a given product ID
   * @param productId The Vendure product ID
   * @returns Array of ProductVariant entities
   */
  private async findProductVariants(
    productId: string | number,
  ): Promise<ProductVariant[]> {
    try {
      const variants = await this.connection.rawConnection
        .getRepository(ProductVariant)
        .find({
          where: { productId: productId as any },
          relations: ["translations"],
          order: { id: "ASC" },
        });

      return variants;
    } catch (error) {
      Logger.error(
        `Failed to find variants for product ${productId}`,
        String(error),
      );
      return [];
    }
  }

  /**
   * Finds all Storyblok stories that represent variants of a product
   * @param productId The Vendure product ID
   * @param defaultLanguageCode The default language code to use for slug lookup
   * @returns Array of Storyblok story IDs
   */
  private async findVariantStoriesForProduct(
    productId: string | number,
    defaultLanguageCode: LanguageCode,
    productSlug?: string | null,
  ): Promise<string[]> {
    if (!productSlug) {
      return [];
    }

    const variants = await this.findProductVariants(productId);
    const storyIds: string[] = [];

    for (const variant of variants) {
      // Generate variant slug from product slug + variant ID
      const variantSlug = `${productSlug}-variant-${variant.id}`;
      const story = await this.findStoryBySlug(variantSlug);
      if (story?.id) {
        storyIds.push(story.id.toString());
      }
    }

    return storyIds;
  }

  /**
   * Finds the parent product story for a given variant
   * @param variant The ProductVariant entity
   * @param defaultLanguageCode The default language code to use for slug lookup
   * @returns Storyblok story ID of the parent product or null
   */
  private async findParentProductStory(
    variant: ProductVariant,
    defaultLanguageCode: LanguageCode,
  ): Promise<string | null> {
    try {
      const product = await this.connection.rawConnection
        .getRepository(Product)
        .findOne({
          where: { id: variant.productId },
          relations: ["translations"],
        });

      if (!product) {
        return null;
      }

      const slug = this.translationUtils.getSlugByLanguage(
        product.translations,
        defaultLanguageCode,
      );

      if (slug) {
        const story = await this.findStoryBySlug(slug);
        return story?.id?.toString() || null;
      }

      return null;
    } catch (error) {
      Logger.error(
        `Failed to find parent product for variant ${variant.id}`,
        String(error),
      );
      return null;
    }
  }

  private async createStoryFromProduct(
    product: Product,
    defaultLanguageCode: LanguageCode,
    productSlug?: string | null,
  ): Promise<void> {
    const data = await this.transformProductData(product, defaultLanguageCode, productSlug);
    if (!data) {
      Logger.error(
        `Cannot create story: no valid translation data for product ${product.id}`,
      );
      return;
    }

    const result = await this.makeStoryblokRequest({
      method: "POST",
      endpoint: "stories",
      data,
    });

    Logger.info(
      `Created story for product ${product.id} with Storyblok ID: ${result.story?.id}`,
    );
  }

  private async updateStoryFromProduct(
    product: Product,
    defaultLanguageCode: LanguageCode,
    productSlug?: string | null,
  ): Promise<void> {
    const slug = this.translationUtils.getSlugByLanguage(
      product.translations,
      defaultLanguageCode,
    );
    if (!slug) {
      Logger.error(
        `No slug found for product ${product.id} in language ${defaultLanguageCode}`,
      );
      return;
    }

    const existingStory = await this.findStoryBySlug(slug);

    if (!existingStory) {
      Logger.warn(
        `Story not found in Storyblok for slug: ${slug}. Creating new story instead.`,
      );
      await this.createStoryFromProduct(product, defaultLanguageCode);
      return;
    }

    const data = await this.transformProductData(product, defaultLanguageCode, productSlug);
    if (!data) {
      Logger.error(
        `Cannot update story: no valid translation data for product ${product.id}`,
      );
      return;
    }

    await this.makeStoryblokRequest({
      method: "PUT",
      endpoint: `stories/${existingStory.id}`,
      data,
    });

    Logger.info(
      `Updated story for product ${product.id} (Storyblok ID: ${existingStory.id})`,
    );
  }

  private async deleteStoryFromProduct(
    product: Product,
    defaultLanguageCode: LanguageCode,
  ): Promise<void> {
    const slug = this.translationUtils.getSlugByLanguage(
      product.translations,
      defaultLanguageCode,
    );
    if (!slug) {
      Logger.warn(
        `No slug found for product ${product.id}, cannot delete story`,
      );
      return;
    }

    const existingStory = await this.findStoryBySlug(slug);

    if (!existingStory) {
      Logger.warn(
        `Story not found in Storyblok for slug: ${slug}, nothing to delete`,
      );
      return;
    }

    await this.makeStoryblokRequest({
      method: "DELETE",
      endpoint: `stories/${existingStory.id}`,
    });

    Logger.info(
      `Deleted story for product ${product.id} (Storyblok ID: ${existingStory.id})`,
    );
  }

  // Variant-specific CRUD methods
  private async createStoryFromVariant(
    variant: ProductVariant,
    defaultLanguageCode: LanguageCode,
  ): Promise<void> {
    const data = await this.transformVariantData(variant, defaultLanguageCode);
    if (!data) {
      Logger.error(
        `Cannot create story: no valid translation data for variant ${variant.id}`,
      );
      return;
    }

    const result = await this.makeStoryblokRequest({
      method: "POST",
      endpoint: "stories",
      data,
    });

    Logger.info(
      `Created story for variant ${variant.id} with Storyblok ID: ${result.story?.id}`,
    );
  }

  private async updateStoryFromVariant(
    variant: ProductVariant,
    defaultLanguageCode: LanguageCode,
  ): Promise<void> {
    const slug = this.translationUtils.getSlugByLanguage(
      variant.translations,
      defaultLanguageCode,
    );
    if (!slug) {
      Logger.error(
        `No slug found for variant ${variant.id} in language ${defaultLanguageCode}`,
      );
      return;
    }

    const existingStory = await this.findStoryBySlug(slug);

    if (!existingStory) {
      Logger.warn(
        `Story not found in Storyblok for slug: ${slug}. Creating new story instead.`,
      );
      await this.createStoryFromVariant(variant, defaultLanguageCode);
      return;
    }

    const data = await this.transformVariantData(variant, defaultLanguageCode);
    if (!data) {
      Logger.error(
        `Cannot update story: no valid translation data for variant ${variant.id}`,
      );
      return;
    }

    await this.makeStoryblokRequest({
      method: "PUT",
      endpoint: `stories/${existingStory.id}`,
      data,
    });

    Logger.info(
      `Updated story for variant ${variant.id} (Storyblok ID: ${existingStory.id})`,
    );
  }

  private async deleteStoryFromVariant(
    variant: ProductVariant,
    defaultLanguageCode: LanguageCode,
  ): Promise<void> {
    const slug = this.translationUtils.getSlugByLanguage(
      variant.translations,
      defaultLanguageCode,
    );
    if (!slug) {
      Logger.warn(
        `No slug found for variant ${variant.id}, cannot delete story`,
      );
      return;
    }

    const existingStory = await this.findStoryBySlug(slug);

    if (!existingStory) {
      Logger.warn(
        `Story not found in Storyblok for slug: ${slug}, nothing to delete`,
      );
      return;
    }

    await this.makeStoryblokRequest({
      method: "DELETE",
      endpoint: `stories/${existingStory.id}`,
    });

    Logger.info(
      `Deleted story for variant ${variant.id} (Storyblok ID: ${existingStory.id})`,
    );
  }

  private async transformVariantData(
    variant: ProductVariant,
    defaultLanguageCode: LanguageCode,
  ) {
    const defaultTranslation = this.translationUtils.getTranslationByLanguage(
      variant.translations,
      defaultLanguageCode,
    );

    if (!defaultTranslation) {
      Logger.warn(
        `No translation found for variant ${variant.id} in language ${defaultLanguageCode}`,
      );
      return undefined;
    }

    // Find parent product story for this variant
    const parentProductStoryId = await this.findParentProductStory(
      variant,
      defaultLanguageCode,
    );

    const slug = this.translationUtils.getSlugByLanguage(
      variant.translations,
      defaultLanguageCode,
    );

    const result = {
      story: {
        name: defaultTranslation?.name,
        slug: slug,
        content: {
          component: COMPONENT_TYPE.product_variant,
          vendureId: variant.id.toString(),
          parentProduct: parentProductStoryId ? [parentProductStoryId] : [],
        },
      } as any,
      publish: 1,
    };

    return result;
  }

  ///export interface SyncJobData {
  //   entityType: string;
  //   entityId: ID;
  //   operationType: "create" | "update" | "delete";
  //   timestamp: string;
  //   retryCount: number;
  // }

  // Logger.info(
  //   `\n[${loggerCtx}] Product ${jobData.operationType}: ${JSON.stringify(
  //     {
  //       id: product.id,
  //       operation: jobData.operationType,
  //       timestamp: jobData.timestamp,
  //       translations: product.translations,
  //       defaultData: product.translations.filter(
  //         (t) => t.languageCode === defaultLanguageCode,
  //       ),
  //       otherLanguages: product.translations.filter(
  //         (t) => t.languageCode !== defaultLanguageCode,
  //       ),
  //     },
  //     null,
  //     2,
  //   )}`,
  // );

  private async transformProductData(
    product: Product,
    defaultLanguageCode: LanguageCode,
    productSlug?: string | null,
  ) {
    const defaultTranslation = this.translationUtils.getTranslationByLanguage(
      product.translations,
      defaultLanguageCode,
    );

    if (!defaultTranslation) {
      Logger.warn(
        `No translation found for product ${product.id} in language ${defaultLanguageCode}`,
      );
      return undefined;
    }

    // Find all variant stories for this product
    const variantStoryIds = await this.findVariantStoriesForProduct(
      product.id,
      defaultLanguageCode,
      productSlug,
    );

    const slug = this.translationUtils.getSlugByLanguage(
      product.translations,
      defaultLanguageCode,
    );

    const result = {
      story: {
        name: defaultTranslation?.name,
        slug: slug,
        content: {
          component: COMPONENT_TYPE.product,
          vendureId: product.id.toString(),
          variants: variantStoryIds,
        },
      } as any,
      publish: 1,
    };

    return result;
  }

  private async checkContentTypes() {
    //  curl -H "Authorization: QtQtXHU2tFjkk7P1peAblAtt-70271483895739-r3UgJzCHEfz3C9hxJVWD" 'https://mapi.storyblok.com/v1/spaces/286724947198305/components?search=Vendure' | jq
    const response = await this.makeStoryblokRequest({
      method: "GET",
      endpoint: `${this.componentsPath}?search=vendure`,
      skipInitializationCheck: true,
    });

    const checkIfExists = (name: string) => {
      return response.components.findIndex((c: any) => c.name === name) !== -1;
    };

    return {
      product: checkIfExists(COMPONENT_TYPE.product),
      variant: checkIfExists(COMPONENT_TYPE.product_variant),
      collection: checkIfExists(COMPONENT_TYPE.collection),
    };
  }

  private async ensureContentTypesExists() {
    const contentCheck = await this.checkContentTypes();
    const shapeData = (componentType: keyof typeof COMPONENT_TYPE) => {
      const displayNames = {
        product: "Vendure Product",
        product_variant: "Vendure Product Variant",
        collection: "Vendure Collection",
      };

      // Base schema for all component types
      const baseSchema = {
        vendureId: {
          type: "text",
          pos: 0,
          required: true,
        },
      };

      // Add relationship fields based on component type
      let relationshipSchema = {};
      if (componentType === "product") {
        relationshipSchema = {
          variants: {
            type: "options",
            pos: 1,
            source: "internal_stories",
            restrict_content_types: [COMPONENT_TYPE.product_variant],
            display_name: "Product Variants",
          },
        };
      } else if (componentType === "product_variant") {
        relationshipSchema = {
          parentProduct: {
            type: "option",
            pos: 1,
            source: "internal_stories",
            restrict_content_types: [COMPONENT_TYPE.product],
            display_name: "Parent Product",
          },
        };
      }

      return {
        component: {
          name: COMPONENT_TYPE[componentType],
          display_name: displayNames[componentType],
          schema: {
            ...baseSchema,
            ...relationshipSchema,
          },
          is_root: false,
          is_nestable: true,
        },
      };
    };

    const createContentType = async (
      contentType: keyof typeof COMPONENT_TYPE,
    ) => {
      const data = shapeData(contentType);

      Logger.info(`Creating content type ${data.component.name}`);
      const response = await this.makeStoryblokRequest({
        method: "POST",
        endpoint: this.componentsPath,
        data: data,
        skipInitializationCheck: true,
      });

      if (response.component.id) {
        Logger.info(
          `Created ${response.component.name} block with ID ${response.component.id}`,
        );
      }
    };

    if (!contentCheck.product) {
      await createContentType("product");
    }

    if (!contentCheck.variant) {
      await createContentType("product_variant");
    }

    if (!contentCheck.collection) {
      await createContentType("collection");
    }
    Logger.info("initialized");
    this.isInitialized = true;
  }

  private getStoryblokHeaders(): Record<string, string> {
    if (!this.options.cmsApiKey) {
      Logger.error("Storyblok API key is not configured");
    }

    return {
      Authorization: this.options.cmsApiKey as string,
      "Content-Type": "application/json",
    };
  }
  private async makeStoryblokRequest({
    method,
    endpoint,
    data,
    skipInitializationCheck = false,
  }: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    endpoint: string;
    data?: any;
    skipInitializationCheck?: boolean;
  }): Promise<any> {
    const url = `${this.storyblokBaseUrl}/spaces/${this.options.storyblokSpaceId}/${endpoint}`;
    const config: RequestInit = {
      method,
      headers: this.getStoryblokHeaders(),
    };

    if (data && (method === "POST" || method === "PUT")) {
      config.body = JSON.stringify(data);
    }

    // In the case the content types have not yet been initialized this code will wait until it is
    // and includes an exponential back off strategy
    if (!skipInitializationCheck) {
      let attempts = 0;
      const maxAttempts = 100;
      while (!this.isInitialized && attempts < maxAttempts) {
        await new Promise((res) =>
          setTimeout(res, Math.min(10 + 1.03 ** (attempts + 1), 30000)),
        );
        attempts++;
        if (attempts === maxAttempts - 1) {
          Logger.error(
            "Reached max attempts while waiting for Storyblok content types initialization",
          );
        }
      }
    }

    Logger.debug(`Making Storyblok API request: ${method} ${url}`);
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = `Storyblok API error: ${response.status} ${response.statusText} - ${errorText}`;
      Logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    if (method === "DELETE") {
      return {}; // DELETE requests typically don't return content
    }

    return await response.json();
  }
}
