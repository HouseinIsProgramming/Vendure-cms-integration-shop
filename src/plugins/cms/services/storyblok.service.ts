import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  LanguageCode,
  Product,
  TransactionalConnection,
  ProcessContext,
  Logger,
} from "@vendure/core";
import { CMS_PLUGIN_OPTIONS } from "../constants";
import { OperationType, PluginInitOptions } from "../types";
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

  constructor(
    private connection: TransactionalConnection,
    private processContext: ProcessContext,
    @Inject(CMS_PLUGIN_OPTIONS) private options: PluginInitOptions,
  ) {}

  async onApplicationBootstrap() {
    if (this.processContext.isWorker) {
      const toLog = await this.ensureContentTypesExists();
      console.log(toLog);
    }
  }

  async syncProduct({
    product,
    defaultLanguageCode,
    operationType,
  }: {
    product: Product;
    defaultLanguageCode: LanguageCode;
    operationType: OperationType;
  }) {
    switch (operationType) {
      case "create":
        const result = await this.makeStoryblokRequest({
          method: "POST",
          endpoint: "stories",
          data: this.transformProductData(product, defaultLanguageCode),
        });
        console.log(result);
        break;
      case "update":
        await this.makeStoryblokRequest({
          method: "PUT",
          endpoint: `stories/${product.id}`,
          data: this.transformProductData(product, defaultLanguageCode),
        });
        break;
      case "delete":
        await this.makeStoryblokRequest({
          method: "DELETE",
          endpoint: `stories/${product.id}`,
        });
        break;
    }
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

  private transformProductData(
    product: Product,
    defaultLanguageCode: LanguageCode,
  ) {
    const defaultTranslation = product.translations.find(
      (t) => t.languageCode === defaultLanguageCode,
    );

    if (!defaultTranslation) {
      return undefined;
    }

    const result = {
      story: {
        name: defaultTranslation?.name,
        slug: defaultTranslation?.slug,
        content: {
          component: "Product",
          body: [],
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
      return {
        component: {
          name: COMPONENT_TYPE[componentType],
          display_name: displayNames[componentType],
          schema: {
            vendureId: {
              type: "text",
              pos: 0,
              required: true,
            },
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
          setTimeout(res, Math.min(10, Math.min(1.1 ** (attempts + 1), 30000))),
        );
        attempts++;
        if (attempts === maxAttempts - 1) {
          Logger.error(
            "Reached max attempts while waitin for Storyblok content types initialization",
          );
        }
      }
    }

    console.log(
      "\n request made: " + url + "\n and the config: " + config.body,
    );
    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text();
      Logger.error(
        `Storyblok API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
      Logger.error(
        `Storyblok API error: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    if (method === "DELETE") {
      return {}; // DELETE requests typically don't return content
    }

    return await response.json();
  }
}
