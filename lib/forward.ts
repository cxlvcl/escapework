import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { googleCall } from "@/services/google-client";
import { sessionToken } from "./auth";
export function requestId(request: Request) {
  return z.uuid().parse(request.headers.get("Idempotency-Key") ?? randomUUID());
}
export async function forward(
  request: Request,
  action: string,
  data: Record<string, unknown>,
) {
  return googleCall(action, data, await sessionToken(), requestId(request));
}
