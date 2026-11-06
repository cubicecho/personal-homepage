CREATE TABLE "discovered_apps" (
	"id" text PRIMARY KEY,
	"source" text NOT NULL,
	"source_key" text NOT NULL CONSTRAINT "uq_discovered_apps_source_key" UNIQUE,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"icon" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "ck_discovered_apps_source" CHECK ("source" in ('MDNS', 'DOCKHAND', 'DOCKER'))
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "discovered_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_discovered_id_discovered_apps_id_fkey" FOREIGN KEY ("discovered_id") REFERENCES "discovered_apps"("id") ON DELETE SET NULL;