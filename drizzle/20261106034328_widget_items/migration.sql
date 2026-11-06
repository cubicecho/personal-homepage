ALTER TABLE "items" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "ck_items_url" CHECK ("url" is not null or "kind" = 'WIDGET');--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "ck_items_widget" CHECK (("widget" is not null) = ("kind" = 'WIDGET'));--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "ck_items_kind", ADD CONSTRAINT "ck_items_kind" CHECK ("kind" in ('LINK', 'FRAME', 'WIDGET'));