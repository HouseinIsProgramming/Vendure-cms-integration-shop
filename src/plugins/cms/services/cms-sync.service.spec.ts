import { Test } from "@nestjs/testing";
import {
  Logger,
  TransactionalConnection,
  Product,
  ProductVariant,
  Collection,
} from "@vendure/core";
import { LanguageCode } from "@vendure/common/lib/generated-types";
import { CmsSyncService } from "./cms-sync.service";
import { SyncJobData } from "../types";
import { vi, MockedFunction } from "vitest";

interface MockRepository {
  findOne: MockedFunction<
    (options: any) => Promise<Product | ProductVariant | Collection | null>
  >;
}

interface MockConnection {
  rawConnection: {
    getRepository: MockedFunction<(entity: any) => MockRepository>;
  };
}

describe("CmsSyncService", () => {
  let service: CmsSyncService;
  let loggerSpy: ReturnType<typeof vi.spyOn>;
  let mockConnection: MockConnection;
  let mockRepository: MockRepository;

  beforeEach(async () => {
    // Create mock repository with findOne method
    mockRepository = {
      findOne: vi.fn(),
    };

    // Create mock connection that returns our mock repository
    mockConnection = {
      rawConnection: {
        getRepository: vi.fn().mockReturnValue(mockRepository),
      },
    };

    // Direct service instantiation with mock connection
    service = new CmsSyncService(
      mockConnection as unknown as TransactionalConnection,
    );

    // Spy on Logger.info method
    loggerSpy = vi.spyOn(Logger, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
    vi.clearAllMocks();
  });

  // Helper function to create mock Product entity
  const createMockProduct = (
    id: string,
    translations: Array<{
      languageCode: LanguageCode;
      name: string;
      slug: string;
      description: string;
    }>,
  ): Product =>
    ({
      id,
      translations,
      // Other required Product properties can be mocked as needed
    }) as Product;

  // Helper function to create mock ProductVariant entity
  const createMockProductVariant = (
    id: string,
    translations: Array<{ languageCode: LanguageCode; name: string }>,
  ): ProductVariant =>
    ({
      id,
      translations,
      // Other required ProductVariant properties can be mocked as needed
    }) as ProductVariant;

  // Helper function to create mock Collection entity
  const createMockCollection = (
    id: string,
    translations: Array<{
      languageCode: LanguageCode;
      name: string;
      slug: string;
      description: string;
    }>,
  ): Collection =>
    ({
      id,
      translations,
      // Other required Collection properties can be mocked as needed
    }) as Collection;

  describe("syncProductToCms", () => {
    it("should successfully sync product and log the operation", async () => {
      // Arrange
      const mockProduct = createMockProduct("1", [
        {
          languageCode: LanguageCode.en,
          name: "Test Product",
          slug: "test-product",
          description: "A test product description",
        },
      ]);

      mockRepository.findOne.mockResolvedValue(mockProduct);

      const mockJobData: SyncJobData = {
        entityType: Product.name,
        entityId: "1",
        operationType: "create",
        timestamp: "2025-08-27T10:53:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncProductToCms(mockJobData);

      // Assert
      expect(result).toEqual({
        success: true,
        message: "Product create synced successfully",
        timestamp: expect.any(Date),
      });

      // Verify repository was called to fetch product
      expect(mockConnection.rawConnection.getRepository).toHaveBeenCalledWith(
        Product,
      );
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: "1" },
        relations: { translations: true },
      });

      // Verify logging was called with correct parameters
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("[CmsPlugin] Product create:"),
      );

      // Verify the logged data contains expected product information
      const loggedMessage = loggerSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('"id": "1"');
      expect(loggedMessage).toContain('"operation": "create"');
      expect(loggedMessage).toContain('"name": "Test Product"');
    });

    it("should handle product not found error", async () => {
      // Arrange
      mockRepository.findOne.mockResolvedValue(null);

      const mockJobData: SyncJobData = {
        entityType: Product.name,
        entityId: "-999",
        operationType: "update",
        timestamp: "2025-08-27T10:53:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncProductToCms(mockJobData);

      // Assert
      expect(result).toEqual({
        success: false,
        message: "Product sync failed: Product with ID -999 not found",
      });
    });

    it("should handle different operation types correctly", async () => {
      // Arrange
      const mockProduct = createMockProduct("2", [
        {
          languageCode: LanguageCode.en,
          name: "Updated Product",
          slug: "updated-product",
          description: "Updated description",
        },
      ]);

      mockRepository.findOne.mockResolvedValue(mockProduct);

      const mockJobData: SyncJobData = {
        entityType: Product.name,
        entityId: "2",
        operationType: "update",
        timestamp: "2025-08-27T10:53:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncProductToCms(mockJobData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe("Product update synced successfully");

      // Verify correct operation type was logged
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("[CmsPlugin] Product update:"),
      );
    });

    it("should include translation data in sync payload", async () => {
      // Arrange
      const mockProduct = createMockProduct("3", [
        {
          languageCode: LanguageCode.en,
          name: "Multilingual Product",
          slug: "multilingual-product",
          description: "English description",
        },
        {
          languageCode: LanguageCode.es,
          name: "Producto Multilingüe",
          slug: "producto-multilingue",
          description: "Descripción en español",
        },
      ]);

      mockRepository.findOne.mockResolvedValue(mockProduct);

      const mockJobData: SyncJobData = {
        entityType: Product.name,
        entityId: "3",
        operationType: "update",
        timestamp: "2025-08-27T10:53:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncProductToCms(mockJobData);

      // Assert
      expect(result.success).toBe(true);

      // Verify translations are included in logged data
      const loggedMessage = loggerSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('"languageCode": "en"');
      expect(loggedMessage).toContain('"languageCode": "es"');
      expect(loggedMessage).toContain("Producto Multilingüe");
    });
  });

  describe("syncVariantToCms", () => {
    it("should successfully sync product variant and log the operation", async () => {
      // Arrange
      const mockVariant = createMockProductVariant("10", [
        {
          languageCode: LanguageCode.en,
          name: "Test Variant - Red Large",
        },
      ]);

      mockRepository.findOne.mockResolvedValue(mockVariant);

      const mockJobData: SyncJobData = {
        entityType: ProductVariant.name,
        entityId: "10",
        operationType: "create",
        timestamp: "2025-08-27T11:00:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncVariantToCms(mockJobData);

      // Assert
      expect(result).toEqual({
        success: true,
        message: "Variant create synced successfully",
        timestamp: expect.any(Date),
      });

      // Verify repository was called to fetch variant
      expect(mockConnection.rawConnection.getRepository).toHaveBeenCalledWith(
        ProductVariant,
      );
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: "10" },
        relations: ["translations"],
      });

      // Verify logging was called with correct parameters
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("[CmsPlugin] Variant create:"),
      );

      // Verify the logged data contains expected variant information
      const loggedMessage = loggerSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('"id": "10"');
      expect(loggedMessage).toContain('"operation": "create"');
      expect(loggedMessage).toContain('"name": "Test Variant - Red Large"');
    });

    it("should handle variant not found error", async () => {
      // Arrange
      mockRepository.findOne.mockResolvedValue(null);

      const mockJobData: SyncJobData = {
        entityType: ProductVariant.name,
        entityId: "999",
        operationType: "update",
        timestamp: "2025-08-27T11:00:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncVariantToCms(mockJobData);

      // Assert
      expect(result).toEqual({
        success: false,
        message: "Variant sync failed: ProductVariant with ID 999 not found",
      });
    });
  });

  describe("syncCollectionToCms", () => {
    it("should successfully sync collection and log the operation", async () => {
      // Arrange
      const mockCollection = createMockCollection("20", [
        {
          languageCode: LanguageCode.en,
          name: "Electronics Collection",
          slug: "electronics-collection",
          description: "All electronic products",
        },
      ]);

      mockRepository.findOne.mockResolvedValue(mockCollection);

      const mockJobData: SyncJobData = {
        entityType: Collection.name,
        entityId: "20",
        operationType: "create",
        timestamp: "2025-08-27T11:00:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncCollectionToCms(mockJobData);

      // Assert
      expect(result).toEqual({
        success: true,
        message: "Collection create synced successfully",
        timestamp: expect.any(Date),
      });

      // Verify repository was called to fetch collection
      expect(mockConnection.rawConnection.getRepository).toHaveBeenCalledWith(
        Collection,
      );
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: "20" },
        relations: ["translations"],
      });

      // Verify logging was called with correct parameters
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining("[CmsPlugin] Collection create:"),
      );

      // Verify the logged data contains expected collection information
      const loggedMessage = loggerSpy.mock.calls[0][0];
      expect(loggedMessage).toContain('"id": "20"');
      expect(loggedMessage).toContain('"operation": "create"');
      expect(loggedMessage).toContain('"name": "Electronics Collection"');
    });

    it("should handle collection not found error", async () => {
      // Arrange
      mockRepository.findOne.mockResolvedValue(null);

      const mockJobData: SyncJobData = {
        entityType: Collection.name,
        entityId: "999",
        operationType: "delete",
        timestamp: "2025-08-27T11:00:00.000Z",
        retryCount: 0,
      };

      // Act
      const result = await service.syncCollectionToCms(mockJobData);

      // Assert
      expect(result).toEqual({
        success: false,
        message: "Collection sync failed: Collection with ID 999 not found",
      });
    });

    it("should include multilingual collection data in sync payload", async () => {
      // Arrange
      const mockCollection = createMockCollection("22", [
        {
          languageCode: LanguageCode.en,
          name: "Fashion Collection",
          slug: "fashion-collection",
          description: "Fashion and clothing items",
        },
        {
          languageCode: LanguageCode.es,
          name: "Colección de Moda",
          slug: "coleccion-de-moda",
          description: "Artículos de moda y ropa",
        },
        {
          languageCode: LanguageCode.fr,
          name: "Collection Mode",
          slug: "collection-mode",
          description: "Articles de mode et vêtements",
        },
      ]);

      mockRepository.findOne.mockResolvedValue(mockCollection);

      const mockJobData: SyncJobData = {
        entityType: Collection.name,
        entityId: "22",
        operationType: "update",
        timestamp: "2025-08-27T11:00:00.000Z",
        retryCount: 0,
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
      expect(loggedMessage).toContain("Colección de Moda");
      expect(loggedMessage).toContain("Collection Mode");
    });
  });
});
