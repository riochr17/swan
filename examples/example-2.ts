require('dotenv').config();
import z from "zod";
import { AgentTool } from "../utility/tools";
import { loop } from "../utility/loop";
import { startAgentCLI } from "../agent-interfaces/cli";
import { OpenAILLM } from "../llm-providers/openai-llm";
import { startAgentServer } from "../agent-interfaces/server";
import { setTimeout } from "timers/promises";

export async function sqrt(at: AgentTool) {
  at.print(`Hi I am math agent, how can I help you?`, true);
  const instruction = await at.waitForUserInstruction();
  const answer = await at.askLLM(`Solve this math problem and return number answer: ${instruction}`, z.number());
  at.exit(String(answer));
}

export async function agent(at: AgentTool) {
  await at.prepareKnowledge('You are a helpful assistant collecting user data.');
  await at.prepareKnowledge(
    `Questionnaire Format (all required data): name, email, phone number
    Your task is to collect data from the user based on the questionnaire format above
    in the correct order (order matters). The user may provide data in any order.`
  );
  
  // Greetings
  at.print('> Hi please provide your name, email, and phone number please, thank you', true);

  // Main loop
  await loop(async () => {
    // Wait for user instruction
    const has_complete_data: boolean = await at.askLLM(
      `Has the user provided all required data for the questionnaire?`, 
      z.boolean()
    );
    if (has_complete_data) {
      const data: string[] = await at.askLLM(
        `Extract the latest data provided by the user in the correct order 
        based on the required format. Return the result as an array of strings. 
        For optional fields, return an empty string.`, 
        z.array(z.string())
      );
      const math_problem = await at.askUser(`Give me a math problem!`);
      await at.askOtherAgent(sqrt, [
        'I am assigning you to the math agent now',
        `Ask the math agent to solve user math problem: ${math_problem}`,
        'Dont solve the math but ask the math agent instead'
      ]);
      // await at.askOtherAgent2('http://localhost:10000', [
      //   'I am assigning you to the math agent now',
      //   `Ask the math agent to solve user math problem: ${math_problem}`,
      //   'Just dont solve the math, ask the math agent instead'
      // ]);
      const response = await at.askLLM(`tell the user answer you have from the math agent`);
      at.exit(response);
      return;
    } else {
      const instruction = await at.waitForUserInstruction();
      const res = await at.askLLM(
        `User response: "${instruction}", now respond the user`
      );
      at.print(`> ${res}`, true);
    }
  });
  console.log(at.llm.history);
}

// startAgentServer(sqrt, {
//   llm: new OpenAILLM(),
//   port: 10000
// })

// startAgentCLI(agent, {
//   llm: new OpenAILLM()
// });
