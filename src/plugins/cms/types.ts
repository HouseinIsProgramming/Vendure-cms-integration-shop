/**
 * @description
 * The plugin can be configured using the following options:
 */
export interface PluginInitOptions {
    cmsApiUrl?: string;
    cmsApiKey?: string;
    retryAttempts?: number;
    retryDelay?: number;
    enableScheduledSync?: boolean;
    scheduledSyncCron?: string;
}

/**
 * @description
 * Job data structure for CMS sync operations
 */
export interface SyncJobData {
    entityType: 'product' | 'variant' | 'collection';
    entityId: string;
    operationType: 'create' | 'update' | 'delete';
    vendureData: {
        id: string;
        title: string;
        slug: string;
        translations?: Array<{
            languageCode: string;
            name: string;
            slug: string;
        }>;
    };
    timestamp: string;
    retryCount: number;
}

/**
 * @description
 * Response type for manual sync operations
 */
export interface SyncResponse {
    success: boolean;
    message: string;
    timestamp?: Date;
}
