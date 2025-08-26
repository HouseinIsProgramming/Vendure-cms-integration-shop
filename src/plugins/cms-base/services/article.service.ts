import { Injectable, Inject } from '@nestjs/common';
import { DeletionResponse, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { CustomFieldsObject, ID, PaginatedList } from '@vendure/common/lib/shared-types';
import {
    assertFound,
    CustomFieldRelationService,
    HasCustomFields,
    ListQueryBuilder,
    ListQueryOptions,
    RelationPaths,
    RequestContext,
    TransactionalConnection,
    Translatable,
    TranslatableSaver,
    Translated,
    Translation,
    TranslationInput,
    TranslatorService,
    VendureEntity,
    patchEntity,
} from '@vendure/core';
import { Article } from '../entities/article.entity';
import { CMS_BASE_PLUGIN_OPTIONS } from '../constants';
import { PluginInitOptions } from '../types';

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

@Injectable()
export class ArticleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private customFieldRelationService: CustomFieldRelationService, @Inject(CMS_BASE_PLUGIN_OPTIONS) private options: PluginInitOptions
    ) {}

    findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<Article>,
        relations?: RelationPaths<Article>,
    ): Promise<PaginatedList<Article>> {
        return this.listQueryBuilder
            .build(Article, options, {
                relations,
                ctx,
            }
            ).getManyAndCount().then(([items, totalItems]) => {
                return {
                    items,
                    totalItems,
                }
            }
            );
    }

    findOne(
        ctx: RequestContext,
        id: ID,
        relations?: RelationPaths<Article>,
    ): Promise<Article | null> {
        return this.connection
            .getRepository(ctx, Article)
            .findOne({
                where: { id },
                relations,
            });
    }

    async create(ctx: RequestContext, input: CreateArticleInput): Promise<Article> {
        const newEntityInstance = new Article(input);
        const newEntity = await this.connection.getRepository(ctx, Article).save(newEntityInstance);
        await this.customFieldRelationService.updateRelations(ctx, Article, input, newEntity);
        return assertFound(this.findOne(ctx, newEntity.id));
    }

    async update(ctx: RequestContext, input: UpdateArticleInput): Promise<Article> {
        const entity = await this.connection.getEntityOrThrow(ctx, Article, input.id);
        const updatedEntity = patchEntity(entity, input);
        await this.connection.getRepository(ctx, Article).save(updatedEntity, { reload: false });
        await this.customFieldRelationService.updateRelations(ctx, Article, input, updatedEntity);
        return assertFound(this.findOne(ctx, updatedEntity.id));
    }

    async delete(ctx: RequestContext, id: ID): Promise<DeletionResponse> {
        const entity = await this.connection.getEntityOrThrow(ctx, Article, id);
        try {
            await this.connection.getRepository(ctx, Article).remove(entity);
            return {
                result: DeletionResult.DELETED,
            };
        } catch (e: any) {
            return {
                result: DeletionResult.NOT_DELETED,
                message: e.toString(),
            };
        }
    }
}
