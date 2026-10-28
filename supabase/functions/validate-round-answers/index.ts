import { createClient } from '@supabase/supabase-js';
import {
  extractResponseText,
  judgeInstructions,
  parseDecisions,
  resultSchema,
  type LockedAnswer,
} from './protocol.ts';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer '))
    return reply(401, { error: 'Authentication required' });
  const projectUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!projectUrl || !serviceRole) return reply(503, { error: 'Validation service unavailable' });
  const admin = createClient(projectUrl, serviceRole, {
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
  // Only membership and identifiers come from the client. Letter/answers come from the claimed job.
  const { data: member, error: memberError } = await admin
    .from('room_players')
    .select('player_id')
    .eq('room_id', roomId)
    .eq('player_id', auth.user.id)
    .is('left_at', null)
    .maybeSingle();
  if (memberError) return reply(503, { error: 'Validation service unavailable' });
  if (!member) return reply(403, { error: 'Not a room member' });
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return reply(503, { error: 'Validation service unavailable' });
  const { data: rawJob, error: claimError } = await admin.rpc('claim_ai_validation', {
    p_room_id: roomId,
    p_round_id: roundId,
  });
  if (claimError) return reply(503, { error: 'Validation service unavailable' });
  if (!rawJob) return reply(202, { state: 'already_running_or_finished' });
  const job = rawJob as { claim: string; letter: string; answers: LockedAnswer[] };
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4.1-mini';
  try {
    const rows = job.answers.flatMap((answer, index) =>
      answer.value.trim() ? [{ index, category: answer.category, value: answer.value }] : [],
    );
    let parsed: unknown = { results: [] };
    if (rows.length) {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          store: false,
          instructions: judgeInstructions,
          input: JSON.stringify({ letter: job.letter, answers: rows }),
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
      if (!response.ok) throw new Error('Model request failed');
      parsed = JSON.parse(extractResponseText(await response.json()));
    }
    const decisions = parseDecisions(parsed, job.answers);
    const results = decisions.map((decision) => {
      const answer = job.answers[decision.index];
      if (!answer) throw new Error('Invalid answer index');
      const wrongLetter =
        answer.value.trim() &&
        !answer.value
          .normalize('NFC')
          .trim()
          .toLocaleLowerCase('bg-BG')
          .startsWith(job.letter.toLocaleLowerCase('bg-BG'));
      return {
        player_id: answer.player_id,
        category: answer.category,
        status: wrongLetter ? 'INVALID' : decision.status,
        reason: wrongLetter ? 'WRONG_LETTER' : decision.reason,
        suggestion: wrongLetter ? null : decision.suggestion,
        model,
      };
    });
    const { error } = await admin.rpc('complete_ai_validation', {
      p_room_id: roomId,
      p_round_id: roundId,
      p_claim: job.claim,
      p_results: results,
    });
    if (error) throw new Error('Could not publish validation');
    return reply(200, { state: 'completed' });
  } catch {
    await admin.rpc('release_ai_validation', { p_round_id: roundId, p_claim: job.claim });
    // Do not return answers, provider responses, tokens or internal errors to the client.
    return reply(503, { error: 'Validation temporarily unavailable' });
  }
});
