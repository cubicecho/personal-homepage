ALTER TABLE "items" DROP CONSTRAINT "ck_items_column_span";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "full_width" boolean;--> statement-breakpoint
UPDATE "items" SET "full_width" = ("column_span" = 'FULL') WHERE "column_span" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "column_span" SET DATA TYPE integer USING CASE "column_span" WHEN 'ONE' THEN 1 WHEN 'TWO' THEN 2 WHEN 'THREE' THEN 3 WHEN 'FOUR' THEN 4 ELSE NULL END;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "ck_items_column_span" CHECK ("column_span" is null or "column_span" between 1 and 8);--> statement-breakpoint
ALTER TABLE "site_settings" ADD COLUMN "layout_columns" integer;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "ck_site_settings_layout_columns" CHECK ("layout_columns" is null or "layout_columns" between 1 and 8);
