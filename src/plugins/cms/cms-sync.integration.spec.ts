import {
  Logger,
  TransactionalConnection,
  Product,
  ProductVariant,
  Collection,
} from "@vendure/core";
import { CmsSyncService } from "./cms-sync.service";
import { SyncJobData } from "./types";
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

describe("CmsSyncService Integration Tests", () => {
  let service: CmsSyncService;
  let mockConnection: MockConnection;
  let mockRepository: MockRepository;
  let loggerSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    // Create a more sophisticated mock that could interact with real data if available
    mockRepository = {
      findOne: vi.fn(),
    };

    mockConnection = {
      rawConnection: {
        getRepository: vi.fn().mockReturnValue(mockRepository),
      },
    };

    // Direct service instantiation with mock connection
    service = new CmsSyncService(mockConnection as unknown as TransactionalConnection);
    loggerSpy = vi.spyOn(Logger, "info").mockImplementation(() => {});
  });

  afterAll(async () => {
    if (loggerSpy) {
      loggerSpy.mockRestore();
    }
  });

  afterEach(() => {
    if (loggerSpy) {
      loggerSpy.mockClear();
    }
    vi.clearAllMocks();
  });

  it("should demonstrate real-world entity structure with realistic data", async () => {
    // Arrange - Create data that mimics what would come from your real database
    // This simulates the structure you'd get from the actual SQLite database
    const realisticProduct = {
      id: "1",
      translations: [
        {
          id: "1",
          languageCode: "en",
          name: "Laptop Computer",
          slug: "laptop-computer",
          description: "High performance laptop for professional use",
        },
        {
          id: "2",
          languageCode: "es",
          name: "Computadora Portátil",
          slug: "computadora-portatil",
          description: "Laptop de alto rendimiento para uso profesional",
        },
      ],
      // Other properties that would exist in real Product entity
      createdAt: "2025-08-27T10:00:00.000Z",
      updatedAt: "2025-08-27T10:00:00.000Z",
    };

    // Mock the database response to return our realistic data
    mockRepository.findOne.mockResolvedValue(realisticProduct as any);

    const jobData: SyncJobData = {
      entityType: Product.name,
      entityId: "1",
      operationType: "update",
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    // Act
    const result = await service.syncProductToCms(jobData);

    // Assert
    expect(result.success).toBe(true);
    expect(result.message).toBe("Product update synced successfully");

    // Verify the service fetched data with proper query structure
    expect(mockConnection.rawConnection.getRepository).toHaveBeenCalledWith(
      Product,
    );
    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { id: "1" },
      relations: { translations: true },
    });

    // Verify realistic multilingual data was logged
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining("[CmsPlugin] Product update:"),
    );

    const loggedMessage = loggerSpy.mock.calls[0][0];
    expect(loggedMessage).toContain('"id": "1"');
    expect(loggedMessage).toContain('"operation": "update"');
    expect(loggedMessage).toContain("Laptop Computer");
    expect(loggedMessage).toContain("Computadora Portátil");
    expect(loggedMessage).toContain('"languageCode": "en"');
    expect(loggedMessage).toContain('"languageCode": "es"');
  });

  it("should demonstrate real-world collection structure with realistic data", async () => {
    // Arrange - Simulate a collection that might exist in your database
    const realisticCollection = {
      id: "2",
      translations: [
        {
          id: "10",
          languageCode: "en",
          name: "Electronics",
          slug: "electronics",
          description: "Electronic devices and accessories",
        },
        {
          id: "11",
          languageCode: "fr",
          name: "Électronique",
          slug: "electronique",
          description: "Appareils électroniques et accessoires",
        },
      ],
      isRoot: false,
      position: 1,
    };

    mockRepository.findOne.mockResolvedValue(realisticCollection as any);

    const jobData: SyncJobData = {
      entityType: Collection.name,
      entityId: "2",
      operationType: "create",
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    // Act
    const result = await service.syncCollectionToCms(jobData);

    // Assert
    expect(result.success).toBe(true);
    expect(result.message).toBe("Collection create synced successfully");

    const loggedMessage = loggerSpy.mock.calls[0][0];
    expect(loggedMessage).toContain('"id": "2"');
    expect(loggedMessage).toContain("Electronics");
    expect(loggedMessage).toContain("Électronique");
    expect(loggedMessage).toContain("electronique"); // French slug
  });

  it("should demonstrate real-world variant structure", async () => {
    // Arrange - ProductVariants have different structure (no slug/description in translations)
    const realisticVariant = {
      id: "5",
      sku: "LAPTOP-001-16GB",
      translations: [
        {
          id: "20",
          languageCode: "en",
          name: "Laptop 16GB RAM",
        },
        {
          id: "21",
          languageCode: "de",
          name: "Laptop 16GB Arbeitsspeicher",
        },
      ],
      price: 129900, // Price in cents
      enabled: true,
    };

    mockRepository.findOne.mockResolvedValue(realisticVariant as any);

    const jobData: SyncJobData = {
      entityType: ProductVariant.name,
      entityId: "5",
      operationType: "update",
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    // Act
    const result = await service.syncVariantToCms(jobData);

    // Assert
    expect(result.success).toBe(true);
    expect(result.message).toBe("Variant update synced successfully");

    const loggedMessage = loggerSpy.mock.calls[0][0];
    expect(loggedMessage).toContain('"id": "5"');
    expect(loggedMessage).toContain("Laptop 16GB RAM");
    expect(loggedMessage).toContain("Arbeitsspeicher"); // German translation

    // Verify variant translations don't include slug/description (unlike Products/Collections)
    expect(loggedMessage).not.toContain('"slug"');
    expect(loggedMessage).not.toContain('"description"');
  });

  it("should handle database connection patterns correctly", async () => {
    // This test verifies the database interaction patterns are correct
    const jobData: SyncJobData = {
      entityType: Product.name,
      entityId: "123",
      operationType: "create",
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    mockRepository.findOne.mockResolvedValue(null); // Simulate entity not found

    // Act
    const result = await service.syncProductToCms(jobData);

    // Assert
    expect(result.success).toBe(false);
    expect(result.message).toContain("Product with ID 123 not found");

    // Verify correct database query pattern
    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { id: "123" },
      relations: { translations: true },
    });
  });
});
