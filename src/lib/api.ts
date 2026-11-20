import { NextResponse } from "next/server";
import { MediaError } from "./media";
import { UploadError } from "./upload";
import { LibraryError } from "./library";
import { CareError } from "./care";
import { BillingError } from "./billing";
import { UnauthorizedError } from "./auth";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...data });
}

export function fail(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: { code, message }, ...extra }, { status });
}

export function handleRouteError(error: unknown) {
  if (error instanceof UnauthorizedError) return fail("UNAUTHORIZED", error.message, 401);
  if (error instanceof UploadError) return fail(error.code, error.message, error.status);
  if (error instanceof LibraryError) return fail(error.code, error.message, error.status);
  if (error instanceof MediaError) return fail(error.code, error.message, 400);
  if (error instanceof CareError) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message }, fieldErrors: error.fieldErrors ?? {} },
      { status: error.status },
    );
  }
  if (error instanceof BillingError) return fail(error.code, error.message, error.status);
  console.error("[api] unhandled", error);
  const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
  return fail("INTERNAL", message, 500);
}

export function parseNumber(value: string | null, fallback?: number): number | undefined {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseBool(value: string | null): boolean | undefined {
  if (value == null || value === "") return undefined;
  return value === "1" || value === "true";
}
