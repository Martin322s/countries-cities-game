import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { PlayerId, RoomId } from '@/domain';
import { getSupabaseClient } from '@/shared/lib/supabase';

interface RoomChatProps {
  roomId: RoomId;
  playerId: PlayerId;
  playerName: string;
}

interface ChatMessage {
  id: string;
  playerId: PlayerId;
  playerName: string;
  text: string;
}

function parseMessage(payload: unknown): ChatMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    typeof value.playerId !== 'string' ||
    typeof value.playerName !== 'string' ||
    typeof value.text !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    playerId: value.playerId as PlayerId,
    playerName: value.playerName.slice(0, 40),
    text: value.text.slice(0, 300),
  };
}

export function RoomChat({ roomId, playerId, playerName }: RoomChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null>(
    null,
  );

  useEffect(() => {
    const channel = getSupabaseClient().channel(`room-chat:${roomId}`, {
      config: { private: true },
    });
    channelRef.current = channel;
    channel
      .on('broadcast', { event: 'message' }, ({ payload }) => {
        const message = parseMessage(payload);
        if (message) setMessages((current) => [...current.slice(-79), message]);
      })
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setError('Чатът не успя да се свърже.');
        }
      });
    return () => {
      channelRef.current = null;
      void getSupabaseClient().removeChannel(channel);
    };
  }, [roomId]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const messageText = text.trim().slice(0, 300);
    const channel = channelRef.current;
    if (!messageText || !channel || !connected) return;
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      playerId,
      playerName: playerName.slice(0, 40),
      text: messageText,
    };
    const result = await channel.send({ type: 'broadcast', event: 'message', payload: message });
    if (result !== 'ok') {
      setError('Съобщението не се изпрати. Опитай отново.');
      return;
    }
    setMessages((current) => [...current.slice(-79), message]);
    setText('');
    setError(null);
  };

  return (
    <section
      aria-labelledby="room-chat-title"
      className="rounded-panel border border-white/10 bg-ink-900/60 p-4"
    >
      <h2 id="room-chat-title" className="mb-3 font-display text-lg font-bold">
        Чат
      </h2>
      <div aria-live="polite" className="mb-3 max-h-48 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-fg-muted">Напиши съобщение до играчите в стаята.</p>
        ) : (
          messages.map((message) => (
            <p key={message.id} className="break-words text-sm">
              <span className="font-semibold text-brand-300">{message.playerName}: </span>
              {message.text}
            </p>
          ))
        )}
      </div>
      <form onSubmit={(event) => void send(event)} className="flex gap-2">
        <input
          aria-label="Съобщение"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-950 px-3 py-2 text-sm text-fg"
          maxLength={300}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button
          type="submit"
          disabled={!connected || !text.trim()}
          className="rounded-xl bg-brand-400 px-4 py-2 text-sm font-bold text-ink-950 disabled:opacity-50"
        >
          Изпрати
        </button>
      </form>
      {error ? <p role="alert" className="mt-2 text-sm text-status-error">{error}</p> : null}
    </section>
  );
}
