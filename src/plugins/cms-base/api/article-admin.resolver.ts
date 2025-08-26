import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { DeletionResponse, Permission } from '@vendure/common/lib/generated-types';
import { CustomFieldsObject } from '@vendure/common/lib/shared-types';
import {
    Allow,
    Ctx,
    PaginatedList,
    RequestContext,
    Transaction,
    Relations,
    VendureEntity,
    ID,
    TranslationInput,
    ListQueryOptions,
    RelationPaths,
} from '@vendure/core';
import { ArticleService } from '../services/article.service';
import { Article } from '../entities/article.entity';

// These can be replaced by generated types if you set up code generation
interface CreateArticleInput {
    slug: string;
    title: string;
    body: string;
    isPublished: boolean;
    // Define the input fields here
    customFields?: CustomFieldsObject;
}
interface UpdateArticleInput {
    id: ID;
    slug?: string;
    title?: string;
    body?: string;
    isPublished?: boolean;
    // Define the input fields here
    customFields?: CustomFieldsObject;
}

@Resolver()
export class ArticleAdminResolver {
    constructor(private articleService: ArticleService) {}

    @Query()
    @Allow(Permission.SuperAdmin)
    async article(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID },
        @Relations(Article) relations: RelationPaths<Article>,
    ): Promise<Article | null> {
        return this.articleService.findOne(ctx, args.id, relations);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async articles(
        @Ctx() ctx: RequestContext,
        @Args() args: { options: ListQueryOptions<Article> },
        @Relations(Article) relations: RelationPaths<Article>,
    ): Promise<PaginatedList<Article>> {
        return this.articleService.findAll(ctx, args.options || undefined, relations);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async createArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateArticleInput },
    ): Promise<Article> {
        return this.articleService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async updateArticle(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateArticleInput },
    ): Promise<Article> {
        return this.articleService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    async deleteArticle(@Ctx() ctx: RequestContext, @Args() args: { id: ID }): Promise<DeletionResponse> {
        return this.articleService.delete(ctx, args.id);
    }
}
