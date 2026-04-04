# Adding a Collaborative Mermaid Flowchart Workspace

This plan outlines the architecture for introducing a live, interactive Mermaid.js flowchart into the existing Terminal Habitat. The core concept is that as shell agents execute commands and build out your project, they physically update a shared `.mermaid` file in the working directory. The UI will render this chart directly inside the Habitat area, parse the visual coordinates of the nodes, and animate the agents' sprites walking between their PC terminals and the flowchart nodes they are actively modifying.

## Is This the Right Play?

> [!TIP]
> **Yes, this is an exceptionally strong agentic design pattern.**
> Modern LLMs are phenomenally good at understanding, generating, and modifying Mermaid.js syntax. By using standard Mermaid text as the "source of truth", you avoid the overhead of complex, brittle JSON schemas or custom drag-and-drop frameworks. You tap directly into the model's native training data.

### Why it works well:
- **Shared Visualization**: It creates a literal "war room whiteboard" inside the upper Habitat viewing area. 
- **User Legibility**: You immediately understand the state of the project without reading terminal logs. 
- **Physical Integration**: We can mathematically extract the X and Y coordinates of rendered SVG nodes. When a shell agent targets a file or node, its sprite walks seamlessly from its computer desk over to the flowchart node to visualize the work being done.

### Trade-offs to consider:
1. **Scaling**: Mermaid charts get visually messy if they contain hundreds of nodes. We will need to encourage agents to maintain modular, high-level diagrams rather than micro-level file dependency graphs.
2. **Text Collision**: If multiple agents try to edit the `.mermaid` file simultaneously, we will need to utilize the existing `file_edit` intent locking system to prevent git-like merge conflicts.

---

## Proposed Changes

### 1. Engine & State Management

**Dependency Addition:** We will add the `mermaid` package to handle parsing and rendering.

#### [NEW] `src/renderer/store/useFlowchartStore.ts`
- A Zustand store that tracks:
  - The parsed coordinates of current SVG nodes (`x, y, width, height`).
  - Which shell agent is currently active on which node (mapped via Intent broadcasts).

#### [MODIFY] `src/renderer/creatures/Creature.ts`
- *Refactor Note:* Remove legacy references to "territory" or "wandering" to clarify that these are strictly "shell agent sprites".
- Ensure the sprite's movement logic has two discrete modes:
  1. **Idle/Desk:** Standing next to their associated `ComputerIcon`.
  2. **Working:** Pathfinding to the dynamically calculated `(x, y)` coordinate of a target Mermaid node on the flowchart.

---

### 2. The Shared Workspace UI (Habitat Integration)

#### [NEW] `src/renderer/components/FlowchartWorkspace.tsx`
- A React component placed inside the upper `Habitat` area alongside the agent sprites and computers.
- It constantly watches a specific file in the current working directory (e.g. `architecture.mermaid` or `project-state.md` with a mermaid block) for text changes.
- It renders the Mermaid text into SVG elements and uses `getBoundingClientRect()` to extract the physical screen coordinates of every node group (`<g>`).
- It syncs these coordinates into `useFlowchartStore`.
- **Interactivity:** Users can click on nodes to view enhanced read-only information (descriptions, assigned agents, metadata), but cannot manually assign tasks through the UI.

#### [MODIFY] `src/renderer/components/Habitat.tsx`
- Integrate `FlowchartWorkspace.tsx` directly into the background or alongside the PC icons.
- Ensure the Pixi.js Canvas sits cleanly on top of the Flowchart SVG, allowing the agent sprites to physically walk "over" the diagram.

---

### 3. Agent Tooling & Communications

#### [MODIFY] `shared/habitatCommsTypes.ts`
- Update the `IntentPayload` to include `type: 'flowchart_node'` so agents can broadcast via the event bus: *"Agent Bat is claiming node 'auth_module'"*.

#### [NEW] `src/renderer/creatures/skills/ProjectBoard.ts` (or standard system instruction)
- Inject instructions into the shell agents informing them of the workflow:
  * "The project state is tracked in `[ProjectName].mermaid` in your current directory."
  * "Before starting a task, read the flowchart. Claim your node via your intent API."
  * "When you complete a task or restructure the architecture, directly modify the `.mermaid` file to reflect the new state."

---

## Verification Plan

### Automated Tests
- Successfully install and render a dummy Mermaid string via the newly added `mermaid` library.
- Verify that DOM bounds of rendered SVG elements can be accurately projected into the Pixi.js Canvas coordinate space.

### Manual Verification
- Create a sample `project.mermaid` file in a test directory with 3 nodes.
- Instruct a shell agent to claim node "A" and edit the file.
- Visually confirm the agent's sprite leaves its computer, walks across the Habitat screen, and stops directly on top of node "A" in the diagram while editing.
- Confirm that clicking on a flowchart node opens a read-only info panel.
