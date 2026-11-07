import { ChatMessage } from '../llm/types';

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messages: ChatMessage[];
}

export function extractSessionTitle(history: ChatMessage[]): string {
  const firstUser = history.find(m => m.role === 'user' && !m.content.startsWith('['));
  if (!firstUser || !firstUser.content.trim()) return 'New Chat';
  const firstLine = firstUser.content.trim().split('\n')[0].trim();
  const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^[*`_]+/, '').replace(/[*`_]+$/, '').trim();
  return cleaned.length > 45 ? cleaned.slice(0, 42) + '...' : cleaned;
}

