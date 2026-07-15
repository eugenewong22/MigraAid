ALTER TABLE "content_chunks" ADD COLUMN "embedding_generation" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "source_key" text;--> statement-breakpoint
CREATE INDEX "content_chunks_generation_idx" ON "content_chunks" USING btree ("embedding_generation");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_source_key_uidx" ON "content_items" USING btree ("source_key");