import gql from "graphql-tag";

const cmsSyncAdminApiExtensions = gql`
  type CmsSyncResult {
    success: Boolean!
    message: String!
    entityId: String
  }

  type CmsSyncError {
    productId: String!
    error: String!
    attempts: Int!
  }

  type BulkCmsSyncResult {
    success: Boolean!
    totalProducts: Int!
    successCount: Int!
    errorCount: Int!
    message: String!
    errors: [CmsSyncError!]!
  }

  extend type Query {
    getCmsSyncStatus: String!
  }

  extend type Mutation {
    syncProductToCms(id: ID!): CmsSyncResult!
    syncAllProductsToCms: BulkCmsSyncResult!
  }
`;

export const adminApiExtensions = gql`
  ${cmsSyncAdminApiExtensions}
`;
