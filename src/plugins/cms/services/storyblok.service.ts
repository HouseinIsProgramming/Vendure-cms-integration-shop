import { Inject, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import {
  ID,
  LanguageCode,
  Product,
  RequestContext,
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
  private readonly componentsPath = "/components/";
  private isInitialized = false;

  constructor(
    private connection: TransactionalConnection,
    private processContext: ProcessContext,
    @Inject(CMS_PLUGIN_OPTIONS) private options: PluginInitOptions,
  ) {}

  async onApplicationBootstrap() {
    if (this.processContext.isServer) {
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
      // this.makeStoryblokRequest("POST", "stories", --)
      case "update":
      case "delete":
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
    const otherTranslations = product.translations.filter(
      (t) => t.languageCode !== defaultLanguageCode,
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

    // if (otherTranslations.length > 1) {
    //   for (translation in otherTranslations){
    //     result.story.
    //   }
    // }
    return result;
  }

  private async checkContentTypes() {
    //  curl -H "Authorization: QtQtXHU2tFjkk7P1peAblAtt-70271483895739-r3UgJzCHEfz3C9hxJVWD" 'https://mapi.storyblok.com/v1/spaces/286724947198305/components?search=Vendure' | jq
    const response = await this.makeStoryblokRequest(
      "GET",
      `${this.componentsPath}?search=vendure`,
    );

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
      const response = await this.makeStoryblokRequest(
        "POST",
        this.componentsPath,
        data,
      );

      if (response.component.id) {
        Logger.info(
          `Created ${response.component.name} block with ID ${response.component.id}`,
        );
      }
    };

    if (!contentCheck.product) {
      await createContentType("product");
    }

    if (!contentCheck.collection) {
      await createContentType("product_variant");
    }

    if (!contentCheck.collection) {
      await createContentType("collection");
    }

    this.isInitialized = true;
  }

  private getContentType() {
    // {
    // "name": "vendure-product",
    // "display_name": "Vendure Product",
    // "description": "product content type",
    // "created_at": "2025-08-28T07:55:20.183Z",
    // "updated_at": "2025-08-28T13:48:24.659Z",
    // "id": 84697580274737,
    // "schema": {
    //   "vendureId": {
    //     "type": "text",
    //     "pos": 0,
    //     "required": true,
    //     "id": "Wak4AX95TL-jRUzjNXEtSA"
    //   }
    // },
  }

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

    let attempts = 0;
    const maxAttempts = 100;
    while (!this.isInitialized && attempts < maxAttempts) {
      await new Promise((res) =>
        setTimeout(res, Math.min(10, Math.min(1.05 ** (attempts + 1), 30000))),
      );
      attempts++;
      if (attempts === maxAttempts - 1) {
        Logger.error(
          "Reached max attempts while waitin for Storyblok content types initialization",
        );
      }
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const errorText = await response.text();
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
