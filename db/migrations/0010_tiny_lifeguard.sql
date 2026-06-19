ALTER TABLE "products" DROP CONSTRAINT "products_base_id_product_bases_id_fk";
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "base_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_base_id_product_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."product_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "sizes";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "features";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "colors";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "image_url";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "gallery_url";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "product_url";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "brand";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "base_data";