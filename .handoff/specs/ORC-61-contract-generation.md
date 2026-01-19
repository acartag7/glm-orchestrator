# Task: Create ORC-63 Protocol Integration Layer Spec

Create a new spec file at `.handoff/specs/ORC-63-protocol-integration.md`

This spec defines how the contract verification system integrates with external agent protocols (A2A, MCP, LangChain, etc.).

Use the same format as ORC-61 and ORC-62 with these sections:

---

# ORC-63: Protocol Integration Layer

## Overview

Define the integration layer that allows the contract verification system (ORC-61, ORC-62) to work with any agent orchestration protocol. This makes the verification layer protocol-agnostic while providing first-class adapters for major protocols.

## Problem Statement

Agent protocols define communication, not verification:
- A2A defines how agents discover and message each other, but not how to verify handoffs
- MCP defines how agents call tools, but not how to verify tool sequences produce expected outputs
- LangChain/CrewAI define orchestration, but assume steps succeed
- Each protocol has different primitives (messages, tools, chains, crews)

The contract verification layer needs adapters to translate between protocol-specific concepts and generic contracts.

## Solution

Define a `ProtocolAdapter` interface and implement adapters for major protocols. The verification layer operates on `AgentContract` (from ORC-61) while adapters handle translation.

┌─────────────────────────────────────────────────────────────┐
│                   Agent Protocols                           │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
│   │   A2A   │  │   MCP   │  │LangChain│  │  Specwright │  │
│   └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘  │
└────────┼────────────┼────────────┼──────────────┼─────────┘
│            │            │              │
▼            ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Protocol Adapters                         │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐  │
│   │A2AAdapt │  │MCPAdapt │  │LCAdapter│  │SpecwrightAd│  │
│   └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘  │
└────────┼────────────┼────────────┼──────────────┼─────────┘
│            │            │              │
└────────────┴─────┬──────┴──────────────┘
▼
┌─────────────────────────────────────────────────────────────┐
│              Contract Verification Layer                    │
│                                                             │
│   AgentContract → Pre-Gate → Execution → Post-Gate → Next  │
│                                                             │
└─────────────────────────────────────────────────────────────┘

---

# MVP vs Roadmap

## MVP Scope

| Feature | Description | Priority |
|---------|-------------|----------|
| ProtocolAdapter interface | Core adapter contract | P0 |
| SpecwrightAdapter | Adapter for current Specwright implementation | P0 |
| AdapterRegistry | Register and lookup adapters | P0 |
| Contract middleware | Wrap protocol execution with verification | P0 |

## Roadmap (Post-MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| A2AAdapter | Full A2A protocol support | P1 |
| MCPAdapter | MCP tool sequence verification | P1 |
| LangChainAdapter | LangChain/LangGraph integration | P2 |
| CrewAIAdapter | CrewAI multi-agent verification | P2 |
| Contract negotiation | Agents negotiate contracts at runtime | P3 |
| Contract discovery | Agents advertise contracts via protocol | P3 |

---

# Data Model

## Core Types
```typescript
/**
 * Adapter interface all protocol adapters must implement
 */
interface ProtocolAdapter {
  /** Protocol identifier */
  protocol: string;
  
  /** Protocol version supported */
  version: string;
  
  /**
   * Convert protocol-specific workflow definition to AgentContract
   * @param workflow - Protocol-specific workflow (A2A task, MCP tool list, etc.)
   * @param options - Conversion options
   */
  toContract(workflow: unknown, options?: AdapterOptions): AgentContract;
  
  /**
   * Convert AgentContract back to protocol-specific format
   * @param contract - Generic agent contract
   */
  fromContract(contract: AgentContract): unknown;
  
  /**
   * Extract resources from protocol-specific execution output
   * @param output - Raw output from agent/tool execution
   * @param step - The contract step that produced this output
   */
  extractResources(output: unknown, step: ContractStep): ContractResource[];
  
  /**
   * Inject contract context into protocol-specific format
   * @param step - Current step being executed
   * @param available - Resources available from previous steps
   */
  injectContext(step: ContractStep, available: ContractResource[]): unknown;
  
  /**
   * Wrap protocol execution with contract verification
   * @param execute - The actual execution function
   * @param contract - Contract to verify against
   */
  wrap<T>(
    execute: () => Promise<T>,
    contract: AgentContract,
    stepId: string
  ): Promise<VerifiedResult<T>>;
}

interface AdapterOptions {
  /** Generate assertions automatically from schema */
  autoAssertions?: boolean;
  /** Validation strictness */
  strictness?: 'strict' | 'loose';
  /** Custom resource type mappings */
  resourceMappings?: Record<string, string>;
}

interface VerifiedResult<T> {
  result: T;
  verification: {
    passed: boolean;
    preGate: ValidationResult[];
    postGate: ValidationResult[];
    resourcesCreated: ContractResource[];
  };
}

/**
 * Registry for protocol adapters
 */
interface AdapterRegistry {
  /** Register an adapter */
  register(adapter: ProtocolAdapter): void;
  
  /** Get adapter by protocol name */
  get(protocol: string): ProtocolAdapter | undefined;
  
  /** List registered protocols */
  protocols(): string[];
  
  /** Auto-detect protocol from workflow shape */
  detect(workflow: unknown): ProtocolAdapter | undefined;
}
```

---

# Protocol Adapters

## SpecwrightAdapter (MVP)

Maps current Specwright concepts to generic contracts:
```typescript
const SpecwrightAdapter: ProtocolAdapter = {
  protocol: 'specwright',
  version: '1.0',
  
  toContract(workflow: { spec: Spec; chunks: Chunk[] }): AgentContract {
    return {
      version: '1.0',
      id: workflow.spec.id,
      protocol: 'specwright',
      steps: workflow.chunks.map(chunk => ({
        id: chunk.id,
        agent: 'opencode',  // or claude-code
        description: chunk.description,
        creates: chunk.creates || [],
        consumes: chunk.consumes || [],
        dependsOn: chunk.dependencies || [],
        assertions: chunk.assertions || []
      })),
      resources: [], // Populated during execution
      validators: [
        { type: 'file-export', config: {} },
        { type: 'exists', config: {} }
      ]
    };
  },
  
  extractResources(output: ChunkOutput, step: ContractStep): ContractResource[] {
    // Parse git diff, extract created files/exports
    // Map to ContractResource format
  },
  
  injectContext(step: ContractStep, available: ContractResource[]): string {
    // Generate prompt section with available imports
    // Current implementation in ChunkExecutor
  }
};
```

## A2AAdapter (Roadmap P1)

Maps A2A Agent Cards and Tasks to contracts:
```typescript
const A2AAdapter: ProtocolAdapter = {
  protocol: 'a2a',
  version: '0.2',
  
  toContract(workflow: A2ATask): AgentContract {
    // Map A2A Task to AgentContract
    // - A2A Message → ContractResource
    // - A2A Artifact → ContractResource  
    // - A2A Agent → ContractStep.agent
    // - A2A Task parts → ContractStep[]
  },
  
  extractResources(output: A2AMessage, step: ContractStep): ContractResource[] {
    // Extract from A2A message parts
    // - TextPart → data resource
    // - FilePart → file resource
    // - DataPart → data resource with schema
  },
  
  injectContext(step: ContractStep, available: ContractResource[]): A2AContext {
    // Format as A2A context message
    // Include available resources as A2A artifacts
  },
  
  wrap(execute, contract, stepId) {
    // Intercept A2A send/receive
    // Run pre-gate before send
    // Run post-gate after receive
  }
};
```

### A2A Mapping Table

| A2A Concept | Contract Concept |
|-------------|------------------|
| Agent Card | Step.agent metadata |
| Task | AgentContract |
| Message | ContractResource (type: "message") |
| Artifact | ContractResource (type: "artifact") |
| Task State | Step execution status |

## MCPAdapter (Roadmap P1)

Maps MCP tool calls to contracts:
```typescript
const MCPAdapter: ProtocolAdapter = {
  protocol: 'mcp',
  version: '1.0',
  
  toContract(workflow: MCPToolSequence): AgentContract {
    // Map MCP tools to ContractSteps
    // - Each tool call → ContractStep
    // - Tool parameters → consumes
    // - Tool result schema → creates
  },
  
  extractResources(output: MCPToolResult, step: ContractStep): ContractResource[] {
    // Parse MCP tool result
    // Validate against tool's result schema
  }
};
```

### MCP Mapping Table

| MCP Concept | Contract Concept |
|-------------|------------------|
| Tool | Step.agent |
| Tool input schema | Step.consumes schema |
| Tool output schema | Step.creates schema |
| Resource | ContractResource |
| Prompt | Context injection |

---

# Integration Patterns

## Pattern 1: Middleware Wrapper

Wrap protocol execution with verification:
```typescript
// Before: Direct A2A call
const result = await a2aClient.sendTask(task);

// After: Verified A2A call
const adapter = registry.get('a2a');
const contract = adapter.toContract(task);
const verified = await adapter.wrap(
  () => a2aClient.sendTask(task),
  contract,
  'step-1'
);

if (!verified.verification.passed) {
  // Handle contract violation
}
```

## Pattern 2: Orchestrator Plugin

Integrate with orchestrators as a plugin:
```typescript
// LangChain example
const verifiedChain = contractPlugin.wrap(chain, {
  contract: agentContract,
  onViolation: (result) => {
    // Retry, rollback, or escalate
  }
});
```

## Pattern 3: Contract Discovery

Agents advertise their contracts:
```typescript
// A2A Agent Card extension
interface ContractAwareAgentCard extends AgentCard {
  contracts: {
    // What this agent can verify
    supported: AgentContract[];
    // Contract negotiation endpoint
    negotiate?: string;
  };
}
```

---

# Contract Negotiation (Roadmap)

When two agents need to work together:

Agent A                           Agent B
│                                 │
├── "I need task X done" ────────▶│
│                                 │
│◀── "Here's my contract" ────────┤
│    (what I need, what I produce)│
│                                 │
├── "Can you also produce Y?" ───▶│
│                                 │
│◀── "Yes, updated contract" ─────┤
│                                 │
├── "Contract accepted" ─────────▶│
│                                 │
│    [Execution with verification]│
│                                 │

