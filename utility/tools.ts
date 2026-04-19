// TODO: add docs

import { prompt } from "enquirer";
import z from "zod";
import { setTimeout } from 'timers/promises';
import { v4 } from "uuid";
import { A2A_HTTP_SERVER_TERMINATION_KEYWORD } from "../agent-interfaces/server";
import axios, { AxiosResponse } from "axios";
import { GenericLLM, StreamFn } from "../generic-llm";
import TelegramBot from "node-telegram-bot-api";

export type IOMode = 'cli' | 'managed';

// [REF-TOOLS-1]
// out -> string response / chunk response
// finish -> flush the response (like in http request), indicator response is complete and ready to send
// exit -> exit the agent loop
export type StdoutFn = (out: string, finish?: boolean, exit?: boolean) => void;
export class TerminationError extends Error {};
export class TerminationTimeout extends Error {};
export class TerminationSuccess extends Error {};

export interface AgentToolExtraInformationCLI {
  type: 'cli'
}
export interface AgentToolExtraInformationRESTAPI {
  type: 'rest-api'
  id: string
}
export interface AgentToolExtraInformationTelegram {
  type: 'telegram'
  from_user?: TelegramBot.User
  initial_message?: string
}
export interface AgentToolExtraInformationWhatsAppWAHA {
  type: 'whatsapp-waha',
  from_user: {
    pn: string
    name: string
  }
  initial_message?: string
}
export interface AgentToolExtraInformationSocketIO {
  type: 'socket-io'
}

export type AgentToolExtraInformation = AgentToolExtraInformationCLI
  | AgentToolExtraInformationRESTAPI
  | AgentToolExtraInformationTelegram
  | AgentToolExtraInformationWhatsAppWAHA
  | AgentToolExtraInformationSocketIO;

export interface AgentToolConfig {
  llm: GenericLLM
  mode?: IOMode
  input_abort_signal: AbortSignal
  source: AgentToolExtraInformation
  error?: {
    onError(err: any): Promise<void>
  }
  timeout?: {
    duration?: number
    onTimeout(): Promise<void>
  }
}

export type AgentType = (at: AgentTool) => Promise<void>;
export class AgentTool {
  public io_mode: 'cli' | 'managed' = 'cli';
  public session_id = v4();
  public timeout_ms: number = 120 * 1000;
  public termination_keywords: string[] = [];
  private user_message: string = '';
  private stdout: StdoutFn | undefined;
  private onTimeout: (() => Promise<void>) | undefined;
  private onError: ((err: any) => Promise<void>) | undefined;
  public llm: GenericLLM;
  public abort_signal: AbortSignal;
  public waha_disable_seen_and_typing: boolean = false;
  public is_last_waha_message_from_me: boolean = false;

  public source: AgentToolExtraInformation;

  constructor(config: AgentToolConfig) {
    this.llm = config.llm;
    this.source = config.source;
    this.io_mode = config.mode ?? this.io_mode;
    this.abort_signal = config.input_abort_signal;
    if (config.timeout) {
      this.timeout_ms = config.timeout.duration || this.timeout_ms;
      this.onTimeout = config.timeout.onTimeout;
    }
    if (config.error) {
      this.onError = config.error.onError;
    }
  }

  public setUserMessage(msg: string) {
    this.user_message = msg;
  }

  public setOutput(stdout: StdoutFn) {
    this.stdout = stdout;
  }

  print(q: string, finish?: boolean) {
    if (this.io_mode == 'cli') {
      process.stdout.write(q);
      if (finish) {
        console.log('');
      }
    } else {
      if (this.stdout) {
        this.stdout(q, finish);
        return;
      }
      throw new Error(`Agent with mode = managed must provides stdout function.`);
    }
  }

  exit(q: string) {
    if (this.io_mode == 'cli') {
      process.stdout.write(q);
      process.stdout.write('\n');
    } else {
      if (this.stdout) {
        this.stdout(q, true, true);
      } else {
        throw new Error(`Agent with mode = managed must provides stdout function.`);
      }
    }
    throw new TerminationSuccess();
  }

  async waitForUserInstruction(): Promise<string> {
    if (this.io_mode === 'cli') {
      const answers: { prompt: string } = await prompt([{
        type: "input",
        name: "prompt",
        message: '',
      }]);
      if (this.termination_keywords.includes(answers.prompt)) {
        const err = new TerminationError();
        this.onError?.(err);
        throw err;
      }
      return answers.prompt;
    } else {
      try {
        let i = 0;
        const inc_value = 1000;
        while (!this.user_message) {
          i += inc_value;
          if (i > this.timeout_ms) {
            this.onTimeout?.();
            throw new TerminationTimeout();
          }
          await setTimeout(inc_value);
        }
        if (this.termination_keywords.includes(this.user_message)) {
          const err = new TerminationError();
          this.onError?.(err);
          throw err;
        }
        return this.user_message;
      } finally {
        this.user_message = '';
      }
    }
  }

  async askUser(q: string): Promise<string> {
    if (this.io_mode === 'cli') {
      const answers: { prompt: string } = await prompt([{
        type: "input",
        name: "prompt",
        message: q,
      }]);
      if (this.termination_keywords.includes(answers.prompt)) {
        const err = new TerminationError();
        this.onError?.(err);
        throw err;
      }
      return answers.prompt;
    } else {
      try {
        this.print(q, true);
        let i = 0;
        const inc_value = 1000;
        while (!this.user_message) {
          i += inc_value;
          if (i > this.timeout_ms) {
            this.onTimeout?.();
            throw new TerminationTimeout();
          }
          await setTimeout(1000);
        }
        if (this.termination_keywords.includes(this.user_message)) {
          const err = new TerminationError();
          this.onError?.(err);
          throw err;
        }
        return this.user_message;
      } finally {
        this.user_message = '';
      }
    }
  }

  async askLLM<T = string>(q: string, type?: z.ZodTypeAny<T>): Promise<T> {
    const l = this.startLoading();
    try {
      if (!type) {
        return await this.llm.askLLM(q, undefined, this.abort_signal);
      }
      const res = await this.llm.askLLM(q, z.object({ answer: type }), this.abort_signal);
      try {
        const result = await z.parse(type, res.answer);
        return result;
      } catch(error){
        if (error instanceof z.ZodError){
          // this.removeLoading(l);
          return await this.askLLM(`There is an error on your response: ${error.message}, please fix and return correct answer`, type);
        }
        throw new Error(`something when wrong ${error?.toString()}`);
      }
    } finally {
      // this.removeLoading(l);
    }
  }

  async streamLLM(q: string, onOutput: StreamFn) {
    const l = this.startLoading();
    await this.llm.streamLLM(q, onOutput, this.abort_signal);
  }

  async prepareKnowledge(knowledge: string) {
    this.llm.addKnowledge(knowledge);
  }

  async addInformation(info: string) {
    this.llm.addInformation(info);
  }

  async askOtherAgent(other_agent: AgentType, instructions: string[]) {
    for (const ins of instructions) {
      await this.addInformation(ins);
    }
    const java_at = new AgentTool({
      llm: this.llm.clone(), 
      source: this.source,
      input_abort_signal: this.abort_signal,
      mode: 'managed'
    });
    let temp_java_agent_answer = '';
    java_at.setOutput(async (o, finish, exit) => {
      temp_java_agent_answer = '' + temp_java_agent_answer + o;
      if (finish) {
        if (exit) {
          await this.addInformation(`[Agent Response]: ${temp_java_agent_answer}`);
        } else {
          const main_agent_response = await this.askLLM(`[Agent Response]: ${temp_java_agent_answer}`, z.string());
          temp_java_agent_answer = '';
          java_at.setUserMessage(main_agent_response);
        }
      }
    });
    try {
      await other_agent(java_at);
    } catch (err) {
      console.log(err);
    }
  }

  async askOtherAgent2(agent_base_url: string, instructions: string[]) {
    const decoder = new TextDecoder("utf-8");
    for (const ins of instructions) {
      await this.addInformation(ins);
    }
    await this.addInformation(`Every user prompt starts with "[Agent Response]: " is other agent response, you should able to distinct between user instruction and other agent response`);
    try {
      const conversation: AxiosResponse<string> = await axios.get('/start', {
        baseURL: agent_base_url
      });
      let temp_agent_answer: string = conversation.data;
      while (true) {
        const main_agent_response = await this.askLLM(`[Agent Response]: ${temp_agent_answer}`, z.string());

        try {
          const response = await axios.post(`/conversation/${conversation.headers['conversation-id']}`, { msg: main_agent_response }, {
            responseType: 'stream',
            adapter: 'fetch',
            baseURL: agent_base_url
          });
          const reader = response.data.getReader();
          let complete_msg = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            complete_msg = '' + complete_msg + chunk;
          }
          temp_agent_answer = complete_msg;
        } catch (err: any) {
          if (err?.response?.status == 404) {
            break;
          }
          throw err;
        }

        if (temp_agent_answer.endsWith(A2A_HTTP_SERVER_TERMINATION_KEYWORD)) {
          await this.addInformation(`[Agent Response]: ${temp_agent_answer.replace(A2A_HTTP_SERVER_TERMINATION_KEYWORD, '')}`)
          break;
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Initially I create a loading spinner, but remove it now since it looks ugly on terminal
  // Need to fix this later
  startLoading() {
    console.log('Loading...');
    // const spinner = ['|', '/', '-', '\\'];
    // let i = 0;
    // return setInterval(() => {
    //   process.stdout.write('\rTalking to AI ' + spinner[i++ % spinner.length]);
    // }, 100);
  }

  removeLoading(l: NodeJS.Timeout) {
    // clearInterval(l);
    // process.stdout.clearLine(0);
    // process.stdout.cursorTo(0);
  }
}
