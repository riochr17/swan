import TelegramBot from "node-telegram-bot-api";
import { AgentTool, AgentType } from "../utility/tools";
import { GenericLLM } from "../generic-llm";

export interface AgentTelegramConfig {
  llm: GenericLLM

  // alternative value if undefined -> process.env.TELEGRAM_BOT_TOKEN
  token?: string

  timeout?: number

  // [REF-CONFIG-3]
  // Message wrapper function triggered when there is an error on agent
  errorMessage?: (err: any) => Promise<string>

  // [REF-CONFIG-4]
  // Message triggered when agent has reach timeout
  timeoutMessage?: string

  // [REF-CONFIG-5]
  // By default telegram bot will start immediately, but if you
  // need to start it manually with bot.startPolling(), set this to true
  manualStart?: boolean
}

export function startAgentTelegram(agent: AgentType, config: AgentTelegramConfig): TelegramBot | null {
  const telegram_bot_token = config.token || process.env.TELEGRAM_BOT_TOKEN;
  if (!telegram_bot_token) {
    console.error(`Telegram bot token is empty, telegram is not running.`);
    return null;
  }

  const bot = new TelegramBot(telegram_bot_token, { polling: true });
  const agents: {[key: number]: AgentTool} = {};
  const agents_abort_controller: {[key: number]: AbortController} = {};

  bot.getMe().then(user => {
    console.log(`Telegram bot is running!`);
    let botUsername = `@${user.username}`;
  
    bot.on("message", async (msg) => {
      const chat_type = msg.chat.type;
      const chat_id = msg.chat.id;
      const text = msg.text ?? msg.caption ?? "";
      let output_temp = '';
      
      if (chat_type !== 'private') {

        // [REF-OPS-5]
        // Telegram group chat only response to chat that mention the bot to prevent spam answers
        if (chat_type === 'group' || chat_type === 'supergroup') {
          if (!text.includes(botUsername)) {
            return;
          }
        }
      }
  
      if (agents[chat_id]) {
        
        // -- EXISTING CONVERSATION --

        // [REF-OPS-6]
        // This is similar to [REF-OPS-3]
        if (agents_abort_controller[chat_id] && !agents_abort_controller[chat_id].signal.aborted) {
          agents_abort_controller[chat_id].abort();
          delete agents_abort_controller[chat_id];
        }
        
        agents_abort_controller[chat_id] = new AbortController();
        agents[chat_id].abort_signal = agents_abort_controller[chat_id].signal;

        // [REF-OPS-7]
        // Send typing indicator to user when start processing answer
        bot.sendChatAction(chat_id, "typing");

        agents[chat_id].setOutput(async (result: string, finish?: boolean, exit?: boolean) => {

          // [REF-OPS-8]
          // Accumulate all chunk answer from LLM, then send as a full answer to user
          output_temp = '' + output_temp + result;

          // finish means response is complete and answer is ready
          if (finish) {

            // [REF-OPS-9]
            // send answer to user telegram but ignoring any error
            // this is also a temporary solution, I need to fix this later
            try {
              await bot.sendMessage(chat_id, output_temp);
            } catch {}

            // read [REF-TOOLS-1]
            if (exit) {
              output_temp = '';
              delete agents[chat_id];
            } else {
              output_temp = '';
            }
            delete agents_abort_controller[chat_id];
            return;
          }
        });

        // supply user chat to the agent
        agents[chat_id].setUserMessage(text);
      } else {

        // -- NEW CONVERSATION --

        const llm = config.llm.clone();
        const ac = new AbortController();
        const new_agent = new AgentTool({
          llm, 
          mode: 'managed', 
          input_abort_signal: ac.signal,
          source: {
            type: 'telegram',
            from_user: msg.from
          },
          timeout: {
            duration: config.timeout,
            async onTimeout() {
              if (config.timeoutMessage) {
                await bot.sendMessage(chat_id, config.timeoutMessage);
              }
              delete agents[chat_id];
            }
          },
          error: {
            async onError(err: any) {
              if (config.errorMessage) {
                await bot.sendMessage(chat_id, await config.errorMessage(err))
              }
              delete agents[chat_id];
            }
          }
        });
        agents[chat_id] = new_agent ;
        agents_abort_controller[chat_id] = ac;
  
        new_agent.setOutput(async (result: string, finish?: boolean) => {
          output_temp = '' + output_temp + result;
          if (finish) {
            await bot.sendMessage(chat_id, output_temp);
            output_temp = '';
            delete agents_abort_controller[chat_id];
            return;
          }
        });
        setImmediate(() => agent(new_agent).catch(console.error).finally(() => delete agents[chat_id]));
      }
    });
  }).catch(console.error);

  if (config.manualStart) {
    console.log(`Stopping bot config.manualStart is true, run bot.startPolling() to start`)
    bot.stopPolling().then(() => console.log(`Bot stopped`)).catch(console.error);
  }

  return bot;
}
