require('dotenv').config();
import z from "zod";
import { GenericLLM, StreamFn } from "../generic-llm";
import { GoogleGenAI } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface GoogleGenAILLMParam {
  apiKey: string
  model: string
  base_url?: string
}

export class GoogleGenAILLM extends GenericLLM {
  public client: GoogleGenAI;
  public model: string = 'gemini-2.5-flash';
  private param: GoogleGenAILLMParam;

  public constructor(param: GoogleGenAILLMParam = {
    apiKey: process.env.GOOGLE_GENAI_APIKEY || '',
    model: process.env.GOOGLE_GENAI_MODEL || '',
  }) {
    super(param.apiKey, '', param.model);
    this.param = param;
    this.client = new GoogleGenAI({ apiKey: param.apiKey });
    if (param.model) {
      this.model = param.model;
    }
  }

  public clone(): GoogleGenAILLM {
    const n = new GoogleGenAILLM(this.param);
    return n;
  }

  public async askLLM<T = string>(q: string, type?: z.ZodTypeAny<T>, signal?: AbortSignal): Promise<T> {
    this.history.push({
      role: "user",
      content: q,
    });
    try {
      const chat = this.client.chats.create({
        model: this.model,
        history: this.history.map(z => ({
          role: z.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: z.content }]
        })),
      });
      if (!type) {
        const response = await chat.sendMessage({
          message: q + '\nPlease output the result in string format',
          config: { abortSignal: signal }
        });
        this.history.push({
          role: 'assistant',
          content: response.text || ''
        });
        return response.text as T;
      }
      const zod_json_schema = type.toJSONSchema();
      delete zod_json_schema.$schema;
      const response = await chat.sendMessage({
        message: q + `\nPlease output the result in this JSON schema ${JSON.stringify(zod_json_schema, null, 2)}.`,
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: zodToJsonSchema(type as any),
          abortSignal: signal
        },
      });
  
      const result: T | undefined | null = JSON.parse(response.text || '');
      if (result) {
        this.history.push({
          role: 'assistant',
          content: response.text || ''
        });
        return result;
      }
      throw new Error('Something went wrong.');
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  public async streamLLM(q: string, onOutput: StreamFn, signal?: AbortSignal) {
    this.history.push({
      role: "user",
      content: q + '\nPlease output the result in string format',
    });
    try {
      const chat = this.client.chats.create({
        model: this.model,
        history: this.history.map(z => ({
          role: z.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: z.content }]
        }))
      });
      const stream = await chat.sendMessageStream({
        message: q,
        config: { abortSignal: signal }
      });
      let result = '';
      for await (const s of stream) {
        result = '' + result + s.text || '';
        onOutput(s.text || '');
      }
      this.history.push({
        role: 'assistant',
        content: result
      });
    } catch (err) {
      console.log(err);
      throw err;
    }
  }
}

// async function main() {
//   try {
//     console.log('zzzz2');
//     const g = new GoogleGenAILLM('');
//     console.log('zzzz');
//     const r = await g.streamLLM('give long story about america', (delta) => {
//       console.log(delta);
//     });
//     console.log('r', r);
//   } catch (err) {
//     console.log(err);
//   }
// }

// main().catch(console.error).finally(() => process.exit(0));
