import { Args, Mutation, Query, Resolver } from "@nestjs/graphql";
import { Permission } from "@vendure/common/lib/generated-types";
import { ID } from "@vendure/common/lib/shared-types";
import { Allow, Ctx, RequestContext } from "@vendure/core";
import { CmsSyncService } from "../services/cms-sync.service";

@Resolver()
export class CmsSyncAdminResolver {
  constructor(private cmsSyncService: CmsSyncService) {}

  @Mutation()
  @Allow(Permission.SuperAdmin)
  async syncProductToCms(
    @Ctx() ctx: RequestContext,
    @Args() args: { id: ID },
  ): Promise<{
    success: boolean;
    message: string;
    entityId: string;
  }> {
    try {
      const result = await this.cmsSyncService.syncProductToCms({
        entityType: "Product",
        entityId: args.id,
        operationType: "update",
        timestamp: new Date().toISOString(),
        retryCount: 0,
      });

      return {
        success: result.success,
        message: result.message,
        entityId: args.id.toString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to sync product: ${errorMessage}`,
        entityId: args.id.toString(),
      };
    }
  }

  @Mutation()
  @Allow(Permission.SuperAdmin)
  async syncAllProductsToCms(@Ctx() ctx: RequestContext): Promise<{
    success: boolean;
    totalProducts: number;
    successCount: number;
    errorCount: number;
    message: string;
    errors: Array<{
      productId: string;
      error: string;
      attempts: number;
    }>;
  }> {
    try {
      const result = await this.cmsSyncService.syncAllProductsToCms();
      
      return {
        success: result.success,
        totalProducts: result.totalProducts,
        successCount: result.successCount,
        errorCount: result.errorCount,
        message: result.success 
          ? `Successfully synced ${result.successCount}/${result.totalProducts} products`
          : `Synced ${result.successCount}/${result.totalProducts} products, ${result.errorCount} failed permanently`,
        errors: result.errors.map(e => ({
          productId: e.productId.toString(),
          error: e.error,
          attempts: e.attempts,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        totalProducts: 0,
        successCount: 0,
        errorCount: 1,
        message: `Bulk sync failed: ${errorMessage}`,
        errors: [],
      };
    }
  }

  @Query()
  @Allow(Permission.SuperAdmin)
  async getCmsSyncStatus(@Ctx() ctx: RequestContext): Promise<string> {
    return "CMS Sync service is ready";
  }
}
