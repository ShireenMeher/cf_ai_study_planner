import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable, type Schedule } from "agents";
import { getSchedulePrompt } from "agents/schedule";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
  pruneMessages,
  tool,
  stepCountIs,
  type ModelMessage
} from "ai";
import { z } from "zod";

type ChatState = {
  latestPlan: string | null;
};

/**
 * The AI SDK's downloadAssets step runs `new URL(data)` on every file
 * part's string data. Data URIs parse as valid URLs, so it tries to
 * HTTP-fetch them and fails. Decode to Uint8Array so the SDK treats
 * them as inline data instead.
 */
function inlineDataUrls(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    return {
      ...msg,
      content: msg.content.map((part) => {
        if (part.type !== "file" || typeof part.data !== "string") return part;
        const match = part.data.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return part;
        const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
        return { ...part, data: bytes, mediaType: match[1] };
      })
    };
  });
}

type BasicMessage = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
};

function extractLastUserText(messages: BasicMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    if (!msg || msg.role !== "user") continue;

    if (typeof msg.content === "string") {
      return msg.content;
    }

    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((part) => part?.type === "text")
        .map((part) => part?.text || "")
        .join(" ")
        .trim();
    }
  }

  return "";
}

function shouldPersistPlan(userText: string): boolean {
  const text = userText.toLowerCase();

  const planKeywords = [
    "make me a plan",
    "study plan",
    "plan my",
    "create a plan",
    "revise my plan",
    "update my plan",
    "change my plan",
    "make wednesday lighter",
    "make thursday lighter",
    "make friday lighter",
    "add leetcode",
    "adjust the plan",
    "current plan",
    "latest plan"
  ];

  return planKeywords.some((keyword) => text.includes(keyword));
}

export class ChatAgent extends AIChatAgent<Env, ChatState> {
  initialState: ChatState = {
    latestPlan: null
  };

  onStart() {
    this.mcp.configureOAuthCallback({
      customHandler: (result) => {
        if (result.authSuccess) {
          return new Response("<script>window.close();</script>", {
            headers: { "content-type": "text/html" },
            status: 200
          });
        }
        return new Response(
          `Authentication Failed: ${result.authError || "Unknown error"}`,
          { headers: { "content-type": "text/plain" }, status: 400 }
        );
      }
    });
  }

  @callable()
  async addServer(name: string, url: string, host: string) {
    return await this.addMcpServer(name, url, { callbackHost: host });
  }

  @callable()
  async removeServer(serverId: string) {
    await this.removeMcpServer(serverId);
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const mcpTools = this.mcp.getAITools();
    const workersai = createWorkersAI({ binding: this.env.AI });

    const lastUserText = extractLastUserText(this.messages);
    const persistThisResponse = shouldPersistPlan(lastUserText);

    const systemPrompt = `You are an Edge-native AI Study Coach with Stateful Planning & Task Scheduling.

Your job is to help users create realistic, balanced, day-by-day study plans.

Guidelines:
- Be practical, structured, and concise.
- When the user gives deadlines, exams, assignments, or preferences, convert them into a clear study plan.
- Prefer a day-wise breakdown.
- Balance workload across days.
- Include breaks, sleep, and realistic time limits.
- If the user asks to revise a plan, modify the earlier plan instead of starting over.
- If information is missing, make reasonable assumptions and state them briefly.
- If the user seems overwhelmed, make the plan lighter and more sustainable.
- Use bullets and simple formatting.

Persistent memory:
- You remember the user's latest saved study plan.
- When the user asks for their current plan, latest plan, saved plan, or asks you to show the plan again, use the getCurrentPlan tool.
- When revising a plan, use the saved plan if relevant and keep continuity.

If the user asks for reminders or wants to schedule something for later, use the scheduleTask tool.
Do not schedule reminders automatically when generating a study plan unless the user explicitly asks for scheduling..
${getSchedulePrompt({ date: new Date() })}`;

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.5", {
        sessionAffinity: this.sessionAffinity
      }),
      system: systemPrompt,
      messages: pruneMessages({
        messages: inlineDataUrls(await convertToModelMessages(this.messages)),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        ...mcpTools,

        getCurrentPlan: tool({
          description:
            "Fetch the user's latest saved study plan from persistent agent state. Use this when the user asks for their current plan, latest plan, saved plan, or wants to see their plan again.",
          inputSchema: z.object({}),
          execute: async () => {
            if (!this.state.latestPlan) {
              return "I don’t have a saved study plan yet. Ask me to create one first.";
            }
            return this.state.latestPlan;
          }
        }),

        scheduleTask: tool({
          description: "Schedule a reminder or study task",
          inputSchema: z.object({
            when: z.string().describe("When the reminder should happen"),
            task: z.string().describe("What to remind the user about")
          }),
          execute: async ({ when, task }) => {
            return `Scheduled reminder: "${task}" for ${when}`;
          }
        }),

        getScheduledTasks: tool({
          description: "List scheduled tasks",
          inputSchema: z.object({}),
          execute: async () => {
            return "Scheduled task listing is available in the full version.";
          }
        }),

        cancelScheduledTask: tool({
          description: "Cancel a scheduled task",
          inputSchema: z.object({
            id: z.string().describe("Task id to cancel")
          }),
          execute: async ({ id }) => {
            return `Cancelled task ${id}`;
          }
        })
      },
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal,
      onFinish: async ({ text }) => {
        if (!persistThisResponse) return;
        const cleaned = text?.trim();
        if (!cleaned) return;

        await this.setState({
          ...this.state,
          latestPlan: cleaned
        });
      }
    });

    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    console.log(`Executing scheduled task: ${description}`);

    this.broadcast(
      JSON.stringify({
        type: "scheduled-task",
        description,
        timestamp: new Date().toISOString()
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;