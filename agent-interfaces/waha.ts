import express, { Express, Request, Response, Router } from "express";
import { AgentTool, AgentType } from "../utility/tools";
import { setTimeout } from "node:timers/promises";
import cors from 'cors';
import { GenericLLM } from "../generic-llm";
import axios from "axios";

export interface AgentWAHAConfig {
  llm: GenericLLM

  // alternative value if undefined -> process.env.WAHA_CONFIG_BASEURL & WAHA_CONFIG_APIKEY
  WAHAConfig?: {
    baseUrl: string
    apiKey: string
  }

  // [REF-CONFIG-6]
  // WAHA requires a callback/webhook to send their notification to WAHA's consumer app
  // This callback port will assigned as standalone HTTP server running on callback port
  // with callback full url `http://<local ip>:<callback-port>/waha`
  callbackPort?: number
  
  timeout?: number

  // read [REF-CONFIG-3]
  errorMessage?: (err: any) => Promise<string>

  // read [REF-CONFIG-4]
  timeoutMessage?: string
}
export function startAgentWAHA(agent: AgentType, config: AgentWAHAConfig) {
  const agents: {[key: string]: AgentTool} = {};
  const agents_abort_controller: {[key: string]: AbortController} = {};
  const waha_config = config.WAHAConfig ?? {
    baseUrl: process.env.WAHA_CONFIG_BASEURL || '',
    apiKey: process.env.WAHA_CONFIG_APIKEY || '',
  };

  if (!waha_config.baseUrl || !waha_config.apiKey) {
    console.error(`WAHA config incomplete, WAHA is not running.`);
    return null;
  }

  const app: Express = express();
  app.use(cors());
  app.use(express.json());
  app.post('/waha', async (req: Request, res: Response) => {
    const data: WAHABody = req.body;
    switch (data.event) {
      case "message.any":
        if (!data.payload.fromMe) {
          break;
        }
        if (!/^\/[a-zA-Z0-9]+\./.test(data.payload.body)) {
          break;
        }
      case "message":
        const message = data.payload.body;
        const is_from_me = data.payload.fromMe && /^\/[a-zA-Z0-9]+\./.test(message);

        // [REF-OPS-10]
        // As per the latest WAHA documentation, user valid destination (from) must be a phone number with ending "@c.us"
        // In some cases `from` item contains lid not phone number, I have to retrieve the phone number with WAHA lid api
        let from: string = '';
        if (is_from_me) {
          const to = data.payload.to || data.payload._data.Info.RecipientAlt.replace('s.whatsapp.net', 'c.us');
          from = to.endsWith('@c.us') ? to : await getPN(to, waha_config.baseUrl, waha_config.apiKey)
        } else {
          from = data.payload.from.endsWith('@c.us') ? data.payload.from : await getPN(data.payload.from, waha_config.baseUrl, waha_config.apiKey);
        }
        let output_temp = '';

        // [REF-OPS-11]
        // I introduce a delay before mark seen and typing indicator to make it more natural like human open A whatsapp
        await setTimeout(500);


        if (agents[from]) {

          // -- EXISTING CONVERSATION --

          if (!agents[from].waha_disable_seen_and_typing) {

            // read [REF-OPS-12]
            await WAHATools.markSeen(from, waha_config.baseUrl, waha_config.apiKey);
            await WAHATools.indicatorStartTyping(from, waha_config.baseUrl, waha_config.apiKey);
          }

          // read [REF-OPS-3]
          if (agents_abort_controller[from] && !agents_abort_controller[from].signal.aborted) {
            agents_abort_controller[from].abort();
            delete agents_abort_controller[from];
          }
          
          agents_abort_controller[from] = new AbortController();
          agents[from].abort_signal = agents_abort_controller[from].signal;
          agents[from].is_last_waha_message_from_me = is_from_me;
          agents[from].setOutput(async (result: string, finish?: boolean, exit?: boolean) => {

            // read [REF-OPS-8]
            output_temp = '' + output_temp + result;

            if (finish) {
              if (!agents[from].waha_disable_seen_and_typing) {
                
                // [REF-OPS-13]
                // This behavior also to prevent spam detection even though no evidence this will works or not
                // stop typing and add delay before sending answer
                await WAHATools.indicatorStopTyping(from, waha_config.baseUrl, waha_config.apiKey);
              }

              await setTimeout(500);
              await WAHATools.sendMessage(from, output_temp, waha_config.baseUrl, waha_config.apiKey);
              if (exit) {
                output_temp = '';
                delete agents[from];
              } else {
                output_temp = '';
              }
              delete agents_abort_controller[from];
              return;
            }
          });
          agents[from].setUserMessage(message);
        } else {

          // -- NEW CONVERSATION --

          // [REF-OPS-12]
          // Mark seen is required to prevent spam behavior (I read this on WAHA documentation but forget which one)
          // To add more natural behavior, I add typing indicator
          await WAHATools.markSeen(from, waha_config.baseUrl, waha_config.apiKey);
          await WAHATools.indicatorStartTyping(from, waha_config.baseUrl, waha_config.apiKey);

          const llm = config.llm.clone();
          const ac = new AbortController();
          const new_agent = new AgentTool({
            llm, 
            mode: 'managed', 
            input_abort_signal: ac.signal,
            source: {
              type: 'whatsapp-waha',
              from_user: {
                pn: from,
                name: data.payload._data.notifyName || ''
              },
              initial_message: message
            },
            timeout: {
              duration: config.timeout,
              async onTimeout() {
                if (config.timeoutMessage) {
                  if (!agents[from].waha_disable_seen_and_typing) {

                    // read [REF-OPS-13]
                    await WAHATools.indicatorStopTyping(from, waha_config.baseUrl, waha_config.apiKey);
                  }
                  await setTimeout(500);
                  await WAHATools.sendMessage(from, config.timeoutMessage, waha_config.baseUrl, waha_config.apiKey);
                }
                delete agents[from];
              }
            },
            error: {
              async onError(err: any) {
                if (config.errorMessage) {
                  if (!agents[from].waha_disable_seen_and_typing) {

                    // read [REF-OPS-13]
                    await WAHATools.indicatorStopTyping(from, waha_config.baseUrl, waha_config.apiKey);
                  }

                  await setTimeout(500);
                  await WAHATools.sendMessage(from, await config.errorMessage(err), waha_config.baseUrl, waha_config.apiKey);
                }
                delete agents[from];
              }
            }
          });
          agents[from] = new_agent;
          agents[from].is_last_waha_message_from_me = is_from_me;
          new_agent.setOutput(async (result: string, finish?: boolean) => {
            
            // read [REF-OPS-8]
            output_temp = '' + output_temp + result;

            if (finish) {
              if (!agents[from].waha_disable_seen_and_typing) {

                // read [REF-OPS-13]
                await WAHATools.indicatorStopTyping(from, waha_config.baseUrl, waha_config.apiKey);
              }

              await setTimeout(500);
              await WAHATools.sendMessage(from, output_temp, waha_config.baseUrl, waha_config.apiKey);
              output_temp = '';
              delete agents_abort_controller[from];
              return;
            }
          });
          setImmediate(() => agent(new_agent).catch(console.error));
        }
        break;

      case "session.status":

        // debugging purpose only
        const status = data.payload.status;
        console.log({ status });
        break;

      default:
        console.log(`Unknown response`);
        break;
    }
    res.status(200).send('OK');
  });

  // this http server purpose only for WAHA callback
  const port = config.callbackPort || process.env.WAHA_CALLBACK_PORT || 65000;
  app.listen(port);
  console.log(`WAHA callback server is listening on port ${port}`);
}

async function getPN(lid: string, baseURL: string, apiKey: string): Promise<string> {
  try {
    const res = await axios.get<WAHALidDetail>(`/api/default/lids/${lid}`, {
      baseURL,
      headers: { 'X-Api-Key': apiKey }
    });
    return res.data.pn;
  } catch (err: any) {
    throw new Error(err?.response?.data?.toString());
  }
}

export namespace WAHATools {
  export async function markSeen(pn: string, baseURL: string, apiKey: string): Promise<string> {
    try {
      const res = await axios.post(`/api/sendSeen`, {
        session: "default",
        chatId: pn
      }, {
        baseURL,
        headers: { 'X-Api-Key': apiKey }
      });
      return res.data.pn;
    } catch (err: any) {
      throw new Error(err?.response?.data?.toString());
    }
  }

  export async function indicatorStartTyping(pn: string, baseURL: string, apiKey: string): Promise<string> {
    try {
      const res = await axios.post(`/api/default/presence`, {
        presence: "typing",
        chatId: pn
      }, {
        baseURL,
        headers: { 'X-Api-Key': apiKey }
      });
      return res.data.pn;
    } catch (err: any) {
      throw new Error(err?.response?.data?.toString());
    }
  }
  export async function indicatorStopTyping(pn: string, baseURL: string, apiKey: string): Promise<string> {
    try {
      const res = await axios.post(`/api/default/presence`, {
        presence: "paused",
        chatId: pn
      }, {
        baseURL,
        headers: { 'X-Api-Key': apiKey }
      });
      return res.data.pn;
    } catch (err: any) {
      throw new Error(err?.response?.data?.toString());
    }
  }

  export async function sendMessage(pn: string, message: string, baseURL: string, apiKey: string): Promise<string> {
    try {
      const res = await axios.post(`/api/sendText`, {
        session: "default",
        chatId: pn,
        text: message
      }, {
        baseURL,
        headers: { 'X-Api-Key': apiKey }
      });
      return res.data.pn;
    } catch (err: any) {
      throw new Error(err?.response?.data?.toString());
    }
  }

  export async function getContact(pn: string, baseURL: string, apiKey: string): Promise<Contact> {
    try {
      const res = await axios.get<Contact>(`/contacts?contactId=${pn}&session=default`, {
        baseURL,
        headers: { 'X-Api-Key': apiKey }
      });
      return res.data;
    } catch (err: any) {
      throw new Error(err?.response?.data?.toString());
    }
  }

  export async function checkIsInContact(pn: string, baseURL: string, apiKey: string): Promise<boolean> {
    const contact = await getContact(pn, baseURL, apiKey);
    return contact.name.length > 0;
  }
}

interface Contact {
  id: string
  name: string
  pushname: string
}

interface WAHASessionStatus {
  id: string
  timestamp: number
  event: 'session.status'
  session: 'default'
  me: { id: string, pushName: string }
  payload: {
    name: 'default',
    status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'FAILED' | 'WORKING'
    statuses: any[]
  },
  engine: string
}

interface WAHAMessage {
  id: string
  timestamp: number
  event: 'message'
  session: 'default'
  me: { id: string, pushName: string }
  payload: {
    id: string
    timestamp: number
    from: string
    fromMe: boolean
    source: 'app'
    to: string
    body: string // actual message
    hasMedia: boolean
    media: any
    ack: number
    ackName: 'SERVER'
    location: any
    vCards: any[]
    _data: {
      Info: {
        Chat: string // '249000779366526@lid',
        Sender: string // '134471936385049@lid',
        IsFromMe: boolean
        IsGroup: boolean
        AddressingMode: string // '',
        SenderAlt: string // '',
        RecipientAlt: string // '6281214338487@s.whatsapp.net',
        BroadcastListOwner: string // '',
        BroadcastRecipients: any
        ID: string // 'AC5FFC089D63664D46E7D2780DDA343C',
        ServerID: number
        Type: string // 'text',
        PushName: string // 'SWAN: AI Agent Ecosystem',
        Timestamp: string // '2026-04-20T05:04:30Z',
        Category: string // '',
        Multicast: boolean
        MediaType: string // '',
        Edit: string // '',
        MsgBotInfo: any[]
        MsgMetaInfo: any[]
        VerifiedName: any
        DeviceSentMeta: any[]
      }
      Message: { conversation: string, messageContextInfo: any[] }
      IsEphemeral: boolean
      IsViewOnce: boolean
      IsViewOnceV2: boolean
      IsViewOnceV2Extension: boolean
      IsDocumentWithCaption: boolean
      IsLottieSticker: boolean
      IsBotInvoke: boolean
      IsEdit: boolean
      SourceWebMsg: any
      UnavailableRequestID: string
      RetryCount: number
      NewsletterMeta: any
      RawMessage: { deviceSentMessage: any[], messageContextInfo: any[] }
      Status: number
      notifyName?: string
    }
  }
  engine: string
}

interface WAHAMessageAny {
  id: string
  timestamp: number
  event: 'message.any'
  session: 'default'
  me: { id: string, pushName: string }
  payload: {
    id: string
    timestamp: number
    from: string
    fromMe: boolean
    source: 'app'
    to: string
    body: string // actual message
    hasMedia: boolean
    media: any
    ack: number
    ackName: 'SERVER'
    location: any
    vCards: any[]
    _data: {
      Info: {
        Chat: string // '249000779366526@lid',
        Sender: string // '134471936385049@lid',
        IsFromMe: boolean
        IsGroup: boolean
        AddressingMode: string // '',
        SenderAlt: string // '',
        RecipientAlt: string // '6281214338487@s.whatsapp.net',
        BroadcastListOwner: string // '',
        BroadcastRecipients: any
        ID: string // 'AC5FFC089D63664D46E7D2780DDA343C',
        ServerID: number
        Type: string // 'text',
        PushName: string // 'SWAN: AI Agent Ecosystem',
        Timestamp: string // '2026-04-20T05:04:30Z',
        Category: string // '',
        Multicast: boolean
        MediaType: string // '',
        Edit: string // '',
        MsgBotInfo: any[]
        MsgMetaInfo: any[]
        VerifiedName: any
        DeviceSentMeta: any[]
      }
      Message: { conversation: string, messageContextInfo: any[] }
      IsEphemeral: boolean
      IsViewOnce: boolean
      IsViewOnceV2: boolean
      IsViewOnceV2Extension: boolean
      IsDocumentWithCaption: boolean
      IsLottieSticker: boolean
      IsBotInvoke: boolean
      IsEdit: boolean
      SourceWebMsg: any
      UnavailableRequestID: string
      RetryCount: number
      NewsletterMeta: any
      RawMessage: { deviceSentMessage: any[], messageContextInfo: any[] }
      Status: number
      notifyName?: string
    }
  }
  engine: string
}

type WAHABody = WAHAMessage | WAHAMessageAny | WAHASessionStatus;

interface WAHALidDetail {
  lid: string
  pn: string // actual pn
}
