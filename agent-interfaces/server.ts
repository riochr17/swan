import express, { Express, Request, Response, Router } from "express";
import { AgentTool, AgentType } from "../utility/tools";
import { v4 } from "uuid";
import cors from 'cors';
import { GenericLLM } from "../generic-llm";

// [REF-CONFIG-1]
// this is a temporary solution how to detect end of conversation at the 
// end of stream response on Agent to Agent conversation use case
export const A2A_HTTP_SERVER_TERMINATION_KEYWORD = '[[[END]]]';

export interface AgentServerConfig {
  port?: number
  llm: GenericLLM
  timeout?: number

  // [REF-CONFIG-2]
  // by default I assign cors default to any origin
  // if you need to custom your express engine configuration,
  // then you must provide your cors middleware.
  expressConfig?: (app: Express) => void
}

export async function startAgentServer(agent: AgentType, config: AgentServerConfig) {
  const agents: {[key: string]: AgentTool} = {};
  const agents_abort_controller: {[key: string]: AbortController} = {};

  const app: Express = express();
  app.use(express.json());
  if (config.expressConfig) {
    config.expressConfig(app);
  } else {
    app.use(cors());
  }

  app.get('/start', async (req: Request, res: Response) => {

    // -- NEW CONVERSATION --

    // [REF-OPS-1]
    // This abort controller is placed on the agent to prevent multiple
    // response from agent when user typing chat bubbles more than once.
    // Objective: when user types more than one conversation while agent
    // still working on answer then agent can cancelled/aborted its
    // last processing and begin a new process from the latest conversation
    // (which still persist the conversation history)
    const ac = new AbortController();

    const llm = config.llm.clone();
    const id = v4();
    const new_agent = new AgentTool({
      llm,
      mode: 'managed',
      input_abort_signal: ac.signal,
      source: {
        type: 'rest-api',
        id
      },
      timeout: {
        duration: config.timeout,
        async onTimeout() {
          delete agents[id];
        }
      },
      error: {
        async onError() {
          delete agents[id];
        }
      }
    });
    agents[id] = new_agent;
    agents_abort_controller[id] = ac;

    // [REF-OPS-2]
    // I need this header to expose convesation-id to browser
    // browser is very strict on headers policy
    res.header('Access-Control-Expose-Headers', 'conversation-id');
    res.header('conversation-id', id);

    console.log(`[managed] Start session id = ${id}`);
    new_agent.setOutput((result: string, finish?: boolean) => {
      res.write(result);
      if (finish) {
        res.end();
        delete agents_abort_controller[id];
        return;
      }
    });

    setImmediate(() => agent(new_agent).catch(console.error).finally(() => delete agents[id]));
  });
  app.post('/conversation/:id', async (req: Request, res: Response) => {

    // -- EXISTING CONVERSATION --

    const id = req.params.id as string;
    if (!id || !agents[id]) {
      res.status(404).send('No agents found');
      return;
    }

    // [REF-OPS-3]
    // If agents abort controlled still in memory and not aborted 
    // then the last processing answer is on working
    // This processing should be cancelled and begin new processing with new context
    if (agents_abort_controller[id] && !agents_abort_controller[id].signal.aborted) {
      agents_abort_controller[id].abort();
      delete agents_abort_controller[id];
    }

    // [REF-OPS-4]
    // I place a new abort controller with same reason like on [REF-OPS-1]
    agents_abort_controller[id] = new AbortController();
    agents[id].abort_signal = agents_abort_controller[id].signal;
    agents[id].setOutput((result: string, finish?: boolean, exit?: boolean) => {
      res.write(result);
      if (finish) {
        if (exit) {
          res.end(A2A_HTTP_SERVER_TERMINATION_KEYWORD);
          console.log(`[managed] End of session id = ${id}`);
        } else {
          res.end();
        }
        delete agents_abort_controller[id];
        return;
      }
    });
    agents[id].setUserMessage(req.body.msg);
  });

  const port = config.port || 9811;
  app.listen(port);
  console.log(`Agents is listening on port ${port}`);
}
