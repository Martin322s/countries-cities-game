import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  GeographicCategory,
  GeographicPlaceProvider,
  GeographicPlaceRecord,
} from '../../../src/domain/validation.ts';
import type { Database } from '../../../src/shared/lib/database.types';
import { GeoapifyPlaceProvider, GeoapifyProviderError } from './geoapifyPlaceProvider.ts';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEOGRAPHIC_CATEGORIES = new Set(['country', 'city', 'village']);
const isGeographicCategory = (category: string): category is GeographicCategory =>
  GEOGRAPHIC_CATEGORIES.has(category);
const COUNTRY_SET = new Set([
  'австрия',
  'азербайджан',
  'албания',
  'алжир',
  'алжир',
  'андора',
  'ангола',
  'антигуа и барбуда',
  'аргентина',
  'армения',
  'австралия',
  'багамски острови',
  'бангладеш',
  'барбадос',
  'бахрейн',
  'беларус',
  'белгия',
  'белиз',
  'бенин',
  'болгария',
  'боливия',
  'босна и херцеговина',
  'ботсвана',
  'бразилия',
  'брюней',
  'бруней-даруссалам',
  'буркина фасо',
  'бурунди',
  'бутан',
  'великобритания',
  'венецуела',
  'виетнам',
  'габон',
  'гамбия',
  'гана',
  'германия',
  'грузия',
  'гватемала',
  'гвинея',
  'гвинея-бисау',
  'гърция',
  'дания',
  'джибути',
  'доминика',
  'доминиканска република',
  'египет',
  'еквадор',
  'еритрея',
  'естония',
  'етнопия',
  'зимбабве',
  'израел',
  'индия',
  'индонезия',
  'ирак',
  'иран',
  'ирландия',
  'исландия',
  'испания',
  'итания',
  'йемен',
  'йордания',
  'камерун',
  'канада',
  'катар',
  'казахстан',
  'кипър',
  'китай',
  'колумбия',
  'комори',
  'конго',
  'коста рика',
  "кот д'ивуар",
  'кроация',
  'куба',
  'кувейт',
  'кыргызстан',
  'лаос',
  'латвия',
  'лебано',
  'лесото',
  'литва',
  'люксембург',
  'мавритания',
  'мадагаскар',
  'македония',
  'малави',
  'малайзия',
  'малдиви',
  'мали',
  'малта',
  'мароко',
  'маршалови острови',
  'мексико',
  'мианмар',
  'молдова',
  'монголия',
  'монтенегро',
  'мозамбик',
  'намибия',
  'науру',
  'немания',
  'непал',
  'нигер',
  'нигерия',
  'нидерландия',
  'норвегия',
  'оман',
  'океания',
  'пакистан',
  'палестина',
  'панама',
  'папуа нова гвинея',
  'парагвай',
  'перу',
  'полша',
  'португалия',
  'руанда',
  'румъния',
  'русия',
  'салвадор',
  'самоа',
  'сан марино',
  'сао томе и принципе',
  'саудитска арабия',
  'свазиленд',
  'северна корея',
  'северна македония',
  'сейшели',
  'сенегал',
  'сейнт винсент и гренадини',
  'сейнт китс и невис',
  'сейнт лусия',
  'сърбия',
  'сингапур',
  'сирия',
  'словакия',
  'словения',
  'соломонови острови',
  'сомалия',
  'судан',
  'суринам',
  'съединени американски щати',
  'съединено кралство',
  'таджикистан',
  'тайван',
  'тайланд',
  'танзания',
  'того',
  'тринидад и тобаго',
  'тунис',
  'туркменистан',
  'турция',
  'уганда',
  'унгария',
  'украйна',
  'уругвай',
  'узбекистан',
  'фиджи',
  'филипини',
  'финландия',
  'франция',
  'хаити',
  'холандия',
  'хондурас',
  'хърватия',
  'чад',
  'черна гора',
  'чехия',
  'чили',
  'швейцария',
  'швеция',
  'шри ланка',
  'южна африка',
  'южна корея',
  'ямайка',
  'япония',
]);

const normalize = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');
const normalizeGeoName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('bg-BG');

function levenshtein(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = 0; i <= left.length; i++) {
    const row = distances[i];
    if (row) row[0] = i;
  }
  const firstRow = distances[0];
  if (!firstRow) return 0;
  for (let j = 0; j <= right.length; j++) firstRow[j] = j;
  for (let i = 1; i <= left.length; i++) {
    const previousRow = distances[i - 1];
    const currentRow = distances[i];
    if (!previousRow || !currentRow) continue;
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const previousValue = previousRow[j] ?? 0;
      const currentValue = currentRow[j - 1] ?? 0;
      const diagonalValue = previousRow[j - 1] ?? 0;
      currentRow[j] = Math.min(previousValue + 1, currentValue + 1, diagonalValue + cost);
    }
  }
  return distances[left.length]?.[right.length] ?? 0;
}

function validateCountryDecision(
  answer: string,
  letter: string,
): { status: 'VALID' | 'INVALID'; reason: string | null; suggestion: string | null } {
  const normalized = normalize(answer);
  const letterNormalized = normalize(letter);
  if (!normalized) return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null };
  }
  if (COUNTRY_SET.has(normalized)) {
    return { status: 'VALID', reason: null, suggestion: null };
  }
  const closeMatch = Array.from(COUNTRY_SET)
    .filter((countryName) => levenshtein(normalized, countryName) <= 1)
    .sort((left, right) => levenshtein(normalized, left) - levenshtein(normalized, right))[0];
  if (closeMatch) {
    return { status: 'INVALID', reason: 'MISSPELLING', suggestion: closeMatch };
  }
  return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
}

interface GeographicValidationResult {
  status: 'VALID' | 'INVALID';
  reason: string | null;
  suggestion: string | null;
}

interface GeographicCacheResult extends GeographicValidationResult {
  provider: 'geoapify';
}

interface GeographicCacheEntry {
  result: Record<string, unknown>;
  validatedAt: string | null;
}

const NEGATIVE_GEOGRAPHIC_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchCachedGeographicResult(
  admin: SupabaseClient<Database>,
  name: string,
  category: GeographicCategory,
): Promise<GeographicCacheEntry | undefined> {
  try {
    const { data, error } = await admin
      .from('geographic_validation_cache')
      .select('*')
      .eq('normalized_name', `geoapify-v1:${normalizeGeoName(name)}`)
      .eq('requested_category', category)
      .maybeSingle();
    if (error) {
      console.warn('Geoapify cache read failed', { code: error.code, message: error.message });
      return undefined;
    }
    if (data && isRecord(data.result)) {
      return {
        result: data.result,
        validatedAt: data.validated_at,
      };
    }
  } catch (error) {
    console.warn('Geoapify cache read failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'Unknown cache error',
    });
  }
  return undefined;
}

async function storeCachedGeographicResult(
  admin: SupabaseClient<Database>,
  name: string,
  category: GeographicCategory,
  decision: GeographicCacheResult,
  canonicalName?: string,
  countryCode?: string,
) {
  try {
    const { error } = await admin.from('geographic_validation_cache').upsert(
      {
        normalized_name: `geoapify-v1:${normalizeGeoName(name)}`,
        requested_category: category,
        result: {
          status: decision.status,
          reason: decision.reason,
          suggestion: decision.suggestion,
          provider: decision.provider,
        },
        osm_type: null,
        osm_id: null,
        canonical_name: canonicalName ?? name,
        country_code: countryCode ?? null,
        raw_metadata: null,
        validated_at: new Date().toISOString(),
      },
      { onConflict: 'normalized_name,requested_category' },
    );
    if (error)
      console.warn('Geoapify cache write failed', { code: error.code, message: error.message });
  } catch (error) {
    console.warn('Geoapify cache write failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'Unknown cache error',
    });
  }
}

async function validateGeographicAnswer(
  admin: SupabaseClient<Database>,
  provider: GeographicPlaceProvider,
  answer: string,
  letter: string,
  category: GeographicCategory,
  lookupMemo: Map<string, Promise<GeographicPlaceRecord[]>>,
): Promise<GeographicValidationResult> {
  const normalized = normalizeGeoName(answer);
  const letterNormalized = normalizeGeoName(letter);
  if (!normalized) {
    return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null };
  }
  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null };
  }
  const cached = await fetchCachedGeographicResult(admin, answer, category);
  const negativeCacheTimestamp = cached?.validatedAt ? Date.parse(cached.validatedAt) : NaN;
  const negativeCacheExpired =
    cached?.result.status === 'INVALID' &&
    (!Number.isFinite(negativeCacheTimestamp) ||
      Date.now() - negativeCacheTimestamp >= NEGATIVE_GEOGRAPHIC_CACHE_TTL_MS);
  if (cached?.result.provider === 'geoapify' && !negativeCacheExpired) {
    const status = cached.result.status === 'VALID' ? 'VALID' : 'INVALID';
    const validReason = new Set([
      'WRONG_LETTER',
      'MISSPELLING',
      'DOES_NOT_EXIST',
      'WRONG_CATEGORY',
      'AMBIGUOUS',
    ]);
    const reason =
      typeof cached.result.reason === 'string' && validReason.has(cached.result.reason)
        ? cached.result.reason
        : null;
    return {
      status,
      reason: status === 'VALID' ? null : (reason ?? 'AMBIGUOUS'),
      suggestion: typeof cached.result.suggestion === 'string' ? cached.result.suggestion : null,
    };
  }

  const normalizedAnswer = normalizeGeoName(answer);
  let placesPromise = lookupMemo.get(normalizedAnswer);
  if (!placesPromise) {
    placesPromise = provider.lookupPlace(answer);
    lookupMemo.set(normalizedAnswer, placesPromise);
  }
  let places: GeographicPlaceRecord[];
  try {
    places = await placesPromise;
  } catch (error) {
    lookupMemo.delete(normalizedAnswer);
    throw error;
  }

  const exactMatches = places.filter((place) =>
    place.names.some((name) => normalizeGeoName(name) === normalizedAnswer),
  );
  if (!exactMatches.length) {
    const misspelling = places
      .flatMap((place) => place.names.map((name) => ({ place, name })))
      .map(({ place, name }) => ({
        place,
        name,
        distance: levenshtein(normalizedAnswer, normalizeGeoName(name)),
      }))
      .filter(({ distance }) => distance > 0 && distance <= 1)
      .sort((left, right) => left.distance - right.distance)[0];
    const decision: GeographicValidationResult = {
      status: 'INVALID',
      reason: misspelling ? 'MISSPELLING' : 'DOES_NOT_EXIST',
      suggestion: misspelling?.name ?? null,
    };
    await storeCachedGeographicResult(admin, answer, category, {
      ...decision,
      provider: 'geoapify',
    });
    return decision;
  }

  const requestedType = category === 'city' ? 'city' : 'village';
  const exactWithRequestedType = exactMatches.find((place) => place.placeType === requestedType);
  if (exactWithRequestedType) {
    const decision: GeographicValidationResult = {
      status: 'VALID',
      reason: null,
      suggestion: null,
    };
    await storeCachedGeographicResult(
      admin,
      answer,
      category,
      { ...decision, provider: 'geoapify' },
      exactWithRequestedType.canonicalName,
      exactWithRequestedType.countryCode,
    );
    return decision;
  }

  const hasAmbiguousExact = exactMatches.some((place) => place.placeType === 'unknown');
  const decision: GeographicValidationResult = {
    status: 'INVALID',
    reason: hasAmbiguousExact ? 'AMBIGUOUS' : 'WRONG_CATEGORY',
    suggestion: null,
  };
  await storeCachedGeographicResult(admin, answer, category, {
    ...decision,
    provider: 'geoapify',
  });
  return decision;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return reply(401, { error: 'Authentication required' });
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectUrl || !serviceRole) return reply(503, { error: 'Validation service unavailable' });
  const admin = createClient<Database>(projectUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return reply(401, { error: 'Authentication required' });
  const text = await req.text();
  if (text.length > 2048) return reply(413, { error: 'Request too large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'Invalid JSON' });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return reply(400, { error: 'Invalid request' });
  const roomId = Reflect.get(body, 'roomId');
  const roundId = Reflect.get(body, 'roundId');
  if (
    typeof roomId !== 'string' ||
    typeof roundId !== 'string' ||
    !uuid.test(roomId) ||
    !uuid.test(roundId)
  ) {
    return reply(400, { error: 'Expected roomId and roundId' });
  }
  const { data: member, error: memberError } = await admin
    .from('room_players')
    .select('player_id')
    .eq('room_id', roomId)
    .eq('player_id', auth.user.id)
    .is('left_at', null)
    .maybeSingle();
  if (memberError) {
    console.error('Geographic validation membership lookup failed', {
      code: memberError.code,
      message: memberError.message,
    });
    return reply(503, { error: 'Validation service unavailable' });
  }
  if (!member) return reply(403, { error: 'Not a room member' });

  const { data: rawJob, error: claimError } = await admin.rpc('claim_geographic_validation', {
    p_room_id: roomId,
    p_round_id: roundId,
  });
  if (claimError) {
    console.error('Geographic validation job claim failed', {
      code: claimError.code,
      message: claimError.message,
    });
    return reply(503, { error: 'Validation service unavailable' });
  }
  if (!rawJob) return reply(202, { state: 'already_running_or_finished' });
  if (
    !isRecord(rawJob) ||
    typeof rawJob.claim !== 'string' ||
    typeof rawJob.letter !== 'string' ||
    !Array.isArray(rawJob.answers)
  ) {
    console.error('Geographic validation job has an invalid shape');
    return reply(503, { error: 'Validation service unavailable' });
  }
  const jobAnswers: { player_id: string; category: string; value: string }[] = [];
  for (const value of rawJob.answers) {
    if (
      !isRecord(value) ||
      typeof value.player_id !== 'string' ||
      typeof value.category !== 'string' ||
      typeof value.value !== 'string'
    ) {
      console.error('Geographic validation job contains a malformed answer');
      return reply(503, { error: 'Validation service unavailable' });
    }
    jobAnswers.push({
      player_id: value.player_id,
      category: value.category,
      value: value.value,
    });
  }
  const job = { claim: rawJob.claim, letter: rawJob.letter, answers: jobAnswers };
  const geoapifyProvider = new GeoapifyPlaceProvider(Deno.env.get('GEOAPIFY_API_KEY') ?? '');
  let stage = 'prepare';
  try {
    const geographicLookups = new Map<string, Promise<GeographicPlaceRecord[]>>();
    const results = [];
    for (const answer of job.answers) {
      if (
        typeof answer.player_id !== 'string' ||
        typeof answer.category !== 'string' ||
        typeof answer.value !== 'string' ||
        !isGeographicCategory(answer.category)
      ) {
        throw new Error('Geographic job included an invalid answer');
      }
      stage = 'geographic-validation';
      const decision =
        answer.category === 'country'
          ? validateCountryDecision(answer.value, job.letter)
          : await validateGeographicAnswer(
              admin,
              geoapifyProvider,
              answer.value,
              job.letter,
              answer.category,
              geographicLookups,
            );
      results.push({
        player_id: answer.player_id,
        category: answer.category,
        status: decision.status,
        reason: decision.reason,
        suggestion: decision.suggestion,
      });
    }

    stage = 'publish-results';
    const { data: completed, error } = await admin.rpc('complete_geographic_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: job.claim,
      p_results: results,
    });
    if (error) throw new Error('Could not publish geographic validation');
    if (!completed) throw new Error('Geographic validation lease was no longer active');
    return reply(200, { state: 'completed' });
  } catch (error) {
    if (error instanceof GeoapifyProviderError) {
      console.error('Geographic provider request failed', {
        provider: 'geoapify',
        status: error.status,
        normalizedQuery: error.normalizedQuery,
        responseBody: error.responseBody,
        durationMs: error.durationMs,
      });
    }
    console.error('Geographic validation worker failed', {
      roomId,
      roundId,
      stage,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 300) }
          : { name: 'UnknownError' },
    });
    const { error: releaseError } = await admin.rpc('release_geographic_validation', {
      p_round_id: roundId,
      p_claim: job.claim,
    });
    if (releaseError) {
      console.error('Geographic validation lease release failed', {
        code: releaseError.code,
        message: releaseError.message,
      });
    }
    return reply(503, { error: 'Validation temporarily unavailable' });
  }
});
