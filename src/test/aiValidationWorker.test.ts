import type { DenoRuntime } from '../../supabase/functions/deno';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, membership, rpc, serve, env, fetchMock, cacheLookup, cacheUpsert } = vi.hoisted(() => ({
  auth: vi.fn(),
  membership: vi.fn(),
  rpc: vi.fn(),
  env: vi.fn(),
  fetchMock: vi.fn(),
  cacheLookup: vi.fn(),
  cacheUpsert: vi.fn(),
  serve: vi.fn<(handler: (request: Request) => Response | Promise<Response>) => void>(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: auth },
    rpc,
    from: (table: string) =>
      table === 'room_players'
        ? {
            select: () => ({ eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: membership }) }) }) }),
          }
        : {
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: cacheLookup }) }) }),
            upsert: cacheUpsert,
          },
  }),
}));

const roomId = '10000000-0000-0000-0000-000000000001';
const roundId = '10000000-0000-0000-0000-000000000002';
const playerId = '10000000-0000-0000-0000-000000000003';
const claim = '10000000-0000-0000-0000-000000000004';
let handler: (request: Request) => Response | Promise<Response>;
const request = (body: unknown = { roomId, roundId }, token = true) =>
  new Request('https://example.test/validate', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer user-token' } : {},
    body: JSON.stringify(body),
  });
const modelResponse = (index = 0) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                results: [{ index, status: 'VALID', reason: null, suggestion: null }],
              }),
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );

beforeAll(async () => {
  const runtime: DenoRuntime = { env: { get: env }, serve };
  vi.stubGlobal('Deno', runtime);
  await import('../../supabase/functions/validate-round-answers/index.ts');
  handler = serve.mock.calls[0]![0];
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  env.mockImplementation(
    (name: string) =>
      ({
        SUPABASE_URL: 'https://example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'test-model',
      })[name as 'SUPABASE_URL'],
  );
  auth.mockResolvedValue({ data: { user: { id: playerId } }, error: null });
  membership.mockResolvedValue({ data: { player_id: playerId }, error: null });
  cacheLookup.mockResolvedValue({ data: null, error: null });
  cacheUpsert.mockResolvedValue({ error: null });
  rpc.mockReset();
  rpc
    .mockResolvedValueOnce({
      data: {
        claim,
        letter: 'М',
        answers: [{ player_id: playerId, category: 'animal', value: 'Мечка' }],
      },
      error: null,
    })
    .mockResolvedValue({ data: true, error: null });
  fetchMock.mockResolvedValue(modelResponse());
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('trusted AI worker', () => {
  it('rejects unauthenticated and non-member callers before any model request', async () => {
    expect((await handler(request(undefined, false))).status).toBe(401);
    membership.mockResolvedValueOnce({ data: null, error: null });
    expect((await handler(request())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses database answers and lease identity even if the client supplies forged data', async () => {
    const response = await handler(
      request({ roomId, roundId, letter: 'X', answers: [{ value: 'Forged' }] }),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('complete_ai_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: claim,
      p_results: [
        {
          player_id: playerId,
          category: 'animal',
          status: 'VALID',
          reason: null,
          suggestion: null,
          model: 'test-model',
        },
      ],
    });
    const options = fetchMock.mock.calls[0]![1] as RequestInit;
    if (typeof options.body !== 'string') throw new Error('Expected a JSON request');
    expect(options.body).toContain('Мечка');
    expect(options.body).not.toContain('Forged');
    expect(options.body).toContain('"strict":true');
    expect(await response.json()).toEqual({ state: 'completed' });
  });
  it('skips the model for country, city and village answers', async () => {
    rpc.mockReset().mockResolvedValueOnce({
      data: {
        claim,
        letter: 'Я',
        answers: [{ player_id: playerId, category: 'country', value: 'Ямайка' }],
      },
      error: null,
    }).mockResolvedValue({ data: true, error: null });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('complete_ai_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: claim,
      p_results: [{ player_id: playerId, category: 'country', status: 'VALID', reason: null, suggestion: null, model: 'country-database' }],
    });
  });
  it('identifies the application to Nominatim with its real production origin', async () => {
    rpc
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          claim,
          letter: 'В',
          answers: [{ player_id: playerId, category: 'city', value: 'Варна' }],
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: 0, error: null })
      .mockResolvedValue({ data: true, error: null });
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));

    const response = await handler(request());

    expect(response.status).toBe(200);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('https://nominatim.openstreetmap.org/search');
    expect(new Headers(options.headers).get('user-agent')).toBe(
      'countries-cities-game/1.0 (+https://countries-cities.netlify.app/)',
    );
    expect(new Headers(options.headers).get('referer')).toBe('https://countries-cities.netlify.app/');
    expect(String(url)).toContain('q=%D0%92%D0%B0%D1%80%D0%BD%D0%B0');
    expect(rpc).toHaveBeenCalledWith('reserve_geographic_lookup_slot');
    expect(cacheUpsert).toHaveBeenCalled();
  });
  it('does not call the model when another worker already claimed the job', async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
    expect((await handler(request())).status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('releases a failed lease and never publishes forged or incomplete model decisions', async () => {
    rpc.mockReset().mockResolvedValueOnce({
      data: {
        claim,
        letter: 'М',
        answers: [{ player_id: playerId, category: 'animal', value: 'Мечка' }],
      },
      error: null,
    }).mockResolvedValue({ data: true, error: null });
    fetchMock.mockResolvedValueOnce(modelResponse(999));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledWith('release_ai_validation', {
      p_round_id: roundId,
      p_claim: claim,
    });
    expect(rpc.mock.calls.some(([name]) => name === 'complete_ai_validation')).toBe(false);
    expect(await response.json()).toEqual({ error: 'Validation temporarily unavailable' });
  });
  it('fails safely without a server API key', async () => {
    env.mockImplementation((name: string) =>
      name === 'OPENAI_API_KEY' ? undefined : 'configured',
    );
    expect((await handler(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
