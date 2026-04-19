import { OpenAILLM } from "../llm-providers/openai-llm";
import { loop } from "../utility/loop";
import { startAgentServer } from "../agent-interfaces/server";
import { startAgentTelegram } from "../agent-interfaces/telegram";
import { AgentTool } from "../utility/tools";

export async function agent(at: AgentTool) {
  console.log(at.source);
  const name = process.env.NAME || 'ABC Agent';
  await at.prepareKnowledge(`Your name is ${name}.`);
  await at.prepareKnowledge(process.env.AGENT_BRIEF || 'Jawab pertanyaan/request user seperti anak SD kelas 1 minimal 5 kalimat');
  await at.prepareKnowledge(`Current date and time: ${new Date().toISOString()}`);

  // Initial greetings
  at.print(`Hi there my name is ${name}, may I help you?`, true);
  
  // Main loop
  await loop(async () => {
    const instruction = await at.waitForUserInstruction();
    await at.streamLLM(
      `User request: "${instruction}". Respond user request based on given knowledge.`,
      (s: string) => at.print(s)
    );
    at.print('', true);
  });
}

// startAgentServer(agent, {
//   llm: new OpenAILLM(),
// });
// startAgentTelegram(agent, {
//   llm: new OpenAILLM(),
// });
