import "dotenv/config";
import express from "express";
import cors from "cors";
import { OpenAI } from "openai";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { eq, desc, asc } from "drizzle-orm";
import { db } from "./db/index.js";
import { conversations, messages } from "./db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const client = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HF_TOKEN,
});

// --- Conversation routes ---
// List all conversations
app.get("/api/conversations", async (_req, res) => {
  try {
    const result = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt));
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Create a new conversation
app.post("/api/conversations", async (_req, res) => {
  try {
    const id = uuidv4();
    const now = new Date();
    await db.insert(conversations).values({
      id,
      title: "New Chat",
      createdAt: now,
      updatedAt: now,
    });
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    res.json(conversation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// Delete a conversation
app.delete("/api/conversations/:id", async (req, res) => {
  try {
    await db
      .delete(conversations)
      .where(eq(conversations.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// Get messages for a conversation
app.get("/api/conversations/:id/messages", async (req, res) => {
  try {
    const result = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, req.params.id))
      .orderBy(asc(messages.createdAt));
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// --- Chat route with streaming ---

app.post("/api/chat", async (req, res) => {
  try {
    const { messages: chatMessages, conversationId } = req.body;

    // Save user message
    const userMsg = chatMessages[chatMessages.length - 1];
    await db.insert(messages).values({
      id: uuidv4(),
      conversationId,
      role: userMsg.role,
      content: userMsg.content,
    });

    // Update conversation title from first user message
    const msgCount = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId));

    if (msgCount.length === 1) {
      const title =
        userMsg.content.length > 50
          ? userMsg.content.slice(0, 50) + "..."
          : userMsg.content;
      await db
        .update(conversations)
        .set({ title, updatedAt: new Date() })
        .where(eq(conversations.id, conversationId));
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await client.chat.completions.create({
      model: "moonshotai/Kimi-K2-Instruct-0905:fastest",
      messages: chatMessages,
      stream: true,
    });

    let assistantContent = "";

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        assistantContent += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    // Save assistant message
    await db.insert(messages).values({
      id: uuidv4(),
      conversationId,
      role: "assistant",
      content: assistantContent,
    });

    // Update conversation timestamp
    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong" });
    } else {
      res.write(
        `data: ${JSON.stringify({ error: "Something went wrong" })}\n\n`,
      );
      res.end();
    }
  }
});

// Serve built frontend in production
app.use(express.static(path.join(__dirname, "../dist")));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "../dist/index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});