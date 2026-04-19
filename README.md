# SWAN Framework

SWAN Framework is an unopinionated library designed to create powerful AI Agents using TypeScript. It abstracts away the heavy lifting of prompting and interfacing, allowing developers to craft agents that can independently run or communicate with other agents.

A distinct feature of the SWAN Framework is its **multichannel compatibility**. An agent written once can be easily plugged into multiple interfaces:
- Command-Line Interface (CLI)
- REST API (Express)
- Telegram Bot
- WhatsApp via WAHA
- (More coming soon!)

## Table of Contents
- [Quick Example](#quick-example)
- [Installation](#installation)
- [Overview](#overview)
- [Configuring LLM Providers](#configuring-llm-providers)
  - [Google GenAI](#google-genai)
  - [OpenAI](#openai)
- [Core Agent API (\`AgentTool\`)](#core-agent-api-agenttool)
  - [1. Simple Output and Input](#1-simple-output-and-input)
  - [2. Asking the LLM (with Zod Strict Typing)](#2-asking-the-llm-with-zod-strict-typing)
  - [3. Streaming the LLM Output](#3-streaming-the-llm-output)
  - [4. Provide System Prompts and Knowledges](#4-provide-system-prompts-and-knowledges)
  - [5. Multi-Agent Collaboration](#5-multi-agent-collaboration)
- [Exposing Your Agent to the World](#exposing-your-agent-to-the-world)
  - [1. Interacting via CLI](#1-interacting-via-cli)
  - [2. Running as an HTTP REST API](#2-running-as-an-http-rest-api)
  - [3. Telegram Bot](#3-telegram-bot)
  - [4. WhatsApp WAHA](#4-whatsapp-waha)
- [Agent Lifecycle and Exceptions](#agent-lifecycle-and-exceptions)
- [Publishing Your Agent](#publishing-your-agent)
  - [1. Preparation (\`package.json\`)](#1-preparation-packagejson)
  - [2. Authentication](#2-authentication)
  - [3. Publishing](#3-publishing)
  - [4. Post-Publish Configuration](#4-post-publish-configuration)

## Quick Example

Here is a glimpse of how simple and powerful it is to build an agent using the SWAN Framework:

```typescript
import { AgentTool, startAgentCLI, GoogleGenAILLM, loop } from "@ssww.one/framework";
import z from "zod";

// 1. Define your AI Agent function
async function mathAgent(at: AgentTool) {
  at.print("I'm a math agent! Ask me anything.", true);

  // Agent loop to keep interaction going
  await loop(async () => {
    const question = await at.waitForUserInstruction();

    // 2. Ask LLM to extract data strictly using Zod schema
    const data = await at.askLLM(
      `Is the user asking a math question? "${question}"`,
      z.object({ isMath: z.boolean() })
    );

    if (data.isMath) {
      // 3. Stream output to the user immediately
      await at.streamLLM(`Solve this math question clearly: ${question}`, (chunk) => {
        at.print(chunk);
      });
      at.print('', true); // Finish line
    } else {
      at.print("I can only answer math questions!", true);
    }
  });
}

// 4. Expose the agent via CLI
startAgentCLI(mathAgent, {
  llm: new GoogleGenAILLM() 
});
```

You need to setup GoogleGenAILLM env variables to make example above works (Read [Google GenAI](#google-genai)).

## Installation

Install the framework using standard NPM:

```bash
npm install @ssww.one/framework zod
```
> **Note**: `zod` is highly recommended since SWAN heavily relies on it to guarantee structured data returned from standard LLMs.


## Overview

At the heart of the SWAN Framework is the `AgentTool` instance, typically provided via a callback when you start your agent runner (CLI, Server, or Telegram). 

An **Agent Function** has this signature:
```typescript
import { AgentTool } from "@ssww.one/framework";

export async function myAgent(at: AgentTool) {
  // Agent loop and logic goes here
}
```

## Configuring LLM Providers

Before running your Agent, you need to instantiate an LLM provider. SWAN provides built-in support for multiple LLMs. If you instantiate the models without passing any parameters, they will automatically attempt to load from standard environment variables.

### Google GenAI
By default, initialized as `new GoogleGenAILLM()`, it assumes the following environment variables:
- `GOOGLE_GENAI_APIKEY`
- `GOOGLE_GENAI_MODEL` (defaults to `gemini-2.5-flash` if unprovided)

```typescript
import { GoogleGenAILLM } from "@ssww.one/framework";

// Automatically uses process.env.GOOGLE_GENAI_APIKEY
const llm = new GoogleGenAILLM(); 

// Or explicitly provide them:
const llmExplicit = new GoogleGenAILLM({
  apiKey: 'your-api-key',
  model: 'gemini-2.5-flash', // Optional
});
```

### OpenAI
By default, initialized as `new OpenAILLM()`, it assumes the following environment variables:
- `CHATGPT_APIKEY`
- `CHATGPT_MODEL` (defaults to `gpt-4o` if unprovided)
- `CHATGPT_ENDPOINT` (optional custom API base URL)

```typescript
import { OpenAILLM } from "@ssww.one/framework";

// Automatically uses process.env.CHATGPT_APIKEY
const llm = new OpenAILLM();

// Or explicitly provide them:
const llmExplicit = new OpenAILLM({
  apiKey: 'your-api-key',
  model: 'gpt-4o',
});
```

## Core Agent API (`AgentTool`)

The injected `AgentTool` (`at`) parameter equips you with various methods to interact with the LLM and the connected user interface.

### 1. Simple Output and Input
Instead of `console.log`, use `at.print()` to output messages. This handles formatting automatically depending on whether the agent is connected via CLI or a chat interface like Telegram.

> **Important:** The second parameter determines when to **flush and close** the response. Passing `true` (e.g., `at.print(msg, true)`) flushes the response stream. In environments like an HTTP request where the response is streamed to the user, hitting `true` on the second parameter immediately closes the request, making the provided string the last response on that request.

```typescript
at.print('Hello! I am your assistant.', true); // Flushes response and ends the line

// Example: Printing multiple strings before flushing
at.print('Here is ');
at.print('a sentence ');
at.print('built in parts.', true); // Flushes the complete buffered text and closes the request
```

To pause execution and wait for the user to type something:
```typescript
const instruction = await at.waitForUserInstruction();
```

To directly ask a question and wait for the answer:
```typescript
const answer = await at.askUser('What is your name?');
```

### 2. Asking the LLM (with Zod Strict Typing)
The `askLLM` method queries the AI. You can optionally pass a Zod schema to magically force the LLM to return structured data. 

**Getting a string back:**
```typescript
const answer = await at.askLLM('What is the capital of France?');
// Output: "Paris"
```

**Getting Typed/Structured output:**
```typescript
import z from "zod";

const isCodingQuestion = await at.askLLM(
  `Is the user instruction "${instruction}" related to coding?`, 
  z.boolean()
);

if (isCodingQuestion) {
   // ...
}
```
If the LLM fails to match your Zod schema, the framework automatically intercepts the Zod Error, sends it back to the LLM, and asks the LLM to correct its own mistake!

### 3. Streaming the LLM Output
If you want to stream chunks of characters immediately (like ChatGPT), use `streamLLM`:
```typescript
await at.streamLLM('Explain quantum mechanics simply', chunk => {
  at.print(chunk); // prints per token without flushing
});
at.print('', true); // Flushes empty string and closes the response stream
```

### 4. Provide System Prompts and Knowledges
Inject system knowledge to steer the behavior of the active conversation session. While both methods append instructions to the LLM's context window, they are treated differently behind the scenes:

- **`prepareKnowledge`**: Use this for core behavior or stable referential facts. Behind the scenes, the framework structures this by wrapping your text under an explicit Markdown heading (`### Knowledge #N`) before pushing it to the LLM's interaction history (as a user prompt). This strongly signals the LLM to prioritize this as foundational context.
- **`addInformation`**: Use this for dynamic, contextual, chronological updates (like sensor reads, the current time, or intermediate calculation results) within the conversational flow. It pushes the raw text directly into the LLM history array as a standard user message without any structural tagging.

```typescript
// Adds structured "### Knowledge #1" header in the LLM's context
await at.prepareKnowledge("You are a helpful IT support agent...");

// Appends "Current server time is: ..." directly to history
await at.addInformation(`Current server time is: ${new Date()}`);
```

### 5. Multi-Agent Collaboration
Agents can spawn sub-agents to divide and conquer specific tasks! SWAN supports delegating logic to another locally defined javascript agent function (`askOtherAgent`), or even remote HTTP-deployed agents (`askOtherAgent2`).

```typescript
// Call an agent running in the same codebase
await at.askOtherAgent(agent_cpp_expert, [
  "You are acting as a user. Ask the C++ expert agent to explain Vectors.",
  "Once you get the information, type /quit to stop the conversation."
]);

// Call an external Agent Server via URL 
await at.askOtherAgent2('http://other-agent-api.com:9999', [
  // instructions ...
]);
```

## Exposing Your Agent to the World

Once you write your `AgentType` function, you can export it to various user interfaces simply by changing the runner.

### 1. Interacting via CLI
The straightforward way to test your agent directly on your terminal.
```typescript
import { startAgentCLI, GoogleGenAILLM } from "@ssww.one/framework";
import { myAgent } from "./my-agent";

startAgentCLI(myAgent, {
  llm: new GoogleGenAILLM()
});
```

### 2. Running as an HTTP REST API
Creating a web-service where each HTTP client can securely converse with your agent (session states are uniquely managed via Request IDs).

```typescript
import { startAgentServer, OpenAILLM } from "@ssww.one/framework";
import { myAgent } from "./my-agent";

startAgentServer(myAgent, {
  llm: new OpenAILLM(),
  port: 9811, // REST API runs on http://localhost:9811
  timeout: 120 * 1000 // 2 minutes inactivity timeout
});
```
- A `GET /start` request initializes the session.
- Client communicates by hitting HTTP POST endpoints streaming data back, perfect for SSE loops!

### 3. Telegram Bot
Connect your agent transparently to Telegram. Users can chat directly with your bot.

```typescript
import { startAgentTelegram, GoogleGenAILLM } from "@ssww.one/framework";
import { myAgent } from "./my-agent";

startAgentTelegram(myAgent, {
  llm: new GoogleGenAILLM(),
  token: process.env.TELEGRAM_BOT_TOKEN
});
```

### 4. Whatsapp WAHA
Connect your agent to WhatsApp via WAHA. Users can chat directly from WhatsApp. By default you must provide env variables:
- WAHA_CONFIG_BASEURL
- WAHA_CONFIG_APIKEY
- WAHA_CALLBACK_PORT

or you can config it directly on options parameter.

```typescript
import { startAgentWAHA, GoogleGenAILLM } from "@ssww.one/framework";
import { myAgent } from "./my-agent";

startAgentWAHA(myAgent, {
  llm: new GoogleGenAILLM()
});

// manual config
startAgentWAHA(myAgent, {
  llm: new GoogleGenAILLM(),
  WAHAConfig: {
    baseUrl: 'http://localhost:3000'
    apiKey: '<your WAHA API Key here>'
  }
  callbackPort: 5000
});
```

You need to set callback url on WAHA as: `<your-server-ip>:<callback-port>/waha` on the example above if youre running in localhost then your callback is `http://localhost:5000/waha`

## Agent Lifecycle and Exceptions

By default, an Agent runs procedurally like a normal CLI application. Typical interaction involves the event loop waiting (`async loop()`) indefinitely for User Instructions.

```typescript
// Typical Agent Blueprint
export async function agent(at: AgentTool) {
  // Define termination keywords. If a user types this, it breaks the loop
  at.termination_keywords = ['/quit', '/exit'];
  
  at.print('Agent started.', true);

  await loop(async () => {
    const instruction = await at.waitForUserInstruction();
    await at.streamLLM(`Reply to: ${instruction}`, s => at.print(s));
    at.print('', true);
  });
}
```

## Publishing Your Agent

When you're ready to share your AI Agent with the world, the SWAN ecosystem allows you to publish it directly from your terminal.

### 1. Preparation (`package.json`)

Before publishing, configure your `package.json` to identify your agent and define the files to upload:

- **`name`**: The published name of your agent/project.
- **`version`**: The current semantic version of your agent.
- **`swan-files`**: An array of strings containing the exact files or folders that need to be packaged and uploaded. Usually, you only list core production files here, such as `"dist"`, `"package-lock.json"`, `"package.json"`, or any environment-specific files.

```json
{
  "name": "my-awesome-agent",
  "version": "1.0.0",
  "swan-files": [
    "dist",
    "package-lock.json",
    "package.json",
  ]
}
```

### 2. Authentication

Publishing requires a Developer Key.
1. Head over to [https://ssww.one](https://ssww.one) and register an account.
2. Generate your Developer Key.
3. In the root directory of your project, create a file named `.swan-auth` and place your Developer Key inside it.

### 3. Publishing

Run the following command at the root of your project:

```bash
swanc --publish
```
> **Note**: The `swanc` command-line executable is automatically installed alongside the framework.

### 4. Post-Publish Configuration

Once successfully uploaded, your AI Agent will by default have **Public** visibility inside the ecosystem (other possibilities are *Unlisted* or *Private*).

To finalize your agent's release, head back to [https://ssww.one](https://ssww.one) to configure your project. Under your dashboard, you can configure:
- **Price:** Set your desired monetization strategy.
- **Details:** Manage descriptions, titles, and thumbnails.
- **Environments:** Provide onboarding environment variables that end-users might need to run the Agent.
