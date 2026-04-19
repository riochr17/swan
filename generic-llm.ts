import z from "zod";

export type ChatRole = 'user' | 'assistant';
export type StreamFn = (delta_text: string) => void;
export abstract class GenericLLM {
  public knowledges: string[] = [];
  public history: {
    role: ChatRole
    content: string
  }[] = [];

  public constructor(apiKey: string, base_url?: string, model?: string) {
    // 
  }

  public abstract clone(): GenericLLM;
  public abstract askLLM<T = string>(q: string, type?: z.ZodTypeAny<T>, signal?: AbortSignal): Promise<T>;
  public abstract streamLLM(q: string, onOutput: StreamFn, signal?: AbortSignal): Promise<void>;

  public addKnowledge(k: string): void {
    this.knowledges.push(k);
    this.history.push({
      role: "user",
      content: [
        `### Knowledge #${this.knowledges.length}`,
        k
      ].join('\n'),
    });
  }

  public addInformation(k: string): void {
    this.history.push({
      role: "user",
      content: k,
    });
  }

  public cleanUp() {
    this.history = [];
    this.knowledges = [];
  }
}
