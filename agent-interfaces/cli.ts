import { GenericLLM } from "../generic-llm";
import { AgentTool, AgentType } from "../utility/tools";

export interface AgentCLIConfig {
  llm: GenericLLM
}
export async function startAgentCLI(agent: AgentType, config: AgentCLIConfig) {
  const llm = config.llm.clone();
  const agent_tool = new AgentTool({
    llm,
    input_abort_signal: new AbortController().signal,
    source: { type: 'cli' },
    mode: 'cli'
  });
  await agent(agent_tool);
}
