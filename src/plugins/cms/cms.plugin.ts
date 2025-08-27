import {
  EventBus,
  PluginCommonModule,
  ProductEvent,
  Type,
  VendurePlugin,
} from "@vendure/core";
import {
  UpdateProductInput,
  ProductTranslationInput,
} from "@vendure/common/lib/generated-types";
import { OnModuleInit } from "@nestjs/common";
import { Logger } from "@vendure/core";
import { inspect } from "util";

import { CMS_PLUGIN_OPTIONS } from "./constants";
import { PluginInitOptions } from "./types";

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [
    { provide: CMS_PLUGIN_OPTIONS, useFactory: () => CmsPlugin.options },
    Logger,
  ],
  configuration: (config) => {
    // Plugin-specific configuration
    // such as custom fields, custom permissions,
    // strategies etc. can be configured here by
    // modifying the `config` object.
    return config;
  },
  compatibility: "^3.0.0",
})
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
