export interface DenoRuntime {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
}
declare global {
  const Deno: DenoRuntime;
}
