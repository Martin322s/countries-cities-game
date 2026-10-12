import type { DenoRuntime } from '../../supabase/functions/deno';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, membership, rpc, serve, env, fetchMock, cacheLookup, cacheUpsert } = vi.hoisted(
  () => ({
    auth: vi.fn(),
    membership: vi.fn(),
    rpc: vi.fn(),
    env: vi.fn(),
    fetchMock: vi.fn(),
    cacheLookup: vi.fn(),
    cacheUpsert: vi.fn(),
    serve: vi.fn<(handler: (request: Request) => Response | Promise<Response>) => void>(),
  }),
);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: auth },
    rpc,
    from: (table: string) =>
      table === 'room_players'
        ? {
            select: () => ({
              eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: membership }) }) }),
            }),
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
const geoapifyFeature = (
  name: string,
  place: string,
  country_code = 'bg',
  nameVariants: Record<string, string> = {},
) => ({
  name,
  result_type: place,
  country_code,
  datasource: { raw: { name, place, ...nameVariants } },
});
const setGeoAnswers = (answers: { category: string; value: string }[], letter = 'В') => {
  rpc
    .mockReset()
    .mockResolvedValueOnce({
      data: {
        claim,
        letter,
        answers: answers.map(({ category, value }) => ({ player_id: playerId, category, value })),
      },
      error: null,
    })
    .mockResolvedValue({ data: true, error: null });
};
const completedResults = async () => {
  const response = await handler(request());
  expect(response.status).toBe(200);
  const completion = rpc.mock.calls.find(([name]) => name === 'complete_ai_validation');
  if (!completion) throw new Error('Validation did not complete');
  const completionArgs: unknown = completion[1];
  if (!isRecord(completionArgs) || !Array.isArray(completionArgs.p_results)) {
    throw new Error('Validation results were not published');
  }
  return completionArgs.p_results.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.status !== 'string' ||
      (value.reason !== null && typeof value.reason !== 'string') ||
      typeof value.model !== 'string'
    ) {
      throw new Error('Validation published a malformed result');
    }
    return {
      status: value.status,
      reason: value.reason,
      model: value.model,
    };
  });
};
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
        GEOAPIFY_API_KEY: 'test-geoapify-secret',
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
    rpc
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          claim,
          letter: 'Я',
          answers: [{ player_id: playerId, category: 'country', value: 'Ямайка' }],
        },
        error: null,
      })
      .mockResolvedValue({ data: true, error: null });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('complete_ai_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: claim,
      p_results: [
        {
          player_id: playerId,
          category: 'country',
          status: 'VALID',
          reason: null,
          suggestion: null,
          model: 'country-database',
        },
      ],
    });
  });
  it('queries Geoapify for city answers and accepts an exact Bulgarian name', async () => {
    setGeoAnswers([{ category: 'city', value: 'Варна' }]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Варна', 'city')] }), {
        status: 200,
      }),
    );

    const results = await completedResults();
    expect(results).toEqual([{ status: 'VALID', reason: null, model: 'geoapify' }]);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin + url.pathname).toBe('https://api.geoapify.com/v1/geocode/search');
    expect(url.searchParams.get('text')).toBe('Варна');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('bias')).toBe('countrycode:none');
    expect(url.searchParams.get('apiKey')).toBe('test-geoapify-secret');
    expect(options.headers).toBeUndefined();
    expect(cacheUpsert).toHaveBeenCalled();
  });
  it('matches an exact returned English name variant without fuzzy correction', async () => {
    setGeoAnswers([{ category: 'city', value: 'Varna' }], 'V');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [geoapifyFeature('Варна', 'city', 'bg', { 'name:en': 'Varna' })],
        }),
        { status: 200 },
      ),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);
  });
  it('rejects a city result when the answer is requested as a village', async () => {
    setGeoAnswers([{ category: 'village', value: 'Варна' }]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Варна', 'city')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'INVALID', reason: 'WRONG_CATEGORY', model: 'geoapify' },
    ]);
  });
  it('accepts София as a city but never accepts the one-letter typo Софиа', async () => {
    setGeoAnswers([{ category: 'city', value: 'София' }], 'С');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('София', 'city')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);

    setGeoAnswers([{ category: 'city', value: 'Софиа' }], 'С');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('София', 'city')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'INVALID', reason: 'MISSPELLING', model: 'geoapify' },
    ]);
  });
  it('accepts an exact village result and rejects a village when requested as a city', async () => {
    setGeoAnswers([{ category: 'village', value: 'Баня' }], 'Б');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Баня', 'village')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);

    setGeoAnswers([{ category: 'city', value: 'Баня' }], 'Б');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Баня', 'village')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'INVALID', reason: 'WRONG_CATEGORY', model: 'geoapify' },
    ]);
  });
  it('recognizes a Geoapify city-level result with an OSM hamlet settlement tag as a village', async () => {
    setGeoAnswers([{ category: 'village', value: 'Челюстница' }], 'Ч');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            {
              name: 'Челюстница',
              result_type: 'city',
              datasource: { raw: { name: 'Челюстница', place: 'hamlet' } },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);
  });
  it('accepts an exact same-name place of the requested type among locations in different countries', async () => {
    setGeoAnswers([{ category: 'city', value: 'Баня' }], 'Б');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [
            geoapifyFeature('Баня', 'village', 'bg'),
            geoapifyFeature('Баня', 'town', 'rs'),
          ],
        }),
        { status: 200 },
      ),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);
  });
  it('returns does-not-exist when Geoapify has no exact or near-name result', async () => {
    setGeoAnswers([{ category: 'city', value: 'Варна' }]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    expect(await completedResults()).toEqual([
      { status: 'INVALID', reason: 'DOES_NOT_EXIST', model: 'geoapify' },
    ]);
  });
  it.each([401, 403, 429, 503])(
    'treats Geoapify HTTP %s as a provider failure, not a missing place',
    async (status) => {
      setGeoAnswers([{ category: 'city', value: 'Варна' }]);
      fetchMock.mockResolvedValueOnce(new Response('{"message":"provider error"}', { status }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await handler(request());
      expect(response.status).toBe(503);
      expect(rpc.mock.calls.some(([name]) => name === 'complete_ai_validation')).toBe(false);
      expect(rpc).toHaveBeenCalledWith('release_ai_validation', {
        p_round_id: roundId,
        p_claim: claim,
      });
      const providerLog = errorSpy.mock.calls.find(
        ([message]) => message === 'Geographic provider request failed',
      );
      expect(providerLog?.[1]).toMatchObject({
        provider: 'geoapify',
        status,
        normalizedQuery: 'варна',
      });
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-geoapify-secret');
      errorSpy.mockRestore();
    },
  );
  it('treats an unknown settlement type as ambiguous rather than a city', async () => {
    setGeoAnswers([{ category: 'city', value: 'Варна' }]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Варна', 'suburb')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'INVALID', reason: 'AMBIGUOUS', model: 'geoapify' },
    ]);
  });
  it('uses a Geoapify cache hit without making a provider request', async () => {
    setGeoAnswers([{ category: 'city', value: 'Варна' }]);
    cacheLookup.mockResolvedValueOnce({
      data: {
        result: { status: 'VALID', reason: null, suggestion: null, model: 'geoapify' },
        validated_at: new Date().toISOString(),
      },
      error: null,
    });
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refreshes an expired negative Geoapify cache result', async () => {
    setGeoAnswers([{ category: 'village', value: 'Челюстница' }], 'Ч');
    cacheLookup.mockResolvedValueOnce({
      data: {
        result: {
          status: 'INVALID',
          reason: 'DOES_NOT_EXIST',
          suggestion: null,
          model: 'geoapify',
        },
        validated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      },
      error: null,
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Челюстница', 'hamlet')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('looks up an identical answer only once per round', async () => {
    setGeoAnswers([
      { category: 'city', value: 'Варна' },
      { category: 'city', value: ' Варна ' },
    ]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Варна', 'city')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('reuses identical place results across city and village answers in the same round', async () => {
    setGeoAnswers([
      { category: 'city', value: 'Варна' },
      { category: 'village', value: 'Варна' },
    ]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [geoapifyFeature('Варна', 'city')] }), {
        status: 200,
      }),
    );
    expect(await completedResults()).toEqual([
      { status: 'VALID', reason: null, model: 'geoapify' },
      { status: 'INVALID', reason: 'WRONG_CATEGORY', model: 'geoapify' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not call the model when another worker already claimed the job', async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: null });
    expect((await handler(request())).status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('releases a failed lease and never publishes forged or incomplete model decisions', async () => {
    rpc
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          claim,
          letter: 'М',
          answers: [{ player_id: playerId, category: 'animal', value: 'Мечка' }],
        },
        error: null,
      })
      .mockResolvedValue({ data: true, error: null });
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
