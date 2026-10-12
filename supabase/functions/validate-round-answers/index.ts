﻿import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/shared/lib/database.types';
import { extractResponseText, judgeInstructions, resultSchema, type LockedAnswer } from './protocol.ts';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEOGRAPHIC_CATEGORIES = new Set(['country', 'city', 'village']);
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
  'кот д\'ивуар',
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

function levenshtein(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) distances[i]![0] = i;
  for (let j = 0; j <= right.length; j++) distances[0]![j] = j;
  for (let i = 1; i <= left.length; i++) {
    const previousRow = distances[i - 1]!;
    const currentRow = distances[i]!;
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

function validateCountryDecision(answer: string, letter: string): { status: 'VALID' | 'INVALID'; reason: string | null; suggestion: string | null } {
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

function getPlaceType(type: string): string {
  switch (type.toLowerCase()) {
    case 'city':
    case 'town':
      return 'city';
    case 'village':
      return 'village';
    default:
      return 'unknown';
  }
}

function exactNameMatch(answer: string, result: Record<string, unknown>): boolean {
  const normalizedAnswer = normalize(answer);
  const names = [
    typeof result.display_name === 'string' ? result.display_name : '',
    typeof result.name === 'string' ? result.name : '',
    typeof result.canonical_name === 'string' ? result.canonical_name : '',
    ...(typeof result.namedetails === 'object' && result.namedetails !== null && !Array.isArray(result.namedetails)
      ? Object.values(result.namedetails as Record<string, string>)
      : []),
  ]
    .map((value) => normalize(value))
    .filter(Boolean);
  return names.includes(normalizedAnswer);
}

type GeographicValidationResult = {
  status: 'VALID' | 'INVALID';
  reason: string | null;
  suggestion: string | null;
  model: string;
};

async function fetchCachedGeographicResult(admin: SupabaseClient<Database>, name: string, category: string) {
  try {
    const cache = admin.from('geographic_validation_cache' as never) as any;
    const { data, error } = await cache
      .select('*')
      .eq('normalized_name', normalize(name))
      .eq('requested_category', category)
      .maybeSingle();
    const row = data as { result?: unknown } | null;
    if (!error && row && typeof row.result === 'object' && row.result !== null) return row.result as Record<string, unknown>;
  } catch {
    // Ignore cache errors and fall back to a fresh provider lookup.
  }
  return undefined;
}

async function storeCachedGeographicResult(
  admin: SupabaseClient<Database>,
  name: string,
  category: string,
  decision: Record<string, unknown>,
  osmType?: string,
  osmId?: number,
  canonicalName?: string,
  countryCode?: string,
  rawMetadata?: Record<string, unknown>,
) {
  try {
    const cache = admin.from('geographic_validation_cache' as never) as any;
    await cache.upsert(
      {
        normalized_name: normalize(name),
        requested_category: category,
        result: decision,
        osm_type: osmType ?? null,
        osm_id: osmId ?? null,
        canonical_name: canonicalName ?? name,
        country_code: countryCode ?? null,
        raw_metadata: rawMetadata ?? null,
        validated_at: new Date().toISOString(),
      },
      { onConflict: 'normalized_name,requested_category' },
    );
  } catch {
    // Keep validation resilient even when the cache table is unavailable.
  }
}

async function validateGeographicAnswer(
  admin: SupabaseClient<Database>,
  answer: string,
  letter: string,
  category: string,
): Promise<GeographicValidationResult> {
  const normalized = normalize(answer);
  const letterNormalized = normalize(letter);
  if (!normalized) {
    return { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null, model: 'country-database' };
  }
  if (!normalized.startsWith(letterNormalized)) {
    return { status: 'INVALID', reason: 'WRONG_LETTER', suggestion: null, model: 'country-database' };
  }
  if (category === 'country') {
    const decision = validateCountryDecision(answer, letter);
    return { ...decision, model: 'country-database' };
  }

  const cached = await fetchCachedGeographicResult(admin, answer, category);
  if (cached) {
    return {
      status: (cached.status as 'VALID' | 'INVALID') ?? 'INVALID',
      reason: typeof cached.reason === 'string' ? cached.reason : null,
      suggestion: typeof cached.suggestion === 'string' ? cached.suggestion : null,
      model: 'nominatim',
    };
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('limit', '10');
  url.searchParams.set('q', answer);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'countries-cities-game/1.0 (contact: support@example.invalid)',
      Referer: 'https://countries-cities-game.example/',
      'Accept-Language': 'bg,en',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Nominatim lookup failed: ${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>[];
  const exactMatches = payload.filter((entry) => exactNameMatch(answer, entry));
  if (!exactMatches.length) {
    const decision: GeographicValidationResult = { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null, model: 'nominatim' };
    await storeCachedGeographicResult(admin, answer, category, decision);
    return decision;
  }

  const acceptedTypes = category === 'city' ? ['city', 'town'] : ['village'];
  const accepted = exactMatches.filter((entry) => acceptedTypes.includes(getPlaceType(String(entry.type ?? 'unknown'))));
  if (accepted.length) {
    const match = accepted[0];
    if (!match) {
      const decision: GeographicValidationResult = { status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null, model: 'nominatim' };
      return decision;
    }
    const decision: GeographicValidationResult = { status: 'VALID', reason: null, suggestion: null, model: 'nominatim' };
    await storeCachedGeographicResult(
      admin,
      answer,
      category,
      decision,
      String(match.type ?? 'unknown'),
      typeof match.osm_id === 'number' ? match.osm_id : undefined,
      typeof match.display_name === 'string' ? match.display_name : answer,
      typeof match.address === 'object' && match.address !== null && 'country_code' in match.address
        ? String((match.address as Record<string, unknown>).country_code)
        : undefined,
      match,
    );
    return decision;
  }

  const decision: GeographicValidationResult = { status: 'INVALID', reason: 'WRONG_CATEGORY', suggestion: null, model: 'nominatim' };
  await storeCachedGeographicResult(admin, answer, category, decision);
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
  if (typeof body !== 'object' || body === null) return reply(400, { error: 'Invalid request' });
  const { roomId, roundId } = body as Record<string, unknown>;
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
    console.error('Validation membership lookup failed', {
      code: memberError.code,
      message: memberError.message,
    });
    return reply(503, { error: 'Validation service unavailable' });
  }
  if (!member) return reply(403, { error: 'Not a room member' });
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    console.error('Validation service is missing OPENAI_API_KEY');
    return reply(503, { error: 'Validation service unavailable' });
  }
  const { data: rawJob, error: claimError } = await admin.rpc('claim_ai_validation', {
    p_room_id: roomId,
    p_round_id: roundId,
  });
  if (claimError) {
    console.error('Validation job claim failed', {
      code: claimError.code,
      message: claimError.message,
    });
    return reply(503, { error: 'Validation service unavailable' });
  }
  if (!rawJob) return reply(202, { state: 'already_running_or_finished' });
  const job = rawJob as unknown as { claim: string; letter: string; answers: LockedAnswer[] };
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
  let stage = 'prepare';
  try {
    const byIndex = new Map<number, { index: number; status: 'VALID' | 'INVALID'; reason: string | null; suggestion: string | null; model: string }>();
    const nonGeographicRows: Array<{ index: number; category: string; value: string }> = [];
    for (const [index, answer] of job.answers.entries()) {
      const trimmed = answer.value.trim();
      if (!trimmed) {
        byIndex.set(index, { index, status: 'INVALID', reason: 'DOES_NOT_EXIST', suggestion: null, model: 'empty' });
        continue;
      }
      if (GEOGRAPHIC_CATEGORIES.has(answer.category)) {
        stage = 'geographic-validation';
        const decision = await validateGeographicAnswer(admin, answer.value, job.letter, answer.category);
        byIndex.set(index, { index, ...decision });
        continue;
      }
      nonGeographicRows.push({ index, category: answer.category, value: answer.value });
    }

    if (nonGeographicRows.length) {
      stage = 'openai-validation';
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          store: false,
          instructions: judgeInstructions,
          input: JSON.stringify({ letter: job.letter, answers: nonGeographicRows }),
          text: {
            format: {
              type: 'json_schema',
              name: 'round_validation_result',
              strict: true,
              schema: resultSchema,
            },
          },
        }),
      });
      if (!response.ok) throw new Error(`Model request failed with status ${response.status}`);
      const parsed = JSON.parse(extractResponseText(await response.json())) as { results?: Array<Record<string, unknown>> };
      const expectedIndexes = new Set(nonGeographicRows.map((entry) => entry.index));
      const receivedIndexes = new Set<number>();
      for (const item of parsed.results ?? []) {
        const index = typeof item.index === 'number' ? item.index : NaN;
        if (!Number.isInteger(index) || !expectedIndexes.has(index)) continue;
        const answer = job.answers[index];
        if (!answer || GEOGRAPHIC_CATEGORIES.has(answer.category)) continue;
        const wrongLetter =
          answer.value.trim() &&
          !answer.value
            .normalize('NFC')
            .trim()
            .toLocaleLowerCase('bg-BG')
            .startsWith(job.letter.toLocaleLowerCase('bg-BG'));
        const status = wrongLetter ? 'INVALID' : (item.status as 'VALID' | 'INVALID');
        const reason = wrongLetter
          ? 'WRONG_LETTER'
          : status === 'VALID'
            ? null
            : typeof item.reason === 'string'
              ? item.reason
              : 'AMBIGUOUS';
        receivedIndexes.add(index);
        byIndex.set(index, {
          index,
          status,
          reason,
          suggestion: wrongLetter || status === 'VALID' ? null : (typeof item.suggestion === 'string' ? item.suggestion : null),
          model,
        });
      }
      if (receivedIndexes.size !== expectedIndexes.size) {
        throw new Error('Incomplete validation response');
      }
    }

    const results = job.answers.map((answer, index) => {
      const decision = byIndex.get(index) ?? {
        index,
        status: 'INVALID',
        reason: 'DOES_NOT_EXIST',
        suggestion: null,
        model: 'empty',
      };
      return {
        player_id: answer.player_id,
        category: answer.category,
        status: decision.status,
        reason: decision.reason,
        suggestion: decision.suggestion,
        model: decision.model,
      };
    });
    stage = 'publish-results';
    const { data: completed, error } = await admin.rpc('complete_ai_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: job.claim,
      p_results: results,
    });
    if (error) throw new Error('Could not publish validation');
    if (!completed) throw new Error('Validation lease was no longer active');
    return reply(200, { state: 'completed' });
  } catch (error) {
    console.error('Validation worker failed', {
      roomId,
      roundId,
      stage,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 300) }
          : { name: 'UnknownError' },
    });
    const { error: releaseError } = await admin.rpc('release_ai_validation', {
      p_round_id: roundId,
      p_claim: job.claim,
    });
    if (releaseError) {
      console.error('Validation lease release failed', {
        code: releaseError.code,
        message: releaseError.message,
      });
    }
    return reply(503, { error: 'Validation temporarily unavailable' });
  }
});
