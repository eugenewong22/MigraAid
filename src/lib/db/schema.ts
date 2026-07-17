/**
 * MigraAid database schema (Postgres + pgvector) — Drizzle ORM.
 *
 * Design notes:
 * - Worker-facing data is anonymous: conversations key off an opaque session id
 *   (a cookie), never a worker account. No names, no contact details.
 * - Contract reviews store the *derived analysis only* — never the uploaded image
 *   or its raw text (privacy-max; see lib/contract).
 * - content_chunks holds the RAG vector index; embeddings are regenerated whenever
 *   a content_item is (re)published (see lib/content).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  date,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS } from "@/lib/embeddings";

// ── Enums ────────────────────────────────────────────────────────────────────

/** The five guidance domains MigraAid covers. */
export const domainEnum = pgEnum("domain", [
  "legal_rights",
  "healthcare",
  "housing",
  "financial",
  "settlement",
]);

/** Content lifecycle: only `published` items are indexed for retrieval. */
export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "review",
  "published",
  "archived",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

// ── Knowledge base ─────────────────────────────────────────────────────────────

/** A human-verified unit of guidance (a law summary, an FAQ, an NGO resource). */
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    domain: domainEnum("domain").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    /** Human-readable citation target, e.g. "Employment Act 1968, s.21". */
    sourceRef: text("source_ref").notNull(),
    /** Canonical, reviewer-verified HTTPS source shown alongside the label. */
    sourceUrl: text("source_url"),
    /** Canonical language of the source material (the corpus is authored in English). */
    lang: text("lang").notNull().default("en"),
    status: contentStatusEnum("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    /** Content hash so re-ingestion is idempotent. */
    contentHash: text("content_hash").notNull(),
    /** Stable repository-relative identity for content managed by the seed ingester. */
    sourceKey: text("source_key"),
    /** Immutable provider user id of the person who last changed this version. */
    lastEditedBy: text("last_edited_by"),
    /** Exact author/version submitted for independent review. */
    submittedBy: text("submitted_by"),
    submittedVersion: integer("submitted_version"),
    /** Last reviewer decision, retained when changes are requested. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("content_items_status_domain_idx").on(table.status, table.domain),
    index("content_items_content_hash_idx").on(table.contentHash),
    uniqueIndex("content_items_source_key_uidx").on(table.sourceKey),
  ],
).enableRLS();

/** A chunk of a content item plus its embedding — the retrieval unit for RAG. */
export const contentChunks = pgTable(
  "content_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    /** Provider + model + dimensions; vectors from different spaces never mix. */
    embeddingGeneration: text("embedding_generation").notNull().default("legacy"),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // HNSW cosine index for approximate nearest-neighbour search.
    index("content_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("content_chunks_generation_idx").on(table.embeddingGeneration),
  ],
).enableRLS();

// ── Conversations & logging (anonymous) ────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Opaque, non-PII session identifier (cookie). */
    anonSessionId: text("anon_session_id").notNull(),
    lang: text("lang").notNull().default("en"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    /** Retention follows recent activity, not the date the chat was first opened. */
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("conversations_session_idx").on(table.anonSessionId),
    index("conversations_started_at_idx").on(table.startedAt),
    index("conversations_last_activity_idx").on(table.lastActivityAt),
  ],
).enableRLS();

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  text: text("text").notNull(),
  /** Span-level source attributions for assistant answers (see lib/rag). */
  citations: jsonb("citations").$type<
    Array<{
      sourceRef: string;
      sourceUrl?: string;
      contentItemId: string;
      quote?: string;
    }>
  >(),
  model: text("model"),
  tokens: integer("tokens"),
  /** True when the answer escalated/referred to a human instead of advising. */
  escalated: boolean("escalated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
]).enableRLS();

// ── Referrals, feedback, contract reviews ──────────────────────────────────────

export const referrals = pgTable("referrals", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  issueType: text("issue_type").notNull(),
  org: text("org").notNull(),
  outcome: text("outcome"),
  /** Only this one-way digest is stored; the worker receives the raw code once. */
  handoffCodeHash: text("handoff_code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Set true when a partner NGO confirms the referral landed (KPI: 30+). */
  confirmedByNgo: boolean("confirmed_by_ngo").notNull().default(false),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: text("confirmed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("referrals_handoff_code_hash_uidx").on(table.handoffCodeHash),
  // DB-enforced "one active referral per conversation": the route's
  // check-then-insert cannot exclude a concurrent turn minting a second code.
  // Expiry cannot appear in an index predicate (non-immutable), so the
  // invariant is keyed on the unconfirmed state; the insert handles the rare
  // expired-but-unconfirmed conflict with ON CONFLICT DO NOTHING.
  uniqueIndex("referrals_active_conversation_uidx")
    .on(table.conversationId)
    .where(sql`${table.confirmedByNgo} = false`),
  index("referrals_conversation_idx").on(table.conversationId),
  index("referrals_created_at_idx").on(table.createdAt),
  index("referrals_expires_at_idx").on(table.expiresAt),
]).enableRLS();

export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  /** One rating per delivered assistant response. */
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  /** 1–5 satisfaction rating (KPI: 80%+ satisfied). */
  rating: integer("rating").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("feedback_conversation_idx").on(table.conversationId),
  uniqueIndex("feedback_message_uidx").on(table.messageId),
  check("feedback_rating_check", sql`${table.rating} between 1 and 5`),
]).enableRLS();

/** Derived contract analysis. No image and no raw contract text are ever stored. */
export const contractReviews = pgTable("contract_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  anonSessionId: text("anon_session_id").notNull(),
  lang: text("lang").notNull().default("en"),
  summary: text("summary").notNull(),
  keyTerms: jsonb("key_terms").$type<Array<{ label: string; value: string }>>(),
  // Stores only the non-identifying concern + severity — never the verbatim
  // clause quote, which is extracted contract text.
  flaggedClauses: jsonb("flagged_clauses").$type<
    Array<{ concern: string; severity: "info" | "warning" | "serious" }>
  >(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("contract_reviews_session_idx").on(table.anonSessionId),
  index("contract_reviews_created_at_idx").on(table.createdAt),
]).enableRLS();

// ── Referral targets & emergency directory (data-driven) ───────────────────────

export const orgs = pgTable("orgs", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  domains: domainEnum("domains").array().notNull(),
  contact: text("contact").notNull(),
  langs: text("langs").array().notNull().default([]),
  notes: text("notes"),
}).enableRLS();

export const emergencyContacts = pgTable("emergency_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  category: text("category").notNull(),
  langs: text("langs").array().notNull().default([]),
}).enableRLS();

// ── Privacy-safe impact ledger ───────────────────────────────────────────────

/**
 * Daily aggregate counters contain no session id or worker text. Raw worker
 * records can therefore expire or be deleted without changing reported impact.
 */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    day: date("day", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    locale: text("locale").notNull().default("all"),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.metric, table.locale] }),
    index("daily_metrics_metric_day_idx").on(table.metric, table.day),
    check("daily_metrics_value_check", sql`${table.value} >= 0`),
  ],
).enableRLS();

// ── Governance ─────────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("audit_log_at_idx").on(table.at)]).enableRLS();

export type ContentItem = typeof contentItems.$inferSelect;
export type ContentChunk = typeof contentChunks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Org = typeof orgs.$inferSelect;
