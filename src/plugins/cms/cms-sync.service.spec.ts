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
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Test Product',
                            slug: 'test-product',
                            description: 'A test product description'
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
            expect(loggedMessage).toContain('"operation": "create"');
            expect(loggedMessage).toContain('"name": "Test Product"');
        });

        it('should handle different operation types correctly', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'product',
                entityId: '2',
                operationType: 'update',
                vendureData: {
                    id: '2',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Updated Product',
                            slug: 'updated-product',
                            description: 'Updated description'
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
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Multilingual Product',
                            slug: 'multilingual-product',
                            description: 'English description'
                        },
                        {
                            languageCode: 'es',
                            name: 'Producto Multilingüe',
                            slug: 'producto-multilingue',
                            description: 'Descripción en español'
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

    describe('syncVariantToCms', () => {
        it('should successfully sync product variant and log the operation', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'variant',
                entityId: '10',
                operationType: 'create',
                vendureData: {
                    id: '10',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Test Variant - Red Large'
                        }
                    ]
                },
                timestamp: '2025-08-27T11:00:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncVariantToCms(mockJobData);

            // Assert
            expect(result).toEqual({
                success: true,
                message: 'Variant create synced successfully',
                timestamp: expect.any(Date)
            });

            // Verify logging was called with correct parameters
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[CmsPlugin] Variant create:')
            );
            
            // Verify the logged data contains expected variant information
            const loggedMessage = loggerSpy.mock.calls[0][0];
            expect(loggedMessage).toContain('"id": "10"');
            expect(loggedMessage).toContain('"operation": "create"');
            expect(loggedMessage).toContain('"name": "Test Variant - Red Large"');
        });

        it('should handle variant update operations correctly', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'variant',
                entityId: '11',
                operationType: 'update',
                vendureData: {
                    id: '11',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Updated Variant - Blue Medium'
                        },
                        {
                            languageCode: 'es',
                            name: 'Variante Actualizada - Azul Mediano'
                        }
                    ]
                },
                timestamp: '2025-08-27T11:00:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncVariantToCms(mockJobData);

            // Assert
            expect(result.success).toBe(true);
            expect(result.message).toBe('Variant update synced successfully');
            
            // Verify correct operation type was logged
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[CmsPlugin] Variant update:')
            );
            
            // Verify translations are included
            const loggedMessage = loggerSpy.mock.calls[0][0];
            expect(loggedMessage).toContain('"languageCode": "es"');
            expect(loggedMessage).toContain('Variante Actualizada');
        });
    });

    describe('syncCollectionToCms', () => {
        it('should successfully sync collection and log the operation', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'collection',
                entityId: '20',
                operationType: 'create',
                vendureData: {
                    id: '20',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Electronics Collection',
                            slug: 'electronics-collection',
                            description: 'All electronic products'
                        }
                    ]
                },
                timestamp: '2025-08-27T11:00:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncCollectionToCms(mockJobData);

            // Assert
            expect(result).toEqual({
                success: true,
                message: 'Collection create synced successfully',
                timestamp: expect.any(Date)
            });

            // Verify logging was called with correct parameters
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[CmsPlugin] Collection create:')
            );
            
            // Verify the logged data contains expected collection information
            const loggedMessage = loggerSpy.mock.calls[0][0];
            expect(loggedMessage).toContain('"id": "20"');
            expect(loggedMessage).toContain('"operation": "create"');
            expect(loggedMessage).toContain('"name": "Electronics Collection"');
        });

        it('should handle collection delete operations correctly', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'collection',
                entityId: '21',
                operationType: 'delete',
                vendureData: {
                    id: '21',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Deprecated Collection',
                            slug: 'deprecated-collection',
                            description: 'This collection is deprecated'
                        }
                    ]
                },
                timestamp: '2025-08-27T11:00:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncCollectionToCms(mockJobData);

            // Assert
            expect(result.success).toBe(true);
            expect(result.message).toBe('Collection delete synced successfully');
            
            // Verify correct operation type was logged
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.stringContaining('[CmsPlugin] Collection delete:')
            );
        });

        it('should include multilingual collection data in sync payload', async () => {
            // Arrange
            const mockJobData: SyncJobData = {
                entityType: 'collection',
                entityId: '22',
                operationType: 'update',
                vendureData: {
                    id: '22',
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Fashion Collection',
                            slug: 'fashion-collection',
                            description: 'Fashion and clothing items'
                        },
                        {
                            languageCode: 'es',
                            name: 'Colección de Moda',
                            slug: 'coleccion-de-moda',
                            description: 'Artículos de moda y ropa'
                        },
                        {
                            languageCode: 'fr',
                            name: 'Collection Mode',
                            slug: 'collection-mode',
                            description: 'Articles de mode et vêtements'
                        }
                    ]
                },
                timestamp: '2025-08-27T11:00:00.000Z',
                retryCount: 0
            };

            // Act
            const result = await service.syncCollectionToCms(mockJobData);

            // Assert
            expect(result.success).toBe(true);
            
            // Verify translations are included in logged data
            const loggedMessage = loggerSpy.mock.calls[0][0];
            expect(loggedMessage).toContain('"languageCode": "en"');
            expect(loggedMessage).toContain('"languageCode": "es"');
            expect(loggedMessage).toContain('"languageCode": "fr"');
            expect(loggedMessage).toContain('Colección de Moda');
            expect(loggedMessage).toContain('Collection Mode');
        });
    });
});