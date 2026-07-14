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
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";
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
export const contentItems = pgTable("content_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: domainEnum("domain").notNull(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  /** Human-readable citation target, e.g. "Employment Act 1968, s.21". */
  sourceRef: text("source_ref").notNull(),
  /** Canonical language of the source material (the corpus is authored in English). */
  lang: text("lang").notNull().default("en"),
  status: contentStatusEnum("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  /** Content hash so re-ingestion is idempotent. */
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // HNSW cosine index for approximate nearest-neighbour search.
    index("content_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

// ── Conversations & logging (anonymous) ────────────────────────────────────────

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Opaque, non-PII session identifier (cookie). */
  anonSessionId: text("anon_session_id").notNull(),
  lang: text("lang").notNull().default("en"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  text: text("text").notNull(),
  /** Span-level source attributions for assistant answers (see lib/rag). */
  citations: jsonb("citations").$type<
    Array<{ sourceRef: string; contentItemId: string; quote?: string }>
  >(),
  model: text("model"),
  tokens: integer("tokens"),
  /** True when the answer escalated/referred to a human instead of advising. */
  escalated: boolean("escalated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Referrals, feedback, contract reviews ──────────────────────────────────────

export const referrals = pgTable("referrals", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  issueType: text("issue_type").notNull(),
  org: text("org").notNull(),
  outcome: text("outcome"),
  /** Set true when a partner NGO confirms the referral landed (KPI: 30+). */
  confirmedByNgo: boolean("confirmed_by_ngo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "set null",
  }),
  /** 1–5 satisfaction rating (KPI: 80%+ satisfied). */
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Derived contract analysis. No image and no raw contract text are ever stored. */
export const contractReviews = pgTable("contract_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  anonSessionId: text("anon_session_id").notNull(),
  lang: text("lang").notNull().default("en"),
  summary: text("summary").notNull(),
  flaggedClauses: jsonb("flagged_clauses").$type<
    Array<{ clause: string; concern: string; severity: "info" | "warning" | "serious" }>
  >(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── Referral targets & emergency directory (data-driven) ───────────────────────

export const orgs = pgTable("orgs", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  domains: domainEnum("domains").array().notNull(),
  contact: text("contact").notNull(),
  langs: text("langs").array().notNull().default([]),
  notes: text("notes"),
});

export const emergencyContacts = pgTable("emergency_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  contact: text("contact").notNull(),
  category: text("category").notNull(),
  langs: text("langs").array().notNull().default([]),
});

// ── Governance ─────────────────────────────────────────────────────────────────

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

export type ContentItem = typeof contentItems.$inferSelect;
export type ContentChunk = typeof contentChunks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Org = typeof orgs.$inferSelect;
