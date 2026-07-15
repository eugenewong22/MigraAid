CREATE INDEX "content_items_status_domain_idx" ON "content_items" USING btree ("status","domain");--> statement-breakpoint
CREATE INDEX "content_items_content_hash_idx" ON "content_items" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "contract_reviews_session_idx" ON "contract_reviews" USING btree ("anon_session_id");--> statement-breakpoint
CREATE INDEX "contract_reviews_created_at_idx" ON "contract_reviews" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("anon_session_id");--> statement-breakpoint
CREATE INDEX "conversations_started_at_idx" ON "conversations" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "feedback_conversation_idx" ON "feedback" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_rating_check" CHECK ("feedback"."rating" between 1 and 5);