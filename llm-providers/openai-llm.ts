require('dotenv').config();
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ChatModel } from "openai/resources/shared";
import z from "zod";
import { GenericLLM, StreamFn } from "../generic-llm";
import { APIUserAbortError } from "openai";

export interface OpenAILLMParam {
  apiKey: string
  model: ChatModel | string
  base_url?: string
}

export class OpenAILLM extends GenericLLM {
  public client: OpenAI;
  public model: ChatModel | string = 'gpt-4o';
  private param: OpenAILLMParam;

  public constructor(param: OpenAILLMParam = {
    apiKey: process.env.CHATGPT_APIKEY || '',
    model: process.env.CHATGPT_MODEL || '',
    base_url: process.env.CHATGPT_ENDPOINT,
  }) {
    super(param.apiKey, param.base_url, param.model);
    this.param = param;
    this.client = new OpenAI({ apiKey: param.apiKey, baseURL: param.base_url });
    if (param.model) {
      this.model = param.model;
    }
  }

  public clone(): OpenAILLM {
    const n = new OpenAILLM(this.param);
    return n;
  }

  public async askLLM<T = string>(q: string, type?: z.ZodTypeAny<T>, signal?: AbortSignal): Promise<T> {
    try {
      if (!type) {
        this.history.push({
          role: "user",
          content: q,
        });
        const response = await this.client.responses.create({
          model: this.model,
          input: [
            ...this.history,
            {
              role: "user",
              content: q + '\nPlease output the result in string format'
            }
          ],
        }, {
          signal
        });
        signal?.throwIfAborted();
        this.history.push({
          role: 'assistant',
          content: response.output_text
        });
        return response.output_text as T;
      } else {
        this.history.push({
          role: "user",
          content: q,
        });
        const zod_json_schema = type.toJSONSchema();
        delete zod_json_schema.$schema;
        signal?.throwIfAborted();
        const response = await this.client.chat.completions.parse({
          model: this.model,
          messages: [
            ...this.history,
            {
              role: "user",
              content: q + `\nPlease output the result in JSON schema ${JSON.stringify(zod_json_schema)}.`
            }
          ],
          response_format: zodResponseFormat(type, "user"),
        });
    
        signal?.throwIfAborted();
        const result: T | undefined | null = response.choices[0]?.message.parsed;
        if (result) {
          this.history.push({
            role: 'assistant',
            content: JSON.stringify(response.choices[0]?.message.parsed)
          });
          return result;
        }
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
      const stream = await this.client.responses.create({
        model: this.model,
        input: this.history as any,
        stream: true
      }, { signal });
      let result = '';
      for await (const s of stream) {
        if (s.type === 'response.output_text.delta') {
          result = '' + result + s.delta;
          onOutput(s.delta);
        }
      }
      signal?.throwIfAborted();
      this.history.push({
        role: 'assistant',
        content: result
      });
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  public async vectorize(text: string, model: (string & {}) | OpenAI.Embeddings.EmbeddingModel): Promise<number[]> {
    try {
      const embedding = await this.client.embeddings.create({
        model,
        input: text,
        encoding_format: 'float'
      });
      return embedding.data[0].embedding;
    } catch (err) {
      console.log(err);
      throw err;
    }
  }
}
