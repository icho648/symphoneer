import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = 1 as const;
export const PROJECTION_SCHEMA_VERSION = 1 as const;

export const NonEmptyString = z.string().trim().min(1);
export const Timestamp = z.iso.datetime({ offset: true });

export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

export const ProjectionVersionSchema = z.literal(PROJECTION_SCHEMA_VERSION);
