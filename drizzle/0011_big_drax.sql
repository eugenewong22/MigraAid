ALTER TABLE "content_items" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "source_excerpt" text;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "source_retrieved_at" date;--> statement-breakpoint
CREATE INDEX "content_items_source_id_idx" ON "content_items" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_excerpt_requires_source" CHECK ("content_items"."source_excerpt" is null or "content_items"."source_id" is not null);