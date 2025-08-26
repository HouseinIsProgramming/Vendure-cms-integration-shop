import { DeepPartial, HasCustomFields, VendureEntity } from "@vendure/core";
import { Column, Entity } from "typeorm";

export class ArticleCustomFields {}

@Entity()
export class Article extends VendureEntity implements HasCustomFields {
  constructor(input?: DeepPartial<Article>) {
    super(input);
  }

  @Column()
  slug: string;

  @Column()
  title: string;

  @Column("text")
  body: string;

  @Column()
  isPublished: boolean;

  @Column((type) => ArticleCustomFields)
  customFields: ArticleCustomFields;
}
