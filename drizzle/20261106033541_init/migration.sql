CREATE TABLE "items" (
	"page_slug" text,
	"section_id" text NOT NULL,
	"id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"opens_in" text,
	"icon" text,
	"description" text,
	"frame_height_px" integer,
	"check_enabled" boolean DEFAULT true NOT NULL,
	"check_url" text,
	"widget" jsonb,
	"position" integer NOT NULL,
	CONSTRAINT "pk_items" PRIMARY KEY("page_slug","id"),
	CONSTRAINT "ck_items_kind" CHECK ("kind" in ('LINK', 'FRAME')),
	CONSTRAINT "ck_items_opens_in" CHECK ("opens_in" is null or "opens_in" in ('NEW_TAB', 'SAME_TAB', 'APP'))
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"slug" text PRIMARY KEY,
	"title" text NOT NULL,
	"icon" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"page_slug" text,
	"id" text,
	"title" text,
	"collapsed" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "pk_sections" PRIMARY KEY("page_slug","id")
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"id" text PRIMARY KEY DEFAULT 'site',
	"search" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_site_settings_singleton" CHECK ("id" = 'site')
);
--> statement-breakpoint
CREATE INDEX "idx_items_page_slug_section_id" ON "items" ("page_slug","section_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_page_slug_pages_slug_fkey" FOREIGN KEY ("page_slug") REFERENCES "pages"("slug") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "fk_items_section" FOREIGN KEY ("page_slug","section_id") REFERENCES "sections"("page_slug","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_page_slug_pages_slug_fkey" FOREIGN KEY ("page_slug") REFERENCES "pages"("slug") ON DELETE CASCADE;