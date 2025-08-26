import gql from 'graphql-tag';

const articleAdminApiExtensions = gql`
  type Article implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    slug: String!
    title: String!
    body: String!
    isPublished: Boolean!
  }

  type ArticleList implements PaginatedList {
    items: [Article!]!
    totalItems: Int!
  }

  # Generated at run-time by Vendure
  input ArticleListOptions

  extend type Query {
    article(id: ID!): Article
    articles(options: ArticleListOptions): ArticleList!
  }

  input CreateArticleInput {
    slug: String!
    title: String!
    body: String!
    isPublished: Boolean!
  }

  input UpdateArticleInput {
    id: ID!
    slug: String
    title: String
    body: String
    isPublished: Boolean
  }

  extend type Mutation {
    createArticle(input: CreateArticleInput!): Article!
    updateArticle(input: UpdateArticleInput!): Article!
    deleteArticle(id: ID!): DeletionResponse!
  }
`;
export const adminApiExtensions = gql`
  ${articleAdminApiExtensions}
`;
