/** Minimal Vercel Node function types — avoids adding @vercel/node as a dependency. */
export interface FnRequest {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface FnResponse {
  status(code: number): FnResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(): void;
}
