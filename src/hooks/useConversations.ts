import { useState, useCallback } from "react";
import type { Conversation } from "@/lib/types";

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      setConversations(data);
    } catch {
      console.error("Failed to fetch conversations");
    }
  }, []);

  const createConversation = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { method: "POST" });
      const data = await res.json();
      setConversations((prev) => [data, ...prev]);
      setActiveId(data.id);
      return data.id as string;
    } catch {
      console.error("Failed to create conversation");
      return null;
    }
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeId === id) setActiveId(null);
      } catch {
        console.error("Failed to delete conversation");
      }
    },
    [activeId],
  );

  return {
    conversations,
    activeId,
    setActiveId,
    fetchConversations,
    createConversation,
    deleteConversation,
  };
}