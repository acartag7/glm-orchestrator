# ORC-63: Protocol Integration Layer

## Overview

Define the integration layer that allows the contract verification system (ORC-61, ORC-62) to work with any agent orchestration protocol. This makes the verification layer protocol-agnostic while providing first-class adapters for major protocols.

## Problem Statement

Agent protocols define communication, not verification:
- **A2A** defines how agents discover and message each other, but not how to verify handoffs
- **MCP** defines how agents call tools, but not how to verify tool sequences produce expected outputs
- **LangChain/CrewAI** define orchestration, but assume steps succeed
- Each protocol has different primitives (messages, tools, chains, crews)

The contract verification layer needs adapters to translate between protocol-specific concepts and generic contracts.

## Solution

Define a `ProtocolAdapter` interface and implement adapters for major protocols. The verification layer operates on `AgentContract` (from ORC-61) while adapters handle translation.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Protocols                              │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐       │
│   │   A2A   │  │   MCP   │  │LangChain│  │  Specwright │       │
│   └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘       │
└────────┼────────────┼────────────┼──────────────┼───────────────┘
         │            │            │              │
         ▼            ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Protocol Adapters                            │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐       │
│   │A2AAdapt │  │MCPAdapt │  │LCAdapter│  │SpecwrightAd│       │
│   └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘       │
└────────┼────────────┼────────────┼──────────────┼───────────────┘
         │            │            │              │
         └────────────┴─────┬──────┴──────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                Contract Verification Layer                       │
│                                                                  │
│   AgentContract → Pre-Gate → Execution → Post-Gate → Next       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

# MVP vs Roadmap

## MVP Scope

| Feature | Description | Priority |
|---------|-------------|----------|
| ProtocolAdapter interface | Core adapter contract with toContract/fromContract/extractResources | P0 |
| SpecwrightAdapter | Adapter for current Specwright implementation | P0 |
| AdapterRegistry | Register, lookup, and auto-detect adapters | P0 |
| Contract middleware | Wrap protocol execution with verification | P0 |
| Verified execution wrapper | Pre-gate → Execute → Post-gate flow | P0 |

## Roadmap (Post-MVP)

| Feature | Description | Priority |
|---------|-------------|----------|
| A2AAdapter | Full Google A2A protocol support | P1 |
| MCPAdapter | MCP tool sequence verification | P1 |
| LangChainAdapter | LangChain/LangGraph integration | P2 |
| CrewAIAdapter | CrewAI multi-agent verification | P2 |
| AutoGenAdapter | Microsoft AutoGen support | P2 |
| Contract negotiation | Agents negotiate contracts at runtime | P3 |
| Contract discovery | Agents advertise contracts via protocol | P3 |
| Cross-protocol bridging | Verify handoffs between different protocols | P3 |

---

# Data Model

## Core Types (packages/contracts/src/types.ts)

```typescript
// ============================================
// PROTOCOL ADAPTER TYPES
// ============================================

import type {
  AgentContract,
  ContractStep,
  ContractResource,
  PlannedResource,
  CreatedResource,
  AvailableResource,
  ContractAssertion,
  ValidationResult,
  ValidatorRegistry
} from './contract-types';

/**
 * Core interface all protocol adapters must implement.
 * Provides bidirectional conversion between protocol-specific formats
 * and the generic AgentContract format.
 *
 * Uses the unified resource model from ORC-61:
 * - PlannedResource: What WILL be created (in contract)
 * - CreatedResource: What WAS just created (extractResources output)
 * - AvailableResource: What IS available (after validation, injectContext input)
 */
export interface ProtocolAdapter<
  TWorkflow = unknown,
  TOutput = unknown,
  TContext = unknown
> {
  /** Protocol identifier (e.g., "specwright", "a2a", "mcp") */
  protocol: string;

  /** Protocol version supported (e.g., "1.0", "0.2") */
  version: string;

  /** Human-readable description */
  description?: string;

  /**
   * Convert protocol-specific workflow definition to AgentContract.
   * Returns contract with PlannedResource[] (phase: 'planned').
   * @param workflow - Protocol-specific workflow (A2A task, MCP tool list, etc.)
   * @param options - Conversion options
   * @returns Standardized AgentContract with planned resources
   */
  toContract(workflow: TWorkflow, options?: AdapterOptions): AgentContract;

  /**
   * Convert AgentContract back to protocol-specific format.
   * @param contract - Generic agent contract
   * @returns Protocol's native workflow format
   */
  fromContract(contract: AgentContract): TWorkflow;

  /**
   * Extract resources from protocol-specific execution output.
   * Called after each step to discover what was created.
   * Returns CreatedResource[] (phase: 'created') for validation.
   * @param output - Raw output from agent/tool execution
   * @param step - The contract step that produced this output
   * @returns Resources that were created/modified (needs validation)
   */
  extractResources(output: TOutput, step: ContractStep): CreatedResource[];

  /**
   * Inject contract context into protocol-specific format.
   * Prepares context for the next step based on validated resources.
   * Receives AvailableResource[] (phase: 'available') - only verified resources.
   * @param step - Current step being executed
   * @param available - Validated resources from previous steps
   * @returns Protocol-specific context format
   */
  injectContext(step: ContractStep, available: AvailableResource[]): TContext;

  /**
   * Wrap protocol execution with contract verification.
   * Runs pre-gate, executes, runs post-gate, accumulates context.
   * @param execute - The actual execution function
   * @param contract - Contract to verify against
   * @param stepId - Current step being executed
   * @returns Verified result with validation details
   */
  wrap<T>(
    execute: () => Promise<T>,
    contract: AgentContract,
    stepId: string
  ): Promise<VerifiedResult<T>>;

  /**
   * Register custom validators for this protocol.
   * Called when adapter is registered with the registry.
   * @param registry - Validator registry to register with
   */
  registerValidators?(registry: ValidatorRegistry): void;
}

/**
 * Options for contract conversion.
 */
export interface AdapterOptions {
  /** Generate assertions automatically from schema */
  autoAssertions?: boolean;

  /** Validation strictness level */
  strictness?: 'strict' | 'loose' | 'permissive';

  /** Custom resource type mappings (protocol type → generic type) */
  resourceMappings?: Record<string, string>;

  /** Include protocol-specific metadata in contract */
  preserveMetadata?: boolean;

  /** Maximum steps to include (for large workflows) */
  maxSteps?: number;
}

/**
 * Result of verified execution.
 * Includes both the execution result and verification details.
 *
 * Uses phase-aware resource types:
 * - resourcesCreated: CreatedResource[] - just created, pending validation
 * - resourcesPromoted: AvailableResource[] - validated and promoted
 */
export interface VerifiedResult<T> {
  /** The actual execution result */
  result: T;

  /** Whether execution completed (may be false if pre-gate failed) */
  executed: boolean;

  /** Verification details */
  verification: {
    /** Overall pass/fail */
    passed: boolean;

    /** Pre-execution gate results */
    preGate: {
      passed: boolean;
      results: ValidationResult[];
      blockedBy?: string[];
    };

    /** Post-execution validation results */
    postGate: {
      passed: boolean;
      results: ValidationResult[];
      failedAssertions?: ContractAssertion[];
    };

    /**
     * Resources created by this step (phase: 'created').
     * These are extracted but not yet validated.
     */
    resourcesCreated: CreatedResource[];

    /**
     * Resources promoted to available (phase: 'available').
     * Only present if validation passed.
     * These can be consumed by subsequent steps.
     */
    resourcesPromoted?: AvailableResource[];

    /** Execution timing */
    timing: {
      preGateMs: number;
      executionMs: number;
      postGateMs: number;
      totalMs: number;
    };
  };

  /** Error if execution or verification failed */
  error?: string;
}

/**
 * Registry for protocol adapters.
 * Manages registration, lookup, and auto-detection.
 */
export interface AdapterRegistry {
  /**
   * Register an adapter for a protocol.
   * Overwrites existing adapter for same protocol.
   */
  register(adapter: ProtocolAdapter): void;

  /**
   * Get adapter by protocol name.
   */
  get(protocol: string): ProtocolAdapter | undefined;

  /**
   * List all registered protocol names.
   */
  protocols(): string[];

  /**
   * Auto-detect protocol from workflow shape.
   * Examines structure to determine which adapter to use.
   * @param workflow - Unknown workflow object
   * @returns Matching adapter or undefined
   */
  detect(workflow: unknown): ProtocolAdapter | undefined;

  /**
   * Check if a protocol is supported.
   */
  supports(protocol: string): boolean;
}

/**
 * Middleware for wrapping protocol execution.
 */
export interface ContractMiddleware {
  /**
   * Wrap an execution function with contract verification.
   * @param protocol - Protocol being used
   * @param contract - Contract to verify against
   * @param stepId - Step being executed
   */
  wrap<T>(
    protocol: string,
    contract: AgentContract,
    stepId: string,
    execute: () => Promise<T>
  ): Promise<VerifiedResult<T>>;
}
```

## Protocol-Specific Types

```typescript
// ============================================
// A2A PROTOCOL TYPES (for A2AAdapter)
// ============================================

/**
 * A2A Agent Card - describes an agent's capabilities
 * https://github.com/google/A2A
 */
export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  authentication?: {
    schemes: string[];
  };
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills?: A2ASkill[];
}

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

/**
 * A2A Task - unit of work
 */
export interface A2ATask {
  id: string;
  sessionId?: string;
  status: A2ATaskStatus;
  message: A2AMessage;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
}

export type A2ATaskStatus =
  | { state: 'submitted' }
  | { state: 'working' }
  | { state: 'input-required'; message: A2AMessage }
  | { state: 'completed'; message: A2AMessage }
  | { state: 'failed'; message: A2AMessage }
  | { state: 'canceled' };

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
}

export type A2APart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { name: string; mimeType: string; bytes?: string; uri?: string } }
  | { type: 'data'; data: Record<string, unknown> };

export interface A2AArtifact {
  name: string;
  description?: string;
  parts: A2APart[];
}

// ============================================
// MCP PROTOCOL TYPES (for MCPAdapter)
// ============================================

/**
 * MCP Tool definition
 * https://modelcontextprotocol.io
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

export type MCPContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string } };

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP tool sequence for verification
 */
export interface MCPToolSequence {
  tools: MCPTool[];
  calls: MCPToolCall[];
  resources?: MCPResource[];
}

// ============================================
// LANGCHAIN TYPES (for LangChainAdapter)
// ============================================

/**
 * LangChain/LangGraph chain representation
 */
export interface LangChainChain {
  name: string;
  nodes: LangChainNode[];
  edges: LangChainEdge[];
}

export interface LangChainNode {
  id: string;
  type: 'llm' | 'tool' | 'retriever' | 'custom';
  config: Record<string, unknown>;
}

export interface LangChainEdge {
  source: string;
  target: string;
  condition?: string;
}
```

---

# Protocol Adapters

## SpecwrightAdapter (MVP)

Maps current Specwright concepts to generic contracts.

```typescript
// packages/contracts/src/adapters/specwright.ts

import type {
  ProtocolAdapter,
  AdapterOptions,
  VerifiedResult,
  ValidatorRegistry
} from '../types';
import type {
  AgentContract,
  ContractStep,
  ContractResource,
  ContractAssertion
} from '../contract-types';
import type { Spec, Chunk } from '@specwright/shared';

interface SpecwrightWorkflow {
  spec: Spec;
  chunks: Chunk[];
}

interface ChunkOutput {
  output: string;
  toolCalls?: unknown[];
  exitCode?: number;
}

export const SpecwrightAdapter: ProtocolAdapter<
  SpecwrightWorkflow,
  ChunkOutput,
  string  // Context is a prompt string
> = {
  protocol: 'specwright',
  version: '1.0',
  description: 'Adapter for Specwright spec-driven development',

  toContract(workflow: SpecwrightWorkflow, options?: AdapterOptions): AgentContract {
    const { spec, chunks } = workflow;

    // Convert chunks to contract steps
    const steps: ContractStep[] = chunks.map(chunk => ({
      id: chunk.id,
      agent: 'opencode',  // Default executor
      description: chunk.description,
      creates: chunk.creates || [],
      consumes: chunk.consumes || [],
      dependsOn: chunk.dependencies || [],
      assertions: (chunk.assertions || []).map(a => ({
        type: a.type as 'assert' | 'suggest',
        condition: a.condition,
        message: a.message,
        check: a.check
      })),
      metadata: {
        title: chunk.title,
        order: chunk.order,
        specId: spec.id
      }
    }));

    // Extract resources from spec contract as PlannedResource[] (phase: 'planned')
    const resources: PlannedResource[] = [];
    if (spec.contract) {
      const contract = JSON.parse(spec.contract);
      // Map types to planned resources
      (contract.types || []).forEach((t: ContractType) => {
        resources.push({
          id: `type_${t.name}`,
          type: 'file',
          phase: 'planned',
          location: t.file,
          format: 'typescript',
          definition: t.definition,
          exportedFrom: t.exportedFrom,
          exports: [t.name]
        });
      });
      // Map files to planned resources
      (contract.files || []).forEach((f: ContractFile) => {
        resources.push({
          id: `file_${f.path.replace(/[\/\.]/g, '_')}`,
          type: 'file',
          phase: 'planned',
          location: f.path,
          format: f.path.endsWith('.ts') ? 'typescript' : 'unknown',
          action: f.action,
          purpose: f.purpose,
          exports: f.exports
        });
      });
    }

    return {
      version: '1.0',
      id: `contract_${spec.id}`,
      protocol: 'specwright',
      steps,
      resources,
      validators: [
        { type: 'file-export', resourceTypes: ['file'] },
        { type: 'exists', resourceTypes: ['*'] }
      ],
      metadata: {
        generatedAt: new Date().toISOString(),
        specTitle: spec.title
      }
    };
  },

  fromContract(contract: AgentContract): SpecwrightWorkflow {
    // Convert back to Specwright format
    const chunks: Chunk[] = contract.steps.map((step, index) => ({
      id: step.id,
      specId: contract.metadata?.specId as string || '',
      title: step.metadata?.title as string || step.description.slice(0, 50),
      description: step.description,
      order: step.metadata?.order as number || index,
      status: 'pending',
      dependencies: step.dependsOn,
      creates: step.creates,
      consumes: step.consumes,
      assertions: step.assertions
    }));

    return {
      spec: {
        id: contract.id.replace('contract_', ''),
        projectId: '',
        title: contract.metadata?.specTitle as string || 'Converted Spec',
        content: '',
        status: 'approved'
      },
      chunks
    };
  },

  extractResources(output: ChunkOutput, step: ContractStep): CreatedResource[] {
    const resources: CreatedResource[] = [];
    const now = new Date().toISOString();

    // Parse git diff from output to find created/modified files
    const filePattern = /(?:create|modify|update)\s+(?:mode\s+\d+\s+)?([^\s]+)/gi;
    let match;
    while ((match = filePattern.exec(output.output)) !== null) {
      const filePath = match[1];
      resources.push({
        id: `file_${filePath.replace(/[\/\.]/g, '_')}`,
        type: 'file',
        phase: 'created',
        location: filePath,
        actualLocation: filePath,
        format: filePath.match(/\.(ts|tsx)$/) ? 'typescript' : 'unknown',
        createdByStep: step.id,
        createdAt: now
      });
    }

    // Parse exports from output
    const exportPattern = /export\s+(const|function|interface|type|class)\s+(\w+)/g;
    while ((match = exportPattern.exec(output.output)) !== null) {
      const [, exportType, exportName] = match;
      resources.push({
        id: `export_${exportName}`,
        type: 'file',
        phase: 'created',
        format: 'typescript',
        createdByStep: step.id,
        createdAt: now,
        actualExports: [exportName],
        metadata: {
          exportType
        }
      });
    }

    return resources;
  },

  injectContext(step: ContractStep, available: AvailableResource[]): string {
    const sections: string[] = [];

    // Task description
    sections.push(`# Task: ${step.metadata?.title || step.description}`);
    sections.push(`\n${step.description}`);

    // What this step must create
    if (step.creates.length > 0) {
      sections.push('\n## YOU MUST CREATE');
      step.creates.forEach(item => sections.push(`- ${item}`));
      sections.push('\nThese are REQUIRED. The step will fail if any are missing.');
    }

    // Available imports from previous steps (AvailableResource has exportName/exportType)
    if (available.length > 0) {
      sections.push('\n## AVAILABLE IMPORTS (verified to exist)');

      // Group by import source
      const bySource = new Map<string, AvailableResource[]>();
      available.forEach(resource => {
        const list = bySource.get(resource.importFrom) || [];
        list.push(resource);
        bySource.set(resource.importFrom, list);
      });

      bySource.forEach((resources, source) => {
        sections.push(`\nFrom "${source}":`);
        resources.forEach(r => {
          sections.push(`  - ${r.exportName} (${r.exportType})`);
        });
      });
    }

    // Assertions as requirements
    const asserts = step.assertions.filter(a => a.type === 'assert');
    const suggests = step.assertions.filter(a => a.type === 'suggest');

    if (asserts.length > 0) {
      sections.push('\n## REQUIREMENTS (Must Pass)');
      asserts.forEach(a => sections.push(`- ${a.message}`));
    }

    if (suggests.length > 0) {
      sections.push('\n## GUIDANCE (Should Follow)');
      suggests.forEach(s => sections.push(`- ${s.message}`));
    }

    return sections.join('\n');
  },

  async wrap<T>(
    execute: () => Promise<T>,
    contract: AgentContract,
    stepId: string
  ): Promise<VerifiedResult<T>> {
    const step = contract.steps.find(s => s.id === stepId);
    if (!step) {
      return {
        result: undefined as T,
        executed: false,
        verification: {
          passed: false,
          preGate: { passed: false, results: [], blockedBy: ['Step not found'] },
          postGate: { passed: false, results: [] },
          resourcesCreated: [],
          timing: { preGateMs: 0, executionMs: 0, postGateMs: 0, totalMs: 0 }
        },
        error: `Step ${stepId} not found in contract`
      };
    }

    const startTime = Date.now();
    let preGateMs = 0, executionMs = 0, postGateMs = 0;

    // Pre-gate: Check dependencies
    const preGateStart = Date.now();
    const preGateResults: ValidationResult[] = [];
    const blockedBy: string[] = [];

    for (const depId of step.dependsOn) {
      const depStep = contract.steps.find(s => s.id === depId);
      if (!depStep) {
        blockedBy.push(`Dependency ${depId} not found`);
      }
      // In real implementation, check if dependency completed
    }

    preGateMs = Date.now() - preGateStart;
    const preGatePassed = blockedBy.length === 0;

    if (!preGatePassed) {
      return {
        result: undefined as T,
        executed: false,
        verification: {
          passed: false,
          preGate: { passed: false, results: preGateResults, blockedBy },
          postGate: { passed: false, results: [] },
          resourcesCreated: [],
          timing: { preGateMs, executionMs: 0, postGateMs: 0, totalMs: Date.now() - startTime }
        },
        error: `Pre-gate failed: ${blockedBy.join(', ')}`
      };
    }

    // Execute
    const execStart = Date.now();
    let result: T;
    let error: string | undefined;

    try {
      result = await execute();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = undefined as T;
    }
    executionMs = Date.now() - execStart;

    // Post-gate: Validate assertions
    const postGateStart = Date.now();
    const postGateResults: ValidationResult[] = [];
    const failedAssertions: ContractAssertion[] = [];

    // In real implementation, run validators here
    // For now, mark as passed if no error
    const postGatePassed = !error;

    postGateMs = Date.now() - postGateStart;

    // Extract created resources
    const resourcesCreated = error ? [] : this.extractResources(
      { output: String(result) } as ChunkOutput,
      step
    );

    return {
      result,
      executed: true,
      verification: {
        passed: preGatePassed && postGatePassed && !error,
        preGate: { passed: preGatePassed, results: preGateResults, blockedBy: blockedBy.length > 0 ? blockedBy : undefined },
        postGate: { passed: postGatePassed, results: postGateResults, failedAssertions: failedAssertions.length > 0 ? failedAssertions : undefined },
        resourcesCreated,
        timing: {
          preGateMs,
          executionMs,
          postGateMs,
          totalMs: Date.now() - startTime
        }
      },
      error
    };
  },

  registerValidators(registry: ValidatorRegistry): void {
    // Specwright uses the default file-based validators
    // No additional registration needed
  }
};
```

## A2AAdapter (Roadmap P1)

Maps Google A2A protocol to contracts.

```typescript
// packages/contracts/src/adapters/a2a.ts

import type { ProtocolAdapter, AdapterOptions, VerifiedResult } from '../types';
import type { AgentContract, ContractStep, ContractResource } from '../contract-types';
import type { A2ATask, A2AMessage, A2APart, A2AArtifact, A2AAgentCard } from '../protocol-types';

interface A2AWorkflow {
  task: A2ATask;
  agentCard?: A2AAgentCard;
}

export const A2AAdapter: ProtocolAdapter<A2AWorkflow, A2AMessage, A2AMessage> = {
  protocol: 'a2a',
  version: '0.2',
  description: 'Adapter for Google A2A (Agent-to-Agent) protocol',

  toContract(workflow: A2AWorkflow, options?: AdapterOptions): AgentContract {
    const { task, agentCard } = workflow;

    // Map A2A task to contract steps
    // Each message exchange becomes a step
    const steps: ContractStep[] = [];

    // Initial task submission is step 0
    steps.push({
      id: `step_${task.id}_init`,
      agent: agentCard?.name || 'a2a_agent',
      description: extractTextFromParts(task.message.parts),
      creates: [],  // Will be populated from artifacts
      consumes: [],
      dependsOn: [],
      assertions: [],
      metadata: {
        a2aTaskId: task.id,
        a2aSessionId: task.sessionId,
        role: task.message.role
      }
    });

    // Map artifacts to planned resources (phase: 'planned')
    const resources: PlannedResource[] = (task.artifacts || []).map(artifact => ({
      id: `artifact_${artifact.name}`,
      type: 'artifact',
      phase: 'planned' as const,
      format: detectFormatFromParts(artifact.parts),
      purpose: artifact.description,
      metadata: {
        name: artifact.name,
        a2aArtifact: true
      }
    }));

    // Map message parts to planned resources
    task.message.parts.forEach((part, index) => {
      if (part.type === 'file') {
        resources.push({
          id: `file_${part.file.name}`,
          type: 'file',
          phase: 'planned',
          location: part.file.uri,
          format: part.file.mimeType,
          purpose: `File attachment: ${part.file.name}`,
          metadata: {
            fileName: part.file.name,
            a2aFilePart: true
          }
        });
      } else if (part.type === 'data') {
        resources.push({
          id: `data_${index}`,
          type: 'data',
          phase: 'planned',
          format: 'json',
          metadata: {
            schema: inferSchemaFromData(part.data),
            a2aDataPart: true
          }
        });
      }
    });

    // Auto-generate assertions if requested
    const validators = [
      { type: 'exists', resourceTypes: ['*'] },
      { type: 'json-schema', resourceTypes: ['data', 'artifact'] }
    ];

    return {
      version: '1.0',
      id: `contract_a2a_${task.id}`,
      protocol: 'a2a',
      steps,
      resources,
      validators,
      metadata: {
        a2aTaskId: task.id,
        a2aAgentName: agentCard?.name,
        a2aAgentUrl: agentCard?.url
      }
    };
  },

  fromContract(contract: AgentContract): A2AWorkflow {
    // Convert contract back to A2A format
    const parts: A2APart[] = [];

    // Convert first step description to text part
    if (contract.steps.length > 0) {
      parts.push({
        type: 'text',
        text: contract.steps[0].description
      });
    }

    // Convert resources to artifacts
    const artifacts: A2AArtifact[] = contract.resources
      .filter(r => r.type === 'artifact')
      .map(r => ({
        name: r.metadata?.name as string || r.id,
        description: r.metadata?.description as string,
        parts: [{ type: 'text', text: JSON.stringify(r) }]
      }));

    const task: A2ATask = {
      id: contract.metadata?.a2aTaskId as string || contract.id,
      sessionId: contract.metadata?.a2aSessionId as string,
      status: { state: 'submitted' },
      message: {
        role: 'user',
        parts
      },
      artifacts
    };

    return { task };
  },

  extractResources(output: A2AMessage, step: ContractStep): CreatedResource[] {
    const resources: CreatedResource[] = [];
    const now = new Date().toISOString();

    output.parts.forEach((part, index) => {
      if (part.type === 'text') {
        resources.push({
          id: `text_${step.id}_${index}`,
          type: 'message',
          phase: 'created',
          format: 'text',
          createdByStep: step.id,
          createdAt: now,
          metadata: {
            content: part.text
          }
        });
      } else if (part.type === 'file') {
        resources.push({
          id: `file_${part.file.name}`,
          type: 'file',
          phase: 'created',
          location: part.file.uri,
          actualLocation: part.file.uri,
          format: part.file.mimeType,
          createdByStep: step.id,
          createdAt: now,
          metadata: {
            fileName: part.file.name
          }
        });
      } else if (part.type === 'data') {
        resources.push({
          id: `data_${step.id}_${index}`,
          type: 'data',
          phase: 'created',
          format: 'json',
          createdByStep: step.id,
          createdAt: now,
          metadata: {
            data: part.data,
            schema: inferSchemaFromData(part.data)
          }
        });
      }
    });

    return resources;
  },

  injectContext(step: ContractStep, available: AvailableResource[]): A2AMessage {
    // Format available resources as A2A context message
    const parts: A2APart[] = [];

    // Add context description with verified resources
    parts.push({
      type: 'text',
      text: `Context from previous steps (verified):\n${available.map(r =>
        `- ${r.exportName || r.id}: ${r.type} from ${r.importFrom} (${r.format || 'unknown format'})`
      ).join('\n')}`
    });

    // Add data resources as data parts
    available
      .filter(r => r.type === 'data' && r.metadata?.data)
      .forEach(r => {
        parts.push({
          type: 'data',
          data: r.metadata?.data as Record<string, unknown>
        });
      });

    return {
      role: 'user',
      parts
    };
  },

  async wrap<T>(
    execute: () => Promise<T>,
    contract: AgentContract,
    stepId: string
  ): Promise<VerifiedResult<T>> {
    // Similar to SpecwrightAdapter.wrap but with A2A-specific handling
    // Implementation follows same pattern
    const startTime = Date.now();

    const result = await execute();

    return {
      result,
      executed: true,
      verification: {
        passed: true,
        preGate: { passed: true, results: [] },
        postGate: { passed: true, results: [] },
        resourcesCreated: [],
        timing: {
          preGateMs: 0,
          executionMs: Date.now() - startTime,
          postGateMs: 0,
          totalMs: Date.now() - startTime
        }
      }
    };
  }
};

// Helper functions
function extractTextFromParts(parts: A2APart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

function detectFormatFromParts(parts: A2APart[]): string {
  const filePart = parts.find((p): p is { type: 'file'; file: { mimeType: string } } =>
    p.type === 'file'
  );
  return filePart?.file.mimeType || 'unknown';
}

function inferSchemaFromData(data: Record<string, unknown>): JSONSchema {
  // Simple schema inference
  const properties: Record<string, JSONSchema> = {};
  for (const [key, value] of Object.entries(data)) {
    properties[key] = { type: typeof value };
  }
  return { type: 'object', properties };
}
```

### A2A Mapping Table

| A2A Concept | Contract Concept |
|-------------|------------------|
| Agent Card | Step.agent metadata |
| Task | AgentContract |
| Task ID | Contract.id |
| Session ID | Contract.metadata.sessionId |
| Message | ContractResource (type: "message") |
| Message.parts | Multiple ContractResources |
| TextPart | ContractResource (type: "message", format: "text") |
| FilePart | ContractResource (type: "file") |
| DataPart | ContractResource (type: "data") |
| Artifact | ContractResource (type: "artifact") |
| Task State | Step execution status |
| Skill | Step with specific capabilities |

## MCPAdapter (Roadmap P1)

Maps MCP tool calls to contracts.

```typescript
// packages/contracts/src/adapters/mcp.ts

import type { ProtocolAdapter, AdapterOptions, VerifiedResult } from '../types';
import type { AgentContract, ContractStep, ContractResource } from '../contract-types';
import type { MCPToolSequence, MCPTool, MCPToolCall, MCPToolResult } from '../protocol-types';

export const MCPAdapter: ProtocolAdapter<MCPToolSequence, MCPToolResult, MCPToolCall> = {
  protocol: 'mcp',
  version: '1.0',
  description: 'Adapter for Model Context Protocol',

  toContract(workflow: MCPToolSequence, options?: AdapterOptions): AgentContract {
    const { tools, calls, resources } = workflow;

    // Map each tool call to a contract step
    const steps: ContractStep[] = calls.map((call, index) => {
      const tool = tools.find(t => t.name === call.name);

      return {
        id: `step_${index}_${call.name}`,
        agent: call.name,  // Tool name as agent
        description: tool?.description || `Execute ${call.name}`,
        creates: [],  // Derived from output schema
        consumes: Object.keys(call.arguments),
        dependsOn: index > 0 ? [`step_${index - 1}_${calls[index - 1].name}`] : [],
        assertions: tool?.outputSchema ? [{
          type: 'assert',
          condition: 'output matches schema',
          message: `${call.name} must return valid output`,
          check: {
            type: 'schema_match',
            target: `result_${index}`,
            schema: tool.outputSchema
          }
        }] : [],
        metadata: {
          mcpTool: call.name,
          mcpArguments: call.arguments,
          inputSchema: tool?.inputSchema
        }
      };
    });

    // Map MCP resources to planned resources (phase: 'planned')
    const contractResources: PlannedResource[] = (resources || []).map(r => ({
      id: `mcp_resource_${r.uri}`,
      type: 'file',
      phase: 'planned' as const,
      location: r.uri,
      format: r.mimeType || 'unknown',
      purpose: r.description,
      metadata: {
        mcpResource: true,
        name: r.name
      }
    }));

    return {
      version: '1.0',
      id: `contract_mcp_${Date.now()}`,
      protocol: 'mcp',
      steps,
      resources: contractResources,
      validators: [
        { type: 'json-schema', resourceTypes: ['data'] },
        { type: 'exists', resourceTypes: ['file'] }
      ]
    };
  },

  fromContract(contract: AgentContract): MCPToolSequence {
    const tools: MCPTool[] = [];
    const calls: MCPToolCall[] = [];

    for (const step of contract.steps) {
      const toolName = step.metadata?.mcpTool as string || step.agent;

      // Reconstruct tool definition
      tools.push({
        name: toolName,
        description: step.description,
        inputSchema: step.metadata?.inputSchema as JSONSchema || { type: 'object' },
        outputSchema: step.assertions
          .find(a => a.check.type === 'schema_match')?.check.schema
      });

      // Reconstruct tool call
      calls.push({
        name: toolName,
        arguments: step.metadata?.mcpArguments as Record<string, unknown> || {}
      });
    }

    return { tools, calls };
  },

  extractResources(output: MCPToolResult, step: ContractStep): CreatedResource[] {
    const resources: CreatedResource[] = [];
    const now = new Date().toISOString();

    output.content.forEach((content, index) => {
      if (content.type === 'text') {
        resources.push({
          id: `text_${step.id}_${index}`,
          type: 'data',
          phase: 'created',
          format: 'text',
          createdByStep: step.id,
          createdAt: now,
          metadata: {
            text: content.text
          }
        });
      } else if (content.type === 'resource') {
        resources.push({
          id: `resource_${content.resource.uri}`,
          type: 'file',
          phase: 'created',
          location: content.resource.uri,
          actualLocation: content.resource.uri,
          format: content.resource.mimeType || 'unknown',
          createdByStep: step.id,
          createdAt: now,
          metadata: {
            text: content.resource.text
          }
        });
      }
    });

    return resources;
  },

  injectContext(step: ContractStep, available: AvailableResource[]): MCPToolCall {
    // Return tool call with verified context as additional arguments
    return {
      name: step.metadata?.mcpTool as string || step.agent,
      arguments: {
        ...(step.metadata?.mcpArguments as Record<string, unknown> || {}),
        _context: available.map(r => ({
          id: r.id,
          type: r.type,
          exportName: r.exportName,
          importFrom: r.importFrom,
          location: r.location,
          verifiedAt: r.verifiedAt
        }))
      }
    };
  },

  async wrap<T>(
    execute: () => Promise<T>,
    contract: AgentContract,
    stepId: string
  ): Promise<VerifiedResult<T>> {
    const startTime = Date.now();
    const result = await execute();

    return {
      result,
      executed: true,
      verification: {
        passed: true,
        preGate: { passed: true, results: [] },
        postGate: { passed: true, results: [] },
        resourcesCreated: [],
        timing: {
          preGateMs: 0,
          executionMs: Date.now() - startTime,
          postGateMs: 0,
          totalMs: Date.now() - startTime
        }
      }
    };
  }
};
```

### MCP Mapping Table

| MCP Concept | Contract Concept |
|-------------|------------------|
| Tool | Step.agent |
| Tool name | Step.agent, Step.metadata.mcpTool |
| Tool description | Step.description |
| Tool input schema | Step.consumes + Step.metadata.inputSchema |
| Tool output schema | Step.assertions[].check.schema |
| Tool call | Step execution |
| Tool arguments | Step.metadata.mcpArguments |
| Tool result | VerifiedResult.result |
| Resource | ContractResource |
| Resource URI | ContractResource.location |

---

# Integration Patterns

## Pattern 1: Middleware Wrapper

Wrap protocol execution with verification:

```typescript
// Usage example with A2A

import { registry } from '@specwright/contracts';
import { A2AClient } from 'a2a-client';

const a2aClient = new A2AClient();
const adapter = registry.get('a2a')!;

// Before: Direct A2A call
const result = await a2aClient.sendTask(task);

// After: Verified A2A call
const contract = adapter.toContract({ task, agentCard });
const verified = await adapter.wrap(
  () => a2aClient.sendTask(task),
  contract,
  'step_init'
);

if (!verified.verification.passed) {
  console.error('Contract violation:', verified.verification);
  // Handle violation: retry, rollback, escalate
  if (verified.verification.postGate.failedAssertions) {
    for (const assertion of verified.verification.postGate.failedAssertions) {
      console.error(`Failed: ${assertion.message}`);
    }
  }
} else {
  console.log('Verified result:', verified.result);
  console.log('Resources created:', verified.verification.resourcesCreated);
}
```

## Pattern 2: Orchestrator Plugin

Integrate with orchestrators as a plugin:

```typescript
// LangChain integration example

import { ChatOpenAI } from '@langchain/openai';
import { RunnableSequence } from '@langchain/core/runnables';
import { contractPlugin } from '@specwright/contracts/plugins/langchain';

// Define your chain
const chain = RunnableSequence.from([
  prompt,
  model,
  outputParser
]);

// Wrap with contract verification
const verifiedChain = contractPlugin.wrap(chain, {
  contract: agentContract,
  onViolation: async (result, step) => {
    // Options: retry, rollback, escalate, continue
    if (result.verification.postGate.failedAssertions?.length === 1) {
      // Single failure - try to fix
      return { action: 'retry', maxRetries: 3 };
    }
    // Multiple failures - escalate
    return { action: 'escalate', reason: 'Multiple contract violations' };
  },
  onSuccess: async (result, step) => {
    // Log successful step completion
    console.log(`Step ${step.id} completed with ${result.verification.resourcesCreated.length} resources`);
  }
});

// Use the verified chain
const result = await verifiedChain.invoke({ input: 'user query' });
```

## Pattern 3: Contract Discovery

Agents advertise their contracts:

```typescript
// Extended A2A Agent Card with contract support

interface ContractAwareAgentCard extends A2AAgentCard {
  /** Contract-related capabilities */
  contracts: {
    /** Contract templates this agent can execute */
    supported: AgentContract[];

    /** Types of resources this agent can create */
    produces: string[];

    /** Types of resources this agent requires */
    requires: string[];

    /** Contract negotiation endpoint */
    negotiateUrl?: string;

    /** Contract validation endpoint */
    validateUrl?: string;
  };
}

// Example agent card
const researchAgent: ContractAwareAgentCard = {
  name: 'Research Agent',
  description: 'Searches and synthesizes information',
  url: 'https://agents.example.com/research',
  version: '1.0',
  capabilities: { streaming: true },
  skills: [
    { id: 'web_search', name: 'Web Search', description: 'Search the web' },
    { id: 'summarize', name: 'Summarize', description: 'Summarize content' }
  ],
  contracts: {
    supported: [researchContract],
    produces: ['data', 'artifact'],
    requires: ['message'],
    negotiateUrl: 'https://agents.example.com/research/negotiate',
    validateUrl: 'https://agents.example.com/research/validate'
  }
};
```

## Pattern 4: Cross-Protocol Bridge

Verify handoffs between different protocols:

```typescript
// Bridge A2A agent output to MCP tool input

import { registry } from '@specwright/contracts';

const a2aAdapter = registry.get('a2a')!;
const mcpAdapter = registry.get('mcp')!;

async function bridgeA2AtoMCP(
  a2aResult: A2AMessage,
  mcpTool: MCPTool,
  contract: AgentContract
): Promise<MCPToolCall> {
  // Extract resources from A2A result
  const a2aStep = contract.steps.find(s => s.metadata?.protocol === 'a2a');
  const resources = a2aAdapter.extractResources(a2aResult, a2aStep!);

  // Validate resources match MCP tool requirements
  const validation = await validateResources(resources, mcpTool.inputSchema);
  if (!validation.passed) {
    throw new Error(`Bridge validation failed: ${validation.error}`);
  }

  // Inject into MCP format
  const mcpStep = contract.steps.find(s => s.metadata?.protocol === 'mcp');
  return mcpAdapter.injectContext(mcpStep!, resources);
}
```

---

# Contract Negotiation (Roadmap P3)

When two agents need to work together:

```
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
```

```typescript
/**
 * Contract negotiation protocol
 */
interface ContractNegotiation {
  /** Propose a contract to an agent */
  propose(
    targetAgent: string,
    contract: AgentContract
  ): Promise<NegotiationResponse>;

  /** Counter-propose with modifications */
  counterPropose(
    negotiationId: string,
    modifications: ContractModification[]
  ): Promise<NegotiationResponse>;

  /** Accept a contract */
  accept(negotiationId: string): Promise<AcceptedContract>;

  /** Reject a contract with reason */
  reject(negotiationId: string, reason: string): Promise<void>;
}

interface NegotiationResponse {
  negotiationId: string;
  status: 'proposed' | 'counter' | 'accepted' | 'rejected';
  contract: AgentContract;
  modifications?: ContractModification[];
  reason?: string;
}

interface ContractModification {
  path: string;  // JSON path to modified element
  type: 'add' | 'remove' | 'change';
  value?: unknown;
  reason: string;
}

interface AcceptedContract {
  contract: AgentContract;
  acceptedAt: string;
  parties: string[];
  signatures?: Record<string, string>;  // Agent signatures
}
```

---

# Implementation

## File Structure

```
packages/contracts/
├── src/
│   ├── adapters/
│   │   ├── index.ts           # Export all adapters
│   │   ├── specwright.ts      # SpecwrightAdapter (MVP)
│   │   ├── a2a.ts             # A2AAdapter (P1)
│   │   ├── mcp.ts             # MCPAdapter (P1)
│   │   └── langchain.ts       # LangChainAdapter (P2)
│   ├── registry.ts            # AdapterRegistry implementation
│   ├── middleware.ts          # Contract verification middleware
│   ├── negotiation.ts         # Contract negotiation (P3)
│   ├── types.ts               # Type definitions
│   └── index.ts               # Main exports
├── plugins/
│   ├── langchain.ts           # LangChain plugin
│   └── crewai.ts              # CrewAI plugin
└── package.json
```

## Registry Implementation

```typescript
// packages/contracts/src/registry.ts

import type { ProtocolAdapter, AdapterRegistry } from './types';
import { SpecwrightAdapter } from './adapters/specwright';

class DefaultAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<string, ProtocolAdapter>();

  register(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.protocol, adapter);
    console.log(`[Registry] Registered adapter: ${adapter.protocol} v${adapter.version}`);
  }

  get(protocol: string): ProtocolAdapter | undefined {
    return this.adapters.get(protocol);
  }

  protocols(): string[] {
    return Array.from(this.adapters.keys());
  }

  supports(protocol: string): boolean {
    return this.adapters.has(protocol);
  }

  detect(workflow: unknown): ProtocolAdapter | undefined {
    if (!workflow || typeof workflow !== 'object') {
      return undefined;
    }

    const obj = workflow as Record<string, unknown>;

    // Check for Specwright shape
    if ('spec' in obj && 'chunks' in obj) {
      return this.adapters.get('specwright');
    }

    // Check for A2A shape
    if ('task' in obj || ('message' in obj && 'parts' in (obj.message as object))) {
      return this.adapters.get('a2a');
    }

    // Check for MCP shape
    if ('tools' in obj && Array.isArray(obj.tools)) {
      return this.adapters.get('mcp');
    }

    // Check for LangChain shape
    if ('nodes' in obj && 'edges' in obj) {
      return this.adapters.get('langchain');
    }

    return undefined;
  }
}

// Default registry with built-in adapters
export const registry: AdapterRegistry = new DefaultAdapterRegistry();

// Register built-in adapters
registry.register(SpecwrightAdapter);

// Export for custom registries
export { DefaultAdapterRegistry };
```

## Middleware Implementation

```typescript
// packages/contracts/src/middleware.ts

import type {
  ContractMiddleware,
  VerifiedResult,
  AdapterRegistry
} from './types';
import type { AgentContract } from './contract-types';
import { registry as defaultRegistry } from './registry';

export function createMiddleware(
  customRegistry?: AdapterRegistry
): ContractMiddleware {
  const reg = customRegistry || defaultRegistry;

  return {
    async wrap<T>(
      protocol: string,
      contract: AgentContract,
      stepId: string,
      execute: () => Promise<T>
    ): Promise<VerifiedResult<T>> {
      const adapter = reg.get(protocol);

      if (!adapter) {
        return {
          result: undefined as T,
          executed: false,
          verification: {
            passed: false,
            preGate: {
              passed: false,
              results: [],
              blockedBy: [`No adapter found for protocol: ${protocol}`]
            },
            postGate: { passed: false, results: [] },
            resourcesCreated: [],
            timing: { preGateMs: 0, executionMs: 0, postGateMs: 0, totalMs: 0 }
          },
          error: `No adapter found for protocol: ${protocol}`
        };
      }

      return adapter.wrap(execute, contract, stepId);
    }
  };
}

// Default middleware instance
export const middleware = createMiddleware();
```

---

# Acceptance Criteria

## MVP

- [ ] ProtocolAdapter interface defined in contracts package
- [ ] AdapterRegistry implemented with register/get/detect/protocols/supports
- [ ] SpecwrightAdapter fully implemented with all interface methods
- [ ] Current Specwright chunk execution uses SpecwrightAdapter
- [ ] Middleware wrapper pattern working for Specwright
- [ ] VerifiedResult type captures all verification details
- [ ] Tests for adapter interface compliance
- [ ] Tests for registry auto-detection

## Roadmap

- [ ] A2AAdapter implemented with full mapping table
- [ ] A2A middleware integration tested
- [ ] A2A Agent Card extension for contract discovery
- [ ] MCPAdapter implemented with full mapping
- [ ] MCP tool sequence verification working
- [ ] LangChainAdapter implemented
- [ ] LangChain plugin for RunnableSequence
- [ ] CrewAIAdapter implemented
- [ ] Cross-protocol bridge utility
- [ ] Contract negotiation protocol defined
- [ ] Contract negotiation implementation
- [ ] Contract discovery via Agent Cards

---

# Resource Lifecycle Integration

The protocol adapters work with the unified resource model from ORC-61. This diagram shows how resources flow through the system:

```
┌─────────────────────────────────────────────────────────────────┐
│  RESOURCE LIFECYCLE IN PROTOCOL ADAPTERS                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. toContract() creates PlannedResource[]                       │
│     └─ phase: 'planned' - what WILL be created                   │
│     └─ Defined in contract before execution                      │
│                                                                  │
│  2. Step executes (via wrap())                                   │
│     └─ Protocol-specific execution happens                       │
│                                                                  │
│  3. extractResources() returns CreatedResource[]                 │
│     └─ phase: 'created' - what WAS just created                  │
│     └─ Needs validation before downstream use                    │
│                                                                  │
│  4. Validation (ORC-62 validators)                               │
│     └─ Validators check CreatedResource against assertions       │
│     └─ Uses hybrid validator selection                           │
│                                                                  │
│  5. promoteToAvailable() creates AvailableResource[]             │
│     └─ phase: 'available' - verified and ready                   │
│     └─ Only valid resources are promoted                         │
│                                                                  │
│  6. injectContext() receives AvailableResource[]                 │
│     └─ Next step only sees validated resources                   │
│     └─ Type-safe consumption guarantees                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Key benefits of the unified model in protocol adapters:

| Aspect | Benefit |
|--------|---------|
| Type Safety | TypeScript discriminated unions ensure correct phase usage |
| Validation | Only validated resources propagate to downstream steps |
| Traceability | Each resource tracks createdByStep, createdAt, verifiedAt |
| Protocol Agnostic | Same lifecycle works across A2A, MCP, LangChain, etc. |
| Immutability | Resources transition phases, never mutate in place |

---

# References

- **ORC-61**: Contract Generation System (contract structure, unified ContractResource with phases)
- **ORC-62**: Assertion Enforcement System (validation layer, Validator interface, hybrid selection)
- **Unified Resource Model**: PlannedResource → CreatedResource → AvailableResource lifecycle
- **A2A Protocol**: https://github.com/google/A2A
- **MCP Specification**: https://modelcontextprotocol.io
- **LangChain**: https://langchain.com
- **CrewAI**: https://crewai.com
- **AutoGen**: https://microsoft.github.io/autogen/
