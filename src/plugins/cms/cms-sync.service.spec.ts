import { Test } from '@nestjs/testing';
import { Logger } from '@vendure/core';
import { CmsSyncService } from './cms-sync.service';
import { SyncJobData } from './types';

describe('CmsSyncService', () => {
    let service: CmsSyncService;
    let loggerSpy: jest.SpyInstance;

    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [CmsSyncService],
        }).compile();

        service = module.get<CmsSyncService>(CmsSyncService);
        
        // Spy on Logger.info method
        loggerSpy = jest.spyOn(Logger, 'info').mockImplementation();
    });

    afterEach(() => {
        loggerSpy.mockRestore();
    });

    describe('syncProductToCms', () => {
        it('should successfully sync product and log the operation', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'product',
                entityId: '1',
                operationType: 'create',
                vendureData: {
                    id: '1',
                    title: 'Test Product',
                    slug: 'test-product',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Test Product',
                            slug: 'test-product'
                        }
                    ]
                },
                timestamp: '2025-08-27T10:53:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncProductToCms(mockJobData);

            // Assert
            expect(result).toEqual({
                success: true,
                message: 'Product create synced successfully',
                timestamp: expect.any(Date)
            });

            // Verify logging was called with correct parameters
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[CmsPlugin] Product create:')
            );
            
            // Verify the logged data contains expected product information
            const loggedMessage = loggerSpy.mock.calls[0][0];
            expect(loggedMessage).toContain('"id": "1"');
            expect(loggedMessage).toContain('"title": "Test Product"');
            expect(loggedMessage).toContain('"operation": "create"');
        });

        it('should handle different operation types correctly', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'product',
                entityId: '2',
                operationType: 'update',
                vendureData: {
                    id: '2',
                    title: 'Updated Product',
                    slug: 'updated-product',
                    translations: []
                },
                timestamp: '2025-08-27T10:53:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncProductToCms(mockJobData);

            // Assert
            expect(result.success).toBe(true);
            expect(result.message).toBe('Product update synced successfully');
            
            // Verify correct operation type was logged
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[CmsPlugin] Product update:')
            );
        });

        it('should include translation data in sync payload', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'product',
                entityId: '3',
                operationType: 'update',
                vendureData: {
                    id: '3',
                    title: 'Multilingual Product',
                    slug: 'multilingual-product',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Multilingual Product',
                            slug: 'multilingual-product'
                        },
                        {
                            languageCode: 'es',
                            name: 'Producto Multilingüe',
                            slug: 'producto-multilingue'
                        }
                    ]
                },
                timestamp: '2025-08-27T10:53:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncProductToCms(mockJobData);

            // Assert
            expect(result.success).toBe(true);
            
            // Verify translations are included in logged data
            const loggedMessage = loggerSpy.mock.calls[0][0];
            expect(loggedMessage).toContain('"languageCode": "en"');
            expect(loggedMessage).toContain('"languageCode": "es"');
            expect(loggedMessage).toContain('Producto Multilingüe');
        });
    });
});